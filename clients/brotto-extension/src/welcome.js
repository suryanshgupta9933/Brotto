// welcome.js — first-run setup for the side panel.
//
// Runs once, right after install: three questions, then the panel takes
// over. Every field is optional — "Skip" is a real answer, and the panel
// works with server defaults. This is not a gate.

// The provider/model list comes from the server (see model_catalog.js). It
// used to be a third hand-kept copy here, and the copies had already drifted:
// this file listed three MiniMax models where the registry listed four.

const DEFAULT_SERVER = "http://localhost:8000";
const TOTAL_STEPS = 3;

const $stepEls = document.querySelectorAll(".step");
const $stepCount = document.getElementById("stepCount");
const $back = document.getElementById("backBtn");
const $next = document.getElementById("nextBtn");
const $skip = document.getElementById("skipBtn");
const $serverUrl = document.getElementById("serverUrl");
const $serverStatus = document.getElementById("serverStatus");
const $provider = document.getElementById("provider");
const $model = document.getElementById("model");
const $apiKey = document.getElementById("apiKey");

let step = 1;

function show(n) {
  step = n;
  for (const el of $stepEls) el.classList.toggle("active", Number(el.dataset.step) === n);
  $stepCount.textContent = `Step ${n} of ${TOTAL_STEPS}`;
  $back.hidden = n === 1;
  // "Skip" is meaningless once there is nothing left to skip past.
  $skip.hidden = n === TOTAL_STEPS;
  $next.textContent = n === TOTAL_STEPS ? "Start" : "Next";
  $serverStatus.textContent = "";
  $serverStatus.className = "";
  $next.focus();
}

let catalog = null;

function populateProviders() {
  $provider.textContent = "";
  for (const p of catalog?.providers || []) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    $provider.appendChild(opt);
  }
  populateModels();
}

function populateModels() {
  const list = document.getElementById("model-options");
  if (!list) return;
  const p = brottoModelCatalog.provider(catalog, $provider.value);
  list.textContent = "";
  for (const entry of p?.models || []) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    list.appendChild(opt);
  }
  // No default model: a first-run screen should not pre-select a model the
  // user has no key for. The datalist suggests; the field decides.
  if (!document.activeElement || document.activeElement !== $model) $model.value = "";
}
$provider.addEventListener("change", populateModels);

// Runs on load, not on a step change: the server may not be up yet, and the
// loader falls back to the cached catalogue then the built-in one, so this
// never blocks the wizard.
catalog = brottoModelCatalog.load($serverUrl.value.trim() || DEFAULT_SERVER);
catalog.then(populateProviders);

// A dead server address is the one mistake here that costs the user a
// confused first task, so say so now rather than on their first send.
async function checkServer() {
  const base = $serverUrl.value.trim() || DEFAULT_SERVER;
  $serverStatus.textContent = "Checking…";
  $serverStatus.className = "";
  try {
    const res = await fetch(base + "/health", { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    $serverStatus.textContent = "Reachable";
    $serverStatus.className = "ok";
  } catch {
    $serverStatus.textContent = "No answer — check the address, or continue and set it later in Settings";
    $serverStatus.className = "bad";
  }
}
$serverUrl.addEventListener("blur", checkServer);

async function finish() {
  const server = $serverUrl.value.trim() || DEFAULT_SERVER;
  const provider = $provider.value;
  const model = $model.value.trim();
  const ctx = brottoModelCatalog.contextWindow(catalog, provider, model);
  const key = $apiKey.value.trim();

  // Same storage shapes sidepanel.js reads: config persists, key does not.
  // The first-run screen has no base-URL field — a self-hosted endpoint is set
  // in Settings, where there is room to explain it.
  const saved = await chrome.storage.local.get("settings");
  await Promise.all([
    chrome.storage.local.set({
      settings: { ...(saved.settings || {}), serverUrl: server, onboarded: true },
      modelConfig: { provider, model, context_window: ctx },
    }),
    key ? chrome.storage.session.set({ modelApiKey: key }) : Promise.resolve(),
  ]);

  // setOptions has no gesture requirement (open() does), which is the only
  // reason this hand-off works from a button inside an extension page.
  await chrome.sidePanel.setOptions({ path: "sidepanel.html" });
}

$back.addEventListener("click", () => { if (step > 1) show(step - 1); });
$next.addEventListener("click", () => {
  if (step < TOTAL_STEPS) { show(step + 1); return; }
  $next.disabled = true;
  $next.textContent = "Starting…";
  void finish();
});
$skip.addEventListener("click", () => {
  $next.disabled = true;
  void finish();
});

(async () => {
  const stored = await chrome.storage.local.get("settings");
  $serverUrl.value = stored.settings?.serverUrl || DEFAULT_SERVER;
  populateModels();
  show(1);
})();
