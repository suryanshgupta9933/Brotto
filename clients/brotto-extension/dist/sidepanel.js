// ponytail: side panel controller. Subscribes to canonical_* events from
// background.ts and renders a Claude-in-Chrome-style live activity stream.
// Each step is a card; mid-task prompts (login, question, decision) are
// inline cards that interleave the stream chronologically.

const stream = document.getElementById('stream');
const statusEl = document.getElementById('status');
const goalEl = document.getElementById('goal');
const startingUrlEl = document.getElementById('startingUrl');
const plannerUrlEl = document.getElementById('plannerUrl');
const runBtn = document.getElementById('run');
const cancelBtn = document.getElementById('cancel');
const stepCountEl = document.getElementById('stepCount');

let activeSession = false;
let stepCounter = 0;

runBtn.addEventListener('click', () => { void runTask(); });
cancelBtn.addEventListener('click', () => { void cancelTask(); });
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void runTask();
});

async function runTask() {
  const goal = goalEl.value.trim();
  if (!goal) return;
  const message = { type: 'run_local_task', task: goal };
  const startUrl = startingUrlEl.value.trim();
  const plannerUrl = plannerUrlEl.value.trim();
  if (startUrl) message.startingUrl = startUrl;
  if (plannerUrl) message.plannerUrl = plannerUrl;
  clearStream();
  appendCard({ kind: 'system', icon: 'icon-nav', title: 'Starting task', meta: goal.slice(0, 80) });
  const response = await sendMessage(message);
  if (!response.success) {
    appendCard({ kind: 'error', icon: 'icon-err', title: 'Failed to start', meta: response.error || 'unknown error' });
    return;
  }
  activeSession = true;
  runBtn.hidden = true;
  cancelBtn.hidden = false;
  updateStatus('Running');
}

async function cancelTask() {
  const response = await sendMessage({ type: 'cancel_local_task' });
  if (!response.success) appendCard({ kind: 'error', icon: 'icon-err', title: 'Cancel failed', meta: response.error || 'unknown error' });
}

async function loginContinue() {
  const response = await sendMessage({ type: 'local_login_complete' });
  if (!response.success) appendCard({ kind: 'error', icon: 'icon-err', title: 'Resume failed', meta: response.error || 'unknown error' });
}

function clearStream() {
  stream.replaceChildren();
  stepCounter = 0;
  updateStepCount();
}

function updateStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function updateStepCount() {
  stepCountEl.textContent = `${stepCounter} step${stepCounter === 1 ? '' : 's'}`;
}

function iconFor(kind) {
  switch (kind) {
    case 'left_click':
    case 'double_click':
    case 'right_click': return 'icon-click';
    case 'insert_text': return 'icon-text';
    case 'visit_url':
    case 'history_back': return 'icon-nav';
    case 'key': return 'icon-key';
    case 'terminate': return 'icon-term';
    case 'error': return 'icon-err';
    case 'prompt': return 'icon-qu';
    case 'system': return 'icon-nav';
    default: return 'icon-nav';
  }
}

function describeAction(action) {
  if (!action) return '';
  switch (action.type) {
    case 'left_click':
    case 'double_click':
    case 'right_click':
      return `${action.type.replace('_', ' ')} at (${action.x}, ${action.y})`;
    case 'insert_text':
      return `Type "${(action.text || '').slice(0, 60)}"`;
    case 'key':
      return `Press key ${action.key}`;
    case 'visit_url':
      return `Navigate to ${action.url}`;
    case 'scroll':
      return `Scroll ${action.deltaX || 0},${action.deltaY || 0}`;
    case 'wait':
      return `Wait`;
    case 'terminate':
      return `Done`;
    default:
      return action.type || 'Unknown action';
  }
}

function appendCard(opts) {
  // ponytail: most recent card is always at the bottom. The 'live' marker is
  // moved off any prior card when a new one is added.
  const priorLive = stream.querySelector('.card.live');
  if (priorLive) priorLive.classList.remove('live');

  const card = document.createElement('article');
  card.className = 'card' + (opts.live ? ' live' : '') + (opts.kind === 'error' ? ' error' : '') + (opts.kind === 'done' ? ' done' : '') + (opts.kind === 'prompt' ? ' prompt' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  const icon = document.createElement('span');
  icon.className = 'card-icon ' + (opts.icon || 'icon-nav');
  icon.textContent = (opts.title || '?').charAt(0).toUpperCase();
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = opts.title || '';
  const meta = document.createElement('span');
  meta.className = 'card-meta';
  meta.textContent = opts.meta || '';
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
    img.src = opts.screenshot;
    img.alt = '';
    card.appendChild(img);
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
      btn.className = a.kind || '';
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      actions.appendChild(btn);
    }
    card.appendChild(actions);
  }

  if (opts.input) {
    const input = document.createElement('input');
    input.className = 'prompt-input';
    input.placeholder = opts.input.placeholder || '';
    if (opts.input.value) input.value = opts.input.value;
    card.appendChild(input);
    if (opts.actions) {
      const last = opts.actions[opts.actions.length - 1];
      if (last) last.onClick = () => last.onClick(input.value);
    }
  }

  stream.appendChild(card);
  stream.scrollTop = stream.scrollHeight;

  if (opts.live) {
    const empty = stream.querySelector('.empty');
    if (empty) empty.remove();
  }

  return card;
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'canonical_status':
      if (message.status === 'executing') updateStatus('Running', 'active');
      else if (message.status === 'connected') updateStatus('Connected', 'active');
      else if (message.status === 'waiting_for_approval') updateStatus('Paused', 'paused');
      else if (message.status === 'completed') { updateStatus('Done', 'done'); activeSession = false; runBtn.hidden = false; cancelBtn.hidden = true; }
      else if (message.status === 'failed' || message.status === 'cancelled') { updateStatus(message.status, 'error'); activeSession = false; runBtn.hidden = false; cancelBtn.hidden = true; }
      else updateStatus(message.status);
      break;
    case 'canonical_step': {
      const summary = message.summary || '';
      const m = summary.match(/^step (\d+):\s+(.*?)\s+→\s+(.*)$/);
      if (m) {
        stepCounter = Math.max(stepCounter, Number(m[1]));
        appendCard({
          kind: 'action',
          icon: iconFor(actionKind(m[2])),
          title: m[2],
          meta: m[3],
          live: true,
        });
        updateStepCount();
      } else {
        appendCard({ kind: 'log', icon: 'icon-nav', title: summary, meta: '', live: true });
      }
      break;
    }
    case 'canonical_error':
      appendCard({ kind: 'error', icon: 'icon-err', title: message.code || 'Error', meta: message.message || '' });
      break;
    case 'canonical_approval':
      appendCard({
        kind: 'prompt',
        icon: 'icon-qu',
        title: 'Approval required',
        body: message.request?.reason || 'The agent wants to take an action that requires your approval.',
        actions: [
          { label: 'Approve', kind: 'primary', onClick: () => sendMessage({ type: 'approve_action' }) },
          { label: 'Deny', kind: 'danger', onClick: () => sendMessage({ type: 'deny_action' }) },
        ],
      });
      updateStatus('Paused', 'paused');
      break;
    case 'canonical_user_input':
      appendCard({
        kind: 'prompt',
        icon: 'icon-qu',
        title: 'Clarifying question',
        body: message.question || 'The agent needs more information.',
        input: { placeholder: 'Your answer…' },
        actions: [
          { label: 'Submit', kind: 'primary', onClick: (value) => sendMessage({ type: 'submit_user_input', value: value || '' }) },
        ],
      });
      break;
    case 'login_required':
      appendCard({
        kind: 'prompt',
        icon: 'icon-qu',
        title: `Login required: ${message.domain || 'site'}`,
        body: `Please sign in to ${message.domain || 'this site'} directly in the browser tab, then click Continue.`,
        url: message.url,
        actions: [
          { label: 'Continue', kind: 'primary', onClick: () => void loginContinue() },
          { label: 'Skip task', kind: 'danger', onClick: () => sendMessage({ type: 'cancel_local_task' }) },
        ],
      });
      updateStatus('Paused', 'paused');
      break;
    case 'task_completed':
      stepCounter = Math.max(stepCounter, message.steps || stepCounter);
      appendCard({
        kind: 'done',
        icon: 'icon-term',
        title: `Completed in ${message.steps || stepCounter} steps`,
        meta: message.summary || '',
      });
      updateStatus('Done', 'done');
      updateStepCount();
      runBtn.hidden = false;
      cancelBtn.hidden = true;
      break;
  }
});

function actionKind(s) {
  if (s.startsWith('left_click') || s.startsWith('double_click') || s.startsWith('right_click')) return s.split(' ')[0];
  if (s.startsWith('insert_text')) return 'insert_text';
  if (s.startsWith('key')) return 'key';
  if (s.startsWith('visit_url') || s.startsWith('history_back')) return 'visit_url';
  if (s.startsWith('scroll')) return 'scroll';
  if (s.startsWith('wait')) return 'wait';
  if (s.startsWith('terminate')) return 'terminate';
  return s;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      resolve(err ? { success: false, error: err.message } : response || { success: false, error: 'No response' });
    });
  });
}
