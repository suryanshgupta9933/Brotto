const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const taskInput = document.getElementById('taskInput');
const sendTaskBtn = document.getElementById('sendTaskBtn');
const cancelTaskBtn = document.getElementById('cancelTaskBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const logContent = document.getElementById('logContent');
const approvalPanel = document.getElementById('approvalPanel');
const approvalReason = document.getElementById('approvalReason');
const approveBtn = document.getElementById('approveBtn');
const denyBtn = document.getElementById('denyBtn');
const resultPanel = document.getElementById('resultPanel');
const resultContent = document.getElementById('resultContent');
const loginPrompt = document.getElementById('loginPrompt');
const loginDoneBtn = document.getElementById('loginDoneBtn');
const localTaskInput = document.getElementById('localTaskInput');
const localStartingUrl = document.getElementById('localStartingUrl');
const localPlannerUrl = document.getElementById('localPlannerUrl');
const runLocalBtn = document.getElementById('runLocalBtn');
const cancelLocalBtn = document.getElementById('cancelLocalBtn');

// ponytail: track which mode is awaiting the login-pause click so the same
// "Interaction complete" button can serve either the canonical or local flow.
let localLoginMode = false;

document.addEventListener('DOMContentLoaded', () => { void initialize(); });

async function initialize() {
  sendTaskBtn.addEventListener('click', () => { void sendTask(); });
  cancelTaskBtn.addEventListener('click', () => { void cancelTask(); });
  clearLogBtn.addEventListener('click', () => { void clearTrajectory(); });
  approveBtn.addEventListener('click', () => { void resolveApproval(true); });
  denyBtn.addEventListener('click', () => { void resolveApproval(false); });
  runLocalBtn.addEventListener('click', () => { void runLocalTask(); });
  cancelLocalBtn.addEventListener('click', () => { void cancelLocalTask(); });
  loginDoneBtn.addEventListener('click', () => { void loginComplete(); });
  taskInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void sendTask();
  });
  localTaskInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void runLocalTask();
  });
  await refreshState();
}

async function refreshState() {
  const response = await sendMessage({ type: 'get_connection_status' });
  if (!response.success) {
    updateStatus('failed');
    appendLog('Unable to read canonical session state', 'error');
    return;
  }
  const recovery = response.status?.recovery;
  updateStatus(recovery?.status || 'disconnected', response.status?.reconnect?.reconnectAttempt);
  renderTrajectory(response.status?.trajectory || []);
  if (response.status?.terminal) renderTerminal(response.status.terminal);
  if (response.status?.approval) {
    approvalReason.textContent = response.status.approval.reason;
    approvalPanel.hidden = false;
  } else {
    approvalPanel.hidden = true;
  }
}

async function sendTask() {
  const task = taskInput.value.trim();
  if (!task) return;
  updateStatus('connecting');
  appendLog('Starting authenticated canonical session', 'connection');
  sendTaskBtn.disabled = true;
  try {
    const response = await sendMessage({ type: 'send_task', task });
    if (!response.success) throw new Error(response.error || 'Task start failed');
    taskInput.value = '';
  } catch (error) {
    updateStatus('failed');
    appendLog(error instanceof Error ? error.message : 'Task start failed', 'error');
  } finally {
    sendTaskBtn.disabled = false;
  }
}

async function cancelTask() {
  cancelTaskBtn.disabled = true;
  const response = await sendMessage({ type: 'cancel_task', reason: 'User cancelled from the extension popup' });
  if (!response.success) appendLog(response.error || 'Cancellation failed', 'error');
  cancelTaskBtn.disabled = false;
}

async function resolveApproval(approved) {
  approveBtn.disabled = true;
  denyBtn.disabled = true;
  const response = await sendMessage({ type: approved ? 'approve_action' : 'deny_action' });
  if (!response.success) appendLog(response.error || 'Approval response failed', 'error');
  else approvalPanel.hidden = true;
  approveBtn.disabled = false;
  denyBtn.disabled = false;
}

async function loginComplete() {
  // ponytail: dispatch to whichever mode is awaiting the click. localLoginMode
  // is set true when the local-driver emits login_required.
  if (localLoginMode) {
    const response = await sendMessage({ type: 'local_login_complete' });
    if (!response.success) appendLog(response.error || 'Local login complete failed', 'error');
    localLoginMode = false;
  } else {
    const response = await sendMessage({ type: 'login_complete' });
    if (!response.success) appendLog(response.error || 'Fresh observation failed', 'error');
  }
  loginPrompt.hidden = true;
}

async function runLocalTask() {
  const goal = (localTaskInput.value || '').trim();
  if (goal.length === 0) {
    appendLog('Local task is empty', 'error');
    return;
  }
  const startingUrl = (localStartingUrl.value || '').trim();
  const plannerUrl = (localPlannerUrl.value || '').trim();
  const message = { type: 'run_local_task', task: goal };
  if (startingUrl) message.startingUrl = startingUrl;
  if (plannerUrl) message.plannerUrl = plannerUrl;
  const response = await sendMessage(message);
  if (!response.success) {
    appendLog(response.error || 'run_local_task failed', 'error');
    return;
  }
  runLocalBtn.hidden = true;
  cancelLocalBtn.hidden = false;
  resultPanel.hidden = true;
  updateStatus('executing');
}

async function cancelLocalTask() {
  const response = await sendMessage({ type: 'cancel_local_task' });
  if (!response.success) appendLog(response.error || 'cancel_local_task failed', 'error');
  cancelLocalBtn.hidden = true;
  runLocalBtn.hidden = false;
}

async function clearTrajectory() {
  await sendMessage({ type: 'clear_trajectory' });
  logContent.replaceChildren(emptyLog());
}

function updateStatus(status, reconnectAttempt = 0) {
  const active = ['connected', 'executing', 'waiting_for_approval', 'reconnecting', 'connecting', 'cancelling'].includes(status);
  statusBadge.className = `status-badge ${status}`;
  const labels = {
    connected: 'Connected',
    executing: 'Executing',
    waiting_for_approval: 'Approval required',
    reconnecting: `Reconnecting${reconnectAttempt ? ` (${reconnectAttempt})` : ''}`,
    connecting: 'Connecting',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    completed: 'Completed',
    failed: 'Failed',
    disconnected: 'Disconnected',
  };
  statusText.textContent = labels[status] || 'Disconnected';
  cancelTaskBtn.hidden = !active;
}

function renderTrajectory(events) {
  logContent.replaceChildren();
  if (!events.length) {
    logContent.appendChild(emptyLog());
    return;
  }
  for (const event of events) appendLog(event.summary, event.type, event.occurredAt);
}

function appendLog(summary, type = 'connection', occurredAt = new Date().toISOString()) {
  logContent.querySelector('.log-empty')?.remove();
  const row = document.createElement('div');
  row.className = `log-entry ${type}`;
  const time = document.createElement('time');
  time.dateTime = occurredAt;
  time.textContent = new Date(occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const message = document.createElement('span');
  message.textContent = summary;
  row.append(time, message);
  logContent.appendChild(row);
  logContent.scrollTop = logContent.scrollHeight;
}

function emptyLog() {
  const element = document.createElement('div');
  element.className = 'log-empty';
  element.textContent = 'No canonical steps yet.';
  return element;
}

function renderTerminal(message) {
  resultContent.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = message.type === 'task.completed' ? 'Task completed' : message.type === 'task.failed' ? 'Task failed' : 'Task cancelled';
  resultContent.appendChild(heading);
  if (message.completion) {
    const status = document.createElement('p');
    status.textContent = `Status: ${message.completion.status}`;
    const observation = document.createElement('p');
    observation.textContent = `Observation: ${message.completion.observationId}`;
    const confidence = document.createElement('p');
    confidence.textContent = `Confidence: ${message.completion.confidence}`;
    const summary = document.createElement('p');
    summary.textContent = message.completion.summary;
    resultContent.append(status, observation, confidence, summary);
    if (message.completion.findings.length) {
      const findingsHeading = document.createElement('h4');
      findingsHeading.textContent = 'Findings';
      const findings = document.createElement('ul');
      for (const finding of message.completion.findings) {
        const item = document.createElement('li');
        const fact = document.createElement('div');
        fact.textContent = finding.fact;
        const evidence = document.createElement('div');
        evidence.className = 'subtle';
        evidence.textContent = `Evidence observations: ${finding.observationIds.join(', ')}`;
        item.append(fact, evidence);
        findings.appendChild(item);
      }
      resultContent.append(findingsHeading, findings);
    }
    if (message.completion.unmetCriteria.length) {
      const unmetHeading = document.createElement('h4');
      unmetHeading.textContent = 'Unmet criteria';
      const unmet = document.createElement('ul');
      for (const criterion of message.completion.unmetCriteria) {
        const item = document.createElement('li');
        item.textContent = criterion;
        unmet.appendChild(item);
      }
      resultContent.append(unmetHeading, unmet);
    }
  } else if (message.reason) {
    const reason = document.createElement('p');
    reason.textContent = message.reason;
    resultContent.appendChild(reason);
  }
  resultPanel.hidden = false;
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'canonical_status':
      updateStatus(message.status, message.reconnectAttempt);
      break;
    case 'canonical_reconnect':
      updateStatus(message.status === 'failed' ? 'failed' : 'reconnecting', message.attempt);
      appendLog(message.status === 'failed' ? 'Reconnect limit reached' : 'Reconnecting canonical session', message.status === 'failed' ? 'error' : 'connection');
      break;
    case 'canonical_step':
      appendLog(message.summary, 'action');
      break;
    case 'canonical_approval':
      approvalReason.textContent = message.request.reason;
      approvalPanel.hidden = false;
      updateStatus('waiting_for_approval');
      break;
    case 'canonical_terminal':
      renderTerminal(message.message);
      updateStatus(message.message.type === 'task.completed' ? 'completed' : message.message.type === 'task.failed' ? 'failed' : 'cancelled');
      break;
    case 'canonical_error':
      appendLog(`${message.code}: ${message.message}`, 'error');
      break;
    case 'canonical_user_input':
      loginPrompt.hidden = false;
      break;
    case 'login_required':
      // ponytail: local-driver hit a login page. Flip the flag so the next
      // loginDoneBtn click dispatches local_login_complete instead of the
      // canonical login_complete message.
      localLoginMode = true;
      loginPrompt.hidden = false;
      approvalReason.textContent = `Please log in to ${message.domain || 'the site'} in the attached tab, then click Continue.`;
      approvalPanel.hidden = false;
      updateStatus('waiting_for_approval');
      break;
    case 'task_completed':
      cancelLocalBtn.hidden = true;
      runLocalBtn.hidden = false;
      updateStatus('completed');
      resultContent.innerHTML = '';
      const heading = document.createElement('h2');
      heading.textContent = `Completed in ${message.steps} steps`;
      resultContent.appendChild(heading);
      const summary = document.createElement('p');
      summary.textContent = message.summary || '';
      resultContent.appendChild(summary);
      resultPanel.hidden = false;
      break;
  }
});

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { success: false, error: error.message } : response || { success: false, error: 'No response' });
    });
  });
}
