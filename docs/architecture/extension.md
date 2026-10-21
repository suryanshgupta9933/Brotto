# Extension runtime: storage, policy, notifications, debugger

Read before touching `clients/brotto-extension/src/{background,debugger}.ts`,
`policy/`, or notification behaviour.

## Extension storage

- `model_config` (provider, model, context_window) → `chrome.storage.local` — persists across browser restarts (not sensitive). **On the cloud path the key name carries the account id** — `modelConfig:<id>` / `modelApiKey:<id>` — so two accounts in one Chrome profile cannot share a provider, a model or a credential; with no id they are the flat keys, byte-identical to every install from before accounts existed. `panel-ui.md` owns the rule and the deliberate non-migration; `model_keys.js` (panel + wizard) and `model_config.ts` (worker) are two copies pinned by one table in `scripts/test-model-keys.test.js`.
- `api_key` → `chrome.storage.local` — persists across restarts by choice. It was `storage.session` (cleared on browser restart) and every restart cost the user a re-paste for no benefit: the key never leaves the device. Clearing is the user's call, from Settings. Account-scoped as above.
- `accountId` (a top-level `chrome.storage.local` key, **not** a field in `settings` — a field would mean rebuilding the whole blob after an await and clobbering a concurrent settings edit; `settings.accountId` is read once as a legacy fallback and migrated). The opaque uuid `account_id` names, or absent. **Written straight from a server response and never derived from the token** — `welcome.js` `exchangeCode` takes it off the `exchange` reply and the panel re-learns it through `learnAccountId()`. It is an identifier, not user content: nothing derived from an AX tree, page text, a URL, typed input or a task title reaches it, and it lands in no operator table, so it is safe unencrypted. Sign-out and the expired-credential sweep delete it with the token, and with it that account's `modelApiKey:<id>`, `modelConfig:<id>` and mirrored rows.
- The first read after an extension update runs a one-shot migration that re-saves any legacy `{modelConfig: {model_config, api_key}}` shape into the new layout. **That legacy blob only ever sat under the flat key** — a self-hoster's, since it predates accounts — so this migration is a self-host path and does not contradict the non-migration below it.
- `deviceId` (one `crypto.randomUUID()`) → `chrome.storage.local`. See below; it is not a credential and nothing authenticates with it.
- `settings.onboarded` and `settings.setupDeferred` → `chrome.storage.local`. Two booleans, one written by the wizard's Start and one by its Skip; see "Three setup facts" below for what each is allowed to decide.
- `settings.agentSecret` → `chrome.storage.local`, and on the Brotto Cloud path it holds an **opaque Supabase access token**, not a shared secret. **The extension never parses it.** Not its length, not its prefix, not whether it looks like a JWT. One slot is why an account tier needed no new storage key and no migration, and any code that inspects the value reinstates the coupling the slot exists to remove. Both writers (the wizard, the panel's Settings) and the one reader (`agentSecret()`) treat it as a string.

## Which Brotto is this comes from `/health`, never from the URL

`authedWs` is handed a `secret` and does not know or care what kind it is. The
panel decides which *UI* to render from `auth_mode` on `GET /health`
(`open` | `secret` | `jwt`), because that is the only one of the three the
**server** can answer authoritatively.

**Do not reintroduce a comparison against the server URL.** `HOSTED_SERVER_URL`
was compared against the address the user typed, so a trailing slash, a typed
`http://` or a case difference each read as self-host. A string comparison
against user-entered text is a guess wearing a constant's clothes. The
remaining `CLOUD_SERVER_URL` is a *default value* — what a blank field resolves
to once the server has said `jwt` — and not a mode test.

The wizard's first step asks the same question with a radio rather than a
server, because a radio is a person's answer and `/health` is the machine's.
Cloud writes the address into a read-only input and requires a sign-in **before
advancing**: it is the one step in the wizard that can fail, and it fails there
rather than writing a token nobody holds.

**The same probe answers "is the server there".** `refreshAuthMode()` already
fetches `/health` on panel open and on every address edit, so `state.
serverReachable` is the settled answer to whether that fetch answered — no
second ping, no new endpoint, no timer. **`authMode` cannot carry it**: it is
null while the probe is in flight and null again when the server answers without
an `auth_mode`, so a banner keyed on null would flash on every panel open. This
one is `true`/`false` and never null.

It renders as `serverBanner`, the sibling of the model-check banner above the
composer — a standing condition, not part of what happened in a run — with a
**Try again** button that re-probes and a **Set up Brotto** button that returns
to `welcome.html`. Re-probing on demand and on panel open is the whole re-check
policy; a timer would ping an address that has not changed since the open, and
`/health` is already fetched for every send that matters.

## Three setup facts, and only three

`settings.onboarded` is written by `finish()` on Start **and on Skip**, so on
its own it cannot tell "finished" from "deliberately not yet". The Skip path
therefore writes exactly one more fact — **`settings.setupDeferred`**, written
there and by nothing else, and read by exactly one banner. There is no setup
state machine and no third state.

- **The banner is silent when `setupDeferred` is set.** "My server is not up
  yet" is not "my server went down", and repeating the first every session is
  what teaches someone to ignore the second.
- **The banner is also silent when `onboarded` is unset**, because a browser
  that never answered the wizard is on its way to `welcome.html` rather than
  reading a card.
- **Panel boot returns to `welcome.html` whenever `onboarded` is unset.** That
  one rule covers the toolbar action, a reloaded extension and a cleared
  profile alike, and it is the same gate that keeps a finished setup off the
  wizard.

`loadSetupState()` reads both once per panel open and `refreshAuthMode()` calls
`paintServerBanner()`, so the banner cannot disagree with the probe it speaks
from. Pinned by `scripts/test-setup-state.test.js`.

## The install id is the user; the peer address never was

The server stores two things per user: their blocklist and approved domains
(`logs/user_policies/`) and their remembered model config (`logs/user_models/`).
Both are **keyed by an opaque string that becomes a filename**, and for its
whole life that string was `websocket.client.host`.

It is not an identity. Two ways it fails, both silent:

- A laptop joins a different network and gets a new address. Every approval
  the user gave last week is still on disk, under a key they have never seen,
  and the panel shows them an empty list.
- **The server runs in a container.** Every request arrives from the docker
  gateway, so it is at least *stable* — and the user migrates from a local
  `python main.py`, where the key was their real address, and silently lands
  in a different file with the same behaviour. This is not hypothetical: it is
  the documented deployment.

So the extension generates one uuid per install and sends it. The server
prefers it everywhere (`_caller_key` in `main.py`) and falls back to the peer
address when it is absent, so an extension predating this keeps working. Four
routes resolve one — `task_start` over the WebSocket, and `device_id` on
`/v1/model/check`, `user_id` on `/v1/policy` and `/v1/policy_ack`. They have to
agree: `/v1/policy` reads the in-memory registry, so a panel asking under one
key while the socket wrote under another gets an empty blocklist with a 200.

**The uuid is not a credential, and the routes carrying it are gated.** It
arrives in a request body on routes that were unauthenticated when this landed,
and it goes into a log field, an audit key and a filename — so the format is
enforced, not merely documented: anything that is not a uuid is not an
identity claim worth honouring and falls back to the address. That closes
forged log lines, but *unguessable* is a weaker property than
*authenticated*, so `/v1/policy`, `/v1/policy_ack`, `/v1/model/check` and
`/v1/suggestions` now check `AGENT_SECRET` like `/v1/sessions` did. Without the
gate an unauthenticated caller could write a policy file under any key they
liked, one per request — a way to fill a disk, and a way to edit a blocklist
they had guessed the id for.

**Session history is not affected** — `logs/sessions/` is not keyed by caller
at all, which is why it migrates to a container untouched.

### The two other caller-controlled strings got the same guard, one field over

Hardening `device_id` and leaving its siblings alone closed a door on four
routes while the same primitive stood open next to it. There are exactly two,
and both are **id-shaped strings that become a log field and a filename**:

- **`session_id`, from the `/ws/ext/{session_id}` path.** Worse than
  `device_id`, because it is *in the url*: the guard has to run before the
  auth check, since the rejection log line already interpolates it. A
  `task_start` then carried it into `AuditTrail`, whose `__init__` builds
  `f"{session_id}.json"` with no validation — `read` and `delete` both guard
  with `_is_document_stem`, the write never did. So `/ws/ext/aaa%0aINFO%3A%20forged`
  let an **unauthenticated** caller forge operator log output and name a file
  under `logs/sessions/`. Now closed with the same `_UUID` the install id
  uses, since `POST /v1/sessions` mints uuid4 and nothing else is legitimate.
  Closed `4004`, distinct from the secret's `4001` so a valid id and a valid
  credential stay distinguishable.
- **CORS.** `allow_origins=["*"]` **with** `allow_credentials=True` makes
  Starlette echo the caller's `Origin`, so **any page the operator visited
  could read the transcript** on a secret-less install — a simple
  `GET /v1/sessions` needs no preflight and no secret. The documented
  mitigation ("compose binds 127.0.0.1") does not apply: a browser reaches
  loopback fine. Gating the four routes did not help, same data by another
  door. The only legitimate cross-origin client is the extension, whose origin
  is `chrome-extension://<id>` with a Chrome id (`[a-p]{32}`), plus loopback
  for the dev panel. Credentials are off: every call authenticates with the
  `AGENT_SECRET` header, never a cookie.

`_is_document_stem` would not have been enough for either — it rejects paths
and dots, but `"aaa\nINFO".isprintable()` and no dot means a newline rides
straight into the log. That is why the guard is the uuid regex and not the
filesystem predicate.

**Tests cannot use readable session ids in a url any more.** `session_id` in
`tests/conftest.py` mints a uuid5 from a label, so the label survives in the
test name. Assert the *close code*, not `raises(WebSocketDisconnect)` — with no
secret offered every id is refused anyway, so the exception alone passes
against an unfixed server.

The two functions are duplicated across `background.ts` and `sidepanel.js`
because those are two separate bundles (the service worker is bundled by
esbuild, the panel is copied verbatim). They must read the same storage key,
and only one of the two ever writes it.

### A semantic scan found the guard nobody was asserting

`read` and `delete` have always rejected a `session_id` that is not a bare,
dot-free token. **`append_policy_event` did not**, and nothing tested it, so
the gap was invisible to review — the sibling functions a few lines away all
guarded, which is exactly what makes an omission read as correct. It was
CodeQL tracing `session_id` into a filesystem write that named it.

The shape matters more than the bug. It **read-modify-writes**, and its
`exists()` only admits a file that is *already there* — so it was not a
write-anywhere primitive, it was a rewrite-whatever-JSON-lives-above-
`logs/sessions/` one. `../../..` reaches the server root. The panel's Save and
`POST /v1/policy_ack` both supply the id. It is now closed with the same
`_is_document_stem` the other two use, asserted by
`test_a_traversing_session_id_writes_no_policy_event` — a test that writes a
victim file one level up and asserts it is byte-identical afterwards. Removing
the guard makes it fail, which is how the guard is known to be load-bearing.

The companion finding was in `read`: the `except` branch returned
`str(OSError)` as the error `message`, and that string is the **absolute path**
of the file that failed to open — served over HTTP by
`GET /v1/sessions/{id}/audit` to whoever holds `AGENT_SECRET`, handing out the
server's directory layout one failure at a time. A `JSONDecodeError` names a
line and column *inside the user's own file*, which is what they need to
repair it and says nothing about the host, so that one keeps its text.

### The deliberate diagnostic surface, and where it stops

CodeQL also reports `py/stack-trace-exposure` on `main.py`'s `_error`
envelope, and the finding is **kept, reviewed, suppressed** — because the
alternative is worse. Every route answers through `_error`, the caller already
holds `AGENT_SECRET`, and an operator debugging their own self-hosted server
cannot act on `Internal Server Error`. The rule is therefore **not "no message"
but "no credential"**: a handler writes its own sentence, and
`test_model_check_endpoint.py` asserts an API key is absent from the body.
That test is what makes the suppression honest — if someone grows a message
that quotes the key, a test fails, which is the signal a comment cannot give.

The one exception that was **fixed rather than suppressed** is the tail of
`_classify_probe_failure`. Every branch above it returns a sentence the
function itself wrote; the fallback was `str(exc)`, and a provider SDK's
message is precisely where the base URL, the resolved hostname and sometimes
a fragment of the key end up. That text is no longer written by a handler, so
the guarantee does not apply to it. It now returns the exception's **type
only** and points at the server log, which the caller has already been writing
in full one line above.

### Nine suppressions that suppressed nothing, and nine more that did the same

Every suppression written for this scan said `codeql[js/path-injection]` and
`codeql[js/stack-trace-exposure]`. The rules are **`py/`**. CodeQL matches a
suppression on the full rule id, so a wrong language prefix is not an error —
it is **silently inert**, and the scan still reports the alert.

Fixing the prefix moved nothing either. CodeQL reads a `codeql[...]` token only
on the line **immediately above** the alert: nine of ours *trailed* the alert
line, and three more were separated from it by prose. All thirteen were inert,
and `Analyze` stayed green through both rounds, because an open alert does not
fail the build.

This passed every check available at the time and still shipped wrong:

- `Analyze` was green, because an open alert does not fail the build.
- The comments were all present, each with a reason above it.
- Reading the diff shows thirteen deliberate suppressions.
- The prefix and the prose were both, individually, correct.

It only surfaced on the scan of the **merged** `main`, where the alerts came
back at their new line numbers — still open. Two properties of suppression make
this the default failure: it is invisible to review (the text is right there, and
looks right), and it is invisible to CI (the tool reports the same thing whether
or not it honoured the comment).

**A pull-request check on this repo surfaces no SARIF findings at all.** The
check run for the PR that merged with thirteen open alerts carries one
annotation — the ubuntu-latest runner notice — and `?ref=refs/pull/N/merge`
returns nothing. So a suppression cannot be checked before the merge that
reports it. The rule that follows is therefore not "be careful": **a suppression
is not applied until a scan of merged `main` reports the alert closed.** Verify
in the Security tab, on the merged ref. A comment is a claim; the tab is the
receipt.

**The one that should not have been suppressed at all.** `/v1/model/check`
returned `str(exc)` for the no-model case, putting the server's environment
variables and its resolution order into an HTTP body. The panel discards that
field — `sidepanel.js` treats `no_model` as its own case and never reads
`error` — so the disclosure reached a caller with no use for it and told the
person reading it nothing. Fixed with a constant string, with
`test_the_response_does_not_name_the_servers_environment` pinning it. A
suppression is the last resort, not the first: read the client before you mute
the scanner.

The remaining twelve are genuine. Ten are sinks behind `_is_document_stem` or
`_safe_filename` — the guard is a *predicate whose failure returns from the
function*, and the dataflow model does not connect a predicate to the return, so
`append_policy_event`, `read` and `delete` are all reported despite being
guarded. The other two are the deliberate diagnostic surfaces, `_error` and
`GET /v1/sessions/{id}/audit`, both behind `AGENT_SECRET`, where the rule is
*no credential* rather than *no message* and a test pins that instead. Each
comment says which of the three it is.

### The last one open was `delete`, and it was fixed rather than annotated

Alert #40 held `audit.py`'s `unlink` inside `delete`, and it was the only alert
left open in the repo, so it got the treatment the other eleven never did: the
sink was read, found **correct**, and the question became whether "correct" can
be *shown*. It can. `py/path-injection` is a two-state query —
`Path::PathNormalization` moves a path out of `NotNormalized`, and a
`startswith` guard bars it in `NormalizedUnchecked` — so normalise the candidate
and then require containment, and the sink is no longer reported. Measured
against 2.27.2, the version that raised the alert: 13 alerts before, 12 after,
and this one gone from the set.

Three things cost a step each, and none of them were visible in a diff:

- **`os.path.basename` is not a sanitizer this query models.** Two comments in
  `audit.py` asserted that it was, and reasoned onward from it. It is not — with
  `basename` in place and otherwise correct code, every one of these sinks is
  still reported. A comment asserting a tool's behaviour is a claim about the
  tool, not about the code.
- **The guard has to be positive.** `if not target.startswith(root): continue`
  bars nothing; the model wants the containment check on the branch that uses
  the path. The first attempt was shaped that way and fired anyway.
- **The normalisation has to be of the *tainted* value.** Normalising the root
  and joining a tainted basename onto it leaves that join in `NotNormalized`,
  which is the state the guard does not apply to.

`normpath` is the normalisation, not `realpath`: the query wants the tainted
path normalised, and `realpath` would follow a session document that is itself a
symlink and point the unlink at whatever it references instead. `normpath` is
textual — it collapses `..` and leaves links alone — and the directory is
resolved the other way round, with `realpath`, because a user's
`logs/sessions` is often a symlink and the comparison has to be against where
it really is. `test_delete_unlinks_the_link_not_the_file_behind_it` pins that
half, and was red before the change.

The containment check is defensive rather than load-bearing, and the code says
so: `basename` has already removed every separator, so containment holds by
construction. That is not a reason to leave it out. It is the property a reader
of the sink is owed, and it is the only form of "this is safe" that the one
tool here which asserts on sinks nobody enumerated is able to check at all.

**A predicate that returns and a check at the sink are different things**, and
the alert worth reading is the one that tells you which of the two you have.

## Domain blocking — one list, the user's

The blacklist is whatever the user typed in the panel, whole. There is no
server-side floor, no `policy.json`, no `merge()`.

There was a whole second code path for it and **it rendered nothing**: a
self-hosted install never shipped a `policy.json` for `load_policy()` to find,
so `FLOOR_POLICY` was always an empty `Policy`, and the panel's "Brotto refuses
these too" list always came back empty. Every three-way union
(`floor ∪ user ∪ ?`) and every "source: floor / server / user" label existed to
describe a distinction that never occurred. Deleted: `policy/config.py`,
`merge()`, `FLOOR_POLICY`, the `/health` `policy` key, the `source` block on
`/v1/policy`, and the panel's floor section.

`Policy` / `UserPolicy` stay, and `UserPolicy` is still a `Policy` subclass, so
an old policy file on disk with the removed `whitelist` / `block_blacklisted` /
`mode` fields still parses — pydantic 2 drops unknown fields rather than
rejecting them. That is pinned by `tests/test_policy_schema.py`.

## The mode was the policy engine, not a setting on it

`Policy` used to carry `mode: "normal" | "secure"`, and the mode gated
everything: `check_domain_policy` returned `n/a` unless the mode was secure, so
a user's blacklist **did nothing at all** until they opted in. Same for
first-time-seen prompts and the sensitive-action escalation. In normal mode
Brotto had no policy at all.

Two reasons that is the wrong shape, and neither is "it's more code":

- **The permissive path was the default, and the sibling's name framed the
  default as a downgrade.** For a product whose premise is that it drives the
  browser you are already logged into, the safe behaviour has to be the one you
  get without asking. A reviewer opening the Chrome Web Store listing saw a
  control that turns protections *on*.
- **The user's own blacklist was inert unless they found a second control.**
  The one setting the mode existed to gate was the one setting the mode made
  meaningless.

`Policy` is now `blacklist` + `sensitive_actions` + `approved_domains`, and every gate runs
unconditionally. `first_time_seen_prompt` was promoted to always-on and deleted.
The `deps.policy is not None` guards in `harness.py` **stay** — `AgentDeps.policy`
defaults to `None` and about twenty test files rely on it — and two of them were
load-bearing in a way that only showed up here: `check_domain_policy` and
`_guard_first_time_seen_blacklist` both dereferenced the policy unguarded, safe
only because the old mode check short-circuited first.

**The `main.py` half was the dangerous half**, and it reads as a no-op in a diff.
`/v1/policy_ack` and the WS `policy_acknowledged` handler built their persisted
snapshot as `{"mode": settings.get("mode"), ...}`. Once the client stopped
sending a mode that became `{"mode": None}`, `UserPolicy.model_validate` rejected
it, a bare `except Exception` swallowed the error, and the server served an empty
`Policy()` — **the user's saved blacklist vanished from the panel with nothing
logged anywhere.** When a field is removed from a wire payload, it has to leave
the dicts that build it, not merely stop arriving.

## Approving a site approves the site, and it outlives the run

The first-time-seen prompt used to be keyed on `(domain, action)`, so approving
one verb on a page approved nothing else on it. A run on a real page then asked
once per action type — read the text, click, type, scroll — and the user had to
approve the same site four times to watch it do one job. A user reported it as
"so many approvals as a user which is not right", and they were right: what the
user consents to is *a site*, not *a verb on a site*. The key is the eTLD+1 now.

Two things make that a real grant rather than a per-run cache:

- **`approved_domains` on the user's own policy file.** The grant is written by
  `persist.grant_domain` on approve and read back by `_seed_granted_domains` at
  the top of every run, into the `visited_domains` set that every domain gate
  already consults. The file is keyed by the caller's install id — the same key
  `/v1/policy_ack` uses — so the grant lands beside that user's blacklist
  instead of in a second store nothing else reads. It is a **read-modify-write**:
  the harness and the panel write two different fields of one file, and a grant
  written as a whole-payload `save_if_changed` would have emptied the blocklist
  in a file named after a hash of the key, where the damage is invisible in review.
- **The client holds a second copy, and the two are unioned.** That file is
  server-local, so on a host that wipes its disk on restart — every ephemeral
  dyno — the grant was gone by morning and the user was re-approving the same
  site daily, which quietly made "outlives the run" false. `domain_granted` now
  goes out to the extension, which writes `approved_domains` into the same
  `chrome.storage.local` settings document the blacklist already lives in and
  ships it back on every `task_start`; `_persist_user_policy` unions what the
  client sent with what is on disk, so neither store can lose what the other
  still holds. **The blocklist was never at risk** — `effective_policy` is built
  from the client's copy on every task start, so the server file only ever fed
  the pre-connect panel view.

  Two rebuild sites rebuild the whole `userPolicy` object and had to be widened
  or they revoked grants on a side effect: `hydrateUserPolicy` (browser start)
  and the `policy_changed` case (which fires on **every** press of Save, so
  opening Settings to change an unrelated field used to drop them all). The
  panel's Save replaces `settings` wholesale, so it carries the prior
  `approved_domains` forward for the same reason. Pinned by
  `scripts/test-domain-grants.test.js`.
- **The audit is the fallback, not the store.** A resume restores approved
  domains from `policy_events` with `user_decision == "approved"`, and that
  filter now accepts `first_time_seen` as well as `first_navigation`. Both now
  mean "the user said yes to this site". The policy file is the durable copy; the
  audit covers a grant whose file write failed.

**The one narrowing that survived is `aria-hidden`.** A target the extension
supplemented is one the site deliberately put out of the accessibility tree, and
it gets the key `<domain>:hidden` so it never rides a standing grant. The loop's
shortcut is therefore `key == domain and domain in deps.visited_domains` — the
membership test is *after* the key is built, because testing membership first
would let a page-injected "Delete account" through on a site the user approved
last week. `test_a_standing_grant_does_not_cover_a_hidden_control` pins that
condition, and `test_a_hidden_control_never_becomes_a_standing_grant` pins that
the key shape is the only thing keeping it out of the file.

**The prompt names the site and nothing else.** It used to interpolate
`_card_label`, which is the model's own `description` string — so a click whose
description was the page title rendered as *"the agent wants to District by
Zomato — Best Go Karting in Gurgaon (2026)"*, which is a page, not an action. A
domain-scoped approval does not need a per-action label.

**The grant is per-domain, but the gate that consults it is not uniformly
timed.** A ref `click` is approved *before* dispatch, from the link's `href`. A
coordinate click cannot be — the page is a canvas there and nothing about its
destination is readable — so it is gated after. Same grant, same
`visited_domains`, one approval covering both; when the question arrives is in
`agent-loop.md`.

## Two boundaries that are structure, not settings

Both are unconditional, and both should stay that way:

- **Redaction happens in code**, at the single `deps.cdp.get_page_text()` call,
  before the prompt is built — `agent/redact.py`. The model is *told* about it in
  `policy_preamble` so it stops trying to reconstruct a `[redacted]` value, but
  that instruction is a behavioural control, not the boundary. Anything the model
  decides cannot change whether the redaction happened.
- **Page text never reaches disk.** `capture_page` records a 200-character
  digest; the `.pages.json` bodies sidecar had no writer left once the manifest
  replaced it, and neither did the secure-mode-only body-stripping hook. A run over
  an authenticated session leaves a manifest of what was visited, not copies of
  what was on it. The known cost: a resumed run recalls digests, not pages.

Note the digest is a *prefix* of the page, not a hash — a short page is its own
digest. "Never written to disk" means "never beyond 200 characters per page", and
a test that asserts on the wrong half of that passes for the wrong reason.

## The credential is bound to the server that issued it

`settings.agentSecret` is one slot holding two things — a self-hoster's
`AGENT_SECRET` and, on the cloud path, a **Supabase access token** — and both
readers attached it to whatever `settings.serverUrl` held. One slot is
deliberate and the extension still never parses the value. What was missing is
the other half of that: nothing recorded *which server issued it*, so a
mistyped host, an imported settings blob, or a colleague's self-host received
the user's cloud token, and the relay would have honoured it as that account.

`agentSecretOrigin` is the binding, written alongside the token by the two
places that know the issuing server at the moment they get it — the wizard's
`finish()` and the panel's `storeAgentSecret()`. `credentialFor()` compares it
to `originOf(serverUrl)` and returns either the credential or a **sentence**,
because a string cannot carry "why not" and a refusal that reports itself as
*server unreachable* sends the user to debug the wrong machine.

Three things that are load-bearing:

- **The comparison is on the origin, not the string.** The same server is
  written at least three ways in this codebase — the wizard's default, the
  panel's stripped trailing slash, whatever the user typed — and the trailing
  slash is exactly the mistake that removed `HOSTED_SERVER_URL`. `http://` vs
  `https://`, a path, and `:8443` all differ; a trailing slash does not.
- **An install with no recorded origin is still allowed on loopback** and
  refused everywhere else. Refusing everywhere would lock out every existing
  self-hoster; loopback is where their credential already went and never
  crosses the network. There is no safe default for a remote address, so the
  pre-fix install has to re-enter its key once — which records the origin and
  lifts the refusal permanently.
- **The refusal is thrown before any connection.** Not dropped into a socket
  that then arrives credential-less and reads as 4003, and not retried:
  `scheduleReconnect()` returns false on `credentialRefusal`, the same rule
  the 4001/4003 refusals already follow. The user gets the sentence naming
  both servers, not three toasts about a server that is running fine.

`agentSecret()` is gone. There is one reader, it binds, and both `authHeaders()`
and `authedWs()` take its answer — a second read of the slot could disagree
with the first. **Plaintext `http://` to a remote host is authorised by a
recorded origin and nothing else**: a self-hoster on `http://192.168.x.x` is a
supported deployment, but the address alone has never been evidence.

**The account id arrives the same way: as its own field, never as a decoded
`sub`.** `learnAccountId()` re-learns `state.accountId` on every panel open
through ordinary `authHeaders()` — no second fetch helper, no `?token=`, no
decode — and is **skipped entirely unless `state.authMode === 'jwt'`**, because
asking a self-host would spend a request to learn what the mode already says.
It runs *after* the address is stored and the credential has proved itself, so
it is one authenticated request per panel open, not one per keystroke. A stored
id short-circuits it. `null`, `""`, a 404, an unreachable server and a throw
all leave it null, which **is** the pre-account behaviour by construction.

Mode and identity both come from what the server says. Comparing the address
against a hardcoded constant to decide cloud-vs-self-host — the thing
`agentSecretOrigin` exists to remove — must not come back here: `panel-ui.md`
owns the namespace this id scopes.

**`serverIsAlive(url = serverUrl)` grew a parameter** when the panel's pre-task
check started using it (`probe_server`). It could not reuse the module variable:
`serverUrl` is assigned only inside `startRelay`, so on a worker that has not
run a task it still holds `DEFAULT_SERVER`, and on one that has it holds the
*previous* task's address — either way the wrong thing to probe. The bound is
why there is one probe rather than two.

**Two forward sites outside `background.ts` carry the same value and are not
fixed here:** the panel's `authHeaders()` and the wizard's `checkServer()`, each
of which reads `agentSecret` and sends it to a URL the user typed. Both belong
to `brotto-panel`. Pinned by `scripts/test-credential-origin.test.js`, which
asserts the writers too — so the file is red until that work lands, which is
the honest state for a guard with no writer.

## Notifications

Two classes, and they gate on **different** things, which is the whole point:

- **Blocking** (`approval_request`, `login_required`, `clarify_request`) —
  always speaks up, panel open or not. The user has usually wandered off
  precisely because the panel looks idle. `notifyBlocking` gates it.
- **Results** (`task_completed`, `task_failed`) — only when nobody is
  watching. `notifyResults` gates it. Default **on**, and this is a product
  judgement worth knowing about: Brotto's premise is that you leave it running
  and come back later, so "the task ended" is the event the whole thing exists
  to deliver. Flip it if that reads as too loud.

"Watching" is a **boolean on the keep-alive port**, not port liveness. A bare
`chrome.runtime.connect` cannot tell an open-and-watched panel from an
open-and-forgotten one, and the second is the normal state for a ten-minute
task. `sidepanel.js` drives it from `focus`/`blur` events — not by polling
`hasFocus()`, which **is forced `true` under CDP focus emulation** and so cannot
be tested in the browser harness at all. Those listeners are registered at
module scope, not inside `connectSwKeepAlive`, which re-runs on every service
worker restart and would accumulate a pair of listeners per reconnect. The
background defaults `panelWatching` to `true`, so a cold service worker reads
"connected" as "watched" and stays quiet rather than guessing.

A notification click focuses `activeWindowId` and clears. It deliberately does
**not** call `chrome.sidePanel.open()` — that needs a user gesture a
notification click does not provide (chromium bug 40929586, still open), and a
click that clears the notification and leaves you where you were is a dead
end. `chrome.windows.update(id, {focused: true})` has no such restriction.

**A setting that is written and read nowhere is worse than no setting.**
`notifyBlocking` was persisted in three places and consulted in zero, so
unchecking it changed nothing at all. Both toggles are now read in
`maybeNotify`.

Not built, and cheap if wanted: a "waiting on you" badge on the panel icon.
`currentPrompt` is already tracked in the background.

## The debugger can vanish mid-run

`chrome.debugger` attachments end on their own and **nothing is raised on the
sending side** — the next `sendCommand` is where it surfaces, as `Debugger is
not attached to the tab with id: N`. Chrome's `onDetach` documents exactly two
reasons, and there are only two: `target_closed` and `canceled_by_user`, the
latter being *"Chrome DevTools is being invoked for the attached tab."* So the
cause of a mid-run drop is DevTools being opened on the driven tab, or the tab
being closed. **Switching to another tab in the same window does not drop
it** — there is no focus-related detach reason, `activeTabId` is pinned for the
run, and there is no `chrome.tabs.onActivated` listener.

The failure looked like a model fault, and the cascade is the reason that
matters:

- Post-action observations are driven by `chrome.webNavigation.onCommitted`,
  not by `Page.enable`. A dead debugger produces no CDP events, so no
  navigation event, so the server's post-action wait ran to its 30s timeout.
- It then handed the model an **empty observation** — `url=""`, 0 targets —
  as if it were a page. MiniMax-M3 failed to produce a valid action from it
  three times, and the document recorded `invalid_decision`.

Two halves, in `debugger.ts` and `background.ts`:

- `sendCommand` catches `/not attached/i`, re-attaches once, re-sends
  `Page.enable`, and retries. A second failure is real and propagates.
- `background.ts` reports a `canceled_by_user` detach during a task with a
  blocking notification, because the re-attach above takes the tab back from
  DevTools and the user deserves to know that's what happened.

**Not fixed, deliberately:** the empty observation is still handed to the
model as a page. The re-attach stops the cascade at its source; teaching the
harness to treat `ax_elements == 0` as a perception failure is a separate
judgment call. Also uncharged: a failed step's `model_plan` seconds and tokens
never reach `timings` or `result.usage`, because both are recorded only when
`planned is not None` — so a 3-attempt failure's ~19s is charged to nothing.

**Not verified in a browser.** Both halves are read-and-reasoned, not run.

## The observation gate waits for quiet, not for the load event

`captureObservation` used to poll `document.readyState` until `"complete"` and
then sleep 400ms. **`readyState` reaches `complete` with the load event, which
on a SPA is *before* the app has rendered anything.** The `auth-slowjs` fixture
`setTimeout(…, 5000)`s its control into existence and measured a
`PERCEPTION_FAILURE`: the page was captured at ~400ms with the control absent
from the tree, and the model was shown a login form with nothing to do.

`observation/stability.ts` replaces it with a mutation-quiet window — one
`Runtime.evaluate` with `awaitPromise: true` that installs a
`MutationObserver` on `document` and resolves once the page has been still for
3s, with a 10s hard deadline.

- **The deadline is the contract, not a fallback.** A live dashboard never
  mutates out. A gate that waits for quiet is a *barrier*; a gate that waits
  for quiet *up to a deadline* is a wait. A hung step costs 30s of orchestrator
  timeout and then an empty page, which is indistinguishable from a perception
  failure in the audit.
- **A rejected evaluate (tab mid-navigation) returns immediately** with
  `waited: false`. Same reasoning: capture whatever is there.
- **3s is paid on every step**, including a static page — the window is
  silence, and a page that loaded a moment ago is silent from `t0`. That is
  the price of not handing the model a half-rendered page. Revisit the number
  if step latency, not correctness, becomes the complaint.
- `scripts/test-observation-stability.test.js` runs the real page-side
  expression against a fake DOM, so "the gate never fires" and "the observer
  leaks" are both caught. Both are absences and read clean in a diff.

### The rate exit is relative, because the old one was calibrated on Gmail

The gate also short-circuits before the quiet window can be reached, and it
used to be an absolute pair — `BUSY_SAMPLE_MS` / `BUSY_MUTATIONS`, "3 mutations
inside 1000ms". Both constants are gone. The replacement is one number,
`RATE_SAMPLES = 3`, and one test: **if the mean gap between mutations since
`t0` is shorter than the quiet window, a silent window is arithmetically
unreachable**, so stop waiting and hand the caller `early`.

`RATE_SAMPLES` is a floor on evidence, not a threshold on speed. Fewer than
three mutations is an anecdote, not a rate — which is exactly what a slow
renderer looks like, so `auth-slowjs` never forms one and keeps its full window.

**The sparse end needed a second exit, because three samples is also a wait.**
On a page that mutates every 2.9s the third sample arrives at 8.7s, so most of
the deadline went on counting samples rather than looking at the page — a real
Sheets run measured `stability=unsettled in 8752ms (3 mutations)`. The second
exit is `CHURN_WINDOWS = 1.5`: **two samples whose gap is shorter than the
quiet window, once the page has been churning continuously for one and a half
windows.** The churn floor is what keeps a loading page out — `auth-slowjs`
mutates twice and then goes quiet, which never reaches the floor, so it still
waits out its deadline and the tree it hands the model has the control on it.
A single mutation never starts either exit, and a page that goes quiet is
claimed quiet by the window, not by the churn.

Both exits are evaluated **in the observer callback, at the moment a sample
arrives**, not in the poll: a sample is the only thing that can start a rate,
and a poll firing long after the last mutation would claim a page busy on the
strength of a change it has already forgotten. Neither exit can report a page
as quiet — both hand the caller `early`, and the fingerprint rescan stays the
arbiter.

**The calibration point is Gmail, and it was silently a universal claim.** 41
mutations in 10,002ms — one every ~244ms — so 3s of silence is not rare on
that page, it is impossible. Every Gmail observation therefore paid the full
10s deadline, forever, and the numbers behind that are in `agent-loop.md`
("The quiet window was unreachable on exactly the pages that need it"). The
implicit rule that came with it was *any slower page is a loading page*.

**Google Sheets falls between the two heuristics**, which is how the
assumption broke: it mutates 3–6 times per 10,002ms, a gap of 1.7–3.3s — too
slow to clear the busy sample, too fast to fall silent for 3s. It passed *both*
heuristics without matching either. A live Sheets run then measured **177s over
8 steps with 10 of 14 observations at the full 10,002ms deadline**, against
~2s/call of model generation, so ~90% of wall clock was observation latency —
and the tree each time came from an arbitrary mid-repaint instant. Gmail and
Sheets are the same fact about the world at two frequencies; only a
rate-relative test says so.

`noEarly` still sets the exit to 0 and is unchanged. It now has **no caller** —
the second gate that passed it is gone (see `agent-loop.md`), and it was left in
place as the gate's own API rather than deleted alongside its last use.

The SPA retry underneath it changed condition at the same time. It retried
while `axTargets.length < 3`, which is wrong in both directions: a page that
rendered three useless targets stops retrying, and a merely-dense page burns
all four retries on itself. It now re-reads **twice at most**, stopping at the
first read whose `role|name|value` fingerprint is unchanged.

**The `/run` benchmark path does not use this code, and `auth-slowjs` still
records `PERCEPTION_FAILURE` after this change.** `run_benchmark.py` POSTs to
`/run`, which drives `dev/playwright_browser.py` — a separate observation
implementation whose `goto` waits on `domcontentloaded` and whose `observe`
takes no stability wait at all. The extension is never loaded.

That is a property of the measurement, not a defect in the fix, and it holds for
every extension-side change in this workstream: the stability gate, frame
enumeration, bulk geometry and the `aria-hidden` supplement are all invisible to
the suite. **The baseline was re-recorded with those four fixtures still red**,
because the alternative — recording them green — would report success for fixes
that were never exercised, which is worse than having no measurement. The honest
consequence is that this work is unit-tested logic and **needs a hand-run in a real
browser** before it is called verified. `auth-inbox` flipped to PASS because ranked
selection is the one server-side fix, and that PASS is real.

## One action, one observation — `pressAt`, `dispatchKey`, `focusState`

`executeAction` used to inline the whole of `click`: verify, draw, press,
release, settle, clear the cursor in a `finally`. Three verbs needed those
gates and only one of them had them, so the other two got *no* hit test —
`focus_ref` and `clear_ref` were `type_text`'s first two trips, dispatched as
plain `click` frames, and each one paid a full `captureObservation`.

**The clear is gone.** The marker is the user's only way to see where the
agent is clicking, and a `finally` that removed it made the cursor invisible
in practice: the mouse pair is dispatched with no delay, so a sub-200ms marker
was never seen at all. Nothing in the extension removes it any more. The next
click *moves* it — the draw removes the previous dot, label and style by name
and puts new ones at the new point, so there is never more than one — and the
only thing that takes it away is the page going away, so an overlay cannot be
orphaned across a navigation, because it cannot outlive the document it lives
in.

**A marker that outlives its click has to be invisible to the observation.**
Its words live in a `data-label` rendered by a `::after` rule, and both halves
are `aria-hidden`, so they are in neither the page text the model reads
(`document.body.innerText`) nor the accessibility tree the observation is
built from. A pseudo-element's content is not a text node, and the `<style>`
element's own text is CSS. Without that, a marker left up across steps would
put the agent's own annotation into the page's text — the model reading "Fill
the form" as if the page had said it, and acting on its own words as
evidence.

`pressAt(tabId, action, x, y)` is that block, extracted, and it keeps
`verifyTarget` **inside** it. That placement is load-bearing: `verifyTarget` is
the only thing binding an action to the node the model was shown, and a gate
that exists on one branch and not its sibling is a gate with a hole in it.
It returns `null` when the press went out, or the refusal that stopped it.
`dispatchKey(tabId, key, mods)` is the same treatment for the `key` branch's
key-down/key-up pair, and carries the comment that `mods` is CDP's bitmask
(Alt=1, Ctrl=2, Meta=4, Shift=8) and is the caller's to supply — the extension
holds no platform branch and must not grow one.

`type_at` is the new branch, and it is the branch that destroys the user's
text, so it carries four gates in order: **bound the point, verify the target,
bind the identity, then read and clear**. `clear` is set by the relay's
`type_text_into_ref`, whose default is `clear=True` — the caller asked to
replace the field's contents. The fourth gate has one exception, and it is
named below: on a canvas grid the clear is the grid's own business and is not
performed.

- **The point is bounded.** `boundedPoint(tabId, action.x, action.y)` re-reads
  the live viewport and refuses anything outside it, non-finite, or
  non-numeric — the same reason `click_xy` already uses, and it subsumes the old
  `typeof` check. The `viewport` field on the same frame is *not* the bound; it
  is the sender's idea of the viewport, from the same untrusted message. The
  **bounded** `{x, y}` is what goes into `pressAt` and into `bindFocus`, so the
  hit test is asked about the point that is actually dispatched.
- **`bindFocus` binds the identity.** See below — this is what `type_at` has
  that `click` does not, because `type_at` is the only branch that reads
  `document.activeElement` and *acts destructively* on it.

### `bindFocus` — four walls, and the two canvas exemptions

`verifyTarget` answers "is the right element at this point", before the press.
It cannot answer "what holds focus now", because the press is what creates
focus. Everything after `pressAt` reads `document.activeElement` and acts on it,
so a press that missed, landed on a non-focusable, or was moved by page script
leaves the user's *previous* field focused — and `clear` empties that one.

**Wall 1 — engine-sourced identity.** `focusNode` runs `DOM.enable`, reads
`document.activeElement` **in the isolated world** — a `Runtime.evaluate` with
the world's `contextId`, through `withWorld`, so a dead context id is rebuilt
rather than refused — and has the engine name the node that read points at
(`DOM.describeNode({objectId})`), returning `{backendNodeId, nodeName}`.
**No page script runs to answer this**: the isolated world has its own
prototypes, so overriding the `document.activeElement` getter in the page's own
world changes nothing, and the *naming* is the engine's. Every failure refuses
with `focus-identify-failed`, and a page whose focus cannot be named cannot be
cleared.

**`DOM.getFocusNode` was removed from Chrome, and that was the whole keyboard
path.** It answered `-32601` ("'DOM.getFocusNode' wasn't found") on every
current build, so `focusNode` always failed, so `bindFocus` always returned
`focus-identify-failed`, so **every `type_at` was refused on every site** — not
only the canvas ones. The report that started this was a Sheets run whose
`type_text` was refused with `focus-identify-failed` — four refusals in one
run's audit; the click had landed and selected the cell, and the text was
never dispatched because the probe had already given up. The replacement asks
the same question by the route that still exists.

**No test could have caught this, and that is the point.** The extraction tests
mock the platform, so every assertion about the refusal vocabulary, the
identity comparison and the geometry stayed green while the feature refused
every call in the field. A test proves the code you wrote; it cannot prove that
the thing you wrote still exists in the browser. The only detector was a live
run whose audit said `focus-identify-failed` four times, and the failure took
that long to find because the refusal read like policy — a page that would not
accept the text — rather than like a method that no longer exists. **A closed
vocabulary of reasons is a promise that each reason means one thing, so the
reason has to be the true one.**

**Wall 2 — containment, in an isolated world.** `IDENTITY_PROBE` is a
`Runtime.callFunctionOn` with the pressed node as `this` and the focused node as
an argument, admitted when they are the same node, when the focused node is a
*descendant* of the pressed one (a `<label>`, a wrapper `<div>`, a `<span>`
inside a button — an ancestor is not admitted), or when focus was retargeted to
the pressed node's own shadow host, which ordinary `contains()` cannot see.

The world matters. `isolatedWorld(tabId)` does one
`Page.createIsolatedWorld` per tab under the name `IDLE_WORLD` and **caches** the
`executionContextId`; nodes are resolved into it with
`DOM.resolveNode({backendNodeId, executionContextId})`. In the page's own world
the page owns both the question and the effect — it can override the
`activeElement` getter so the probe reports a focus that is not there, and it can
override `Element.prototype.select` so `select()` does something other than
select. A probe a malicious page can answer *and* act on is not a guard.

**Wall 3 — the canvas exemption**, for the one shape neither of the above can
serve: a `<canvas>` grid cell whose press focuses a hidden editor that is not
the cell and not inside it. All three conditions hold:

1. the pressed node is a `CANVAS`;
2. the focused node's engine-supplied `nodeName` is an `INPUT` or `TEXTAREA`;
3. `DOM.getBoxModel` for the focused node **wholly inside** the pressed canvas's box.

(3) is what makes it narrow rather than a hole. A visible field the user was
typing into — a real search box, a real form input — is somewhere else on the
page, so its box cannot be inside the canvas that was just clicked. Both boxes
come from the engine in the engine's coordinates, so **no page attribute
(`aria-hidden`, `hidden`, inline style) can unlock the exemption** by being
written onto the user's own field. The residual: a page that physically moved
the user's focused input on top of the canvas it was clicked — and then
`verifyTarget`'s `elementFromPoint` has already refused the press as
`different-element`, because the click landed on the input, not the canvas.

**The exemption is reported, never silent.** `bindFocus` returns
`{ok: true, reason: "canvas-editor-exempt"}`, `executeAction` logs it, and
`ExtensionCDPRelay` logs "action succeeded by exemption" while keeping the
verdict a success. Reading it as a refusal would refuse the shape `type_at`
exists for; dropping it silently loses the only server-side trace that the
identity binding was waived.

**Wall 3b — the grid editor.** Wall 3 cannot serve a grid that keeps its
editor *outside* the canvas. Google Sheets' cell editor is
`DIV#waffle-rich-text-editor.cell-input[contenteditable=true]` — a direct
child of `BODY`, zero-width, parked at `y = -9998` — so it is neither the
pressed node nor inside it, and it is not an `INPUT` either. Wall 3b admits a
focused **editable or text input** on a canvas press when **the engine's own
geometry** says the user cannot see it: it has no area at all, or it lies
wholly outside the live viewport, or its box contains the point that was
pressed (the editor drawn over the cell being edited). Editability is the DOM
property `isContentEditable`, read in the isolated world — **no page attribute
is consulted**, so a page cannot unlock it by writing `contenteditable` onto
the user's own field; and a viewport that cannot be read proves nothing, so
that case fails closed. A visible field elsewhere on the page satisfies none
of the three and is still refused, which is the "erase some other field"
failure.

The third admission is the one that needs its own argument, because it is the
only one that admits a field the user *could* be looking at. It is safe
because `verifyTarget` has already asked `elementFromPoint` about the
dispatched point and been told the **canvas** is there: a visible field of the
user's own, sitting on top, would have been the hit, and the press would have
been refused as `different-element` before the text was ever dispatched. The
editor is admitted because it is under the canvas that took the press, not
because it is somewhere else.

**A grid cell is typed, not inserted.** `Input.insertText` fires no keydown,
and a grid starts editing on the *keystroke* — so an insertion never reaches
the cell, and the cell shows a caret with nothing in it. On the grid path the
text goes out as one `Input.dispatchKeyEvent` pair per character (a newline is
a Return key), never with a modifier, so no chord and no OS question. The
ordinary DOM path keeps its single `Input.insertText` call. The run is bounded
at 1000 characters, and over that it refuses with `canvas-text-too-long`.

**The grid path does not clear, and the grid is told to stop clearing.** The
DOM clear reaches for a selection inside an off-screen editor, which is not
what a grid wants: a grid replaces a selected cell's content on the first
keystroke. So on this path the clear is skipped entirely and the first
keystroke is the replacement — the same outcome, by the grid's own rule
instead of ours. The allowance is reported like wall 3's
(`canvas-grid-editor`), never silent: `bindFocus` returns it, `executeAction`
logs it, and the server sees an action that succeeded by an allowance.

`bindFocus` also refuses `focus-unidentified` when the frame carries no
`backendNodeId`. `verifyTarget` *fails open* there, because an older relay has
no gate to run; the clear has no such excuse — it is the one operation here that
destroys the user's text. The relay closes the same case at the source by
calling `_locate(ref, need_backend_id=True)`.

### The cached context id rotted, and nothing said so (2026-10-20)

**An execution context id belongs to a renderer, not to a tab.** The cache in
`isolatedWorld()` is keyed by `tabId`, but the id dies with the renderer: on a
cross-document navigation, and on a debugger detach-and-reattach to the *same*
page. An MV3 service worker outlives both. So the cache handed every
`Runtime.evaluate` an id that no longer existed, the evaluate returned an error,
and the caller read "the extension could not evaluate".

The blast radius was the whole keyboard path. `focusState` runs `FOCUS_PROBE`
through it, so `press_key` and `type_text` were refused on **every** step — the
server's wording was `focus is unknown`, which reads as "the page has no focused
element", i.e. a statement about the user's page. It was a statement about a
dead id in our own cache. `probe_xy` was dead for the same reason, and that is
the coordinate-safety probe — so the bounds check standing between a model-chosen
point and a press was not running at all.

**The fix is a self-correcting wrapper, `withWorld(tabId, fn)`.** Use the cached
id; if `fn` throws, drop the entry, build the world again, run once more. A second
failure propagates unchanged, so a real fault stays one fault and does not
become two silent attempts.

**Why not a list of invalidating events, and why not `loaderId`.** Enumerating
the events that invalidate an execution context is a list that rots: a future one
is missed and the id goes stale again, silently — and it goes stale silently
*by construction*, because an evaluate against a dead context is an **error**,
not an empty value, and every caller here reads "the extension could not
evaluate" for both. Keying the cache on the frame's `loaderId` is cheaper on the
happy path and still wrong, because detach-and-reattach-to-the-same-page leaves
the document unchanged and the `loaderId` identical. **That is the case a live
run actually hit.** Recovery-on-failure covers every cause — navigation, detach,
frame swap, context destroyed — without a list of them.

A failure now also reaches the server: `main.py` logs `evaluate failed in the
extension` at warning with the extension's own error string. Dropping `error`
and forwarding only `value` is what turned a hard failure into `focus is
unknown` with nothing to act on and nothing to diagnose.

### The `evaluate` frame grew one optional field

`{"type": "evaluate", "expression": "<js>", "isolatedWorld": true}`. Absent or
`false` is exactly the call that shipped — main world, **no `contextId` key in
`params` at all**. Set, the *same expression* is evaluated in the tab's cached
`brotto-idle` world, whose prototypes are the extension's, so a page cannot
shadow the getters it reads. The isolated world shares the DOM, so `document`
and every element are the same objects; only the JS globals differ, and
`returnByValue` returns the same primitive either way.

This is a **grow-only** addition to an existing frame: an old extension ignores
the field, an old server never sends it. No version window is needed.

**Who sets it, decided per caller.** The flag is opt-in and the callers are not
uniform, because the reads are not:

- **`focus_id` — set.** Reads `document.activeElement`; in the main world the
  page owns the getter it resolves through, so the check could silence itself.
- **`probe_xy` — set.** Not a diagnostic: it is a decision.
  `window.innerWidth`/`innerHeight` are page-writable globals feeding
  `_coordinate_action`'s bound check — the only thing between a model-chosen
  point and a press — and its `tag` read is what refuses a covered canvas.
  The DOM is shared, so `elementFromPoint` still answers on the same elements.
- **`read_page_text` — deliberately not set.** The value *is* page content,
  page-controlled in any world, and it reads shared DOM anyway. Isolating it
  would protect the page's text from the page, which is backwards.

### `focusState` reads focus and clears in one evaluate

`FOCUS_PROBE` is one `Runtime.evaluate`, `returnByValue`, **in the isolated
world** (`contextId` from `isolatedWorld`), answering two questions in the order
they were already asked in — a second round trip would ask the same unchanged
`document.activeElement` twice. It returns `{ok, reason}`, and the whole
vocabulary is **`TYPE_AT_REFUSALS`** in `pointer.ts` — the exported list the
tests assert both ways, kept in one place because a reader who has to assemble
it from the branches will read it wrong.

"Is this a text field" was once inferred from `typeof a.select === "function"`,
which is a duck type: any element can carry a `select`, a `select()` on a `<div>`
does nothing, and the page owns that method. It is now one real predicate —
`a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement ||
a.isContentEditable === true` — which is exactly what the isolated world buys.
A non-field refuses `focus-no-text-field` on the type-only path and
`clear-no-text-field` on the clear path, because "cannot receive text" is the
whole question on one and "nothing to clear" on the other. A focused `IFRAME`
refuses `focus-on-frame`: `insertText` would land in a document no observation
this run produced covered.

`document.body` and `document.documentElement` are the "nobody is focused"
answer in every engine, and `Input.insertText` against either is a no-op, so
refusing there reports the truth rather than inventing a failure.

### A successful `select()` is not evidence a clear happened

**This is the behavioural change, and it trades a step for never appending to a
field the model asked to empty.** `HTMLInputElement.select()` is *specified* to
silently do nothing on input types it does not apply to — `email`, `number`,
`date`, `time` — and to do nothing, **not to throw**. So calling it successfully
proves nothing, and the text that follows would append to a field the model asked
to replace: the same wrong answer the bare `"a"` gave, quieter. The probe reads
the selection back and refuses with `clear-select-noop` unless
`selectionEnd - selectionStart === value.length`.

The value's length is read **first**, deliberately, because `selectionStart` is
`null` (not a number) on those same types — and an empty field of a no-op type
has nothing to clear, so appending to it is correct. That is also the Sheets
case: the canvas exemption's editor holds the cell's text in a hidden input, and
an empty cell's input is empty. The practical consequence: **a numeric or date
field now costs the model an extra step**, which is the intended price and not a
regression to route around.

The `contenteditable` branch has no `select()`, so a `Range` over the node's
contents is the same operation by another route — and it is confirmed the same
way: `selection.rangeCount === 1` and a non-empty `getRangeAt(0).toString()`
when the node had text. Anything else is `clear-select-noop`, as is a missing
`Selection`. A throw is `clear-threw`.

### The canvas case is exempted, not waved through

An earlier version of this doc argued the opposite — that identity must *not* be
verified in `focusState`, because a Sheets cell is a `<canvas>` whose hidden
input is not a descendant of the clicked node. That was right about the
consequence and wrong about the conclusion: containment is exactly the check
needed, and the Sheets shape is the one case that gets a named exemption rather
than an exemption for everything. `select()` selects that element's own contents
wherever it hangs in the tree — it is not a region of the page — but that is a
reason to *exempt* the shape, not to skip the identity question. The identity
check lives in `bindFocus`, upstream of `focusState`, precisely so the exemption
is the narrowest thing in the path.

### The clear runs after the press, and that ordering is why it is here

It is tempting to move the select-all back to the server. It cannot go there:
`pressAt` establishes the focus, so after it `activeElement` **is** the clicked
target and before it is whatever held focus a moment earlier — possibly a
different field, which the clear would then empty. Ordering, not capability, is
the argument. The key-chord route is closed for the reason in
`agent-loop.md` ("Select-all is not a keyboard shortcut"): Ctrl+A is "move to
line start" on macOS and there is no legal way for this file to ask which OS it
is on.

**`point-not-numeric` is not a dead key.** It is emitted by `verifyTarget`, not
by the `type_at` branch — the `typeof` check there is now subsumed by
`boundedPoint`, which reports the same case as `point-out-of-viewport`. The
`verifyTarget` guard is live because `click` hands `pressAt` the frame's **raw**
`action.x/action.y` and only `click_xy` is bounded upstream, so a `click_ref`
coordinate is checked for numerics and hit-tested but never clamped to the
viewport. Do not delete the key on the reasoning that nothing emits it.

Pinned by `scripts/test-type-at.test.js`, which extracts the branch and evals
it against a fake CDP session, `scripts/test-target-hittest.test.js`, which
asserts the gate lives inside `pressAt` so `click` and `type_at` cannot drift
apart, and `scripts/test-evaluate-isolated-world.test.js`, which asserts the
`evaluate` frame's optional `isolatedWorld` field is absent-until-asked — an
extension without it ignores the key, a server that never sends it is unchanged.
The server does ask: `focus_id` and `probe_xy` set it, `read_page_text`
deliberately does not.

## Geometry is three calls, not one per node

`targetsForFrame` used to call `DOM.getBoxModel` **once per kept node, serially,
inside the loop**. The Gmail search page measured 608 targets, so observation
latency was proportional to page size on every step of every task — a floor under
the product that no amount of prompt work can lift.

`observation/geometry.ts` replaces N calls with three: `DOM.getDocument(depth:-1,
pierce:true)` for the whole union, `DOM.resolveNode` for one `objectId`, then one
`Runtime.callFunctionOn` that walks the id list and returns a
`Map<backendNodeId, [x, y]>` with a `getClientRects().length` zero-check for
elements that have no box. `backendNodeId` is the join key, and it is the same id
space on both sides for a given target — which is the only reason this works, and
was the one open question the probe did not answer.

**A miss in the bulk map falls through to the old per-node call rather than
dropping coordinates.** Off-screen and unmeasured are different states, and
collapsing them would make a target that exists look like a target that does not —
which is precisely the failure the fixtures exist to catch. The result reports
`source: bulk | empty | no-join | failed` and `requested/resolved/fallback`, capped
at 2000 entries, so a join that silently stops matching is visible in the
observation rather than inferred from a page that looks emptier than it is.

## The page delta — evidence that the page moved, at ~100 bytes

`observation/delta.ts` answers "did the page change, and where" every step, on
the pages where the accessibility tree is the useless signal. A Google Sheet
measures 71 targets / ~11 KB and is **byte-identical across 15 consecutive
steps** no matter what the agent types, so the agent has no evidence its action
landed and repeats. The wire shape is fixed, and the server is built against
exactly this:

```js
delta: { changed: boolean, tiles: [ { x, y, w, h, pct } ] }  // worst first, max 5
```

Tiles are **16×16 in full-resolution viewport CSS pixels**, and `pct` is the
tile's mean absolute luminance difference as a percentage of full scale. The
tile size is the reason the signal is per-tile and not global: one character in
a large mostly-white grid is ~0.01% of the pixels, so a single page-wide mean is
swamped by whatever else moved. Tiling makes the false-negative rate depend on
tile size rather than page size — which is what lets a cell edit register in a
40×200 sheet. The threshold `TILE_DIFF_THRESHOLD` is absolute for the same
reason: "% of page changed" is the most mis-set parameter in visual regression
testing.

**A tile is evidence, never a target (locked decision D2).** A tile is a region
that *moved or changed*, which is not a claim about what is there now — the page
repaints after the diff. Nothing in the extension may consume the coordinates
and the server is forbidden from feeding a tile to a coordinate action.

**The cost is zero tokens and zero pixels on the wire, and it is not a
screenshot.** The capture is decoded in the extension, differenced and dropped;
what crosses is ~100 bytes of derived integers. It is a *second*
`Page.captureScreenshot` call per step, independent of the vision screenshot and
of `BROTTO_VISION_CAPTURE`, and it does **not** consume the 3-per-task
`_MAX_CAPTURES_PER_TASK` budget — that counter guards what a model sees, and no
model sees a delta. One frame is retained per tab and cleared on navigation, on
task start, on tab close and on detach. The permission disclosure for all of
this is `PERMISSIONS.md`, because a CWS reviewer counting screenshots should
find the second call stated rather than discover it.

**It is *not* independent of `BROTTO_VISION_CAPTURE`, which is the correction
to the sentence above.** The extension computes the delta unconditionally — it
does not know the policy, deliberately, so the server stays the authority — but
`ExtensionCDPRelay.get_page_delta` asks `screenshot_block_reason` first and
returns `None` if it says no. With the switch unset, the default, there is no
delta either. The veto is the harness's verbatim `redactions or run_secrets`,
the same one `_capture_page` applies to the picture: a delta is read off the
same pixels a screenshot of that page is refused over, and letting it through a
different route would be the bypass the gate exists to prevent. Pixels are the
one channel redaction cannot reach (see `privacy.md`, "A screenshot is a gate,
not a redaction pass"), and an empty `redactions` still means no detector fired,
never that the page is clean. What the extension cannot see is *how long* that
veto holds: the harness's input is a run-wide latch for a positively identified
secret and a window covering the ambiguous write's own step and the two after
it, and the extension is told the same thing in both cases — refuse
(`privacy.md`, §3g).

#### Two things this does not do yet, and neither is settled

**The threshold is calibrated against synthetic pixels only, and needs pinning
against real captures before it is trusted.** A real spreadsheet's noise floor
is unmeasured — grid rendering, font rasterisation, the cell cursor — and the
failure is symmetric: if the real floor sits *above* the threshold the feature is
inert and the agent is back to trusting a tree that never moves; if it sits
*below*, the delta fires on every step and carries no information. Either way
nothing in the current code distinguishes them, and no number in this repo is
evidence. This is an open question, not a tuning choice.

**The caret mask does not cover a Google Sheets cell cursor.** It masks
contentEditable selection rectangles and `input`/`textarea` caret positions, both
of which the DOM can be asked about. A Sheets cell cursor is a widget-drawn
element reachable by neither branch, so on the motivating page itself a blinking
caret is **not** masked and registers as a change every time it blinks. That is
deliberately not patched with a per-product cursor table — a table keyed on
Google Sheets is the kind of fix that stops working the week Google restyles, and
it is worse than the honest gap.

### `canvasCovered` — how much of the viewport a canvas occupies

The delta above tells the harness *whether* pixels moved. It cannot tell the
harness *before* anything moves that the page is one where the accessibility
tree is worthless, because a Google Sheet's tree is rich and plausible — the
toolbar, the menu bar, forty real nodes — and the missing grid is an absence,
which no diff can report. `canvasCovered` is that signal: **the fraction of the
viewport occupied by the largest topmost `<canvas>`, in `[0, 1]`** — one
number, no pixels, no new frame type, no second round trip.

**It is computed in the page pass that already exists.** The caret probe is a
`Runtime.evaluate` the delta path ran every step anyway; the canvas enumeration
was added to that same expression and rides the same result.
`captureObservation` spreads it into the observation beside `delta`, and the
server reads it off the same cached frame
(`ExtensionCDPRelay.get_canvas_covered`, clamped to `[0, 1]`, `None` for a bool
or anything non-numeric).

**The question asked is what the canvas *occupies*, not what is on top of
it.** It is `getBoundingClientRect()` area intersected with the viewport — so a
grid scrolled half off-screen reports what it actually shows — and
deliberately **not** `elementFromPoint` sampling. Sampling asks "is the canvas
the topmost thing at this pixel", and a grid's own overlay divs would answer
that over much of the surface and undercount it. Rects cannot be fooled that
way, and they cost one `getBoundingClientRect` each.

**The enumeration is bounded on both sides of the wire, and the two bounds are
different numbers on purpose.** `SCAN_CANVASES = 512` bounds elements
*examined*; `MAX_CANVASES = 64` bounds rects *kept*. If the kept bound were the
only one, a page that put 64 zero-size `<canvas>` decoys ahead of its real
full-viewport canvas would hide it — so the size test sits **inside** the loop
(`cr.width>0 && cr.height>0 && canv.length < 64`), and a decoy is skipped
before it can reach the kept budget. `SCAN_CANVASES` is the hard bound on work a
page can force on a per-step hot path. It is enforced twice: once in the page
expression and again in `pageProbe`, because the expression is a string and the
first thing a page can try is to break it.

**A missing or non-numeric value is unknown, never `0.0`.** When the DOM pass
itself fails (tab gone, debugger detached) or the enumeration hit
`SCAN_CANVASES` — `capped` is then set, and **`canvasCovered` is omitted from
the observation entirely** — the field does not cross the wire at all. A `0`
would be a claim that nothing checked, and it would be a *positive* claim:
"this page is not a canvas", which is a fact about the page and not about our
plumbing. The server keeps `None` on the same grounds — `_observe_canvas_covered`
reads through `getattr`, so a relay from before the field shipped (Playwright,
any older extension build) returns the old behaviour exactly rather than
silently downgrading to `0.0`. `0` is a real answer only when the probe ran and
found nothing covering the viewport.

Pinned by `scripts/test-observation-delta.test.js`,
`tests/agent/test_canvas_awareness.py` and `tests/test_page_delta.py`.

## `aria-hidden` is surfaced, not recovered

An `aria-hidden` element is `ignored: true` in the AX tree and the extractor skips
it. That is the contract working — a screen reader user cannot reach it either,
which is the point of the attribute. But it is still *visible and clickable*, and
for "delete the draft" it is exactly the control the user means.

`observation/supplement.ts` returns those elements marked `hidden: true`, rendered
as `[hidden]`. It refuses cross-origin surfaces and any surface below depth 0, caps
at 200 nodes and 512 KB of evaluated script, and mints **negative** node ids so a
supplemented ref (`0:-1`) can never collide with a real one.

**This is a disclosure change and the sharpest edge in the workstream.** Surfacing
a control to a model is not a screen-reader regression — nothing changes for AT
users — but it does put a deliberately-hidden button in front of an agent that will
click it. Two rules follow, and both are load-bearing:

- The line is marked `[hidden]` and the prompt tells the model the site hid it, so
  its own instructions can weigh it. Being able to see one is not a reason to use
  one; if it is the only match for what the user asked for, acting on it is correct.
- **A `[hidden]` action is never auto-approved.** `harness._first_time_key` returns
  `(domain, f"{action}:hidden")` for it, so a hidden destructive control cannot
  inherit an existing `(domain, "click")` approval the user gave for visible
  controls. Pinned by `test_a_hidden_destructive_control_is_not_pre_approved`.

## The credential rides the subprotocol, and a refusal is not an outage

`authedWs` capped the subprotocol at **120 characters**. A Supabase access token
is ~635, and ~1.5 KB with populated `user_metadata`, so it did not fit: the check
failed, the credential was **dropped rather than sent**, the socket arrived with
none, and the server refused it. The user was told their key was wrong, and it
had never been transmitted.

**The bound is measured, not chosen.** RFC 6455 sets no length limit on a
subprotocol, only the token charset. Real Chrome 154 hands a **60 KB**
`Sec-WebSocket-Protocol` to the network intact, and through the real production
stack (uvicorn 0.54 + websockets 16.1 + Starlette, reading `offered[1]` exactly
as `main.py` does) a **4096**-char credential arrives whole and
byte-identical — **4096 works, 8192 does not complete**. That ~8 KB edge is where
this stops being about us: nginx's default `large_client_header_buffers` is 8k,
so a header past it is refused as an HTTP error and presents as a *network*
failure — precisely what the drop-instead-of-send behaviour exists to prevent.
`SUBPROTOCOL_MAX_CHARS` is **4096**: ~2.7x headroom over a JWT, and inside every
proxy budget in front of this server.

**The character class did not change, and the reason it exists is still true.**
An odd pasted `AGENT_SECRET` is still dropped rather than sent, because a
malformed handshake fails as an unexplained network error — a worse sentence
than the server's own refusal. `hmac.compare_digest` means the server accepts any
arbitrary secret, so the only question is whether it survives the header.

**A pre-accept close does not reach the client, and that is the finding.** It was
measured, not assumed: `main.py` rejects **before** accept, which is an
HTTP-level rejection, and Chrome reports that as **`CloseEvent.code === 1006`,
not 4001**. A refused key, a missing credential and a server that is not running
are therefore *the same event in the browser*, and the old handler discarded the
close event entirely and read all three as "server unreachable". Accept-then-close
does carry the code (verified: 4001 and 4003 both arrive) — but moving the
rejection after accept would hand an unauthenticated caller a socket it could
drive, which is exactly what the pre-accept check is for. **So the split is made
from evidence the client has:** the close code when it survives, and otherwise
whether a credential actually reached the wire, cross-checked against `/health`
(bounded at 1.5 s, and skipped entirely for a socket that reached OPEN, so the
mid-run reconnect path is untouched).

**Three states, not one boolean** — collapsing two of them is the bug:
`none` is the self-host with no `AGENT_SECRET` ("no secret means open" is
deliberate and silent), `sent` is a refused credential (4001), and `dropped` is
this install holding one it could not present (4003). A first attempt at this
collapsed `none` into `sent`, which would have told every open self-host
installation that its sign-in was rejected.

Neither refusal reconnects: the same credential gets the same answer three times,
and the backoff noise is what the user debugs instead of the cause. The session
id is kept, so the conversation survives and the task can be sent again once
signed in — which is what the message asks for. Pinned by
`scripts/test-credential-transport.test.js`.

## A dropped terminal frame presents as "server unreachable"

The panel said `Server unreachable… (retry 1 of 6)` against a server that was
alive, healthy, and had already refused the task. Two independent defects
stacked to produce that one wrong sentence.

**The server refused a model choice it did not have.** `main.py` rejected any
`model_config` whose provider was not in the registry. The panel sends
`{provider: ""}` on **every** task until someone opens Settings, so an unset
model — a completely normal state — was refused and the socket closed before
`resolver.py` ever ran. `BROTTO_FORCE_ENV_MODEL` and a plain `AGENT_MODEL`
both became unreachable, because the check that gated them sat upstream of the
thing that reads them. An empty provider now falls through: only a *named*
provider that is not in the registry is refused, and the resolver — the only
component that knows about env and per-user configs — decides the rest.

**The worker had no `case` for the frame the refusal sent.** On a refusal the
server sends `{"type": "task_failed"}` **directly**, with no result to wrap.
`background.ts` handled `task_result` and `task_error` but not `task_failed`,
so the frame was dropped and `taskTerminalEmitted` stayed false. The close
that followed was then read as a lost socket: `onclose` schedules a reconnect
whenever `taskInFlight && !taskTerminalEmitted`, and it was about to satisfy
both — against a server that had just said no, on a run that could never
start. Six attempts, ~30 seconds of "retrying", and no way to tell it apart
from a genuine outage.

**The rule this generalises to:** a refused run and a lost socket are the same
two events — a terminal frame then a close — and only the first frame tells
them apart. Anything that drops a terminal frame converts one into the other.
`task_cancelled` had the same hole and now has a case.

`RECONNECT_MAX_ATTEMPTS` is **3**, down from 6. Six is ~30s of a spinner over a
server that is not coming back; three is enough for a blip and short enough
that the panel admits the run is over. Raise it if a real network needs more —
the backoff, not the count, is what would not survive a bigger number.

Pinned by `scripts/test-no-orphan-frames.test.js`, which now enumerates **both**
boundaries — service-worker → panel, and server → worker. The second one is the
gap that let this through: the panel-side suite was already here and green.
It is scoped to terminal frames deliberately. A dropped terminal frame leaves
a run with a live clock and a doomed reconnect; a dropped non-terminal frame
loses an update. Only the first reads as a hang, so only the first is pinned.
