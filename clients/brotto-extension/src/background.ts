import { createCanonicalExecutionPipeline } from "./canonical/action-executor";
import {
  CanonicalExtensionController,
  ControlPlaneConnectionBootstrap,
  type BootstrapInput,
  type ConnectionBootstrapPort,
  type ControllerUiEvent,
} from "./canonical/controller";
import { captureObservation } from "./canonical/observation";
import { PageSettler } from "./canonical/page-settler";
import { CanonicalSessionStore, type StorageAreaPort } from "./canonical/session-store";
import { CanonicalTransport } from "./canonical/transport";
import * as debuggerModule from "./debugger";
import { resolveLoginPause, runLocalLoop } from "./local-driver";

const BADGE_ACTIVE_COLOR = "#22c55e";
const BADGE_INACTIVE_COLOR = "#6b7280";
const BOOTSTRAP_PATH = "/v1...sessions";

// ponytail: local-driver state. One active loop at a time. The planner URL
// defaults to demo-server on localhost; override via storage.local if needed.
let localAbortController: AbortController | null = null;
let localTabId: number | null = null;
const DEFAULT_PLANNER_URL = "http://127.0.0.1:3001";

let managedHostnames = new Set<string>();
let managedOrigins: string[] = [];
let managedControlPlaneUrl: string | null = null;

const store = new CanonicalSessionStore({
  local: chrome.storage.local as unknown as StorageAreaPort,
  ...(chrome.storage.session === undefined
    ? {}
    : { session: chrome.storage.session as unknown as StorageAreaPort }),
});

const bootstrap: ConnectionBootstrapPort = {
  async bootstrap(input: BootstrapInput, signal: AbortSignal) {
    if (managedControlPlaneUrl === null) throw new Error("Administrator-managed control-plane URL is unavailable");
    const endpoint = bootstrapEndpoint(managedControlPlaneUrl);
    return new ControlPlaneConnectionBootstrap(endpoint).bootstrap(input, signal);
  },
};

const controller = new CanonicalExtensionController({
  bootstrap,
  store,
  tabs: {
    activeTabId: async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs.length === 1 ? tabs[0]?.id : undefined;
      if (tabId === undefined) throw new Error("Exactly one active browser tab is required");
      const url = tabs[0]?.url;
      if (url === undefined || !/^https?:\/\//i.test(url)) throw new Error("The active tab must use HTTP(S)");
      return tabId;
    },
    attach: async (tabId) => { await debuggerModule.attachToTab(tabId); },
    detach: async (tabId) => { await debuggerModule.detachFromTab(tabId); },
    isAttached: async (tabId) => {
      if (debuggerModule.isAttached(tabId)) return true;
      const targets = await debuggerModule.getTargets() as unknown as Array<{ tabId?: number; attached?: boolean }>;
      return targets.some((target) => target.tabId === tabId && target.attached === true);
    },
  },
  capture: async (tabId, signal) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const before = await mainFrameId(tabId);
    const observation = await captureObservation(tabId);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const after = await mainFrameId(tabId);
    if (before !== after) throw new Error("The main frame changed across canonical capture");
    return { observation, mainFrameId: after };
  },
  executionPipelineFactory: ({ tabId, serverUrl, observationAuthority, approvals }) => createCanonicalExecutionPipeline({
    tabId,
    observationAuthority,
    approvals,
    resolver: new CustomerControlledDnsResolver(serverUrl),
    trustedHostnamePolicy: { isTrusted: (hostname) => managedHostnames.has(hostname.toLowerCase()) },
    allowedOrigins: managedOrigins,
    createSettler: (mainFrame, initialPageState) => new PageSettler({
      tabId,
      mainFrameId: mainFrame,
      initialPageState,
      getPageState: () => readPageState(tabId),
    }),
    send: async (id, command) => debuggerModule.sendCommand(id, command),
  }),
  transportFactory: (context) => new CanonicalTransport({
    material: context.material,
    initialSequences: {
      lastReceivedSequence: context.recovery.lastReceivedSequence,
      lastSentSequence: context.recovery.lastSentSequence,
    },
    pendingActionIds: context.pendingActionIds,
    getReconnectMaterial: context.getReconnectMaterial,
    onMaterial: context.onMaterial,
    onMessage: context.onMessage,
    onMessageError: (error) => notifyUi({
      type: "canonical_error",
      code: "CONTROLLER_MESSAGE_FAILED",
      message: error instanceof Error ? error.message : "Canonical controller message failed",
    }),
    onStateChange: context.onStateChange,
    onProtocolError: (code) => notifyUi({ type: "canonical_error", code, message: "A canonical protocol message was rejected" }),
  }),
  emitUiEvent: (event) => {
    updateBadgeForEvent(event);
    notifyUi(event);
  },
});

function handleMessage(
  message: Record<string, unknown>,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: Record<string, unknown>) => void,
): boolean {
  void dispatchMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "Canonical extension request failed",
    }));
  return true;
}

async function dispatchMessage(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (message.type) {
    case "get_connection_status": {
      const state = await controller.viewState();
      return {
        success: true,
        status: {
          connected: state.transport?.status === "open",
          recovery: state.recovery,
          reconnect: state.transport,
          trajectory: state.trajectory,
          terminal: state.terminal,
          approval: state.approval,
        },
      };
    }
    case "send_task":
      await loadManagedPolicy();
      await controller.startTask(String(message.task ?? ""));
      return { success: true };
    case "cancel_task":
    case "stop_task":
      await controller.cancel(typeof message.reason === "string" ? message.reason : undefined);
      return { success: true };
    case "disconnect_relay":
      await controller.disconnect();
      return { success: true };
    case "approve_action":
      await controller.resolveApproval(true);
      return { success: true };
    case "deny_action":
      await controller.resolveApproval(false);
      return { success: true };
    case "login_complete":
      await controller.submitFreshObservation("User interaction completed; fresh observation submitted");
      return { success: true };
    case "clear_trajectory":
      await store.clearTrajectory();
      return { success: true };
    case "connect_relay":
      return { success: false, error: "Sending a task starts its authenticated canonical session" };
    case "run_local_task": {
      // ponytail: extension runs the agent loop locally against the demo-server.
      // Used for the demo path where the user installs the extension and watches
      // actions take place in their real Chrome without a remote orchestrator.
      if (localAbortController !== null) {
        return { success: false, error: "A local task is already running" };
      }
      const goal = String(message.task ?? "").trim();
      if (goal.length === 0) return { success: false, error: "task is empty" };
      const startingUrl = typeof message.startingUrl === "string" ? message.startingUrl : undefined;
      const plannerUrl = typeof message.plannerUrl === "string" ? message.plannerUrl : DEFAULT_PLANNER_URL;
      const controller_ac = new AbortController();
      localAbortController = controller_ac;
      notifyUi({ type: "canonical_status", status: "executing" });
      void runLocalLoop({
        goal,
        startingUrl,
        plannerUrl,
        signal: controller_ac.signal,
        onTabOpened: (tabId) => {
          localTabId = tabId;
        },
        onStep: ({ index, action, result, url, screenshot, iconKind }) => {
          notifyUi({
            type: "step_card",
            index,
            title: action,
            result,
            url,
            screenshot: screenshot ?? undefined,
            screenshotPlaceholder: screenshot ? undefined : "Screenshot unavailable (chrome:// page or capture blocked)",
            iconKind,
            ts: Date.now(),
          });
        },
        // ponytail: log events surface as 'observation' kind so the existing
        // popup log handler picks them up without a new message type.
        onLoginRequired: ({ url, domain }) => {
          notifyUi({ type: "login_required", url, domain });
        },
        onComplete: ({ summary, steps }) => {
          notifyUi({ type: "task_completed", summary, steps });
        },
        onError: ({ code, message }) => {
          notifyUi({ type: "canonical_error", code, message });
        },
        onLog: (message) => {
          // ponytail: surface as observation-kind step so the popup log renders it.
          notifyUi({ type: "canonical_step", kind: "observation", summary: message });
        },
      }).then(() => {
        localAbortController = null;
        localTabId = null;
        notifyUi({ type: "canonical_status", status: "completed" });
      }).catch((err: unknown) => {
        localAbortController = null;
        localTabId = null;
        notifyUi({ type: "canonical_error", code: "LOCAL_LOOP_THREW", message: err instanceof Error ? err.message : String(err) });
      });
      return { success: true };
    }
    case "cancel_local_task": {
      if (localAbortController === null) return { success: false, error: "No local task is running" };
      localAbortController.abort();
      localAbortController = null;
      if (localTabId !== null) {
        await debuggerModule.detachFromTab(localTabId).catch(() => undefined);
        localTabId = null;
      }
      return { success: true };
    }
    case "local_login_complete": {
      // ponytail: the user clicked Continue in the popup. Resume the loop by
      // resolving the pending login-pause promise for the active tab.
      if (localTabId === null) return { success: false, error: "No local task is paused" };
      const resolved = resolveLoginPause(localTabId);
      return { success: resolved, error: resolved ? undefined : "No pending login pause" };
    }
    case "local_login_skip": {
      // ponytail: the user dismissed the login prompt. Abort the loop cleanly.
      if (localAbortController === null) return { success: false, error: "No local task is running" };
      localAbortController.abort();
      localAbortController = null;
      return { success: true };
    }
    case "submit_user_input": {
      // ponytail: side panel surfaced a clarifying question. The local-driver
      // doesn't currently emit questions — this hook is reserved for the next
      // slice where the planner returns QuestionProposal and we want the
      // user to type an answer. For now, just acknowledge.
      return { success: true, acknowledged: typeof message.value === "string" ? message.value : "" };
    }
    default:
      return { success: false, error: "Unknown message type" };
  }
}

async function initialize(): Promise<void> {
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onInstalled.addListener(() => { void setBadge(false); });
  // ponytail: open the side panel when the user clicks the action icon. This
  // replaces the old popup behavior — the side panel is the live activity
  // stream, login prompts, and approval surface.
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn("sidePanel.setPanelBehavior failed:", err);
  }
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== undefined || changeInfo.url !== undefined) controller.invalidateObservation(tabId);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => { controller.invalidateObservation(tabId); });
  await loadManagedPolicy();
  const restored = await controller.restore().catch((error: unknown) => {
    notifyUi({
      type: "canonical_error",
      code: "SESSION_RESTORE_FAILED",
      message: error instanceof Error ? error.message : "Session restoration failed",
    });
    return false;
  });
  await setBadge(restored);
}

class CustomerControlledDnsResolver {
  private readonly endpoint: string;

  constructor(serverUrl: string) {
    const url = new URL(serverUrl);
    url.protocol = "https:";
    url.pathname = "/v1...dns/resolve";
    url.search = "";
    url.hash = "";
    this.endpoint = url.href;
  }

  async resolve(hostname: string, signal?: AbortSignal): Promise<readonly string[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname }),
      signal,
    });
    if (!response.ok) throw new Error("Customer-controlled DNS resolution failed");
    const body = await response.json() as { addresses?: unknown };
    if (!Array.isArray(body.addresses) || !body.addresses.every((value) => typeof value === "string")) {
      throw new Error("Customer-controlled DNS response is invalid");
    }
    return body.addresses;
  }
}

function bootstrapEndpoint(rawServerUrl: string): string {
  const url = new URL(rawServerUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("Control-plane URL must use HTTPS");
  }
  url.pathname = BOOTSTRAP_PATH;
  url.search = "";
  url.hash = "";
  return url.href;
}

async function loadManagedPolicy(): Promise<void> {
  try {
    const managed = await chrome.storage.managed.get(["canonicalAllowedHostnames", "canonicalAllowedOrigins", "canonicalControlPlaneUrl"]);
    const hostnames = Array.isArray(managed.canonicalAllowedHostnames) ? managed.canonicalAllowedHostnames : [];
    const origins = Array.isArray(managed.canonicalAllowedOrigins) ? managed.canonicalAllowedOrigins : [];
    managedHostnames = new Set(hostnames.flatMap((value) => typeof value === "string" && validHostname(value) ? [value.toLowerCase()] : []));
    managedOrigins = origins.flatMap((value) => typeof value === "string" && validHttpsOrigin(value) ? [new URL(value).origin] : []);
    managedControlPlaneUrl = typeof managed.canonicalControlPlaneUrl === "string" && validHttpsOrigin(managed.canonicalControlPlaneUrl)
      ? managed.canonicalControlPlaneUrl
      : null;
  } catch {
    managedHostnames = new Set();
    managedOrigins = [];
    managedControlPlaneUrl = null;
  }
}

async function mainFrameId(tabId: number): Promise<string> {
  const result = await debuggerModule.sendCommand(tabId, { method: "Page.getFrameTree" }) as {
    frameTree?: { frame?: { id?: unknown }; childFrames?: unknown[] };
  };
  const id = result.frameTree?.frame?.id;
  if (typeof id !== "string" || id.length === 0 || (result.frameTree?.childFrames?.length ?? 0) > 0) {
    throw new Error("A single canonical main frame could not be proven");
  }
  return id;
}

async function readPageState(tabId: number): Promise<{
  url: string;
  title: string;
  lifecycle: "loading" | "interactive" | "complete" | "frozen";
}> {
  const result = await debuggerModule.sendCommand(tabId, {
    method: "Runtime.evaluate",
    params: {
      expression: "({url:location.href,title:document.title,lifecycle:document.readyState})",
      returnByValue: true,
      awaitPromise: false,
    },
  }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  if (result.exceptionDetails !== undefined || result.result?.value === null || typeof result.result?.value !== "object") {
    throw new Error("Page state is unavailable");
  }
  const value = result.result.value as Record<string, unknown>;
  if (typeof value.url !== "string" || typeof value.title !== "string" ||
    !["loading", "interactive", "complete"].includes(String(value.lifecycle))) {
    throw new Error("Page state is invalid");
  }
  return {
    url: value.url,
    title: value.title,
    lifecycle: value.lifecycle as "loading" | "interactive" | "complete",
  };
}

function validHostname(value: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function validHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.origin === value.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function updateBadgeForEvent(event: ControllerUiEvent): void {
  if (event.type !== "canonical_status") return;
  void setBadge(event.status === "connected" || event.status === "executing" || event.status === "waiting_for_approval");
}

async function setBadge(active: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: active ? BADGE_ACTIVE_COLOR : BADGE_INACTIVE_COLOR });
  await chrome.action.setBadgeText({ text: active ? "ON" : "" });
}

function notifyUi(event: ControllerUiEvent): void {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

void initialize();
