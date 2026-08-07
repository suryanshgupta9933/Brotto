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
// ponytail: true once the user pressed Stop (or the loop completed and the
// post-loop cleanup ran). The loop reads this in its finally block to
// decide whether to emit a follow-up terminal event — the cancel handler
// already emits one immediately so the side panel exits 'Working' within
// ~1 second; the loop's eventual emit would race and double-fire.
let localTaskTerminalEmitted = false;
const DEFAULT_PLANNER_URL = "http://127.0.0.1:3001";

// ponytail: pending-clarify and pending-approval resolvers keyed by request id.
// The side panel responds by sending `submit_clarification` / `submit_approval`
// with the same id. Resolved value is whatever the user typed/clicked.
const pendingClarifyResolvers = new Map<string, (answer: string) => void>();
const pendingApprovalResolvers = new Map<string, (approved: boolean) => void>();
let requestIdCounter = 0;

function newRequestId(prefix: string): string {
  requestIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestIdCounter}`;
}

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
      if (localAbortController !== null || localTabId !== null) {
        return { success: false, error: "A local task is already running" };
      }
      // ponytail: reset the terminal-emitted flag so a new task can emit
      // its own completion/error event. Without this, the first run after
      // a cancel would silently drop its terminal emit.
      localTaskTerminalEmitted = false;
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
        onTabEvent: (event) => {
          // ponytail: forward tab lifecycle (opened/closed/navigated/focused)
          // to the side panel so the user can see what the agent opened in
          // their browser, with a brief context line per tab.
          notifyUi({ type: "tab_event", event } as unknown as ControllerUiEvent);
        },
        onStep: ({ index, action, result, url, screenshot, iconKind, reasoning }) => {
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
            // ponytail: planner's one-sentence reasoning surfaces as the
            // assistant bubble title in the side panel.
            reasoning,
          });
        },
        // ponytail: log events surface as 'observation' kind so the existing
        // popup log handler picks them up without a new message type.
        onLoginRequired: ({ url, domain }) => {
          notifyUi({ type: "login_required", url, domain });
        },
        onComplete: ({ summary, steps, finalAnswer }) => {
          // ponytail: skip if the cancel handler already emitted a
          // terminal event. Otherwise we would append a duplicate
          // 'Task complete' bubble on top of 'Task was cancelled'.
          if (localTaskTerminalEmitted) return;
          localTaskTerminalEmitted = true;
          notifyUi({ type: "task_completed", summary, steps, finalAnswer });
        },
        onError: ({ code, message }) => {
          // ponytail: skip if the cancel handler already emitted a
          // terminal event for the user-pressed-Stop case.
          if (localTaskTerminalEmitted) return;
          localTaskTerminalEmitted = true;
          notifyUi({ type: "task_failed", code, message });
        },
        onLog: (message) => {
          // ponytail: internal loop liveness — service worker console only.
          // The side panel used to render every step/approval/timing string
          // as a system message in the chat; we now keep chat clean and let
          // the operator inspect logs in chrome://extensions.
          console.log(`[brotto-bg] ${message}`);
        },
        onClarify: ({ reason, question, context }) => {
          // ponytail: send a clarify event to the side panel and wait for
          // submit_clarification. Returns the user's answer string.
          const id = newRequestId("clarify");
          return new Promise<string>((resolve) => {
            pendingClarifyResolvers.set(id, resolve);
            notifyUi({ type: "clarify_request", id, reason, question, context });
          });
        },
        onApprovalRequired: ({ reason, action, url }) => {
          // ponytail: send an approval_request event and wait for the user's
          // approve/deny click in the side panel.
          const id = newRequestId("approval");
          return new Promise<boolean>((resolve) => {
            pendingApprovalResolvers.set(id, resolve);
            notifyUi({ type: "approval_request", id, reason, action, url });
          });
        },
        onAnswered: ({ question, answer }) => {
          console.log(`[brotto-bg] user answered (${question.slice(0, 60)}): ${answer.slice(0, 80)}`);
        },
        onApprovalResolved: ({ approved, action }) => {
          console.log(`[brotto-bg] ${approved ? "approved" : "denied"} ${action.type ?? "action"}`);
        },
      }).then(() => {
        localAbortController = null;
        localTabId = null;
        // ponytail: only emit canonical_status: completed if the task
        // ended cleanly. If the task errored, the onError callback above
        // already emitted task_failed (which sets phase to 'error') and
        // a follow-up 'completed' would overwrite it back to 'done'.
        if (!localTaskTerminalEmitted) {
          notifyUi({ type: "canonical_status", status: "completed" });
        }
      }).catch((err: unknown) => {
        localAbortController = null;
        localTabId = null;
        notifyUi({ type: "canonical_error", code: "LOCAL_LOOP_THREW", message: err instanceof Error ? err.message : String(err) });
      });
      return { success: true };
    }
    case "cancel_local_task": {
      if (localAbortController === null) return { success: false, error: "No local task is running" };
      // ponytail: mark terminal-emitted BEFORE aborting so the loop's
      // cleanup phase (which can take up to the 15s capture timeout)
      // does not fire a duplicate terminal event that would overwrite
      // the error phase or append a duplicate error bubble.
      localTaskTerminalEmitted = true;
      localAbortController.abort();
      localAbortController = null;
      if (localTabId !== null) {
        await debuggerModule.detachFromTab(localTabId).catch(() => undefined);
        localTabId = null;
      }
      // ponytail: emit the terminal event SYNCHRONOUSLY so the side
      // panel exits 'Working' within ~1 tick. Without this the user
      // sees the spinner continue for up to 15 seconds after pressing
      // Stop (waiting for the in-flight capture timeout).
      notifyUi({
        type: "task_failed",
        code: "CANCELLED",
        message: "Task was cancelled by user",
      });
      notifyUi({ type: "canonical_status", status: "cancelled" });
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
      localTabId = null;
      return { success: true };
    }
    case "submit_clarification": {
      // ponytail: side panel returns the user's answer to a clarify request.
      const id = typeof message.id === "string" ? message.id : "";
      const resolve = pendingClarifyResolvers.get(id);
      if (!resolve) return { success: false, error: "No pending clarification" };
      pendingClarifyResolvers.delete(id);
      resolve(typeof message.answer === "string" ? message.answer : "");
      return { success: true };
    }
    case "submit_approval": {
      // ponytail: side panel returns the user's approve/deny click.
      const id = typeof message.id === "string" ? message.id : "";
      const resolve = pendingApprovalResolvers.get(id);
      if (!resolve) return { success: false, error: "No pending approval" };
      pendingApprovalResolvers.delete(id);
      resolve(message.approved === true);
      return { success: true };
    }
    case "reset_session": {
      // ponytail: Refresh button handler. Aborts loop, detaches debugger,
      // clears state, persists nothing. Doesn't close the tab — the user
      // may want to keep the page open.
      if (localAbortController !== null) {
        localAbortController.abort();
        localAbortController = null;
      }
      if (localTabId !== null) {
        await debuggerModule.detachFromTab(localTabId).catch(() => undefined);
        localTabId = null;
      }
      pendingClarifyResolvers.clear();
      pendingApprovalResolvers.clear();
      notifyUi({ type: "log", message: "Session reset" });
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
