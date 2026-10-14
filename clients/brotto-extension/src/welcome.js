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
const $provider = document.getElementById("provider");
const $providerTrigger = document.getElementById("providerTrigger");
const $providerStatus = document.getElementById("providerStatus");
const $providerRetryBtn = document.getElementById("providerRetryBtn");
const $model = document.getElementById("model");
const $apiKey = document.getElementById("apiKey");
const $editionSelf = document.getElementById("editionSelf");
const $editionCloud = document.getElementById("editionCloud");
const $selfHostBlock = document.getElementById("selfHostBlock");
const $cloudFields = document.getElementById("cloudFields");
const $cloudEmail = document.getElementById("cloudEmail");
const $cloudCode = document.getElementById("cloudCode");
const $cloudCodeField = document.getElementById("cloudCodeField");
const $sendCodeBtn = document.getElementById("sendCodeBtn");
const $sendCodeRow = document.getElementById("sendCodeRow");
const $resendCodeBtn = document.getElementById("resendCodeBtn");
const $serverUrlHint = document.getElementById("serverUrlHint");
const $waitlistBlock = document.getElementById("waitlistBlock");
const $waitlistEmail = document.getElementById("waitlistEmail");
const $waitlistName = document.getElementById("waitlistName");
const $waitlistJoinBtn = document.getElementById("waitlistJoinBtn");

const SELF_HOST_HINT = "Where your tasks go. Leave it alone unless you run your own server.";

// The radio is the only record of which edition this is — derived, never
// mirrored into a variable, so the two can't disagree.
function edition() {
  return $editionCloud.checked ? "cloud" : "self";
}

// One transient notice, same shape as the side panel's toast: a fact that
// leaves no other trace. One at a time — a second replaces the first.
// Removal runs on its own timer instead of `animationend`, which never fires
// under prefers-reduced-motion (the animation is set to `none`) and would
// strand the toast on screen.
let toastTimer = null;
let toastGoneTimer = null;
// Errors hold longer than facts — 5200, the side panel's own bad-toast
// budget — so the sentence can be read before it leaves.
function toast(text, kind, ms = kind === "bad" ? 5200 : 2600) {
  clearTimeout(toastTimer);
  clearTimeout(toastGoneTimer);
  const old = document.querySelector(".toast");
  if (old) old.remove();
  if (!text) return;
  // textContent, not innerHTML: the address in this line is typed text, and
  // this wizard holds the same rule the panel does.
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.setAttribute("role", "status");
  el.textContent = text;
  // Sit above whatever is actually at the bottom of the window — the foot
  // bar carries Skip/Next and a fixed offset would land on top of it.
  const foot = document.getElementById("foot");
  const top = foot && foot.offsetParent !== null
    ? foot.getBoundingClientRect().top
    : window.innerHeight;
  el.style.bottom = `${Math.round(window.innerHeight - top + 8)}px`;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.classList.add("leaving"), ms);
  // 200ms covers the 180ms leave animation with a little slack.
  toastGoneTimer = setTimeout(() => el.remove(), ms + 200);
}

// The three writers are one writer. They stay named because every call site
// and every extraction test talks to them; the popup is underneath.
function setCloudStatus(text, tone) { toast(text, tone); }
function setServerStatus(text, tone) { toast(text, tone); }

// What the address held before the cloud radio overwrote it. One-way was the
// old comment's claim and it was simply not true of the field: the cloud
// address is written into a user-editable input, so coming back to self-host
// left agent.brotto.dev sitting in a form that is about to be saved as
// `serverUrl` — a self-hoster who glanced at both radios shipped their own
// install to the cloud address.
let selfHostServerUrl = "";

function applyEdition() {
  const cloud = edition() === "cloud";
  // The whole self-host screen is one question and one block: heading, lede,
  // address, key. Hiding only the fields left "Your Brotto server" and the
  // model-agnostic line stacked above the cloud sign-in.
  $selfHostBlock.hidden = cloud;
  $cloudFields.hidden = !cloud;
  if ($serverUrlHint) $serverUrlHint.textContent = SELF_HOST_HINT;
  // The value is still written on the way in, because `finish()` and
  // `postAuth` read the field and neither knows which edition this is. That
  // is why the field can go: the storage shape and the one writer behind it
  // are unchanged, and a cloud user still ends up with a working `serverUrl`.
  if (cloud) {
    if ($serverUrl.value.trim() !== CLOUD_SERVER_URL) selfHostServerUrl = $serverUrl.value;
    $serverUrl.value = CLOUD_SERVER_URL;
  } else if ($serverUrl.value.trim() === CLOUD_SERVER_URL) {
    $serverUrl.value = selfHostServerUrl;
  }
  setCloudStatus("");
  hideCodeEntry();
}

$editionSelf.addEventListener("change", applyEdition);
$editionCloud.addEventListener("change", applyEdition);
$sendCodeBtn.addEventListener("click", () => { void requestCode(); });
$resendCodeBtn.addEventListener("click", () => { void requestCode(); });
if ($providerRetryBtn) $providerRetryBtn.addEventListener("click", () => { void loadCatalog(); });
if ($waitlistJoinBtn) $waitlistJoinBtn.addEventListener("click", () => { void joinWaitlist(); });

let step = 1;

function show(n) {
  step = n;
  for (const el of $stepEls) el.classList.toggle("active", Number(el.dataset.step) === n);
  $stepCount.textContent = `Step ${n} of ${TOTAL_STEPS}`;
  $back.hidden = n === 1;
  // "Skip" is meaningless once there is nothing left to skip past.
  $skip.hidden = n === TOTAL_STEPS;
  $next.textContent = n === TOTAL_STEPS ? "Start" : "Next";
  // The catalogue belongs to the address it was fetched from, and the address
  // can change two steps after the fetch.
  if (n === TOTAL_STEPS) {
    const base = $serverUrl.value.trim() || DEFAULT_SERVER;
    if (base !== catalogBase) void loadCatalog();
  }
  $next.focus();
}

// ── The model catalogue ────────────────────────────────────────────────────
// The list is the server's, from `GET /v1/models`, and it used to be fetched
// at module load — before the IIFE at the bottom had pre-filled the address
// from storage, so it always went to localhost whatever the user had chosen.
// It is loaded from the address the field actually holds, and again if that
// address changes before step 4.
//
// `load()` cannot reject — it falls back to the cached catalogue and then to
// the built-in one — so the state this has to render is not "failed" but
// "offline", and a control that cannot tell those apart from "still loading"
// is a select the user watches forever. Three states, one line, one retry.
let catalog = null;
let catalogBase = "";

function setProviderStatus(text, tone) {
  $providerStatus.textContent = text || "";
  $providerStatus.className = tone ? `hint ${tone}` : "hint";
}

// The host select is display:none; the trigger is what the user sees. One
// writer for both, so a loading or empty list cannot leave a live button
// pointing at a control with nothing in it.
function setProviderDisabled(off) {
  $provider.disabled = off;
  if ($providerTrigger) $providerTrigger.disabled = off;
}

async function loadCatalog() {
  const base = $serverUrl.value.trim() || DEFAULT_SERVER;
  catalogBase = base;
  setProviderDisabled(true);
  $providerRetryBtn.hidden = true;
  setProviderStatus("Reading the model list from your server.");
  catalog = await brottoModelCatalog.load(base);
  renderProviders();
}

function renderProviders() {
  const list = (catalog && catalog.providers) || [];
  $provider.textContent = "";
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label || p.id;
    $provider.appendChild(opt);
  }
  if (!list.length) {
    // Nothing to choose from is a different sentence from "we couldn't ask",
    // and neither is silence.
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No providers";
    $provider.appendChild(none);
    setProviderDisabled(true);
    $providerRetryBtn.hidden = false;
    setProviderStatus("Your server's model list came back empty.", "bad");
    providerDd && providerDd.sync();
    return;
  }
  setProviderDisabled(false);
  // `offline` is `load()`'s own word for "this is the cached or built-in
  // list, not your server's", and it is the only signal the caller gets that
  // the fetch did not land. It is true whenever a provider here is stale.
  if (catalog && catalog.offline) {
    $providerRetryBtn.hidden = false;
    setProviderStatus("Couldn't reach your server — showing a built-in list.", "bad");
  } else {
    $providerRetryBtn.hidden = true;
    setProviderStatus("");
  }
  // Repainting the options leaves the trigger naming whatever was there
  // before — sync pushes the host's new value into the box.
  providerDd && providerDd.sync();
  populateModels();
}

function populateModels() {
  const list = document.getElementById("model-options");
  if (!list) return;
  const p = brottoModelCatalog.provider(catalog, $provider.value);
  list.textContent = "";
  for (const entry of (p && p.models) || []) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    list.appendChild(opt);
  }
  // No default model: a first-run screen should not pre-select a model the
  // user has no key for. The datalist suggests; the field decides.
  if (!document.activeElement || document.activeElement !== $model) $model.value = "";
}
$provider.addEventListener("change", populateModels);

// Same Ink & Rule dropdown as Settings' provider picker — one component in
// dropdown.js. The hidden <select> stays the value host finish() reads; the
// trigger is what the user sees. Choosing an row writes the host and fires
// its `change`, so populateModels above keeps working untouched.
const providerDd = $provider && attachDropdown({
  root: document.getElementById("providerDd"),
  trigger: $providerTrigger,
  list: document.getElementById("providerList"),
  getOptions: () => Array.from($provider.children).map((o) => ({ value: o.value, label: o.textContent || o.value })),
  getValue: () => $provider.value,
  setValue: (v) => { $provider.value = v; $provider.dispatchEvent(new Event("change")); },
});

// A dead server address, or a wrong key, is the mistake here that costs the
// user a confused first task — so say so now rather than on their first send.
// The two are one check: `/health` is unauthenticated, so it only proves the
// server is up. A 404 from an authenticated route is this server's answer to a
// refused key (403 would confirm the route is worth probing), which without
// this reads as a missing endpoint and sends them to debug the wrong thing.
//
// It returns what it found as well as writing it, because blur alone is a weak
// signal: a user can leave a dead address in the field and only find out on
// their first real task. `finish()` asks the same question before it saves.
// Self-host only: on the cloud path there is no address to check, and the
// exchange is the gate instead.
async function checkServer() {
  const base = $serverUrl.value.trim() || DEFAULT_SERVER;
  const secret = $agentSecret.value.trim();
  setServerStatus("Checking…");
  // One write, one return: the status line and the caller's decision can
  // never disagree about what was found.
  const say = (text, tone) => {
    setServerStatus(text, tone);
    return { ok: tone === "ok", tone, text };
  };
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
      if (fromStorage && refusal) return say(refusal, "bad");
      const authed = await fetch(base + "/v1/policy", {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
      });
      // Three answers, not one: up, key refused, or nothing there at all.
      if (authed.status === 404) {
        return say("Reachable, but that key was refused — check it against the AGENT_SECRET on your server", "bad");
      }
    }
    return say("Reachable", "ok");
  } catch {
    return say("No answer — check the address, or press Skip to save it anyway and fix it in Settings", "bad");
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
  return { ok: res.ok, status: res.status, body };
}

function showCodeEntry() {
  // Send code is a one-way step: the button that produced the code box goes
  // with it, so the screen asks one question at a time. Restored by
  // hideCodeEntry on any path that does not produce a box — a refused
  // address, a failed send — so a dead end never strands the button.
  if ($sendCodeRow) $sendCodeRow.hidden = true;
  $cloudCodeField.hidden = false;
  $resendCodeBtn.hidden = false;
  $cloudCode.focus();
}

function hideCodeEntry() {
  if ($sendCodeRow) $sendCodeRow.hidden = false;
  $cloudCodeField.hidden = true;
  $resendCodeBtn.hidden = true;
  $cloudCode.value = "";
}

// `POST /v1/auth/request-code` answers `{"sent": true}` or
// `{"sent": false, "reason": "not_on_list" | "pending" | "revoked"}` — always
// HTTP 200. The server says which; this maps it to one sentence and decides
// whether a code box is any use.
async function requestCode() {
  const email = $cloudEmail.value.trim();
  if (!email) { setCloudStatus("Enter the email you signed up with", "bad"); return; }
  setCloudStatus("Sending");
  let body = null;
  let ok = false;
  let status = 0;
  try {
    const res = await postAuth("/v1/auth/request-code", { email });
    ok = res.ok;
    status = res.status;
    body = res.body;
  } catch {
    setCloudStatus("Could not reach the server", "bad");
    return;
  }
  // Revealed because the user asked for a code and one is on its way — not
  // by typing an address, and never when the answer is that no mail is coming.
  if (ok && body && body.sent === true) {
    showCodeEntry();
    setCloudStatus(`A code is on its way to ${email} — it can take a minute`, "ok");
    return;
  }
  hideCodeEntry();
  // Non-200 before the reason vocabulary: the roster answers always ride
  // HTTP 200, so anything else is infrastructure, not the address.
  if (status === 429) {
    setCloudStatus("Too many attempts — wait a few minutes and try again", "bad");
    return;
  }
  if (status >= 500) {
    setCloudStatus("Brotto Cloud had a problem sending the code — try again in a moment", "bad");
    return;
  }
  if (ok && body && body.reason === "try_again") {
    setCloudStatus("The code could not be stored — try again in a moment", "bad");
    return;
  }
  if (ok && body && body.reason === "not_on_list") {
    prefillWaitlist(email);
    setCloudStatus("That address is not in the closed beta yet — leave it below and we'll write if a place opens");
    return;
  }
  if (ok && body && body.reason === "pending") {
    setCloudStatus("You're on the list but not admitted yet — watch your inbox, we'll write");
    return;
  }
  if (ok && body && body.reason === "revoked") {
    setCloudStatus("That address was withdrawn from the beta", "bad");
    return;
  }
  setCloudStatus("That address could not be sent a code", "bad");
}

// Returns whether there is now a token, because the step it guards only
// advances on true — a code that did not work leaves the wizard here.
async function exchangeCode() {
  const email = $cloudEmail.value.trim();
  const code = $cloudCode.value.trim();
  if (!email) { setCloudStatus("Enter the email you signed up with", "bad"); return false; }
  if ($cloudCodeField.hidden) { setCloudStatus("Send yourself a code first", "bad"); return false; }
  if (!/^\d{6}$/.test(code)) { setCloudStatus("That code should be six digits", "bad"); return false; }
  setCloudStatus("Signing in");
  let token = null;
  let notApproved = false;
  try {
    const { ok, body } = await postAuth("/v1/auth/exchange", { email, code });
    if (ok && body && typeof body.access_token === "string") token = body.access_token;
    // `approved` is additive and is a REPORT, not the gate: an unlisted
    // address and an unreachable control plane both come back as a valid
    // token, a 200 and `false`. Read only after a token exists, compared
    // against `false` so a server too old to send it is not read as a
    // refusal, and never allowed to decide whether the token is stored.
    if (token && body.approved === false) notApproved = true;
  } catch { /* the sentence below is the user-facing failure */ }
  if (!token) { setCloudStatus("That code did not work — send another and try again", "bad"); return false; }
  // Into the same input the self-host key uses, deliberately: one writer,
  // one storage shape, and nothing here has to know what a token is.
  $agentSecret.value = token;
  $cloudCode.value = "";
  hideCodeEntry();
  const name = await storedAccountName();
  if (notApproved) {
    // Still true, and the wizard still advances: the token is real, so
    // `finish()` has something to save and an address the operator approves
    // later starts working with nobody setting Brotto up again. What changes
    // is the sentence and the address already sitting in the waitlist box —
    // they proved they control it by completing this exchange, which is why
    // offering here is consented. Offered, never sent.
    prefillWaitlist(email);
    setCloudStatus("Signed in — but Brotto Cloud is a closed beta and this address is not on the list yet");
    return true;
  }
  setCloudStatus(name ? `Signed in. Welcome, ${name}.` : "Signed in", "ok");
  return true;
}

// ── The waitlist ──────────────────────────────────────────────────────────
// The same form the side panel carries, on the same server, taking an address
// and an optional name. `POST /v1/waitlist` answers `{"ok": true}` for a new
// address and for one already on the list alike, deliberately, so the route
// cannot be asked who is on it — which is why the sentence after a 200 is the
// same one for both.
function setWaitlistStatus(text, tone) { toast(text, tone); }

// Never overwrites an address already typed — the prefill is the refusal's
// convenience, not the form's default. It opens the toggle too: a form the
// user is told to leave an address in has to be one they can see.
function prefillWaitlist(email) {
  if ($waitlistBlock) $waitlistBlock.open = true;
  if (email && $waitlistEmail && !$waitlistEmail.value.trim()) $waitlistEmail.value = email;
}

// The only name Brotto ever holds is one the user typed here, so this is the
// only source a greeting may use. It is read back out of the same `settings`
// object rather than mirrored, so there is no second copy to fall out of step.
async function storedAccountName() {
  const s = (await chrome.storage.local.get("settings")).settings || {};
  return typeof s.accountName === "string" ? s.accountName.trim() : "";
}

async function rememberAccountName(name) {
  if (!name) return;
  const stored = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...(stored.settings || {}), accountName: name },
  });
}

async function joinWaitlist() {
  const email = $waitlistEmail.value.trim();
  const name = $waitlistName ? $waitlistName.value.trim() : "";
  if (!email) { setWaitlistStatus("Enter the address to reach", "bad"); return false; }
  setWaitlistStatus("Adding you to the list");
  try {
    const { ok } = await postAuth("/v1/waitlist", { email, name });
    if (!ok) {
      setWaitlistStatus("That did not go through — try again in a few minutes", "bad");
      return false;
    }
    // They gave us the name here, so this is the one place it is worth
    // keeping — it is what a later sign-in greets them by.
    await rememberAccountName(name);
    setWaitlistStatus(`Thanks. If a place opens, we'll email ${email}.`, "ok");
    return true;
  } catch {
    setWaitlistStatus("Could not reach the server — try again later", "bad");
    return false;
  }
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
  const saved = await chrome.storage.local.get(["settings", "modelConfig"]);
  // A window the user stated in Settings outranks this file's answer: for a
  // provider that takes any model id the catalogue can only offer a fallback,
  // and re-running the wizard must not silently write that fallback back over
  // a number they typed.
  const prevCtx = Number(saved.modelConfig?.context_window);
  const keepCtx = Number.isFinite(prevCtx) && prevCtx > 0 ? prevCtx : ctx;
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
      modelConfig: { provider, model, context_window: keepCtx },
    }),
    key ? chrome.storage.local.set({ modelApiKey: key }) : Promise.resolve(),
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
  // Verified on save, not on blur. Blur is advice; this is the moment the
  // address becomes the one every later read trusts, and saving one that does
  // not answer is the "find out on your first real task" failure this screen
  // exists to prevent. Self-host only: on the cloud path the exchange above
  // was the gate and there is no address on this step to verify. Back to the
  // step it was typed on, with the sentence.
  if (edition() === "self") {
    const verified = await checkServer();
    if (!verified.ok) {
      $next.disabled = false;
      show(SERVER_STEP);
      setServerStatus(verified.text, verified.tone);
      return;
    }
  }
  $next.textContent = "Starting…";
  void finish();
});
// Skip is a real answer and stays one: it writes the address without asking
// the server anything. The panel's pre-task probe is what catches a dead one
// saved this way, and it catches it in one sentence at the first send.
$skip.addEventListener("click", () => {
  $next.disabled = true;
  void finish();
});

// The radio that opens the wizard. Cloud is the default and self-host is the
// deliberate opt-out — but only for a browser that has never answered.
// A stored address IS an answer: an install that already chose self-host
// keeps it, and `onboarded` means the wizard is not re-shown on update at all.
// Re-asking somebody who answered once would be worse than either default.
function initialEdition(storedServerUrl) {
  const stored = String(storedServerUrl || "").trim();
  return !stored || stored === CLOUD_SERVER_URL ? "cloud" : "self";
}

(async () => {
  const stored = await chrome.storage.local.get("settings");
  $serverUrl.value = stored.settings?.serverUrl || DEFAULT_SERVER;
  $agentSecret.value = stored.settings?.agentSecret || "";
  // Signing out of Brotto Cloud sends the user back here (signOutOfCloud),
  // and a brand-new install has nothing stored at all — both open on the
  // cloud radio. An install that already stored a self-host address opens on
  // the radio it chose. This is a pre-fill of a form control, not the panel's
  // mode test — the panel reads auth_mode off the server, never this string.
  const opening = initialEdition(stored.settings?.serverUrl);
  $editionCloud.checked = opening === "cloud";
  $editionSelf.checked = opening === "self";
  applyEdition();
  // After the pre-fill, not before it. Loading the catalogue from a module
  // body read an empty field and so asked localhost on every install,
  // including the ones whose server was somewhere else entirely.
  await loadCatalog();
  show(1);
})();