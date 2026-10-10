// welcome.js — first-run setup for the side panel.
//
// Runs once, right after install: which Brotto, what it does, where tasks
// go, then the panel takes over. Every field is optional — "Skip" is a real
// answer, and the panel works with server defaults. This is not a gate.

// The provider/model list comes from the server (see model_catalog.js). It
// used to be a third hand-kept copy here, and the copies had already drifted:
// this file listed three MiniMax models where the registry listed four.

const DEFAULT_SERVER = "http://localhost:8000";
const CLOUD_SERVER_URL = "https://agent.brotto.dev";
const TOTAL_STEPS = 4;
// The step that points at a server. Cloud leaves it only by signing in —
// that is the one step in this wizard that can fail, and it fails here
// rather than writing a token nobody has.
const SERVER_STEP = 3;

const $stepEls = document.querySelectorAll(".step");
const $stepCount = document.getElementById("stepCount");
const $back = document.getElementById("backBtn");
const $next = document.getElementById("nextBtn");
const $skip = document.getElementById("skipBtn");
const $serverUrl = document.getElementById("serverUrl");
const $agentSecret = document.getElementById("agentSecret");
const $serverStatus = document.getElementById("serverStatus");
const $provider = document.getElementById("provider");
const $model = document.getElementById("model");
const $apiKey = document.getElementById("apiKey");
const $editionSelf = document.getElementById("editionSelf");
const $editionCloud = document.getElementById("editionCloud");
const $selfHostFields = document.getElementById("selfHostFields");
const $cloudFields = document.getElementById("cloudFields");
const $cloudEmail = document.getElementById("cloudEmail");
const $cloudCode = document.getElementById("cloudCode");
const $cloudStatus = document.getElementById("cloudStatus");
const $sendCodeBtn = document.getElementById("sendCodeBtn");
const $serverUrlHint = document.getElementById("serverUrlHint");

const CLOUD_HINT = "Brotto Cloud. This is where your tasks go.";
const SELF_HOST_HINT = "Leave this as-is if you're using the Brotto service. Change it only if you run your own server.";

// The radio is the only record of which edition this is — derived, never
// mirrored into a variable, so the two can't disagree.
function edition() {
  return $editionCloud.checked ? "cloud" : "self";
}

function setCloudStatus(text, tone) {
  if (!$cloudStatus) return;
  // textContent, not innerHTML: the address in this line is typed text, and
  // this wizard holds the same rule the panel does.
  $cloudStatus.textContent = text || "";
  $cloudStatus.className = tone ? `status ${tone}` : "status";
}

// What the address held before the cloud radio overwrote it. One-way was the
// old comment's claim and it was simply not true of the field: the cloud
// address is written into a user-editable input, so coming back to self-host
// left agent.brotto.dev sitting in a form that is about to be saved as
// `serverUrl` — a self-hoster who glanced at both radios shipped their own
// install to the cloud address.
let selfHostServerUrl = "";

function applyEdition() {
  const cloud = edition() === "cloud";
  $selfHostFields.hidden = cloud;
  $cloudFields.hidden = !cloud;
  $serverUrl.readOnly = cloud;
  $serverUrl.classList.toggle("input--readonly", cloud);
  if ($serverUrlHint) $serverUrlHint.textContent = cloud ? CLOUD_HINT : SELF_HOST_HINT;
  // The cloud address is fixed, so it is written on the way in rather than
  // typed. Every self-host field keeps whatever the user already had — the
  // address included, which is why it is snapshotted rather than overwritten.
  if (cloud) {
    if ($serverUrl.value.trim() !== CLOUD_SERVER_URL) selfHostServerUrl = $serverUrl.value;
    $serverUrl.value = CLOUD_SERVER_URL;
  } else if ($serverUrl.value.trim() === CLOUD_SERVER_URL) {
    $serverUrl.value = selfHostServerUrl;
  }
  $serverStatus.textContent = "";
  $serverStatus.className = "status";
  setCloudStatus("");
}

$editionSelf.addEventListener("change", applyEdition);
$editionCloud.addEventListener("change", applyEdition);
$sendCodeBtn.addEventListener("click", () => { void requestCode(); });

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
  $serverStatus.className = "status";
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

// A dead server address, or a wrong key, is the mistake here that costs the
// user a confused first task — so say so now rather than on their first send.
// The two are one check: `/health` is unauthenticated, so it only proves the
// server is up. A 404 from an authenticated route is this server's answer to a
// refused key (403 would confirm the route is worth probing), which without
// this reads as a missing endpoint and sends them to debug the wrong thing.
async function checkServer() {
  const base = $serverUrl.value.trim() || DEFAULT_SERVER;
  const secret = $agentSecret.value.trim();
  $serverStatus.textContent = "Checking…";
  $serverStatus.className = "status";
  try {
    const res = await fetch(base + "/health", { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (secret) {
      // The field is pre-filled from storage on load, so a key sitting in it
      // may be one this browser was issued elsewhere. Bind it to the origin
      // that issued it, by the same rule the service worker applies — a
      // self-hoster typing their own key over a LAN address is unaffected,
      // because that value was typed here and has no recorded issuer.
      const stored = (await chrome.storage.local.get("settings")).settings || {};
      const fromStorage = secret === String(stored.agentSecret || "").trim();
      const { refusal } = brottoCredential.forUrl(stored, base, !fromStorage);
      if (fromStorage && refusal) {
        $serverStatus.textContent = refusal;
        $serverStatus.className = "status bad";
        return;
      }
      const authed = await fetch(base + "/v1/policy", {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (authed.status === 404) {
        $serverStatus.textContent = "Reachable, but that key was refused — check it against the AGENT_SECRET on your server";
        $serverStatus.className = "status bad";
        return;
      }
    }
    $serverStatus.textContent = "Reachable";
    $serverStatus.className = "status ok";
  } catch {
    $serverStatus.textContent = "No answer — check the address, or continue and set it later in Settings";
    $serverStatus.className = "status bad";
  }
}
$serverUrl.addEventListener("blur", checkServer);
$agentSecret.addEventListener("blur", checkServer);

// ── Cloud sign-in ──────────────────────────────────────────────────────────
// A 6-digit code emailed to the user, exchanged for a bearer token that goes
// into `settings.agentSecret` — the same slot the self-host key uses, so
// `finish()` below is unchanged and nothing downstream asks which kind it is.
async function postAuth(path, payload) {
  const res = await fetch($serverUrl.value.trim() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

async function requestCode() {
  const email = $cloudEmail.value.trim();
  if (!email) { setCloudStatus("Enter the email you signed up with", "bad"); return; }
  setCloudStatus("Sending");
  try {
    const { ok } = await postAuth("/v1/auth/request-code", { email });
    setCloudStatus(
      ok ? `Code sent to ${email} — it can take a minute` : "That address could not be sent a code",
      ok ? "ok" : "bad",
    );
  } catch {
    setCloudStatus("Could not reach the server — check the address above", "bad");
  }
}

// Returns whether there is now a token, because the step it guards only
// advances on true — a code that did not work leaves the wizard here.
async function exchangeCode() {
  const email = $cloudEmail.value.trim();
  const code = $cloudCode.value.trim();
  if (!email) { setCloudStatus("Enter the email you signed up with", "bad"); return false; }
  if (!/^\d{6}$/.test(code)) { setCloudStatus("That code should be six digits", "bad"); return false; }
  setCloudStatus("Signing in");
  let token = null;
  try {
    const { ok, body } = await postAuth("/v1/auth/exchange", { email, code });
    if (ok && body && typeof body.access_token === "string") token = body.access_token;
  } catch { /* the sentence below is the user-facing failure */ }
  if (!token) { setCloudStatus("That code did not work — send another and try again", "bad"); return false; }
  // Into the same input the self-host key uses, deliberately: one writer,
  // one storage shape, and nothing here has to know what a token is.
  $agentSecret.value = token;
  $cloudCode.value = "";
  setCloudStatus("Signed in", "ok");
  return true;
}

async function finish() {
  const server = $serverUrl.value.trim() || DEFAULT_SERVER;
  const provider = $provider.value;
  const model = $model.value.trim();
  const ctx = brottoModelCatalog.contextWindow(catalog, provider, model);
  const key = $apiKey.value.trim();

  // Same storage shapes sidepanel.js reads: config persists, key does not.
  // The model key lives in storage.session (cleared with the browser), but
  // agentSecret is part of `settings` and stays — it is a property of the
  // server the user chose, not of the session, and retyping it every restart
  // is the friction this field exists to remove. On the cloud path it holds
  // a bearer token rather than an AGENT_SECRET, which is the point: one
  // slot, one header, and nothing that has to be told which it is.
  const saved = await chrome.storage.local.get("settings");
  await Promise.all([
    chrome.storage.local.set({
      settings: {
        ...(saved.settings || {}),
        serverUrl: server,
        agentSecret: $agentSecret.value.trim(),
        // Which server issued it. On the cloud path that value is a real
        // account identity, and the service worker now refuses to send it
        // anywhere else (see credential.js).
        agentSecretOrigin: server,
        onboarded: true,
      },
      modelConfig: { provider, model, context_window: ctx },
    }),
    key ? chrome.storage.session.set({ modelApiKey: key }) : Promise.resolve(),
  ]);

  // setOptions has no gesture requirement (open() does), which is the only
  // reason this hand-off works from a button inside an extension page.
  await chrome.sidePanel.setOptions({ path: "sidepanel.html" });
}

$back.addEventListener("click", () => { if (step > 1) show(step - 1); });
$next.addEventListener("click", async () => {
  if (step === SERVER_STEP && edition() === "cloud" && !$agentSecret.value) {
    $next.disabled = true;
    const signedIn = await exchangeCode();
    $next.disabled = false;
    if (!signedIn) return;
  }
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
  $agentSecret.value = stored.settings?.agentSecret || "";
  // Signing out of Brotto Cloud sends the user back here (signOutOfCloud),
  // so a stored cloud address pre-selects the cloud radio. This is a
  // pre-fill of a form control, not the panel's mode test — the panel reads
  // auth_mode off the server, and never compares this string.
  if (CLOUD_SERVER_URL === $serverUrl.value.trim()) $editionCloud.checked = true;
  applyEdition();
  populateModels();
  show(1);
})();
