// sidepanel.js — chat UI rewrite for the Brotto side panel.
// Preserves all event handlers, state machine, and message listeners.
// Only rendering functions are updated to produce the Claude-in-Chrome chat interface.

// Static catalog mirrors the Python PROVIDER_REGISTRY. Keep in sync with
// services/brotto-orchestrator/src/brotto_orchestrator/model/registry.py.
// MiniMax-M3.1-Flash-Preview = Token Plan (covered). MiniMax-M3 =
// pay-as-you-go with separate credits.
const MODEL_CATALOG = {
  anthropic: [
    { model: "claude-3-5-sonnet-latest", context_window: 200000 },
  ],
  openai: [
    { model: "gpt-4o", context_window: 128000 },
    { model: "o1", context_window: 200000 },
  ],
  minimax: [
    { model: "MiniMax-M3.1-Flash-Preview", context_window: 1000000 },
    { model: "MiniMax-M3", context_window: 1000000 },
    { model: "MiniMax-M2.7", context_window: 204800 },
  ],
};

const $modelProvider = document.getElementById('model-provider');
const $modelName = document.getElementById('model-name');
const $modelKey = document.getElementById('model-api-key');
const $modelSave = document.getElementById('model-save');
const $modelStatus = document.getElementById('model-save-status');

function populateModelOptions() {
  const provider = $modelProvider.value;
  const catalog = MODEL_CATALOG[provider] || [];
  $modelName.textContent = '';
  for (const entry of catalog) {
    const opt = document.createElement('option');
    opt.value = entry.model;
    opt.textContent = entry.model;
    $modelName.appendChild(opt);
  }
}

if ($modelProvider) {
  $modelProvider.addEventListener('change', populateModelOptions);
  populateModelOptions();
}

if ($modelSave) {
  $modelSave.addEventListener('click', async () => {
    const provider = $modelProvider.value;
    const model = $modelName.value;
    const catalog = MODEL_CATALOG[provider] || [];
    const ctx = catalog.find((e) => e.model === model)?.context_window;
    // model_config → chrome.storage.local (persists).
    // api_key → chrome.storage.session (in-memory; cleared on browser restart).
    await Promise.all([
      chrome.storage.local.set({
        modelConfig: { provider, model, context_window: ctx },
      }),
      $modelKey.value.trim()
        ? chrome.storage.session.set({ modelApiKey: $modelKey.value.trim() })
        : chrome.storage.session.remove('modelApiKey'),
    ]);
    setModelPill(model);
    if ($modelStatus) {
      $modelStatus.textContent = 'Saved.';
      setTimeout(() => { $modelStatus.textContent = ''; }, 2000);
    }
  });
}

// ponytail: the header pill names the model the agent is actually running.
// Storage is the only source the panel has — the server's resolved config
// (env var, per-IP file) isn't visible from here, so the pill shows what
// this browser last saved and nothing more.
function setModelPill(model) {
  if (!modelPillName) return;
  const label = model || 'Default';
  // Two copies of the name: the track travels exactly one copy's width, so
  // the tail hands off to the head without a visible seam.
  const track = document.createElement('div');
  track.className = 'model-pill-track';
  for (let i = 0; i < 2; i++) {
    const copy = document.createElement('span');
    copy.textContent = label;
    // Only the head is content; the tail exists to hand off visually and
    // would otherwise be announced as a second model name.
    if (i) copy.setAttribute('aria-hidden', 'true');
    track.appendChild(copy);
  }
  modelPillName.replaceChildren(track);
  if (modelPill) modelPill.title = `${model ? 'Model: ' + model : 'Model: server default'} — open settings to change it`;
  fitModelPill();
  // Geist may still be loading when this first runs, which would measure the
  // fallback face and under-report the overflow.
  document.fonts?.ready.then(fitModelPill);
}

// A name that fits sits dead still; only an overflowing one travels. Measuring
// beats guessing — a marquee that always runs makes "gpt-4o" drift pointlessly.
// Compare one copy (plus the gap it needs to hand off) against the window, so
// the decision never depends on the two-copy track's own width.
function fitModelPill() {
  const copy = modelPillName?.firstElementChild?.firstElementChild;
  if (!copy) return;
  const gap = parseFloat(getComputedStyle(copy).paddingRight) || 0;
  modelPillName.classList.toggle('marquee', copy.offsetWidth + gap > modelPillName.clientWidth);
}

async function hydrateModelSettings() {
  const stored = await chrome.storage.local.get('modelConfig');
  const raw = stored.modelConfig;
  // The stored shape has been flat since the migration in model_config.ts;
  // the nested form is what a pre-migration install left behind. Reading
  // only the nested shape meant a freshly saved config never came back, so
  // the pill read "Default" and re-saving the API key reverted the model.
  const cfg = raw && typeof raw.provider === 'string' ? raw : raw?.model_config;
  if (cfg) {
    if ($modelProvider) $modelProvider.value = cfg.provider;
    populateModelOptions();
    if ($modelName) $modelName.value = cfg.model;
    setModelPill(cfg.model);
  } else {
    setModelPill(null);
  }
  // Don't re-hydrate the API key field — it's in chrome.storage.session
  // and we deliberately don't surface it in the UI (no plaintext display).
}
hydrateModelSettings();

const messagesEl  = document.getElementById('messages');
const emptyState   = document.getElementById('emptyState');
const goalEl       = document.getElementById('goal');
const sendBtn      = document.getElementById('sendBtn');
const stopBtn      = document.getElementById('stopBtn');
const composerHint = document.getElementById('composerHint');
const modelPill    = document.getElementById('modelPill');
const modelSpinner = document.getElementById('modelSpinner');
const modelPillName = document.getElementById('modelPillName');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel   = document.getElementById('settingsPanel');
const settingsClose   = document.getElementById('settingsClose');
const plannerUrlSetting = document.getElementById('plannerUrlSetting');

// Preserved DOM IDs for background.ts compatibility
const plannerUrlEl    = document.getElementById('plannerUrl');
const startingUrlEl   = document.getElementById('startingUrl');
const refreshBtn      = document.getElementById('refreshBtn');
const brandDot        = document.getElementById('brandDot');
const stepCountEl     = document.getElementById('stepCount');
const timerEl         = document.getElementById('timer');
const statusBarEl     = document.getElementById('statusBar');
const stepCountActive = document.getElementById('stepCountActive');
const timerActiveEl   = document.getElementById('timerActive');
const newTaskBtn      = document.getElementById('newTaskBtn');
const connectionMeta  = document.getElementById('connectionMeta');
const statusPill      = document.getElementById('statusPill');
const connLabelEl     = document.getElementById('connLabel');

// ponytail: soft length cap on user task input. Tasks over this many chars
// trigger a confirm() before send; matching server warning at the same
// threshold (defense in depth). Not a hard block — the user is the
// final authority on what they want the agent to do.
const MAX_TASK_CHARS = 1000;

// ── Settings panel ────────────────────────────────────────────────────────
// (handlers below — reads chrome.storage.local, writes on Save)

// ponytail: the TABS cell is the only tab surface — the old "Tabs opened"
// lifecycle list was removed, but the events still feed the count.
const seenTabs = new Map(); // tabId → {kind, url, title, lastUpdate}
function recordTabEvent(ev) {
  if (!ev) return;
  if (ev.kind === 'closed') {
    seenTabs.delete(ev.tabId);
  } else {
    seenTabs.set(ev.tabId, { tabId: ev.tabId, kind: ev.kind, url: ev.url, title: ev.title });
  }
  updateTabCount();
}
function updateTabCount() {
  const value = document.getElementById('tabCountActive');
  if (value) value.textContent = String(seenTabs.size);
}

// ponytail: context utilization cell — backend is the source of truth.
// The harness emits `{tokens, window, pct}` per step (pct is the actual
// model-reported usage / model's context window). The frontend just
// renders the latest values stored on state. The `/context` endpoint
// fetches the model's window on init so the baseline is right before
// any step arrives.
function updateContextUsage() {
  const cell = document.getElementById('contextCell');
  const value = document.getElementById('contextValue');
  if (!cell || !value) return;
  const { tokens, window, pct } = state.lastContext || {};
  if (tokens == null || pct == null) {
    value.textContent = '0%';
    value.title = window
      ? `${window.toLocaleString()} tokens window`
      : 'no context yet';
    cell.hidden = false;
    return;
  }
  // ponytail: backend emits pct to one decimal. Drop trailing zeros
  // so 25.0 → "25%", 12.5 → "12.5%", 2.5 → "2.5%".
  const displayPct = +pct.toFixed(1);
  value.textContent = `${displayPct}%`;
  value.title = `${tokens.toLocaleString()} / ${window.toLocaleString()} tokens (${pct}%)`;
  cell.hidden = false;
}

// ponytail: ask the SW to fetch the model's context window from the
// backend. The SW proxies through the configured serverUrl so we don't
// duplicate that config on the sidepanel. Cached on state.contextWindow
// after the first hit; called on init and on connect.
async function fetchContextWindow() {
  try {
    const res = await sendMessage({ type: 'get_context' });
    if (!res || !res.success || !res.context) return;
    const { window } = res.context;
    if (typeof window !== 'number') return;
    state.contextWindow = window;
    state.contextModel = res.context.model;
    if (!state.lastContext) state.lastContext = { tokens: null, window, pct: null };
    else state.lastContext.window = window;
    updateContextUsage();
  } catch { /* offline / not running — backend will fill it in */ }
}
settingsClose.addEventListener('click', () => settingsOverlay.classList.remove('open'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
});
plannerUrlSetting.addEventListener('input', () => {
  plannerUrlEl.value = plannerUrlSetting.value;
});

// ── Session history ────────────────────────────────────────────────────────
const historyBtn     = document.getElementById('historyBtn');
const historyOverlay = document.getElementById('historyOverlay');
const historyClose   = document.getElementById('historyClose');
const historyList    = document.getElementById('historyList');
const transcriptEl   = document.getElementById('historyTranscript');
const transcriptBody = document.getElementById('transcriptBody');
const transcriptMeta = document.getElementById('transcriptMeta');
const transcriptBack = document.getElementById('transcriptBack');
const transcriptRun  = document.getElementById('transcriptRun');

historyBtn.addEventListener('click', async () => {
  historyOverlay.classList.add('open');
  await renderHistory();
});
historyClose.addEventListener('click', () => historyOverlay.classList.remove('open'));
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) historyOverlay.classList.remove('open');
});

// ponytail: sessions are a flat chrome.storage.local list, newest first,
// capped so the panel's boot read stays trivial. The list is read on every
// history open rather than held in memory — the whole point is that it
// survives the panel being closed.
const SESSION_LIMIT = 20;
const SESSIONS_KEY = 'sessions';

async function listSessions() {
  const { sessions } = await chrome.storage.local.get(SESSIONS_KEY);
  return Array.isArray(sessions) ? sessions : [];
}

// ponytail: one writer, one reader, one shape. Called from both terminal
// handlers; `status` is what renderHistory maps to the row's mark.
async function saveSession({ status, steps, elapsed }) {
  const task = (state.lastGoal || '').trim();
  if (!task) return;
  const sessions = await listSessions();
  // Every panel open replays the run's buffered events, so the terminal event
  // arrives again for a task already recorded — 20 opens was enough to evict
  // every real task from the list. `session_id` is the real identity and
  // survives the replay; `startedAt` stays the fallback for rows written
  // before the panel ever saw a session id, so upgrading doesn't duplicate
  // every existing entry.
  //
  // A conversation is one row, so a follow-up task finds the row its first
  // task wrote and updates it. `state.taskCount` is what tells that apart
  // from the replay above: it is set only by a send this panel watched
  // happen, and a replay on a freshly opened panel has none.
  const sid = state.sessionId;
  if (sid) {
    const existing = sessions.find((s) => s.session_id === sid);
    if (existing) {
      if (!state.taskCount) return;
      // `task` is left alone: a conversation is named after how it started,
      // which is also what the server's own session index reports.
      existing.task_count = state.taskCount;
      existing.status = status;
      existing.steps = steps || state.stepCount || 0;
      existing.elapsed = elapsed || '—';
      await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
      return;
    }
  } else if (state.startTime && sessions[0]?.startedAt === state.startTime) {
    return;
  }
  sessions.unshift({
    task,
    status,
    steps: steps || state.stepCount || 0,
    elapsed: elapsed || '—',
    startedAt: state.startTime || Date.now(),
    session_id: sid || null,
    task_count: state.taskCount || 1,
  });
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions.slice(0, SESSION_LIMIT) });
}

function formatSessionTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return `Today · ${clock}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${clock}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${clock}`;
}

async function renderHistory() {
  // Reopening history always lands on the list, never back into whatever
  // transcript the last row click opened.
  transcriptEl.hidden = true;
  historyList.hidden = false;
  const sessions = await listSessions();
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.innerHTML = '<strong>No tasks yet</strong>Every task you finish is listed here. '
      + 'Click one to see what it did.';
    historyList.replaceChildren(empty);
    return;
  }
  historyList.replaceChildren(...sessions.map((s) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-item';
    row.dataset.status = s.status || 'done';
    row.innerHTML = '<span class="history-mark"></span><span><span class="history-task"></span>'
      + '<span class="history-meta"></span></span>';
    row.querySelector('.history-task').textContent = s.task || '(no task text)';
    // A row you can't act on is a lie about what history is for. The document
    // on the server holds everything the run produced, so the click opens it;
    // the Re-run button inside carries the composer refill this used to be.
    row.title = s.session_id ? 'Open this session' : 'Put this task back in the box';
    row.addEventListener('click', () => void openTranscript(s));
    // A row written before tasks existed carries no count, and "1 task" beside
    // the task's own text says nothing the text did not.
    const bits = [
      s.task_count > 1 ? `${s.task_count} tasks` : null,
      s.steps + ' steps',
      s.elapsed || '—',
      formatSessionTime(s.startedAt),
    ].filter(Boolean);
    const meta = row.querySelector('.history-meta');
    bits.forEach((b, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '/';
        meta.appendChild(sep);
      }
      const span = document.createElement('span');
      span.textContent = b;
      if (i === bits.length - 1) span.className = 'when';
      meta.appendChild(span);
    });
    return row;
  }));
}

// ── Session transcript ─────────────────────────────────────────────────────
// The detail half of history. The index is deliberately a summary, so this
// is the one place the panel talks to the server to read what a run actually
// did, and the one place a failure has to stay survivable: a row click that
// cannot reach the server must still put the task back in the box, because
// losing the ability to re-run something is a regression, not a degradation.

function txEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ponytail: a 8k-char audit field is a page of page text, and the panel is
// 340px wide. Show the head and say so. Upgrade path if someone wants the
// rest: a <details> that mounts the full string on demand.
function txPreview(value, limit = 400) {
  const s = String(value || '');
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `… +${s.length - limit} chars`;
}

function txBlock(label, text, className) {
  const block = txEl('div', 'tx-block');
  block.appendChild(txEl('div', 'label', label));
  block.appendChild(txEl('div', 'tx-text' + (className ? ' ' + className : ''), text));
  return block;
}

function txMetaLine(parts) {
  const meta = txEl('div', 'history-meta');
  parts.filter(Boolean).forEach((b, i) => {
    if (i) meta.appendChild(txEl('span', 'sep', '/'));
    meta.appendChild(txEl('span', null, b));
  });
  return meta;
}

function refillComposer(task) {
  goalEl.value = task || '';
  historyOverlay.classList.remove('open');
  transcriptEl.hidden = true;
  historyList.hidden = false;
  goalEl.focus();
}

async function fetchAudit(sessionId) {
  // Same base as the panel's other server calls (fetchSuggestions, settings
  // verify): the settings field is the source of truth, and state.plannerUrl
  // is empty until a task has connected at least once in this panel.
  const base = (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/sessions/${encodeURIComponent(sessionId)}/audit`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let transcriptRequest = 0;

async function openTranscript(entry) {
  if (!entry.session_id) {
    // A row written before the panel ever saw a session id. Nothing to fetch,
    // so do exactly what the row always did.
    refillComposer(entry.task);
    return;
  }
  const request = ++transcriptRequest;
  let doc;
  try {
    doc = await fetchAudit(entry.session_id);
  } catch {
    toast('Could not load session — putting the task back in the box', 'bad', 4000);
    refillComposer(entry.task);
    return;
  }
  // A superseded click must not paint over the one the user is waiting on.
  if (request !== transcriptRequest) return;
  if (!doc || doc.found === false) {
    toast('Session not found on the server — putting the task back in the box', 'bad', 4000);
    refillComposer(entry.task);
    return;
  }
  historyList.hidden = true;
  transcriptEl.hidden = false;
  renderTranscript(doc, entry);
}

function renderTranscript(doc, entry) {
  const totals = doc.totals || {};
  const status = String(doc.status || 'unknown');
  transcriptMeta.textContent = status + (totals.steps ? ` · ${totals.steps} steps` : '');
  transcriptBody.replaceChildren();

  transcriptRun.onclick = () => refillComposer((doc.goal || entry.task || '').trim());

  if (doc.corrupt) {
    transcriptBody.appendChild(txEl(
      'div', 'tx-empty', 'This session is damaged — its log could not be read back.',
    ));
  } else {
    const tasks = (doc.schema_version >= 2 && Array.isArray(doc.tasks)) ? doc.tasks : null;
    if (tasks && tasks.length) {
      // ponytail: the task header *is* the user message — the server writes
      // the same string to both — so it is shown once, as the heading. The
      // join is messages[].turn → turns[]; both ways the join can leave
      // something behind (a turn whose step was aborted never got a message,
      // a message can point at a turn that isn't there) are swept after it,
      // because the alternative is silently losing audit detail this panel
      // has always shown.
      const messages = (Array.isArray(doc.messages) ? doc.messages : [])
        .filter((m) => m.role === 'assistant');
      const turns = Array.isArray(doc.turns) ? doc.turns : [];
      const joined = new Set();
      tasks.forEach((task, i) => {
        const index = task.index ?? i;
        const group = txEl('div', 'tx-block');
        group.appendChild(txEl('div', 'label', `Task ${index + 1}`));
        group.appendChild(txEl('div', 'tx-text', task.goal || ''));
        transcriptBody.appendChild(group);
        messages.filter((m) => (m.task ?? 0) === index).forEach((m) => {
          if (m.turn != null && turns[m.turn]) {
            joined.add(m.turn);
            transcriptBody.appendChild(renderTurn(turns[m.turn]));
          } else {
            transcriptBody.appendChild(txBlock('Reply', txPreview(m.content)));
          }
        });
        turns.forEach((t, n) => {
          if ((t.task ?? 0) === index && !joined.has(n)) transcriptBody.appendChild(renderTurn(t));
        });
      });
      if (doc.result) transcriptBody.appendChild(renderResult(doc.result));
    } else {
      if (doc.goal) transcriptBody.appendChild(txBlock('Task', doc.goal));
      const turns = Array.isArray(doc.turns) ? doc.turns : [];
      if (!turns.length) {
        transcriptBody.appendChild(txEl('div', 'tx-empty', 'This session recorded no steps.'));
      }
      turns.forEach((t) => transcriptBody.appendChild(renderTurn(t)));
      if (doc.result) transcriptBody.appendChild(renderResult(doc.result));
    }
  }

  // Writer failures and run failures share `errors`, and both carry an
  // error_id — six characters that tie the line here to the server log and
  // to a support report.
  (Array.isArray(doc.errors) ? doc.errors : []).forEach((e) => {
    const block = txBlock(
      'Error' + (e.error_id ? ` · ${e.error_id}` : ''),
      `${e.code || 'error'}${e.where ? ` · ${e.where}` : ''}\n${txPreview(e.message)}`,
      'tx-bad',
    );
    block.querySelector('.tx-text').style.whiteSpace = 'pre-wrap';
    transcriptBody.appendChild(block);
  });

  const bits = [
    totals.tokens_in || totals.tokens_out
      ? `${totals.tokens_in || 0} in / ${totals.tokens_out || 0} out tokens`
      : null,
    totals.wall_s ? `${Number(totals.wall_s).toFixed(1)}s wall` : null,
    totals.prompts ? `${totals.prompts} prompts` : null,
  ];
  if (bits.filter(Boolean).length) {
    transcriptBody.appendChild(txMetaLine(bits));
  }
}

function renderTurn(turn) {
  const block = txEl('div', 'tx-block');
  const obs = turn.observation || {};
  const m = turn.model;

  // `ended_at` is null until the turn closes, so a run killed mid-step reads
  // as interrupted rather than as a turn that never happened.
  const interrupted = !turn.ended_at;
  block.appendChild(txEl(
    'div', 'label', `Step ${(turn.step ?? 0) + 1}` + (interrupted ? ' · interrupted' : ''),
  ));
  if (obs.page_title || obs.url) {
    block.appendChild(txEl('div', 'tx-url', txPreview(obs.url || obs.page_title, 120)));
  }
  if (m && (m.thought || m.reasoning)) {
    block.appendChild(txEl('div', 'tx-text', txPreview(m.thought || m.reasoning)));
  }
  if (m) {
    block.appendChild(txMetaLine([
      m.model || null,
      m.tokens_in || m.tokens_out ? `${m.tokens_in || 0}/${m.tokens_out || 0} tok` : null,
      m.latency_ms ? `${m.latency_ms}ms` : null,
      m.context_pct ? `${Math.round(m.context_pct * 100)}% ctx` : null,
    ]));
  }

  // Causal order within a turn is model → prompts → actions: a prompt is
  // raised after the model decides and before the action runs.
  (Array.isArray(turn.prompts) ? turn.prompts : []).forEach((p) => {
    const card = txEl('div', 'tx-prompt');
    card.dataset.status = p.status || '';
    card.dataset.decision = p.decision || '';
    card.appendChild(txEl(
      'div', 'label',
      `${(p.kind || 'prompt').replace(/_/g, ' ')} · ${p.action || 'action'}`,
    ));
    if (p.reason) card.appendChild(txEl('div', 'tx-text', txPreview(p.reason)));
    // A prompt still "pending" is a socket that died between raising and
    // answering — not a denial, and it must not read as one.
    const outcome = p.status === 'pending'
      ? 'never answered'
      : (p.decision || p.status || '—');
    const line = outcome + (p.response ? ` · “${txPreview(p.response, 160)}”` : '');
    const cls = p.status === 'pending' ? 'tx-wait' : p.decision === 'denied' ? 'tx-bad' : '';
    card.appendChild(txEl('div', 'tx-text ' + cls, line));
    block.appendChild(card);
  });

  (Array.isArray(turn.actions) ? turn.actions : []).forEach((a) => {
    const line = txEl('div', 'tx-text', `${a.action || 'action'}${a.outcome ? ` — ${txPreview(a.outcome, 200)}` : ''}`);
    if (a.ok === false) line.classList.add('tx-bad');
    block.appendChild(line);
  });

  if (turn.error) {
    block.appendChild(txEl(
      'div', 'tx-text tx-bad',
      `${turn.error.code || 'error'}${turn.error.error_id ? ` · ${turn.error.error_id}` : ''} — ${txPreview(turn.error.message)}`,
    ));
  }
  return block;
}

function renderResult(result) {
  const block = txEl('div', 'tx-block');
  const failed = result.status && result.status !== 'completed';
  block.appendChild(txEl(
    'div', 'label', failed ? `Result · ${result.status}` : 'Result',
  ));
  // The same thing the live path shows, from the same field: the summary for
  // a completed run, the failure reason for anything else, plus the error id
  // when the run produced one.
  const text = (failed
    ? (result.failure_reason || result.summary || 'Task failed')
    : (result.summary || 'Task complete'));
  block.appendChild(txEl('div', 'tx-text' + (failed ? ' tx-bad' : ''), text));
  if (result.error_id) {
    block.appendChild(txEl('div', 'tx-url', `error ${result.error_id}`));
  }
  if (result.final_url) {
    block.appendChild(txEl('div', 'tx-url', txPreview(result.final_url, 120)));
  }
  return block;
}

transcriptBack.addEventListener('click', () => void renderHistory());


// ── Settings: load + save (first chrome.storage.local writes — today the
// SW only reads `get("settings")`, so this is the seed for that key).
const securityModeSetting = document.getElementById('securityModeSetting');
const blacklistSetting    = document.getElementById('blacklistSetting');
const saveSettingsBtn     = document.getElementById('saveSettingsBtn');
const refreshPolicyBtn    = document.getElementById('refreshPolicyBtn');
const notifyBlockingSetting = document.getElementById('notifyBlockingSetting');
const notifyResultsSetting  = document.getElementById('notifyResultsSetting');
const replaySetupBtn        = document.getElementById('replaySetupBtn');

// setOptions re-points the panel; it has no gesture requirement, so the
// wizard replaces this page on the next open rather than in a new tab.
if (replaySetupBtn) {
  replaySetupBtn.addEventListener('click', () => {
    void chrome.sidePanel.setOptions({ path: 'welcome.html' });
  });
}

// ponytail: on Settings open, confirm the server is reachable so the
// footer can say whether these settings are grounded in a live server or
// are sitting in a local cache against a dead one.
settingsBtn.addEventListener('click', async () => {
  plannerUrlSetting.value = plannerUrlEl.value || 'http://localhost:8000';
  await hydrateSettingsPanel();
  settingsOverlay.classList.add('open');
  renderVerifyStatus();
});

// ponytail: the pill names the model, and the model is set in Settings —
// making the only place that shows it a way in to the only place that
// changes it. Same handler as the gear, so the two can't drift.
modelPill.addEventListener('click', () => settingsBtn.click());
modelPill.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); settingsBtn.click(); }
});

// ponytail: Q1 — extracted so the Refresh button can re-run the same
// fetch + render flow without re-opening the panel.
async function hydrateSettingsPanel() {
  // ponytail: chrome.storage.local is the AUTHORITATIVE source for what
  // the SW will ship on the next task_start, so the fields are filled from
  // it and never from the server's view — otherwise the panel could show
  // normal mode while the SW still ships yesterday's secure+blacklist.
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings || {};
  const base = (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');

  // Reachability probe for the footer. Nothing the user edits comes from
  // here.
  let effective = null;
  try {
    const r = await fetch(`${base}/v1/policy`);
    if (r.ok) effective = await r.json();
  } catch (e) {
    console.warn('[brotto] could not reach server for policy check:', e);
  }
  // Track when we last successfully verified policy with the server.
  // Used to render a "Last verified N seconds ago" footer so the user
  // knows whether the sidepanel is grounded in fresh server state or
  // showing stale local data.
  state.lastVerifiedAt = effective ? Date.now() : (state.lastVerifiedAt || null);
  state.serverReachable = !!effective;

  // Mode + blacklist come from LOCAL storage — chrome.storage.local is what
  // the SW ships on the next task_start, so that is what the field has to
  // show. The server fetch above is a reachability probe, not a second
  // source of truth.
  const mode = s.mode === 'secure' ? 'secure' : 'normal';
  securityModeSetting.value = mode;
  const localBlacklist = Array.isArray(s.blacklist) ? s.blacklist : [];
  if (notifyBlockingSetting) notifyBlockingSetting.checked = s.notifyBlocking !== false;
  if (notifyResultsSetting) notifyResultsSetting.checked = s.notifyResults !== false;

  blacklistSetting.value = localBlacklist.join('\n');

  // Header line: how many domains the user has saved (local view).
  // This count matches what the SW will actually ship on the next
  // task_start.
  const headerEl = document.getElementById('policyModeHeader');
  if (headerEl) {
    if (mode === 'secure') {
      headerEl.textContent = `Mode: secure · ${localBlacklist.length} domain${localBlacklist.length === 1 ? '' : 's'} saved.`;
      headerEl.classList.add('secure');
    } else {
      headerEl.textContent = 'Mode: normal — secure mode not active.';
      headerEl.classList.remove('secure');
    }
  }
}

// ponytail: Q1 — refresh from server without re-opening Settings.
// Re-runs the same hydration flow so the user sees the latest
// effective policy without a full panel reopen.
if (refreshPolicyBtn) {
  refreshPolicyBtn.addEventListener('click', async () => {
    refreshPolicyBtn.disabled = true;
    const original = refreshPolicyBtn.textContent;
    refreshPolicyBtn.textContent = '↻ Refreshing…';
    try {
      await hydrateSettingsPanel();
      renderVerifyStatus();
      refreshPolicyBtn.textContent = '✓ Refreshed';
    } catch {
      refreshPolicyBtn.textContent = '⚠ Refresh failed';
    } finally {
      setTimeout(() => {
        refreshPolicyBtn.textContent = original;
        refreshPolicyBtn.disabled = false;
      }, 1500);
    }
  });
}

// ponytail: footer that tells the user whether the sidepanel's policy
// view is grounded in fresh server state, stale, or local-only. Re-render
// on save (server just confirmed) and on every settings open.
function renderVerifyStatus() {
  const el = document.getElementById('settingsVerifyStatus');
  if (!el) return;
  el.classList.remove('ok', 'stale', 'off');
  if (!state.serverReachable) {
    el.classList.add('off');
    el.innerHTML = '';
    const dot = document.createElement('span'); dot.className = 'dot';
    const txt = document.createTextNode('Server unreachable — your edits are saved locally and will sync when it returns.');
    el.appendChild(dot); el.appendChild(txt);
    return;
  }
  if (!state.lastVerifiedAt) {
    el.classList.add('stale');
    el.textContent = 'Verifying server…';
    return;
  }
  const ageSec = Math.max(0, Math.round((Date.now() - state.lastVerifiedAt) / 1000));
  const ageLabel = ageSec < 5 ? 'just now'
    : ageSec < 60 ? `${ageSec}s ago`
    : `${Math.round(ageSec / 60)}m ago`;
  el.classList.add('ok');
  el.innerHTML = '';
  const dot = document.createElement('span'); dot.className = 'dot';
  const txt = document.createTextNode(`Server confirmed · ${ageLabel}`);
  el.appendChild(dot); el.appendChild(txt);
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', async () => {
    // Bug 8: if a task is currently running, the new policy won't take
    // effect until the next task_start. Capture that so we can change
    // the button copy.
    const taskRunning = state.phase === 'executing' || state.phase === 'paused';

    // The blacklist is the user's list, whole. There is no server-side
    // floor to re-union on Save — the panel shows what will be enforced,
    // and that is exactly these lines.
    const blacklist = blacklistSetting.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const settings = {
      serverUrl: plannerUrlSetting.value || 'http://localhost:8000',
      mode: securityModeSetting.value === 'secure' ? 'secure' : 'normal',
      blacklist,
      notifyBlocking: notifyBlockingSetting ? notifyBlockingSetting.checked : true,
      notifyResults: notifyResultsSetting ? notifyResultsSetting.checked : true,
    };
    await chrome.storage.local.set({ settings });
    plannerUrlEl.value = settings.serverUrl;
    console.log('[brotto] settings saved', settings);

    // 1. Push the in-memory mirror to the SW so the next task_start
    //    ships it. Bug 7: wait for the SW's success ack so we don't
    //    claim "Saved" before the SW actually updated userPolicy.
    let swOk = false;
    try {
      const ack = await chrome.runtime.sendMessage({
        type: 'policy_changed',
        settings: {
          mode: settings.mode,
          blacklist: settings.blacklist,
          notifyBlocking: settings.notifyBlocking,
          notifyResults: settings.notifyResults,
        },
      });
      swOk = !!(ack && ack.success);
      if (!swOk) console.warn('[brotto] SW ack missing or unsuccessful:', ack);
    } catch (e) {
      console.warn('[brotto] policy_changed message failed (SW asleep):', e);
    }

    // 2. HTTP POST to the server so the audit log records the save even
    //    when no WS is open (i.e. no task running). We surface the
    //    outcome in the button text so the user can see whether the
    //    save actually reached the server (not just local storage).
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = 'Saving…';
    renderVerifyStatus();
    let serverOk = false;
    try {
      const base = settings.serverUrl.replace(/\/$/, '');
      const r = await fetch(`${base}/v1/policy_ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { mode: settings.mode, blacklist: settings.blacklist } }),
      });
      serverOk = r.ok;
      console.log('[brotto] policy_ack http status', r.status);
    } catch (e) {
      console.warn('[brotto] policy_ack http failed (server may be offline):', e);
    }

    if (swOk && serverOk) {
      // Refresh the verified timestamp so the footer shows "just now".
      state.lastVerifiedAt = Date.now();
      state.serverReachable = true;
      saveSettingsBtn.textContent = taskRunning
        ? '✓ Saved — applies to next task'
        : '✓ Saved — server confirmed';
    } else if (!swOk && serverOk) {
      // Local + server both fine, but the SW didn't ack — suspicious.
      // Still show success but warn the user.
      saveSettingsBtn.textContent = taskRunning
        ? '⚠ Saved — applies to next task (SW did not ack)'
        : '⚠ Saved — SW did not ack (will retry on next task)';
    } else {
      state.serverReachable = false;
      saveSettingsBtn.textContent = '⚠ Saved locally — server unreachable';
    }
    renderVerifyStatus();
    setTimeout(() => {
      saveSettingsBtn.textContent = 'Save';
      saveSettingsBtn.disabled = false;
    }, 2200);
  });
}

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  phase: 'idle',
  plannerUrl: '',
  taskInFlight: false,
  startTime: 0,
  stepCount: 0,
  pendingClarifyId: null,
  // The server's session id, from `task_started`. History rows carry it so a
  // click can fetch the session document the run actually produced.
  sessionId: null,
  // How many tasks this conversation holds, for the history row's label. Only
  // ever set by a send this panel watched happen, which is what separates a
  // new task from a reopened panel replaying the last run's terminal event.
  taskCount: 0,
};

let timerInterval = null;
let timerPausedAt = 0;
// A DOM flag can't guard this: setPhase recomputes stopBtn.disabled from the
// phase, so `stopTask`'s own `disabled = true` was undone in the same tick and
// the guard never held. setPhase clears this when a new run starts.
let stopping = false;

// One timer for every pause. Armed and cleared inside setPhase, which is the
// only place the phase changes.
let pauseWatchdog = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ponytail: small helper to create an icon-only button for the final-answer
// toolbar. Glyph is rendered as text (no emoji). Clicked-state styling lives
// in CSS via .clicked.
// ponytail: Lucide icon paths. License: MIT (https://lucide.dev). Each icon
// is a focused 24×24 stroke-based glyph that inherits `currentColor` so
// the .final-answer-icon-btn CSS can recolor on hover / clicked.
const LUCIDE_ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  thumbsUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-1.88V11.88a2 2 0 0 1 2-2.12l4.32-4.32A2 2 0 0 1 13 4.83V9a2 2 0 0 0 2 2.88z"/></svg>',
  thumbsDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17a2 2 0 0 1 2 1.88v8.24a2 2 0 0 1-2 2.12l-4.32 4.32A2 2 0 0 1 11 19.17V15a2 2 0 0 0-2-2.88z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
};

function makeIconBtn(svgContent, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'final-answer-icon-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = svgContent;
  btn.addEventListener('click', onClick);
  return btn;
}

// ponytail: record the rating in localStorage. Nothing reads it — there is
// no telemetry and the orchestrator never sees it. It exists so the rating
// survives a panel close, and the button tooltips say as much rather than
// implying a feedback channel that doesn't exist.
function recordFeedback(kind) {
  try {
    const stored = JSON.parse(localStorage.getItem('brotto-feedback') || '[]');
    stored.push({
      kind,
      task: state.lastGoal || '',
      timestamp: Date.now(),
    });
    localStorage.setItem('brotto-feedback', JSON.stringify(stored));
  } catch {}
}

// ponytail: re-run the same task under a new session. Resets the chat
// then re-sends the last goal using the same message type the initial
// task uses (run_local_task). The SW does not have a send_user_message
// case, so retry used to silently fail. Mirroring run_local_task also
// guarantees the orchestrator sees a fresh session. The goal must be
// captured BEFORE resetForNewTask — that fn clears state.lastGoal.
function retryLastTask() {
  const goal = state.lastGoal;
  if (!goal) return;
  resetForNewTask();
  void sendMessage({
    type: 'run_local_task',
    task: goal,
    plannerUrl: plannerUrlEl.value || undefined,
    startingUrl: startingUrlEl.value || undefined,
  });
}

// ponytail: split a URL into the two parts the step card shows. Query string
// and hash are dropped (often auth tokens, session IDs — visually noisy and
// sometimes sensitive), and a leading "www." goes because it costs width and
// names nothing. Returns null when there is nothing worth showing.
function splitUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // A bare "/" is not a path, and drawing it left a box, a slash and
    // nothing — three pieces of chrome saying nothing. Empty means no path.
    const path = u.pathname === '/' ? '' : u.pathname;
    // chrome://extensions parses to host "extensions", which is not a domain
    // — it is the page's own name. Boxing it as one would claim a site the
    // agent never visited, so any other scheme is shown whole.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { host: u.href.replace(/\/$/, ''), path: '', raw: u.href };
    }
    const host = u.hostname.replace(/^www\./, '');
    if (!host) return null;
    return { host, path, raw: u.origin + u.pathname };
  } catch {
    return null;
  }
}

// Minimal markdown renderer for agent output.
// HTML-escapes first so injected HTML stays literal; only our own tags get through.
// Block-level: headers, lists, blockquote, hr. Inline: bold, italic, code, links.
function renderMarkdown(raw) {
  if (!raw) return '';
  const esc = escapeHtml(String(raw));
  const lines = esc.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    // Headers: #, ##, ### (up to ######)
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${h[2]}</h${level}>`);
      i++;
      continue;
    }
    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(trimmed)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // Unordered list — group consecutive `- ` / `* ` / `+ ` items
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map((it) => `<li>${it}</li>`).join('') + '</ul>');
      continue;
    }
    // Ordered list — group consecutive `1. ` items
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + items.map((it) => `<li>${it}</li>`).join('') + '</ol>');
      continue;
    }
    // Blockquote
    if (/^>\s+/.test(trimmed)) {
      const bq = [];
      while (i < lines.length && /^>\s+/.test(lines[i].trim())) {
        bq.push(lines[i].trim().replace(/^>\s+/, ''));
        i++;
      }
      out.push('<blockquote>' + bq.join('<br>') + '</blockquote>');
      continue;
    }
    // Empty line — paragraph break
    if (trimmed === '') {
      out.push('');
      i++;
      continue;
    }
    // Default: pass the line through (paragraph)
    out.push(lines[i]);
    i++;
  }

  let html = out.join('\n');

  // Inline replacements
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
  html = html.replace(/`([^`\n]+)`/g,
    // ponytail: --surface-2 does not exist, so this rendered as no chip at
    // all. --paper-2 is the sunken token, and the system is square — the 3px
    // radius was the only rounded corner in the panel.
    '<code style="background:var(--paper-2);padding:1px 4px;font-size:0.88em;font-family:ui-monospace,monospace">$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  return html;
}

// ponytail: if the model skipped `reasoning`, derive a sentence from the raw
// action string the local driver produced. Keeps the bubble readable even
// when the model is lazy.
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

// ── SW keep-alive (MV3) ──────────────────────────────────────────────────
// ponytail: open a long-lived port to the service worker so Chrome doesn't
// terminate it between tasks. Without this, the SW is killed after ~30s of
// inactivity, and the next sendMessage can hit a cold-start race — heavy
// imports (CanonicalExtensionController, transport, action-executor) plus
// controller.restore() can take long enough that the message callback
// fires before the SW's onMessage listener is registered. Symptom: the
// second task silently no-ops, side panel stays idle. Reconnect on
// disconnect (SW crash, manual reload from chrome://extensions).
let swKeepAlive = null;

// ponytail: the panel is open for the whole run whether or not anyone is
// looking at it, and Brotto's whole premise is that you switch away while it
// works. A bare port cannot tell those apart, so it reports focus as well as
// liveness — otherwise a task that finishes while you are in another app reads
// as "panel connected, someone's watching" and stays silent.
//
// Driven by the events rather than by polling hasFocus(): focus and blur are
// unambiguous, and they fire for both cases the user cares about — leaving for
// another app, and switching to another Chrome tab with the panel left open.
// That second one is the common case, and it is not the same as closing the
// panel, which is all a liveness port can see.
//
// Registered here, not inside connectSwKeepAlive: that re-runs on every service
// worker restart, so per-connect listeners would accumulate one pair at a time.
function reportWatching(watching) {
  try { swKeepAlive?.postMessage({ watching }); } catch { /* port closing */ }
}
document.addEventListener('focus', () => reportWatching(true));
document.addEventListener('blur',   () => reportWatching(false));

function connectSwKeepAlive() {
  try {
    swKeepAlive = chrome.runtime.connect({ name: "brotto-sidepanel" });
  } catch (err) {
    console.warn("[sidepanel] keep-alive connect failed:", err);
    setTimeout(connectSwKeepAlive, 1000);
    return;
  }
  // Seeded once per connect: a panel that opens into an already-blurred window
  // (restored session, reopened from a notification) never sees a focus event
  // at all, and the background has to learn it is unwatched from somewhere.
  reportWatching(document.hasFocus());
  swKeepAlive.onDisconnect.addListener(() => {
    swKeepAlive = null;
    // ponytail: brief delay so we don't spin if the SW is genuinely gone.
    setTimeout(connectSwKeepAlive, 200);
  });
}
connectSwKeepAlive();

// ── Button handlers ──────────────────────────────────────────────────────
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
  // ↑ in an empty box brings back the last task. Re-running a task you
  // already described is the common follow-up ("now do it properly"), and
  // retyping it is the alternative.
  if (e.key === 'ArrowUp' && !goalEl.value.trim() && state.lastGoal) {
    e.preventDefault();
    goalEl.value = state.lastGoal;
    goalEl.dispatchEvent(new Event('input'));
  }
});
goalEl.addEventListener('input', () => {
  goalEl.style.height = 'auto';
  goalEl.style.height = Math.min(goalEl.scrollHeight, 120) + 'px';
});
// ponytail: Esc stops, matching every terminal and every browser. Stop is
// already on screen while a task runs, so this is a shortcut for the mouse,
// not the only way out.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (settingsOverlay && settingsOverlay.classList.contains('open')) return;
  if (historyOverlay && historyOverlay.classList.contains('open')) return;
  if (!stopBtn || stopBtn.style.display === 'none' || stopBtn.disabled) return;
  e.preventDefault();
  void stopTask();
});

// ponytail: render the CONTEXT cell once on load so the value is owned
// by JS (not just the static HTML default). Then ask the backend for
// the model's context window so the 0% tooltip names the right baseline.
updateContextUsage();
void fetchContextWindow();

async function sendUserMessage() {
  const text = goalEl.value.trim();
  if (!text) return;
  // Mid-task steering. This has to come before everything below: the rest of
  // this function is "start a task" — it clears the transcript, resets the
  // tab tally and calls setPhase('connecting'), all of which would destroy
  // the running task the user is trying to redirect. A paused task is
  // excluded on purpose: a prompt is outstanding then, and the composer
  // answer would be read by the server as the answer to that prompt. The
  // disabled button is not the protection — Enter still reaches this
  // function with the button off.
  if (state.phase === 'executing') {
    const res = await chrome.runtime.sendMessage({
      type: 'send_to_server',
      payload: { type: 'steer', content: text },
    }).catch(() => ({ success: false, error: 'The background service worker is not responding.' }));
    if (!res || res.success !== true) {
      // Keep the text. The user typed a correction they do not want to
      // retype, and losing it is the whole cost of a failed send.
      appendMessage({
        role: 'error',
        text: `Could not send that: ${(res && res.error) || 'not connected'}. It is still in the box.`,
      });
      return;
    }
    goalEl.value = '';
    goalEl.style.height = 'auto';
    appendMessage({ role: 'user', text });
    return;
  }
  // ponytail: one send per run. The phase enum cannot answer this on its own,
  // because 'connected' means two opposite things: idle-and-ready after "New
  // task", and mid-run after the user answers an approval or clarify card.
  // Keying the old guard on phase let that second case through — it cleared
  // the live transcript and then failed with "a task is already running" —
  // so the real question is whether a task is in flight, not what the phase
  // is called.
  if (state.taskInFlight) return;
  // ponytail: soft length cap. Tasks > MAX_TASK_CHARS get a confirm dialog
  // because long compound instructions are a classic prompt-injection vector.
  // The server logs a warning on the same threshold (defense in depth) but
  // does not block — both layers are advisory, matching the "do not show by
  // default, prompt the user" UX spec.
  if (text.length > MAX_TASK_CHARS
      && !window.confirm(
        `This task is ${text.length} characters. Long instructions are more likely to contain something Brotto shouldn't follow. Send anyway?`)) {
    return;
  }
  // ponytail: accepting a send re-arms Stop, which a previous stopTask left
  // latched. It belongs here — the first line after the send is accepted —
  // and not on the send's own path: a connect failure returns early, and Stop
  // stayed greyed out for every task after that one. It must also not live in
  // setPhase, because `canonical_status: executing` arrives on every step and
  // would re-arm Stop while a cancel was still in flight.
  stopping = false;
  stopBtn.disabled = false;
  state.taskInFlight = true;
  // A message continues the conversation unless the user asked for a new one.
  // Clearing the session here is what made every follow-up look like a fresh
  // run to both the panel and the server. What still resets is the *run* — the
  // clock, the step and tab tallies, the status bar — because a follow-up is
  // a new run inside the same conversation.
  const continuing = state.sessionId !== null;
  state.taskCount = continuing ? (state.taskCount || 1) + 1 : 1;
  clearMessages({ keepTranscript: continuing });
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

  // ponytail: start the timer the moment the run actually begins.
  startTimer();
  // ponytail: send the goal to the background. The background opens a
  // new tab, captures observations, calls the planner, dispatches actions
  // via chrome.debugger. The side panel just renders events.
  // ponytail: `continuing` was read before the send cleared anything, and the
  // background reuses its session only when this is true.
  const response = await sendMessage({
    type: 'run_local_task',
    task: text,
    continueSession: continuing,
  });
  if (!response.success) {
    stopTimer();
    setPhase('error', `Failed to start: ${response.error || 'unknown error'}`);
    appendMessage({ role: 'error', text: `Failed to start: ${response.error || 'unknown error'}` });
  } else {
    void chrome.storage.session.remove('draft');
  }
}

async function ensureConnected() {
  // ponytail: reuses the plannerUrl from settings (default :3001). Probes
  // /health; sets phase to 'connected' on success. Throws on failure.
  const url = plannerUrlEl.value.trim() || 'http://localhost:8000';
  state.plannerUrl = url;
  plannerUrlEl.value = url;
  const response = await fetch(url + '/health', { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  setPhase('connected', null);
  // Status pill in the header already conveys connection state; no
  // separate chat-line clutter.
}

async function resetForNewTask() {
  // ponytail: clear chat stream, reset counters, reset task state. This is
  // the only way a new conversation starts now — sendUserMessage no longer
  // comes through here.
  state.lastGoal = '';
  state.stepCount = 0;
  state.taskCount = 0;
  // Cleared so a run that never got a task_started writes session_id: null
  // and falls back to the startedAt dedupe, rather than inheriting the last
  // run's id.
  state.sessionId = null;
  // ponytail: drop the previous task's tab tally so each task starts at zero.
  seenTabs.clear();
  updateTabCount();
  state.taskInFlight = false;
  clearMessages();
  stopTimer();
  setPhase(state.plannerUrl ? 'connected' : 'idle', state.plannerUrl ? 'Ready' : 'Ready');
}

function appendUserMessage(text) {
  appendMessage({ role: 'user', text });
}

// ponytail: tiny logger for internal noise (cancel races, retry ticks)
// that should NOT render in the chat. Service-worker console only via
// console.log inside the page; nothing in the UI changes.
function logSilently(message) {
  console.log(`[sidepanel] ${message}`);
}

// ── Phase / UI helpers ────────────────────────────────────────────────────
// ponytail: a task emits more than one terminal event — the cancel path sends
// its own pair, and the loop's .then() can deliver another one afterwards.
// Without this guard a failure was rendered and then overwritten by a green
// "Task complete", which is the one thing a user cannot be allowed to see.
// Every terminal handler asks first; the phases are the same set the
// composer treats as sendable.
const TERMINAL_PHASES = new Set(['done', 'error', 'completed', 'cancelled', 'disconnected', 'failed']);
function alreadyTerminal(label) {
  if (!TERMINAL_PHASES.has(state.phase)) return false;
  logSilently(`${label} arrived after terminal phase ${state.phase}; ignored`);
  return true;
}

function setPhase(phase, message) {
  const wasPaused = state.phase === 'paused';
  state.phase = phase;
  const running = phase === 'executing' || phase === 'paused';
  modelSpinner.classList.toggle('active', running);
  // ponytail: the clock measures agent work, not wall time. Every
  // user-blocking wait (approval / login / clarify) arrives as phase
  // 'paused', so pausing and resuming here — not at each of the six call
  // sites — keeps the blocked window out of the total. Resume shifts the
  // start time forward by the paused duration rather than resetting it.
  if (phase === 'paused') pauseTimer();
  else if (wasPaused) resumeTimer();
  stopBtn.style.display = running ? '' : 'none';
  // Esc only stops while something is running. Advertising it when there is
  // nothing to stop is a shortcut that does nothing.
  if (composerHint) {
    // The hint has to name what Enter now does, or it is describing a
    // control that has changed meaning.
    composerHint.textContent = phase === 'executing'
      ? 'Enter redirects the running task · Esc to stop'
      : running
        ? 'Answer the question above · Esc to stop'
        : 'Press Enter to send · Shift+Enter for newline';
  }
  // ponytail: re-enable the composer explicitly when the task ends so a
  // "done" / "error" / "cancelled" / "disconnected" / "failed" phase
  // always makes the goal input re-usable. setPhase is the single source
  // of truth for the input's enabled state; other code paths must call
  // setPhase rather than toggling sendBtn.disabled directly.
  // ponytail: 'executing' deliberately stays enabled — that is the whole
  // point of steering, and a composer that locks the moment the task starts
  // forces Stop, which throws the transcript away. 'paused' stays disabled
  // because a prompt is outstanding and the same box answers it.
  sendBtn.disabled = phase === 'connecting' || (running && phase !== 'executing');
  // ponytail: surface a brief feedback message for the prose-only failure
  // so the user knows the loop stopped on purpose, not from a network
  // error. The actual message is rendered by the task_failed handler.
  if (phase === 'done' || phase === 'error') {
    // ponytail: clear every prompt the task was blocked on so no card
    // survives into the terminal state. clearLoginPrompt alone left an
    // approval or clarify card live and clickable on a finished task.
    clearBlockingCards();
  }
  // ponytail: the clock belongs to a run. Every terminal phase stops it,
  // not just done/error — a bar that kept counting after a failed or
  // cancelled task would be reporting time that isn't passing. Keyed on
  // TERMINAL_PHASES, not on `!running`: answering a clarifying question moves
  // paused → connected, and stopping on anything non-running killed the
  // interval that the line above had just restarted, so ACTIVE stayed frozen
  // at the answer for the rest of the run.
  if (TERMINAL_PHASES.has(phase)) { stopTimer(); state.taskInFlight = false; }
  // ponytail: the live "still working" bubble must stop blinking the moment
  // the agent stops producing — which includes 'paused', because a pause is
  // the agent asking for approval, a login, or an answer, not the agent
  // working. finishAssistantMessage was the intended closer but had no call
  // site, so the caret blinked for the life of the panel and every later
  // step merged into that one bubble.
  if (phase !== 'executing' && currentAssistantMsg) {
    finishAssistantMessage({ title: currentAssistantMsg.textNode.nodeValue });
  }
  // ponytail: a pause is the agent blocked on the *user* (approval, login,
  // clarify) or on a site that never answers. There are five setPhase('paused')
  // call sites and no timeout on any of them, so a reply that never arrives
  // left the panel silent — no prompt, no composer, no explanation. Armed here
  // rather than at each site so all five are covered by construction. It only
  // prints: forcing a terminal phase would under-report a task that is still
  // alive server-side, and Stop is already visible throughout a pause.
  clearTimeout(pauseWatchdog);
  if (phase === 'paused') {
    pauseWatchdog = setTimeout(() => {
      pauseWatchdog = null;
      if (state.phase !== 'paused') return;
      appendMessage({
        role: 'system',
        text: 'Brotto has not moved on. If nothing happens, press Stop to end the task.',
      });
    }, 60000);
  }
  // ponytail: status pill is visible in the header. Updates text + color
  // class so the user can read connection state at a glance (Idle by default).
  // The `stopping` latch has to be read here, not just inside stopTask: this
  // line recomputes the button on every phase change, and the server keeps
  // sending `canonical_status: executing` while a cancel is in flight. Without
  // it the button was re-enabled a click after Stop, and the click silently
  // no-op'd on the `stopping` guard — a live-looking control that does nothing.
  stopBtn.disabled = stopping || !(phase === 'executing' || phase === 'paused');
  if (refreshBtn) refreshBtn.disabled = phase === 'connecting';
  // ponytail: the bar belongs to a task, not to a moment. It appears on the
  // first step and stays through every terminal phase — a run that failed is
  // exactly when you want to read how far it got. Only the pre-task states
  // hide it, and New task clears it via clearMessages.
  const showBar = phase !== 'idle' && phase !== 'connected' && phase !== 'disconnected' && phase !== 'connecting';
  if (statusBarEl) statusBarEl.classList.toggle('active', showBar);
  // ponytail: New Task button shows after done or error so the user can
  // start fresh without reloading.
  const showNewTask = phase === 'done' || phase === 'error';
  if (newTaskBtn) newTaskBtn.classList.toggle('visible', showNewTask);
  if (message) connectionMeta.textContent = message;
  // ponytail: Bug 2 — drive the header connection pill from phase.
  // Mid-task disconnects are handled separately via `case 'disconnected'`
  // (Bug 3) which uses setConnPill directly.
  if (phase === 'connected' || phase === 'executing' || phase === 'paused' || phase === 'done') {
    setConnPill('connected', 'Connected');
  } else if (phase === 'connecting') {
    setConnPill(null, 'Connecting…');
  } else if (phase === 'error') {
    setConnPill('error', 'Disconnected');
  } else {
    setConnPill(null, 'Idle');
  }
}

function clearTimer() {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
  timerPausedAt = 0;
  state.startTime = 0;
  timerEl.textContent = '0.0s';
  if (timerActiveEl) timerActiveEl.textContent = '0.0s';
}

function renderElapsed() {
  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1) + 's';
  if (timerEl) timerEl.textContent = elapsed;
  if (timerActiveEl) timerActiveEl.textContent = elapsed;
}

// ponytail: `from` is the run's real start. Omitted on a live send (the run
// starts now); supplied when a reopened panel replays the run's own
// `task_started`, so ACTIVE counts from where the run actually is rather
// than from the moment the panel happened to reopen.
function startTimer(from) {
  clearTimer();
  state.startTime = from || Date.now();
  timerInterval = setInterval(renderElapsed, 100);
  renderElapsed();
}

// ponytail: freeze the clock while the agent waits on the user. Guarded on
// timerInterval so a pause arriving outside a run (e.g. 'Stopping…' before
// the task ever started) is a no-op rather than a stuck resume.
function pauseTimer() {
  if (timerInterval === null || timerPausedAt) return;
  renderElapsed();
  clearInterval(timerInterval);
  timerInterval = null;
  timerPausedAt = Date.now();
}

function resumeTimer() {
  if (!timerPausedAt) return;
  state.startTime += Date.now() - timerPausedAt;
  timerPausedAt = 0;
  timerInterval = setInterval(renderElapsed, 100);
  renderElapsed();
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerPausedAt = 0;
  // ponytail: write the final time to BOTH elements every call. Earlier code
  // only updated the hidden header timer and skipped the visible status bar
  // on stopTimer, so the user kept seeing the last interval value rather than
  // the locked final time. Idempotent — safe to call after the interval is
  // already cleared.
  if (state.startTime > 0) renderElapsed();
}

function updateStepCount() {
  const label = state.stepCount + (state.stepCount === 1 ? ' step' : ' steps');
  stepCountEl.textContent = label;
  if (stepCountActive) stepCountActive.textContent = String(state.stepCount);
  // Flash the cell so a step landing is felt, not just read. The class has to
  // be removed and re-added or the animation won't restart on repeat steps.
  const cell = stepCountActive?.closest('.cell');
  if (!cell) return;
  cell.classList.remove('flash');
  void cell.offsetWidth;
  cell.classList.add('flash');
}

// ── Core logic (preserved verbatim) ───────────────────────────────────────
// ponytail: `connect`/`disconnect` are gone. The panel connects implicitly on
// the first send (ensureConnected), so the explicit connect step had no
// button and no caller — it went when the dead startTask went, and its only
// other listener was bound to a #connectBtn that is not in the document.

// ponytail: Bug 2 — visible connection indicator. Dot-only — state
// conveyed by colour (green/amber/red) + the title-attribute tooltip.
// Driven by WS lifecycle events from background.ts.
function setConnPill(stateName, tooltipLabel) {
  if (!statusPill) return;
  statusPill.classList.remove('connected', 'reconnecting', 'error');
  if (stateName) statusPill.classList.add(stateName);
  if (connLabelEl) connLabelEl.textContent = tooltipLabel;
  statusPill.title = `Connection: ${tooltipLabel}`;
}

// ponytail: transient notice for events that leave no other trace. One
// element at a time — a second toast replaces the first rather than
// stacking, because a stack of them is just a slower chat message.
// Removal runs on its own timer instead of `animationend`, which never
// fires under prefers-reduced-motion (the animation is set to `none`)
// and would strand the toast on screen.
let toastTimer = null;
let toastGoneTimer = null;
function toast(text, kind, ms = 2600) {
  clearTimeout(toastTimer);
  clearTimeout(toastGoneTimer);
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.setAttribute('role', 'status');
  el.textContent = text;
  // Clear whatever is actually at the bottom of the panel, measured rather
  // than guessed. The input area grows when "+ New task" appears, and a
  // hardcoded offset lands the toast on top of the composer the moment
  // either height moves — it did, by 5px.
  const top = Math.min(
    ...[newTaskBtn, document.getElementById('inputArea')]
      .filter((e) => e && e.offsetParent !== null)
      .map((e) => e.getBoundingClientRect().top),
  );
  el.style.bottom = `${Math.round(window.innerHeight - top + 8)}px`;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.classList.add('leaving'), ms);
  // 200ms covers the 180ms leave animation with a little slack.
  toastGoneTimer = setTimeout(() => el.remove(), ms + 200);
}

async function stopTask() {
  // ponytail: guard against double-click. The cancel handler may finish
  // before the user releases the button, and a second click would post
  // 'cancel_local_task' which then returns 'No local task is running'.
  if (stopping) return;
  if (state.phase !== 'executing' && state.phase !== 'paused') return;
  stopping = true;
  stopBtn.disabled = true;
  // ponytail: surface immediate "Stopped" feedback so the user sees their
  // click took effect. The background's cancel emits a terminal event
  // synchronously now, so the side panel exits 'Working' within ~1 tick.
  appendMessage({ role: 'system', text: 'Stopped by user — finishing current step…' });
  // ponytail: Stop only moved the phase; an approval / clarify card stayed on
  // screen and clickable, so the user could still approve a purchase on a task
  // they had just cancelled. Same cleanup setPhase does on a terminal phase.
  clearBlockingCards();
  setPhase('paused', 'Stopping…');
  // setPhase recomputes the button from the phase, so re-disable after it —
  // otherwise Stop stays clickable-looking while the guard silently no-ops.
  stopBtn.disabled = true;
  const response = await sendMessage({ type: 'cancel_local_task' });
  if (!response.success) {
    // ponytail: cancel after the loop already terminated (the user's
    // second click). The terminal event is already on the way; do not
    // show an error bubble that contradicts it.
    logSilently(`cancel_local_task returned: ${response.error || 'unknown'}`);
    // …but no terminal event is actually guaranteed here, so if the task is
    // still running re-arm Stop rather than stranding it permanently off.
    if (state.phase === 'executing' || state.phase === 'paused') {
      stopping = false;
      stopBtn.disabled = false;
    }
  }
}

async function refresh() {
  stopTimer();
  clearMessages();
  const response = await sendMessage({ type: 'reset_session' });
  if (!response.success) appendMessage({ role: 'error', text: `Reset failed: ${response.error || 'unknown error'}` });
  state.plannerUrl = '';
  // The background drops the tab on reset and the next task mints a fresh
  // session; without this the panel would still be counting itself mid-
  // conversation and the history row would start at 2.
  state.sessionId = null;
  state.taskCount = 0;
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
// `keepTranscript` is what makes a conversation a conversation: a follow-up
// task resets everything about the run without taking away what the run before
// it said. Every other caller wants a blank panel.
function clearMessages({ keepTranscript = false } = {}) {
  if (!keepTranscript) messagesEl.replaceChildren();
  state.stepCount = 0;
  updateStepCount();
  stopTimer();
  // The bar now survives the end of a task, so it has to be dropped
  // explicitly here or a fresh task opens showing the last run's numbers.
  statusBarEl?.classList.remove('active');
  // The CONTEXT cell lives in that bar, so it needs the same treatment — a
  // fresh task used to open showing the previous run's percentage until its
  // own first step landed.
  state.lastContext = null;
  updateContextUsage();
  seenTabs.clear();
  updateTabCount();
  // ponytail: clean up any lingering login-pause fallback buttons from a
  // previous task — a leftover Continue button is confusing once the user
  // is starting fresh.
  if (typeof document !== "undefined") {
    document.querySelectorAll(".login-continue-btn").forEach((el) => el.remove());
  }
  // ponytail: reset to initial empty-state by re-creating the placeholder so
  // the panel doesn't look empty.
  if (!document.getElementById("emptyState")) {
    messagesEl.appendChild(createEmptyState());
    void currentTab().then(refreshEmptyState);
  }
}

function appendEmptyState() {
  messagesEl.appendChild(createEmptyState());
  void currentTab().then(refreshEmptyState);
}

// ponytail: helper to fade out + remove the login_required bubble and
// its Continue button in one render frame. Called on resolve paths: the
// Continue button click, the next step_card after auto-resume, any
// agent input request (clarify / approval), and terminal events (done /
// error / fail). The fade matches the CSS .removing keyframe (180ms);
// DOM removal happens 20ms later so the fade isn't cut short.
function clearLoginPrompt() {
  const els = document.querySelectorAll('.login-required-msg, .login-continue-btn');
  if (els.length === 0) return;
  els.forEach((el) => el.classList.add('removing'));
  setTimeout(() => {
    els.forEach((el) => { if (el.isConnected) el.remove(); });
  }, 200);
}

// ponytail: every prompt a task can be blocked on. Terminal events and Stop
// must clear all of them, not just the login bubble — an approval card that
// outlives its task means the user can still approve a purchase on something
// that is no longer running. Not folded into clearLoginPrompt: the auto-resume
// paths call that on every step, where a live approval card must survive.
function clearBlockingCards() {
  clearLoginPrompt();
  messagesEl.querySelectorAll('.approval-card, .clarify-card').forEach((el) => el.remove());
}

// ponytail: the copy below is duplicated verbatim in sidepanel.html for first
// paint, before this runs. Two copies, not three — keep them identical.
// alt is empty on purpose: the mark is decorative and "Brotto" is rendered as
// the visible title right underneath it, so naming it twice just makes a
// screen reader say the word twice.
function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';

  const mark = document.createElement('div');
  mark.className = 'empty-mark';
  const logo = document.createElement('img');
  logo.src = 'assets/logo.svg';
  logo.alt = '';
  logo.className = 'brand-logo brand-logo--lg';
  const name = document.createElement('span');
  name.className = 'empty-mark-name';
  name.textContent = 'Brotto';
  mark.append(logo, name);

  const where = document.createElement('div');
  where.className = 'empty-where';
  where.id = 'emptyWhere';
  where.hidden = true;
  const whereLabel = document.createElement('span');
  whereLabel.textContent = 'On';
  const whereHost = document.createElement('b');
  whereHost.id = 'emptyHost';
  where.append(whereLabel, whereHost);

  const sub = document.createElement('div');
  sub.className = 'empty-sub';
  sub.textContent = 'Tell Brotto what to do in this tab. It navigates, clicks, and fills things in — you approve anything sensitive.';

  const suggestions = document.createElement('div');
  suggestions.className = 'suggestions';
  suggestions.id = 'suggestions';

  div.append(mark, where, sub, suggestions);
  return div;
}


// ─── Suggestions ─────────────────────────────────────────────────────────
// Written by the model, not by a table. Three hand-written versions came and
// went; each one was a list of sites someone had thought of, so it was right
// on those and generic everywhere else. This list is what shows when the
// server can't be reached — it stays site-agnostic on purpose, because the
// moment it grows a site table the failure is invisible again: the good path
// is a cache hit most of the time, so a broken one looks like a working one.
const FALLBACK_SUGGESTIONS = [
  'Summarise what is on this page and flag anything that needs a decision.',
  'Pull out the specifics: names, numbers, dates and links.',
  'Compare what is here against what I ask for and tell me where it falls short.',
];

const SUGGESTION_CACHE_KEY = 'suggestionCache';
const SUGGESTION_CACHE_MAX = 40;
const SUGGESTION_DEBOUNCE_MS = 1000;
// A line written from page text is page content: "three emails from your
// manager" is a leak sitting in chrome.storage.local for as long as its entry
// lives. A URL and a title are not sensitive, so those keep the day-long entry
// the cache was built around; anything drawn from what was on screen expires
// in minutes instead.
const SUGGESTION_TTL_CONTEXT_MS = 10 * 60 * 1000;
const SUGGESTION_TTL_DEFAULT_MS = 24 * 60 * 60 * 1000;
// The server caps at the same number. Applied here so a 200KB document never
// crosses the wire only to be truncated on arrival.
const PAGE_TEXT_CHARS = 8000;

// Read on demand, and only while the panel is open. A permanently injected
// content script would put Brotto into every site the user visits, and the
// debugger would raise Chrome's "debugging this browser" banner — a heavy
// thing to show someone who opened a panel to read a list. chrome:// pages
// and a few others refuse the script outright, and that is reported as
// absence rather than guessed around.
async function readPageContext(tabId) {
  if (typeof tabId !== 'number') return '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (limit) => (document.body?.innerText || '').slice(0, limit),
      args: [PAGE_TEXT_CHARS],
    });
    return (res?.result || '').trim();
  } catch {
    return '';
  }
}

// One key in flight at a time. Rapid tab switching would otherwise queue a
// model call per tab, and the last one to land is not the one being shown.
let suggestionInFlight = '';
let suggestionTimer = null;

async function currentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

// Fills the composer rather than sending. A suggestion is a starting point
// the user still owns; running a task the moment it's read is the wrong
// default for anything that clicks.
function fillComposer(text) {
  goalEl.value = text;
  goalEl.focus();
  goalEl.dispatchEvent(new Event('input'));
}

function paintSuggestions(lines) {
  // Re-checked at paint time, not just at call time: a task can start during
  // the await, and a late reply must not repaint a panel the transcript owns.
  const box = document.getElementById('suggestions');
  if (!box) return;
  box.textContent = '';
  for (const text of lines) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion';
    btn.textContent = text;
    btn.addEventListener('click', () => fillComposer(text));
    box.appendChild(btn);
  }
}

// Collapses the id-bearing segments so /issues/4821 and /issues/4822 share a
// cache entry, and folds in the date so a page gets a fresh set tomorrow.
function suggestionKey(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!u.host) return '';
  const shape = u.pathname
    .split('/')
    .map((s) => (/\d/.test(s) ? ':id' : s))
    .join('/');
  const day = new Date().toISOString().slice(0, 10);
  return `${u.host}${shape}?${u.searchParams.get('q') || ''}#${day}`;
}

async function readSuggestionCache() {
  const stored = await chrome.storage.local.get(SUGGESTION_CACHE_KEY);
  return stored[SUGGESTION_CACHE_KEY] || {};
}

async function writeSuggestionCache(key, lines, ttl) {
  const cache = await readSuggestionCache();
  cache[key] = { at: Date.now(), ttl, lines };
  const trimmed = Object.entries(cache)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, SUGGESTION_CACHE_MAX);
  await chrome.storage.local.set({ [SUGGESTION_CACHE_KEY]: Object.fromEntries(trimmed) });
}

async function fetchSuggestions(url, title, pageText = '') {
  const key = suggestionKey(url);
  if (!key) return null;
  if (suggestionInFlight === key) return null;
  suggestionInFlight = key;
  try {
    const cache = await readSuggestionCache();
    const hit = cache[key];
    if (hit && hit.lines && hit.lines.length
        && Date.now() - hit.at < (hit.ttl || SUGGESTION_TTL_DEFAULT_MS)) {
      return hit.lines;
    }

    const base = (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');
    const [local, key_] = await Promise.all([
      chrome.storage.local.get('modelConfig'),
      chrome.storage.session.get('modelApiKey'),
    ]);
    const response = await fetch(`${base}/v1/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        title,
        page_text: pageText || undefined,
        model_config: local.modelConfig || undefined,
        api_key: key_.modelApiKey || undefined,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data.lines) || !data.lines.length) return null;
    // The server tells us whether it actually saw the page, rather than this
    // side guessing from whether the read succeeded — a page can return an
    // empty body and still be a page the model was given.
    await writeSuggestionCache(
      key,
      data.lines,
      data.context_used ? SUGGESTION_TTL_CONTEXT_MS : SUGGESTION_TTL_DEFAULT_MS,
    );
    return data.lines;
  } catch {
    // Server down, or never configured. The fallback is already painted, so
    // there is nothing to report and nothing to retry.
    return null;
  } finally {
    if (suggestionInFlight === key) suggestionInFlight = '';
  }
}

function refreshEmptyState(tab) {
  // Only ever paint the idle page. Once a task starts, the transcript owns
  // the panel and a tab change must not disturb it.
  const box = document.getElementById('suggestions');
  if (!box) return;
  let host = '';
  try {
    // hostname is '' for about: and chrome:// pages, so the empty-host case
    // needs no special-casing.
    host = tab?.url ? new URL(tab.url).hostname : '';
  } catch { host = ''; }
  const where = document.getElementById('emptyWhere');
  const whereHost = document.getElementById('emptyHost');
  if (whereHost) whereHost.textContent = host;
  if (where) where.hidden = !host;

  // Paint first, fetch second. The box is never empty and never waits on a
  // model call to be usable.
  paintSuggestions(FALLBACK_SUGGESTIONS);
  const url = tab?.url || '';
  if (!url || !plannerUrlEl.value) return;
  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(async () => {
    const pageText = await readPageContext(tab.id);
    const lines = await fetchSuggestions(url, tab?.title || '', pageText);
    if (lines) paintSuggestions(lines);
  }, SUGGESTION_DEBOUNCE_MS);
}

// sidepanel.html ships with the suggestions box empty. The first fill waits
// for the settings hydration at the foot of this file, which is the first
// point the saved server URL is known — painting earlier means guessing the
// server, and on a remote deployment that guess is a request to localhost.
if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(() => { void currentTab().then(refreshEmptyState); });
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'complete') void currentTab().then(refreshEmptyState);
  });
}

// ponytail: extract structured facts from the model's finalAnswer so
// the side panel can show URLs / order IDs / tracking IDs as a tidy
// list rather than buried in a wall of prose. Best-effort regex — no
// false positives in real-world text.
function renderFacts(finalAnswer) {
  if (!finalAnswer) return '';
  const urlRe = /\bhttps?:\/\/[^\s)\]'"<>]+/g;
  const orderIdRe = /\b(?:order\s*(?:#|number|id)|tracking\s*(?:id|number))\s*[:=]?\s*([A-Z0-9][-A-Z0-9]{4,})/gi;
  const dateRe = /\b(?:\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\w*|\d{4}-\d{2}-\d{2})\b/gi;
  const urls = Array.from(new Set(finalAnswer.match(urlRe) || [])).slice(0, 5);
  const orderIds = Array.from(new Set(
    (finalAnswer.match(orderIdRe) || []).map((m) => m.replace(/^(?:order|tracking)\s*(?:#|number|id)?\s*:?\s*/i, '').trim())
  )).slice(0, 5);
  const dates = Array.from(new Set(finalAnswer.match(dateRe) || [])).slice(0, 5);
  if (urls.length === 0 && orderIds.length === 0 && dates.length === 0) return '';
  const lines = [];
  if (urls.length > 0) {
    lines.push('<div class="facts-group"><span class="facts-label">Links</span>');
    for (const u of urls) lines.push(`<a class="facts-link" href="${escapeHtml(u)}" target="_blank" rel="noreferrer">${escapeHtml(u)}</a>`);
    lines.push('</div>');
  }
  if (orderIds.length > 0) {
    lines.push('<div class="facts-group"><span class="facts-label">Identifiers</span>' +
      orderIds.map((id) => `<code class="facts-code">${escapeHtml(id)}</code>`).join(' ') + '</div>');
  }
  if (dates.length > 0) {
    lines.push('<div class="facts-group"><span class="facts-label">Dates</span>' +
      dates.map((d) => `<span class="facts-date">${escapeHtml(d)}</span>`).join(' ') + '</div>');
  }
  return `<div class="facts">${lines.join('')}</div>`;
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
    bubble.innerHTML = renderMarkdown(text);
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
    bubble.textContent = text;
    msg.appendChild(bubble);
  } else if (role === 'done') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble final-answer-bubble';

    if (finalAnswer) {
      const fa = document.createElement('div');
      fa.className = 'final-answer';
      const faText = document.createElement('div');
      faText.className = 'final-answer-text';
      faText.innerHTML = renderMarkdown(finalAnswer);
      fa.appendChild(faText);
      bubble.appendChild(fa);
    }

    // ponytail: bottom toolbar with feedback icons. Four icons — Copy,
    // Good (thumbs up), Bad (thumbs down), Retry — give the user a
    // single place to copy the answer, rate it, or re-run the same
    // task under a new session. The "Task completed · N steps" caption
    // is gone — the icon row replaces it.
    const toolbar = document.createElement('div');
    toolbar.className = 'final-answer-toolbar';

    if (finalAnswer) {
      // ponytail: copy includes the task + the final answer in a clean
      // markdown-style block. The user said "Show prompts as well when
      // copied the response" — the task is the prompt they sent, so
      // including it makes the copy self-contained when shared.
      const copyText = state.lastGoal
        ? `**Task:** ${state.lastGoal}\n\n**Response:**\n${finalAnswer}`
        : finalAnswer;
      const copyBtn = makeIconBtn(LUCIDE_ICONS.copy, 'Copy', async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(copyText);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = copyText;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch {}
          document.body.removeChild(ta);
        }
        copyBtn.classList.add('clicked');
        setTimeout(() => copyBtn.classList.remove('clicked'), 1200);
      });
      toolbar.appendChild(copyBtn);
    }

    // ponytail: good/bad ratings are persistent and mutually exclusive.
    // Click toggles its own state — clicking the other deactivates the
    // first. The .rated-good / .rated-bad classes stay until the user
    // clicks again to clear.
    const goodBtn = makeIconBtn(LUCIDE_ICONS.thumbsUp, 'Good response — saved on this device only', () => {
      if (goodBtn.classList.contains('rated-good')) {
        goodBtn.classList.remove('rated-good');
        return;
      }
      badBtn.classList.remove('rated-bad');
      goodBtn.classList.add('rated-good');
      recordFeedback('good');
    });
    toolbar.appendChild(goodBtn);

    const badBtn = makeIconBtn(LUCIDE_ICONS.thumbsDown, 'Bad response — saved on this device only', () => {
      if (badBtn.classList.contains('rated-bad')) {
        badBtn.classList.remove('rated-bad');
        return;
      }
      goodBtn.classList.remove('rated-good');
      badBtn.classList.add('rated-bad');
      recordFeedback('bad');
    });
    toolbar.appendChild(badBtn);

    const retryBtn = makeIconBtn(LUCIDE_ICONS.retry, 'Retry', () => {
      retryLastTask();
    });
    toolbar.appendChild(retryBtn);

    bubble.appendChild(toolbar);
    msg.appendChild(bubble);
  }

  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

// ponytail: structured failure bubble for policy violations. Title +
// body + footer in a single red card so the user sees both the human-
// readable framing (set by renderPolicyFailureCard) and the actual
// harness summary that explains the specific incident. The footer is
// muted/grey so the eye lands on the body first.
function appendFailureBubble({ title, body, footer }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message error';

  const bubble = document.createElement('div');
  bubble.className = 'bubble failure-bubble';

  const titleEl = document.createElement('div');
  titleEl.className = 'failure-title';
  titleEl.textContent = title;
  bubble.appendChild(titleEl);

  if (body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'failure-body';
    bodyEl.innerHTML = renderMarkdown(body);
    bubble.appendChild(bodyEl);
  }

  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'failure-footer';
    footerEl.textContent = footer;
    bubble.appendChild(footerEl);
  }

  msg.appendChild(bubble);
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

// Copies the same address the row displays, not the raw one: the query
// string can carry a session token and the row deliberately hides it. The
// scheme is restored, because the row drops it for width and the clipboard
// has to keep it or the pasted value won't open.
function wireCopyUrl(el, copyValue) {
  el.addEventListener('click', () => {
    navigator.clipboard.writeText(copyValue).then(
      () => toast('Address copied'),
      () => toast('Could not copy — select the text instead', 'bad'),
    );
  });
}

// ponytail: step bubble. The model's `clientText` is the title and the address
// row is the only other thing drawn — the tool calls a step was built from are
// server-side detail, and a toggle for them put debugging chrome in the one
// surface the user actually reads.
// ponytail: icon is set via innerHTML on its own <span> so HTML entities
// (&#8594;, &#9654;, &#10003;) decode to glyphs. The reasoning text uses
// textContent so any user/model-supplied HTML stays literal and safe.
function appendStep({ icon, text, pageUrl, actionTarget }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message assistant step';

  const bubble = document.createElement('div');
  bubble.className = 'bubble step-bubble';

  const head = document.createElement('div');
  head.className = 'step-head';
  if (icon) {
    const iconEl = document.createElement('span');
    iconEl.className = 'step-head-icon';
    iconEl.innerHTML = icon;
    head.appendChild(iconEl);
    head.appendChild(document.createTextNode(' '));
  }
  const stepTextEl = document.createElement('span');
  stepTextEl.innerHTML = renderMarkdown(text || 'Working…');
  head.appendChild(stepTextEl);
  bubble.appendChild(head);

  // ponytail: the address goes under the step, not above it, and only the
  // host is boxed — it is the fragment that names the site rather than the
  // page. A move is drawn as source → destination on ONE line: within a site
  // the host is drawn once and both paths share it, and crossing sites draws
  // both hosts with the arrow between. Two stacked rows read as two unrelated
  // facts rather than a move, and they left the width beside each pill empty.
  // Order is always source then destination.
  const page = splitUrl(pageUrl);
  const action = splitUrl(actionTarget);
  const sameSite = page && action && page.host === action.host;
  const primary = action || page;
  if (primary) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'step-url-row step-url-row--copy';
    row.title = 'Copy this address';

    // Two pills only when the move crosses sites. Within one site the host is
    // drawn once and both paths share its line — boxing the same host twice
    // would say "two sites" about a move that stayed on one. A step that did
    // not move at all draws one path: "/home → /home" is an arrow between two
    // copies of the same address, which is noise rather than a move.
    const stayed = sameSite && page.raw === action.raw;
    // The third element marks the source end of a cross-site move. Its path is
    // the one fragment worth dropping when the row runs out of room: where the
    // agent came FROM is context, and "indianex… /article/kathua…" costs four
    // ellipses to say what "indianexpress.com" already said.
    const ends = sameSite
      ? [[page, stayed ? page.path : [page.path, action.path].filter(Boolean).join(' → '), false]]
      : [[page, page && page.path, true], [action, action && action.path, false]];

    let drawn = 0;
    for (const [end, path, isFrom] of ends) {
      // A missing end is not a second pill, and a path of nothing is not a
      // path — either would leave a pill and a separator around nothing.
      if (!end) continue;
      if (drawn) {
        const arrow = document.createElement('span');
        arrow.className = 'step-url-arrow';
        arrow.textContent = '→';
        row.appendChild(arrow);
      }
      const box = document.createElement('span');
      box.className = 'step-url-host';
      box.textContent = end.host;
      row.appendChild(box);
      if (path) {
        const p = document.createElement('span');
        p.className = isFrom ? 'step-url-path step-url-path--from' : 'step-url-path';
        p.textContent = path;
        row.appendChild(p);
      }
      drawn++;
    }

    // Copy the destination — where the agent ended up is the address worth
    // pasting, not where it started.
    wireCopyUrl(row, primary.raw);
    bubble.appendChild(row);
  }

  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

// ── Approval request card ─────────────────────────────────────────────────
// Actions the client should never paint as an approval card. The server
// is the source of truth, but this is defense-in-depth in case a future
// regression sends one of these.
const NON_APPROVABLE_ACTIONS = new Set([
  'task_complete', 'cannot_complete', 'ask_human',
  'write_scratchpad', 'append_scratchpad', 'read_scratchpad',
  'recall_memory',
]);

function appendApprovalCard({ id, reason, action }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  // Defense-in-depth: never render an approval card for a terminal,
  // internal, or question action. The server filters these too; if it
  // ever stops doing so, the user shouldn't see a button to "Approve
  // cannot_complete".
  //
  // Match on action.type, not action — the payload is {type, url}, so
  // passing the object to a Set of strings was always false and this
  // guard never fired.
  if (NON_APPROVABLE_ACTIONS.has(action?.type)) {
    console.warn('[brotto] suppressed approval card for non-approvable action:', action?.type);
    // Still need to ACK so the server's queue doesn't hang. Send deny
    // so the harness aborts cleanly if it was awaiting this reply.
    if (id) void sendMessage({ type: 'submit_approval', id, approved: false });
    return;
  }

  const card = document.createElement('div');
  // .blocking breathes the left rule — the card is waiting on the user.
  card.className = 'approval-card blocking';
  // Stamped so `approval_resolved` can retire exactly this card when the
  // prompt is answered from the OS notification instead of from here.
  if (id) card.dataset.approvalId = String(id);

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
  denyBtn.addEventListener('click', async () => {
    denyBtn.disabled = true;
    const res = await sendMessage({ type: 'submit_approval', id, approved: false });
    // ponytail: the card used to be removed *before* the send, and sendMessage
    // resolves {success:false} rather than rejecting — so a dropped message
    // (SW asleep, task gone) left the agent blocked on a queue reply that would
    // never come, with no card on screen to answer. Re-arm instead.
    if (!res.success) return reArmApproval(card, denyBtn, approveBtn, res.error);
    appendMessage({ role: 'assistant', text: 'Action denied.' });
    card.remove();
  });
  actions.appendChild(denyBtn);

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn-primary btn-sm';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', async () => {
    approveBtn.disabled = true;
    const res = await sendMessage({ type: 'submit_approval', id, approved: true });
    if (!res.success) return reArmApproval(card, denyBtn, approveBtn, res.error);
    appendMessage({ role: 'assistant', text: 'Action approved.' });
    card.remove();
    // ponytail: 5s post-approval revoke window. Show a small inline
    // affordance below the action bubble. If the user changes their
    // mind, the extension sends `revoke` to the server, which clears
    // approved_domains / seen_first_time so the next step re-prompts.
    const revoke = document.createElement('button');
    revoke.className = 'btn btn-secondary btn-sm revoke-btn';
    revoke.textContent = 'Clear approval (5s)';
    let remaining = 5;
    const tick = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(tick);
        revoke.remove();
      } else {
        revoke.textContent = `Clear approval (${remaining}s)`;
      }
    }, 1000);
    revoke.addEventListener('click', () => {
      clearInterval(tick);
      revoke.remove();
      void sendMessage({ type: 'send_to_server', payload: { type: 'revoke' } });
      appendMessage({
        role: 'assistant',
        text: 'Approval cleared — Brotto will ask again next time. '
            + 'Anything the task already submitted is not undone.',
      });
    });
    // Insert after the last assistant message bubble.
    const lastBubble = messagesEl.querySelector('.message.assistant:last-child') || messagesEl;
    lastBubble.appendChild(revoke);
  });
  actions.appendChild(approveBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ponytail: an approval whose reply never reached the server is still pending
// on the server, so the card has to come back — the alternative is a task
// blocked on a queue entry with nothing on screen to answer it. Re-enables
// both buttons and says why, so the user can tell a retry from a real error.
function reArmApproval(card, denyBtn, approveBtn, error) {
  denyBtn.disabled = false;
  approveBtn.disabled = false;
  card.classList.add('blocking');
  let note = card.querySelector('.approval-send-failed');
  if (!note) {
    note = document.createElement('div');
    note.className = 'approval-body approval-send-failed';
    card.insertBefore(note, card.querySelector('.approval-actions'));
  }
  note.textContent = `That didn't reach Brotto (${error || 'no response'}). Try again.`;
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
  card.className = 'clarify-card blocking';
  card.dataset.clarifyId = id;

  const header = document.createElement('div');
  header.className = 'clarify-header';
  header.innerHTML = `<span class="clarify-badge">Your input</span>`;
  card.appendChild(header);

  if (question) {
    const body = document.createElement('div');
    body.className = 'clarify-body';
    body.innerHTML = renderMarkdown(question);
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
  // The caret is the only "still typing" signal the chat has. finishAssistant-
  // Message rewrites the bubble's innerHTML, so it clears itself.
  const caret = document.createElement('span');
  caret.className = 'caret';
  bubble.appendChild(iconEl);
  bubble.appendChild(textNode);
  bubble.appendChild(caret);

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

// ponytail: enterprise-grade failure rendering for policy violations.
// The cyber-team tone: no first-person, no apology, references the audit
// trail, gives a contact path, never blames the user. Returns null for
// non-policy failures so the existing generic render path is unchanged.
function renderPolicyFailureCard(message) {
  const reason = message.failure_reason;
  const summaryText = message.summary || '';
  if (reason === 'policy_blocked') {
    const blockedDomain = summaryText.match(/Blocked by policy:\s*(\S+)/)?.[1] || '(unknown)';
    return {
      title: "Action blocked by your Brotto server's policy",
      body:
        "This task tried to use a domain your Brotto server blocks. Brotto stopped it "
        + "rather than continue. Ask whoever runs that server to remove the domain.",
      footer: 'Blocked domain: ' + blockedDomain,
    };
  }
  if (reason === 'user_denied') {
    return {
      title: 'Task stopped — approval not granted',
      body:
        'You declined an approval prompt during this task. Brotto has stopped rather than continuing '
        + 'with an action you did not approve. Start a new task to retry.',
    };
  }
  if (reason === 'policy_preflight') {
    // ponytail: Agent declined upfront after seeing the org blacklist in
    // its preamble. The harness's `summary` is the agent's own reason
    // ("The organisation's security policy explicitly blacklists
    // mail.google.com. Navigating there would violate your organisation's
    // policy."). Show that as the body — it's the actual explanation, not
    // a paraphrase. Earlier code suppressed it on the grounds that the
    // preceding assistant bubble already stated it; in practice the
    // assistant card is a single line ("Checking the security policy
    // before navigating to Gmail.") and users miss the link.
    //
    // Extract the specific blocked domain if it's named in the summary,
    // so the footer surfaces it without the user having to read the body.
    const blockedDomain = summaryText.match(/blacklists?\s+([^\s.,;]+)/i)?.[1] || '';
    return {
      title: "Task not permitted by your Brotto server's policy",
      body: summaryText ||
        "This task is out of scope for secure mode. Brotto declined it before navigating "
        + "anywhere. Ask whoever runs your Brotto server if you think this is wrong.",
      footer: blockedDomain ? `Blocked domain: ${blockedDomain}` : '',
    };
  }
  if (reason === 'CONNECTION_LOST') {
    // ponytail: WS died mid-task. The background emitted this event so
    // the user sees a structured explanation (not just "Task failed
    // (CONNECTION_LOST)") and understands the task state — the agent
    // can't continue, but their browser is fine and they can retry once
    // the server is back.
    return {
      title: 'Connection to server lost',
      body: "Brotto lost contact with the server mid-task and can't continue from here. "
        + "Your browser is unaffected — start a new task once the server is back.",
    };
  }
  return null;
}

function handleEvent(message) {
  switch (message.type) {

    // ponytail: logged by the background at run_local_task but never
    // broadcast, so this only fires on replay — its job is to put the user's
    // own question back at the top of a restored transcript.
    case 'task_started':
      if (message.task && !messagesEl.querySelector('.message.user')) {
        appendMessage({ role: 'user', text: message.task });
        state.lastGoal = message.task;
      }
      // ponytail: the clock belongs to the run, and the run started before
      // this panel existed. This event is logged rather than broadcast, so it
      // only ever arrives on replay — which is exactly when the start time is
      // missing. It is also the only identifier that survives the replay; see
      // saveSession, which dedupes on it.
      if (message.startedAt && !state.startTime) startTimer(message.startedAt);
      // The server's session id rides along with it. The panel used to have no
      // way to learn this, which is why the history index could only keep the
      // task string; see saveSession and openTranscript.
      if (message.sessionId || message.session_id) {
        state.sessionId = message.sessionId || message.session_id;
      }
      break;

    // The server mints the session id during startRelay, which is *after*
    // the task_started event is logged — and that log is written to storage
    // only, never broadcast, so a panel that launched the run never receives
    // it. Without this the run finishes with session_id: null in the history
    // index and its transcript is unreachable. Carries no task content, so
    // nothing re-renders; it only supplies the id.
    case 'session_bound':
      if (message.session_id) state.sessionId = message.session_id;
      break;

    // ponytail: Bug 3 — WS closed. The background emits a separate
    // `task_failed` event with reason CONNECTION_LOST when a task was
    // in-flight, so the timer stops and the failure bubble renders via
    // the existing task_failed handler. Here we just update the
    // connection pill; nothing else needs to happen on this event.
    case 'disconnected':
      setConnPill(null, 'Idle');
      break;

    // ponytail: the session-create retry in startRelay. A server that is
    // down used to fail as one silent throw; the user saw the panel sit on
    // "Starting…" with nothing to explain it.
    case 'server_unreachable':
      setConnPill('reconnecting', `Server unreachable… (retry ${message.attempt ?? '?'} of ${message.of ?? '?'})`);
      break;

    case 'canonical_status': {
      // ponytail: normalize canonical lifecycle (completed / failed / cancelled /
      // disconnected / cancelling / waiting_for_approval) into the side-panel
      // phase enum so the UI doesn't get stuck in unmapped states. The
      // alreadyTerminal guard covers the case this originally special-cased:
      // the cancel handler emits its own task_failed/canonical_status pair and
      // a late event from the loop's .then() must not overwrite a terminal
      // phase that is already correct.
      const raw = String(message.status || '');
      if (alreadyTerminal(`canonical_status ${raw}`)) break;
      const mapped = (raw === 'completed' || raw === 'cancelled' || raw === 'disconnected') ? 'done'
        : raw === 'failed' ? 'error'
        : raw === 'cancelling' ? 'paused'
        : raw === 'waiting_for_approval' ? 'paused'
        : raw;
      const meta = raw === 'completed' ? 'Task complete'
        : raw === 'failed' ? 'Task failed'
        : raw === 'cancelled' ? 'Task cancelled'
        : null;
      // ponytail: a cancelled run is terminal but arrives WITHOUT a
      // task_completed/task_failed pair — the background marks the task
      // terminal before notifying, so those never fire. Without this the run
      // vanished from history entirely, which reads as "nothing happened"
      // rather than "I stopped it".
      if (raw === 'cancelled') {
        void saveSession({ status: 'cancelled', elapsed: timerActiveEl && timerActiveEl.textContent });
      }
      setPhase(mapped, meta);
      break;
    }

    case 'step_card': {
      // ponytail: any new step implies login was resolved (the loop only
      // emits step_progress after the human_input_queue unblocks). Fade
      // the bubble + button out before rendering the new step so the
      // user sees a continuous flow, not two bubbles stacked.
      clearLoginPrompt();
      state.stepCount = Math.max(state.stepCount, message.index !== undefined ? message.index + 1 : state.stepCount + 1);
      updateStepCount();
      const icon = iconFor(message.iconKind || '');
      // ponytail: prefer the model's `clientText` (one-line user-facing update)
      // as the bubble title. Fall back to reasoning only when clientText is
      // missing — older models emit a single `reasoning` field. Last-resort
      // fallback: derive from the raw action type so the bubble is never
      // empty. This split keeps internal jargon (phase names, criterion ids,
      // scratchpad bullets) out of the chat the user reads.
      const bubbleTitle = (message.clientText && message.clientText.trim())
        || (message.reasoning && message.reasoning.trim())
        || deriveReasoningFromAction(message.title || '', message.iconKind);
      // ponytail: each step gets its OWN persistent bubble. clientText is the
      // bubble title. Icon is passed separately so HTML entities decode
      // instead of rendering as literal `&#8594;`.
      appendStep({ icon, text: bubbleTitle, pageUrl: message.url, actionTarget: message.actionTarget ?? null });
      // Track context utilization for the CONTEXT cell. Backend ships
      // `{tokens, window, pct}` per step (pct is the model-reported
      // usage / model's context window). Frontend just stores and
      // renders — no math here.
      if (message.context && typeof message.context === 'object') {
        state.lastContext = message.context;
      }
      updateContextUsage();
      break;
    }

    case 'log':
      // ponytail: historical handler kept for back-compat. New background
      // logs go to the service worker console only; UI stays clean.
      break;

    case 'login_required':
      setPhase('paused', `Login required at ${message.domain || 'site'}`);
      // ponytail: dedupe via clearLoginPrompt so the old bubble + button
      // fade out instead of being yanked from the layout (which causes a
      // visible jump when the next bubble appears).
      clearLoginPrompt();
      const domain = message.domain || 'this site';
      const loginMsg = document.createElement('div');
      loginMsg.className = 'message assistant login-required-msg';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const badge = document.createElement('div');
      badge.className = 'login-required-badge';
      badge.textContent = `Waiting for sign-in · ${domain}`;
      const body = document.createElement('div');
      body.className = 'login-required-body';
      body.textContent = 'Sign in manually in the browser tab. The task resumes automatically once the post-login page loads. Use Continue only if auto-resume does not fire.';
      bubble.appendChild(badge);
      bubble.appendChild(body);
      loginMsg.appendChild(bubble);
      messagesEl.appendChild(loginMsg);
      // ponytail: safety-net Continue button. Primary resume path is
      // webNavigation.onCommitted firing off the login domain, but that
      // misses some SPAs and OAuth callback flows. The button is a manual
      // override — clicking it fades both bubble + button out and signals
      // resume to the loop. Cleaned up automatically on next step / task
      // end so it never lingers into the next task.
      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'login-continue-btn';
      continueBtn.textContent = 'Continue';
      continueBtn.addEventListener('click', () => {
        continueBtn.disabled = true;
        // ponytail: clearLoginPrompt runs in the same render frame as the
        // click, so the bubble + button fade out together. The local_login_complete
        // signal goes out in parallel — the loop unblocks as soon as the
        // SW relays the human_reply, and the next step_card will arrive
        // immediately after with no gap.
        clearLoginPrompt();
        try {
          chrome.runtime.sendMessage({ type: 'local_login_complete' }, () => {
            void chrome.runtime.lastError;
          });
        } catch { /* SW gone — user can re-trigger */ }
      });
      messagesEl.appendChild(continueBtn);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      break;

    case 'context_update': {
      // ponytail: scratchpad-only step (no external action visible to
      // bubble). Backend still emits context so the CONTEXT cell updates
      // on every step.
      if (message.context && typeof message.context === 'object') {
        state.lastContext = message.context;
      }
      updateContextUsage();
      break;
    }

    case 'task_completed':
      if (alreadyTerminal('task_completed')) break;
      // ponytail: clear any lingering login prompt — task is ending, no
      // point leaving the user looking at a "Waiting for sign-in" bubble.
      clearBlockingCards();
      // Captured before stopTimer, which resets the counter.
      void saveSession({ status: 'done', steps: message.steps, elapsed: timerActiveEl && timerActiveEl.textContent });
      stopTimer();
      setPhase('done', message.summary ? message.summary.slice(0, 60) : 'Task complete');
      state.stepCount = message.steps || state.stepCount;
      updateStepCount();
      let messageText = `${message.steps || state.stepCount} steps · ${message.summary || ''}`;
      // If extracted_data exists, append it as structured facts (already formatted by agent)
      if (message.extracted_data && typeof message.extracted_data === 'object') {
        const facts = Object.entries(message.extracted_data)
          .filter(([, v]) => v && typeof v === 'string')
          .map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `${label}: ${v}`;
          })
          .join(' | ');
        if (facts) messageText += `\n\n${facts}`;
      }
      if (message.timing && message.timing.components) {
        const c = message.timing.components;
        const ms = (s) => `${(s * 1000).toFixed(0)}ms`;
        messageText += `\n\nTiming (${message.timing.steps} steps, ${message.timing.wall_s.toFixed(1)}s wall): ` +
          `observe=${ms(c.observe)}  plan=${ms(c.model_plan)}  exec=${ms(c.execute)}  ` +
          `login=${ms(c.login_pause)}  other=${ms((c.filter ?? 0) + (c.approval_pause ?? 0) + (c.ws_send_progress ?? 0))}`;
      }
      appendMessage({
        role: 'done',
        text: messageText,
        finalAnswer: message.finalAnswer,
      });
      break;

    case 'task_failed':
      if (alreadyTerminal('task_failed')) break;
      // ponytail: same as task_completed — clean up login prompt on any
      // terminal event so the user never sees a stale "Waiting" bubble
      // after the task has failed / been cancelled.
      clearBlockingCards();
      void saveSession({ status: 'failed', elapsed: timerActiveEl && timerActiveEl.textContent });
      stopTimer();
      // ponytail: structured failure bubble (title + body + footer) for
      // policy failures; falls back to the harness's `summary` for everything
      // else so the user always sees WHY the task failed, not just the
      // code. The earlier version suppressed the bubble entirely for
      // `policy_preflight` on the theory that the preceding assistant
      // card already explained it — in practice that card is one line
      // ("Checking the security policy before navigating to Gmail.") and
      // the link to the actual reason was easy to miss.
      const policyMsg = renderPolicyFailureCard(message);
      if (policyMsg) {
        setPhase('error', policyMsg.title);
        // ponytail: title is set via setPhase above; render a structured
        // bubble with the body and a separate footer so the blocked
        // domain + reference ID don't get lost in the prose.
        appendFailureBubble({
          title: policyMsg.title,
          body: policyMsg.body,
          footer: policyMsg.footer,
        });
      } else {
        // Non-policy failure: surface the harness's `summary` verbatim so
        // the user sees the actual reason (e.g. network error, model
        // refusal, missing login). Falls back to the failure_reason code
        // only when the harness didn't include a summary.
        const failMsg = message.summary || message.failure_reason || 'Task failed';
        setPhase('error', message.failure_reason ? `Task failed (${message.failure_reason})` : 'Task failed');
        appendMessage({ role: 'error', text: failMsg });
      }
      break;

    case 'clarify_request': {
      // ponytail: login wall was cleared (otherwise the loop couldn't
      // have produced a clarifying question). Fade bubble + button out
      // before the new clarify card appears so the transition reads as
      // a single flow, not two stacked bubbles.
      clearLoginPrompt();
      setPhase('paused', 'Brotto has a question');
      appendClarifyCard({
        id: message.id,
        question: message.question || 'Brotto needs your guidance.',
        reason: message.reason || '',
      });
      break;
    }

    case 'approval_request': {
      // ponytail: same as clarify — login resolved before an approval
      // request could fire. Fade login prompt out so the approval card
      // is the only new element on screen.
      clearLoginPrompt();
      setPhase('paused', 'Agent wants approval for a critical action');
      const a = message.action || {};
      const preview = a.url ? `${a.type ?? 'action'} → ${a.url}` : (a.type ?? 'action');
      appendApprovalCard({
        id: message.id,
        reason: message.reason || 'Brotto wants to perform an action that needs your approval.',
        action: { type: a.type, url: a.url },
      });
      break;
    }

    // ponytail: the approval can be answered from the OS notification, which
    // the service worker resolves without the panel's help. Without this the
    // card sat on screen with two dead buttons until the next step arrived.
    case 'approval_resolved': {
      const card = message.id
        ? messagesEl.querySelector(`.approval-card[data-approval-id="${CSS.escape(String(message.id))}"]`)
        : null;
      if (!card) break;
      card.remove();
      appendMessage({
        role: 'assistant',
        text: message.approved ? 'Action approved.' : 'Action denied.',
      });
      // The task is unblocked, so the clock has to start counting again —
      // setPhase('paused') is what stopped it, and nothing else resumes it.
      if (state.phase === 'paused') setPhase('executing', 'Working…');
      break;
    }

    // ── Canonical events ─────────────────────────────────────────────────
    case 'canonical_step': {
      // ponytail: any canonical step past a login wall clears the prompt.
      clearLoginPrompt();
      const icon = message.kind === 'action' ? '&#9654;' : message.kind === 'observation' ? '&#128065;' : '&#10003;';
      const titleText = (message.reasoning && message.reasoning.trim())
        || deriveReasoningFromAction(message.summary || '', message.kind)
        || 'Working on it…';
      if (!currentAssistantMsg) {
        startAssistantMessage({ icon, title: titleText });
      } else {
        // Each heartbeat supersedes the last: the bubble is one live "still
        // working" line, not one message per step. Previously this branch
        // did nothing, so every step's text was dropped.
        currentAssistantMsg.textNode.nodeValue = titleText;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      break;
    }

    case 'canonical_approval': {
      const req = message.request || {};
      // ponytail: same as approval_request — login must be resolved.
      clearLoginPrompt();
      setPhase('paused', 'Agent is requesting approval');
      appendApprovalCard({
        id: req.actionId || 'unknown',
        reason: 'Brotto is requesting approval for a sensitive action.',
        action: { type: req.action?.type },
      });
      break;
    }

    case 'canonical_terminal': {
      if (alreadyTerminal('canonical_terminal')) break;
      // ponytail: terminal event from the canonical stream — clean up
      // any login prompt so it doesn't survive past the task ending.
      clearBlockingCards();
      stopTimer();
      const m = message.message || {};
      if (m.type === 'task.completed') {
        setPhase('done', m.summary || 'Task complete');
        appendMessage({ role: 'done', text: m.summary || 'Task completed successfully.', finalAnswer: m.finalAnswer });
      } else if (m.type === 'task.failed') {
        setPhase('error', m.message || 'Task failed');
        appendMessage({ role: 'error', text: m.message || 'Task failed.' });
      } else {
        // ponytail: this used to render a green "Task ended." for *any*
        // other type, so a cancellation showed as a success. Anything that
        // isn't a completion ends the task without claiming it worked.
        setPhase('error', 'Task ended');
        appendMessage({ role: 'error', text: m.message || 'The task ended before it finished.' });
      }
      break;
    }

    case 'canonical_error':
      appendMessage({ role: 'error', text: `${message.code}: ${message.message}` });
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
}

// ponytail: the panel's own listener and the replay of a closed-panel log go
// through the same handler, so a reopened panel renders exactly what the live
// one did instead of a second rendering path that can drift.
chrome.runtime.onMessage.addListener(handleEvent);

// ── Initial state ────────────────────────────────────────────────────────
setPhase('idle', 'Ready');
goalEl.focus();

// ponytail: a task lives in the service worker, so closing the panel mid-task
// left the next open blank while the agent kept working. The background
// buffers this run's events; replay them through the same handler. The
// `canonical_status` the SW already pushed is in the log too, so phase and
// timer come back on their own.
(async () => {
  const res = await sendMessage({ type: 'get_panel_log' });
  const events = res && res.events;
  if (!Array.isArray(events) || events.length === 0) return;
  for (const e of events) handleEvent(e);
})();

// ponytail: an unsent task is the most expensive thing to lose to an
// accidental panel close, and there is exactly one place the user can type
// it. Same store as the API key — one run's worth, not a document.
(async () => {
  const { draft } = await chrome.storage.session.get('draft');
  if (typeof draft === 'string' && draft.trim()) goalEl.value = draft;
  goalEl.addEventListener('input', () => {
    void chrome.storage.session.set({ draft: goalEl.value });
  });
})();

(async () => {
  // ponytail: the hidden plannerUrl input was only ever written by an explicit
  // Save, so on a fresh open it held the localhost default and the panel probed
  // /health and fetched /v1/policy against localhost while the service worker
  // used the saved URL — the panel and the SW could disagree about which server
  // the task was on. Hydrate both fields from storage first; everything below
  // and every other call site reads plannerUrlEl, so this one read covers them.
  const { settings } = await chrome.storage.local.get('settings');
  const saved = (settings && typeof settings.serverUrl === 'string') ? settings.serverUrl.trim() : '';
  if (saved) {
    plannerUrlEl.value = saved;
    plannerUrlSetting.value = saved;
  }
  const url = plannerUrlEl.value.trim() || 'http://localhost:8000';
  try {
    const res = await fetch(url + '/health', { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.plannerUrl = url;
  } catch {
    // ponytail: Bug 9 — server unreachable on open. A toast, not a chat
    // message: this is a transient condition, not part of the transcript,
    // and the connection pill already says it. The previous version posted
    // a role:'error' message then tried to remove it with '.message-error'
    // — but appendMessage writes class "message error" (a space), so the
    // selector never matched and the notice sat in the chat forever.
    state.serverReachable = false;
    setConnPill(null, 'Server unreachable');
    toast('Server unreachable — settings still work locally', 'bad', 5000);
  }
  // Last, so it runs whether or not the health probe succeeded: the panel
  // still needs its fallback lines when the server is down.
  void currentTab().then(refreshEmptyState);
})();
