// welcome.js — first-run setup for the side panel.
//
// Runs once, right after install: three questions, then the panel takes
// over. Every field is optional — "Skip" is a real answer, and the panel
// works with server defaults. This is not a gate.

// Mirrors MODEL_CATALOG in sidepanel.js and PROVIDER_REGISTRY in
// services/brotto-orchestrator/src/brotto_orchestrator/model/registry.py.
// Kept in sync by hand on purpose: pulling a shared module out of the
// 2,500-line panel for four lines of data is not worth the reformat.
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

function populateModels() {
  $model.textContent = "";
  for (const entry of MODEL_CATALOG[$provider.value] || []) {
    const opt = document.createElement("option");
    opt.value = entry.model;
    opt.textContent = entry.model;
    $model.appendChild(opt);
  }
}
$provider.addEventListener("change", populateModels);

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
  const ctx = (MODEL_CATALOG[provider] || []).find((e) => e.model === $model.value)?.context_window;
  const key = $apiKey.value.trim();

  // Same storage shapes sidepanel.js reads: config persists, key does not.
  const saved = await chrome.storage.local.get("settings");
  await Promise.all([
    chrome.storage.local.set({
      settings: { ...(saved.settings || {}), serverUrl: server, onboarded: true },
      modelConfig: { provider, model: $model.value, context_window: ctx },
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
