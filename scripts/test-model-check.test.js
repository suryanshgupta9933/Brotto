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
          get: async (key_) => {
            if (key_ === "deviceId") return {};
            if (key_ === "settings") return { settings: { agentSecret: "s3cret-for-the-test" } };
            return stored;
          },
          set: async () => {},
        },
        session: { get: async () => ({ modelApiKey: key }) },
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers || {} });
      return handler(calls.length);
    },
    MODEL_CHECK_TITLE: {},
    MODEL_CHECK_TTL_MS: 600000,
    modelCheckPass: null,
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
  vm.runInContext(extract("checkModelReady"), sandbox);
  vm.runInContext(extract("deviceId"), sandbox);
  vm.runInContext(extract("authHeaders"), sandbox);
  return { calls, sandbox, run: () => vm.runInContext("checkModelReady()", sandbox) };
}

const jsonResponse = (content) => ({ ok: true, json: async () => content });

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

async function main() {
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
    const { calls, run } = panelWith(() => jsonResponse({ ok: false, kind: "auth_failed", error: "no" }));
    await run(); await run();
    // Caching a failure would leave a user who just fixed the key still
    // blocked for the length of the TTL — worse than not caching at all.
    check("a failure is re-probed, never cached", calls.length === 2, `${calls.length} fetches`);
  }
  {
    // A user who swaps providers must not be let through on the old answer.
    const { sandbox, run } = panelWith(() => jsonResponse({ ok: true, model: "anthropic:claude-sonnet-5-5" }));
    await run();
    sandbox.modelCheckPass.sig = "openai:gpt-5.6-sol|k";
    check("a different config is a different check", (await run()).model === "anthropic:claude-sonnet-5-5");
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

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main();
