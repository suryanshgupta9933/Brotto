// A task must not start on a model that cannot run it.
//
// The failure this pins is an *absence* twice over. `sidepanel.js` had no
// pre-flight at all, so an expired key or an empty balance reached the user as
// a run that died after the first step with the reason buried in a failure
// bubble. And the one guard that did exist — the "no model chosen" notice —
// was a warning printed *after* the run had already been committed, so it read
// as an aside to a task that was about to fail.
//
// `checkModelReady` is extracted from the shipping panel by brace matching and
// run against a fake fetch, so this cannot drift. The call site itself is
// asserted on the source, because what matters there is *ordering* — after the
// steer and clarify branches, before anything that latches a run into being —
// and ordering is invisible in a return value.
//
//   node scripts/test-model-check.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const credential = fs.readFileSync(path.join(SRC, "credential.js"), "utf8");
const mainPy = fs.readFileSync(
  path.join(__dirname, "..", "services", "brotto-orchestrator",
            "src", "brotto_orchestrator", "main.py"), "utf8");

function extract(name, src = panel) {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")" && --parens === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/** A panel whose fetch answers with whatever the test hands it. */
function panelWith(handler, stored = { modelConfig: { provider: "anthropic", model: "claude-sonnet-5-5", context_window: 1000000 } }, key = "sk-ant-x") {
  const calls = [];
  const writes = [];
  // A real storage, not a stub that answers every key with the same object:
  // the failure record is read and written by key, and a `get` that ignored
  // its argument would answer "no failure recorded" to a panel that had just
  // recorded one — which is the whole bug.
  const local = {
    modelConfig: stored.modelConfig,
  };
  if (key) local.modelApiKey = key;   // chrome.storage.local since #27
  if (stored.modelCheckFailure) local.modelCheckFailure = stored.modelCheckFailure;
  const sandbox = {
    console, Date, JSON, Promise, URL,
    plannerUrlEl: { value: "http://localhost:8000" },
    // deviceId() is real, extracted below: it is what the panel sends as the
    // server's caller key, so a stub here would let a dropped `device_id`
    // field pass.
    crypto: { randomUUID: () => "d3adb33f-0000-4000-8000-000000000001" },
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const want = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of want) {
              if (k === "settings") out.settings = { agentSecret: "s3cret-for-the-test" };
              else if (k in local) out[k] = local[k];
            }
            return out;
          },
          set: async (obj) => { writes.push(obj); Object.assign(local, obj); },
          remove: async (k) => { writes.push({ [k]: undefined }); delete local[k]; },
        },
        session: { get: async () => ({}) },
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers || {} });
      return handler(calls.length);
    },
    MODEL_CHECK_TITLE: {},
    MODEL_CHECK_TTL_MS: 600000,
    modelCheckPass: null,
    modelCheckFailure: null,
    // No banner element in this sandbox, so the renderer is inert — its
    // behaviour is pinned separately, against a real node.
    $modelCheckBanner: null,
    document: {
      createElement: () => ({
        className: "", textContent: "", innerHTML: "", type: "",
        listeners: {},
        addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      }),
    },
    renderMarkdown: (s) => s,
    settingsBtn: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // The real origin binding: authHeaders() asks it before every authenticated
  // call, so a stub would leave the rule untested on the one surface this
  // file also exercises. These settings have no recorded origin and the
  // address is loopback, which is the legacy case the rule has to allow.
  for (const fn of ["originOf", "isLoopback", "forUrl"]) {
    vm.runInContext(extract(fn, credential), sandbox);
  }
  sandbox.brottoCredential = { forUrl: sandbox.forUrl };
  sandbox.lastCredentialRefusal = '';
  vm.runInContext(extract("serverBase"), sandbox);
  sandbox.toast = () => {};
  // The real title table, so the banner tests read the strings that ship and
  // not a fixture that can drift from them.
  const titles = panel.match(/const MODEL_CHECK_TITLE = (\{[\s\S]*?\n\});/);
  if (!titles) throw new Error("no MODEL_CHECK_TITLE in sidepanel.js — renamed?");
  sandbox.MODEL_CHECK_TITLE = vm.runInContext(`(${titles[1]})`, sandbox);
  vm.runInContext(extract("modelCheckTitle"), sandbox);
  // The kind taxonomy *is* the record's lifetime, so it is read out of the
  // source rather than restated here — a fixture that drifted from the shipped
  // list would test a classification the panel does not use.
  const kinds = panel.match(/const TRANSIENT_CHECK_KINDS = new Set\(\[([\s\S]*?)\]\);/);
  if (!kinds) throw new Error("no TRANSIENT_CHECK_KINDS in sidepanel.js — renamed?");
  sandbox.TRANSIENT_CHECK_KINDS = vm.runInContext(`new Set([${kinds[1]}])`, sandbox);
  vm.runInContext(extract("modelCheckFailureStale"), sandbox);
  vm.runInContext(extract("modelCheckSig"), sandbox);
  vm.runInContext(extract("renderModelCheckBanner"), sandbox);
  vm.runInContext(extract("setModelCheckFailure"), sandbox);
  vm.runInContext(extract("failModelCheck"), sandbox);
  vm.runInContext(extract("checkModelReady"), sandbox);
  vm.runInContext(extract("deviceId"), sandbox);
  vm.runInContext(extract("authHeaders"), sandbox);
  return {
    calls, writes, sandbox, local,
    run: () => vm.runInContext("checkModelReady()", sandbox),
    /** Render the banner from the record, against a fake node. */
    showBanner() {
      const host = bannerHost();
      sandbox.$modelCheckBanner = host;
      vm.runInContext("renderModelCheckBanner()", sandbox);
      return host;
    },
  };
}

const jsonResponse = (content) => ({ ok: true, json: async () => content });

/** A stand-in for #modelCheckBanner, with the three append paths render uses. */
function bannerHost() {
  const host = {
    hidden: true, children: [], textContent: "",
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.children.push(c)); },
  };
  return host;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

async function main() {
  // The sig the shipped modelCheckSig produces for this sandbox: no base_url,
  // the server the fake panel points at, and a key present in session storage.
  // Written out rather than computed by calling modelCheckSig, because a
  // fixture built from the function under test cannot fail when that function
  // stops covering a field.
  const CFG = { provider: "anthropic", model: "claude-sonnet-5-5" };
  const SIG_K = "anthropic:claude-sonnet-5-5||http://localhost:8000|k";
  const SIG_NOKEY = "anthropic:claude-sonnet-5-5||http://localhost:8000|nokey";

  // ── Failures that must stop the task ──────────────────────────────────────
  {
    const { run } = panelWith(() => jsonResponse(
      { ok: false, kind: "auth_failed", error: "Your API key was rejected by the provider (HTTP 401)." }));
    const r = await run();
    check("a rejected key blocks the run", r.ok === false);
    check("…and says the key was rejected", r.kind === "auth_failed");
    check("…passing the server's own sentence through",
      /HTTP 401/.test(r.body), r.body);
  }
  {
    const { run } = panelWith(() => jsonResponse(
      { ok: false, kind: "no_credits", error: "no credit left — top up" }));
    const r = await run();
    check("an empty balance blocks the run", r.ok === false && r.kind === "no_credits");
    check("…with the provider's wording", r.body === "no credit left — top up");
  }
  {
    const { run } = panelWith(() => jsonResponse({ ok: false, kind: "no_model", error: "No model configuration available. Set AGENT_MODEL." }));
    const r = await run();
    check("no model at all blocks the run", r.ok === false && r.kind === "no_model");
    // The resolver's message names env vars and frame fields. Accurate for an
    // operator, unusable for the person reading the panel, and it is the only
    // message this path can produce — so it has to be replaced, not forwarded.
    check("…and does not show the user the resolver's env-var text",
      !/AGENT_MODEL|task_start|env var/i.test(r.body), r.body);
    check("…and points at the screen where it can be fixed",
      /Settings/.test(r.body), r.body);
  }
  {
    const { run } = panelWith(() => jsonResponse({ ok: false, kind: "unknown_model", error: "gpt-4o is not a model Brotto knows about." }));
    const r = await run();
    check("an unknown model blocks the run", r.ok === false && r.kind === "unknown_model");
  }
  {
    const { run } = panelWith(() => jsonResponse({ ok: false, kind: "unreachable", error: "could not reach the provider" }));
    const r = await run();
    check("an unreachable provider blocks the run",
      r.ok === false && r.kind === "unreachable");
  }

  // ── The check itself failing is NOT the model's fault ─────────────────────
  //
  // The server being down has its own reporting — connect, reconnect, the
  // unreachable toast — and it already works. Routing a dead server through
  // this gate would replace "Server unreachable, retrying" with "your API key
  // was rejected", which sends the user to fix something that isn't broken.
  {
    const { run, calls } = panelWith(() => jsonResponse({ ok: true, model: "anthropic:claude-sonnet-5-5" }));
    check("a passing check starts the run", (await run()).ok === true);
    // The server keys the remembered model by this, not by the peer address
    // — a container sees the docker gateway. A dropped field is an absence,
    // and an absence reads clean in review.
    check("…and carries the install id so the server can key the user",
      calls[0].body.device_id === "d3adb33f-0000-4000-8000-000000000001",
      JSON.stringify(calls[0].body));
    // The route is behind AGENT_SECRET. Without this the check 404s and
    // `!res.ok` swallows it as "could not check", so a user on a prod server
    // silently stops having a pre-flight and is told everything is fine.
    check("…and the secret, or the server answers 404 and the gate is a no-op",
      calls[0].headers.Authorization === "Bearer s3cret-for-the-test",
      JSON.stringify(calls[0].headers));
  }
  {
    const { run } = panelWith(() => { throw new TypeError("failed to fetch"); });
    const r = await run();
    check("a server that cannot be reached does not block",
      r.ok === true, JSON.stringify(r));
  }
  {
    const { run } = panelWith(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await run();
    check("a 500 from the check endpoint does not block", r.ok === true, JSON.stringify(r));
  }
  {
    const { run } = panelWith(() => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
    check("an unparseable body does not block", (await run()).ok === true);
  }

  // ── The probe is not a per-task tax, and a failure is never remembered ────
  {
    const { calls, run } = panelWith(() => jsonResponse({ ok: true, model: "anthropic:claude-sonnet-5-5" }));
    await run(); await run(); await run();
    check("three sends in a row make one probe", calls.length === 1, `${calls.length} fetches`);
  }
  {
    // A failure is remembered, but not as a *cache*: it is a standing refusal
    // that the user has to clear by fixing something. Same config, so no
    // round-trip — and no way for the model to become usable by being quiet.
    const { calls, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }));
    await run();
    const second = await run();
    check("a recorded failure blocks without another probe", calls.length === 1, `${calls.length} fetches`);
    check("…with the same answer", second.ok === false && second.kind === "auth_failed");
  }
  {
    // The other half: a user who *fixed* the key must not still be blocked.
    // A user who clears the key must not be judged by a record that was
    // raised against the old one: the sig flips to `nokey`.
    const { calls, local, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }));
    await run();
    delete local.modelApiKey;   // the user cleared the key
    await run();
    check("a fixed key re-probes instead of serving the old refusal",
      calls.length === 2, `${calls.length} fetches`);
  }
  {
    // A user who swaps providers must not be let through on the old answer.
    const { sandbox, run } = panelWith(() => jsonResponse({ ok: true, model: "anthropic:claude-sonnet-5-5" }));
    await run();
    sandbox.modelCheckPass.sig = "openai:gpt-5.6-sol|k";
    check("a different config is a different check", (await run()).model === "anthropic:claude-sonnet-5-5");
  }

  // ── A stored failure has a lifetime; a standing one does not ──────────────
  //
  // The record used to be forever. One 5xx from a provider at save time left
  // the user unable to send a task at all — the only exit was re-saving, which
  // is not something anyone knows to try. The split is the taxonomy the probe
  // already draws: a kind a retry fixes expires on the same TTL as the pass
  // cache, and a kind only the user can fix keeps standing, because that is
  // the thing the banner is asking them to do.
  {
    for (const kind of ["rate_limited", "provider_error", "unreachable", "error"]) {
      const { calls, run } = panelWith(() => jsonResponse({ ok: true }),
        { modelConfig: CFG, modelCheckFailure: { kind, body: "blip", sig: SIG_K, at: Date.now() } });
      const r = await run();
      check(`a fresh ${kind} still blocks the run`, r.ok === false && r.kind === kind, JSON.stringify(r));
      check("…without re-probing", calls.length === 0, `${calls.length} fetches`);
    }
  }
  {
    for (const kind of ["rate_limited", "provider_error", "unreachable", "error"]) {
      const { calls, local, run } = panelWith(() => jsonResponse({ ok: true, model: "anthropic:claude-sonnet-5-5" }),
        { modelConfig: CFG, modelCheckFailure: { kind, body: "blip", sig: SIG_K, at: Date.now() - 600001 } });
      const r = await run();
      check(`a ${kind} past the TTL re-probes instead of blocking`,
        calls.length === 1 && r.ok === true, `${calls.length} fetches ${JSON.stringify(r)}`);
      // The clear is fire-and-forget inside checkModelReady; await a turn so
      // this asserts the write rather than racing it.
      await new Promise((res) => setImmediate(res));
      check("…and the spent record is cleared", !local.modelCheckFailure,
        JSON.stringify(local.modelCheckFailure));
    }
  }
  {
    // One second inside the TTL is still an answer. A TTL that expired at the
    // first send would just be "never cache a failure", which the standing
    // kinds below are the whole reason not to do.
    const { calls, run } = panelWith(() => jsonResponse({ ok: true }),
      { modelConfig: CFG, modelCheckFailure: { kind: "rate_limited", body: "blip", sig: SIG_K, at: Date.now() - 599000 } });
    check("a transient failure inside its TTL still blocks", (await run()).ok === false);
    check("…with no probe", calls.length === 0, `${calls.length} fetches`);
  }
  {
    // The standing half: these do not expire, and that is the feature. A
    // rejected key stays rejected until the user pastes a working one, and a
    // retry cannot change that.
    for (const kind of ["auth_failed", "no_credits", "no_model", "unknown_model",
                        "a_kind_this_build_predates"]) {
      const { calls, run } = panelWith(() => jsonResponse({ ok: true }),
        { modelConfig: CFG, modelCheckFailure: { kind, body: "no", sig: SIG_K, at: Date.now() - 86400000 } });
      const r = await run();
      check(`${kind} still blocks a day later`, r.ok === false && r.kind === kind, JSON.stringify(r));
      check("…with no probe", calls.length === 0, `${calls.length} fetches`);
    }
  }
  {
    // A record from before this field existed: transient by kind, unmeasured
    // by age. Re-probed rather than trusted — standing kinds are unaffected
    // because they never consult `at`.
    const { calls, run } = panelWith(() => jsonResponse({ ok: true }),
      { modelConfig: CFG, modelCheckFailure: { kind: "unreachable", body: "blip", sig: SIG_K } });
    check("an unmeasured transient record is re-probed", (await run()).ok === true && calls.length === 1);
    const held = panelWith(() => jsonResponse({ ok: true }),
      { modelConfig: CFG, modelCheckFailure: { kind: "auth_failed", body: "no", sig: SIG_K } });
    check("…while an unmeasured standing one still holds", (await held.run()).ok === false);
  }
  {
    const { sandbox } = panelWith(() => jsonResponse({ ok: true }));
    check("the transient list is the four retryable kinds and nothing else",
      [...sandbox.TRANSIENT_CHECK_KINDS].sort().join(",")
        === "error,provider_error,rate_limited,unreachable",
      [...sandbox.TRANSIENT_CHECK_KINDS].join(","));
  }

  // ── The sig covers the two things a changed answer rides on ───────────────
  {
    const src = extract("modelCheckSig");
    check("the sig carries the base URL", /cfg\.base_url/.test(src), src);
    check("…and the server the probe is sent to", /plannerUrlEl/.test(src), src);
  }
  {
    // A self-hoster re-pointing an OpenAI-compatible endpoint is asking a
    // different question with the same provider and model.
    const at_a = { provider: "openai", model: "local", base_url: "http://a.example/v1" };
    const at_b = { provider: "openai", model: "local", base_url: "http://b.example/v1" };
    const { calls, local, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }),
      { modelConfig: at_a });
    await run();
    check("…and a re-pointed base URL re-arms the check", (await run()).ok === false && calls.length === 1);
    local.modelConfig = at_b;
    await run();
    check("…changing it probes again instead of serving the old answer",
      calls.length === 2, `${calls.length} fetches`);
  }
  {
    // Which server you ask is part of the question too — a different relay
    // may resolve a different model or refuse a different credential.
    const { calls, sandbox, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }));
    await run();
    sandbox.plannerUrlEl.value = "http://elsewhere:9000";
    await run();
    check("…and a changed server URL re-arms the check", calls.length === 2, `${calls.length} fetches`);
  }
  {
    // A trailing slash is the same address, not a new one.
    const { calls, sandbox, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }));
    await run();
    sandbox.plannerUrlEl.value = "http://localhost:8000/";
    await run();
    check("a trailing slash is not a different server", calls.length === 1, `${calls.length} fetches`);
  }

  // ── What goes over the wire ───────────────────────────────────────────────
  {
    const { calls, run } = panelWith(() => jsonResponse({ ok: true }));
    await run();
    check("the probe goes to /v1/model/check",
      calls[0].url === "http://localhost:8000/v1/model/check", calls[0].url);
    check("…sending the stored config and the key, like task_start does",
      calls[0].body.model_config.provider === "anthropic"
      && calls[0].body.api_key === "sk-ant-x");
  }
  {
    // The panel sends `{provider: ""}` until Settings is opened. Forwarding an
    // empty config is what once made the server refuse the task outright.
    const { calls, run } = panelWith(() => jsonResponse({ ok: true }), {}, undefined);
    await run();
    check("a browser with no model sends no config at all",
      calls[0].body.model_config === undefined, JSON.stringify(calls[0].body));
  }

  // ── The call site, on the source ─────────────────────────────────────────
  //
  // Ordering is the whole correctness of this gate and it is invisible in a
  // return value: a check before the steer branch would refuse a mid-run
  // correction, and a check after the transcript is cleared would leave the
  // user staring at an empty panel with their task gone.
  {
    const sendStart = panel.indexOf("async function sendUserMessage()");
    const sendEnd = panel.indexOf("\nasync function ", sendStart + 10);
    const body = panel.slice(sendStart, sendEnd > 0 ? sendEnd : undefined);
    const at = (needle) => body.indexOf(needle);

    check("sendUserMessage is where the gate is", at("await checkModelReady()") > 0);
    check("the gate comes after the steer branch",
      at("await checkModelReady()") > at("'send_to_server'"),
      "a steer is a correction to a running task, not a new run to pre-flight");
    check("the gate comes after the clarify branch",
      at("await checkModelReady()") > at("answerPendingClarify(text)"));
    check("the gate comes after the in-flight guard",
      at("await checkModelReady()") > at("if (state.taskInFlight) return;"));
    check("nothing has latched a run into being before the gate",
      at("await checkModelReady()") < at("state.taskInFlight = true"),
      "a refusal has to leave no clock, no transcript, nothing to stop");
    check("the gate runs before the transcript is cleared",
      at("await checkModelReady()") < at("clearMessages("));
    check("a refusal returns without sending",
      /await checkModelReady\(\);\s*\n\s*if \(!check\.ok\) \{[\s\S]*?return;\s*\n\s*\}/.test(body));
    // lastIndexOf, not indexOf: the clarify branch above clears the box too,
    // so the first match is on the wrong side of the gate.
    check("a refusal leaves the user's words in the box",
      body.lastIndexOf("goalEl.value = ''") > at("await checkModelReady()"),
      "the fix is a settings change; making them retype the task to apply it ends the attempt");
    check("the warn-only bubble is gone, replaced by the gate",
      !/title: 'No model chosen in this browser'/.test(panel));
  }

  // ── The server side, on the source ────────────────────────────────────────
  {
    check("the endpoint exists", /@app\.post\("\/v1\/model\/check"\)/.test(mainPy));
    check("it resolves through the same three tiers task_start uses",
      mainPy.includes("resolve_model_config(client_host, inline_config, inline_creds)"));
    check("and builds the model the same way",
      /factory\.build\(cfg\.model, creds\)/.test(mainPy));
    // A check that never calls anything answers ok for every key ever typed,
    // including the wrong one.
    check("it actually calls the provider", /await model\.request\(/.test(mainPy));
    check("the payload is parsed by the one shared parser",
      /def _inline_model\(/.test(mainPy)
      && (mainPy.match(/_inline_model\(/g) || []).length >= 4,
      "three call sites parsing the shape separately is how a check ends up ok for a config the run refuses");
    check("a 400 about money is classified as no_credits",
      /_CREDIT_HINTS/.test(mainPy) && /"no_credits"/.test(mainPy));
    check("a transport failure is unreachable, not a bad key",
      /httpx\.TransportError/.test(mainPy));
  }

  // ── The failure outlives the panel ───────────────────────────────────────
  //
  // The moment a bad model matters is the moment the panel is *closed*: the
  // user saved a config, saw it save, typed a task in a panel they had closed
  // and reopened. An in-memory record is gone by then, and the whole feature
  // is the gap between "saved" and "first task".
  {
    const { local, writes, run } = panelWith(() => jsonResponse(
      { ok: false, kind: "auth_failed", error: "Your API key was rejected by the provider (HTTP 401)." }));
    const r = await run();
    check("a failure is written to storage", !!local.modelCheckFailure,
      JSON.stringify(local.modelCheckFailure));
    check("…with the kind the banner titles itself from",
      local.modelCheckFailure.kind === "auth_failed");
    check("…the provider's own sentence", /HTTP 401/.test(local.modelCheckFailure.body));
    // The full sig, written out: provider, model, base URL, server, key
    // presence. A sig that quietly dropped a field would still end in `|k`.
    check("…and the sig it was raised under, so a changed config is a different failure",
      local.modelCheckFailure.sig === r.sig && r.sig === SIG_K, r.sig);
    check("…into local, not session — it has to outlive the panel",
      /modelCheckFailure/.test(JSON.stringify(writes)));
  }
  {
    // session storage is emptied by a browser restart; a refusal has to
    // survive that, because the restart is usually what the user did to try
    // to fix it.
    check("the record is not written to chrome.storage.session",
      !/session\.set\(\{\s*modelCheckFailure/.test(panel));
  }
  {
    // A pass is the only thing that clears a standing refusal.
    let answer = { ok: false, kind: "auth_failed", error: "no" };
    const { local, run } = panelWith(() => jsonResponse(answer));
    await run();
    check("the failure is standing", !!local.modelCheckFailure);
    answer = { ok: true, model: "anthropic:claude-sonnet-5-5" };
    const { local: l2, run: r2 } = panelWith(() => jsonResponse(answer),
      { modelConfig: CFG,
        modelCheckFailure: { kind: "auth_failed", body: "no", sig: SIG_K } },
      null);   // the record was raised under a key this browser no longer
              // holds — `null`, not `undefined`, which a default parameter
              // would silently swap back for the key
    const fixed = await r2();
    check("a passing check lets the run start", fixed.ok === true);
    // The write is fire-and-forget inside checkModelReady; await a turn so it
    // is not racing the assertion rather than absent.
    await new Promise((res) => setImmediate(res));
    check("…and clears the standing failure", !l2.modelCheckFailure,
      JSON.stringify(l2.modelCheckFailure));
  }

  // ── The banner ───────────────────────────────────────────────────────────
  {
    const { sandbox, showBanner } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "HTTP 401" }));
    await vm.runInContext("checkModelReady()", sandbox);
    const host = showBanner();
    const text = host.children.map((c) => c.textContent || c.innerHTML).join(" | ");
    check("the banner shows for a stored failure", host.hidden === false);
    check("…the title for the kind", /Your API key was rejected/.test(text), text);
    check("…the provider's sentence beneath it", /HTTP 401/.test(text), text);
    check("…and the place it can be fixed",
      host.children.some((c) => c.textContent === "Settings → Model"), text);
  }
  {
    const { showBanner } = panelWith(() => jsonResponse({ ok: true }));
    const host = showBanner();
    check("no failure, no banner", host.hidden === true);
  }
  {
    // A kind the server ships ahead of this build. An unknown kind must still
    // produce a sentence — `MODEL_CHECK_TITLE[kind] || …` appears in two places
    // and neither may be undefined.
    const { sandbox, showBanner } = panelWith(() => jsonResponse(
      { ok: false, kind: "something_new", error: "the provider is down" }));
    sandbox.MODEL_CHECK_TITLE = {};
    vm.runInContext(extract("modelCheckTitle"), sandbox);
    await vm.runInContext("checkModelReady()", sandbox);
    const host = showBanner();
    const text = host.children.map((c) => c.textContent || c.innerHTML).join(" | ");
    check("an unknown kind still renders a sentence",
      /The model could not be used/.test(text), text);
    check("…and the server's body still reaches the user", /the provider is down/.test(text), text);
  }
  {
    // The kind the sibling server change adds, pinned here so the title
    // exists the moment it ships rather than after.
    check("there is a title for a provider 5xx",
      /provider_error:\s*'/.test(panel));
  }
  {
    // The generic `error` kind stops echoing raw provider text, so the record
    // can legitimately arrive with no body at all. The title is already a
    // complete sentence; what must not happen is the word "undefined".
    const { sandbox, showBanner } = panelWith(() => jsonResponse({ ok: false, kind: "error", error: "x" }));
    sandbox.modelCheckFailure = { kind: "error", sig: SIG_K, at: Date.now() };   // no body
    const host = showBanner();
    const text = host.children.map((c) => c.textContent || c.innerHTML).join(" | ");
    check("a record with no body renders nothing undefined", !/undefined/.test(text), text);
    check("…the title alone still says what happened",
      /The model could not be used/.test(text), text);
    check("…and no empty body line is left standing", host.children.length === 2, text);
  }

  // ── The restart trap ─────────────────────────────────────────────────────
  //
  // The API key's presence is part of the sig. A record raised against a key
  // the user has since cleared would leave "your API key was rejected"
  // standing over a panel that no longer has one — worse than saying nothing,
  // so the sig is compared on every render.
  {
    panelWith(() => jsonResponse({ ok: true }), {
      modelConfig: CFG,
      modelCheckFailure: { kind: "auth_failed", body: "no", sig: SIG_K },
    }, null);   // no key stored — the user cleared it
    check("the sig counts the presence of a key, not the key",
      /apiKey \? 'k' : 'nokey'/.test(extract("modelCheckSig")), extract("modelCheckSig"));
    check("the key is not in the sig itself",
      !/sk-ant-x/.test(extract("modelCheckSig")));
  }
  {
    const { calls, run } = panelWith(() => jsonResponse({ ok: true }), {
      modelConfig: CFG,
      modelCheckFailure: { kind: "auth_failed", body: "no", sig: SIG_NOKEY },
    }, null);   // no key — and the record already says nokey
    check("a record that still matches its browser still blocks",
      (await run()).ok === false);
    check("…without a probe", calls.length === 0, `${calls.length} fetches`);
  }
  {
    // refreshModelCheckBanner is what runs on open; it must clear a record
    // whose sig no longer describes this browser.
    const p = panelWith(() => jsonResponse({ ok: true }), {
      modelConfig: CFG,
      modelCheckFailure: { kind: "auth_failed", body: "no", sig: SIG_K },
    }, null);
    p.sandbox.$modelCheckBanner = bannerHost();
    vm.runInContext(extract("refreshModelCheckBanner"), p.sandbox);
    await vm.runInContext("refreshModelCheckBanner()", p.sandbox);
    check("a browser restart clears the banner rather than leaving it standing",
      !p.local.modelCheckFailure && p.sandbox.modelCheckFailure === null,
      JSON.stringify(p.local.modelCheckFailure));
    check("…and hides the strip", p.sandbox.$modelCheckBanner.hidden === true);
  }

  // ── Save probes ──────────────────────────────────────────────────────────
  //
  // A save that cannot check what it just saved is a save that fails on the
  // user's first task, with the reason a screen away from where they were
  // looking. Asserted on the source because the ordering is the point and
  // ordering is invisible in a return value.
  {
    const saveStart = panel.indexOf("if ($modelSave) {");
    const saveBody = panel.slice(saveStart, panel.indexOf("\n}", saveStart));
    const at = (n) => saveBody.indexOf(n);
    check("save writes the config before it probes",
      at("modelConfig:") > 0 && at("modelCheckPass = null") > at("modelConfig:"));
    check("…drops the cached pass before probing",
      at("modelCheckPass = null") < at("await checkModelReady()"));
    // The deadlock this closes: the gate short-circuits a stored refusal so a
    // send costs no round-trip, so without this the save's own probe would read
    // the refusal it is meant to replace and a user who pasted a corrected key
    // would never be unblocked. The sig cannot see the key's value, so the save
    // is the only place that re-arms.
    check("…and clears the standing failure, or the save probes its own refusal",
      at("await setModelCheckFailure(null)") > 0
      && at("await setModelCheckFailure(null)") < at("await checkModelReady()"), saveBody);
    check("save says it is checking", /Checking…/.test(saveBody), saveBody);
    check("…and says what happened",
      /'✗ Saved — the model could not be used\.'/.test(saveBody), saveBody);
    check("a failing save does not claim Saved.",
      /check\.ok \? 'Saved\.' : /.test(saveBody), saveBody);
  }
  {
    check("the send gate is the only call site that blocks a task on the model",
      (panel.match(/await checkModelReady\(\)/g) || []).length === 2,
      "one in the save handler, one in sendUserMessage");
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main();
