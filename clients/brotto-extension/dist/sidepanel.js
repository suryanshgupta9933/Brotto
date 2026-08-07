// sidepanel.js — chat UI rewrite for the Brotto side panel.
// Preserves all event handlers, state machine, and message listeners.
// Only rendering functions are updated to produce the Claude-in-Chrome chat interface.

const messagesEl  = document.getElementById('messages');
const emptyState   = document.getElementById('emptyState');
const goalEl       = document.getElementById('goal');
const sendBtn      = document.getElementById('sendBtn');
const stopBtn      = document.getElementById('stopBtn');
const workingInd   = document.getElementById('workingIndicator');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel   = document.getElementById('settingsPanel');
const settingsClose   = document.getElementById('settingsClose');
const plannerUrlSetting = document.getElementById('plannerUrlSetting');

// Preserved DOM IDs for background.ts compatibility
const plannerUrlEl    = document.getElementById('plannerUrl');
const startingUrlEl   = document.getElementById('startingUrl');
const connectBtn      = document.getElementById('connectBtn');
const disconnectBtn   = document.getElementById('disconnectBtn');
const refreshBtn      = document.getElementById('refreshBtn');
const statusPill      = document.getElementById('statusPill');
const brandDot        = document.getElementById('brandDot');
const stepCountEl     = document.getElementById('stepCount');
const timerEl         = document.getElementById('timer');
const statusBarEl     = document.getElementById('statusBar');
const stepCountActive = document.getElementById('stepCountActive');
const timerActiveEl   = document.getElementById('timerActive');
const newTaskBtn      = document.getElementById('newTaskBtn');
const connectionMeta  = document.getElementById('connectionMeta');
// ponytail: tab-bar handles — render each lifecycle event (open/close/nav/
// focus) as a row so the user sees what the agent touched in their browser.
const tabBar         = document.getElementById('tabBar');
const tabBarBody     = document.getElementById('tabBarBody');
const tabBarToggle   = document.getElementById('tabBarToggle');

// ── Settings panel ────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  plannerUrlSetting.value = plannerUrlEl.value || 'http://127.0.0.1:3001';
  settingsOverlay.classList.add('open');
});

// ponytail: tab-bar — collapsed/expanded by default. Each row shows badge
// (kind), title (or url), and a one-line context line.
const seenTabs = new Map(); // tabId → {kind, url, title, lastUpdate}
let tabBarCollapsed = false;
function renderTabBar() {
  if (!tabBarBody) return;
  tabBarBody.replaceChildren();
  if (seenTabs.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'tab-row-empty';
    empty.textContent = 'No tabs opened by the agent.';
    tabBarBody.appendChild(empty);
    tabBar.hidden = false;
    return;
  }
  // ponytail: render in event order; we keep insertion order via Map. Most
  // recent row at the bottom by appending as we iterate.
  for (const [, row] of seenTabs) {
    const row_el = document.createElement('div');
    row_el.className = 'tab-row';
    const badge = document.createElement('span');
    badge.className = 'tab-row-badge ' + row.kind;
    badge.textContent = row.kind;
    row_el.appendChild(badge);
    const info = document.createElement('div');
    info.className = 'tab-row-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'tab-row-title';
    titleEl.textContent = row.title || row.url || '(no title)';
    titleEl.title = row.title || row.url || '';
    info.appendChild(titleEl);
    const urlEl = document.createElement('div');
    urlEl.className = 'tab-row-url';
    urlEl.textContent = row.url || '—';
    urlEl.title = row.url || '';
    info.appendChild(urlEl);
    row_el.appendChild(info);
    const idEl = document.createElement('span');
    idEl.className = 'tab-row-url';
    idEl.textContent = `#${row.tabId}`;
    row_el.appendChild(idEl);
    tabBarBody.appendChild(row_el);
  }
  tabBar.hidden = false;
}
function recordTabEvent(ev) {
  if (!ev) return;
  // ponytail: "closed" removes the row; everything else updates in place.
  if (ev.kind === 'closed') {
    seenTabs.delete(ev.tabId);
  } else {
    seenTabs.set(ev.tabId, { tabId: ev.tabId, kind: ev.kind, url: ev.url, title: ev.title });
  }
  renderTabBar();
}
if (tabBarToggle) {
  tabBarToggle.addEventListener('click', () => {
    tabBarCollapsed = !tabBarCollapsed;
    tabBar.classList.toggle('collapsed', tabBarCollapsed);
    tabBarToggle.textContent = tabBarCollapsed ? '+' : '−';
    tabBarToggle.setAttribute('aria-expanded', String(!tabBarCollapsed));
  });
}
settingsClose.addEventListener('click', () => settingsOverlay.classList.remove('open'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});
plannerUrlSetting.addEventListener('input', () => {
  plannerUrlEl.value = plannerUrlSetting.value;
});

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  phase: 'idle',
  plannerUrl: '',
  sessionId: null,
  startTime: 0,
  stepCount: 0,
  pendingClarifyId: null,
};

let timerInterval = null;

// ponytail: tiny XSS guard for any user/model-supplied text we put in innerHTML.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ponytail: if the model skipped `reasoning` (gpt-4o-mini occasionally drops
// optional fields), derive a sentence from the raw action string the local
// driver produced. Keeps the bubble readable even when the model is lazy.
function deriveReasoningFromAction(title, iconKind) {
  const t = (title || '').trim();
  if (!t) return iconKind ? `Working (${iconKind})…` : 'Working on it…';
  if (t.startsWith('visit_url ')) {
    const url = t.slice('visit_url '.length).trim();
    return url ? `Navigating to ${url}…` : 'Navigating…';
  }
  if (t.startsWith('left_click ')) return 'Clicking on the page…';
  if (t.startsWith('double_click ')) return 'Double-clicking…';
  if (t.startsWith('right_click ')) return 'Right-clicking…';
  if (t.startsWith('drag ')) return 'Dragging…';
  if (t.startsWith('scroll ')) return 'Scrolling…';
  if (t.startsWith('key ')) return 'Pressing a key…';
  if (t.startsWith('insert_text ')) {
    const text = t.slice('insert_text '.length).trim();
    return text ? `Typing "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"…` : 'Typing…';
  }
  if (t.startsWith('history_back')) return 'Going back…';
  if (t.startsWith('screenshot')) return 'Taking a screenshot…';
  if (t.startsWith('wait')) return 'Pausing…';
  if (t.startsWith('memorize_fact')) return 'Storing a note… (legacy: planner should use memoryUpdates now)';
  if (t.startsWith('ask_user_question')) return 'Asking you a question…';
  if (t.startsWith('terminate')) return 'Wrapping up…';
  return t.length > 80 ? `${t.slice(0, 77)}…` : `${t}…`;
}

// ── Button handlers (preserved verbatim) ─────────────────────────────────
if (connectBtn) connectBtn.addEventListener('click', () => void connect());
if (disconnectBtn) disconnectBtn.addEventListener('click', () => void disconnect());
if (startBtn) startBtn.addEventListener('click', () => void startTask());
stopBtn.addEventListener('click', () => void stopTask());
if (refreshBtn) refreshBtn.addEventListener('click', () => void refresh());

// ── Input + send ─────────────────────────────────────────────────────────
sendBtn.addEventListener('click', () => void sendUserMessage());
if (newTaskBtn) newTaskBtn.addEventListener('click', () => void resetForNewTask());
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendUserMessage();
  }
});
goalEl.addEventListener('input', () => {
  goalEl.style.height = 'auto';
  goalEl.style.height = Math.min(goalEl.scrollHeight, 120) + 'px';
});

async function sendUserMessage() {
  const text = goalEl.value.trim();
  if (!text) return;
  // ponytail: any non-terminal phase means a send is in flight. Guard against
  // double-clicks during the connecting/connected window before the loop sets
  // 'executing'. Without this, two parallel run_local_task messages race and
  // the second hits "A local task is already running" in background.
  if (state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error'
      && state.phase !== 'completed' && state.phase !== 'cancelled' && state.phase !== 'disconnected'
      && state.phase !== 'failed') return;
  // ponytail: clear prior conversation so each task starts fresh.
  clearMessages();
  // ponytail: clear previous task's tab-bar (the loop's tabEvent subscriptions
  // are rebounded inside the local-driver for every run_local_task).
  seenTabs.clear();
  if (tabBar) tabBar.hidden = true;
  appendMessage({ role: 'user', text });
  state.lastGoal = text;
  goalEl.value = '';
  goalEl.style.height = 'auto';

  // ponytail: auto-connect on first send. User doesn't need a separate
  // "Connect" step. setPhase('connecting') shows the spinner briefly,
  // then we move to 'connected' and kick off the task.
  setPhase('connecting', `Connecting to ${state.plannerUrl || 'planner'}…`);
  try {
    await ensureConnected();
  } catch (err) {
    setPhase('error', `Connect failed: ${err instanceof Error ? err.message : String(err)}`);
    appendMessage({ role: 'error', text: `Connect failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // ponytail: start the timer the moment the user kicks off a task. Earlier
  // wiring only started the timer inside startTask() (bound to a hidden
  // #startBtn), so sendUserMessage's actual run_local_task path never
  // started the counter — the user always saw 0.0s.
  startTimer();
  // ponytail: send the goal to the background. The background opens a
  // new tab, captures observations, calls the planner, dispatches actions
  // via chrome.debugger. The side panel just renders events.
  const response = await sendMessage({ type: 'run_local_task', task: text });
  if (!response.success) {
    stopTimer();
    setPhase('error', `Failed to start: ${response.error || 'unknown error'}`);
    appendMessage({ role: 'error', text: `Failed to start: ${response.error || 'unknown error'}` });
  }
}

async function ensureConnected() {
  // ponytail: reuses the plannerUrl from settings (default :3001). Probes
  // /health; sets phase to 'connected' on success. Throws on failure.
  const url = plannerUrlEl.value.trim() || 'http://127.0.0.1:3001';
  state.plannerUrl = url;
  plannerUrlEl.value = url;
  const response = await fetch(url + '/health', { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const info = await response.json();
  const label = info.model ? `${info.family} · ${info.model}` : info.family || 'planner';
  const modelNameEl = document.getElementById('modelName');
  if (modelNameEl) modelNameEl.textContent = info.model || info.family || 'connected';
  setPhase('connected', `Connected · ${label}`);
  appendMessage({ role: 'system', text: `Connected to planner at ${url} (${label})` });
}

async function resetForNewTask() {
  // ponytail: clear chat stream, reset counters, reset task state.
  // Used by "New task" button and by sendUserMessage to clear before
  // posting a new goal.
  state.lastGoal = '';
  state.stepCount = 0;
  // ponytail: drop the previous task's tab-bar state so each task starts
  // with a fresh journal of what was opened.
  seenTabs.clear();
  renderTabBar();
  if (tabBar) tabBar.hidden = true;
  clearMessages();
  stopTimer();
  setPhase(state.plannerUrl ? 'connected' : 'idle', state.plannerUrl ? 'Ready' : 'Ready');
}

function appendUserMessage(text) {
  appendMessage({ role: 'user', text });
}

// ── Phase / UI helpers ────────────────────────────────────────────────────
function setPhase(phase, message) {
  state.phase = phase;
  const running = phase === 'executing' || phase === 'paused';
  workingInd.classList.toggle('active', running);
  stopBtn.style.display = running ? '' : 'none';
  sendBtn.disabled = running || phase === 'connecting';
  // ponytail: status pill is visible in the header. Updates text + color
  // class so the user can read connection state at a glance (Idle by default).
  const labels = {
    idle: 'Idle', connecting: 'Connecting', connected: 'Connected',
    executing: 'Running', paused: 'Paused', done: 'Done', error: 'Error',
    reconnecting: 'Reconnecting',
  };
  if (statusPill) {
    statusPill.textContent = labels[phase] || 'Idle';
    statusPill.className = `status-pill ${phase}`;
  }
  if (brandDot) brandDot.className = 'brandDot' + (phase === 'executing' ? ' executing' : phase === 'connected' ? ' connected' : phase === 'error' ? ' error' : '');
  if (connectBtn) connectBtn.disabled = phase === 'connecting' || phase === 'connected' || phase === 'executing';
  if (disconnectBtn) disconnectBtn.disabled = !(phase === 'connected' || phase === 'executing' || phase === 'paused');
  if (startBtn) startBtn.disabled = phase === 'connecting';
  stopBtn.disabled = !(phase === 'executing' || phase === 'paused');
  if (refreshBtn) refreshBtn.disabled = phase === 'connecting';
  // ponytail: status bar (steps + timer) shows during running/paused/done.
  // Hidden in idle/connected/error so the panel stays clean.
  const showBar = phase === 'executing' || phase === 'paused' || phase === 'done';
  if (statusBarEl) statusBarEl.classList.toggle('active', showBar);
  // ponytail: New Task button shows after done or error so the user can
  // start fresh without reloading.
  const showNewTask = phase === 'done' || phase === 'error';
  if (newTaskBtn) newTaskBtn.classList.toggle('visible', showNewTask);
  if (message) connectionMeta.textContent = message;
}

function clearTimer() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
  state.startTime = 0;
  timerEl.textContent = '0.0s';
  if (timerActiveEl) timerActiveEl.textContent = '0.0s';
}

function startTimer() {
  clearTimer();
  state.startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1) + 's';
    if (timerEl) timerEl.textContent = elapsed;
    if (timerActiveEl) timerActiveEl.textContent = elapsed;
  }, 100);
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  // ponytail: write the final time to BOTH elements every call. Earlier code
  // only updated the hidden header timer and skipped the visible status bar
  // on stopTimer, so the user kept seeing the last interval value rather than
  // the locked final time. Idempotent — safe to call after the interval is
  // already cleared.
  if (state.startTime > 0) {
    const finalElapsed = ((Date.now() - state.startTime) / 1000).toFixed(1) + 's';
    if (timerEl) timerEl.textContent = finalElapsed;
    if (timerActiveEl) timerActiveEl.textContent = finalElapsed;
  }
}

function updateStepCount() {
  const label = state.stepCount + (state.stepCount === 1 ? ' step' : ' steps');
  stepCountEl.textContent = label;
  if (stepCountActive) stepCountActive.textContent = String(state.stepCount);
}

function clearMessages() {
  messagesEl.replaceChildren();
  state.stepCount = 0;
  updateStepCount();
  stopTimer();
  // ponytail: reset to initial empty-state by adding the empty-state
  // placeholder back so the panel doesn't look empty.
  if (!document.getElementById('emptyState')) {
    const empty = document.createElement('div');
    empty.id = 'emptyState';
    empty.className = 'empty-state';
    empty.innerHTML =
      '<div class="empty-logo">B</div>' +
      '<div class="empty-title">Brotto</div>' +
      '<div class="empty-sub">Describe what you\'d like to do and Brotto will help you get it done in the browser.</div>';
    messagesEl.appendChild(empty);
  }
}

// ── Core logic (preserved verbatim) ───────────────────────────────────────
async function connect() {
  const url = plannerUrlEl.value.trim() || 'http://127.0.0.1:3001';
  setPhase('connecting', `Probing ${url}...`);
  try {
    const response = await fetch(url + '/health', { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const info = await response.json();
    state.plannerUrl = url;
    plannerUrlEl.value = url;
    const label = info.model ? `${info.family} · ${info.model}` : info.family || 'planner';
    // ponytail: show the active model in the header as a text label, not
    // a dropdown. Dropdown can come back later if needed.
    const modelNameEl = document.getElementById("modelName");
    if (modelNameEl) modelNameEl.textContent = info.model || info.family || 'connected';
    setPhase('connected', `Connected · ${label}`);
    appendMessage({ role: 'system', text: `Connected to planner at ${url} (${label})` });
  } catch (err) {
    state.plannerUrl = '';
    const modelNameEl = document.getElementById("modelName");
    if (modelNameEl) modelNameEl.textContent = 'Not connected';
    setPhase('error', `Connect failed: ${err instanceof Error ? err.message : String(err)}`);
    appendMessage({ role: 'error', text: `Connect failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function disconnect() {
  if (state.phase === 'executing' || state.phase === 'paused') void stopTask();
  state.plannerUrl = '';
  setPhase('idle', 'Disconnected');
  appendMessage({ role: 'system', text: 'Disconnected' });
}

async function startTask() {
  if (state.phase === 'executing' || state.phase === 'paused') return;
  const goal = goalEl.value.trim();
  if (!goal) {
    appendMessage({ role: 'error', text: 'Enter a task description first.' });
    return;
  }
  if (!state.plannerUrl) {
    await connect();
    if (state.phase !== 'connected') return;
  }
  clearMessages();
  state.sessionId = 'session-' + Date.now();
  setPhase('executing', 'Starting...');
  startTimer();
  appendMessage({ role: 'system', text: `Starting task: ${goal.slice(0, 80)}${goal.length > 80 ? '…' : ''}` });
  const message = { type: 'run_local_task', task: goal, sessionId: state.sessionId };
  const startUrl = startingUrlEl.value.trim();
  const plannerUrl = plannerUrlEl.value.trim();
  if (startUrl) message.startingUrl = startUrl;
  if (plannerUrl) message.plannerUrl = plannerUrl;
  const response = await sendMessage(message);
  if (!response.success) {
    stopTimer();
    setPhase('error', `Start failed: ${response.error || 'unknown'}`);
    appendMessage({ role: 'error', text: `Failed to start: ${response.error || 'unknown error'}` });
  }
}

async function stopTask() {
  stopBtn.disabled = true;
  // ponytail: surface immediate "Stopped" feedback so the user sees their
  // click took effect. The background's cancel returns immediately; the loop
  // emits task_failed (ABORTED) a few ticks later as cleanup unwinds.
  appendMessage({ role: 'system', text: 'Stopped by user — finishing current step…' });
  setPhase('paused', 'Stopping…');
  const response = await sendMessage({ type: 'cancel_local_task' });
  if (!response.success) appendMessage({ role: 'error', text: `Cancel failed: ${response.error || 'unknown error'}` });
}

async function refresh() {
  stopTimer();
  clearMessages();
  const response = await sendMessage({ type: 'reset_session' });
  if (!response.success) appendMessage({ role: 'error', text: `Reset failed: ${response.error || 'unknown error'}` });
  state.plannerUrl = '';
  setPhase('idle', 'Ready');
}

// ── Message sender (preserved verbatim) ────────────────────────────────────
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      resolve(err ? { success: false, error: err.message } : response || { success: false, error: 'No response' });
    });
  });
}

// ── Chat rendering ────────────────────────────────────────────────────────
function clearMessages() {
  messagesEl.replaceChildren();
  state.stepCount = 0;
  updateStepCount();
  appendEmptyState();
}

function appendEmptyState() {
  messagesEl.appendChild(createEmptyState());
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-logo">B</div>
    <div class="empty-title">Brotto</div>
    <div class="empty-sub">Describe what you'd like to do and Brotto will help you get it done in the browser.</div>
  `;
  return div;
}

function appendMessage({ role, text, inlineLogs, finalAnswer }) {
  // Remove empty state on first real message
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message ' + role;

  if (role === 'assistant' || role === 'user') {
    // Bubble wrapper
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);

    // Inline logs appended inside assistant bubble
    if (inlineLogs && inlineLogs.length > 0) {
      const logsDiv = document.createElement('div');
      logsDiv.className = 'inline-log';
      logsDiv.textContent = inlineLogs.join(' · ');
      bubble.appendChild(logsDiv);
    }
  } else if (role === 'system') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);
  } else if (role === 'error') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = `<strong>Error:</strong> ${text}`;
    msg.appendChild(bubble);
  } else if (role === 'done') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const finalAnswerHtml = finalAnswer
      ? `<div class="final-answer"><div class="final-answer-text">${escapeHtml(finalAnswer)}</div></div>`
      : '';
    bubble.innerHTML = `
      ${finalAnswerHtml}
      <div class="done-header"><span class="done-icon">&#10003;</span> Task completed</div>
      <div class="done-summary">${escapeHtml(text || '')}</div>
    `;
    msg.appendChild(bubble);
  }

  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

// ── Plan preview card ─────────────────────────────────────────────────────
function appendPlanCard({ title, sites, steps }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'plan-card';

  const header = document.createElement('div');
  header.className = 'plan-header';
  header.innerHTML = `<span class="plan-badge">${title || "Brotto's plan"}</span>`;
  card.appendChild(header);

  if (sites && sites.length > 0) {
    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'plan-sites';
    sitesDiv.innerHTML = `Allow actions on: <strong>${sites.join(', ')}</strong>`;
    card.appendChild(sitesDiv);
  }

  if (steps && steps.length > 0) {
    const approachTitle = document.createElement('div');
    approachTitle.className = 'plan-approach-title';
    approachTitle.textContent = 'Approach to follow:';
    card.appendChild(approachTitle);

    const ol = document.createElement('ol');
    ol.className = 'plan-steps';
    for (const step of steps) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="plan-step-num">${step.index}.</span><span>${step.text}</span>`;
      ol.appendChild(li);
    }
    card.appendChild(ol);
  }

  const actions = document.createElement('div');
  actions.className = 'plan-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn-primary btn-sm';
  approveBtn.textContent = 'Approve plan';
  approveBtn.addEventListener('click', () => {
    appendMessage({ role: 'assistant', text: 'Approved the plan. Proceeding…' });
    card.remove();
  });
  actions.appendChild(approveBtn);

  const changeBtn = document.createElement('button');
  changeBtn.className = 'btn btn-sm';
  changeBtn.textContent = 'Make changes';
  changeBtn.addEventListener('click', () => {
    goalEl.focus();
  });
  actions.appendChild(changeBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ponytail: step bubble that tucks the raw tool call behind a "details"
// toggle so the chat reads naturally while still letting the operator
// drill in when debugging. Reasoning stays as the bubble title.
function appendStepWithDetails({ text, details }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble step-bubble';

  const head = document.createElement('div');
  head.className = 'step-head';
  head.textContent = text || 'Working…';
  bubble.appendChild(head);

  if (details && details.length > 0) {
    const wrap = document.createElement('div');
    wrap.className = 'step-details';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'step-details-toggle';
    toggle.textContent = 'details';
    toggle.setAttribute('aria-expanded', 'false');

    const body = document.createElement('div');
    body.className = 'step-details-body';
    body.textContent = details;
    body.style.display = 'none';

    toggle.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.textContent = open ? 'details' : 'hide details';
    });

    wrap.appendChild(toggle);
    wrap.appendChild(body);
    bubble.appendChild(wrap);
  }

  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

// ── Approval request card ─────────────────────────────────────────────────
function appendApprovalCard({ id, reason, action }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const card = document.createElement('div');
  card.className = 'approval-card';

  const header = document.createElement('div');
  header.className = 'approval-header';
  header.innerHTML = `<span class="approval-badge">Approval needed</span>`;
  card.appendChild(header);

  if (reason) {
    const body = document.createElement('div');
    body.className = 'approval-body';
    body.textContent = reason;
    card.appendChild(body);
  }

  const preview = document.createElement('div');
  preview.className = 'approval-preview';
  const previewText = action?.url ? `${action.type ?? 'action'} → ${action.url}` : (action?.type ?? 'action');
  preview.textContent = previewText;
  preview.title = previewText;
  card.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'approval-actions';

  const denyBtn = document.createElement('button');
  denyBtn.className = 'btn btn-danger btn-sm';
  denyBtn.textContent = 'Deny';
  denyBtn.addEventListener('click', () => {
    appendMessage({ role: 'assistant', text: 'Action denied.' });
    card.remove();
    void sendMessage({ type: 'submit_approval', id, approved: false });
  });
  actions.appendChild(denyBtn);

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn-primary btn-sm';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => {
    appendMessage({ role: 'assistant', text: 'Action approved.' });
    card.remove();
    void sendMessage({ type: 'submit_approval', id, approved: true });
  });
  actions.appendChild(approveBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Clarify request card ─────────────────────────────────────────────────
function appendClarifyCard({ id, question, reason }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  // Remove any prior pending clarify card so we don't end up with stacked inputs.
  const prior = messagesEl.querySelector('.clarify-card');
  if (prior) prior.remove();

  const card = document.createElement('div');
  card.className = 'clarify-card';
  card.dataset.clarifyId = id;

  const header = document.createElement('div');
  header.className = 'clarify-header';
  header.innerHTML = `<span class="clarify-badge">Your input</span>`;
  card.appendChild(header);

  if (question) {
    const body = document.createElement('div');
    body.className = 'clarify-body';
    body.textContent = question;
    card.appendChild(body);
  }

  // Real text input INSIDE the card — previous version told the user to use
  // the bottom goalEl but that input was hard-coded to send a new task.
  const inputRow = document.createElement('div');
  inputRow.className = 'clarify-input-row';

  const input = document.createElement('textarea');
  input.className = 'clarify-input';
  input.rows = 1;
  input.placeholder = 'Type your answer…';
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(input.value, input, card);
    }
  });

  const sendBtn = document.createElement('button');
  sendBtn.className = 'clarify-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', () => void submit(input.value, input, card));

  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  card.appendChild(inputRow);

  const hint = document.createElement('div');
  hint.className = 'input-hint clarify-hint';
  hint.textContent = 'Press Enter to send · Shift+Enter for newline';
  card.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'clarify-actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-sm';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    appendMessage({ role: 'system', text: 'Skipped clarifying question.' });
    void sendMessage({ type: 'submit_clarification', id, answer: '' });
    card.remove();
    state.pendingClarifyId = null;
    setPhase(state.plannerUrl ? 'connected' : 'idle', state.plannerUrl ? 'Resuming…' : 'Idle');
  });
  actions.appendChild(skipBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  input.focus();

  state.pendingClarifyId = id;

  async function submit(value, inputEl, cardEl) {
    const answer = value.trim();
    if (!answer) {
      inputEl.focus();
      return;
    }
    appendMessage({ role: 'user', text: answer });
    cardEl.remove();
    state.pendingClarifyId = null;
    setPhase('connected', 'Resuming…');
    await sendMessage({ type: 'submit_clarification', id, answer });
  }
}

// ── Icon helpers (for step cards rendered as assistant messages) ───────────
function iconFor(kind) {
  switch (kind) {
    case 'left_click': case 'double_click': case 'right_click': case 'mouse_move': return '&#9654;';
    case 'insert_text': return '&#9998;';
    case 'visit_url': case 'history_back': return '&#8594;';
    case 'key': return '&#9251;';
    case 'terminate': return '&#10003;';
    case 'wait': case 'scroll': return '&#8226;';
    case 'error': return '&#10007;';
    case 'prompt': return '?';
    default: return '&#8594;';
  }
}

// ── Live assistant message (current "working" message being updated) ───────
let currentAssistantMsg = null;
let currentAssistantLogs = [];

function startAssistantMessage({ icon, title, meta }) {
  currentAssistantMsg = null;
  currentAssistantLogs = [];

  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const iconEl = document.createElement('span');
  iconEl.style.marginRight = '5px';
  iconEl.style.opacity = '0.6';
  iconEl.innerHTML = icon || '&#8594;';

  const textNode = document.createTextNode(title || 'Working…');
  bubble.appendChild(iconEl);
  bubble.appendChild(textNode);

  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  currentAssistantMsg = { el: msg, bubble, textNode };
  return currentAssistantMsg;
}

function appendLogToAssistant(logText) {
  if (!currentAssistantMsg) return;
  const existing = currentAssistantMsg.bubble.querySelector('.inline-log');
  if (existing) {
    existing.textContent += ' · ' + logText;
  } else {
    const logsDiv = document.createElement('div');
    logsDiv.className = 'inline-log';
    logsDiv.textContent = logText;
    currentAssistantMsg.bubble.appendChild(logsDiv);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function finishAssistantMessage({ icon, title, meta }) {
  if (!currentAssistantMsg) {
    // Fallback: just append as a regular message
    appendMessage({ role: 'assistant', text: `${icon} ${title}${meta ? ' · ' + meta : ''}` });
    return;
  }
  // Finalize the bubble
  currentAssistantMsg.bubble.innerHTML = '';
  const iconEl = document.createElement('span');
  iconEl.style.marginRight = '6px';
  iconEl.style.opacity = '0.5';
  iconEl.innerHTML = icon || '&#8594;';
  const titleText = document.createTextNode(title || '');
  currentAssistantMsg.bubble.appendChild(iconEl);
  currentAssistantMsg.bubble.appendChild(titleText);

  if (meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'inline-log';
    metaEl.textContent = meta;
    currentAssistantMsg.bubble.appendChild(metaEl);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
  currentAssistantMsg = null;
  currentAssistantLogs = [];
}

// ── Message listener (all event types from background.ts) ──────────────────
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {

    case 'session_started':
      state.sessionId = message.sessionId || state.sessionId;
      break;

    case 'canonical_status': {
      // ponytail: normalize canonical lifecycle (completed / failed / cancelled /
      // disconnected / cancelling / waiting_for_approval) into the side-panel
      // phase enum so the UI doesn't get stuck in unmapped states. The local-
      // driver emits "completed" after every run — without this normalization
      // the pill said "completed" and the new-task Send was silently blocked.
      const raw = String(message.status || '');
      const mapped = (raw === 'completed' || raw === 'cancelled' || raw === 'disconnected') ? 'done'
        : raw === 'failed' ? 'error'
        : raw === 'cancelling' ? 'paused'
        : raw === 'waiting_for_approval' ? 'paused'
        : raw;
      const meta = message.reconnectAttempt !== undefined
        ? `Reconnecting (${message.reconnectAttempt})…`
        : raw === 'completed' ? 'Task complete'
        : raw === 'failed' ? 'Task failed'
        : raw === 'cancelled' ? 'Task cancelled'
        : null;
      setPhase(mapped, meta);
      break;
    }

    case 'step_card': {
      state.stepCount = Math.max(state.stepCount, message.index !== undefined ? message.index + 1 : state.stepCount + 1);
      updateStepCount();
      const icon = iconFor(message.iconKind || '');
      // ponytail: prefer the model's `reasoning`. If the model skipped it
      // (gpt-4o-mini occasionally drops optional fields), derive a sensible
      // sentence from the raw action so the bubble still reads naturally.
      const reasoningText = (message.reasoning && message.reasoning.trim())
        || deriveReasoningFromAction(message.title || '', message.iconKind);
      const toolSubtitle = `${message.title || ''}${message.result ? ' → ' + message.result : ''}`.trim();
      // ponytail: each step gets its OWN persistent bubble. Reasoning is the
      // bubble title; raw tool call ("visit_url https://... → navigated to...")
      // lives behind a "details" toggle so the chat reads naturally and the
      // operator can drill in when debugging.
      const stepText = (icon ? icon + ' ' : '') + reasoningText;
      appendStepWithDetails({ text: stepText, details: toolSubtitle, ts: message.ts });
      break;
    }

    case 'log':
      // ponytail: historical handler kept for back-compat. New background
      // logs go to the service worker console only; UI stays clean.
      break;

    case 'login_required':
      setPhase('paused', `Login required at ${message.domain || 'site'}`);
      appendMessage({
        role: 'assistant',
        text: `Login required on ${message.domain || 'this site'}. Please sign in manually in the browser tab, then the task will continue.`,
      });
      break;

    case 'task_completed':
      stopTimer();
      setPhase('done', message.summary ? message.summary.slice(0, 60) : 'Task complete');
      state.stepCount = message.steps || state.stepCount;
      updateStepCount();
      appendMessage({
        role: 'done',
        text: `${message.steps || state.stepCount} steps · ${message.summary || ''}`,
        finalAnswer: message.finalAnswer,
      });
      break;

    case 'task_failed':
      stopTimer();
      setPhase('error', message.message || 'Task failed');
      appendMessage({
        role: 'error',
        text: `${message.code || 'Error'}: ${message.message || 'Task failed'}`,
      });
      break;

    case 'clarify_request': {
      setPhase('paused', 'Clarifying question from agent');
      appendClarifyCard({
        id: message.id,
        question: message.question || 'The agent needs your guidance.',
        reason: message.reason || '',
      });
      break;
    }

    case 'approval_request': {
      setPhase('paused', 'Agent wants approval for a critical action');
      const a = message.action || {};
      const preview = a.url ? `${a.type ?? 'action'} → ${a.url}` : (a.type ?? 'action');
      appendApprovalCard({
        id: message.id,
        reason: message.reason || 'The agent wants to perform an action that needs your approval.',
        action: { type: a.type, url: a.url },
      });
      break;
    }

    // ── Canonical events ─────────────────────────────────────────────────
    case 'canonical_step': {
      const icon = message.kind === 'action' ? '&#9654;' : message.kind === 'observation' ? '&#128065;' : '&#10003;';
      const titleText = (message.reasoning && message.reasoning.trim())
        || deriveReasoningFromAction(message.summary || '', message.kind)
        || 'Working on it…';
      if (!currentAssistantMsg) {
        startAssistantMessage({ icon, title: titleText });
      }
      break;
    }

    case 'canonical_approval': {
      const req = message.request || {};
      setPhase('paused', 'Agent is requesting approval');
      appendApprovalCard({
        id: req.actionId || 'unknown',
        reason: 'The agent is requesting approval for a sensitive action.',
        action: { type: req.action?.type },
      });
      break;
    }

    case 'canonical_terminal': {
      stopTimer();
      const m = message.message || {};
      if (m.type === 'task.completed') {
        setPhase('done', m.summary || 'Task complete');
        appendMessage({ role: 'done', text: m.summary || 'Task completed successfully.', finalAnswer: m.finalAnswer });
      } else if (m.type === 'task.failed') {
        setPhase('error', m.message || 'Task failed');
        appendMessage({ role: 'error', text: m.message || 'Task failed.' });
      } else {
        setPhase('done', 'Task ended');
        appendMessage({ role: 'done', text: 'Task ended.' });
      }
      break;
    }

    case 'canonical_error':
      appendMessage({ role: 'error', text: `${message.code}: ${message.message}` });
      break;

    case 'canonical_reconnect':
      setPhase('reconnecting', `Reconnecting (attempt ${message.attempt})…`);
      break;

    // ── Plan preview (from orchestrator) ─────────────────────────────────
    // Side panel receives a plan event when the orchestrator emits a plan.
    // Background does not currently emit this; the handler is ready.
    case 'plan': {
      appendPlanCard({
        title: message.title || "Brotto's plan",
        sites: message.sites || [],
        steps: message.steps || [],
      });
      break;
    }

    case 'tab_event': {
      // ponytail: local-driver tab lifecycle — render to the tabs row.
      recordTabEvent(message.event);
      break;
    }
  }
});

// ── Initial state ────────────────────────────────────────────────────────
setPhase('idle', 'Ready');
