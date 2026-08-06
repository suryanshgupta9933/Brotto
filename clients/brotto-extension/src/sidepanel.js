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
const connectionMeta  = document.getElementById('connectionMeta');

// ── Settings panel ────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  plannerUrlSetting.value = plannerUrlEl.value || 'http://127.0.0.1:3001';
  settingsOverlay.classList.add('open');
});
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
};

let timerInterval = null;

// ── Button handlers (preserved verbatim) ─────────────────────────────────
connectBtn.addEventListener('click', () => void connect());
disconnectBtn.addEventListener('click', () => void disconnect());
startBtn.addEventListener('click', () => void startTask());
stopBtn.addEventListener('click', () => void stopTask());
refreshBtn.addEventListener('click', () => void refresh());

// ── Input + send ─────────────────────────────────────────────────────────
sendBtn.addEventListener('click', () => void sendUserMessage());
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

function sendUserMessage() {
  const text = goalEl.value.trim();
  if (!text || state.phase === 'executing') return;
  appendMessage({ role: 'user', text });
  goalEl.value = '';
  goalEl.style.height = 'auto';
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
  // compatibility
  const labels = {
    idle: 'Idle', connecting: 'Connecting', connected: 'Connected',
    executing: 'Running', paused: 'Paused', done: 'Done', error: 'Error',
  };
  statusPill.textContent = labels[phase] || 'Idle';
  statusPill.className = 'statusPill ' + phase;
  brandDot.className = 'brandDot' + (phase === 'executing' ? ' executing' : phase === 'connected' ? ' connected' : phase === 'error' ? ' error' : '');
  connectBtn.disabled = phase === 'connecting' || phase === 'connected' || phase === 'executing';
  disconnectBtn.disabled = !(phase === 'connected' || phase === 'executing' || phase === 'paused');
  startBtn.disabled = phase === 'connecting';
  stopBtn.disabled = !(phase === 'executing' || phase === 'paused');
  refreshBtn.disabled = phase === 'connecting';
  if (message) connectionMeta.textContent = message;
}

function clearTimer() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
  state.startTime = 0;
  timerEl.textContent = '0.0s';
}

function startTimer() {
  clearTimer();
  state.startTime = Date.now();
  timerInterval = setInterval(() => {
    timerEl.textContent = ((Date.now() - state.startTime) / 1000).toFixed(1) + 's';
  }, 100);
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
    timerEl.textContent = ((Date.now() - state.startTime) / 1000).toFixed(1) + 's';
  }
}

function updateStepCount() {
  stepCountEl.textContent = state.stepCount + (state.stepCount === 1 ? ' step' : ' steps');
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

function appendMessage({ role, text, inlineLogs }) {
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
    bubble.innerHTML = `
      <div class="done-header"><span class="done-icon">&#10003;</span> Task completed</div>
      <div class="done-summary">${text}</div>
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

  const card = document.createElement('div');
  card.className = 'clarify-card';

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

  // Hint text directing user to type below
  const hint = document.createElement('div');
  hint.className = 'input-hint';
  hint.style.marginBottom = '10px';
  hint.textContent = 'Type your answer in the field below, then press Enter to send.';
  card.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'clarify-actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-sm';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    appendMessage({ role: 'system', text: 'Skipped clarifying question.' });
    card.remove();
    void sendMessage({ type: 'submit_clarification', id, answer: '' });
  });
  actions.appendChild(skipBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Focus the input area
  goalEl.focus();
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

    case 'canonical_status':
      setPhase(message.status, message.reconnectAttempt !== undefined ? `Reconnecting (${message.reconnectAttempt})…` : null);
      break;

    case 'step_card': {
      state.stepCount = Math.max(state.stepCount, message.index !== undefined ? message.index + 1 : state.stepCount + 1);
      updateStepCount();
      const icon = iconFor(message.iconKind || '');
      if (!currentAssistantMsg) {
        startAssistantMessage({ icon, title: message.title || 'Step', meta: message.result || '' });
      }
      // Update the assistant message with action info
      if (currentAssistantMsg) {
        currentAssistantMsg.bubble.innerHTML = '';
        const iconEl = document.createElement('span');
        iconEl.style.marginRight = '6px';
        iconEl.style.opacity = '0.5';
        iconEl.innerHTML = icon;
        const textEl = document.createElement('span');
        textEl.textContent = message.title || 'Step';
        currentAssistantMsg.bubble.appendChild(iconEl);
        currentAssistantMsg.bubble.appendChild(textEl);
        if (message.result) {
          const metaEl = document.createElement('div');
          metaEl.className = 'inline-log';
          metaEl.textContent = message.result;
          currentAssistantMsg.bubble.appendChild(metaEl);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      break;
    }

    case 'log':
      if (currentAssistantMsg) {
        appendLogToAssistant(message.message || '');
      } else {
        appendMessage({ role: 'system', text: message.message || '' });
      }
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
      if (!currentAssistantMsg) {
        startAssistantMessage({ icon, title: message.summary || 'Working…' });
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
        appendMessage({ role: 'done', text: m.summary || 'Task completed successfully.' });
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
  }
});

// ── Initial state ────────────────────────────────────────────────────────
setPhase('idle', 'Ready');
