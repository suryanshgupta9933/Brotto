(() => {
  // src/debugger.ts
  var DEBUGGER_TARGETS = /* @__PURE__ */ new Map();
  async function attachToTab(tabId) {
    const debuggerUrl = `ws://localhost/${tabId}`;
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", async () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(`Failed to attach: ${lastError.message}`));
          return;
        }
        const session = {
          sessionId: `${tabId}-${Date.now()}`,
          tabId,
          attachedAt: Date.now(),
          debuggerUrl
        };
        DEBUGGER_TARGETS.set(session.sessionId, session);
        resolve(session);
      });
    });
  }
  async function detachFromTab(tabId) {
    return new Promise((resolve, reject) => {
      chrome.debugger.detach({ tabId }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(`Detach warning: ${lastError.message}`);
        }
        for (const [sessionId2, session] of DEBUGGER_TARGETS.entries()) {
          if (session.tabId === tabId) {
            DEBUGGER_TARGETS.delete(sessionId2);
          }
        }
        resolve();
      });
    });
  }
  async function sendCommand(tabId, command) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, command.method, command.params, (result, error) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(`Command failed: ${lastError.message}`));
          return;
        }
        if (error) {
          reject(new Error(`Command error: ${error}`));
          return;
        }
        resolve(result);
      });
    });
  }

  // src/background.ts
  var DEFAULT_SERVER = "http://localhost:8000";
  var KEEP_ROLES = /* @__PURE__ */ new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "menuitem",
    "tab",
    "option",
    "switch",
    "slider",
    "spinbutton",
    "gridcell",
    "heading",
    "dialog",
    "alert",
    "listitem"
  ]);
  var BADGE_ACTIVE = "#22c55e";
  var BADGE_IDLE = "#6b7280";
  var ws = null;
  var activeTabId = null;
  var tabStack = [];
  var sessionId = null;
  var taskTerminalEmitted = false;
  var stepIndex = 0;
  var pendingClarifyResolvers = /* @__PURE__ */ new Map();
  var pendingApprovalResolvers = /* @__PURE__ */ new Map();
  var reqCounter = 0;
  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${++reqCounter}`;
  }
  async function extractAx(tabId) {
    await sendCommand(tabId, { method: "Accessibility.enable" });
    const raw = await sendCommand(tabId, {
      method: "Accessibility.getFullAXTree"
    });
    const nodes = raw.nodes ?? [];
    const targets = [];
    for (const node of nodes) {
      if (node.ignored) continue;
      const role = (node.role?.value ?? "").toLowerCase();
      if (!KEEP_ROLES.has(role)) continue;
      const name = node.name?.value?.trim() ?? "";
      const value = node.value?.value ?? void 0;
      const backendId = node.backendDOMNodeId;
      let x, y;
      if (backendId) {
        try {
          const box = await sendCommand(tabId, {
            method: "DOM.getBoxModel",
            params: { backendNodeId: backendId }
          });
          const c = box.model?.content;
          if (c && c.length >= 4) {
            x = Math.round((c[0] + c[2]) / 2);
            y = Math.round((c[1] + c[3]) / 2);
          }
        } catch {
        }
      }
      targets.push({
        ref: node.nodeId,
        role,
        name,
        ...value !== void 0 ? { value } : {},
        ...x !== void 0 ? { x, y } : {}
      });
    }
    await sendCommand(tabId, { method: "Accessibility.disable" });
    return targets;
  }
  async function captureObservation(tabId) {
    await waitForPageReady(tabId);
    const ps = await sendCommand(tabId, {
      method: "Runtime.evaluate",
      params: { expression: "({url:location.href,title:document.title})", returnByValue: true }
    });
    const { url = "", title = "" } = ps.result?.value ?? {};
    let axTargets = await extractAx(tabId);
    for (let i = 0; i < 4 && axTargets.length < 3; i++) {
      await sleep(800 * (i + 1));
      axTargets = await extractAx(tabId);
    }
    return { url, title, axTargets };
  }
  async function executeAction(tabId, action) {
    const t = action.type;
    if (t === "navigate") {
      await sendCommand(tabId, { method: "Page.navigate", params: { url: action.url } });
      await sleep(200);
    } else if (t === "click") {
      const { x, y } = action;
      await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x, y, button: "left", clickCount: 1 } });
      await sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x, y, button: "left", clickCount: 1 } });
      await sleep(200);
    } else if (t === "type") {
      for (const ch of action.text ?? "") {
        await sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "char", text: ch } });
      }
    } else if (t === "scroll") {
      await sendCommand(tabId, {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: action.deltaY ?? 300 }
      });
      await sleep(300);
    } else if (t === "key") {
      await sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: action.key } });
      await sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: action.key } });
    }
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitForPageReady(tabId, maxWaitMs = 1e4) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      try {
        const r = await sendCommand(tabId, {
          method: "Runtime.evaluate",
          params: { expression: "document.readyState", returnByValue: true }
        });
        if (r.result?.value === "complete") {
          await sleep(400);
          return;
        }
      } catch {
      }
      await sleep(300);
    }
  }
  function notifyUi(event) {
    void chrome.runtime.sendMessage(event).catch(() => void 0);
  }
  async function setBadge(active) {
    await chrome.action.setBadgeBackgroundColor({ color: active ? BADGE_ACTIVE : BADGE_IDLE });
    await chrome.action.setBadgeText({ text: active ? "ON" : "" });
  }
  async function sendObservation(tabId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const obs = await captureObservation(tabId);
      ws.send(JSON.stringify({ type: "observation", ...obs }));
      notifyUi({ type: "tab_event", event: { kind: "navigated", tabId, url: obs.url, title: obs.title } });
    } catch (e) {
      ws.send(JSON.stringify({ type: "observation_error", error: String(e) }));
    }
  }
  async function startRelay(goal, serverUrl, startingUrl) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    let tab;
    let needsNavigate = !!startingUrl;
    if (activeTab?.id && activeTab.url && /^https?:\/\//i.test(activeTab.url)) {
      tab = activeTab;
    } else {
      const initialUrl = startingUrl ?? "https://www.google.com";
      tab = await chrome.tabs.create({ url: initialUrl, active: true });
      await sleep(1500);
      needsNavigate = false;
    }
    if (!tab.id) throw new Error("No usable tab");
    activeTabId = tab.id;
    tabStack = [];
    stepIndex = 0;
    const liveTab = await chrome.tabs.get(tab.id);
    notifyUi({ type: "tab_event", event: { kind: "focused", tabId: tab.id, url: liveTab.url ?? tab.url ?? "", title: liveTab.title ?? tab.title ?? "" } });
    await attachToTab(tab.id);
    await sendCommand(tab.id, { method: "Page.enable" });
    if (needsNavigate && startingUrl) {
      await sendCommand(tab.id, { method: "Page.navigate", params: { url: startingUrl } });
      await sleep(1500);
      notifyUi({ type: "tab_event", event: { kind: "opened", tabId: tab.id, url: startingUrl, title: startingUrl } });
    }
    const resp = await fetch(`${serverUrl}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (!resp.ok) throw new Error(`Session create failed: HTTP ${resp.status}`);
    const { session_id, websocket_url } = await resp.json();
    sessionId = session_id;
    const wsUrl = websocket_url.startsWith("ws") ? websocket_url : websocket_url.replace(/^http/, "ws");
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "task_start", task: goal, session_id }));
    };
    ws.onmessage = async (ev) => {
      if (!activeTabId) return;
      const msg = JSON.parse(ev.data);
      const tid = activeTabId;
      switch (msg.type) {
        case "observe":
          await sendObservation(tid);
          break;
        case "action":
          await executeAction(tid, msg.action);
          await sendObservation(tid);
          break;
        case "step_progress":
          notifyUi({
            type: "step_card",
            index: stepIndex++,
            title: msg.action ?? "",
            clientText: msg.thought ?? msg.reasoning ?? "",
            reasoning: msg.reasoning ?? "",
            result: "",
            url: msg.url ?? "",
            pageTitle: "",
            actionTarget: msg.action_target ?? null,
            iconKind: msg.action ?? "navigate",
            ts: Date.now()
          });
          notifyUi({ type: "canonical_status", status: "executing" });
          break;
        case "task_result": {
          if (taskTerminalEmitted) break;
          taskTerminalEmitted = true;
          void setBadge(false);
          const r = msg.result ?? {};
          if (r.status === "completed") {
            notifyUi({ type: "task_completed", summary: r.summary ?? "", steps: stepIndex, finalAnswer: r.summary ?? "" });
            notifyUi({ type: "canonical_status", status: "completed" });
          } else {
            notifyUi({ type: "task_failed", code: r.failure_reason ?? r.status ?? "failed", message: r.summary ?? "Task failed" });
            notifyUi({ type: "canonical_status", status: "failed" });
          }
          break;
        }
        case "task_error":
          if (taskTerminalEmitted) break;
          taskTerminalEmitted = true;
          void setBadge(false);
          notifyUi({ type: "task_failed", code: "TASK_ERROR", message: msg.error ?? "Unknown error" });
          notifyUi({ type: "canonical_status", status: "failed" });
          break;
        case "ask_human": {
          const id = newId("clarify");
          pendingClarifyResolvers.set(id, (answer) => {
            ws?.send(JSON.stringify({ type: "human_reply", content: answer }));
          });
          notifyUi({ type: "clarify_request", id, question: msg.question ?? "", reason: "" });
          break;
        }
        case "approval_required": {
          const id = newId("approval");
          pendingApprovalResolvers.set(id, (approved) => {
            ws?.send(JSON.stringify({ type: "human_reply", content: approved ? "yes" : "no" }));
          });
          notifyUi({
            type: "approval_request",
            id,
            reason: msg.reasoning ?? "The agent wants to perform a sensitive action.",
            action: { type: msg.action, url: msg.args?.url }
          });
          break;
        }
        case "login_required": {
          let domain = "";
          try {
            domain = new URL(msg.message ?? "").hostname;
          } catch {
            domain = "this site";
          }
          notifyUi({ type: "login_required", url: msg.message ?? "", domain });
          break;
        }
        case "stagnation_warning":
          notifyUi({ type: "stagnation_warning", reason: msg.reason ?? "" });
          break;
        case "evaluate": {
          try {
            const r = await sendCommand(tid, {
              method: "Runtime.evaluate",
              params: { expression: msg.expression ?? "''", returnByValue: true }
            });
            ws.send(JSON.stringify({ type: "evaluate_result", value: String(r.result?.value ?? "") }));
          } catch (e) {
            ws.send(JSON.stringify({ type: "evaluate_result", value: "", error: String(e) }));
          }
          break;
        }
      }
    };
    ws.onerror = () => {
      if (!taskTerminalEmitted) {
        taskTerminalEmitted = true;
        void setBadge(false);
        notifyUi({ type: "task_failed", code: "WS_ERROR", message: "WebSocket connection error" });
        notifyUi({ type: "canonical_status", status: "failed" });
      }
    };
    ws.onclose = () => {
      void cleanup();
    };
  }
  async function cleanup() {
    const tid = activeTabId;
    activeTabId = null;
    tabStack = [];
    ws = null;
    sessionId = null;
    if (tid !== null) void detachFromTab(tid).catch(() => void 0);
    void setBadge(false);
  }
  function stopRelay() {
    taskTerminalEmitted = true;
    ws?.close();
    ws = null;
    const tid = activeTabId;
    activeTabId = null;
    if (tid !== null) void detachFromTab(tid).catch(() => void 0);
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        switch (message.type) {
          case "run_local_task": {
            if (ws !== null && ws.readyState === WebSocket.OPEN) {
              sendResponse({ success: false, error: "A task is already running" });
              return;
            }
            taskTerminalEmitted = false;
            pendingClarifyResolvers.clear();
            pendingApprovalResolvers.clear();
            const goal = String(message.task ?? "").trim();
            if (!goal) {
              sendResponse({ success: false, error: "task is empty" });
              return;
            }
            const stored = await chrome.storage.local.get("settings");
            const serverUrl = message.plannerUrl || stored.settings?.serverUrl || DEFAULT_SERVER;
            void setBadge(true);
            notifyUi({ type: "canonical_status", status: "executing" });
            startRelay(goal, serverUrl, message.startingUrl).catch((err) => {
              void setBadge(false);
              if (!taskTerminalEmitted) {
                taskTerminalEmitted = true;
                notifyUi({ type: "task_failed", code: "START_FAILED", message: err instanceof Error ? err.message : String(err) });
                notifyUi({ type: "canonical_status", status: "failed" });
              }
            });
            sendResponse({ success: true });
            break;
          }
          case "cancel_local_task": {
            taskTerminalEmitted = true;
            stopRelay();
            notifyUi({ type: "task_failed", code: "CANCELLED", message: "Task was cancelled by user" });
            notifyUi({ type: "canonical_status", status: "cancelled" });
            sendResponse({ success: true });
            break;
          }
          case "local_login_complete": {
            if (activeTabId !== null) void sendObservation(activeTabId);
            sendResponse({ success: true });
            break;
          }
          case "local_login_skip": {
            stopRelay();
            sendResponse({ success: true });
            break;
          }
          case "submit_clarification": {
            const res = pendingClarifyResolvers.get(String(message.id));
            if (res) {
              pendingClarifyResolvers.delete(String(message.id));
              res(String(message.answer ?? ""));
            }
            sendResponse({ success: true });
            break;
          }
          case "submit_approval": {
            const res = pendingApprovalResolvers.get(String(message.id));
            if (res) {
              pendingApprovalResolvers.delete(String(message.id));
              res(message.approved === true);
            }
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
          default:
            sendResponse({ success: false, error: "Unknown message type" });
        }
      } catch (e) {
        sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  });
  chrome.tabs.onCreated.addListener((tab) => {
    if (activeTabId === null || !tab.id) return;
    if (tab.openerTabId !== activeTabId) return;
    const newTabId = tab.id;
    const oldTabId = activeTabId;
    tabStack.push(oldTabId);
    activeTabId = newTabId;
    sleep(400).then(async () => {
      try {
        await detachFromTab(oldTabId).catch(() => void 0);
        await attachToTab(newTabId);
        await sendCommand(newTabId, { method: "Page.enable" });
        notifyUi({ type: "tab_event", event: { kind: "opened", tabId: newTabId, url: tab.url ?? "", title: tab.title ?? "" } });
      } catch (e) {
        console.error("[brotto] failed to attach to new tab:", e);
        activeTabId = oldTabId;
        tabStack.pop();
      }
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== activeTabId) return;
    const fallback = tabStack.pop() ?? null;
    activeTabId = fallback;
    if (fallback !== null) {
      attachToTab(fallback).then(
        () => sendCommand(fallback, { method: "Page.enable" })
      ).catch(() => void 0);
    }
  });
  async function initialize() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "brotto-sidepanel") return;
      port.onMessage.addListener(() => {
      });
    });
    chrome.runtime.onInstalled.addListener(() => {
      void setBadge(false);
    });
    try {
      if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } catch {
    }
  }
  void initialize();
})();
