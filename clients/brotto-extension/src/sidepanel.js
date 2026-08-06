// ponytail: side panel controller. State machine: idle → connecting →
// connected → executing → (paused | done | error). Renders a live activity
// stream of step cards with screenshots, action descriptions, and elapsed
// timer. Mid-task prompts (login, question, decision) are inline amber
// cards that interleave the stream chronologically.

const stream = document.getElementById('stream');
const statusPill = document.getElementById('statusPill');
const brandDot = document.getElementById('brandDot');
const goalEl = document.getElementById('goal');
const startingUrlEl = document.getElementById('startingUrl');
const plannerUrlEl = document.getElementById('plannerUrl');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const refreshBtn = document.getElementById('refreshBtn');
const connectionMeta = document.getElementById('connectionMeta');
const stepCountEl = document.getElementById('stepCount');
const timerEl = document.getElementById('timer');

const state = {
  phase: 'idle',           // idle | connecting | connected | executing | paused | done | error
  plannerUrl: '',
  sessionId: null,
  startTime: 0,
  stepCount: 0,
};

let timerInterval = null;
let lastLiveCard = null;

connectBtn.addEventListener('click', () => void connect());
disconnectBtn.addEventListener('click', () => void disconnect());
startBtn.addEventListener('click', () => void startTask());
stopBtn.addEventListener('click', () => void stopTask());
refreshBtn.addEventListener('click', () => void refresh());
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void startTask();
});

function setPhase(phase, message) {
  state.phase = phase;
  const labels = {
    idle: 'Idle',
    connecting: 'Connecting',
    connected: 'Connected',
    executing: 'Running',
    paused: 'Paused',
    done: 'Done',
    error: 'Error',
  };
  statusPill.textContent = labels[phase] || 'Idle';
  statusPill.className = 'status-pill ' + phase;
  brandDot.className = 'brand-dot' + (phase === 'executing' ? ' executing' : phase === 'connected' ? ' connected' : phase === 'error' ? ' error' : '');
  connectBtn.disabled = phase === 'connecting' || phase === 'connected' || phase === 'executing';
  disconnectBtn.disabled = !(phase === 'connected' || phase === 'executing' || phase === 'paused');
  // ponytail: start is always enabled (except during connecting — start clicks
  // trigger implicit connect from idle). Lets the user click Start from any
  // state without first hunting for the Connect button.
  startBtn.disabled = phase === 'connecting';
  stopBtn.disabled = !(phase === 'executing' || phase === 'paused');
  refreshBtn.disabled = phase === 'connecting';
  if (message) connectionMeta.textContent = message;
}

function clearTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  state.startTime = 0;
  timerEl.textContent = '0.0s';
}

function startTimer() {
  clearTimer();
  state.startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - state.startTime) / 1000;
    timerEl.textContent = elapsed.toFixed(1) + 's';
  }, 100);
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
    const elapsed = (Date.now() - state.startTime) / 1000;
    timerEl.textContent = elapsed.toFixed(1) + 's';
  }
}

function updateStepCount() {
  stepCountEl.textContent = state.stepCount + (state.stepCount === 1 ? ' step' : ' steps');
}

function clearStream() {
  stream.replaceChildren();
  state.stepCount = 0;
  lastLiveCard = null;
  updateStepCount();
}

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
    setPhase('connected', `Connected · ${label}`);
    appendCard({ kind: 'system', icon: 'icon.sys', title: 'Connected to planner', meta: `${url} · ${label}`, ts: Date.now() });
  } catch (err) {
    // ponytail: clear the cached planner URL on failure so refresh goes
    // back to idle and the user can try a different URL.
    state.plannerUrl = '';
    setPhase('error', `Connect failed: ${err instanceof Error ? err.message : String(err)}`);
    appendCard({ kind: 'error', icon: 'icon.err', title: 'Connect failed', meta: err instanceof Error ? err.message : String(err), ts: Date.now() });
  }
}

function disconnect() {
  if (state.phase === 'executing' || state.phase === 'paused') {
    void stopTask();
  }
  state.plannerUrl = '';
  setPhase('idle', 'Disconnected');
  appendCard({ kind: 'system', icon: 'icon.sys', title: 'Disconnected', meta: '', ts: Date.now() });
}

async function startTask() {
  if (state.phase === 'executing' || state.phase === 'paused') return;
  const goal = goalEl.value.trim();
  if (!goal) {
    appendCard({ kind: 'error', icon: 'icon.err', title: 'Empty goal', meta: 'Enter a task description first', ts: Date.now() });
    return;
  }
  if (!state.plannerUrl) {
    // ponytail: implicit connect if user skipped. Better than blocking on a
    // connect step they may not realize they need.
    await connect();
    if (state.phase !== 'connected') return;
  }
  clearStream();
  state.sessionId = 'session-' + Date.now();
  setPhase('executing', 'Starting...');
  startTimer();
  appendCard({ kind: 'system', icon: 'icon.sys', title: 'Starting task', meta: goal.slice(0, 80), ts: Date.now() });
  const message = {
    type: 'run_local_task',
    task: goal,
    sessionId: state.sessionId,
  };
  const startUrl = startingUrlEl.value.trim();
  const plannerUrl = plannerUrlEl.value.trim();
  if (startUrl) message.startingUrl = startUrl;
  if (plannerUrl) message.plannerUrl = plannerUrl;
  const response = await sendMessage(message);
  if (!response.success) {
    stopTimer();
    setPhase('error', `Start failed: ${response.error || 'unknown'}`);
    appendCard({ kind: 'error', icon: 'icon.err', title: 'Failed to start', meta: response.error || 'unknown error', ts: Date.now() });
  }
}

async function stopTask() {
  stopBtn.disabled = true;
  const response = await sendMessage({ type: 'cancel_local_task' });
  if (!response.success) appendCard({ kind: 'error', icon: 'icon.err', title: 'Cancel failed', meta: response.error || 'unknown error', ts: Date.now() });
}

async function refresh() {
  // ponytail: hard reset. Aborts any active loop, detaches debugger, clears
  // pending UI requests, clears the stream. Doesn't close the tab — the user
  // may want to keep the page open. After reset, return to idle (or connected
  // if the cached planner URL is healthy).
  stopTimer();
  clearStream();
  const response = await sendMessage({ type: 'reset_session' });
  if (!response.success) appendCard({ kind: 'error', icon: 'icon.err', title: 'Reset failed', meta: response.error || 'unknown error', ts: Date.now() });
  // ponytail: clear stale planner URL on refresh. If the URL is good the user
  // can hit Connect again; if it was bad we don't want to keep "knowing" it.
  state.plannerUrl = '';
  setPhase('idle', 'Ready');
}

function iconFor(kind) {
  switch (kind) {
    case 'left_click':
    case 'double_click':
    case 'right_click':
    case 'mouse_move':
      return 'click';
    case 'insert_text':
      return 'text';
    case 'visit_url':
    case 'history_back':
      return 'nav';
    case 'key':
      return 'key';
    case 'terminate':
      return 'term';
    case 'wait':
      return 'sys';
    case 'error':
      return 'err';
    case 'prompt':
      return 'qu';
    default:
      return 'nav';
  }
}

function describeAction(action) {
  if (!action) return '';
  switch (action.type) {
    case 'left_click':
    case 'double_click':
    case 'right_click':
      return `${action.type.replace('_', ' ')} (${action.x}, ${action.y})`;
    case 'insert_text':
      return `Type "${(action.text || '').slice(0, 60)}"`;
    case 'key':
      return `Press ${action.key}`;
    case 'visit_url':
      return `Navigate to ${action.url}`;
    case 'history_back':
      return `Go back`;
    case 'scroll':
      return `Scroll`;
    case 'wait':
      return `Wait`;
    case 'terminate':
      return `Task done`;
    default:
      return action.type || 'Action';
  }
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function appendCard(opts) {
  if (lastLiveCard && opts.live) lastLiveCard.classList.remove('live');
  const empty = stream.querySelector('.empty');
  if (empty) empty.remove();

  const card = document.createElement('article');
  card.className = 'card' + (opts.live ? ' live' : '') + (opts.kind === 'error' ? ' error' : '') + (opts.kind === 'done' ? ' done' : '') + (opts.kind === 'prompt' ? ' prompt' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  const icon = document.createElement('span');
  icon.className = 'icon ' + (opts.icon || 'icon.nav');
  icon.textContent = (opts.iconLabel || opts.title || '?').charAt(0).toUpperCase();
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = opts.title || '';
  const meta = document.createElement('span');
  meta.className = 'card-meta';
  meta.textContent = fmtTime(opts.ts) + (opts.meta ? ' · ' + opts.meta : '');
  head.append(icon, title, meta);
  card.appendChild(head);

  if (opts.url) {
    const url = document.createElement('div');
    url.className = 'card-url';
    url.textContent = opts.url;
    card.appendChild(url);
  }

  if (opts.screenshot) {
    const img = document.createElement('img');
    img.className = 'screenshot';
    img.src = `data:image/png;base64,${opts.screenshot}`;
    img.alt = opts.url || 'screenshot';
    img.loading = 'lazy';
    card.appendChild(img);
  } else if (opts.placeholder) {
    const ph = document.createElement('div');
    ph.className = 'screenshot placeholder';
    ph.textContent = opts.placeholder;
    card.appendChild(ph);
  }

  if (opts.body) {
    const body = document.createElement('div');
    body.className = 'prompt-body';
    body.textContent = opts.body;
    card.appendChild(body);
  }

  if (opts.actions) {
    const actions = document.createElement('div');
    actions.className = 'prompt-actions';
    for (const a of opts.actions) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.kind || '');
      btn.textContent = a.label;
      btn.addEventListener('click', () => a.onClick(btn));
      actions.appendChild(btn);
    }
    card.appendChild(actions);
  }

  if (opts.input) {
    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = opts.input.placeholder || '';
    card.appendChild(input);
    if (opts.actions && opts.actions.length > 0) {
      const last = opts.actions[opts.actions.length - 1];
      const original = last.onClick;
      last.onClick = () => original(input.value);
    }
  }

  stream.appendChild(card);
  stream.scrollTop = stream.scrollHeight;
  if (opts.live) lastLiveCard = card;
  return card;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      resolve(err ? { success: false, error: err.message } : response || { success: false, error: 'No response' });
    });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'session_started':
      state.sessionId = message.sessionId || state.sessionId;
      break;
    case 'step_card': {
      state.stepCount = Math.max(state.stepCount, message.index !== undefined ? message.index + 1 : state.stepCount + 1);
      updateStepCount();
      appendCard({
        kind: 'step',
        icon: iconFor(message.iconKind),
        iconLabel: message.title || '',
        title: message.title || 'Step',
        meta: message.result || '',
        url: message.url,
        screenshot: message.screenshot,
        placeholder: message.screenshotPlaceholder,
        ts: message.ts || Date.now(),
        live: true,
      });
      break;
    }
    case 'login_required':
      setPhase('paused', `Login required at ${message.domain || 'site'}`);
      appendCard({
        kind: 'prompt',
        icon: 'icon.qu',
        iconLabel: 'L',
        title: `Login required: ${message.domain || 'site'}`,
        body: `Sign in to ${message.domain || 'this site'} in the browser tab, then click Continue. The agent will resume from where it paused.`,
        url: message.url,
        ts: Date.now(),
        actions: [
          { label: 'Continue', kind: 'primary', onClick: () => { void sendMessage({ type: 'local_login_complete' }); } },
          { label: 'Skip task', kind: 'danger', onClick: () => { void sendMessage({ type: 'cancel_local_task' }); } },
        ],
      });
      break;
    case 'task_completed':
      stopTimer();
      setPhase('done', message.summary ? message.summary.slice(0, 60) : 'Task complete');
      state.stepCount = message.steps || state.stepCount;
      updateStepCount();
      appendCard({
        kind: 'done',
        icon: 'icon.term',
        iconLabel: '✓',
        title: `Completed in ${message.steps || state.stepCount} steps`,
        meta: message.summary || '',
        ts: Date.now(),
      });
      break;
    case 'task_failed':
      stopTimer();
      setPhase('error', message.message || 'Task failed');
      appendCard({
        kind: 'error',
        icon: 'icon.err',
        iconLabel: '✕',
        title: message.code || 'Task failed',
        meta: message.message || '',
        ts: Date.now(),
      });
      break;
    case 'clarify_request': {
      setPhase('paused', 'Clarifying question from agent');
      appendCard({
        kind: 'prompt',
        icon: 'icon.qu',
        iconLabel: '?',
        title: 'Agent needs a nudge',
        body: message.question || 'The agent is stuck and needs your input.',
        url: message.reason ? `Reason: ${message.reason}` : '',
        ts: Date.now(),
        input: { placeholder: 'Type a hint for the agent (e.g. try the other button)…' },
        actions: [
          { label: 'Skip', kind: 'danger', onClick: (v) => { void sendMessage({ type: 'cancel_local_task' }); void v; } },
          { label: 'Send hint', kind: 'primary', onClick: (v) => { void sendMessage({ type: 'submit_clarification', id: message.id, answer: v || '' }); } },
        ],
      });
      break;
    }
    case 'approval_request': {
      setPhase('paused', 'Agent wants approval for a critical action');
      const a = message.action || {};
      const preview = a.url ? `${a.type ?? 'action'} → ${a.url}` : (a.type ?? 'action');
      appendCard({
        kind: 'prompt',
        icon: 'icon.qu',
        iconLabel: '!',
        title: 'Approve before continuing',
        body: message.reason || 'The agent wants to perform an action that needs your approval.',
        url: preview,
        ts: Date.now(),
        actions: [
          { label: 'Deny', kind: 'danger', onClick: () => { void sendMessage({ type: 'submit_approval', id: message.id, approved: false }); } },
          { label: 'Approve', kind: 'primary', onClick: () => { void sendMessage({ type: 'submit_approval', id: message.id, approved: true }); } },
        ],
      });
      break;
    }
    case 'log':
      appendCard({
        kind: 'system',
        icon: 'icon.sys',
        iconLabel: '·',
        title: message.message || '',
        meta: '',
        ts: Date.now(),
      });
      break;
  }
});
