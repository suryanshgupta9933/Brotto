import { sendCommand } from "../debugger";
import { sanitizeBrowserText, sanitizeObservationUrl } from "./redaction";

export interface PageEvent {
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface PageEventSource {
  subscribe(tabId: number, handler: (event: PageEvent) => void): () => void;
}

export interface SettlementClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SettledPageState {
  readonly url: string;
  readonly lifecycle: "loading" | "interactive" | "complete" | "frozen";
  readonly title?: string;
}

export type DialogKind = "alert" | "confirm" | "prompt" | "beforeunload";

interface SettlementDetails {
  readonly navigation: boolean;
  readonly targetCreated: boolean;
  readonly dialog?: { readonly present: true; readonly kind: DialogKind };
  readonly pageState: SettledPageState;
}

export type PageSettlementResult =
  | ({ readonly status: "settled" } & SettlementDetails)
  | ({ readonly status: "timeout"; readonly code: "SETTLEMENT_TIMEOUT" } & SettlementDetails)
  | ({ readonly status: "detached"; readonly code: "DEBUGGER_DETACHED" } & SettlementDetails)
  | ({ readonly status: "cancelled"; readonly code: "ACTION_CANCELLED" } & SettlementDetails)
  | ({ readonly status: "execution_failed"; readonly code: "ACTION_EXECUTION_FAILED"; readonly message: string } & SettlementDetails);

export interface PageSettlerOptions {
  readonly tabId: number;
  readonly getPageState: () => Promise<SettledPageState>;
  readonly events?: PageEventSource;
  readonly clock?: SettlementClock;
  /** Enables the fixed browser event domains after subscribing and before action execution. */
  readonly prepareEvents?: () => Promise<void>;
  readonly stabilityMs?: number;
  readonly timeoutMs?: number;
  readonly pageStateReadTimeoutMs?: number;
  readonly mainFrameId?: string;
  readonly initialPageState?: SettledPageState;
}

const realClock: SettlementClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class PageSettler {
  private readonly tabId: number;
  private readonly getPageState: () => Promise<SettledPageState>;
  private readonly events: PageEventSource;
  private readonly clock: SettlementClock;
  private readonly prepareEvents: () => Promise<void>;
  private readonly stabilityMs: number;
  private readonly timeoutMs: number;
  private readonly pageStateReadTimeoutMs: number;
  private readonly configuredMainFrameId?: string;
  private readonly initialPageState: SettledPageState;

  constructor(options: PageSettlerOptions) {
    this.tabId = options.tabId;
    this.getPageState = options.getPageState;
    this.events = options.events ?? new DebuggerPageEventSource();
    this.clock = options.clock ?? realClock;
    this.prepareEvents = options.prepareEvents ?? (
      options.events === undefined
        ? () => prepareDefaultEvents(this.tabId)
        : async () => {}
    );
    this.stabilityMs = boundedPositive(options.stabilityMs, 250);
    this.timeoutMs = boundedPositive(options.timeoutMs, 10_000);
    this.pageStateReadTimeoutMs = boundedPositive(options.pageStateReadTimeoutMs, 250);
    this.configuredMainFrameId = options.mainFrameId;
    this.initialPageState = options.initialPageState === undefined
      ? { url: "about:blank", lifecycle: "loading" }
      : sanitizePageState(options.initialPageState);
  }

  settle(execute: () => Promise<unknown>, signal?: AbortSignal): Promise<PageSettlementResult> {
    return new Promise((resolve) => {
      let completed = false;
      let finishing = false;
      let executionFinished = false;
      let navigation = false;
      let loadComplete = false;
      let targetCreated = false;
      let dialog: SettlementDetails["dialog"];
      let stabilityTimer: unknown;
      let timeoutTimer: unknown;
      let mainFrameId = this.configuredMainFrameId;
      let latestPageState: SettledPageState = this.initialPageState;
      let nextRefreshGeneration = 0;
      let committedRefreshGeneration = 0;
      const pendingRefreshes = new Set<Promise<void>>();

      const refreshPageState = (): Promise<void> => {
        const generation = ++nextRefreshGeneration;
        const refresh = this.safePageState().then((state) => {
          if (!completed && state !== undefined && generation > committedRefreshGeneration) {
            latestPageState = state;
            committedRefreshGeneration = generation;
          }
        });
        pendingRefreshes.add(refresh);
        void refresh.finally(() => pendingRefreshes.delete(refresh));
        return refresh;
      };
      void refreshPageState();

      let cleanupSubscription = () => {};

      const cleanup = () => {
        if (stabilityTimer !== undefined) this.clock.clearTimeout(stabilityTimer);
        if (timeoutTimer !== undefined) this.clock.clearTimeout(timeoutTimer);
        cleanupSubscription();
        signal?.removeEventListener("abort", onAbort);
      };

      const finish = async (
        status: PageSettlementResult["status"],
        extra: { code?: "SETTLEMENT_TIMEOUT" | "DEBUGGER_DETACHED" | "ACTION_EXECUTION_FAILED"; message?: string } = {},
      ) => {
        if (completed || finishing) return;
        finishing = true;
        const terminalRefresh = refreshPageState();
        await Promise.allSettled([...pendingRefreshes, terminalRefresh]);
        completed = true;
        cleanup();
        const details: SettlementDetails = {
          navigation,
          targetCreated,
          ...(dialog === undefined ? {} : { dialog }),
          pageState: latestPageState,
        };
        if (status === "timeout") resolve({ status, code: "SETTLEMENT_TIMEOUT", ...details });
        else if (status === "detached") resolve({ status, code: "DEBUGGER_DETACHED", ...details });
        else if (status === "cancelled") resolve({ status, code: "ACTION_CANCELLED", ...details });
        else if (status === "execution_failed") resolve({
          status,
          code: "ACTION_EXECUTION_FAILED",
          message: extra.message ?? "Action execution failed",
          ...details,
        });
        else resolve({ status, ...details });
      };

      const scheduleStability = () => {
        if (completed || !executionFinished || (navigation && !loadComplete)) return;
        if (stabilityTimer !== undefined) this.clock.clearTimeout(stabilityTimer);
        stabilityTimer = this.clock.setTimeout(() => { void finish("settled"); }, this.stabilityMs);
      };

      function onEvent(event: PageEvent): void {
        if (completed) return;
        void refreshPageState();
        if (event.method === "Page.frameNavigated") {
          const frame = event.params?.frame as Record<string, unknown> | undefined;
          if (frame && frame.parentId === undefined && typeof frame.id === "string") mainFrameId = frame.id;
        }
        if (isFrameEvent(event) && mainFrameId !== undefined && eventFrameId(event) !== mainFrameId) return;
        if (event.method === "DOM.documentUpdated" && mainFrameId !== undefined && event.params?.frameId !== mainFrameId) return;
        if (isNavigationStart(event)) {
          navigation = true;
          loadComplete = false;
          if (stabilityTimer !== undefined) clockClear();
          return;
        }
        if (isLoadComplete(event)) {
          loadComplete = true;
          scheduleStability();
          return;
        }
        if (event.method === "DOM.documentUpdated") {
          scheduleStability();
          return;
        }
        if (event.method === "Page.javascriptDialogOpening") {
          dialog = { present: true, kind: dialogKind(event.params?.type) };
          return;
        }
        if (event.method === "Target.targetCreated" || event.method === "Target.attachedToTarget") {
          targetCreated = true;
          return;
        }
        if (event.method === "Debugger.detached") {
          finish("detached");
        }
      }

      const onAbort = () => finish("cancelled");

      const clockClear = () => {
        if (stabilityTimer !== undefined) this.clock.clearTimeout(stabilityTimer);
        stabilityTimer = undefined;
      };

      cleanupSubscription = this.events.subscribe(this.tabId, onEvent);
      if (completed || finishing) {
        cleanupSubscription();
        return;
      }
      timeoutTimer = this.clock.setTimeout(() => { void finish("timeout"); }, this.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        finish("cancelled");
        return;
      }

      let preparation: Promise<void>;
      try {
        preparation = this.prepareEvents();
      } catch (error) {
        void finish("execution_failed", {
          message: "Page event preparation failed",
        });
        return;
      }

      void preparation
        .then(() => completed || finishing ? undefined : execute())
        .then(() => {
          executionFinished = true;
          void refreshPageState();
          scheduleStability();
        })
        .catch((error: unknown) => {
          void finish("execution_failed", {
          message: "Action execution failed",
          });
        });
    });
  }

  private async safePageState(): Promise<SettledPageState | undefined> {
    let timeout: unknown;
    try {
      const state = await Promise.race([
        this.getPageState(),
        new Promise<undefined>((resolve) => {
          timeout = this.clock.setTimeout(() => resolve(undefined), this.pageStateReadTimeoutMs);
        }),
      ]);
      return state === undefined ? undefined : sanitizePageState(state);
    } catch {
      return undefined;
    } finally {
      if (timeout !== undefined) this.clock.clearTimeout(timeout);
    }
  }
}

function sanitizePageState(state: SettledPageState): SettledPageState {
  return {
    url: sanitizeObservationUrl(state.url),
    lifecycle: state.lifecycle,
    ...(state.title === undefined ? {} : { title: sanitizeBrowserText(state.title, 512) }),
  };
}

async function prepareDefaultEvents(tabId: number): Promise<void> {
  await sendCommand(tabId, { method: "Page.enable" });
  await sendCommand(tabId, { method: "Page.setLifecycleEventsEnabled", params: { enabled: true } });
  await sendCommand(tabId, { method: "DOM.enable" });
  await sendCommand(tabId, { method: "Target.setDiscoverTargets", params: { discover: true } });
}

class DebuggerPageEventSource implements PageEventSource {
  subscribe(tabId: number, handler: (event: PageEvent) => void): () => void {
    const cdpHandler = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
      if (source.tabId === tabId) handler({ method, params: params as Record<string, unknown> | undefined });
    };
    const detachHandler = (source: chrome.debugger.Debuggee) => {
      if (source.tabId === tabId) handler({ method: "Debugger.detached" });
    };
    chrome.debugger.onEvent.addListener(cdpHandler);
    chrome.debugger.onDetach.addListener(detachHandler);
    return () => {
      chrome.debugger.onEvent.removeListener(cdpHandler);
      chrome.debugger.onDetach.removeListener(detachHandler);
    };
  }
}

function isFrameEvent(event: PageEvent): boolean {
  return event.method === "Page.frameStartedLoading" || event.method === "Page.frameStoppedLoading" ||
    event.method === "Page.frameNavigated" || event.method === "Page.navigatedWithinDocument" ||
    event.method === "Page.lifecycleEvent";
}

function eventFrameId(event: PageEvent): unknown {
  if (event.method === "Page.frameNavigated") {
    return (event.params?.frame as Record<string, unknown> | undefined)?.id;
  }
  return event.params?.frameId;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isNavigationStart(event: PageEvent): boolean {
  return event.method === "Page.frameStartedLoading" ||
    event.method === "Page.frameNavigated" ||
    event.method === "Page.navigatedWithinDocument" ||
    (event.method === "Page.lifecycleEvent" && event.params?.name === "init");
}

function isLoadComplete(event: PageEvent): boolean {
  return event.method === "Page.loadEventFired" ||
    event.method === "Page.frameStoppedLoading" ||
    (event.method === "Page.lifecycleEvent" && event.params?.name === "load");
}

function dialogKind(raw: unknown): DialogKind {
  return raw === "confirm" || raw === "prompt" || raw === "beforeunload" ? raw : "alert";
}
