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

const BADGE_ACTIVE_COLOR = "#22c55e";
const BADGE_INACTIVE_COLOR = "#6b7280";
const BOOTSTRAP_PATH = "/v1/browser-extension/sessions";

let managedHostnames = new Set<string>();
let managedOrigins: string[] = [];

const store = new CanonicalSessionStore({
  local: chrome.storage.local as unknown as StorageAreaPort,
  ...(chrome.storage.session === undefined
    ? {}
    : { session: chrome.storage.session as unknown as StorageAreaPort }),
});

const bootstrap: ConnectionBootstrapPort = {
  async bootstrap(input: BootstrapInput, signal: AbortSignal) {
    const settings = await chrome.storage.local.get("settings");
    const rawServerUrl = (settings.settings as { serverUrl?: unknown } | undefined)?.serverUrl;
    if (typeof rawServerUrl !== "string" || rawServerUrl.length === 0) {
      throw new Error("Configure the customer control-plane URL in extension options");
    }
    const endpoint = bootstrapEndpoint(rawServerUrl);
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
    default:
      return { success: false, error: "Unknown message type" };
  }
}

async function initialize(): Promise<void> {
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onInstalled.addListener(() => { void setBadge(false); });
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
    url.pathname = "/v1/browser-extension/dns/resolve";
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
    const managed = await chrome.storage.managed.get(["canonicalAllowedHostnames", "canonicalAllowedOrigins"]);
    const hostnames = Array.isArray(managed.canonicalAllowedHostnames) ? managed.canonicalAllowedHostnames : [];
    const origins = Array.isArray(managed.canonicalAllowedOrigins) ? managed.canonicalAllowedOrigins : [];
    managedHostnames = new Set(hostnames.flatMap((value) => typeof value === "string" && validHostname(value) ? [value.toLowerCase()] : []));
    managedOrigins = origins.flatMap((value) => typeof value === "string" && validHttpsOrigin(value) ? [new URL(value).origin] : []);
  } catch {
    managedHostnames = new Set();
    managedOrigins = [];
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
