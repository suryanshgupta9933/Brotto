/**
 * Brotto background service worker.
 * Thin relay: captures AX tree from the active tab, sends observations to the
 * orchestrator over WebSocket, executes actions returned by the agent.
 */

import * as dbg from "./debugger";
import { captureObservation } from "./observation";
import { getStoredModelConfig } from "./model_config";

const DEFAULT_SERVER = "http://localhost:8000";

const BADGE_ACTIVE = "#22c55e";
const BADGE_IDLE   = "#6b7280";

// ── State ───────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let activeTabId: number | null = null;
// The tab this run is driving, kept even when activeTabId is momentarily null
// (the user closed the task tab with no opener to fall back to). Server frames
// still need a target id to do anything useful, and dropping them was how a
// task_result disappeared while the user was watching the run finish.
let lastKnownTabId: number | null = null;
// One notification per run for "a frame arrived with no tab to act on".
let noTabWarned = false;
// The window the task is running in, so a notification click can bring that
// window forward rather than whatever happens to be focused at the time.
let activeWindowId: number | null = null;
let tabStack: number[] = []; // opener history for back-navigation
// When Brotto last moved focus itself, so tabs.onActivated can tell that apart
// from the user clicking away. Deliberately a timestamp and not a flag: a flag
// has to be cleared by something that can be missed, and a stuck flag would
// leave every genuine tab switch uncounted.
let lastSelfFocusAt = 0;
const SELF_FOCUS_GRACE_MS = 1500;
let sessionId: string | null = null;
let serverUrl: string = DEFAULT_SERVER;

// The orchestrator's AGENT_SECRET. Read from settings on each use rather
// than cached: a user who pastes it and immediately retries should not
// have to restart the service worker for the socket to stop being refused.
// A stable id for *this install*, so the server can key the user's blocklist
// and remembered model to something that survives a network change. The
// client IP was the only identity available and it is not one: a laptop that
// leaves Wi-Fi gets a new address, and a server in a container sees the docker
// gateway rather than the machine. Either way the user's approved sites
// silently reset. Mirrors sidepanel.js `deviceId()` — the panel and the
// service worker are separate bundles and must read the same stored value, so
// this key is written by whichever asks first.
async function deviceId(): Promise<string> {
  const stored = await chrome.storage.local.get("deviceId");
  if (typeof stored.deviceId === "string" && stored.deviceId) return stored.deviceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}

async function agentSecret(): Promise<string> {
  const stored = await chrome.storage.local.get("settings");
  const s = stored.settings as { agentSecret?: unknown } | undefined;
  return typeof s?.agentSecret === "string" ? s.agentSecret.trim() : "";
}

async function authHeaders(): Promise<Record<string, string>> {
  const secret = await agentSecret();
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

// A browser cannot set headers on a WebSocket. The subprotocol is the one
// transport that does not leak: the query string would put the secret in
// plain text in the server's access log and in Caddy's, permanently, and
// `Sec-WebSocket-Protocol` reaches neither.
//
// The server selects "brotto-v1" back rather than echoing the secret, so
// the response carries nothing either.
const RELAY_PROTOCOL = "brotto-v1";

function authedWs(url: string, secret: string): WebSocket {
  // RFC 6455 subprotocols are restricted to token characters, and a
  // pasted secret can be anything. One that does not fit is simply not
  // sent; the server then refuses, which is better than a malformed
  // handshake that fails as a network error.
  return /^[A-Za-z0-9._~-]{1,120}$/.test(secret)
    ? new WebSocket(url, [RELAY_PROTOCOL, secret])
    : new WebSocket(url);
}
// The task currently being driven, kept so a reconnect can re-send task_start
// without the panel having to be open. Module state, not storage.session:
// a service-worker restart drops the in-flight run anyway.
let currentGoal = "";
let taskTerminalEmitted = false;
let stepIndex = 0;
// ponytail: distinguish "task running, server died" from "task finished
// cleanly". cleanup() uses it to decide whether the lost task needs a
// terminal event before it reports the disconnect.
let taskInFlight = false;

// ponytail: 3 attempts at 5s flat when the server cannot be reached.
// Earlier we used exponential backoff (1s → 2s → 4s → 8s → 16s → 30s, 5
// attempts max) — that surfaced "attempt 5" to the user and made the
// failure feel unbounded. The user wants a short, predictable window:
// try 3 times at 5s intervals, then say so plainly.
const SESSION_ATTEMPTS = 3;
const SESSION_RETRY_MS = 5000;

// ponytail: Bug 5 — heartbeat. Without this, the only signal that the
// server is dead is the OS-level TCP timeout (can be minutes). With a
// 20s ping + 30s pong-deadline, the SW detects server loss within
// ~30s of the actual outage rather than waiting on the kernel.
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_DEADLINE_MS = 30_000;

function startHeartbeat(): void {
  stopHeartbeat();
  lastPongAt = Date.now();
  heartbeatTimer = setInterval(() => {
    // If the WS is closed/closing, the server is unreachable from our
    // perspective and cleanup() is already running. Skip the ping.
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastPongAt > HEARTBEAT_DEADLINE_MS) {
      console.warn("[brotto] heartbeat deadline missed — forcing reconnect");
      try { ws.close(); } catch { /* ignore */ }
      return; // onclose → cleanup
    }
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
// ponytail: monotonic observation seq per session. The server's
// obs_validator dedupes on this so duplicate WS deliveries (reconnects,
// queued messages) are dropped silently. Reset on a new session — the
// server's tracker is also freshly created on `/v1/sessions`.
let observationSeq = 0;

// Pause state — persists across SW restarts via chrome.storage.session so a
// quiet login page doesn't lose the "we're waiting for the user" signal.
let waitingForLogin = false;
let currentPrompt: "login" | "approval" | "clarify" | null = null;
let lastObservedUrl = "";

// User-side policy: persisted in chrome.storage.local (settings key) and
// refreshed in-memory on `policy_changed` from the sidepanel. Sent as
// `user_policy` on each task_start. It is the whole policy — the server has
// no operator-set floor to merge into it.
// ponytail: write-on-save only — no debounce, no reactivity layer.
// ponytail: `whitelist` and `mode` were both removed. The list is the
// whole policy and every gate on the server runs unconditionally, so there
// is nothing for a flag to switch. Keeping the type narrow to what we ship.
let userPolicy: { blacklist: string[] } = { blacklist: [] };

// ponytail: Bug 1 — SW hydration on startup. Without this, every
// extension reload resets userPolicy to defaults even though the user
// saved a blacklist. The sidepanel writes to chrome.storage
// .local on Save; we mirror it into the SW's in-memory `userPolicy`
// here so the next task_start ships the correct view.
async function hydrateUserPolicy(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("settings");
    const s = stored.settings as
      | { blacklist?: unknown; notifyBlocking?: boolean; notifyResults?: boolean }
      | undefined;
    if (!s) return;
    // Both notify unless explicitly turned off. Brotto's premise is that you
    // leave it running and come back later, so "the task ended" is the event
    // the whole thing exists to deliver.
    notifyBlocking = s.notifyBlocking !== false;
    notifyResults = s.notifyResults !== false;
    userPolicy = {
      blacklist: Array.isArray(s.blacklist)
        ? s.blacklist.filter((d): d is string => typeof d === "string")
        : [],
    };
    console.log("[brotto] userPolicy hydrated from storage:", userPolicy);
  } catch (e) {
    console.warn("[brotto] hydrateUserPolicy failed (using defaults):", e);
  }
}

const pendingClarifyResolvers  = new Map<string, (answer: string) => void>();
const pendingApprovalResolvers = new Map<string, (approved: boolean) => void>();
let reqCounter = 0;
function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${++reqCounter}`; }

/**
 * Answer a prompt whose resolver is gone — the maps are in memory and die with
 * the service worker, while the card the user is clicking was replayed from
 * panelLog. Returning success without delivering left the agent blocked on
 * `human_input_queue` forever behind a green tick.
 *
 * The `currentPrompt` gate is the whole safety argument: a human_reply that
 * arrives when the server is waiting on something *else* is consumed by that
 * prompt, which is how an answer once approved an action the user never saw.
 * currentPrompt is nulled whenever a prompt resolves and reset at the start of
 * every task, so a match means "still blocked on this kind of prompt".
 *
 * Returns false when the gate says the task has moved on — the caller then
 * reports the miss instead of sending a reply nobody is waiting for.
 * ponytail: the server has no handle on our local prompt ids, so this
 * re-answers rather than re-asking. If a server-side re-prompt ever lands,
 * swap the send for it.
 */
function deliverLostPrompt(kind: "clarify" | "approval", id: string, content: string): boolean {
  if (currentPrompt !== kind || !ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(`[brotto] ${kind} answer for ${id} has no live prompt — dropped`);
    return false;
  }
  ws.send(JSON.stringify({ type: "human_reply", content }));
  currentPrompt = null;
  void persistSession();
  console.log(`[brotto] ${kind} answer for ${id} delivered without its resolver (worker restarted)`);
  return true;
}

// ── Session persistence (survives SW suspension/restart) ────────────────────

async function persistSession(): Promise<void> {
  await chrome.storage.session.set({
    sessionId,
    activeTabId,
    serverUrl,
    waitingForLogin,
    currentPrompt,
    lastObservedUrl,
  });
}

async function restoreSession(): Promise<void> {
  const s = await chrome.storage.session.get([
    "sessionId", "activeTabId", "serverUrl", "waitingForLogin", "currentPrompt", "lastObservedUrl",
    PANEL_LOG_KEY,
  ]);
  if (typeof s.sessionId === "string") sessionId = s.sessionId;
  if (typeof s.activeTabId === "number") activeTabId = s.activeTabId;
  if (typeof s.serverUrl === "string") serverUrl = s.serverUrl;
  if (typeof s.waitingForLogin === "boolean") waitingForLogin = s.waitingForLogin;
  if (s.currentPrompt === "login" || s.currentPrompt === "approval" || s.currentPrompt === "clarify") {
    currentPrompt = s.currentPrompt;
  }
  if (typeof s.lastObservedUrl === "string") lastObservedUrl = s.lastObservedUrl;
  if (Array.isArray(s[PANEL_LOG_KEY])) panelLog = s[PANEL_LOG_KEY] as Record<string, unknown>[];
}

// ponytail: clear run state by key, not storage.session.clear(). A blanket
// clear also took panelLog with it, so a run that ended via socket close lost
// the transcript the panel replays on reopen — a run that finished and then had
// nothing to show for it. serverUrl stays: it is configuration, not run state.
const SESSION_KEYS = [
  "sessionId", "activeTabId", "waitingForLogin", "currentPrompt", "lastObservedUrl",
] as const;

async function clearSession(): Promise<void> {
  await chrome.storage.session.remove([...SESSION_KEYS]);
  sessionId = null;
  activeTabId = null;
  activeWindowId = null;
  waitingForLogin = false;
  currentPrompt = null;
  lastObservedUrl = "";
}

// Send the user's reply for whichever prompt is current and clear the wait.
function signalResume(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "human_reply", content: "resume" }));
  waitingForLogin = false;
  currentPrompt = null;
  void persistSession();
}

// ── Action execution ─────────────────────────────────────────────────────────

async function executeAction(tabId: number, action: any): Promise<void> {
  const t = action.type;
  if (t === "navigate") {
    await dbg.sendCommand(tabId, { method: "Page.navigate", params: { url: action.url } });
    await sleep(200); // brief pause for navigation to start before readyState polling
  } else if (t === "click") {
    const { x, y } = action;
    await dbg.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x, y, button: "left", clickCount: 1 } });
    await dbg.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x, y, button: "left", clickCount: 1 } });
    await sleep(200); // brief pause for click to register / navigation to start
  } else if (t === "type") {
    // One call, not one per character. A README is 1325 characters with 23
    // newlines: the loop made 1325 sequential CDP round trips, and each "\n" was
    // a literal newline *character* rather than a line break — so a markdown
    // document arrived as one run-on line with 23 dead characters in it.
    // insertText is also what a canvas-rendered editor (Google Docs) expects;
    // per-character key events reach a contenteditable and nothing else.
    await dbg.sendCommand(tabId, {
      method: "Input.insertText",
      params: { text: (action.text ?? "") as string },
    });
  } else if (t === "scroll") {
    await dbg.sendCommand(tabId, {
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: action.deltaY ?? 300 },
    });
    await sleep(300);
  } else if (t === "key") {
    // `modifiers` is CDP's bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). It was
    // being sent by the relay and dropped here, so Control+A — the clear
    // that clear_ref issues — arrived as a bare "a" and typed a letter into
    // the field instead of selecting it.
    const mods = action.modifiers ?? 0;
    const code = keyCodeFor(action.key);
    const base = {
      key: action.key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      ...(mods ? { modifiers: mods } : {}),
    };
    // A character key carries its text on the keyDown, or Chrome registers a
    // bare keypress and inserts nothing. A modified key wants rawKeyDown: the
    // shortcut is resolved by the page, not by the browser's own key handling.
    const printable = code >= 32 && code < 127;
    await dbg.sendCommand(tabId, {
      method: "Input.dispatchKeyEvent",
      params: {
        type: mods || !printable ? "rawKeyDown" : "keyDown",
        ...base,
        ...(mods || !printable ? {} : { text: action.key }),
      },
    });
    await dbg.sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...base } });
  }
}

/**
 * CDP will not interpret a key without a key code. `key: "Enter"` on its own is
 * an event Chrome can decline to act on — a key press that reports success and
 * types nothing, which is the same shape of lie as a key name it cannot parse.
 * A named key comes from the table; a single character is its own code.
 *
 * No type annotations: `scripts/test-key-dispatch.test.js` evals this span
 * directly so the key code cannot go missing unnoticed, and it is not a
 * TypeScript compiler.
 */
const KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
  Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};

function keyCodeFor(key) {
  const named = KEY_CODES[key];
  if (named !== undefined) return named;
  return [...key].length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Sidepanel notifications ──────────────────────────────────────────────────

// ponytail: the task outlives the panel — the WebSocket lives here, not in
// the side panel — so closing the panel mid-task used to leave the next open
// blank while the agent kept working. Buffering events here and replaying
// them into the panel's own handler restores the transcript for free.
// storage.session, not local: this is one run's log and must not survive a
// browser restart, same reasoning as the API key.
const PANEL_LOG_KEY = "panelLog";
const PANEL_LOG_MAX = 200;
let panelLog: Record<string, unknown>[] = [];

function logToPanel(event: Record<string, unknown>): void {
  // tab_event fires on every navigation and would push real transcript — the
  // user's question, a pending approval — out of a capped log. The panel only
  // tallies them, so keep the latest and accept an approximate count on a
  // restored panel; a wrong tab tally beats a missing task.
  if (event.type === "tab_event") panelLog = panelLog.filter((e) => e.type !== "tab_event");
  panelLog.push(event);
  if (panelLog.length > PANEL_LOG_MAX) panelLog = panelLog.slice(-PANEL_LOG_MAX);
  void chrome.storage.session.set({ [PANEL_LOG_KEY]: panelLog }).catch((e: unknown) => {
    // A log that never lands means a reopened panel has no transcript to
    // replay, which is indistinguishable from a task that never ran.
    console.warn("[brotto] panelLog write failed:", e);
  });
}

function notifyUi(event: Record<string, unknown>): void {
  logToPanel(event);
  maybeNotify(event);
  void chrome.runtime.sendMessage(event).catch((e: unknown) => {
    const detail = chrome.runtime.lastError?.message
      ?? (e instanceof Error ? e.message : String(e));
    // A closed panel is the normal case — the run outlives the panel, which
    // is the whole reason panelLog exists. Any other failure is a delivery
    // that did not happen while someone was watching, and used to vanish.
    if (typeof detail === "string" && detail.includes("Receiving end does not exist")) return;
    console.error("[brotto] panel delivery failed for", event.type, detail);
  });
}

// The session id is minted by POST /v1/sessions, which runs inside
// startRelay — after the panel has already logged task_started. Patch the
// logged event in place rather than emitting a second one for the panel to
// dedupe; without it the run has no way to name the transcript to fetch.
function attachSessionIdToPanelLog(id: string): void {
  for (let i = panelLog.length - 1; i >= 0; i--) {
    if (panelLog[i].type !== "task_started") continue;
    if (!panelLog[i].session_id) {
      panelLog[i].session_id = id;
      void chrome.storage.session.set({ [PANEL_LOG_KEY]: panelLog }).catch(() => undefined);
    }
    break;
  }
  // The stored log is not enough. logToPanel only writes storage — it does
  // not broadcast — so the panel that started this run never sees the
  // task_started event and would carry session_id: null into the history
  // index, leaving the row with no transcript to fetch. One targeted
  // message, carrying no task content, so nothing re-renders.
  void chrome.runtime.sendMessage({ type: "session_bound", session_id: id })
    .catch(() => undefined);
}

// ── OS notifications ────────────────────────────────────────────────────────
// A task can sit blocked on an approval or a login for as long as the user
// ignores it, and the only thing saying so is a panel they have to remember
// to open. The panel's keep-alive port already tells us whether it is open,
// so we only speak up when nobody is watching.
//
// ponytail: chrome.sidePanel.open() is NOT called from a notification click.
// It requires a user gesture and a notification click is not a documented
// one — chromium bug 40929586 reproduces exactly this and is still open.
// Notification *buttons* have no such limit, which is why approvals are
// answerable from the notification and everything else just clears.

let panelConnected = false;
// Whether the open panel is actually being looked at. Distinct from
// panelConnected: Brotto is meant to be left open while the user works in
// another app, and a result landing on an unattended panel is exactly the one
// worth announcing. Defaults true until the panel reports, so a cold service
// worker treats "connected" as "watched" and stays quiet rather than guessing.
let panelWatching = true;
let notifyBlocking = true;
let notifyResults = true;

type NotificationSpec = {
  title: string;
  message: string;
  buttons?: chrome.notifications.ButtonOptions[];
  blocking?: boolean;
};

function notify(id: string, spec: NotificationSpec): void {
  if (!chrome.notifications) return;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: spec.title,
    message: spec.message,
    priority: spec.blocking ? 2 : 1,
    // A blocked task that silently disappears after a few seconds is the exact
    // failure this feature exists to prevent.
    requireInteraction: spec.blocking === true,
    buttons: spec.buttons,
  } as chrome.notifications.NotificationOptions<true>, () => {
    // A notification that never appears is indistinguishable from one that was
    // never fired unless we say which. Chrome swallows the reason otherwise.
    const err = chrome.runtime.lastError;
    if (err) console.error("[brotto] notification failed:", id, err.message);
    else console.log("[brotto] notification shown:", id, spec.title);
  });
}

/** Fires a notification for an event the panel also renders, if warranted. */
function maybeNotify(event: Record<string, unknown>): void {
  const t = event.type as string;

  // Blocking prompts: speak up even with the panel open — the user has usually
  // wandered off precisely because the panel looks idle. Gated by the setting,
  // which until now was written on every save and read nowhere, so unchecking
  // "When Brotto is waiting for you" changed nothing at all.
  if (!notifyBlocking && (t === "approval_request" || t === "login_required" || t === "clarify_request")) {
    return;
  }
  if (t === "approval_request") {
    const id = String(event.id ?? "");
    notify(`approval:${id}`, {
      title: "Brotto needs your approval",
      message: String(event.reason || "Confirm this action to let the task continue."),
      buttons: [
        { title: "Approve" },
        { title: "Not now" },
      ],
      blocking: true,
    });
    return;
  }
  if (t === "login_required") {
    notify("login", {
      title: "Brotto is waiting for you to sign in",
      message: `Sign in on ${String(event.domain || "the site")} and Brotto will pick the task back up.`,
      blocking: true,
    });
    return;
  }
  if (t === "clarify_request") {
    notify("clarify", {
      title: "Brotto has a question",
      message: String(event.question || "It needs an answer before it can continue."),
      blocking: true,
    });
    return;
  }

  // Terminal results: only when nobody is watching. An open panel the user has
  // tabbed away from is not watching — that is the normal state for a task
  // that takes ten minutes.
  if (panelConnected && panelWatching) return;
  if (t === "task_completed" && notifyResults) {
    notify("done", {
      title: "Brotto finished",
      message: String(event.finalAnswer || event.summary || "Task complete."),
    });
    return;
  }
  if (t === "task_failed" && notifyResults) {
    notify("failed", {
      title: "Brotto stopped",
      message: String(event.summary || "The task could not be completed."),
    });
    return;
  }
  // Only the three above are gated; anything else reaching here was never a
  // candidate. Logged so "no notification appeared" has an answer in the
  // console — the default for results is off, which is otherwise invisible.
  if (t === "task_completed" || t === "task_failed") {
    console.log(
      `[brotto] no notification for ${t}: notifyResults=${notifyResults} panelConnected=${panelConnected}`,
    );
  }
}

type BadgeState = "idle" | "active" | "done";

// Clearing the badge is a *negative* signal — the user learns nothing from a
// missing "ON". On a run that finishes with the panel closed that is the only
// thing they would have seen, and an OS notification is a channel we do not
// control (Do Not Disturb swallows it silently, and there is no way to tell
// that from a create() that failed). The badge demonstrably works, so a result
// nobody is watching marks itself here instead. Cleared when the panel
// reconnects, because the panel replays panelLog and the user has then seen it.
async function setBadge(state: BadgeState): Promise<void> {
  const text = state === "active" ? "ON" : state === "done" ? "•" : "";
  const color = state === "active" ? BADGE_ACTIVE : BADGE_IDLE;
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

function setBadgeForResult(): void {
  void setBadge(panelConnected ? "idle" : "done");
}

// ── WebSocket observation sender ─────────────────────────────────────────────

async function sendObservation(tabId: number): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const obs = await captureObservation(tabId);
    ws.send(JSON.stringify({ type: "observation", seq: ++observationSeq, ...obs }));
    if (typeof obs.url === "string" && obs.url !== lastObservedUrl) {
      lastObservedUrl = obs.url;
      void persistSession();
    }
    // Keep tab bar in sync with every navigation within the active tab
    notifyUi({ type: "tab_event", event: { kind: "navigated", tabId, url: obs.url, title: obs.title } });
  } catch (e) {
    ws.send(JSON.stringify({ type: "observation_error", error: String(e) }));
  }
}

function sendObservationError(reason: string): void {
  console.warn(`[brotto] observation failed: ${reason}`);
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "observation_error", error: reason }));
}

// ── Main relay ───────────────────────────────────────────────────────────────

// ponytail: reconnect instead of dropping the run. A live task whose socket
// dies is not lost — the server holds the run in its audit document and
// picks it up at the last completed step when the same session_id comes
// back. Full jitter over a plain exponential, so a fleet of clients that all
// lost the same server doesn't retry in lockstep and knock it over again on
// the way up. Ceiling: the attempts are not rescheduled past
// RECONNECT_MAX_ATTEMPTS; past that the run ends as connection-lost.
//
// Three, not six. A socket that is not coming back is the common case when
// the server is restarting or refused the task, and six attempts is ~30s of
// "retrying" before the panel admits the run is over. Ceiling: if a real
// network blip needs more than three, raise this — the backoff is not what
// would need changing.
const RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function cancelReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

/**
 * Reconnect the live run, or report that we are out of attempts.
 *
 * Returns true when a retry is scheduled — the caller must then leave the
 * tab, the debugger session and the session id exactly as they are, since
 * the resumed run needs all three.
 */
function scheduleReconnect(): boolean {
  if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) return false;
  reconnectAttempt += 1;
  const ceiling = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1));
  const delay = Math.floor(Math.random() * ceiling);
  notifyUi({ type: "server_unreachable", attempt: reconnectAttempt, of: RECONNECT_MAX_ATTEMPTS });
  console.warn(`[brotto] socket lost mid-task — reconnect attempt ${reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS} in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startRelay(currentGoal, serverUrl, undefined, { resume: true })
      .catch((err: unknown) => {
        // A socket that was never built raises here instead of firing
        // onclose, so this is the only place that path gets a retry.
        console.warn("[brotto] reconnect attempt threw:", err);
        scheduleReconnect();
      });
  }, delay);
  return true;
}

async function startRelay(
  goal: string,
  plannerUrl: string,
  startingUrl?: string,
  opts: { resume?: boolean; continueSession?: boolean } = {},
): Promise<void> {
  serverUrl = plannerUrl;
  currentGoal = goal;
  let session_id: string;
  let wsUrl: string;

  // A crash resume and a follow-up task both continue an existing session, so
  // both reuse its id and its tab. Minting a new id here would make a
  // follow-up a second conversation; re-picking the tab could aim it at a
  // different one than the task before it was driving.
  const continues = (opts.resume || opts.continueSession) === true;
  // A session reopened from history has no attached tab — the run that owned
  // it finished long ago, and the debugger was released when it did. The tab
  // still has to be picked and attached below, so what is carried over is the
  // ID alone; that is what makes the server append to the same conversation
  // rather than start a new one. The tab-id condition below is only about
  // whether the attachment can be reused as-is.
  const keepSession = continues && sessionId !== null;
  // Attachment is an invariant that has to be re-asserted, not a fact that
  // happened once. This branch used to do nothing at all on the assumption
  // that a continuing session still had its debugger — an assumption a
  // crashed run, a closed tab, or a DevTools detour all break, and the next
  // message then inherited a tab that could not be driven.
  //
  // Falling through to the else branch is not a failure. It re-picks a tab and
  // attaches, and the session id is carried independently of the tab, so the
  // conversation survives the tab changing underneath it. The tab id never
  // reaches the server — sendObservation sends url/title/AX only — so
  // whichever tab answers the first observation simply becomes the tab the run
  // continues on.
  if (keepSession && activeTabId !== null
      && await dbg.ensureAttached(activeTabId) === "attached") {
    session_id = sessionId as string;
    wsUrl = `${serverUrl.replace(/^http/, "ws")}/ws/ext/${session_id}`;
  } else {
    // A conversation that ended cleanly leaves its debugger attached — that
    // tab is the session's, and the branch above hands it to the next task in
    // the same conversation. Reaching here means a *new* session, and
    // chrome.debugger refuses a second attach to a tab that already has one.
    if (activeTabId !== null) {
      await dbg.detachFromTab(activeTabId);
      activeTabId = null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    let tab: chrome.tabs.Tab;
    let needsNavigate = !!startingUrl;

    if (activeTab?.id && activeTab.url && /^https?:\/\//i.test(activeTab.url)) {
      tab = activeTab;
    } else {
      // Non-HTTP tab (chrome://, about:blank, etc.) — open a new one
      const initialUrl = startingUrl ?? "https://www.google.com";
      lastSelfFocusAt = Date.now();
      tab = await chrome.tabs.create({ url: initialUrl, active: true });
      await sleep(1500);
      needsNavigate = false; // already at startingUrl (or google as default)
    }

    if (!tab.id) throw new Error("No usable tab");
    activeTabId = tab.id;
    lastKnownTabId = tab.id;
    activeWindowId = tab.windowId ?? null;
    tabStack    = [];
    stepIndex   = 0;
    noTabWarned = false;
    void persistSession();

    // Re-query to get live title — the tab object from create/query may be stale
    const liveTab = await chrome.tabs.get(tab.id);
    notifyUi({ type: "tab_event", event: { kind: "focused", tabId: tab.id, url: liveTab.url ?? tab.url ?? "", title: liveTab.title ?? tab.title ?? "" } });

    await dbg.attachToTab(tab.id);
    await dbg.sendCommand(tab.id, { method: "Page.enable" });

    if (needsNavigate && startingUrl) {
      await dbg.sendCommand(tab.id, { method: "Page.navigate", params: { url: startingUrl } });
      await sleep(1500);
      notifyUi({ type: "tab_event", event: { kind: "opened", tabId: tab.id, url: startingUrl, title: startingUrl } });
    }

    // Create orchestrator session. This is the one call that fails when the
    // server is down, so the retry lives here rather than in a reconnect
    // probe: a probe's socket would be overwritten by the `new WebSocket`
    // below and never carry a task_start, so it could not serve the next task.
    // Skipped when resuming a session: the conversation already exists, and
    // POSTing would fork it into a new one carrying the same words.
    let session: { session_id: string; websocket_url: string } | null = null;
    if (keepSession) {
      session_id = sessionId as string;
      wsUrl = `${serverUrl.replace(/^http/, "ws")}/ws/ext/${session_id}`;
    } else {
      for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          notifyUi({ type: "server_unreachable", attempt, of: SESSION_ATTEMPTS });
          await sleep(SESSION_RETRY_MS);
        }
        try {
          const resp = await fetch(`${serverUrl}/v1/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: "{}",
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          session = await resp.json() as { session_id: string; websocket_url: string };
          break;
        } catch (err) {
          console.warn(`[brotto] session create attempt ${attempt}/${SESSION_ATTEMPTS} failed:`, err);
        }
      }
      if (!session) throw new Error(`Can't reach ${serverUrl} after ${SESSION_ATTEMPTS} attempts. Is the server running?`);
      session_id = session.session_id;
      sessionId = session_id;
    }
    // Monotonic per session, and the server's tracker is per session too —
    // so this resets only when a NEW session is minted. It stays reset-only
    // here, never in the reuse branch: a follow-up task shares its session
    // with the task before it, so its observations have to keep climbing or
    // the server rejects them as duplicates of ones it already accepted.
    observationSeq = 0;
    attachSessionIdToPanelLog(session_id);
    wsUrl = session.websocket_url.startsWith("ws")
      ? session.websocket_url
      : session.websocket_url.replace(/^http/, "ws");
  }

  ws = authedWs(wsUrl, await agentSecret());

  ws.onopen = async () => {
    startHeartbeat();
    // The socket is back: the backoff cycle is over.
    reconnectAttempt = 0;
    // Without this the socket is open, nothing is sent, and the run is
    // invisible: the server never receives a task_start, so it never asks for
    // an observation, so the panel shows a spinner with no task under it.
    let stored: { model_config?: unknown; api_key?: string };
    try {
      stored = await getStoredModelConfig();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("[brotto] getStoredModelConfig failed:", e);
      taskInFlight = false;
      taskTerminalEmitted = true;
      setBadgeForResult();
      try { ws?.close(); } catch { /* ignore */ }
      notifyUi({
        type: "task_failed",
        failure_reason: "START_FAILED",
        summary: `Couldn't read the saved model settings, so the task never started: ${reason}`,
      });
      notifyUi({ type: "canonical_status", status: "failed" });
      return;
    }
    const payload: Record<string, unknown> = {
      type: "task_start",
      task: goal,
      session_id,
      // Not `continues`: a follow-up and a resume share the session but do
      // opposite things with the document, and this flag is the only thing
      // the server has to tell them apart.
      resume: opts.resume === true,
      user_policy: userPolicy,
      // The user's blocklist and remembered model are stored under this key,
      // not under the peer address — see deviceId().
      device_id: await deviceId(),
    };
    if (stored.model_config) payload.model_config = stored.model_config;
    if (stored.api_key) payload.api_key = stored.api_key;
    ws!.send(JSON.stringify(payload));
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data as string) as any;
    // ponytail: fall back to the tab this run is driving rather than
    // dropping the frame. This used to `return` on a null activeTabId, which
    // threw away every server frame in that state — including task_result, so
    // a run the user was watching just vanished. Ceiling: lastKnownTabId is a
    // single id, not a tab stack; a frame needing a live debugger session on
    // a *different* tab still cannot be served.
    const tid = activeTabId ?? lastKnownTabId;
    if (activeTabId === null) {
      console.warn("[brotto] server frame with no attached tab:", msg.type);
      // Speak up only mid-run: a task_result arriving after the tab was
      // closed is a result the user is waiting for, not a problem.
      if (!noTabWarned && taskInFlight) {
        noTabWarned = true;
        notify("no-tab", {
          title: "Brotto lost track of the tab",
          message: "The tab this task was using was closed or detached, so actions on it can't run.",
          blocking: true,
        });
      }
    }

    switch (msg.type) {
      case "observe":
        if (tid === null) { sendObservationError("no tab attached"); break; }
        await sendObservation(tid);
        break;

      case "action":
        if (tid === null) {
          // Say so. An action that is skipped without a word leaves the task
          // looping on a step that will never complete.
          sendObservationError("action skipped: no tab attached");
          if (!taskTerminalEmitted) {
            taskTerminalEmitted = true;
            taskInFlight = false;
            setBadgeForResult();
            notifyUi({
              type: "task_failed",
              failure_reason: "NO_ACTIVE_TAB",
              summary: "The tab Brotto was driving was closed, so the next action can't run.",
            });
            notifyUi({ type: "canonical_status", status: "failed" });
          }
          break;
        }
        await executeAction(tid, msg.action);
        await sendObservation(tid);
        break;

      case "canonical_step":
        // ponytail: the "still working" line. Forwarded verbatim — kind is a
        // machine key and the panel owns the wording, so a line edit never
        // needs a server deploy. Unhandled until now, which is why the live
        // working bubble existed in the panel and never once appeared.
        notifyUi({ type: "canonical_step", kind: msg.kind ?? "", step: msg.step });
        break;

      case "step_progress":
        notifyUi({
          type:        "step_card",
          index:       stepIndex++,
          title:       msg.action ?? "",
          clientText:  msg.thought ?? msg.reasoning ?? "",
          reasoning:   msg.reasoning ?? "",
          result:      "",
          url:         msg.url ?? "",
          pageTitle:   "",
          actionTarget: msg.action_target ?? null,
          iconKind:    msg.action ?? "navigate",
          ts:          Date.now(),
          context:     msg.context ?? null,
        });
        notifyUi({ type: "canonical_status", status: "executing" });
        break;

      case "pong":
        // ponytail: Bug 5 — heartbeat response. Reset the deadline so the
        // next ping has a fresh 30s window. If pong stops arriving, the
        // interval callback in startHeartbeat() force-closes the WS.
        lastPongAt = Date.now();
        break;

      case "context_update":
        // ponytail: step had no external actions (e.g. scratchpad-only).
        // Still emit context so the sidepanel utilization % updates on
        // every step, not just on visible UI bubbles.
        notifyUi({
          type:    "context_update",
          context: msg.context ?? null,
        });
        break;

      case "task_result": {
        if (taskTerminalEmitted) break;
        taskTerminalEmitted = true;
        taskInFlight = false;
        setBadgeForResult();
        const r = msg.result ?? {};
        if (r.status === "completed") {
          notifyUi({ type: "task_completed", summary: r.summary ?? "", steps: stepIndex, finalAnswer: r.summary ?? "", extracted_data: r.extracted_data, timing: r.timing ?? null, cost_usd: r.cost_usd ?? null });
          notifyUi({ type: "canonical_status", status: "completed" });
        } else {
          // ponytail: field names match the sidepanel's task_failed
          // handler. Earlier payload used `code` + `message` which made
          // renderPolicyFailureCard's `message.failure_reason` lookup
          // miss, so the generic "Task failed" fallback rendered even
          // for policy_preflight. `failure_reason` and `summary` are
          // what the renderer branches on.
          notifyUi({
            type: "task_failed",
            failure_reason: r.failure_reason ?? r.status ?? "failed",
            summary: r.summary ?? "Task failed",
            timing: r.timing ?? null,
          });
          notifyUi({ type: "canonical_status", status: "failed" });
        }
        break;
      }

      case "task_error":
        if (taskTerminalEmitted) break;
        taskTerminalEmitted = true;
        taskInFlight = false;
        setBadgeForResult();
        // ponytail: failure_reason + summary field names — see the
        // matching note on the task_result handler.
        notifyUi({ type: "task_failed", failure_reason: "TASK_ERROR", summary: msg.error ?? "Unknown error" });
        notifyUi({ type: "canonical_status", status: "failed" });
        break;

      // The server sends this one directly, before it has a result to wrap
      // — a task_start it refuses to run (unknown provider, bad config). It
      // had no case here, so the frame was dropped, `taskTerminalEmitted`
      // stayed false, and the close that followed looked like a lost socket:
      // the panel showed "Server unreachable, retrying 1 of 6" against a
      // server that was alive and had already said no. Same absence, same
      // symptom, one layer in. See test-no-orphan-frames.test.js.
      case "task_failed":
        if (taskTerminalEmitted) break;
        taskTerminalEmitted = true;
        taskInFlight = false;
        setBadgeForResult();
        notifyUi({
          type: "task_failed",
          failure_reason: msg.failure_reason ?? "TASK_FAILED",
          summary: msg.summary ?? "The server could not run this task.",
        });
        notifyUi({ type: "canonical_status", status: "failed" });
        break;

      // The other terminal frame with no case: the server confirmed a cancel.
      // Same shape as the two above — drop it and the panel keeps a live clock
      // and a reconnect against a socket that closed on purpose.
      case "task_cancelled":
        if (taskTerminalEmitted) break;
        taskTerminalEmitted = true;
        taskInFlight = false;
        setBadgeForResult();
        notifyUi({ type: "task_failed", failure_reason: "CANCELLED", summary: msg.summary ?? "Task cancelled." });
        notifyUi({ type: "canonical_status", status: "failed" });
        break;

      case "ask_human": {
        const id = newId("clarify");
        pendingClarifyResolvers.set(id, (answer) => {
          ws?.send(JSON.stringify({ type: "human_reply", content: answer }));
          currentPrompt = null;
          void persistSession();
        });
        currentPrompt = "clarify";
        void persistSession();
        notifyUi({ type: "clarify_request", id, question: msg.question ?? "", reason: "" });
        break;
      }

      case "approval_required": {
        const id = newId("approval");
        pendingApprovalResolvers.set(id, (approved) => {
          ws?.send(JSON.stringify({ type: "human_reply", content: approved ? "yes" : "no" }));
          currentPrompt = null;
          void persistSession();
        });
        currentPrompt = "approval";
        void persistSession();
        notifyUi({
          type: "approval_request", id,
          reason: msg.reasoning ?? "The agent wants to perform a sensitive action.",
          action: { type: msg.action, url: msg.args?.url },
        });
        break;
      }

      case "login_required": {
        let domain = "";
        // msg.url, not msg.message: the message is the prose sentence the
        // panel shows, so new URL() on it always threw and every login wall
        // was labelled "this site".
        try { domain = new URL(msg.url ?? "").hostname; } catch { domain = "this site"; }
        waitingForLogin = true;
        currentPrompt = "login";
        void persistSession();
        notifyUi({ type: "login_required", url: msg.url ?? "", domain });
        break;
      }

      case "evaluate": {
        try {
          if (tid === null) throw new Error("no tab attached");
          const r = await dbg.sendCommand(tid, {
            method: "Runtime.evaluate",
            params: { expression: msg.expression ?? "''", returnByValue: true },
          }) as { result?: { value?: unknown } };
          ws!.send(JSON.stringify({ type: "evaluate_result", value: String(r.result?.value ?? "") }));
        } catch (e) {
          ws!.send(JSON.stringify({ type: "evaluate_result", value: "", error: String(e) }));
        }
        break;
      }

      // Backs password redaction on the server. The server waits 2s for this
      // and treats silence as failure, so it is answered even when the CDP
      // call cannot be made — {} is its "no attributes" answer, and it falls
      // back to the accessible-name check.
      case "get_attributes": {
        let attributes: Record<string, string> = {};
        try {
          if (tid === null) throw new Error("no tab attached");
          const r = await dbg.sendCommand(tid, {
            method: "DOM.getAttributes",
            params: { backendNodeId: msg.backend_node_id },
          }) as { attributes?: unknown };
          // CDP replies with a flat [name, value, name, value, ...] array.
          const flat = Array.isArray(r.attributes) ? r.attributes : [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            if (typeof flat[i] === "string") attributes[flat[i]] = String(flat[i + 1] ?? "");
          }
        } catch (e) {
          // Node is gone, the tab moved, or the debugger is detached. The
          // server's name check covers it — log so the cause is not invisible.
          console.warn("[brotto] get_attributes failed for", msg.ref, e);
        }
        try {
          ws!.send(JSON.stringify({
            type: "get_attributes_result",
            ref: msg.ref,
            attributes,
          }));
        } catch (e) {
          console.error("[brotto] could not send get_attributes_result:", e);
        }
        break;
      }

      default:
        // A server message this build predates. Silent here is how a protocol
        // change ships and nobody finds out for a week.
        console.debug("[brotto] ignoring unknown server message:", msg.type);
        break;
    }
  };

  ws.onerror = (ev: Event) => {
    const detail = (ev as ErrorEvent).message || "WebSocket connection error";
    console.error("[brotto] websocket error:", detail, ev);
    // A failed reconnect attempt is not a failed task. End-of-run lives on
    // the close handler, which owns the retry; failing the run here would
    // kill the task over a blip the backoff was built to ride out.
    if (reconnectAttempt > 0) return;
    if (!taskTerminalEmitted) {
      taskTerminalEmitted = true;
      taskInFlight = false;
      void setBadge("idle");
      // ponytail: failure_reason + summary field names — see the
      // matching note on the task_result handler.
      notifyUi({ type: "task_failed", failure_reason: "WS_ERROR", summary: `WebSocket connection error: ${detail}` });
      notifyUi({ type: "canonical_status", status: "failed" });
    }
  };

  ws.onclose = () => {
    // A run that is still live when its socket dies is the reconnect case,
    // not a lost task. `taskTerminalEmitted` is set by stopRelay and by the
    // cancel handler BEFORE either closes the socket, so a stopped or
    // cancelled task never reaches here — a cancelled task must not come
    // back, and the backoff is the thing that would bring it back.
    if (taskInFlight && !taskTerminalEmitted && scheduleReconnect()) return;
    void cleanup();
  };
}

async function cleanup(): Promise<void> {
  const tid = activeTabId;
  // The server runs one task per socket and closes it when that task ends, so
  // a close that arrives *after* the terminal frame is the run finishing, not
  // a failure. A close while the run is still live did lose it, and says so
  // with a connection-lost reason before the disconnected event — the harness
  // is stuck waiting on human_input_queue and can't recover from a dead WS,
  // so the only thing to do from here is mark the task failed so the UI stops
  // the timer and shows the bubble. Reconnect attempts run in the background
  // regardless; they're for the NEXT task.
  const lost = taskInFlight && !taskTerminalEmitted;
  if (lost) {
    taskTerminalEmitted = true;
    taskInFlight = false;
    void setBadge("idle");
    notifyUi({
      type: "task_failed",
      failure_reason: "CONNECTION_LOST",
      summary: "Lost connection to the Brotto server. The task can't continue — start a new task once the server is back.",
    });
    notifyUi({ type: "canonical_status", status: "failed" });
  }
  // ponytail: Bug 3 — emit a disconnected event so the sidepanel can
  // update its connection pill. Sent AFTER task_failed so the
  // task_failed handler runs first and the pill update doesn't race
  // with the terminal phase set.
  notifyUi({ type: "disconnected", reason: "ws_closed" });
  // ponytail: Bug 5 — stop the heartbeat before tearing down ws. The
  // heartbeat interval reads `ws.readyState` and would be a no-op anyway,
  // but explicit stop is easier to reason about.
  stopHeartbeat();
  ws = null;
  // Only a lost run gives the tab back. On a clean finish the tab and the
  // session id *are* the conversation — releasing them here is what made
  // every second message start a new one, because the follow-up found
  // nothing left to continue.
  if (lost) {
    activeTabId = null;
    tabStack = [];
    sessionId = null;
    void chrome.storage.session.remove([...SESSION_KEYS]);
    if (tid !== null) void dbg.detachFromTab(tid).catch(() => undefined);
  }
  waitingForLogin = false;
  currentPrompt = null;
  lastObservedUrl = "";
  void setBadge("idle");
}

function stopRelay(): void {
  taskTerminalEmitted = true;
  // A pending reconnect is a run about to come back from the dead. The user
  // just said stop; drop it on the floor.
  cancelReconnect();
  ws?.close();
  ws = null;
  // Only the run ends here. The tab, the session id and the attached
  // debugger are the *conversation* — releasing them is what made a message
  // after a cancel start a new conversation, because the follow-up found
  // nothing left to continue. A genuinely new conversation detaches in
  // startRelay's mint branch, so nothing is leaked by leaving it on.
  waitingForLogin = false;
  currentPrompt = null;
}

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {

        case "run_local_task": {
          if (ws !== null && ws.readyState === WebSocket.OPEN) {
            sendResponse({ success: false, error: "A task is already running" });
            return;
          }
          // A new task supersedes any reconnect still in backoff — otherwise
          // that timer fires mid-run and re-connects the *old* session over
          // the new one.
          cancelReconnect();
          taskTerminalEmitted = false;
          // Per-run, and a follow-up is a new run inside an existing session —
          // the mint branch resets these for a new *session*, which a follow-up
          // never reaches. The step count in particular is what the history
          // row shows, and a conversation's second task reporting its first's
          // steps is a number about a run that is over.
          stepIndex = 0;
          noTabWarned = false;
          // ponytail: mark a task as in-flight so cleanup() knows the lost
          // socket cost the user a running task, not a clean ending.
          taskInFlight = true;
          pendingClarifyResolvers.clear();
          pendingApprovalResolvers.clear();
          waitingForLogin = false;
          currentPrompt = null;
          lastObservedUrl = "";
          panelLog = [];

          const goal = String(message.task ?? "").trim();
          if (!goal) { sendResponse({ success: false, error: "task is empty" }); return; }

          // A session the panel picked back out of history. Adopting it here
          // is what makes the follow-up append to THAT conversation on the
          // server; without it the panel would show the old thread and the
          // run would land in a different one. Only honoured when the panel
          // also asked to continue, so a stale id can never resurrect a
          // session the user has moved on from.
          if (message.continueSession === true && typeof message.session_id === "string" && message.session_id) {
            sessionId = message.session_id;
          }

          // Logged, not broadcast: the live panel already renders the user's
          // own message before it sends. This only exists so a reopened panel
          // can put the question back at the top of the transcript, resume
          // the run's clock, and recognise a run it has already recorded.
          // `startedAt` is that anchor: without it a reopened panel has no
          // start time, so ACTIVE reads 0.0s for the rest of the run and
          // every reopen writes a duplicate history row.
          logToPanel({ type: "task_started", task: goal, startedAt: Date.now(), session_id: sessionId });

          const stored = await chrome.storage.local.get("settings");
          const plannerUrl: string =
            (message.plannerUrl as string | undefined) ||
            (stored.settings as any)?.serverUrl ||
            DEFAULT_SERVER;

          void setBadge("active");
          notifyUi({ type: "canonical_status", status: "executing" });

          startRelay(goal, plannerUrl, message.startingUrl as string | undefined, {
            continueSession: message.continueSession === true,
          })
            .catch((err: unknown) => {
              void setBadge("idle");
              taskInFlight = false;
              if (!taskTerminalEmitted) {
                taskTerminalEmitted = true;
                // ponytail: failure_reason + summary field names — see
                // the matching note on the task_result handler.
                notifyUi({ type: "task_failed", failure_reason: "START_FAILED", summary: err instanceof Error ? err.message : String(err) });
                notifyUi({ type: "canonical_status", status: "failed" });
              }
            });

          sendResponse({ success: true });
          break;
        }

        case "get_panel_log": {
          sendResponse({ success: true, events: panelLog });
          break;
        }

        case "cancel_local_task": {
          // Say goodbye before the socket goes. The server sees a closed
          // socket for a cancel and for the server dying, and only one of
          // those two may be resumed — so the intent travels as a frame
          // rather than being inferred from the disconnect.
          if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: "cancel" })); } catch { /* ignore */ }
          }
          taskTerminalEmitted = true;
          taskInFlight = false;
          stopRelay();
          notifyUi({ type: "canonical_status", status: "cancelled" });
          sendResponse({ success: true });
          break;
        }

        case "user_disconnect": {
          taskTerminalEmitted = true;
          taskInFlight = false;
          if (ws) {
            try { ws.close(); } catch { /* ignore */ }
          }
          ws = null;
          notifyUi({ type: "canonical_status", status: "disconnected" });
          sendResponse({ success: true });
          break;
        }

        case "local_login_complete": {
          // Manual override for the login pause. The server's harness is
          // blocked on human_input_queue; we push "resume" to unblock it.
          // The next step then re-runs check_login_page on the server.
          signalResume();
          sendResponse({ success: true });
          break;
        }

        case "local_login_skip": {
          taskInFlight = false;
          stopRelay();
          sendResponse({ success: true });
          break;
        }

        case "submit_clarification": {
          const id = String(message.id);
          const res = pendingClarifyResolvers.get(id);
          if (res) { pendingClarifyResolvers.delete(id); res(String(message.answer ?? "")); }
          else if (!deliverLostPrompt("clarify", id, String(message.answer ?? ""))) {
            // Used to answer {success:true} on a miss: the answer was dropped
            // and the user was told it landed, while the agent stayed blocked.
            sendResponse({ success: false, error: "That question is no longer waiting — the task has moved on." });
            return;
          }
          sendResponse({ success: true });
          break;
        }

        case "submit_approval": {
          const id = String(message.id);
          const res = pendingApprovalResolvers.get(id);
          if (!res) {
            // The resolver map is in memory only and does not survive service
            // worker eviction, so a card replayed from panelLog can name a
            // prompt nobody is waiting on any more. Reporting success here
            // removed the card and showed a green tick for an agent that is
            // still blocked. Failure sends the panel back through reArmApproval.
            if (!deliverLostPrompt("approval", id, message.approved === true ? "yes" : "no")) {
              sendResponse({ success: false, error: "That approval is no longer waiting — the task has moved on." });
              return;
            }
            notifyUi({ type: "approval_resolved", id, approved: message.approved === true });
            sendResponse({ success: true });
            break;
          }
          pendingApprovalResolvers.delete(id);
          res(message.approved === true);
          sendResponse({ success: true });
          break;
        }

        case "reset_session": {
          stopRelay();
          taskTerminalEmitted = false;
          pendingClarifyResolvers.clear();
          pendingApprovalResolvers.clear();
          sendResponse({ success: true });
          break;
        }

        case "get_connection_status":
          sendResponse({ success: true, status: { connected: ws?.readyState === WebSocket.OPEN, session_id: sessionId } });
          break;

        case "policy_changed": {
          // ponytail: write-on-save. The sidepanel already wrote the
          // full settings object to chrome.storage.local; here we just
          // update the in-memory mirror used on the next task_start.
          const s = message.settings as
            | { blacklist?: string[]; notifyBlocking?: boolean; notifyResults?: boolean }
            | undefined;
          if (s) {
            userPolicy = {
              blacklist: Array.isArray(s.blacklist) ? s.blacklist : [],
            };
            // Notification prefs ride along on Save rather than growing their
            // own message type — they live in the same settings object.
            notifyBlocking = s.notifyBlocking !== false;
            notifyResults = s.notifyResults !== false;
          }
          sendResponse({ success: true });
          break;
        }

        case "send_to_server": {
          // ponytail: sidepanel wants to push a message over the active
          // WS to the orchestrator (e.g. policy_acknowledged, steer). Used
          // when there's no task in flight but the user did something the
          // server should know about.
          const payload = message.payload;
          // Honest success. This used to answer {success:true} whether or
          // not the socket was open, so a steer sent against a dropped
          // connection looked delivered and the panel cleared the composer
          // over a message the agent never saw. The existing callers ignore
          // the response, so this is not a contract change for them.
          if (!payload) {
            sendResponse({ success: false, error: "nothing to send" });
            break;
          }
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            sendResponse({ success: false, error: "not connected to the server" });
            break;
          }
          ws.send(JSON.stringify(payload));
          sendResponse({ success: true });
          break;
        }

        case "get_user_policy": {
          sendResponse({ success: true, userPolicy });
          break;
        }

        case "get_context": {
          // ponytail: sidepanel asks the backend (via the SW so we
          // proxy through the configured serverUrl) for the model's
          // context window. Backend returns {model, window}; the
          // harness's per-step messages carry the actual usage.
          try {
            const r = await fetch(`${serverUrl}/context`);
            if (!r.ok) {
              sendResponse({ success: false, error: `HTTP ${r.status}` });
              return;
            }
            const data = await r.json();
            sendResponse({ success: true, context: data });
          } catch (e) {
            sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
          }
          break;
        }

        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // keep channel open for async response
});

// ── Tab lifecycle — follow new tabs opened from the active tab ───────────────

chrome.tabs.onCreated.addListener((tab) => {
  if (activeTabId === null || !tab.id) return;
  if (tab.openerTabId !== activeTabId) return; // not from our tab

  const newTabId = tab.id;
  const oldTabId = activeTabId;

  tabStack.push(oldTabId);
  activeTabId = newTabId;
  lastKnownTabId = newTabId;

  sleep(400).then(async () => {
    try {
      await dbg.detachFromTab(oldTabId).catch(() => undefined);
      await dbg.attachToTab(newTabId);
      await dbg.sendCommand(newTabId, { method: "Page.enable" });
      notifyUi({ type: "tab_event", event: { kind: "opened", tabId: newTabId, url: tab.url ?? "", title: tab.title ?? "" } });
    } catch (e) {
      console.error("[brotto] failed to attach to new tab:", e);
      activeTabId = oldTabId; // rollback
      tabStack.pop();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== activeTabId) return;
  // Active tab closed — fall back to opener if available
  const fallback = tabStack.pop() ?? null;
  activeTabId = fallback;
  if (fallback !== null) {
    dbg.attachToTab(fallback).then(() =>
      dbg.sendCommand(fallback, { method: "Page.enable" })
    ).catch(() => undefined);
  }
});

// A chrome.debugger attachment ends on its own, and Chrome documents exactly
// two reasons: the tab was closed, or DevTools was invoked for it. The first
// is onRemoved's job. The second was silent until now, so the run kept
// believing it had a debugger — no CDP events, so chrome.webNavigation
// never reported the click, so the server sat 30s waiting on an observation
// that could not arrive, and then failed on an empty page in a way that
// named the model rather than the cause. Swapping tabs does NOT do this;
// there is no focus-related detach reason and no onActivated listener.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== activeTabId) return;
  if (reason === "target_closed" || !taskInFlight) return;
  console.warn("[brotto] debugger detached from tab", source.tabId, reason);
  notify("debugger-detached", {
    title: "Brotto lost control of the tab",
    message: "Chrome ended the debugging session — opening DevTools on the tab does that. Close DevTools and Brotto will pick the task back up.",
    blocking: true,
  });
});

// Whether the user is looking at what Brotto is doing, which is NOT the same
// question as whether the panel has OS focus. The side panel is docked to the
// window, not the tab, so it stays focused while the user switches to another
// tab in that same window — Brotto reads "watched" and swallows the result
// notification for a task that just finished. The signal that actually tracks
// the user is whether the tab being driven is the one on screen.
//
// Notification only. This must never touch the debugger: switching tabs does
// not end a chrome.debugger attachment, and wiring it up that way would trade
// a cosmetic bug for a task that dies every time someone looks at YouTube.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (activeTabId === null) return;
  // Brotto focuses tabs on the user's behalf (opening one when the active tab
  // is not a real page). That fires this same event, and reading it as the
  // user looking away would mark them gone at the moment we just gave them
  // something to look at.
  if (Date.now() - lastSelfFocusAt < SELF_FOCUS_GRACE_MS) return;
  panelWatching = tabId === activeTabId;
  void chrome.runtime.sendMessage({ type: "watching_changed", watching: panelWatching })
    .catch(() => undefined);
});

// Auto-resume after manual login: when the active tab's URL actually
// changes (top-frame navigation or pushState / title-only update), unblock
// the server's human_input_queue with "resume". The server then re-runs
// check_login_page — if we're still on a login wall, it re-prompts; else
// the agent proceeds. Gate on URL change so SPA title flicker / form
// mutations don't spuriously resume.
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (activeTabId === null || _tabId !== activeTabId) return;
  if (!waitingForLogin) return;
  const newUrl = change.url ?? tab.url ?? "";
  if (newUrl && newUrl !== lastObservedUrl) {
    signalResume();
  }
});

// ── Initialise ───────────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  // Restore any in-flight pause state from the previous SW lifetime.
  await restoreSession();
  // ponytail: Bug 1 — re-hydrate userPolicy from chrome.storage.local
  // so the next task_start ships the saved view, not defaults. Done
  // before restoreSession would otherwise ship empty task_start
  // metadata.
  await hydrateUserPolicy();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "brotto-sidepanel") return;
    // The panel's keep-alive port is also its liveness signal: a closed panel
    // disconnects the port, which is what lets a finished task notify.
    panelConnected = true;
    // The panel replays panelLog on open, so a result that landed while it was
    // closed is on screen now. Leaving the unread marker up would claim there
    // is something unseen, which at that point is false.
    void setBadge("idle");
    // Deliberately not `panelWatching = true` here. That would undo the
    // tab-derived value from tabs.onActivated: a panel reopened while the user
    // is on a different tab would declare them watching anyway. The declared
    // default of true already covers the case where no activation has been
    // seen yet, which is exactly the case where the panel really is on screen.
    port.onMessage.addListener((msg: { watching?: unknown }) => {
      if (typeof msg?.watching === "boolean") panelWatching = msg.watching;
    });
    port.onDisconnect.addListener(() => { panelConnected = false; });
  });

  // Approve / Not now, answered from the OS notification without opening the
  // panel. Routed through the same resolver map the panel's own buttons use,
  // so there is one way to answer an approval rather than two.
  chrome.notifications?.onButtonClicked.addListener((id, index) => {
    if (!id.startsWith("approval:")) return;
    const promptId = id.slice("approval:".length);
    const resolve = pendingApprovalResolvers.get(promptId);
    if (!resolve) {
      // The task moved on while the notification sat there. Clearing it in
      // silence was the worst option: the user watched a button they had
      // already pressed disappear, with no way to tell an answer from a
      // timeout — and silence here reads as "approved". Updating the text in
      // place works because approval notifications set requireInteraction, so
      // this is the one path where an honest failure can actually be shown.
      void chrome.notifications.update(id, {
        message: "This approval is no longer waiting — the task has moved on.",
      });
      return;
    }
    // Delete before resolving, exactly as submit_approval does. Leaving the
    // entry live meant the in-panel card could resolve it a second time, and
    // that second human_reply is consumed by the *next* prompt — approving an
    // action the user never saw.
    pendingApprovalResolvers.delete(promptId);
    resolve(index === 0);
    // The panel still shows the card; it was never told. Without this it
    // sits on "Approval needed" for a prompt that is already answered.
    notifyUi({ type: "approval_resolved", id: promptId, approved: index === 0 });
    void chrome.notifications.clear(id);
  });

  // Deliberately does NOT call chrome.sidePanel.open() — see the note above
  // maybeNotify. It needs a user gesture that a notification click does not
  // provide. Focusing the window has no such restriction, and a click on a
  // notification is unambiguously "I am coming back to this" — clearing it
  // and leaving the user where they were made the notification a dead end.
  chrome.notifications?.onClicked.addListener((id) => {
    void chrome.notifications.clear(id);
    if (activeWindowId !== null) {
      void chrome.windows.update(activeWindowId, { focused: true }).catch(() => undefined);
    }
  });

  chrome.runtime.onInstalled.addListener((details) => {
    void setBadge("idle");
    // First run points the panel at the setup wizard; the wizard's own "Start"
    // points it back at sidepanel.html. reason === 'install' only, so an
    // update never drops an existing user back into setup.
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (details.reason === "install") {
      void chrome.storage.local.get("settings").then((s) => {
        if (!s.settings?.onboarded) chrome.sidePanel.setOptions({ path: "welcome.html" });
      });
    }
  });

  // Auto-resume after manual login: when the active tab navigates, push a
  // fresh observation AND unblock the server's login wait. Top-frame only —
  // iframes would fire too and add noise.
  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return;
      if (activeTabId === null || details.tabId !== activeTabId) return;
      void sendObservation(details.tabId);
      const url = details.url ?? "";
      if (waitingForLogin && url && url !== lastObservedUrl) {
        signalResume();
      }
    });
  }

  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch { /* Firefox/older Chrome */ }
}

void initialize();
