# Extension runtime: storage, policy, notifications, debugger

Read before touching `clients/brotto-extension/src/{background,debugger}.ts`,
`policy/`, or notification behaviour.

## Extension storage

- `model_config` (provider, model, context_window) → `chrome.storage.local` — persists across browser restarts (not sensitive)
- `api_key` → `chrome.storage.session` — in-memory only, cleared on browser restart; mirrors the existing pause-state pattern
- The first read after an extension update runs a one-shot migration that re-saves any legacy `{modelConfig: {model_config, api_key}}` shape into the new layout
- `deviceId` (one `crypto.randomUUID()`) → `chrome.storage.local`. See below; it is not a credential and nothing authenticates with it.

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

## Two boundaries that are structure, not settings

Both are unconditional, and both should stay that way:

- **Redaction happens in code**, at the single `deps.cdp.get_page_text()` call,
  before the prompt is built — `agent/redact.py`. The model is *told* about it in
  `policy_preamble` so it stops trying to reconstruct a `[redacted]` value, but
  that instruction is a behavioural control, not the boundary. Anything the model
  decides cannot change whether the redaction happened.
- **Page text never reaches disk.** `capture_page` records a 200-character
  digest; the `.pages.json` bodies sidecar and `Scratchpad.without_bodies()`
  both existed only to be switched off in secure mode and are gone. A run over
  an authenticated session leaves a manifest of what was visited, not copies of
  what was on it. The known cost: a resumed run recalls digests, not pages.

Note the digest is a *prefix* of the page, not a hash — a short page is its own
digest. "Never written to disk" means "never beyond 200 characters per page", and
a test that asserts on the wrong half of that passes for the wrong reason.

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
