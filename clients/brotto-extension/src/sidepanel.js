// sidepanel.js — chat UI rewrite for the Brotto side panel.
// Preserves all event handlers, state machine, and message listeners.
// Only rendering functions are updated to produce the Claude-in-Chrome chat interface.

const $modelProvider = document.getElementById('model-provider');
const $modelName = document.getElementById('model-name');
const $modelNameOptions = document.getElementById('model-name-options');
const $modelBaseUrlSetting = document.getElementById('modelBaseUrlSetting');
const $modelBaseUrl = document.getElementById('model-base-url');
const $modelKey = document.getElementById('model-api-key');
const $modelSave = document.getElementById('model-save');
const $modelStatus = document.getElementById('model-save-status');
const $modelVisionBadge = document.getElementById('modelVisionBadge');
const $modelContextWindow = document.getElementById('modelContextWindow');

// ── Ink & Rule dropdown ──────────────────────────────────────────────────
// One control, two instances: provider and the model
// field's suggestion list. The value host is always the element the rest of
// this file already reads — a real <select> for the first two, the free-text
// <input> for the third — so choosing an option writes `host.value` and fires
// that element's own `change`, and every existing listener keeps working.
// The component owns only the listbox.
//
// Selection is carried by a check glyph and by aria-selected, never by colour:
// the system is monochrome, so a tint is not a channel.

const DROPDOWNS = [];
// Set while choose() pushes a value into its host. The model host is an
// <input>, so writing it emits an `input` event, and the model list's own
// "user is typing, offer suggestions" handler would immediately reopen what
// was just closed.
let dropdownWriting = false;

function attachDropdown({ root, trigger, list, getOptions, getValue, setValue, editable }) {
  let active = -1;

  function paint() {
    const value = getValue();
    list.textContent = '';
    const options = getOptions();
    sync();
    options.forEach((opt, i) => {
      const selected = opt.value === value;
      const row = document.createElement('li');
      row.className = 'dd-option';
      row.id = `${list.id}-opt-${i}`;
      row.dataset.value = opt.value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', selected ? 'true' : 'false');
      const check = document.createElement('span');
      check.className = 'dd-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = selected ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'dd-option-label';
      label.textContent = opt.label;
      row.appendChild(check);
      row.appendChild(label);
      row.addEventListener('click', () => choose(i));
      list.appendChild(row);
    });
    active = -1;
  }

  // The box shows the host's current value. Nothing else writes that text, so
  // a value set straight on the host — hydrateSettingsPanel, the save handler,
  // a restored config — has to be pushed into the label by hand.
  function sync() {
    const slot = trigger.querySelector('.dd-value');
    if (!slot) return;
    const row = getOptions().find((o) => o.value === getValue());
    slot.textContent = row ? row.label : (getValue() || '—');
  }

  function setActive(i) {
    const rows = list.children;
    if (active >= 0 && rows[active]) rows[active].classList.remove('active');
    active = i;
    if (!rows[active]) return;
    rows[active].classList.add('active');
    // The DOM focus stays on the trigger so Tab keeps working and Escape has
    // somewhere to go; aria-activedescendant is what a screen reader reads.
    trigger.setAttribute('aria-activedescendant', rows[active].id);
    if (rows[active].scrollIntoView) rows[active].scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    const n = list.children.length;
    if (!n) return;
    const from = active < 0 ? (delta > 0 ? -1 : 0) : active;
    setActive((from + delta + n) % n);
  }

  function open() {
    for (const other of DROPDOWNS) if (other !== api) other.close();
    paint();
    list.hidden = false;
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    const current = getOptions().findIndex((o) => o.value === getValue());
    if (current >= 0) setActive(current);
  }

  function close() {
    list.hidden = true;
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function choose(i) {
    const row = list.children[i];
    if (!row) return;
    const value = row.dataset.value;
    close();
    dropdownWriting = true;
    try {
      setValue(value);
    } finally {
      dropdownWriting = false;
    }
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      // Close without selecting. The value host is untouched, so a select
      // stays where it was and a typed model id survives.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') { close(); return; }
    // Space only means "select" on a closed-over-a-value control. On the model
    // box it is a character, and swallowing it would make half of every model
    // id untypeable the moment the list is open.
    if (editable && e.key === ' ') return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { open(); return; }
      if (e.key === 'Enter' || e.key === ' ') { choose(active); return; }
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  });
  // Keep the pointer from moving focus off the trigger on press, which would
  // blur it and let a second dropdown open.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  const api = { open, close, paint, sync, isOpen: () => !list.hidden };
  DROPDOWNS.push(api);
  return api;
}

// The catalogue comes from GET /v1/models (see model_catalog.js). It is null
// until the first load resolves, which is why the provider <select> ships
// empty rather than with hardcoded options.
let modelCatalog = null;

function currentProvider() {
  return modelCatalog ? brottoModelCatalog.provider(modelCatalog, $modelProvider.value) : null;
}

function populateModelOptions() {
  if (!$modelNameOptions) return;
  const provider = currentProvider();
  $modelNameOptions.textContent = '';
  for (const entry of provider?.models || []) {
    const opt = document.createElement('option');
    opt.value = entry.id;
    $modelNameOptions.appendChild(opt);
  }
  // The base-URL box is a per-provider fact, not a preference: Anthropic and
  // OpenAI have a fixed endpoint, everything else takes one. A field left
  // visible for a provider that ignores it is a lie about what the user has to
  // fill in. The API-key box is never per-provider — every provider in the
  // catalogue needs a key.
  if ($modelBaseUrlSetting) {
    const accepts = !!provider?.accepts_base_url;
    $modelBaseUrlSetting.classList.toggle('hidden', !accepts);
    if (accepts && $modelBaseUrl && !$modelBaseUrl.value) {
      $modelBaseUrl.value = provider.default_base_url || '';
    }
  }
}

function populateProviders() {
  if (!$modelProvider) return;
  const previous = $modelProvider.value;
  $modelProvider.textContent = '';
  for (const p of modelCatalog?.providers || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    $modelProvider.appendChild(opt);
  }
  if (previous && brottoModelCatalog.provider(modelCatalog, previous)) {
    $modelProvider.value = previous;
  }
}

// ── What the model can do: a vision badge and a context window, read from
// the same catalogue entry the save handler prices its budget against.
function renderModelFacts() {
  const modelId = ($modelName?.value || '').trim();
  const entry = (currentProvider()?.models || []).find((m) => m.id === modelId) || null;

  if ($modelContextWindow) {
    // contextWindow() is the one that answers for an id the catalogue has
    // never seen: the provider's smallest known window, which can only
    // under-fill. An invented 1M would overrun the real window and 400.
    $modelContextWindow.textContent = modelId
      ? `${brottoModelCatalog.contextWindow(modelCatalog, $modelProvider?.value, modelId).toLocaleString()} ctx`
      : '';
    $modelContextWindow.title = modelId && !entry
      ? `${modelId} is not in the catalogue — showing the smallest window this provider is known to have`
      : '';
  }

  if (!$modelVisionBadge) return;
  // Vision is asserted only where the vendor documents image input. It is
  // deliberately NOT asserted in the other direction: in this catalogue
  // `false` means "not documented", so a badge claiming the model is
  // text-only would be the panel inventing a fact the server declined to
  // make. The neutral badge is the honest reading — it says we checked and
  // the vendor said nothing — where rendering nothing would be
  // indistinguishable from a model that has no vision at all.
  $modelVisionBadge.hidden = !modelId;
  $modelVisionBadge.dataset.vision = entry?.vision ? 'yes' : 'no';
  $modelVisionBadge.textContent = entry?.vision ? 'VISION' : 'vision unverified';
}

if ($modelProvider) {
  $modelProvider.addEventListener('change', () => {
    populateModelOptions();
    renderModelFacts();
  });
}

if ($modelName) {
  $modelName.addEventListener('input', () => {
    renderModelFacts();
    // Typing into the model box IS the request for suggestions. Escape or a
    // click away dismisses them; nothing here forces the list open on focus,
    // because a dropdown that appears the moment you look at a field is a
    // dropdown you learn to ignore.
    if (dropdownWriting) return;
    if (modelDd?.isOpen()) modelDd.paint();
    else if ($modelName.value.trim()) modelDd?.open();
  });
}

async function initModelSettings(base) {
  modelCatalog = await brottoModelCatalog.load(base);
  populateProviders();
  populateModelOptions();
  // A stale provider id from a config saved against an older catalog leaves
  // the select on its first option while the stored model belongs to another.
  if (!$modelProvider.value) {
    $modelProvider.value = modelCatalog?.providers?.[0]?.id || '';
    populateModelOptions();
  }
  await hydrateModelSettings();
}

if ($modelSave) {
  $modelSave.addEventListener('click', async () => {
    const provider = $modelProvider.value;
    const model = $modelName.value.trim();
    if (!provider || !model) return;
    const providerInfo = currentProvider();
    const ctx = brottoModelCatalog.contextWindow(modelCatalog, provider, model);
    // base_url rides on modelConfig, not on the key, so a self-hosted or
    // OpenRouter user does not re-paste it every browser restart the way
    // they re-paste the key.
    const baseUrl = providerInfo?.accepts_base_url
      ? ($modelBaseUrl?.value.trim() || providerInfo.default_base_url || null)
      : null;
    // model_config → chrome.storage.local (persists).
    // api_key → chrome.storage.session (in-memory; cleared on browser restart).
    await Promise.all([
      chrome.storage.local.set({
        modelConfig: { provider, model, context_window: ctx, base_url: baseUrl },
      }),
      $modelKey.value.trim()
        ? chrome.storage.session.set({ modelApiKey: $modelKey.value.trim() })
        : chrome.storage.session.remove('modelApiKey'),
    ]);
    setModelPill(model);
    // A re-pasted key is usually a *different* key, and the pre-flight cache
    // only knows whether some key was present — it cannot tell them apart
    // without hashing a secret to find out. Dropping the pass here is exact,
    // and costs one probe on the next send.
    modelCheckPass = null;
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
//
// "Default" was the wrong word for the unset case: it reads as a neutral
// choice, and in the header it was mistaken for a leftover security-mode
// selector. "Server default" names what it actually means — this browser
// chose nothing, and the server decides.
const MODEL_UNSET_LABEL = 'Server default';

function setModelPill(model) {
  if (!modelPillName) return;
  const label = model || MODEL_UNSET_LABEL;
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
  if (modelPill) {
    modelPill.classList.toggle('no-model', !model);
    modelPill.title = model
      ? `Model: ${model} — open settings to change it`
      : 'No model chosen in this browser — the server picks. Open settings to choose one.';
  }
  fitModelPill();
  // Geist may still be loading when this first runs, which would measure the
  // fallback face and under-report the overflow.
  document.fonts?.ready.then(fitModelPill);
}

// A name that fits sits dead still; only an overflowing one travels. Measuring
// beats guessing — a marquee that always runs makes "gpt-6-luna" drift pointlessly.
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
    // Never overwrite a field the user is mid-edit in. initModelSettings runs
    // twice (once on load, once after /health names the real server) and
    // someone typing a custom model id in that window would otherwise watch
    // it get reverted from storage under them.
    if ($modelName && document.activeElement !== $modelName) $modelName.value = cfg.model;
    // Only refill when the stored config has one: a config saved before the
    // field existed should land on the provider's default, not on a stale
    // value the user typed for a different provider.
    if ($modelBaseUrl && cfg.base_url) $modelBaseUrl.value = cfg.base_url;
    setModelPill(cfg.model);
  } else {
    setModelPill(null);
  }
  // Don't re-hydrate the API key field — it's in chrome.storage.session
  // and we deliberately don't surface it in the UI (no plaintext display).
}
// ── Pre-flight: can this browser run anything at all?
//
// The check is a real request to the provider, not a local sanity check: a
// rejected key and an exhausted balance are both invisible from here, and both
// used to surface as a run that died after the first step with the reason
// buried in a failure bubble. The server does the call and classifies it, so
// the panel never has to know an HTTP status from any of eight vendors.
//
// A failure to *check* is not a failure of the model. The server being down,
// or a proxy in the way, must not turn into "your model is broken" — those
// have their own reporting (connect / reconnect) and it already works. So
// anything that isn't a clean answer from the endpoint passes through and
// lets the run start.
const MODEL_CHECK_TITLE = {
  no_model: 'No model is set',
  auth_failed: 'Your API key was rejected',
  no_credits: 'Out of credit with the provider',
  rate_limited: 'The provider is rate-limiting this key',
  unknown_model: 'That model is not available',
  unreachable: 'Cannot reach the model provider',
};

// Only a pass is cached. Caching a failure would leave a user who fixes the
// key still blocked until the TTL expired, which is the one outcome worse than
// not caching at all.
//
// ponytail: 10 minutes. MiniMax-M3 measured 2–5s per probe with thinking
// disabled, and a user starting five tasks in a row should pay that once.
// Ceiling: a key revoked mid-session goes unnoticed for up to this long.
const MODEL_CHECK_TTL_MS = 10 * 60 * 1000;
let modelCheckPass = null;

async function checkModelReady() {
  const [local, session_] = await Promise.all([
    chrome.storage.local.get('modelConfig'),
    chrome.storage.session.get('modelApiKey'),
  ]);
  const raw = local.modelConfig;
  const cfg = raw && typeof raw.provider === 'string' ? raw : raw?.model_config;
  const apiKey = session_.modelApiKey || undefined;
  // The key is the provider, the model and whether a key was pasted — never
  // the key itself. Changing any of those has to re-run the probe.
  const sig = `${cfg ? `${cfg.provider}:${cfg.model}` : ''}|${apiKey ? 'k' : 'nokey'}`;
  if (modelCheckPass && modelCheckPass.sig === sig
      && Date.now() - modelCheckPass.at < MODEL_CHECK_TTL_MS) {
    return { ok: true, model: modelCheckPass.model };
  }

  const base = (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');
  let body;
  try {
    const res = await fetch(`${base}/v1/model/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_config: cfg || undefined, api_key: apiKey, device_id: await deviceId() }),
    });
    if (!res.ok) return { ok: true };  // could not check — not the model's fault
    body = await res.json();
  } catch {
    return { ok: true };
  }
  if (!body || body.ok !== false) {
    modelCheckPass = { sig, at: Date.now(), model: body && body.model };
    return { ok: true, model: body && body.model };
  }
  // The resolver's own "no model configuration available" names env vars and
  // frame fields — accurate for an operator, useless to the person reading
  // the panel, and they can only act on the settings screen anyway.
  if (body.kind === 'no_model') {
    return {
      ok: false,
      kind: 'no_model',
      body: 'Brotto has no model to run on: this browser has none saved, and '
          + 'your server has none configured. Open **Settings → Model** to '
          + 'choose a provider and model — Brotto will check the key before '
          + 'it starts anything.',
    };
  }
  return { ok: false, kind: body.kind, body: body.error || 'The model could not be used.' };
}

// ── Wire the dropdowns to the value hosts the rest of this file uses.
const providerDd = $modelProvider && attachDropdown({
  root: document.getElementById('providerDd'),
  trigger: document.getElementById('model-provider-trigger'),
  list: document.getElementById('model-provider-list'),
  getOptions: () => Array.from($modelProvider.children).map((o) => ({ value: o.value, label: o.textContent || o.value })),
  getValue: () => $modelProvider.value,
  // Dispatching `change` is what makes the provider switch behave exactly as
  // it did when this was a native select: repopulate the model list, show or
  // hide the base-URL and key boxes, refresh the facts.
  setValue: (v) => { $modelProvider.value = v; $modelProvider.dispatchEvent(new Event('change')); },
});

// The trigger shows the host's current value, so both selects need a sync
// after anything writes them: the catalogue landing, hydrateSettingsPanel,
// and the save handler's own round trip.

const modelDd = $modelName && attachDropdown({
  root: document.getElementById('modelDd'),
  trigger: $modelName,
  list: document.getElementById('model-name-list'),
  // Free text stays free: the list is filtered to what has been typed, but an
  // id that matches nothing is still typed, still saved, and still gets a
  // context window. That is the whole reason this control is an input.
  getOptions: () => {
    const typed = ($modelName.value || '').trim().toLowerCase();
    return (currentProvider()?.models || [])
      .filter((m) => !typed || m.id.toLowerCase().includes(typed))
      .map((m) => ({ value: m.id, label: m.label || m.id }));
  },
  getValue: () => $modelName.value.trim(),
  setValue: (v) => { $modelName.value = v; $modelName.dispatchEvent(new Event('input')); },
  editable: true,
});

// Called twice on purpose: once now so the header pill names the model
// immediately, and again from initModelSettings once the catalogue has landed
// and the provider select can actually hold the id this config names. Both
// repaint the triggers and the facts on the way out, because a value written
// straight to a host never tells anyone it changed.
hydrateModelSettings().then(() => { providerDd?.sync(); renderModelFacts(); });
initModelSettings(document.getElementById('plannerUrl')?.value || '')
  .then(() => { providerDd?.sync(); renderModelFacts(); });

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
const agentSecretSetting = document.getElementById('agentSecretSetting');

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
const outcomeCell     = document.getElementById('outcomeCell');
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

// The hosted Brotto server's address. There isn't one yet — self-host is the
// only deployment — so this is empty and the field below stays editable,
// which is exactly how it behaves today. When a launch domain is chosen, set
// it here and nothing else changes: the read-only state is derived by
// comparing the field against this constant, not stored and not toggled.
const HOSTED_SERVER_URL = '';

const SELF_HOST_HINT = 'Where Brotto sends your tasks. Leave this alone unless you run your own Brotto server.';
const HOSTED_HINT = 'Brotto is hosted. Run your own server to point it somewhere else.';

function applyServerAddressState() {
  if (!plannerUrlSetting) return;
  const hosted = !!HOSTED_SERVER_URL && plannerUrlSetting.value.trim() === HOSTED_SERVER_URL;
  plannerUrlSetting.readOnly = hosted;
  plannerUrlSetting.classList.toggle('input--readonly', hosted);
  const hint = document.getElementById('serverAddressHint');
  if (hint) hint.textContent = hosted ? HOSTED_HINT : SELF_HOST_HINT;
}

plannerUrlSetting.addEventListener('input', () => {
  plannerUrlEl.value = plannerUrlSetting.value;
  applyServerAddressState();
});

// ── Session history ────────────────────────────────────────────────────────
const historyBtn     = document.getElementById('historyBtn');
const historyOverlay = document.getElementById('historyOverlay');
const historyClose   = document.getElementById('historyClose');
const historyList    = document.getElementById('historyList');

historyBtn.addEventListener('click', async () => {
  historyOverlay.classList.add('open');
  await renderHistory();
});
historyClose.addEventListener('click', () => historyOverlay.classList.remove('open'));
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) historyOverlay.classList.remove('open');
});

// ── Confirm ────────────────────────────────────────────────────────────────
// Erasure is the one thing here with no undo, so it asks. `window.confirm`
// cannot be styled and everything else this panel asks has a shape.
//
// The body is passed as text nodes, never innerHTML: it carries the user's
// own task text, and a task named `<img onerror=…>` must render as a sentence.
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle = document.getElementById('confirmTitle');
const confirmBody = document.getElementById('confirmBody');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');

let confirmSettle = null;

function askConfirm(title, body, okLabel = 'Delete') {
  if (confirmSettle) confirmSettle(false);
  confirmTitle.textContent = title;
  confirmBody.replaceChildren();
  body.forEach((part) => {
    const span = document.createElement(typeof part === 'string' ? 'span' : 'strong');
    span.textContent = part;
    confirmBody.appendChild(span);
  });
  confirmOk.textContent = okLabel;
  confirmOverlay.classList.add('open');
  confirmOk.focus();
  return new Promise((resolve) => { confirmSettle = resolve; });
}

function closeConfirm(answer) {
  confirmOverlay.classList.remove('open');
  const settle = confirmSettle;
  confirmSettle = null;
  if (settle) settle(answer);
}

confirmOk.addEventListener('click', () => closeConfirm(true));
confirmCancel.addEventListener('click', () => closeConfirm(false));
confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) closeConfirm(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && confirmOverlay.classList.contains('open')) closeConfirm(false);
});

// The server's disk is the record. This array is only what *this browser*
// watched happen: it caps at 20, so a run finished on another machine, or one
// pushed out by the cap, is on disk and invisible here. So the server answers
// and this is the fallback for when it cannot — a panel opened with the
// orchestrator down still shows what it knows about.
const SESSION_LIMIT = 20;
const SESSIONS_KEY = 'sessions';

async function listSessions() {
  const { sessions } = await chrome.storage.local.get(SESSIONS_KEY);
  return Array.isArray(sessions) ? sessions : [];
}

async function historyEntries() {
  const local = await listSessions();
  try {
    const res = await fetch(`${serverBase()}/v1/sessions`, { headers: await authHeaders() });
    if (!res.ok) return local;
    const { sessions } = await res.json();
    if (!Array.isArray(sessions)) return local;
    return sessions.map((s) => ({
      task: s.task || s.title || '(no task text)',
      status: s.status,
      steps: s.steps,
      // Elapsed time is what the loop reported; the index has no record of it.
      elapsed: '—',
      startedAt: s.started_at,
      session_id: s.session_id,
      task_count: s.task_count,
    }));
  } catch {
    return local;
  }
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
  historyList.hidden = false;
  const sessions = await historyEntries();
  document.getElementById('historyDeleteAll').hidden = sessions.length === 0;
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.innerHTML = '<strong>No tasks yet</strong>Every task you finish is listed here. '
      + 'Click one to pick it back up.';
    historyList.replaceChildren(empty);
    return;
  }
  historyList.replaceChildren(...sessions.map((s) => {
    const wrap = document.createElement('div');
    wrap.className = 'history-row';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-item';
    row.dataset.status = s.status || 'done';
    row.innerHTML = '<span class="history-mark"></span><span><span class="history-task"></span>'
      + '<span class="history-meta"></span></span>';
    row.querySelector('.history-task').textContent = s.task || '(no task text)';
    // A row you can't act on is a lie about what history is for. Clicking one
    // puts that conversation back in the chat so you can carry on with it.
    row.title = s.session_id
      ? 'Bring this conversation back and keep going'
      : 'Put this task back in the box';
    row.addEventListener('click', () => void replaySession(s));
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

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history-delete';
    del.setAttribute('aria-label', `Delete “${s.task || 'this conversation'}”`);
    del.title = 'Delete this conversation';
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path></svg>';
    del.addEventListener('click', () => void deleteSession(s));

    wrap.append(row, del);
    return wrap;
  }));
}

// ── Erasure ────────────────────────────────────────────────────────────────
// Two files, not one: the transcript on the server and the row in this
// browser. Removing only the row would leave the conversation on the
// server's disk and out of the list — the worst of both.
async function deleteSession(entry) {
  const ok = await askConfirm(
    'Delete this conversation?',
    ['This deletes “', entry.task || 'this conversation', '” and everything in it. '
      + 'There is no way back.'],
  );
  if (!ok) return;

  // By id, not identity: a row the server supplied is a fresh object and is
  // not in local storage at all, so filtering on === would keep every row.
  const remaining = (await listSessions()).filter((s) => (
    entry.session_id ? s.session_id !== entry.session_id : s !== entry
  ));
  await chrome.storage.local.set({ [SESSIONS_KEY]: remaining });
  // The row goes from the panel first. A server that is down, or a secret
  // that is wrong, must not leave the user staring at a button that does
  // nothing — and the row is the half they can see.
  await renderHistory();

  if (!entry.session_id) return;   // written before the panel knew ids
  try {
    const res = await fetch(`${serverBase()}/v1/sessions/${encodeURIComponent(entry.session_id)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('Deleted from the server');
  } catch {
    toast('Removed here, but the server did not answer — this one may still be on disk',
      'bad', 6000);
  }
}

async function deleteAllSessions() {
  // The same source the list rendered, so the count in the question is the
  // count on screen. Reading the local array instead would understate a list
  // the server is supplying rows for.
  const sessions = await historyEntries();
  const ok = await askConfirm(
    'Delete every conversation?',
    [`This deletes all ${sessions.length} conversation`
      + `${sessions.length === 1 ? '' : 's'} in the list and every file behind `
      + 'them on the server. There is no way back.'],
  );
  if (!ok) return;
  await chrome.storage.local.set({ [SESSIONS_KEY]: [] });
  await renderHistory();
  try {
    const res = await fetch(`${serverBase()}/v1/sessions`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('Everything deleted');
  } catch {
    toast('Cleared the list, but the server did not answer — files may still be on disk',
      'bad', 6000);
  }
}

document.getElementById('historyDeleteAll')
  .addEventListener('click', () => void deleteAllSessions());

// ── Replaying a session from history ──────────────────────────────────────
// A history row is a conversation, not a report, so clicking one puts that
// conversation back in the chat and leaves the composer live. What it used to
// do — open a read-only list of steps, prompts and token counts — answered a
// question the panel was never asked, and left no way to carry on.
//
// A row that cannot be read back must still be actionable, so the failure
// path falls back to putting the task back in the composer. Losing the ability
// to re-run something is a regression, not a degradation.

let replayRequest = 0;

function refillComposer(task) {
  goalEl.value = task || '';
  historyOverlay.classList.remove('open');
  historyList.hidden = false;
  goalEl.focus();
}

// A stable id for *this install*, so the server can key the user's blocklist
// and remembered model to something that survives a network change. The
// client IP was the only identity available and it is not one: a laptop that
// leaves Wi-Fi gets a new address, and a server in a container sees the docker
// gateway rather than the machine. Either way the user's approved sites
// silently reset.
// Deliberately not a uuid per session and not derived from anything
// identifying: it is a handle for "the same browser", nothing more. The
// blocklist it keys is the user's own file on their own disk.
async function deviceId() {
  const stored = await chrome.storage.local.get('deviceId');
  if (typeof stored.deviceId === 'string' && stored.deviceId) return stored.deviceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}

async function authHeaders() {
  const stored = await chrome.storage.local.get('settings');
  const secret = stored.settings && typeof stored.settings.agentSecret === 'string'
    ? stored.settings.agentSecret.trim()
    : '';
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

// Same base as the panel's other server calls (fetchSuggestions, settings
// verify): the settings field is the source of truth, and state.plannerUrl
// is empty until a task has connected at least once in this panel.
function serverBase() {
  return (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');
}

async function fetchAudit(sessionId) {
  const res = await fetch(`${serverBase()}/v1/sessions/${encodeURIComponent(sessionId)}/audit`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function replaySession(entry) {
  if (!entry.session_id) {
    // A row written before the panel ever saw a session id. Nothing to fetch,
    // so do exactly what the row always did.
    refillComposer(entry.task);
    return;
  }
  const request = ++replayRequest;
  let doc;
  try {
    doc = await fetchAudit(entry.session_id);
  } catch {
    toast('Could not load that session — putting the task back in the box', 'bad', 4000);
    refillComposer(entry.task);
    return;
  }
  // A superseded click must not paint over the one the user is waiting on.
  if (request !== replayRequest) return;
  if (!doc || doc.found === false) {
    toast('Session not found on the server — putting the task back in the box', 'bad', 4000);
    refillComposer(entry.task);
    return;
  }

  historyOverlay.classList.remove('open');
  historyList.hidden = false;
  // Emptied first so clearMessages does not re-create the idle placeholder: a
  // panel holding a replayed thread is not idle, and the placeholder is what
  // triggers a suggestions fetch against the current tab.
  messagesEl.replaceChildren();
  clearMessages({ keepTranscript: true });
  stopTimer();

  // The audit already holds every element the live transcript is built from,
  // so the replay rebuilds the conversation out of the same parts rather than
  // flattening it to text. Walking `messages[]` alone lost all of them: the
  // step bubbles lost their address rows, the questions the agent asked were
  // gone, and the final answer read as an ordinary reply.
  renderTranscript(doc);

  // No "this one: ERROR" line. The outcome cell already carries the word, the
  // transcript already carries the reason, and a third copy in the chat said
  // the same thing three lines below the error it was describing.

  // What makes the next message continue this conversation rather than start
  // a new one. Sent to the background with the follow-up; the server appends
  // to the same document, so the audit keeps one thread.
  state.sessionId = entry.session_id;
  state.taskCount = (doc.tasks?.length) || 1;
  // Set before setPhase, which is what lets the status bar appear at all: a
  // replay ends on `connected`, and `connected` is one of the phases that
  // hides the bar.
  state.replaying = true;
  renderReplayMetrics(doc);
  setPhase(state.plannerUrl ? 'connected' : 'idle', 'Ready');
  goalEl.focus();
}

// A replayed run's bar is a receipt, not an instrument: the numbers the run
// ended on, read straight off the document. Taken from `turns[]` rather than
// `totals` so a v1 document — which recorded turns only — reads the same.
function renderReplayMetrics(doc) {
  const turns = Array.isArray(doc.turns) ? doc.turns : [];
  state.stepCount = turns.length;
  updateStepCount();

  const wall = doc.totals?.wall_s;
  if (timerActiveEl && typeof wall === 'number' && wall > 0) {
    timerActiveEl.textContent = `${wall.toFixed(1)}s`;
    timerActiveEl.title = 'Time this run spent working.';
  }

  const pct = turns[turns.length - 1]?.model?.context_pct;
  if (typeof pct === 'number') {
    const value = document.getElementById('contextValue');
    if (value) value.textContent = `${+pct.toFixed(1)}%`;
  }

  setOutcome(doc.status, doc.result?.summary);
}

// Actions the harness treats as its own bookkeeping. The server filters them
// before it emits `step_progress`, so a turn built only from these produced no
// bubble when it ran — and must produce none when it is replayed, or the
// transcript gains steps the user never saw.
const INTERNAL_ACTIONS = new Set([
  // The two write actions are gone from the schema but stay here: audit
  // documents already on disk contain turns that used them, and replaying
  // one must not gain a bubble the user never saw live.
  'write_scratchpad', 'append_scratchpad', 'read_scratchpad', 'recall_memory',
]);

// The external action the live step bubble was built from: the first one, which
// is the same `external[0]` the harness picks before it sends the frame.
function leadAction(turn) {
  for (const a of turn.actions || []) {
    if (!INTERNAL_ACTIONS.has(a.action)) return a;
  }
  return null;
}

// Rebuilds the conversation in the order it happened. Document order is
// causal order — `tasks[]`, `turns[]` and each turn's `prompts[]`/`actions[]`
// are all append-only — so nothing here has to sort.
function renderTranscript(doc) {
  const messages = Array.isArray(doc.messages) ? doc.messages : [];
  const turns = Array.isArray(doc.turns) ? doc.turns : [];

  // A run that did not finish has no answer — it has a reason. The closing
  // message is drawn in the success bubble purely because it is last, so a
  // failed task rendered its own error text inside a green tick: the panel
  // saying the run worked while the words underneath said the opposite.
  const closingRole = (status) => (status && status !== 'completed' ? 'error' : 'done');

  // v1 documents recorded turns only, and for those the run's own goal is the
  // whole conversation, so that is what is shown.
  if (!messages.length) {
    if (doc.goal) appendMessage({ role: 'user', text: doc.goal });
    for (const turn of turns) {
      const lead = leadAction(turn);
      if (lead) appendStepForTurn(turn, lead);
    }
    if (doc.result?.summary) {
      state.lastGoal = doc.goal || '';
      const summary = doc.result.summary;
      if (closingRole(doc.status) === 'error') {
        appendMessage({ role: 'error', text: closingText(doc.result?.failure_reason, summary) });
      } else {
        appendMessage({ role: 'done', finalAnswer: summary });
      }
    }
    return;
  }

  const taskIndexes = Array.isArray(doc.tasks) && doc.tasks.length
    ? doc.tasks.map((_, i) => i)
    : [...new Set(messages.map((m) => (typeof m.task === 'number' ? m.task : 0)))];

  for (const taskIndex of taskIndexes) {
    const mine = messages.filter((m) => (typeof m.task === 'number' ? m.task : 0) === taskIndex);
    // Each task carries its own end. Only the last one falls back to the
    // document's status, which is the only status a v1-style document has —
    // reading it for every task would label an earlier finished task by how
    // the whole conversation happened to end.
    const taskStatus = doc.tasks?.[taskIndex]?.status
      || (taskIndex === taskIndexes[taskIndexes.length - 1] ? doc.status : null);

    for (const m of mine.filter((x) => x.role === 'user')) {
      state.lastGoal = m.content || '';
      appendMessage({ role: 'user', text: m.content || '' });
    }

    // A task's final answer is the last assistant message of that task —
    // `_close` writes `result.summary` as one, after the per-turn thoughts.
    // The exception is an aborted turn, which never reaches `_close` and so
    // ends on a thought; that is told apart by the text being the same one
    // its turn is already titled with.
    const assistants = mine.filter((x) => x.role === 'assistant');
    let finalAnswer = assistants.pop();
    if (finalAnswer && isTurnThought(finalAnswer, turns)) finalAnswer = null;

    for (const turn of turns.filter((t) => (typeof t.task === 'number' ? t.task : 0) === taskIndex)) {
      for (const p of turn.prompts || []) appendPromptCard(p);
      const lead = leadAction(turn);
      if (lead) {
        appendStepForTurn(turn, lead);
        continue;
      }
      // A scratchpad-only turn drew no bubble when it ran. Its thought is
      // still the only record of what the agent did that step.
      const thought = turn.model?.thought || turn.model?.reasoning || '';
      if (thought) appendMessage({ role: 'assistant', text: thought });
    }

    if (finalAnswer?.content) {
      if (closingRole(taskStatus) === 'error') {
        appendMessage({
          role: 'error',
          text: closingText(
            taskIndex === taskIndexes[taskIndexes.length - 1] ? doc.result?.failure_reason : null,
            finalAnswer.content,
          ),
        });
      } else {
        appendMessage({ role: 'done', finalAnswer: finalAnswer.content });
      }
    }
  }

  state.stepCount = turns.length;
  updateStepCount();
}

// True when a message is the per-turn thought rather than a task's closing
// summary. Both are written with a `turn`; only the content tells them apart,
// because a thought is the same string `turns[].model.thought` holds.
function isTurnThought(message, turns) {
  const turn = turns[message.turn];
  if (!turn?.model?.thought) return false;
  return (turn.model.thought || '') === (message.content || '');
}

function appendStepForTurn(turn, lead) {
  const text = (turn.model?.thought || turn.model?.reasoning || '').trim()
    || deriveReasoningFromAction(lead.action || '', lead.action);
  appendStep({
    icon: iconFor(lead.action || ''),
    text,
    pageUrl: turn.observation?.url || '',
    // Same rule the harness applies when it builds the frame: only a
    // navigation has a destination address worth drawing.
    actionTarget: lead.action === 'navigate' ? (lead.args?.url ?? null) : null,
  });
}

// The question the agent asked and what came back, as the same card the user
// answered live — already resolved, because in a replay there is nothing left
// to answer.
function appendPromptCard(p) {
  const args = p.args || {};
  if (p.kind === 'ask_human') {
    appendClarifyCard({
      id: p.id,
      question: p.reason || args.question || 'Brotto needs your guidance.',
      resolved: p.status === 'answered' ? (p.response ?? '') : 'skipped',
    });
    return;
  }
  if (p.kind === 'login_required') {
    appendLoginCard({
      domain: p.domain || 'this site',
      url: args.url || '',
      title: args.page_title || '',
      task: args.task || '',
      outcome: loginOutcome(p),
    });
    return;
  }
  appendApprovalCard({
    id: p.id,
    reason: p.reason || 'Brotto wanted approval for this action.',
    action: { type: p.action, url: args.url },
    resolved: p.decision || 'denied',
  });
}

function loginOutcome(p) {
  if (p.status !== 'answered') return 'Never answered — the task moved on.';
  const d = String(p.decision || '').toLowerCase();
  if (d === 'timeout') return 'Timed out — Brotto carried on and the task did not stop.';
  if (d === 'skipped') return 'Skipped — the task was given up on.';
  return 'Signed in, and the task carried on.';
}


// ── Settings: load + save (first chrome.storage.local writes — today the
// SW only reads `get("settings")`, so this is the seed for that key).
const blacklistSetting    = document.getElementById('blacklistSetting');
const saveSettingsBtn     = document.getElementById('saveSettingsBtn');
const refreshPolicyBtn    = document.getElementById('refreshPolicyBtn');
const notifyBlockingSetting = document.getElementById('notifyBlockingSetting');
const notifyResultsSetting  = document.getElementById('notifyResultsSetting');
const contextSuggestionsSetting = document.getElementById('contextSuggestionsSetting');
const contextBadge = document.getElementById('contextBadge');
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
  applyServerAddressState();
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
  // yesterday's blacklist while the SW ships today's.
  const stored = await chrome.storage.local.get('settings');
  const s = stored.settings || {};
  const base = (plannerUrlEl.value || 'http://localhost:8000').replace(/\/$/, '');

  // Reachability probe for the footer. Nothing the user edits comes from
  // here.
  let effective = null;
  try {
    const r = await fetch(`${base}/v1/policy?user_id=${encodeURIComponent(await deviceId())}`);
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

  // The blacklist comes from LOCAL storage — chrome.storage.local is what
  // the SW ships on the next task_start, so that is what the field has to
  // show. The server fetch above is a reachability probe, not a second
  // source of truth.
  const localBlacklist = Array.isArray(s.blacklist) ? s.blacklist : [];
  if (notifyBlockingSetting) notifyBlockingSetting.checked = s.notifyBlocking !== false;
  if (notifyResultsSetting) notifyResultsSetting.checked = s.notifyResults !== false;
  // Default OFF, so this cannot be `!== false` the way the two notification
  // settings are. Those ask "should I be quiet?", where absent means the
  // documented default; this one reads the page with no task in flight, and
  // absent must mean "do not". Getting that comparison backwards ships an
  // ambient page read to every install, and the privacy policy says it
  // doesn't happen unless asked for.
  if (contextSuggestionsSetting) contextSuggestionsSetting.checked = s.contextSuggestions === true;

  blacklistSetting.value = localBlacklist.join('\n');
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
      agentSecret: (agentSecretSetting ? agentSecretSetting.value.trim() : ''),
      blacklist,
      notifyBlocking: notifyBlockingSetting ? notifyBlockingSetting.checked : true,
      notifyResults: notifyResultsSetting ? notifyResultsSetting.checked : true,
      contextSuggestions: contextSuggestionsSetting ? contextSuggestionsSetting.checked : false,
    };
    await chrome.storage.local.set({ settings });
    plannerUrlEl.value = settings.serverUrl;
    // agentSecret is redacted: this line goes to a devtools console that
    // users paste into issue reports.
    console.log('[brotto] settings saved', { ...settings, agentSecret: settings.agentSecret ? '<set>' : '' });

    // 1. Push the in-memory mirror to the SW so the next task_start
    //    ships it. Bug 7: wait for the SW's success ack so we don't
    //    claim "Saved" before the SW actually updated userPolicy.
    let swOk = false;
    try {
      const ack = await chrome.runtime.sendMessage({
        type: 'policy_changed',
        settings: {
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
        body: JSON.stringify({ settings: { blacklist: settings.blacklist }, user_id: await deviceId() }),
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

    // A privacy setting that only takes effect on the next panel open is a
    // setting the user cannot trust. `contextSuggestionsEnabled` reads storage
    // at decision time, so a repaint is all it takes — but the debounce timer
    // may already be holding a read that was scheduled under the old value,
    // so it is cancelled rather than left to land.
    clearTimeout(suggestionTimer);
    if (!taskRunning) void currentTab().then(refreshEmptyState);
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
  // True only while a history session is on screen with no task behind it. It
  // is the one case where the status bar has something to say and no phase
  // that admits it, so setPhase consults it.
  replaying: false,
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

// ── Markdown ──────────────────────────────────────────────────────────────
// Renders the agent's output. Security model: escape every byte first, then
// emit only tags generated here. No model or page string reaches an attribute
// unescaped, and a link href must match https?:// explicitly — `javascript:`
// fails that test and is left as visible text.
//
// Two passes, and the order is the whole point. Blocks are parsed from the RAW
// lines, so a `#` inside a fence is a fence rather than a heading, and each
// block's text then goes through inline() on its own. The previous version ran
// the inline regexes over the joined HTML, which meant `**` inside a code span
// was bolded, an unclosed `**` ran past the end of its block, and a bare URL
// inside a generated tag was fair game. Real model output hit all three.

// Split on a backtick run, and keep the body verbatim: nothing inside a code
// span is emphasis, a link, or a URL. The placeholder is NUL-delimited:
// the only input is escaped text, and no printable delimiter would be
// safe to restore against without eating a real " 12 " in a price.
function renderInline(text) {
  const spans = [];
  let s = escapeHtml(String(text)).replace(/(`+)([^`]*?)\1/g, (_, _ticks, body) => {
    spans.push(`<code class="md-ci">${body}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  // Markdown links first, so the autolink below cannot reach the URL that is
  // already the href of the anchor we just made. An image collapses to its alt
  // text rather than leaving a stray leading `!`.
  s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, href) =>
    /^https?:\/\//i.test(href)
      ? `<a href="${href}" target="_blank" rel="noreferrer">${label || href}</a>`
      : whole);

  // Bare URLs the model wrote as plain text. The lookbehind is what keeps it
  // off the href and the label of the anchors above.
  s = s.replace(/(?<![">])(https?:\/\/[^\s<]+)/g, (whole) => {
    const trail = whole.match(/[.,;:!?)\]]+$/);
    const url = trail ? whole.slice(0, -trail[0].length) : whole;
    if (!url) return whole;
    const dot = trail ? trail[0] : '';
    return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${dot}`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => spans[Number(n)]);
}

// A `|` row followed by a `|---|:--:|` row is a table. Models use these for
// exactly the "findings" shape the panel is worst at showing as prose.
function isTableDivider(line) {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split('|').map((c) => c.trim());
}

function renderTable(lines, start) {
  const header = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map((c) =>
    /^:-+:$/.test(c) ? 'center' : (/-+:$/.test(c) ? 'right' : 'left'));
  let i = start + 2;
  let body = '';
  while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
    const cells = splitRow(lines[i]);
    body += '<tr>' + header.map((_, c) =>
      `<td class="md-td md-td-${align[c] || 'left'}">${renderInline(cells[c] || '')}</td>`).join('') + '</tr>';
    i++;
  }
  const head = '<tr>' + header.map((h, c) =>
    `<th class="md-th md-td-${align[c] || 'left'}">${renderInline(h)}</th>`).join('') + '</tr>';
  // The panel is 320px. A wide table scrolls sideways rather than being
  // squeezed into unreadable two-character columns.
  return [`<div class="md-table-wrap"><table class="md-table">${head}<tbody>${body}</tbody></table></div>`, i];
}

// One list level. `base` is the indent of the first marker, so a deeper run
// recurses and a shallower one returns to the caller.
function renderList(lines, start) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  const base = first[1].replace(/\t/g, '  ').length;
  const tag = /\d/.test(first[2]) ? 'ol' : 'ul';
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      if (!lines[i].trim()) break;
      // A plain line under a marker is a lazy continuation of that item.
      if (!items.length) break;
      items[items.length - 1].text += '\n' + lines[i].trim();
      i++;
      continue;
    }
    const indent = m[1].replace(/\t/g, '  ').length;
    if (indent < base) break;
    if (indent > base) {
      const [nested, next] = renderList(lines, i);
      if (items.length) items[items.length - 1].nested += nested;
      i = next;
      continue;
    }
    const task = m[3].match(/^\[([ xX])\]\s*(.*)$/);
    items.push(task
      ? { text: task[2], nested: '', task: task[1] !== ' ' }
      : { text: m[3], nested: '', task: null });
    i++;
  }

  const body = items.map((it) => {
    const box = it.task === null ? ''
      : `<span class="md-box${it.task ? ' on' : ''}"></span>`;
    return `<li${it.task === null ? '' : ' class="md-task"'}>${box}${renderInline(it.text)}${it.nested}</li>`;
  }).join('');
  return [`<${tag} class="md-list">${body}</${tag}>`, i];
}

function renderMarkdown(raw) {
  if (!raw) return '';
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code. Opened with ``` or ~~~, closed by a run of the same
    // character at least as long. The body is escaped and never parsed.
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if (fence) {
      const marker = fence[1][0];
      const close = new RegExp(`^\\s*${marker}{${fence[1].length},}\\s*$`);
      const body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // the closing fence
      out.push(
        '<div class="md-code">' +
        (fence[2] ? `<span class="md-code-lang">${escapeHtml(fence[2])}</span>` : '') +
        `<pre><code>${escapeHtml(body.join('\n'))}</code></pre></div>`,
      );
      continue;
    }

    if (!trimmed) { i++; continue; }

    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) { out.push(`<h${h[1].length} class="md-h">${renderInline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) { out.push('<hr>'); i++; continue; }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const [html, next] = renderTable(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) {
      const [html, next] = renderList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(quoted.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    // Paragraph: run to the next blank line. A single newline stays a line
    // break — that is what a model means by it, and the panel always did.
    const para = [];
    while (i < lines.length && lines[i].trim()
           && !/^(`{3,}|~{3,})/.test(lines[i].trim())
           && !/^#{1,6}\s+/.test(lines[i].trim())
           && !/^([-*+]|\d+[.)])\s+/.test(lines[i].trim())
           && !/^>\s?/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${renderInline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('');
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
  // A question is outstanding. Everything below this line means "start a
  // task", and starting one here would abandon the run that is blocked
  // waiting for the answer — so the box answers the question instead, and
  // the card it belongs to is what records the reply.
  if (state.pendingClarifyId !== null && state.pendingClarifyId !== undefined) {
    goalEl.value = '';
    goalEl.style.height = 'auto';
    setPhase('connected', 'Resuming…');
    const res = await answerPendingClarify(text);
    if (res && res.success === false) {
      // The run moved on while the user was typing. Put the words back
      // rather than dropping them, and let them send it as a task.
      goalEl.value = text;
      goalEl.style.height = 'auto';
      goalEl.focus();
      appendMessage({ role: 'error', text: res.error || 'That question is no longer waiting.' });
    }
    return;
  }
  // Mid-task steering. This has to come before everything below: the rest of
  // this function is "start a task" — it clears the transcript, resets the
  // tab tally and calls setPhase('connecting'), all of which would destroy
  // the running task the user is trying to redirect. A paused task is
  // excluded on purpose: an approval is outstanding then, and steering text
  // typed into the box while the agent waits for a yes or no would be
  // silently dropped. The disabled button is not the protection — Enter still
  // reaches this function with the button off.
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
  // Pre-flight: is there a model this browser can actually run on? It sits
  // here — after the steer and clarify branches, which never start a run and
  // so never need one, and before anything that latches a run into being. A
  // refusal therefore leaves nothing half-started: no transcript cleared, no
  // clock, no taskInFlight. The words stay in the box, because the fix is a
  // settings change and a user who has to retype a long task to apply it
  // stops trying.
  setPhase('connecting', 'Checking your model…');
  const check = await checkModelReady();
  if (!check.ok) {
    setPhase('error', MODEL_CHECK_TITLE[check.kind] || 'The model is not usable');
    appendFailureBubble({
      title: MODEL_CHECK_TITLE[check.kind] || 'The model is not usable',
      body: check.body,
      footer: 'Your task is still in the box.',
    });
    return;
  }
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
  // The bar reads WORKING from here, not from `task_started`. That event
  // arrives a round-trip later, and a send that shows a blank outcome cell
  // until then reads as "nothing is happening" — which is the one thing the
  // user is watching for at that moment.
  setOutcome('running');
  try {
    await ensureConnected();
  } catch (err) {
    const note = failureNote(isOffline(err) ? 'offline' : 'connect_failed', err);
    setPhase('error', note);
    setOutcome('failed', note, 'connect_failed');
    appendMessage({ role: 'error', text: note });
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
    // Which conversation to append to. Null on a first task; otherwise the id
    // of the session this panel is showing, including one picked back out of
    // history, which the background would otherwise not know about.
    session_id: continuing ? state.sessionId : null,
  });
  if (!response.success) {
    stopTimer();
    const note = /background|service worker/i.test(response.error || '')
      ? FAILURE_NOTE.service_worker
      : failureNote('internal', response.error);
    setPhase('error', note);
    setOutcome('failed', note, 'internal');
    appendMessage({ role: 'error', text: note });
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
  setOutcome(null);
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
  // forces Stop, which throws the transcript away.
  //
  // 'paused' is the one phase that re-enables, and only while a question is
  // outstanding: the composer is the answer box (see answerPendingClarify),
  // so locking it there would leave the run blocked on something the panel
  // would not let the user give it. An approval pause stays locked — that one
  // is answered by its own buttons.
  const answering = state.pendingClarifyId !== null && state.pendingClarifyId !== undefined;
  sendBtn.disabled = phase === 'connecting' || (running && phase !== 'executing' && !answering);
  setClarifyComposerMode(answering);
  // ponytail: surface a brief feedback message for the prose-only failure
  // so the user knows the loop stopped on purpose, not from a network
  // error. The actual message is rendered by the task_failed handler.
  if (phase === 'done' || phase === 'error') {
    // ponytail: every prompt the task was blocked on has to stop being
    // answerable, but it does not stop being part of the conversation —
    // settleBlockingCards takes the controls off and writes the outcome
    // in, so a card left on a finished task is a record rather than a
    // button that goes nowhere.
    settleBlockingCards('The task ended before you answered.');
  }
  // ponytail: the clock belongs to a run. Every terminal phase stops it,
  // not just done/error — a bar that kept counting after a failed or
  // cancelled task would be reporting time that isn't passing. Keyed on
  // TERMINAL_PHASES, not on `!running`: answering a clarifying question moves
  // paused → connected, and stopping on anything non-running killed the
  // interval that the line above had just restarted, so ACTIVE stayed frozen
  // at the answer for the rest of the run.
  if (TERMINAL_PHASES.has(phase)) { stopTimer(); state.taskInFlight = false; }
  // ponytail: the live "working" line must go the moment the agent stops
  // producing — which includes 'paused', because a pause is the agent asking
  // for approval, a login, or an answer, not the agent working. Without this
  // the spinner turns for the life of the panel, which reads as a hang.
  if (phase !== 'executing') dropWorkingMessage();
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
  // hide it, and New chat clears it via clearMessages.
  //
  // A reopened history session is the one case with no task behind it and
  // still a conversation to read, and it parks on `connected` — so it needs its
  // own condition. The bar belongs to whatever is on screen, not to whether it
  // is running: a replayed run shows the numbers it ended on, frozen.
  const showBar = phase !== 'idle' && phase !== 'connected' && phase !== 'disconnected' && phase !== 'connecting';
  if (statusBarEl) statusBarEl.classList.toggle('active', showBar || state.replaying);
  // ponytail: New chat shows whenever there is a conversation to leave *and*
  // nothing is running. A session id alone was enough, which left the one
  // button that ends a run sitting next to a live one — clicking it mid-task
  // reset the session out from under the agent. `connecting` counts: it is the
  // window between accepting a send and `task_started`, and a task is already
  // committed by then. A paused run still holds the button, because the only
  // way out of a pause is the card in the transcript or Stop. The one pause
  // that releases it is a stop in flight, where the outcome cell already reads
  // STOPPED BY YOU — and a stop mid-pause may never draw a terminal event, so
  // holding on to `paused` there would strand the user in a run they killed.
  const runInFlight = phase === 'connecting' || phase === 'executing' || (phase === 'paused' && !stopping);
  const showNewTask = state.sessionId !== null && !runInFlight;
  if (newTaskBtn) newTaskBtn.classList.toggle('visible', showNewTask);
  // The outcome cell tracks the run the same way every other part of the bar
  // does, so it reads phase here rather than at the six places that produce
  // it. Only the two live phases are touched — a terminal phase must not
  // clobber the verdict the terminal event already wrote.
  //
  // `stopping` matters because a stop *is* a pause: stopTask sets the phase to
  // 'paused' so the composer and buttons behave, and without the guard the
  // line below stamped WAITING FOR YOU over the STOPPED BY YOU that stopTask
  // had just written — a run the user had killed, announcing it was waiting
  // on them.
  if (phase === 'paused' && !stopping) setOutcome('awaiting_human');
  else if (phase === 'executing' && outcomeCell?.dataset.state === 'waiting') setOutcome('running');
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

// ── Outcome cell ───────────────────────────────────────────────────────────
// One word saying how a run ended, and nothing else. Every other cell in the
// bar is a quantity, so this is the only place the panel reports a judgement —
// and it is the one you want first, because a run that died at step 2 and a
// run that died at step 40 look identical without it.
//
// ERROR is the base for anything that went wrong, but the status alone cannot
// carry it: the server reports `failed` for a run the *user* stopped, a login
// they skipped, and a loop that ran past the backstop as readily as for a dead
// socket. One word for all four would call two of them a fault, so the reason
// refines the word and status only decides the default.
const OUTCOME_WORD = {
  completed: ['done', 'DONE'],
  failed: ['error', 'ERROR'],
  cancelled: ['stopped', 'STOPPED BY YOU'],
  interrupted: ['ended', 'ENDED BY ITSELF'],
  awaiting_human: ['waiting', 'WAITING FOR YOU'],
  running: ['working', 'WORKING'],
  // Recorded but never written any more. `stagnated` is a pre-removal status
  // from the detector the harness deleted, so it lands in runs already on disk;
  // `corrupt` and `unknown` are what a document the panel cannot read reports.
  // Both are real ends, not missing data, so they get a word.
  stagnated: ['error', 'ERROR'],
  corrupt: ['ended', 'ENDED BY ITSELF'],
  unknown: ['ended', 'ENDED BY ITSELF'],
};

// The endings that are not faults, so they must not read as one. Data state
// tracks the word, not the blame: a skipped login is still a run that produced
// nothing, so it keeps the hollow mark.
const OUTCOME_BY_REASON = {
  user_denied: ['stopped', 'STOPPED BY YOU'],
  user_skipped_login: ['stopped', 'STOPPED BY YOU'],
  runaway_backstop: ['gave-up', 'TOO LONG'],
  task_refused: ['error', 'COULD NOT RESUME'],
  policy_blocked: ['blocked', 'BLOCKED'],
  policy_preflight: ['blocked', 'BLOCKED'],
};

function outcomeEntry(status, reason) {
  return (status === 'failed' && OUTCOME_BY_REASON[reason]) || OUTCOME_WORD[status];
}

function setOutcome(status, summary, reason) {
  const value = document.getElementById('outcomeValue');
  if (!outcomeCell || !value) return;
  const entry = outcomeEntry(status, reason);
  if (!entry) {
    outcomeCell.removeAttribute('data-state');
    outcomeCell.removeAttribute('title');
    value.textContent = '—';
    return;
  }
  outcomeCell.dataset.state = entry[0];
  value.textContent = entry[1];
  outcomeCell.title = summary || '';
}

// A run's closing words, whether they arrive live or are read back off disk.
// Same two parts in both places: the sentence naming which family it was, then
// the harness's own detail. A replay that re-derived this would drift from the
// live panel the first time either half was reworded — and the two sit in the
// same transcript, so a user scrolling up would read Brotto contradicting
// itself.
function closingText(reason, summary) {
  const detail = (summary || '').trim();
  if (!detail) return failureNote(reason, null);
  const note = failureNote(reason, detail);
  return detail.startsWith(note) ? detail : `${note}\n\n${detail}`;
}

// ── What went wrong, in the user's terms ───────────────────────────────────
// The server's failure_reason is a code for the log. Nothing the user does with
// a code is read it, so every one of them is translated here into a sentence
// and a next step. The harness's own `summary` still carries the detail — this
// is the part that says which of the three families it was, because "network
// drop / model / Brotto's server" is exactly the question a user cannot answer
// from a transcript and does not know they are asking.
const FAILURE_NOTE = {
  // ── Could not reach Brotto ──
  offline: "Brotto could not reach its server. Check that it's running, then send the task again.",
  connect_failed: "Brotto could not reach its server. Check that it's running, then send the task again.",
  disconnected: "The connection to Brotto dropped mid-task. Sending it again picks up where this left off.",
  service_worker: 'Brotto\'s background stopped responding. Reload the extension and try again.',

  // ── The model, or the key for it ──
  auth_failed: "Your model key was rejected. Open Settings and check the key.",
  model_not_found: "That model isn't available on your key. Pick a different one in Settings.",
  invalid_decision: 'The model could not produce a usable next step. Try rephrasing the task, or switch models in Settings.',
  model_http: 'The model provider rejected the request. Try again in a moment, or switch models in Settings.',

  // ── Brotto's own server ──
  internal: "Brotto's server hit an error. The details are in its log.",
  // `task_error` carries the raw exception, which this run shows in the
  // bubble footer — so it can't claim the details are only in the log.
  server_error: "Brotto's server hit an error and stopped the run. The details are below.",
  cdp_preflight_failed: 'Brotto could not attach to the browser tab. Close DevTools on that page and try again.',
  policy_preflight: 'Brotto refused the task: the site is on your blocked list.',
  policy_blocked: 'Brotto stopped: the task was blocked by your security policy.',

  // ── The run, not the software ──
  runaway_backstop: 'Brotto stopped after 150 steps without finishing. Try a smaller task.',
  task_refused: "Brotto could not continue that conversation. Start a new chat to try again.",
  duplicate_task_start: 'A task is already running on this conversation.',
  user_denied: 'You declined the action, so Brotto stopped.',
  user_skipped_login: 'You skipped the sign-in, so Brotto stopped.',
};

// A fetch to a server that is not there rejects with the same TypeError on
// every browser, and the raw message ("Failed to fetch") tells the user
// nothing. One family, one sentence — the transport cannot distinguish "the
// server is down" from "you are offline", so the copy must not pretend to.
function isOffline(err) {
  return err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err && err.message));
}

function failureNote(reason, detail) {
  const note = FAILURE_NOTE[reason];
  if (note) return note;
  if (isOffline(detail)) return FAILURE_NOTE.offline;
  return 'Something went wrong. The details are in Brotto\'s log.';
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
  // than guessed. The input area grows when "+ New chat" appears, and a
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
  // The outcome turns here rather than waiting for the terminal event, because
  // it answers "who ended this" and the answer is already true — the click is
  // the fact, and the server finishing the current step tidily afterwards
  // changes nothing about it. Waiting left the cell on WORKING until a
  // `canonical_status: cancelled` that a stop mid-pause never sends, so a run
  // the user had plainly killed sat claiming to still be working.
  setOutcome('cancelled');
  // ponytail: surface immediate "Stopped" feedback so the user sees their
  // click took effect. The background's cancel emits a terminal event
  // synchronously now, so the side panel exits 'Working' within ~1 tick.
  appendMessage({ role: 'system', text: 'Stopping after this step.' });
  // ponytail: Stop only moved the phase; an approval / clarify card stayed on
  // screen and clickable, so the user could still approve a purchase on a task
  // they had just cancelled. Same cleanup setPhase does on a terminal phase.
  settleBlockingCards('You stopped the task before answering.');
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
  setOutcome(null);
  // A replayed session re-arms this immediately after, in replaySession.
  state.replaying = false;
  // ponytail: clean up any lingering login-pause fallback buttons from a
  // previous task — a leftover Continue button is confusing once the user
  // is starting fresh.
  if (typeof document !== "undefined") {
    document.querySelectorAll(".login-continue-btn").forEach((el) => el.remove());
  }
  // ponytail: reset to initial empty-state by re-creating the placeholder so
  // the panel doesn't look empty. Skipped when a transcript is being kept —
  // the placeholder is the idle-panel's invitation to type a task, and
  // dropping one into the middle of a replayed conversation both read wrong
  // and fired a suggestions fetch for a panel that is not idle.
  if (!keepTranscript && !document.getElementById("emptyState")) {
    messagesEl.appendChild(createEmptyState());
    void currentTab().then(refreshEmptyState);
  }
}

function appendEmptyState() {
  messagesEl.appendChild(createEmptyState());
  void currentTab().then(refreshEmptyState);
}

// ponytail: the sign-in wall's outcome, written into the card rather than
// the card being deleted. Every caller means the same thing — the agent got
// past the wall — so the default is the sentence; the terminal paths pass
// their own because the run ended instead of carrying on.
//
// It used to fade the bubble out over 180ms and remove it. There is no
// removal left to soften, so the fade and the .removing keyframe went with it.
function clearLoginPrompt(outcome = 'Signed in, and the task carried on.') {
  const card = messagesEl.querySelector('.login-required-msg:not(.resolved)');
  if (!card) return;
  resolveCard(card, 'login-required-outcome', outcome);
}

// ponytail: every prompt a task can be blocked on, when the run ends before
// the user answered any of them. Terminal events and Stop both land here.
//
// These cards used to be deleted, which was right about approvals and wrong
// about everything else: an approval that outlives its task can still be
// clicked, but a question Brotto asked is part of what happened, and
// removing it left a hole in the transcript. Worse on a reopened session —
// the replay draws from the audit, so the question came back with the
// panel's deletion not in it, and the conversation read as if Brotto had
// asked into the void. An unanswered prompt is itself the record.
function settleBlockingCards(outcome) {
  for (const card of messagesEl.querySelectorAll('.clarify-card.blocking')) {
    resolveCard(card, 'clarify-answer', outcome);
  }
  for (const card of messagesEl.querySelectorAll('.approval-card.blocking')) {
    resolveCard(card, 'approval-decision', outcome);
  }
  clearLoginPrompt(outcome);
  state.pendingClarifyId = null;
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
const PAGE_TEXT_CHARS = 2000;

// Never read, on an idle panel, from a page whose whole purpose is holding
// something the user would not paste into a chat window. This is a hardcoded
// list on purpose: a user-configured blocklist cannot be the control here,
// because the failure mode is "we shipped ambient reading and a bank login
// was in the way of opting out". It is additive to the toggle, not a
// replacement — turning page suggestions on still does not unlock these.
//
// Matched on the registrable host, so a subdomain cannot slip past by being
// spelled differently. `accounts.` is covered by `google.com` itself.
const CONTEXT_BLOCKED_HOSTS = [
  // Banking and payments
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com',
  'americanexpress.com', 'discover.com', 'usbank.com', 'pnc.com', 'usaa.com',
  'schwab.com', 'fidelity.com', 'vanguard.com', 'td.com', 'ally.com',
  'barclays.co.uk', 'hsbc.co.uk', 'lloydsbank.com', 'natwest.com', 'monzo.com',
  'revolut.com', 'wise.com', 'paypal.com', 'stripe.com', 'squareup.com',
  'cash.app', 'venmo.com', 'zelle', 'plaid.com',
  // Password managers and auth — the vault contents are the whole page
  '1password.com', 'bitwarden.com', 'dashlane.com', 'lastpass.com',
  'keepersecurity.com', 'proton.me', 'accounts.google.com', 'login.microsoftonline.com',
  'appleid.apple.com', 'id.apple.com', 'github.com/login', 'okta.com', 'auth0.com',
];

// A path is blocked too where the page is a known-sensitive view on a host
// that is otherwise ordinary. Matched as a prefix on the pathname.
const CONTEXT_BLOCKED_PATHS = [
  '/checkout', '/cart', '/payment', '/wallet', '/transfer', '/billpay',
];

// ponytail: a substring test would catch "paypal.evil.com" and miss
// "paypal.com.br". Comparing the registrable-ish host means the list reads
// the way a person would write it and cannot be evaded by a lookalike.
function hostIsContextBlocked(url) {
  let host;
  let path;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return true; // unparseable is not a page we have any business reading
  }
  if (!host) return true; // about:blank, chrome://, file://
  const bare = host.replace(/^www\./, '');
  if (CONTEXT_BLOCKED_HOSTS.includes(bare)) return true;
  if (CONTEXT_BLOCKED_HOSTS.includes(host)) return true;
  return CONTEXT_BLOCKED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

// ponytail: this runs inside the page, so it has to be self-contained —
// Chrome serialises the source and the module scope does not exist in that
// realm. Keeping the decision and the read in ONE injection is the point: two
// round trips leave a window where the page changes between the check and the
// read, and a lookalike domain is precisely the case the check exists for.
function pageContextProbe(limit) {
  const SENSITIVE_AUTOCOMPLETE = [
    'cc-name', 'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
    'current-password', 'new-password', 'one-time-code', 'otp',
  ];
  // Token match, not substring: a substring test for "auth" also matches
  // "author", which is a field on half the pages that would otherwise pass.
  const SENSITIVE_TOKENS = new Set([
    'pass', 'passwd', 'pwd', 'password', 'passwords', 'secret', 'token',
    'apikey', 'auth', 'authorization', 'credential', 'credentials', 'bearer',
    'cvv', 'cvc', 'cvc2', 'cardnumber', 'ssn', 'pin', 'otp',
  ]);
  // Long enough to be unambiguous, so a substring test is safe for these.
  const SENSITIVE_SUBSTRINGS = [
    'password', 'passwd', 'secret', 'credential', 'api_key', 'apikey',
    'authorization', 'private_key', 'cvv', 'cardnumber', 'socialsecurity',
  ];
  const SENSITIVE_PATH =
    /\/(login|log-in|signin|sign-in|sign-in|signup|sign-up|auth|authenticate|sso|oauth|oauth2|callback|2fa|mfa|otp|verify|verification|checkout|payment|payments|billing|invoice|wallet|transfer|remit|cards?|account\/settings|security\/settings|privacy\/settings)/;

  const block = (reason) => ({ sensitive: true, reason, text: '' });
  let path = '';
  try { path = (location.pathname + location.search).toLowerCase(); }
  catch { return block('no-location'); }
  if (SENSITIVE_PATH.test(path)) return block('sensitive-path');

  let fields;
  try { fields = document.querySelectorAll('input, textarea, select'); }
  catch { return block('no-dom'); }

  for (const el of fields) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'password') return block('password-field');
    if (type === 'hidden') continue;

    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac && SENSITIVE_AUTOCOMPLETE.some((t) => ac.includes(t))) return block('autocomplete');

    const name = [
      el.getAttribute('name'), el.getAttribute('id'),
      el.getAttribute('aria-label'), el.getAttribute('placeholder'),
    ].filter(Boolean).join(' ').toLowerCase();
    if (!name) continue;
    for (const tok of name.split(/[^a-z0-9]+/)) {
      if (SENSITIVE_TOKENS.has(tok)) return block('sensitive-field');
    }
    if (SENSITIVE_SUBSTRINGS.some((s) => name.includes(s))) return block('sensitive-field');
  }

  const text = (document.body && document.body.innerText) || '';
  // A bare run of digits is an order number as often as a card. One sitting
  // next to the words "card" or "expiry" is a checkout page, and a checkout
  // page is the one place an idle read has no business being.
  if (/(?:card number|expiry|security code|debit|credit|iban|routing number|sort code)/i.test(text)
      && /(?:\d[ -]?){13,19}/.test(text)) {
    return block('card-shaped');
  }
  return { sensitive: false, reason: '', text: text.slice(0, limit) };
}

// Read on demand, and only while the panel is open. A permanently injected
// content script would put Brotto into every site the user visits, and the
// debugger would raise Chrome's "debugging this browser" banner — a heavy
// thing to show someone who opened a panel to read a list. chrome:// pages
// and a few others refuse the script outright, and that is reported as
// absence rather than guessed around.
//
// Two gates, and the cheap one runs first. The host list needs no injection
// and settles the known names; the in-page probe settles the ones nobody
// listed, which is the case that actually arrives. The caller decides whether
// to call at all: this reads a page with no task in flight, so it runs only
// when the user has opted in and the badge says so for as long as it takes.
async function readPageContext(tabId, tabUrl) {
  if (typeof tabId !== 'number') return '';
  if (hostIsContextBlocked(tabUrl)) return '';
  showContextBadge(true);
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageContextProbe,
      args: [PAGE_TEXT_CHARS],
    });
    const out = res?.result;
    // Logged, not shown: "Brotto never suggests anything on <site>" is
    // otherwise indistinguishable from the server being down, and this is the
    // one line that tells them apart.
    if (out?.sensitive) console.debug('[brotto] page context withheld:', out.reason, tabUrl);
    return (out?.text || '').trim();
  } catch {
    return '';
  } finally {
    showContextBadge(false);
  }
}

// The disclosure itself. PRIVACY.md promises the user can see it happen, and
// a setting you cannot watch taking effect is not a disclosure — so the badge
// is on for the whole duration of the read and not just the moment of it.
function showContextBadge(on) {
  if (!contextBadge) return;
  contextBadge.hidden = !on;
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

async function writeSuggestionCache(key, lines, ttl, fromContext = false) {
  const cache = await readSuggestionCache();
  cache[key] = { at: Date.now(), ttl, lines, context: fromContext };
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
    // A cache entry built from page text is skipped once the user turns page
    // suggestions off. Nothing new is read, but replaying a line set the model
    // derived from their page after they opted out is the behaviour the opt-in
    // is meant to prevent, and it survives a restart, which is long enough to
    // be the only symptom a user notices.
    const contextAllowed = await contextSuggestionsEnabled();
    if (hit && hit.context && !contextAllowed) return null;
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
      data.context_used === true,
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
    // The gate, in the one place that decides whether a page is read with no
    // task in flight. Off means the page is never opened, the model is asked
    // from the URL and title alone, and a fresh install reads nothing at all.
    // A task-driven read goes through the debugger relay instead and is not
    // gated here — the user asked for that one.
    const pageText = contextSuggestionsEnabled()
      ? await readPageContext(tab.id, url)
      : '';
    const lines = await fetchSuggestions(url, tab?.title || '', pageText);
    if (lines) paintSuggestions(lines);
  }, SUGGESTION_DEBOUNCE_MS);
}

// Read from local storage at the moment of the decision rather than from a
// variable captured at hydration: the toggle can be flipped without a reload,
// and a stale in-memory copy here is exactly the bug where the page gets read
// after the user turned it off.
async function contextSuggestionsEnabled() {
  try {
    const s = await chrome.storage.local.get('settings');
    const st = s?.settings || {};
    return st.contextSuggestions === true;
  } catch {
    return false;
  }
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
    bubble.className = 'bubble md';
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
      faText.className = 'final-answer-text md';
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
    bodyEl.className = 'failure-body md';
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
  // textContent, not innerHTML: `title` and `step.text` are the model's own
  // words, and the model's words are steerable by whatever text is on the page
  // it is reading. Escaping is not enough to be tidy here — it is the only
  // thing standing between a page and this panel's DOM.
  const badge = document.createElement('span');
  badge.className = 'plan-badge';
  badge.textContent = title || "Brotto's plan";
  header.appendChild(badge);
  card.appendChild(header);

  if (sites && sites.length > 0) {
    const sitesDiv = document.createElement('div');
    sitesDiv.className = 'plan-sites';
    sitesDiv.appendChild(document.createTextNode('Allow actions on: '));
    const allowed = document.createElement('strong');
    allowed.textContent = sites.join(', ');
    sitesDiv.appendChild(allowed);
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
      const num = document.createElement('span');
      num.className = 'plan-step-num';
      num.textContent = `${step.index}.`;
      const text = document.createElement('span');
      text.className = 'md';
      text.innerHTML = renderMarkdown(step.text || '');
      li.append(num, text);
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
  stepTextEl.className = 'md';
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

function appendApprovalCard({ id, reason, action, resolved }) {
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
  if (!resolved && NON_APPROVABLE_ACTIONS.has(action?.type)) {
    console.warn('[brotto] suppressed approval card for non-approvable action:', action?.type);
    // Still need to ACK so the server's queue doesn't hang. Send deny
    // so the harness aborts cleanly if it was awaiting this reply.
    if (id) void sendMessage({ type: 'submit_approval', id, approved: false });
    return;
  }

  const card = document.createElement('div');
  // .blocking breathes the left rule — the card is waiting on the user.
  // A resolved card stops waiting, so it never carries the class.
  card.className = resolved ? 'approval-card resolved' : 'approval-card blocking';
  // Stamped so `approval_resolved` can retire exactly this card when the
  // prompt is answered from the OS notification instead of from here.
  if (id) card.dataset.approvalId = String(id);

  const header = document.createElement('div');
  header.className = 'approval-header';
  const badge = document.createElement('span');
  badge.className = 'approval-badge';
  badge.textContent = resolved ? 'Approval' : 'Approval needed';
  header.appendChild(badge);
  card.appendChild(header);

  if (reason) {
    const body = document.createElement('div');
    body.className = 'approval-body';
    body.textContent = reason;
    card.appendChild(body);
  }

  // The destination, never the action's internal name. It read
  // `_policy_navigation → https://github.com`, which is the harness's label for
  // a step, not something the user asked about or can act on. The reason line
  // above already says what the agent wants, so the name repeated it at best;
  // with no url there is nothing left worth a line.
  if (action?.url) {
    const preview = document.createElement('div');
    preview.className = 'approval-preview';
    preview.textContent = action.url;
    preview.title = action.url;
    card.appendChild(preview);
  }

  if (resolved) {
    resolveCard(card, 'approval-decision', decisionLabel(resolved));
    messagesEl.appendChild(card);
    return;
  }

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
    resolveCard(card, 'approval-decision', 'Denied');
  });
  actions.appendChild(denyBtn);

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn-primary btn-sm';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', async () => {
    approveBtn.disabled = true;
    const res = await sendMessage({ type: 'submit_approval', id, approved: true });
    if (!res.success) return reArmApproval(card, denyBtn, approveBtn, res.error);
    resolveCard(card, 'approval-decision', 'Approved');
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

// A question that the user answered used to vanish, leaving their reply
// sitting in the transcript with nothing it was a reply to. The card is the
// record of what was asked; what changes on answering is that it is no longer
// waiting. So the controls go and the answer takes their place, and the card
// stays in the conversation where a reader can see the exchange as a whole.
function resolveCard(card, outcomeClass, text) {
  card.classList.remove('blocking');
  card.classList.add('resolved');
  for (const sel of ['.clarify-input-row', '.input-hint', '.clarify-actions', '.approval-actions', '.login-continue-btn']) {
    for (const el of card.querySelectorAll(sel)) el.remove();
  }
  let outcome = card.querySelector(`.${outcomeClass}`);
  if (!outcome) {
    outcome = document.createElement('div');
    outcome.className = outcomeClass;
    card.appendChild(outcome);
  }
  outcome.textContent = text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function decisionLabel(decision) {
  const d = String(decision || '').toLowerCase();
  if (d.startsWith('den')) return 'Denied';
  if (d === 'timeout') return 'Timed out — the task carried on without it';
  if (d === 'skipped') return 'Skipped';
  return 'Approved';
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
function appendClarifyCard({ id, question, reason, resolved }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  // Remove any prior *pending* clarify card so we don't end up with stacked
  // inputs. A resolved one stays: it is the record of a question the user
  // already answered, and it is what their answer in the transcript reads
  // against.
  const prior = messagesEl.querySelector('.clarify-card.blocking');
  // Settle rather than remove: a second question supersedes the first, but
  // the first was still asked. Deleting it left the replayed transcript
  // showing a question with nothing after it.
  if (prior) resolveCard(prior, 'clarify-answer', 'Brotto moved on without an answer.');

  const card = document.createElement('div');
  card.className = resolved ? 'clarify-card resolved' : 'clarify-card blocking';
  if (id) card.dataset.clarifyId = String(id);

  const header = document.createElement('div');
  header.className = 'clarify-header';
  const badge = document.createElement('span');
  badge.className = 'clarify-badge';
  badge.textContent = 'Your input';
  header.appendChild(badge);
  card.appendChild(header);

  if (question) {
    const body = document.createElement('div');
    body.className = 'clarify-body md';
    body.innerHTML = renderMarkdown(question);
    card.appendChild(body);
  }

  if (resolved) {
    resolveCard(card, 'clarify-answer', answerLabel(resolved));
    messagesEl.appendChild(card);
    return;
  }

  // No input inside the card. There is already one text box in the panel and
  // two is a worse answer than one: the card's copy was seeded at an arbitrary
  // focus, and a reply typed there looked like it had been sent when the
  // composer next read as empty. The question goes in the transcript, the
  // answer goes in the box the user is already looking at.
  const pointer = document.createElement('div');
  pointer.className = 'input-hint clarify-hint';
  pointer.textContent = 'Answer in the box below.';
  card.appendChild(pointer);

  const actions = document.createElement('div');
  actions.className = 'clarify-actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-sm';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    void answerPendingClarify('');
    setPhase(state.plannerUrl ? 'connected' : 'idle', state.plannerUrl ? 'Resuming…' : 'Idle');
  });
  actions.appendChild(skipBtn);

  card.appendChild(actions);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  state.pendingClarifyId = id;
}

// The one way an outstanding question gets answered, whether it came from the
// composer's send button or the card's Skip. Both callers used to resolve the
// card and post the reply themselves, which is how they drifted: Skip said
// "Skipped" in the transcript while the audit recorded an empty response.
function answerPendingClarify(answer) {
  const id = state.pendingClarifyId;
  if (id === null || id === undefined) return Promise.resolve(false);
  const card = messagesEl.querySelector('.clarify-card.blocking');
  if (card) {
    resolveCard(card, 'clarify-answer', answer ? answerLabel(answer) : 'Skipped');
  }
  state.pendingClarifyId = null;
  setClarifyComposerMode(false);
  return sendMessage({ type: 'submit_clarification', id, answer });
}

// The composer doubles as the answer box while a question is outstanding.
// The placeholder and the send label are the only things that change — the
// textarea, the Enter binding and the send button are the same controls the
// user has been typing a task into all along.
function setClarifyComposerMode(on) {
  if (!goalEl) return;
  goalEl.placeholder = on
    ? 'Answer Brotto…'
    : 'What would you like Brotto to do?';
  sendBtn.title = on ? 'Send answer' : 'Send';
}

// The answer is the user's own words, so it goes in as text — the same
// reasoning `appendPlanCard` uses for the model's strings.
function answerLabel(answer) {
  const a = String(answer ?? '').trim();
  return a ? `You: ${a}` : 'No answer — Brotto carried on with what it had';
}

// ── Login required ────────────────────────────────────────────────────────
// A function rather than inline markup because the history replay draws the
// same card, resolved, out of the audit's `login_required` prompt.
function appendLoginCard({ domain, url, title, task, outcome }) {
  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  // `.resolved` is what keeps this out of clearLoginPrompt's sweep: a
  // replayed sign-in wall is part of the record, and a live prompt arriving
  // later must not fade out the history behind it.
  msg.className = outcome
    ? 'message assistant login-required-msg resolved'
    : 'message assistant login-required-msg';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const badge = document.createElement('div');
  badge.className = 'login-required-badge';
  badge.textContent = outcome ? `Sign-in needed · ${domain}` : `Waiting for sign-in · ${domain}`;

  // What Brotto was trying to do, and where. A bare "please log in" is a
  // wall with no subject: the user cannot tell a sign-in for the task they
  // asked for from one the agent wandered into, and the audit kept neither.
  // Both are textContent — the task string and the page title are the model's
  // and the site's words respectively, steerable by page content.
  if (task) {
    const subject = document.createElement('div');
    subject.className = 'login-required-task';
    subject.textContent = task;
    bubble.appendChild(subject);
  }
  if (title) {
    const where = document.createElement('div');
    where.className = 'login-required-body';
    where.textContent = title;
    bubble.appendChild(where);
  }
  if (url) {
    const link = document.createElement('a');
    link.className = 'login-required-url';
    // Same guard renderMarkdown applies: a link whose href is anything other
    // than http(s) is text, not a navigation. The current URL is whatever the
    // page last set, and `javascript:` there is a live payload.
    if (/^https?:\/\//i.test(url)) {
      link.href = url;
      link.textContent = url;
    } else {
      link.textContent = url;
    }
    bubble.appendChild(link);
  }

  const body = document.createElement('div');
  body.className = outcome ? 'login-required-outcome' : 'login-required-body';
  body.textContent = outcome
    || 'Sign in manually in the browser tab. The task resumes automatically once the post-login page loads. Use Continue only if auto-resume does not fire.';
  bubble.appendChild(body);
  msg.appendChild(bubble);
  messagesEl.appendChild(msg);

  if (outcome) return;

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

// ── Live working message ──────────────────────────────────────────────────
// One transient bubble, swapped in place, removed the moment the real step
// lands. It is never part of the transcript: a permanent "Reading the page"
// line above the step that says the same thing better is clutter.
let currentAssistantMsg = null;

// ponytail: the panel owns this wording, not the server. The server sends a
// phase key; English is presentation and this is the only thing that renders
// it, so a line edit never needs a server deploy.
//
// Random, with one rule: never the same line twice running. Plain random
// repeats a line about one time in ten, and two identical lines in a row is
// the one thing that reads as a stuck animation — which is the exact problem
// the varied wording exists to fix. Everything else is free rein, so the set
// is wide and the phrasing is allowed to be a bit chatty.
//
// The lines still have to describe the phase that is actually running. A
// narration the user cannot check against reality is worse than a bare
// spinner, however good it reads.
const WORKING_LINES = {
  observe: [
    'Reading the page',
    'Looking at what is on screen',
    'Checking the page',
    'Taking in what is there',
    'Reading what is on the page',
    'Getting the lay of the land',
    'Sizing up the screen',
    'Scanning what is here',
    'Looking around',
    'Reading the room',
  ],
  plan: [
    'Deciding what to do next',
    'Working out the next step',
    'Thinking it through',
    'Figuring out the next move',
    'Working out what comes next',
    'Considering the options',
    'Picking a direction',
    'Thinking about what to do',
    'Weighing it up',
    'Deciding on an approach',
  ],
};
const workingLast = { observe: null, plan: null };
let workingSwapAt = 0;
let workingSwapTimer = null;

function workingLine(kind) {
  const list = WORKING_LINES[kind];
  if (!list) return null;
  let line = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && line === workingLast[kind]) {
    line = list[(list.indexOf(line) + 1) % list.length];
  }
  workingLast[kind] = line;
  return line;
}

// ponytail: variety as data, not mechanism. A spinner is a frame list and a
// ticker, so a new look is a new entry rather than new code.
//
// The shared rule, so a sixth one is easy to add in the right style: a
// monochrome block-drawing glyph, mono, no curves anywhere (the sheet sets
// border-radius: 0 globally, so a circle is the one shape this panel has no
// vocabulary for), 4–10 frames, and its own cadence so two spinners never
// tick in lockstep. Same shape and same speed across the set would be five
// spinners that read as one.
//
//   frames — the glyphs, in order
//   ms     — its own interval
//   back   — true ping-pongs at the ends instead of wrapping, so the motion
//            reverses rather than snapping from last back to first
const SPINNER_FRAMES = {
  dots: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    ms: 90,
  },
  quadrant: {
    frames: ['▖', '▘', '▝', '▗'],
    ms: 200,
  },
  cells: {
    frames: ['▛', '▜', '▙', '▟'],
    ms: 150,
    back: true,
  },
  bar: {
    frames: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'],
    ms: 110,
    back: true,
  },
  arrow: {
    frames: ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'],
    ms: 130,
  },
};
const SPINNER_KEYS = Object.keys(SPINNER_FRAMES);
let spinTimer = null;
let spinSet = null;
let spinIndex = 0;
let spinDir = 1;

// Honours prefers-reduced-motion in JS, which the stylesheet's reduced-motion
// block cannot: this is a ticker, not a CSS animation. A still glyph in the
// same place carries the same information with none of the movement.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function startSpinner(el) {
  stopSpinner();
  spinSet = SPINNER_FRAMES[SPINNER_KEYS[Math.floor(Math.random() * SPINNER_KEYS.length)]];
  spinIndex = 0;
  spinDir = 1;
  el.textContent = spinSet.frames[0];
  if (reduceMotion.matches) return;
  spinTimer = setInterval(() => {
    if (spinSet.back) {
      if (spinIndex + spinDir >= spinSet.frames.length || spinIndex + spinDir < 0) {
        spinDir = -spinDir;
      }
      spinIndex += spinDir;
    } else {
      spinIndex = (spinIndex + 1) % spinSet.frames.length;
    }
    el.textContent = spinSet.frames[spinIndex];
  }, spinSet.ms);
}

function stopSpinner() {
  clearInterval(spinTimer);
  spinTimer = null;
}

function startAssistantMessage(title) {
  dropWorkingMessage();

  const empty = messagesEl.querySelector('.empty-state');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = 'message assistant working';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const textNode = document.createTextNode(title || 'Working…');

  // One mark, not two. A leading dot alongside a spinner said the same thing
  // twice, and with the spinner now carrying the motion the dot only competed
  // with the line it was labelling.
  const spinner = document.createElement('span');
  spinner.className = 'working-spinner';

  bubble.appendChild(textNode);
  bubble.appendChild(spinner);

  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  currentAssistantMsg = { el: msg, textNode };
  workingSwapAt = Date.now();
  startSpinner(spinner);
  return currentAssistantMsg;
}

function setWorkingText(text) {
  if (!currentAssistantMsg) return;
  // Hold a line long enough to read. A cached page answers in under a second
  // and the two phase lines would otherwise flash past unread, which looks
  // more broken than the silence this replaced.
  const wait = 700 - (Date.now() - workingSwapAt);
  clearTimeout(workingSwapTimer);
  if (wait <= 0) {
    currentAssistantMsg.textNode.nodeValue = text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    workingSwapAt = Date.now();
    return;
  }
  const msg = currentAssistantMsg;
  workingSwapTimer = setTimeout(() => {
    // The bubble can be dropped by a step card while this is pending.
    if (currentAssistantMsg !== msg) return;
    msg.textNode.nodeValue = text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    workingSwapAt = Date.now();
  }, wait);
}

function dropWorkingMessage() {
  clearTimeout(workingSwapTimer);
  workingSwapTimer = null;
  // Before the null check, not after: the ticker outlives the bubble it was
  // animating otherwise, and writing frames into a detached node every 90ms
  // is the kind of leak that only shows up after a long session.
  stopSpinner();
  if (!currentAssistantMsg) return;
  currentAssistantMsg.el.remove();
  currentAssistantMsg = null;
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
      title: "Task not permitted by your Brotto policy",
      body: summaryText ||
        "This task is out of scope for the domains you blocked. Brotto declined it before "
        + "navigating anywhere. Check the blocked-domains list in settings if you think "
        + "this is wrong.",
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
      // task string; see saveSession and replaySession.
      if (message.sessionId || message.session_id) {
        state.sessionId = message.sessionId || message.session_id;
      }
      // A real run is under way, so the bar is live again whatever it was
      // showing — including the frozen numbers of a session reopened from
      // history that this message is now continuing.
      state.replaying = false;
      setOutcome('running');
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
      // A socket that dies mid-task reports nothing through task_failed
      // unless the background got far enough to synthesise it, and the
      // outcome cell is the only place that would have said so — it was
      // left on WORKING, claiming a run that had already stopped.
      if (state.taskInFlight) {
        setOutcome('failed', FAILURE_NOTE.disconnected, 'disconnected');
        setPhase('error', FAILURE_NOTE.disconnected);
      }
      break;

    // ponytail: the session-create retry in startRelay. A server that is
    // down used to fail as one silent throw; the user saw the panel sit on
    // "Starting…" with nothing to explain it.
    //
    // The sentence goes in the toast, not the pill. The header has no room
    // for it — "Server unreachable… (retry 1 of 6)" truncated mid-word and
    // pushed the rest of the header off screen. The pill keeps the same
    // one-word shape as its siblings (Connected / Connecting… / Disconnected
    // / Idle), and the retry count is live information: one toast replacing
    // the next restates it in place rather than stacking six identical lines.
    case 'server_unreachable':
      setConnPill('reconnecting', 'Reconnecting');
      toast(
        `Server unreachable — retrying (${message.attempt ?? '?'}/${message.of ?? '?'})`,
        'bad',
        4000,
      );
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
        setOutcome('cancelled');
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
      // The step bubble below says this better than the working line, so the
      // working line goes rather than being left spinning one row above it.
      dropWorkingMessage();
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
      // visible jump when the next bubble appears). The outgoing wall is
      // settled rather than deleted — the audit keeps it, so the replay
      // would draw it back with the deletion not in it.
      clearLoginPrompt('Signed in, and the task carried on.');
      appendLoginCard({
        domain: message.domain || 'this site',
        url: message.url || '',
        title: message.page_title || '',
        task: message.task || '',
      });
      break;

    case 'context_update': {
      // ponytail: the server sends this INSTEAD of step_progress when a step
      // produced no visible action, so it means the step ended with nothing
      // to show. Leaving the spinner up would claim the agent is still busy
      // through the whole next observe window.
      dropWorkingMessage();
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
      // ponytail: the sign-in wall and any question are part of how this run
      // went — they settle, not vanish, so the transcript still says Brotto
      // asked before it finished.
      settleBlockingCards('The task finished before you answered.');
      // Captured before stopTimer, which resets the counter.
      void saveSession({ status: 'done', steps: message.steps, elapsed: timerActiveEl && timerActiveEl.textContent });
      setOutcome('completed', message.summary);
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

    case 'task_error':
      // ponytail: main.py sends this from its `finally` for anything the
      // harness raised and nobody handled — an unresolvable model config, a
      // resolver raise, a bug. It used to have no case here at all, so the
      // frame was dropped: no stopTimer, no setOutcome, no card cleanup. The
      // clock ran forever and OUTCOME sat on WORKING while the server was
      // already dead — indistinguishable from a slow step, and the socket
      // close on top of it started a reconnect that could never succeed.
      //
      // A server frame with no case here is an infinite run. Adding one to
      // the set below is the whole fix; see test-no-orphan-frames.test.js.
      if (alreadyTerminal('task_error')) break;
      clearBlockingCards();
      void saveSession({ status: 'failed', elapsed: timerActiveEl && timerActiveEl.textContent });
      setOutcome('failed', message.error, 'server_error');
      stopTimer();
      setPhase('error', FAILURE_NOTE.server_error);
      appendFailureBubble({
        title: FAILURE_NOTE.server_error,
        footer: String(message.error ?? '').trim(),
      });
      break;

    case 'task_failed':
      if (alreadyTerminal('task_failed')) break;
      // ponytail: same as task_completed — every prompt settles on any
      // terminal event, so the user never sees a stale "Waiting" bubble
      // after the task has failed / been cancelled.
      settleBlockingCards('The task stopped before you answered.');
      void saveSession({ status: 'failed', elapsed: timerActiveEl && timerActiveEl.textContent });
      setOutcome('failed', message.summary, message.failure_reason);
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
        // Non-policy failure. The note says which family it was and what to
        // try; the harness's `summary` keeps the detail underneath it, because
        // it is the only thing that names this run specifically. The code
        // never reaches the user — `Task failed (auth_failed)` in the meta
        // line told someone nothing and looked like a bug.
        const note = failureNote(message.failure_reason, message.summary);
        const detail = (message.summary || '').trim();
        setPhase('error', note);
        setOutcome('failed', detail || note, message.failure_reason);
        appendMessage({ role: 'error', text: closingText(message.failure_reason, detail) });
      }
      break;

    case 'clarify_request': {
      // ponytail: login wall was cleared (otherwise the loop couldn't
      // have produced a clarifying question). Fade bubble + button out
      // before the new clarify card appears so the transition reads as
      // a single flow, not two stacked bubbles.
      clearLoginPrompt();
      // Card first: it sets state.pendingClarifyId, and setPhase is what
      // re-enables the composer for the answer. The other order leaves the
      // run blocked on a question the panel refuses to accept an answer to.
      appendClarifyCard({
        id: message.id,
        question: message.question || 'Brotto needs your guidance.',
        reason: message.reason || '',
      });
      setPhase('paused', 'Brotto has a question');
      goalEl.focus();
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
      resolveCard(card, 'approval-decision', message.approved ? 'Approved' : 'Denied');
      // The task is unblocked, so the clock has to start counting again —
      // setPhase('paused') is what stopped it, and nothing else resumes it.
      if (state.phase === 'paused') setPhase('executing', 'Working…');
      break;
    }

    // ── Canonical events ─────────────────────────────────────────────────
    case 'canonical_step': {
      // ponytail: any canonical step past a login wall clears the prompt.
      clearLoginPrompt();
      // A known phase key gets panel-owned wording; anything else falls back
      // to the server's own text so an unrecognised kind still shows something.
      const line = workingLine(message.kind);
      const titleText = line
        || (message.reasoning && message.reasoning.trim())
        || deriveReasoningFromAction(message.summary || '', message.kind)
        || 'Working on it…';
      if (currentAssistantMsg) setWorkingText(titleText);
      else startAssistantMessage(titleText);
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
      // No card cleanup here: every branch below lands on a terminal phase,
      // and setPhase settles whatever the task was blocked on.
      stopTimer();
      const m = message.message || {};
      if (m.type === 'task.completed') {
        setPhase('done', m.summary || 'Task complete');
        setOutcome('completed', m.summary);
        appendMessage({ role: 'done', text: m.summary || 'Task completed successfully.', finalAnswer: m.finalAnswer });
      } else if (m.type === 'task.failed') {
        const note = failureNote(m.failure_reason, m.message);
        setPhase('error', note);
        setOutcome('failed', m.message || note, m.failure_reason);
        appendMessage({ role: 'error', text: note });
      } else {
        // ponytail: this used to render a green "Task ended." for *any*
        // other type, so a cancellation showed as a success. Anything that
        // isn't a completion ends the task without claiming it worked.
        setPhase('error', 'Task ended');
        setOutcome('cancelled');
        appendMessage({ role: 'error', text: m.message || 'The task ended before it finished.' });
      }
      break;
    }

    case 'canonical_error':
      // The code is a log handle, not a message. Same treatment as every
      // other failure: a sentence naming the family, and the server's own
      // text kept underneath it where it can be more specific.
      appendMessage({
        role: 'error',
        text: `${failureNote(message.code, message.message)}\n\n${message.message || ''}`.trim(),
      });
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
      // The status bar has no tab cell — the outcome cell took its place, and
      // nothing else in the panel reads tab lifecycle.
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
  if (agentSecretSetting && settings && typeof settings.agentSecret === 'string') {
    agentSecretSetting.value = settings.agentSecret;
  }
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
    // The catalogue was loaded above against whatever URL the field held
    // then — the default, on a first open. Now that the saved server is
    // known, re-read it from there.
    await initModelSettings(url);
  } catch {
    // ponytail: Bug 9 — server unreachable on open. A toast, not a chat
    // message: this is a transient condition, not part of the transcript,
    // and the connection pill already says it. The previous version posted
    // a role:'error' message then tried to remove it with '.message-error'
    // — but appendMessage writes class "message error" (a space), so the
    // selector never matched and the notice sat in the chat forever.
    state.serverReachable = false;
    setConnPill('error', 'Disconnected');
    toast('Server unreachable — settings still work locally', 'bad', 5000);
  }
  // Last, so it runs whether or not the health probe succeeded: the panel
  // still needs its fallback lines when the server is down.
  void currentTab().then(refreshEmptyState);
})();
