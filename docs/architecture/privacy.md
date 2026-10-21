# Privacy and data

Where the user's data physically is, why that is the whole privacy story, and
where it is going.

## The one fact everything else follows from

**The agent loop runs on the operator's machine. The browser runs on the
user's.** The extension drives the user's own Chrome over CDP and streams
observations back to the orchestrator, so the orchestrator necessarily
transits the full visible text of every page the agent reads, every step.

That is not a bug and BYOB does not fix it. BYOK means the *model key* is the
user's; the *pages* still come to us. Anything that claims otherwise is wrong.

So the privacy posture is not "we do not collect your data". It is:

> Your data transits our box for as long as the task runs, and **stops there**.
> What persists is on your machine, and the things we keep forever contain
> none of it.

## What lives where, today

| Data | Where | Lifetime |
|---|---|---|
| Page digests (200 chars each) | `logs/sessions/<id>.scratchpad.txt`, server | until deleted |
| AX-tree sizes, page-text chars, changed-element chars | inside the audit document, server | until deleted |
| Task title, action names, URLs, typed input | inside the audit document, server | until deleted |
| What the agent aimed at (`turns[].actions[].target` — a ref like `0:1234` or an `x,y`, capped at 32 chars) and whether the page changed (`changed`) | inside the audit document, server | until deleted |
| Model config, `base_url` | `chrome.storage.local`, user, under a key carrying the account id on the cloud | until cleared |
| API key | `chrome.storage.local`, user, same account-scoped key | until the user clears it |
| Account id (`profiles.id`, the JWT `sub`) as a **namespace component** — which local key and which mirror rows a session belongs to | the top-level `accountId` key in `chrome.storage.local`, user (its own key, not a field in `settings`, so no writer reconstructs the blob to record one); and returned as a response field, stored in no operator table | until sign-out clears it, together with that account's model key, config and mirrored rows |
| Secure-mode policy | `logs/user_policies/*.json`, server | forever |
| Which account owns a session (`<id>.owner`) | beside the session, server | with the session |
| Waitlist signup and the beta roster — one row per address in `beta_access`: `asked_at` + name + batch (they asked), `approved_at` (we granted), `revoked_at` (we withdrew) | `beta_access` table in Supabase, server | until the operator drops it |
| Waitlist confirmation (the address, in transit and in Resend's request logs) | `api.resend.com` | theirs, not ours |
| Sign-in code (a keyed digest of a six-digit code) | `sign_in_codes` table in Supabase, server | ~10 minutes, then useless |
| Sign-in event (an account id, a /24 or /48 network, a browser/OS string) | `sign_in_events` table in Supabase, server | until the operator drops it |
| Sign-in code mail (the code, in transit and in Resend's request logs) | `api.resend.com` | theirs, not ours |
| Audit request bodies | whatever the model provider logs | theirs, not ours |

A waitlist signup is the one row here that came from **a stranger** rather
than from an account, and it is covered by "Writing new code here" below —
see *The waitlist is the first data from someone who is not an account*.

**`waitlist` no longer exists — `010` merged it into `beta_access`.** One
table, keyed by normalised email, answering one question: where does this
address stand in the beta. A row carries `asked_at` (they asked), `approved_at`
(we granted), `revoked_at` (we withdrew), plus `name` and `batch` — the two
fields the waitlist form actually asked for. `public.beta_status(addr)` derives
its same four answers from that one row: `revoked` beats `admitted` beats
`pending` beats `none`. Reordering those arms reorders the policy; see
`supabase/migrations/010_merge_waitlist.sql`.

**The waitlist write path may set `asked_at`, `name` and `batch` — never
`approved_at` or `revoked_at`.** Those two are written by
`scripts/beta-roster.sh` alone. That boundary used to be "the two tables must
stay disjoint"; it is now the columns the unauthenticated path is allowed to
name, and the reason is unchanged. The roster is the same *admission decision*
a `profiles` row records, entered by address so the operator can bulk-paste a
list, and it stays something the operator writes by hand.
**That script is the only way an address is granted or withdrawn**, and
deliberately not an HTTP route: an admin route that grants the beta is a
weakly-authenticated write into the front door of the hosted beta, whereas the
script runs on the operator's own machine over the Supabase CLI's linked-project
credentials, so there is nothing remote to compromise. **Removing a row from the
table does not revoke anyone** — see *The roster admits; `revoked_at` withdraws*
below. The moment anything turns a waitlist submission into a grant without a
human deciding, `POST /v1/waitlist` — the one route reachable with **no
credential at all** — answers "is this person in the beta?" to anyone who posts
an address. A stranger's row becoming an invitation by pipeline is that route
turned into a membership oracle; the same reason the waitlist answers a
duplicate exactly as it answers a first submit.

**A row is no longer the invitation; `approved_at` is.** `004` said "a row IS
the invitation", and that was true while a row could only come from an operator
paste. A waitlist signup is now a row with `asked_at` and no `approved_at`, and
it must not sign anybody in — so `_listed_for_beta` and `beta_status` ask for
`approved_at`, not for existence. **A lookup that still treats "row exists" as
"admitted" hands every waitlist signup a beta account.** And `approved_at` has
**no default**, which is the same guard seen from the schema: `POST /v1/waitlist`
inserts a row and does not name the column, so a default would grant the beta to
every stranger who asked for it. A default is a grant; the absence of one is the
refusal. (`added_by` was a column and is gone as of `009`.)

**Resend is a third party for waitlist addresses and for sign-in codes.**
An account's identity is Supabase's, but Supabase no longer mails anything: the
sign-in code is minted here and sent through the same Resend account the
waitlist confirmation uses (`session/sign_in_code_email.py`, design language
imported from `waitlist_email` rather than copied). That is the second
processor, and it is the same shape of disclosure twice — the address crosses
to a party that has no table of ours to look it up in. The two consequences
hold for both mails. **The address is never written to a log line here**, on any
path, including the failure paths — a transport exception quotes the request
body, and the request body is the address, so only the exception's TYPE crosses
into a log. And **the address appears in exactly one field of the request we
send**, `to`: no header, no tag, no `List-Unsubscribe` value carries it. There
is no way to make a third-party mail API not see the recipient; there is a way
to stop it being the thing we paste into their logs ourselves. (There *was* a
third copy, in an `Idempotency-Key` hashed from the address — removed
2026-10-12 because that header refused a legitimately new signup as a `409`,
which is a delivery failure bought for a duplicate-send guarantee the unique
constraint already gave. See "What the table guarantees, and why nothing
downstream re-checks it" in `waitlist.py`.)

Page text itself is **not** written to disk, and neither is the AX diff that
used to quote it. The `.pages.json` sidecar that was meant to hold page bodies
lost its last writer, and `ax_diff` went the same way in 2026-10-03: both were
counts and short digests, never content. Two tests hold that line —
`test_persisting_a_scratchpad_writes_no_page_text` and
`test_the_audit_document_holds_no_page_content`. The model still reads the page;
the record only says how much of it there was.

**A sidecar written before that still exists on an upgrading user's disk**, and
it holds what the current code no longer writes: tens of kilobytes of real page
text per session. It has no writer, so nothing updates or appends to it — but
nothing lists it either, which is the hazard. `delete()` names it alongside the
session it belongs to, and `delete_all()` sweeps it as an orphan; a user who
deletes the `.json` by hand strands it. Someone debugging "where did this disk
usage come from" on an upgraded install should look for `*.pages.json` beside
the session files. This repo's own `logs/sessions/` carried two, from Gmail
runs.

## The four rules

**1. Count events, never pages.** `tasks_run`, `active_users`, `signup` are
fine. Anything derived from an AX tree, page text, a URL, typed input or a task
title is not. The moment a counter is derived from what the agent *read*,
"monitoring activity numbers" becomes surveillance and cannot honestly be
described in a privacy policy or a Chrome Web Store disclosure.

**2. A document is the user's, not ours.** `logs/sessions/` is user data. It is
not telemetry, it is not a log, it is not something an endpoint may enumerate.
`GET /v1/sessions` currently returns every session's task title to any caller —
that is rule 2 violated in code, and it is closed by the auth work, not by a
docstring.

**2a. The transcript also lives in the user's browser.** The server's copy is
the only *complete* one, and on a hosted orchestrator that disk is ephemeral — a
dyno restart or a deploy wipes every transcript the user has, silently. So
`session_store.js` mirrors each audit document into IndexedDB, and
`historyEntries` unions the server's list with the mirror and with the panel's
own 20-row array. **The mirror lands as a mirror first**: the server stays
authoritative, the mirror is consulted only when the server cannot answer
(network failure, 404, or a 200 with `found: false` — which is what a wiped
dyno says about every session it ever ran). A full local-first move, where the
operator keeps nothing, is a separate and still-unbuilt change.

Three consequences, all deliberate. A delete calls
`brottoSessionStore.remove` (and `clear` for delete-all), because a mirror
left holding the only copy that outlives the server is the one deletion a user
cannot verify. No manifest permission is added: `chrome.storage.local` caps at
~10MB and would want `unlimitedStorage`, and OPFS may not be reachable from an
MV3 service worker at all — if it isn't, every write routes through a side panel
that is closed most of the time and the mirror stops recording exactly when a
background run ends. And the document is stored **verbatim**, because the replay
path wants the server's bytes and re-serialising is one more way for the two
copies to differ. Pinned by `scripts/test-session-mirror.test.js`.

**2b. The mirror is one server's, not the browser's.** `brotto-sessions` lives
in the extension origin, which every server a user ever points the panel at
shares. `historyEntries` unions mirrored rows into History on every path, so a
profile that used the cloud relay and was then pointed at a self-hosted server
showed the **cloud account's conversations** in the self-host History —
replayable, with that server never involved. The rule 2 failure is not "logs/"
this time; it is one operator's transcripts arriving under another's.

Rows are stamped with the server address on write and filtered on every read —
`list`, `get`, and `clear`, because "delete every conversation in the list" must
not reach rows the list never showed. `namespaceFor(base)` normalises a typed
trailing slash and case, so two spellings of one address are one server.

**`auth_mode` is deliberately not part of the namespace.** It was the other
candidate and it is the wrong one twice: mode is a property of the server at an
address rather than of the user, so it separates nothing the address does not
already separate — and `state.authMode` is null until the `/health` probe lands,
so keying on it made every row vanish from History for as long as the probe was
in flight.

**Rows written before this existed are shown under no server, and are not
migrated.** Backfilling them onto whichever address happens to be pointed at on
first read would be the friendlier reading and the unsafe one: it is the same
disclosure this filter exists to stop, decided by which address the user happened
to type. A conversation the user cannot see is recoverable; one shown under the
wrong account is not. `inNamespace(row, ns)` requires a non-empty namespace, so
an unstamped row is invisible rather than misfiled.

`ponytail:` the ceiling is real and named — **the namespace is a server address,
not an account**, so two cloud accounts on one relay in one Chrome profile share
it, because the panel cannot identify an account without parsing the credential
and parsing it is forbidden. Fix when the relay issues a stable per-account id the
panel can read as its own field. Pinned by
`scripts/test-mirror-namespace.test.js`.

**3. Redaction is not a privacy boundary.** `is_secret_field` runs at audit-write
time and catches *typed* secrets. It does not catch the page. What keeps the
page off disk is not redaction — it is that the write path for page content was
removed, which is a shape decision, and one that can be undone by a well-meaning
`begin_turn(..., ax_diff=…)`.

The shape, precisely: `begin_turn` takes `ax_diff_chars: int` — a **length**,
not the diff. The caller measures; the audit document stores the number. The
`.pages.json` sidecar that held the bodies lost its last writer when the
scratchpad moved to a manifest, and `ax_diff` went with it. What is left per
page is a 200-char digest. Two tests hold the line and both are load-bearing:
`test_persisting_a_scratchpad_writes_no_page_text` and
`test_the_audit_document_holds_no_page_content`. A signature that takes the
content back puts it all on disk again, and no amount of `is_secret_field`
behaviour catches it.

**A refusal is a place page text could enter, so the vocabulary is closed.**
Every outcome string an action returns becomes the model's history *and* the
audit document — both ours. `FOCUS_PROBE` in `observation/pointer.ts` therefore
returns `{ok, reason}` from a fixed set (`clear-select-noop`, `clear-threw`,
`focus-on-body`, …) and never a tag name or any other page-chosen string. The
whole list is `TYPE_AT_REFUSALS`, exported and asserted both ways by
`scripts/test-type-at.test.js` — every `reason:` in the source is in it, and
every entry in it is used. That is a deliberate improvement over the constant it
sits beside: `SELECT_ALL_JS` in `cdp/relay.py` returns
`'not-a-text-field: ' + el.tagName`, which is why `_PAGE_ECHO` and
`_strip_page_echo` exist in `harness.py` at all. The `type_at` path cannot
produce that echo, and `focusState` **reads `activeElement.value` in the page**
to decide whether a clear was a no-op — but only its `.length`, it returns a
boolean, and the value never crosses back out of the evaluate.

**One probe reads the page's text, and it reads it to answer a closed
question.** `GRID_DELIVERY_PROBE` (`observation/pointer.ts`) exists because a key
event leaves no trace of its own: when a grid replaces its own editor
mid-typing, the only way to know where the typed text went is to look for it.
It reads the `value` and the `textContent` of every `input`, `textarea` and
`contenteditable` in the document and compares each against a needle that is
the text the agent is *typing* — the agent's own payload, never the user's own
input — so it reads the contents of editors *other than* the grid's, which
nothing else on the typing path does. (The neighbouring read is narrower:
`editorText` brings the grid editor's **own** text back to the extension for a
local before/after comparison, and it never leaves the browser either.)

Three things keep this read where it is. It happens **in the page**, in the
extension's isolated world, so the page cannot observe the comparison and its
own prototypes cannot shadow the accessors that read the values. It is
**bounded to a recognised application**: the probe looks the document's origin
up in `GRID_ADAPTERS` first and refuses `grid-editor-unrecognised` without
inspecting a document that is not `https://docs.google.com`, so it is not a
general "read the page" capability — only the one application the grid path
was written for. And **nothing crosses back out**: the only thing it returns
is `in-grid`, `foreign` or `unknown`, and the only thing the server hears is a
refusal reason from the closed vocabulary above. So the table of what lives
where does not change: this is a read of page content, not a new place page
content lands.

**The identity read is the one page question with no page script in it.**
`FOCUS_PROBE` still reads `document.activeElement`, so it is page-answerable —
which is why it is now the *corroboration for the effect*, not the authority for
the identity. `bindFocus` reads `document.activeElement` in the tab's isolated
world and has the engine name the node it points at (`DOM.enable` →
`DOM.describeNode`), and **no page script runs to produce that answer**:
overriding the `activeElement` getter, or `Element.prototype.select`, changes
nothing the engine reports. The containment predicate that follows runs via
`Runtime.callFunctionOn` in the tab's cached isolated world
(`Page.createIsolatedWorld`, name `IDLE_WORLD`) where the prototypes are the
extension's, so the page cannot shadow the classes the "is this a text field"
test compares against. The two walls fail independently rather than resting on
the same script.

**The route changed, and the guarantee did not.** The read used to be
`DOM.getFocusNode`, and **Chrome removed that method**: it answers `-32601` on
every current build, so the identity read failed on every step, `bindFocus`
returned `focus-identify-failed`, and every `type_at` was refused on every
site. The read is now the same question asked by a route that still exists —
`document.activeElement` read in the extension's world, and the *naming* done by
the engine. The privacy property is unchanged and is worth stating on its own:
the page still cannot answer the question, because the world the question is
read in is the extension's, and the identification of the node is the engine's.
Nothing about the page's own script reaches this answer.

**The last main-world server read is closed, and the two walls are still not
redundant.** The server's `focus_id` pre-check was a *main-world* `evaluate`,
where the page owns the globals that resolve `document.activeElement` and could
make the check silence itself. It now sends `isolatedWorld: true`, so it reads in
the extension's world; the DOM is shared, so the element named is the same object
either way. `focus_id` and `bindFocus` answer different questions and neither is
spare: `focus_id` answers *intent* (was this field plausibly in focus before the
dispatch), which no engine call can answer; `bindFocus` answers *identity* (is
this node the one that holds focus now). A world that cannot be created refuses
rather than falling back to the main world, so the failure direction is a
refusal, not a silent downgrade.

Neither the coordinate bounding (`boundedPoint` reads the live viewport; the
point never leaves the tab) nor the engine-sourced node read sends anything off
the machine. Both are strictly *less* page-derived than what shipped.

Fusing `type_text` into one action also cut the extension's screenshots on that
path from three to one, since a `captureObservation` (and therefore a
`Page.captureScreenshot`) follows every action. Fewer is better and neither
number is a boundary.

**3a. `redact_text` had one call site, and the README's Privacy section promised two.** The policy
says page text is redacted "on every task, with no setting to turn it off". That
was true of `harness.py` and false of `suggest.py`: the idle-suggestions path
reads a page with **no task in flight** and shipped its text to the provider
raw. Not a subtle leak — a card number visible on a checkout page, sent by a
feature the user never turned on for that page.

The lesson is the shape, not the missing call: **a promise made in a published
policy is an invariant that has exactly as many call sites as the code has
paths.** `grep -rn redact_text src/` returned one hit and read like a complete
answer. It is the same class as the auth work above — a control named in public
prose, implemented in one place, with the second place unbuilt. Both are now
pinned by a test that asserts the secret is absent from the prompt that would be
sent, not that a function was called.

**3c. And the tool path was a third, with a second step to reach it.** Fixing
3a made `grep -rn redact_text src/` return two hits, and both were step-shaped:
the per-step `get_page_text` and `suggest.py`. Neither is the whole set of paths
page text takes, and the missing one was the one the **system prompt itself
advertises** — `prompt.py` tells the model to call `read_page_text`. That handler
took the CDP text raw, stored it raw as the memory body, and `recall_memory`
handed the raw body back on any later step. `guardrails.py` exempts
`read_page_text` from the sensitive-action gate, so the model could reach it
without approval.

The guarantee was bypassable by a model that simply called the tool on a second
step — which the prompt tells it to do. The handler now calls the same
`redact_text` the step path does, and **the redacted form is what is stored**, so
the recall path is covered by construction rather than by a second call site.
That is the part worth keeping: redacting on the way out but storing the raw
string would have left the text sitting in memory for a later step to fetch.

Two things did *not* change, deliberately. There is still no setting — the
per-step path's comment about secure mode applies identically here, and a
credential is a credential whether the page arrived in the prompt or through a
tool. And redaction is still **best-effort pattern matching**, not a guarantee
that no sensitive string reached the provider; it misses a novel identifier
format and occasionally eats an order number. The policy page says "best-effort"
for that reason, and nothing here moves it toward "guaranteed".

The lesson is 3a's again, one level on: **grep found every call site of the
function and none of the paths**, because the two are not the same list. The
question is never "where is this called" but "every way does this text get
here" — and for page text that is per-step observation, the tool, the recall,
and the suggestions path. Pinned by three tests in `test_memory_capture.py`
asserting a known card number is absent from the recalled body, from the stored
body and from the digest.

**3d. A per-action outcome record is user data too, and its two fields are on
opposite sides of the line.** `turns[].actions[]` now carries `target` and
`changed` alongside the action name and args (`schema_version: 3`; the fields
themselves and the deploy-ordering consequence are in `conversation.md`). Both
are ours to record and both are inside the user's audit document, so neither gets
a carve-out. What is worth writing down is *why each one is still safe*, because
the safe answer is not the same for both and asserting it silently would be the
3a mistake in a new key.

- **`target` is an identifier, not page text.** It is the AX ref the model aimed
  at (`0:1234`) or the coordinate pair for a `*_xy` action — two forms that are
  both under 12 characters. The bound is `MAX_TARGET_CHARS = 32` and it is a
  **cap, not a filter**: it does not inspect the string, it only refuses to grow
  without bound. The contract is that a caller passes an identifier, and the cap
  is the backstop when a well-meaning future caller passes a caption or a typed
  value instead. It bounds the damage; it does not prevent it, and this doc
  should not be read as saying a 32-char page string is acceptable.
- **`changed` is a measurement, and that is the whole reason it is safe.** It is
  the extension's pixel delta — whether the observation differed from the
  pre-action one — read by the harness from the extension and never taken from
  the model. So it is a **derived integer and a boolean, not page content**: the
  same category as the `ax_diff_chars` length in 3, which stores a length
  precisely so the body does not have to cross. Being a measurement is what
  puts it on the safe side of "the user's transcript is user data" — *not* the
  fact that it is a boolean, and not the fact that it happens to be hard to
  reverse. If a future change makes `changed` carry *which* region moved, or a
  tile index that maps back to a rect, it stops being a measurement and starts
  being a pointer into the page, and this paragraph is the thing that is then
  wrong.

**`changed` is never a model self-report (D5), and that is a rule rather than
an observation about the current wiring.** `changed` is `deps.canvas_changed` and
nothing else; a model saying "I clicked submit" is not evidence, and a model
claim belongs in `outcome`, which already carries what the model was told. D5
here is load-bearing because the alternative is worse than a wrong boolean: a
self-reported `changed` would be the model grading its own homework, written
into the same field a measurement writes, with no marker distinguishing them. A
reader of the audit document could not tell which one it is reading.

**The tri-state is the privacy-relevant part as much as the correctness one.**
`changed` is `null` whenever we could not tell — a first observation, a
navigation, a canvas page with no tree to compare — and the default is `None`,
never `False`. `False` is a claim that the page did not change; `null` is a
claim that we did not look. Collapsing them would write a false statement about
a page into the user's own record, which is the same silence-is-not-a-
measurement error as elsewhere in this doc.

**A cap on volume, and it is recorded rather than silent.**
`MAX_ACTIONS_PER_SESSION = 5_000`: a 150-step run records a few hundred of these
and stays readable, while a model stuck in a dispatch loop must not grow the
document without bound. Over the cap the entry is **dropped and counted** in
`totals.actions_dropped` — never truncated mid-sequence, because a half-written
action is indistinguishable from a real one. Both constants are in `audit.py`
beside the comment that says what they are for.

Pinned by `tests/test_grounding_outcome.py` — including the case that matters
most, where the fake executor asserts the page updated on *every* action and the
assertion is that `changed` is still `None`.

**An approval caveat is card text, and the split that keeps it out of the audit
is structural, not editorial.** A coordinate click cannot be checked before it is
dispatched (`agent-loop.md` has why), so every coordinate approval card carries
the caveat that the destination is unreadable in advance. It rides `_ask_user`'s
`frame_reason`, while `reason` — the argument `audit.record_prompt` is called
with — carries the audit reason. Merging them would put "this may leave the
site" into every user's audit document, and that sentence is the one part of the
approval with no domain and no page content in it. **A reader of the audit
document sees that a domain was approved; the caveat about what could not be
checked for it exists only on the card the user actually saw.**

**A pre-flight `click_cross_domain` event is a grant, and today it is a grant
only to the run that asked for it.** The gate records `policy_events` with
`user_decision: "approved"` *before* the click it authorizes — the consent to
the site is the fact being stored, not the navigation — but neither of the two
paths that outlive a run reads it back. `_resume_state` restores
`visited_domains` from `first_navigation` and `first_time_seen` kinds only, and
the grant file is written by `_persist_domain_grant`, which today has one caller:
the first-time-seen approval. So a resumed session, and a new session on a new
process, re-asks about a site the user already said yes to in this one.

**Not built, and recorded here so the asymmetry is not mistaken for a policy.**
Either fix is small — add `click_cross_domain` to the kinds `_resume_state`
restores, and call `_persist_domain_grant` where the pre-flight approval lands —
and neither is a change to what the *card* shows. Until one ships, this doc is
the only place the difference is written down.

**3e. Two lists, because "redact this value" and "this run touched a credential"
are two different claims (2026-10-20).**
For a while one list, `run_secrets`, was doing both jobs, and that conflation was
the bug. It is now split, and the split is the evidence bar:

- **`run_secrets` takes every redacted value.** It is the *scrub* list, read by
  `_safe_thought`, `_safe_reasoning` and `_summarise_outcome`. That is the
  reason it exists: a later step's thought must never quote a value the agent
  typed on an earlier one. It previously took only the latched subset, so it is
  now strictly **more** scrubbing than before, not less.
- **The veto is `_PixelVeto`**, and the three veto sites read it through one
  helper — `get_page_delta`, `_vision_fallback` and `_execute_action`. It holds
  two things, and they have two different lengths: `latched`, the positive
  identification that a credential was touched, and `armed_at`, the step of an
  ambiguous write. `latched` is run-wide; `armed_at` opens a window. That
  window is 3g.

**Redaction fires on the absence of evidence; the run-wide veto cannot.** "This
one value looks like a password" concerns one argument in one action and must
fail closed, because you cannot prove a canvas cell is not a password widget.
"This run touched a credential" vetoes pixels for *every remaining step*, so it
requires positive evidence, and `_redact_if_secret` / `_redact_press_key` return
that as a second element rather than folding it into the first.

What the conflation cost, in a live Google Sheets run: the grid is a `<canvas>`,
its AX tree is 62 targets and does not change when you type, so the pixel delta
and the screenshot were the **sole** signal that an edit landed. One
blank-named grid cell latched the flag, and the agent went blind for the rest of
the run — re-clicking the same cell seven times. A false positive here was never
one login; it was the run.

**The second instance of the identical bug, found only because the first was
fixed.** `_redact_press_key` returned a bare `bool` that its caller turned into
`latch=True`, on a path that answers "unknown" three times out of four because
no relay implements `focused_attributes()` yet. Every literal keypress — every
Enter on a canvas — latched the poisoned run. The lesson generalises past this
file: **"fix the branch that was named" and "fix the bug" are different
achievements, and the grep is what tells you which one you did.**

**The veto rule itself did not weaken.** `redactions or run_secrets` still vetoes
the delta and the screenshot, the veto is still there on every path, and there
is no new setting and no override. What changed is which inputs are allowed to
*assert* that the run saw a credential — not what happens to a run that did.
The second change was to the *duration*, and that is 3g: the run-wide claim is
now one of two, and the other one has a window.


**3f. A secret-name boundary is a word split, not a lookaround.** The old
matcher matched mid-word: `tokenize`, `secretary`, `author`, `authority` and
`authenticated` all read as credential fields, and so does an exported
`Session ID` column header on a spreadsheet. `auth(?:orization)?` had no
boundary at all. Every one of those is a **run-wide latch**, and one false
positive vetoes perception for the rest of the task — so on a document app the
detector was close to unusable, while the page it was protecting was a
spreadsheet.

The first fix expressed the boundary as `(?<![A-Za-z])…(?![A-Za-z])`. It does
not work, in both directions. **Under-matching:** only ASCII letters are
excluded, so `access_token` is not `\btoken` — `_` is a word character — and
every compound snake_case name, the most common real field shape, walks
straight past the single-word rule. **Over-matching:** when that boundary was
later tightened, four genuine credentials stopped being detected —
`Session identifier`, `sessionIdentifier`, `authorizationCode`, `pinNumber`
— because a trailing boundary fires after the *short* alternative inside
`identifier` and `Number`. The test suite stayed green, because the tests had
been written against the broken matcher. A credential detector that silently
stops matching is worse than one that over-matches, and **nothing in a passing
CI run tells you which of the two you have.**

So the boundary is not a lookaround over the raw string — `_`, `-` and camel
case each defeat one — but a **normalisation first**. `_secret_by_name` splits
the accessible name into whole words (`_NAME_SPLIT_RE`: any non-alphanumeric
run, the lower→Upper hump, and the last capital of an acronym run), strips
trailing digits from each (`Password1` is `password` plus a number), then
matches any single word against `_SECRET_WORDS` and **every contiguous run of
words** against `_SECRET_COMPOUNDS`. `apiKey`, `api_key` and `API key` all
reduce to the run `apikey`, which is why camel case needs no pattern of its own.

**The contiguity requirement is load-bearing.** Matching only the fully
flattened name broke the clarify question, which arrives as *"what's the
verification code?"* and not as a bare label — only the run `verification code`
says `verificationcode`. And it is also what keeps this from becoming mid-word
matching again, because contiguity is what makes `TokenBucket` the run
`tokenbucket` and `Session Name` the run `sessionname`, neither of which is a
compound. The single-word list is deliberately short: `token`, `session`,
`code` and `id` are absent, and their real compounds are enumerated instead, so
`tokenize`, `Session Name` and `Cell A1` stay ordinary words while
`access_token` and `SessionID` do not.

**Only the detector moved.** `type="password"` still wins outright whatever the
name says — it is checked first and the name rules only ever add — and no caller
of `is_secret_field` was touched, so nothing outside the matcher changed
behaviour. The two false positives the old boundary was *accepted* with,
`myAuthorship` and `clientSecretariat`, are now simply not matches.

Pinned by `tests/agent/test_secret_field_boundaries.py`, which declares one
partition of positive and negative labels and asserts it in both directions —
so a boundary change cannot move a label from one side to the other without a
single assertion going red.

**3g. The veto has two durations, because the two claims do (2026-10-21).**
`_PixelVeto` (`agent/harness.py`) holds both claims the veto has to serve, and
they do not have the same length.

- **`latched` — positive evidence, run-wide, never releases.** A field that
  positively identifies as a secret (`is_secret_field`). A credential can be
  rendered into this page or the next at any point in the run, so nothing
  shortens it.
- **`armed_at` — the step of the newest ambiguous write.** A value that was
  redacted but could not be classified: a canvas cell, a field with no
  accessible name, a literal keypress with no focused element to read.
  `open(step)` is `latched or 0 <= step - armed_at <= _AMBIGUOUS_PIXEL_WINDOW`,
  and the window is 2 — so the shutter is closed on the armed step and the two
  that follow, and open again on the third.

**The window closes the actual exposure, and then releases.** A value cannot
have been rendered before it was typed, so the only exposure from an ambiguous
write is the observation taken *after* the keystroke: the page paints it into
the DOM, a password manager echoes it back, a live-validated form redisplays
it. Two more steps have had a full observation each by then — the stability
gate, the AX walk, the repaint — and the claim is spent. Latching it instead
vetoed pixels for the rest of the run, and on a canvas that was the run's only
channel.

**The window is keyed on the step number and is read, never consumed.** Nothing
decrements it and nothing resets it. `deps.step_number` is the unit because it
is the only one a `break`, a terminal action, `ask_human`, a cancellation or
`deps.result` ending the loop cannot consume unevenly — and a step that calls
three veto sites cannot eat the window and make it narrower than advertised. A
second ambiguous write does not shorten an open window either: `arm` takes the
`max`, so a later write re-opens the shutter rather than closing it early.

**The window includes the armed step.** The keystroke has just happened and
nothing has settled; that is the least safe moment in the run, not the most,
and closing it costs nothing — the pixels it suppresses are pixels of a page
mid-typing.

**One place turns the window into an answer, so the delta and the screenshot
cannot disagree.** `_pixel_latch(veto, step)` returns the latched values, or
`["[redacted-value]"]` while an ambiguous window is open, or nothing at all.
The relays read the list for truthiness and never log it, so the marker carries
a fact and not a value: no typed text is anywhere in it.

**The veto rule itself did not weaken.** `redactions or run_secrets` still
vetoes the delta and the screenshot, on every path, and there is no new
setting and no override. What changed is which inputs may *assert* that the
run saw a credential, and for how long.

**The asymmetry is intended.** The *value* of an ambiguous write stays on the
run-wide scrub list for the whole run, so a later thought can never quote it.
Its *pixels* are withheld for the window only. The text of a value is scrubbed
everywhere it might resurface; the picture of it is withheld for as long as it
could plausibly be on screen.

**Still open, and recorded as open rather than designed.**

- `type_xy` and a literal `press_key` character are always ambiguous writes,
  so they arm the window on most canvas steps — and a run that keeps typing
  keeps re-arming it. The window is bounded in time, not in the presence of
  continuous writing, and on such a run the delta is withheld on most steps.
  That is the same evidence channel the canvas case depends on, so the canvas
  case is not closed by the window. **It is now one channel of two, on a page
  that offers a second.** Pressing the accessibility shortcut a canvas app
  names in its own page text — which the prompt permits only for the one chord
  it allows a page to direct, Option/Alt + Z with Command or Ctrl — puts the
  selected cell's address and content in
  the tree, and a pixel veto does not withhold the tree — so a canvas step can
  be checked without photographing anything. **That changes nothing here**: the
  tree is not redacted either, so a written value is visible in it exactly as
  it is in a DOM form, and no veto, redaction rule or capture budget was touched
  to get it. `agent-loop.md` owns the mode.
- The accessibility tree is the other channel redaction does not reach, and
  nothing here closes it.

Pinned by `tests/agent/test_pixel_veto_window.py`, which asserts the window
cannot be narrowed by the number of veto sites a step calls, that a second
ambiguous write re-opens rather than shortens it, and that the marker carries
no typed value.

**3h. The record and the model read different lines, and they have to
(2026-10-21).** One marker used to serve two audiences, and the model was the
wrong one for it.

**The split.** A value the harness will not record is written into two places,
and they are two different audiences with two different questions:

- **The record** — the audit document on disk, and the extension's IndexedDB
  mirror of that document — keeps `audit.REDACTED`, `"[redacted:password]"`.
  It answers *what was written down*, and it is read by a person or a grep,
  months later.
- **The model's line** — the action line in the trace, the narration, the
  step's outcome summary, and the thought that is rendered into the next
  prompt — carries `prompt.WITHHELD`, `"[withheld from the record]"`. It
  answers *what the model is allowed to see*, and it is read by a model that
  will act on it.

**Why one marker could not serve both.** The old token was
`"[typed into a secret field]"`, and it made a claim about a **field**. The
model read that claim as a claim about its **own input** — the action line
puts the marker on the line describing the action the model just took, so the
nearest claim is "my input was treated as a secret and swallowed". On a canvas
app every cell is unclassifiable, so every typed value was marked, and the
model reached a conclusion that was consistent with the evidence it had: that
the harness was blocking it. It then stopped typing and spent the run looking
for a block that did not exist. Nothing was ever refused; the text reached the
page unmasked. The only thing that was wrong was the sentence.

**The guarantee did not move, and that is the point of the split.** The value
still reaches **none** of: the audit document, the extension's mirror of it,
the model-facing trace, or a later step's thought. Only its **length** does,
and the length is there so a consumer can tell "typed something" from "typed
nothing". The dispatch was never the problem — the value is sent to the page
exactly as the model wrote it — so nothing about what is stored, what is kept,
what is scrubbed, or what is retained has changed. What changed is the label
on the line, and who is allowed to read it.

**A marker with no definition is a hole in a closed vocabulary.** The
redaction vocabulary is closed on purpose: every token in it is a promise that
the token means one thing. The old marker was a token the prompt had never
defined, so the model supplied the definition — the worst one available. The
fix has two halves and both are needed: the token now says what happened
("withheld from the record" — a fact about the record), and `SYSTEM_PROMPT` now
defines it, including the part that is a claim about the world: **the text was
typed**, a typing that did not reach the page is reported as a failure
instead, and the value is not recoverable from the marker, so read it back off
the page or ask the user. `agent-loop.md` carries the loop's half — what the
model did with the old token, and the rule that a marker the model has no
definition for is a marker the model will interpret.

Pinned by `tests/agent/test_withheld_marker.py`, which asserts the two
markers, the prompt's definition of the model-facing one, and that the value
appears in neither audience's line.

**3b. The policy said "one deployment" and there were two.** `PRIVACY.md` opened
with *"Brotto has one deployment. You run the orchestrator… There is no
Brotto-operated service, we run no servers"* and closed out each section with a
claim scoped to that: *"None of this reaches us"*, *"we do not receive your
data"*, *"the machine holding them is yours"*, *"Deletion is entirely yours, and
it is immediate"*. Then `agent.brotto.dev` shipped and every one of those became
false at the same time — **not one line of code changed**. The operator flipped;
the prose did not follow, because prose is not covered by the scan, the ratchet,
or any test.

The shape is the same as 3a inverted. 3a is *a control named in prose that the
code implements once*; 3b is *a fact stated in prose that the code stopped
obeying*. Neither is a bug in the code, so neither would have been caught by
anything written against the code. What catches 3b is re-reading the policy
against the deployment list before a listing ships — and `notifications` is the
same class one over: a permission in `manifest.json`, on by default in
`background.ts`, that the Security section never named, so the CWS per-permission
justification had nothing to answer with.

What 3b is *not*: a reason to weaken the self-host story. Every fix scoped a
claim to a deployment. "There is no operator between the agent and your
documents" is still the whole argument on self-host, and it still gets said —
as a property of that deployment rather than as a universal.

**4. Retention is a feature, not a cleanup task.** `_prune_sessions` evicts
in-memory state and never touches disk. The user can now delete a session or
all of them (`DELETE /v1/sessions/{id}`, `DELETE /v1/sessions`, both behind
`AGENT_SECRET`), and the panel exposes it behind a confirmation.
`BROTTO_RETENTION_DAYS` is **built** — an hourly sweep in `main.py` ages
sessions out, and it is off unless the operator sets the variable. (An earlier
note here said "still unbuilt", which was true when written and stopped being
true; the README's Privacy section has been right the whole time, which is why the public doc
gets the last word when the two disagree.)

Note that deletion is scoped to sessions. `logs/user_policies/` and
`logs/user_models/` are keyed by install id and survive it — and the policy
file is the one holding the approved-sites list. The README's Privacy section now says so, but
there is still no "delete everything" path.

## A screenshot is a gate, not a redaction pass

`Page.captureScreenshot` added a third channel of page content, and it is the
only one the redaction does not merely weaken — it does not reach it at all.
`redact_text` is pattern matching over strings; a JPEG is pixels. A card number,
an OTP or a balance drawn into a `<canvas>` reaches the provider whole, where
the same characters in page text would have become `[redacted]`. Anything
honest about this has to say **no coverage**, not partial coverage, so
`PRIVACY.md` now carries it as a third carve-out beside the accessibility tree
rather than leaving it inside the sentence that promises redaction.

**A step whose redaction found something does not get a screenshot.** The gate
is asked after `redact_text` reported a hit on that step, and it refuses. It is
worth being exact about what that buys, because it reads stronger than it is:
it is a guard on the **text** channel, so it cannot fire for a secret that exists
only as pixels — which is precisely the canvas case the screenshot exists for. A
card number drawn into a `<canvas>` is invisible to the redactor, produces no
hit, and so photographs. What the guard does buy is the honest middle case: a
page that *also* exposed the secret as a string — a field label, a paragraph, a
table cell — is not photographed on top of it. It narrows the class; it does
not close it.

**The rule is default refusal, and the reasoning is that a denylist cannot be
completed.** The alternative shape — a list of URL patterns where capture is
refused — reads like the obvious fix and is untestable here, for a specific
reason. The trigger that reaches this gate is *nothing the harness can see is
about the task it was given* (see `_sparse_for_task` in `agent-loop.md`), and
that is a fact about how a page is
**implemented**, not about how sensitive it is. Google Docs, Figma and a hostile
canvas page are byte-identical to that predicate. A chart and an OTP rendered
on a canvas are the same page to anything that inspects the URL, so no URL shape
distinguishes them. A pattern list against that is a denylist over an open-ended
threat, and its failure mode is the dangerous kind: it would be untestable for
completeness while reading in review as if it were complete — the same shape as
the security-control paragraph `PERMISSIONS.md` used to carry and had to retract.

**Default-off puts the proof on the safe side.** Capture is a *new egress
channel*, and every other channel here is either redacted unconditionally or
explicitly asked for. Those are different claims: redaction having no off switch
only ever narrows what leaves, while a new channel having no off switch widens
it. So the switch is the user's, on their own server, and off until they set it
— `BROTTO_VISION_CAPTURE` accepts only `on`/`1`/`true`/`yes`, and anything
unparseable is a refusal, the same safe reading as `AGENT_SECRET` and
`BROTTO_RETENTION_DAYS`. The cost is real and is the price: until it is on, a
canvas page is reported as **unseen** rather than described. A refused capture
costs one task its eyes; an unredacted card number in a provider's logs does not
come back.

**The blocklist is reused, not duplicated — and reused, then widened locally.**
`screenshot_block_reason` starts from `check_domain_policy` over the blacklist
the user already wrote — a second list of "sensitive URLs" would be one more
thing the user never sees and cannot audit, and two lists that must agree is a
known failure shape in this repo (the mirror of one server's transcripts
appearing under another's is exactly that, see 2b). The extension carries its
own sensitive-URL pattern list at `debugger.ts:294` for a *different* purpose
— it warns before you attach to a banking tab, and it is advisory; this one
refuses. The reordering inside `screenshot_block_reason` follows the same rule
the prompt-injection refusal uses: the switch is checked first, so a run with
capture off is not told anything about the domain it was on.

**But `check_domain_policy` is the wrong shape for a gate, and it fails open
here.** It returns `n/a` for anything with no eTLD+1 — an IP literal, a single
label like `localhost`, garbage — *before* the blacklist is consulted, and `n/a`
is not `BLOCK`, so `http://192.168.1.1/` and `http://intranet/` were photographed
with no list in front of them at all. And its wildcard is `*.bank.com` means
subdomains **only**, over an eTLD+1 and a `www.`-stripped hostname, so
`https://www.bank.com/` did not match `*.bank.com` — the one spelling a user
actually types, for the site they typed it for. A user who believes a site is
blocked, and is not, is worse off than one who never tried.

So the widening is **local to `screenshot_block_reason`**, and that is the whole
reason it is not upstream. `check_domain_policy` is shared with the harness's
approval path (`harness.py:1711`, `:1884`, `:1964`, `:2692`, `:2781`, `:4685`), where `n/a` means
*do not prompt* and a wildcard that quietly widened would move the extension's
domain-approval behaviour — a different subsystem with its own doc and its own
semantics. The gate therefore resolves the host itself (`urlsplit().hostname`),
refuses outright when there is no resolvable host (`unresolvable_url`), and
matches the raw host against the blacklist with `*.suffix` also covering
`suffix`. Widening only ever refuses, which is the only direction this gate is
allowed to move. Pinned by `test_the_wildcard_semantics_are_unchanged_here` in
`tests/test_policy_gate.py`, which fails if the shared function is ever made to
do this instead.

**There is no exception for a local page.** Someone photographing
`localhost:8080` has told us nothing about whether it is safe, and the answer to
"I want to capture that anyway" already exists as `BROTTO_VISION_CAPTURE` — so
the unresolvable case is a refusal, not a second switch.

**Two labels is not a registered domain, and the first version of that check
thought it was.** `_raw_host` refused an IP literal and a single label, on the
reasoning that both are names inside somebody's network — which is true, and
incomplete for the same reason `check_domain_policy` was. `http://printer.local/`
and `http://gw.home.arpa/` have two labels each, passed straight through, and
were photographed with no list in front of them. The fix is a deny set of
special-use suffixes, matched as a suffix against the already-case-folded host
so `printer.LOCAL` cannot slip past on spelling. It returns `None`, so these
raise the *existing* `unresolvable_url` refusal — no new reason, nothing new
in the closed vocabulary the model reads.

**The set's admission rule is that an RFC reserves the label, and it was
enforced against the set itself.** The rule is what makes the set defensible
rather than a list that accreted: a reserved label *cannot* name a public site,
so refusing one costs no legitimate capture and closes the case for good. Five
entries did not meet it — `internal`, `intranet`, `lan`, `home` and `corp` —
and they are gone. They were plausible words people type on a LAN and nothing
more; each one refuses a potentially registrable host on the strength of a
typing habit while leaving the class behind it just as open. They were added in
rounds rather than derived, and reviewing the set is how that showed up.

**`dev` is the one entry that is not RFC-reserved, and it is in on purpose.**
`.dev` is a delegated TLD, so by the rule above it does not belong. It is here
because deleting it once did not work: a gate whose only answer is *refuse*
refuses one registrable host just as readily as a LAN box, so `agent.brotto.dev`
— the first-run wizard's and the fallback UI's relay — was the one thing the
gate stood in the way of, and removing the label unblocked it by re-opening
every `.dev` name on every LAN. `box.dev` walked straight through, and CodeQL's
security reviewer flagged the widening correctly.

**Our own relay is therefore refused, and that is now the deliberate trade.**
An intermediate version granted it by exact host through `_FIRST_PARTY_HOSTS`;
that grant is gone. A name-based exemption on a channel that cannot be redacted
is the wrong shape — the screenshot is a bitmap, nothing downstream can strip a
host out of it — and the reviewer's finding was accepted over the case for
keeping it. The cost is one task losing its eyes on a canvas page pointed at
`agent.brotto.dev`, which is the acceptable failure this gate's own header names.
Deleting the exemption is the cheap direction: it can only ever refuse more.

Pinned by `test_our_own_relay_is_refused_too`, which asserts `agent.brotto.dev`
**and** `box.dev` both red.

**DNS resolution is deliberately not used instead.** Deciding `.dev` by lookup
was the other suggestion, and it is declined: a resolver on a refuse-only gate
turns a transient timeout into an ambiguous refusal, and it puts a synchronous
network round-trip inside the agent loop on a path whose premise is that capture
is cheap and fails closed on its own evidence. A blocking lookup on the agent
hot path to save one screenshot is a bad trade. Refusing by name covers the
ground that matters — `192.168.1.1`, `localhost` and `printer.local` are all
caught before any I/O.

**A curated set, not a public-suffix list.** The alternative is requiring the
rightmost label to be a real public suffix, which closes the whole class rather
than a list of it, and `domains.MULTI_PART_SUFFIXES` is not a TLD set and
cannot be extended into one without importing a ~10k-entry PSL. That is the
wrong trade for a gate whose only answer here is *refuse*: every entry in the
set resolves to the same answer, so the table buys nothing a curated set and its
citations do not. Pinned by `test_an_internal_suffix_is_refused`, and
by `test_a_public_host_is_still_allowed_when_the_switch_is_on` beside it —
a deny list that refused everything would pass every other case in the file.

**What redaction's silence means for the model.** The refusal reason is a closed
set of machine words (`capture_not_enabled`, `domain_blocked`,
`unresolvable_url`) and the model is
never told which — it receives one sentence, "capture was refused by policy."
Otherwise a model could infer, from a refusal, that *this particular* URL would
have been blocked, which turns a local policy into an oracle the user can be
probed through.

### A canvas page is photographed more often, never more safely

The gate above is unchanged — same veto, same switch, same blocklist, same
"transit only" rule — and the amount of the user's screen that leaves the
machine on a canvas page has gone **up**. That has to be said here rather than
left to be inferred from a ceiling constant in another file.

**What changed.** The model's picture on a canvas page used to be capped at
three per task, and the reason was a cost guard: three is a *supplement*
budget, and it is only the right number on a page the agent can otherwise
read. On a canvas page the content is in neither the accessibility tree nor
the page text — **as the page arrives**; an app that names an accessibility
shortcut in its own text puts the *selected cell* back in the tree once that
is pressed — and the prompt permits a page to direct exactly one chord,
Option/Alt + Z with Command or Ctrl, so a page naming any other chord gets
nothing. It is a verification channel and not a way to read the sheet, and
which is why the ceiling below is unchanged rather than raised. So the picture is
the perception channel, and the ceiling is now
`_MAX_CANVAS_CAPTURES_PER_TASK = 40` — the picture arrives on **every step of
the task** while that budget lasts, instead of on three of them. The approval
card's picture is a second, separate budget (`deps.screenshots_taken` against
`deps.sight_captures`, split because one counter for two buyers starved the
model's on a canvas page). So a long canvas task now sends up to forty
pictures of the user's screen to the model provider where it sent at most
three, and the number of pictures the **user** is shown is bounded the same
way.

**What did not change, and is the whole safety story.**

- The `redactions or run_secrets` veto is still checked **before the model is
  even resolved** and again inside `_capture_page` — the shared guard every
  capture site routes through. A step whose redaction found something is not
  photographed, and an empty redaction dict is the absence of a detector
  firing, never clearance.
- `BROTTO_VISION_CAPTURE` is still default-off, still accepts only an
  explicit `on`/`1`/`true`/`yes`, and still unparseable-means-refusal. A
  capture-off run photographs nothing, canvas page or not.
- The domain rules are the same ones: `screenshot_block_reason` refuses a
  blocked domain, an unresolvable host, and the curated special-use suffix
  set, and it refuses our own relay too.
- The base64 is still **transit only**: on the turn, into the prompt, to the
  provider — never in the audit document, never in a log line, never in an
  outcome, never on disk. The one log carries a byte count and nothing else.

So the sentence to keep in view is: **a canvas page is photographed more
often, never more safely.** A higher count on the one kind of page where the
pixels are the only content is a deliberate trade — a run that cannot see the
grid fails — and it is a trade that buys *reach*, not *permission*. The gates
are the gates.

**The CSS-resolution change is not a new disclosure.** Asking for the
CSS-pixel copy instead of the device-pixel one is **the same viewport and the
same content with fewer pixels**: the frame is the same page, at the same
moment, downscaled before it is sent. What it changes is the size of the
picture and the size of the coordinate space it agrees with, not what is in
it. The number of images and the number of pixels in each are the only two
things that moved, and the first is the subject of the paragraph above.

**The card's picture is not egress to a provider.** The approval card is
shown to the user, on the user's own machine, and the model never sees it —
which is why its budget is counted separately rather than being a second
consumer of the model's. It does transit the server on the way to the panel,
and that is the same local relay the rest of the run uses.

## Where this is going: local-first

The target is that the orchestrator holds **no session history at all**.

```
┌─ user's machine ────────────────┐        ┌─ operator's box ──────────┐
│ extension                       │        │ orchestrator             │
│  IndexedDB                      │        │  no state dir            │
│    sessions/<id>.json           │        │  no audit.py             │
│    sessions/<id>.scratchpad.txt│        │  no policy files         │
│  chrome.storage.local           │        │                          │
│    model_config, policy, prefs  │        │  per step:               │
│                                  │        │    in  page + history    │
│  step N ────────────────────────┼───────▶│    out decision          │
│  step N+1 ◀─────────────────────┼────────│    (no history retained) │
└──────────────────────────────────┘        └──────────────────────────┘
```

**The harness is already stateless per step.** Every `agent.run` is a freshly
built prompt with no `message_history` — `step_summaries` + `scratchpad` *are*
the model's entire history. They are server-side state today purely by
accident of where the loop runs. Move the loop's *state* to the client and the
client sends it up each step; the server keeps nothing.

Why this is cheap rather than a rewrite:

- The history is **small**. `step_summaries` is a digest per step; the scratchpad
  manifest is a 200-char digest per page. Neither carries page content — that
  was already true before the relocation, so what moves is metadata, not
  bodies.
- **Resume and panel replay become client-side reads.** Both already rebuild
  from `tasks[]`/`turns[]`/`prompts[]` — `scripts/test-replay.test.js` already
  extracts and evals that code. It is reading a file; it can read an IndexedDB
  record instead.
- **The audit document moves wholesale** into IndexedDB. `chrome.storage.local`
  is ~10MB and needs `unlimitedStorage`; IndexedDB is the right home for an
  unbounded transcript history and needs no permission.

What is lost, honestly: **server-side observability**. We could see a run
crash; now we cannot. That is the trade, and it is the correct trade for a
product whose premise is *it reads your email*. `main.py`'s `scan`/`metrics`
logging stays and still gives us everything except content.

## What is true today, and must not be oversold

**Until the local-first refactor lands, the run's shape is on the server's
disk.** No page text, no page bodies, no AX diff — but the URLs, the titles,
the task text, the action names and the typed input are. So:

- The README's Privacy section describes the *current* state honestly, and the deletion path
  is real: `DELETE /v1/sessions/{id}` takes the document, the scratchpad and
  the pages sidecar together, so there is no "part of it survived".
- `delete` and `delete_all` read **one** list, `_SESSION_EXT` (`audit.py`) —
  and there used to be two, which is the same bug twice. First they held
  separate hand-written lists and a sidecar named in one but not the other was
  stranded by the one that swept less: a `.pages.json` beside a document
  someone deleted by hand, 76KB of Gmail, reported as erased. Then, after that
  was fixed, the list was still read *differently* by different callers —
  `delete` read "the document plus the sidecars" and got it right, while the
  residue sweep and the retention prune read `_SESSION_RESIDUE_EXT`, which is
  the **sidecars only**, and so never tested the `.json` at all. One list,
  read three ways, is not one list. `delete_all` also returns how many files
  it could not remove, because a file on a read-only mount stays put and the
  alternative was a log line the user will never read standing in for the
  truth.
- The launch gates are partly closed. `/ws/ext` and the session endpoints are
  gated on `AGENT_SECRET`, which is the privacy control — but only when one is
  set. On **loopback** "no credential" stays a *warning* so dev still works; on a
  **non-loopback bind it is a refusal** (`cli.py`, keyed on `auth_mode() ==
  "open"`, so the hosted relay — which sets no `AGENT_SECRET` — is not refused
  by the check written to protect it). A file full of someone's browsing behind
  a reachable server with no credential is still the thing to avoid.
- Sequence: **auth** (done 2026-10-03), **delete** (done 2026-10-03), then
  **retention**, then local-first. Doing local-first first leaves an open door
  pointed at a directory that no longer has the interesting files — which is
  fine, but the door should be closed either way.

## The hosted relay turns "no operator" into "an operator", in code

3b was a prose failure: `agent.brotto.dev` shipped and **not one line of code
changed**. The account layer changes that, and it changes the same three things
3b found false — what we hold, who can read it, and when it is gone.

**We hold a table of who is in the beta, and nothing they said.** `profiles`
holds an email, a role, a revocation timestamp and a task counter. No column
holds content, and the relay writes exactly one field from the application —
the counter — at task start. The email is there so the operator can answer
*"who is this?"* at 2am, which is a different question from *"what did they do?"*.

**The two sign-in routes are open by definition, so they must not leak.** They
are how a credential comes into existence; gating them on one is a closed door.
That makes them the one place a route can become **a directory of the beta**:
`POST /v1/auth/request-code` returns the same answer for an address that has an
account, one that does not, and one on the beta roster. The relay now *does*
consult `beta_access` at mint — a code is the raw material for signing in, and
mailing one to a stranger is mailing a live credential to an address nobody
chose — but **the roster decides what we do, never what we say**: a listed
address gets a code and a mail, a stranger gets the same `{"sent": true}` and an
inbox that stays empty. Everything after the roster check is swallowed rather
than relayed, so a mint that fails is logged and returns rather than becoming a
502 the stranger never got. Pinned by
`test_the_reply_cannot_tell_a_member_from_a_stranger`.
`/v1/auth/exchange` raises a fixed `"invalid or expired code"` for wrong,
expired, spent and never-issued alike, because saying which half was wrong is
the same oracle. Only an **incomplete call** is reported, because that says
nothing about the address and reporting it is the difference between "check
your inbox" and "nothing is wrong, wait".

**The account is created at exchange, with Supabase sending no mail.** The
create goes through the service-role admin API with `email_confirm: true` —
that flag is what stops Supabase mailing a branded "Confirm your email address"
of its own, which is the whole reason the code is ours now. It happens at
**exchange** and not at mint because a code row needs no account (see
`test_a_code_is_issued_to_an_address_that_need_not_have_an_account`), and
creating at mint time would mint an auth account for someone who never
redeemed. `profiles.id` is still an FK into `auth.users`, so the account row
remains Supabase's; only the mail is gone. If the user already exists, the id
is read back rather than failing the sign-in.

## The roster admits; `revoked_at` withdraws

`beta_access` is read in two places — `_listed_for_beta`, called from
`approve_at_exchange`, which asks only whether `approved_at` is set and
`revoked_at` is not (row existence is no longer the invitation — see above);
and `_beta_status`, which the sign-in code path consults for the four-state
answer. Neither decides an already-signed-in member's fate:
`ensure_on_roster`, the gate every use path and task start now shares, reads
`profiles` and never consults the roster again. So the absence of a roster row
is a refusal **only for somebody who has not been admitted yet**. Deleting one
for an already-approved member changes nothing they can observe.

**The withdrawal is two writes, and neither is sufficient alone.** Set
`beta_access.revoked_at` *and* `profiles.revoked_at`, with the address passed
through `lower(btrim(...))` — both tables store email already normalised, so an
un-normalised `where email = '…'` matches zero rows, reports success, and
withdraws nobody. The runnable form, guard and all, is
`./scripts/beta-roster.sh revoke <address>`; `004`'s header carries the same
reasoning in full, because that is where an operator pasting a list will read it.

**The `profiles` half is keyed on the account id.** `profiles.email` is written
once, by `approve_at_exchange`, from the verified JWT claim at first sign-in,
and is never updated afterwards — a member who changes their Supabase email
leaves the old spelling on the row permanently, so an address-keyed update
matches zero rows, reports success, and withdraws nobody. So the procedure
resolves the address to an id and updates by `profiles.id`, which is the stable
key: **`profiles` first**, because that is the spelling the address was admitted
under and so the spelling on the operator's own list, then **`auth.users`**,
whose `email` is written by Supabase's signup path and is the only one of the
three not stored normalised, hence the `lower(btrim(...))` on that comparison
alone.

**An address that resolves to neither account writes and warns rather than
raising.** This is a correction, and the earlier design here was wrong. A
rostered address that never signed in has no account and no profile, so there is
genuinely nothing to withdraw — but it yields the same zero rows as a mistyped
address, and the procedure this used to describe could not tell them apart. So it
raised `no account for <address>`, and the raise threw away the half that
matters: `beta_access.revoked_at` is the only part of a withdrawal that outlives
the auth account, and a raise aborts the transaction, so aborting rolled back
the roster write too — the one write that would still have been standing had the
account been deleted a month later — while keeping the one the `auth.users`
cascade would recreate unrevoked. **Every exit from that branch left the member
*less* withdrawn than the operator asked, while looking like a loud, correct
refusal.**

So the refusal moved to where the ambiguity actually is. **An address not on
the roster at all dies loudly**, because a mistyped address withdrawing nobody is
the one failure the command exists to prevent, and there is nothing to undo. An
address that *is* on the roster and resolves to no account is a real withdrawal
of the roster half, so that write always lands and the script says which half it
skipped and what to type to re-admit. One statement is what makes skipping the
`profiles` half safe: the roster write is never in doubt, so a withdrawal that
missed a profile cannot leave a torn pair behind. The failure the raise was
trying to prevent — reporting a withdrawal that withdrew nobody — is still
prevented, and more cheaply: the script reports which of the two rows the
statement matched. Silence would be the bug; the raise was not the fix.

The first refuses *re-admission* at sign-in; the second is what
`authorize_task_start` reads at task start, and **that function never consults
the roster**, so the roster write alone withdraws nobody who is already signed
in. The failure mode is silent in both directions and worth naming: run only
the first and a member keeps a working beta account until they happen to sign
out, with a withdrawal on record saying otherwise.

`beta_access.revoked_at` is not a second copy of `profiles.revoked_at` for
tidiness; it is the only one of the two a cascade cannot erase.
`profiles.id` references
`auth.users` **on delete cascade**, so when the auth account goes — the person
deletes it, Supabase purges it, a test fires the cascade — the `profiles` row
and its `revoked_at` go with it. They sign up again, the address is still on the
roster, and `approve_at_exchange` inserts a fresh, unrevoked profile.
**Revocation was not durable**, and the cascade walked straight around the
insert-if-absent that exists precisely to stop a withdrawn member reinstating
themselves. The evidence has to outlive the account it was recorded against, so
`beta_access.revoked_at` is **not a foreign key and must never become one**, and
`_listed_for_beta` refuses an address whose `revoked_at` is set, and one whose
`approved_at` is null.

**A 409 on a paste says "already there", not "admitted".** Since `010`,
already-there is **asked** (`asked_at` only), **granted** (`approved_at` set,
`revoked_at` null) or **withdrawn** (`revoked_at` set), and the primary key
answers identically for all three. One line separates them — `select email,
asked_at, approved_at, revoked_at from beta_access where email =
lower(btrim('…'))` — and the operator has to read it; no code path may infer
which from the response. `beta-roster.sh add` reads it for you and refuses to
undo a withdrawal, pointing at `unrevoke` instead, because an `add` that cleared
`revoked_at` would reinstate somebody on purpose.

**Re-admission is `./scripts/beta-roster.sh unrevoke <address>`** — the same
pair with the values nulled, the roster write first, the `profiles` half
resolving in the same two-lookup order, because `authorize_task_start` reads
only `profiles`. **It skips the raise for the same reason the withdrawal does,
and here skipping is the whole point**: the account is frequently *gone* by the
time anybody re-admits — never signed in, or deleted their account and the
cascade took the profile — and raising would abort the transaction and leave
them **withdrawn**, the one state the operator asked to leave. The refusal that
is kept is the one that can be acted on: an address that is not on the roster at
all, where there is no row to null.

Deleting the roster row afterwards remains optional housekeeping — now it
*closes* the door rather than re-opening it, and it withdraws nobody on its own.
There is no `AFTER DELETE` trigger joining anything: a trigger fires on a
*delete*, and a withdrawal is an `UPDATE` that deliberately leaves its evidence
in place.

The operational consequence is the whole point: **an operator who removes a
roster row instead of setting `revoked_at` has handed someone a working beta
account while believing they took it away.** The migration file states this at
the top of `004`, and `beta-roster.sh` is what the operator actually runs.

## A valid signature is not a place in the beta

**Every person who signs in holds a token that verifies.** A signature proves
an account exists; it says nothing about the roster. So the six routes that
gated on `_authed` — `POST /v1/model/check`, `GET /v1/policy`,
`POST /v1/sessions`, `POST /v1/policy_ack`, `POST /v1/reports`,
`POST /v1/suggestions` — were answering anyone who signed up, and two of them
spend the operator's model credits.

They now go through `_approved`, which is `ensure_on_roster` (existence plus
`revoked_at`; no cap, no reservation) applied to every HTTP route that acts. The
sign-in path keeps its own answer — a token is minted for anyone who redeems a
code, on purpose, because that is what lets the panel offer somebody the
waitlist instead of a bare failure. **A code is minted only for an admitted
address; using the token is gated again.** That split is the design, not a gap
in it.

`ensure_on_roster` is also the first half of `authorize_task_start`, which adds
the cap and the reservation on top. One lookup, two callers: a second copy of
the "no row means `not_invited`" rule would be two things to keep in step and
one of them would drift. It **fails closed**, for the reason task start already
did — an unreachable control plane is a refusal, not a licence to serve, and on
two of these routes the alternative makes a third party's outage into an
access-control decision.

Two codes, deliberately. A **bad key is 404** — 403 confirms the route is worth
probing, and this server holds the user's transcripts. A **403** means the
credential is real and the *account* is not on the roster: an answer about an
account, not about a probe.

**The panel now says which one it got, and it is the only place this is visible.**
One wrong credential 404s `/v1/sessions`, `/v1/suggestions` and `/v1/policy` at
once, so History fell back to the local mirror on all three and a refused
browser looked like a server with nothing in it. `historyEntries` records the
source and `renderHistory` raises a card naming the credential specifically
(`panel-ui.md` owns the wording and why 404 and unreachable are separated). A
404 here is a statement about the *caller's credential*, not an enumeration of
routes — which is why the card says "the server did not answer this browser"
and never names a route.

The ownership-scoped reads (`GET /v1/sessions`, `GET /v1/sessions/{id}/audit`,
`DELETE …`) are roster-gated too. They were briefly exempted, on the reasoning
that they are filtered by owner and an unapproved person owns no sessions —
**true for `not_invited`, false for `revoked`.** A withdrawn member ran tasks
before the withdrawal, so `registry.owns` is still true for those ids
(`owns()` is fail-closed only for ids it has never seen), and the exemption let
a revoked account read its own transcript and erase its own sessions
indefinitely. Revocation that leaves the transcript readable is not revocation.

**One gate, one name, no exemptions.** The recurring failure here was a route
picking a different gate than its neighbour *looks* like it should, and every
pair of same-behaviour-different-name helpers is an invitation to the next one.
`_approved` now gates every route that authenticates; `_auth` survives only as
its own first step. Ownership scoping is a **second** question, not an
alternative to the first: the gate says *this account may use the relay*, and
`owns()` says *this session is one of theirs*. Both apply, in that order.

The cost is one control-plane hop per delete, which is why it was exempted —
and it is the right trade anyway, because the hop buys a withdrawn member's
transcript otherwise. `ensure_on_roster` reaches Supabase **only** through
`isinstance(auth.claims, Claims)`, which is never true in `secret` or `open`
mode, so self-host pays nothing.

## `sign_in_events` is incident response, not analytics

One row per **successful** `POST /v1/auth/exchange`, written as a background
task after the response is on the wire. A failed exchange writes nothing — a
wrong guess is not a sign-in.

The row holds three fields and no more: the account id (read off the verified
token, never the request body), the peer as a **network** — `ip_network(…/24)`
on IPv4 and `…/48` on IPv6, never the address — and the browser/OS string,
bounded at 512 characters. Nothing else exists to write: no page content, no
URL, no task title, no session id. This is the first table here holding
personal data, and the columns are the ones an incident needs and nothing the
product would like to have.

**What it is for:** answering "is this the same person on a new laptop, or
somebody else holds the account?" A `/24` is coarse enough to be an honest
answer to that question and fine enough to notice a different city. That is
the whole use.

**What it is not:** not analytics, not joined to anything else, not a browsing
history. There is no retention job and no expiry column — a cron that stops
running fails quietly, and `profiles.week_start` is built on the same argument.
The rows stay until somebody runs a `delete`, and they go when the beta goes.

Pinned by `test_a_successful_exchange_records_one_sign_in_event`,
`test_a_failed_exchange_records_no_sign_in_event`,
`test_the_peer_is_stored_as_a_network_and_never_as_a_host`, and
`test_an_oversized_user_agent_is_dropped_rather_than_truncated`. The SQL shape
(`cidr` + mask CHECK, no FK, RLS deny-all) is pinned in
`tests/test_sign_in_tables.py`.

## Self-approval is an insert, never an upsert

The invitation is now `approved_at` on a pre-loaded `beta_access` row, and the
`profiles` row is written by the relay at exchange. That puts the whole risk onto one
statement, because the natural way to write "this account is approved" against
a table with a primary key is an **upsert** — and an upsert on this path is a
revocation erased from the record. A member the operator deliberately withdrew
(`revoked_at` set) signs back in, the upsert nulls their revocation, and nothing
anywhere records that it happened. So the write is
`POST /profiles?on_conflict=id` with `Prefer: resolution=ignore-duplicates`:
PostgREST declines to touch a row that is already there, and the code
**re-reads the row afterwards** rather than trusting the insert — "already
there" *is* the revoked case. `revoked_at` is not in the insert body and is not
written by any path here. Pinned by
`test_a_revoked_member_keeps_the_revocation_by_signing_in_again`.

The email is read from the **verified JWT claims** and never from the submitted
body: the body is caller-supplied and this is the only function that acts on it.

`approved` in the exchange response is a report and not the gate. It is safe to
return for the inbox-control reason above, and it is only a report because
`authorize_task_start` asks the same question again at task start — a member
revoked between signing in and starting a task is still refused, pinned by
`test_the_second_wall_still_stands_after_an_approved_sign_in`. Every failure in
the approval path answers `false` rather than raising: the credential is real
either way, and failing the whole exchange would sign a valid person out
because Supabase's REST side blinked.

**A waitlist row is now an email, a bounded name, the operator's batch, and
`asked_at` — written into `beta_access`, and nothing else.** The name is the one
field the visitor typed that is not an address, and it is
there for one reason: the operator is about to send these people an invite and
cannot say their name without it. `build_row`'s named-argument shape is
unchanged, so there is still nowhere for a referrer, a user agent, a URL or a
note to land, and a name that grew past `NAME_MAX_CHARS` is truncated rather
than costing the signup. The answer is still `{"ok": true}` whatever the body
said.

**The name is also neutralised for a spreadsheet, in the code and in the
table.** The sink is not the row, it is the CSV export: the operator opens
the table in whatever admin UI, exports, and that file lands in Excel or
Sheets — and both execute a leading `=`, `+`, `-` or `@` as a formula. A
stranger typing into a public form would then be running on the machine of
the person who opens the export to send invites from. `build_row` prefixes
those four characters with the apostrophe both spreadsheets read as "text",
so the name still reads as the name the visitor typed. The **migration's
CHECK** covers a row written by any path that is not the server's — the
table editor, a `psql` session, a future import — and it is the half that
cannot be renamed away. Both halves, or one of them is a guard waiting for
a refactor.

**The email column wants the guard and gets a different answer.** `005`
guarded the name and left the address one column over, and `EMAIL_RE`
admits a leading `=`, `+` or `-`, so `+1+1@example.test` was stored as-is
and would have been run by the same export. **Refused, not quoted** — the
asymmetry is the point. A name is arbitrary text we *want* back in the
export, and an apostrophe is invisible once the cell renders as text. An
address has to round-trip: a stored `'+tag@example.test` is no longer the
mailbox that person signs in with, and depending on how the export is read
that is either a clean value or one with a stray apostrophe — silent
corruption of an identifier until an invite does not arrive. Nothing is lost
by the rejection, because `user+tag@` and `user@` are the *same mailbox*:
the visitor submits the base address, and the operator can add the tagged
spelling straight to `beta_access`, which nothing here touches. The
refusal is a fixed 400 that echoes the address nowhere.

**Revocation is checked per request and per task, and it fails closed.** The
JWT says who you are and nothing about whether you are still welcome, so
`profiles` is the only answer to the second question. The *decision* — the cap,
the reservation — is made once, at task start, so putting that on the request
path would make every step of every run depend on Supabase's uptime. The
*existence and revocation* question is asked on every route that acts (see
*A valid signature is not a place in the beta*), because a signature no longer
distinguishes a beta member from anyone who signed up. **Failing closed is
right on both**: this is the relay where every transcript lands on our disk and
the operator's credits are spent, and "we could not check whether this person
was revoked" is not a licence to serve them. A self-host relay never reaches
the function — no `Claims` object exists there.

**Retention now has a default, and only here.** `BROTTO_RETENTION_DAYS`
unset returns 30 on the hosted relay and `None` everywhere else. The reason is
the same asymmetry as everything above: a self-hoster's disk is their own data,
an ephemeral dyno is ours, and nobody was deciding the second one. An explicit
setting still wins, **including `0`**.

## One operator per server was an assumption, and four things were built on it

"Exactly one operator" is why `AGENT_SECRET` was a *credential* and never an
*identity*. It held the enumeration shut, and it held it shut for free. Ten beta
accounts broke it, and the breakage is not one bug — it is the same assumption
showing up in four places that each looked closed on their own.

**Ownership is recorded at mint time and checked everywhere, and a mismatch is
404.** `POST /v1/sessions` writes the caller's `sub` onto the session; the
registry is the only place it lives. `GET /v1/sessions` filters to the caller's
own, the audit read and the delete refuse, the relay closes **4004**, and
delete-all is scoped to the caller's own ids — the residue sweep globs `*<ext>`,
so unscoped it would unlink another user's scratchpad while counting something
else. A session with **no recorded owner belongs to nobody**: fail-closed, so a
stale id or an evicted registry entry cannot become an open door. The close code
is 4004 rather than 4001 for the same reason the routes answer 404 rather than
403: a distinct answer confirms the id is real, and confirming that is the whole
of what the id is worth. On self-host `owner` is `None`, which means *one
shared identity*, and every route behaves exactly as it did before.

**Ownership had to leave the process, and it had to leave `_sessions`, because
erase-all was lying in two ways.** A restart was the visible one: the registry
is in-memory, Heroku restarts the dyno daily, and after a restart
`owned_sessions()` returned nothing — so `DELETE /v1/sessions` answered
`{"deleted": 0, "residue": 0}` with every transcript still on disk. But
**restart was not the only way in, and the other way had no restart in it.**
Ownership had been stored in `_sessions`, which `_prune_sessions` evicts at
`MAX_TRACKED_SESSIONS` (256). Everything else in a `SessionState` is per-run
runtime — a sequence tracker, a task handle, a cached policy — and ownership is
not. So at the cap, eviction dropped entries, `owned_sessions()` shrank, and a
scoped `DELETE /v1/sessions` gave the identical untruthful answer, at a scale
threshold where nothing looks wrong and no operator is watching a restart. That
is why the fix is not only durability.

So: ownership lives in its own **non-evictable** `_owners` dict. The mint path
writes `<session_id>.owner` beside the session (`audit.record_owner`),
`lifespan` hydrates `_owners` from those files before anything can answer about
ownership, and the sidecar is in `_SESSION_RESIDUE_EXT` so `delete` takes it
and `delete_all` sweeps it. `forget_owner` drops the entry when the files are
erased — not a memory optimisation, because an erased session left in `_owners`
would be reported as the caller's own by a scoped *erase all*, and the count
would describe a file that is no longer there. **A restart and an eviction are
now the same class of failure and neither one reaches the answer**, because the
only thing that can empty `_owners` is erasure.

It is a sidecar rather than a field in the audit document because the document
is written by the harness's `AuditTrail` while this is written at mint time —
before a run exists, and so before any document does. Self-host writes nothing:
`None` is one shared identity and needs no record. Pinned by
`tests/test_session_ownership.py` (first coverage this guard ever had), which
covers the restart half and the sidecar's life.
`test_ownership_survives_eviction_at_the_tracking_cap` covers the eviction
half: it mints six sessions for one owner with `MAX_TRACKED_SESSIONS` at 3,
**asserts the eviction actually happened** (without that the test would pass
against the old code and prove nothing), then asserts `owned_sessions()` still
returns all six, `owns()` answers for each, and a scoped `DELETE /v1/sessions`
reports `deleted: 6` with every document gone from disk. Against ownership read
back out of `_sessions` it goes red on exactly that count.

**Ownership is released only by a finished erasure.** Every way of losing an
`.owner` while one of its files is still on disk ends the same way: the file
outlives the handle, `owned_sessions()` cannot name it, and no account can ever
erase it again. So there is one rule in four places, and each of them is a
place that already existed. Three of them were live and wrong for a week on
the relay before anyone looked; what they shared was a second, narrower
reading of "the files a session owns".

- `DELETE /v1/sessions/{id}` keeps the registry entry when `audit.delete`
  reports a file it could not unlink. `delete` gained a `leftover` out-param
  for exactly this — it knows which unlinks raised, and the route was
  throwing that away by forgetting unconditionally.
- `DELETE /v1/sessions` skips `forget_owner` entirely when `residue` is
  non-zero. The entries go as a batch, so an unguarded loop strands every
  unremovable file at once.
- `delete` and `delete_all` unlink the owner sidecars **last**, and only if
  nothing before them failed — otherwise the retry the kept ownership exists
  to enable would find no sidecar to scope itself by.

The retention sweep is the fourth door and works the other way: it ages out an
`.owner` only when **every file in `_SESSION_EXT` is gone** — the document
first, not merely the sidecars. Both narrower readings were wrong, and they
were wrong in the direction that strands files:

- Checking the document *alone* let a hand-deleted `.json` strand a scratchpad
  and take the account's ability to erase it with it.
- Checking `_SESSION_RESIDUE_EXT` alone — the sidecars, which is what this
  sweep originally did — is the same lie with the sides flipped. It strands the
  commonest shape of all: a `.json` that is **fresh** (an active or
  recently-closed run) beside an `.owner` written 40 days ago at mint time and
  never touched since. `.owner` is written once and never updated, so its
  mtime is the *start* of the run while the document's is the last activity.
  The sweep dropped the owner, `owned_sessions()` stopped naming the session,
  and the transcript became permanently unreachable — the file most worth
  deleting, the one the erasure machinery exists to delete.

Both halves are pinned: `test_an_orphaned_residue_keeps_the_owner_that_can_still_erase_it`
(hand-deleted document, stranded sidecar) and
`test_a_surviving_document_keeps_the_owner_that_can_still_erase_it` (fresh
document, aged owner) — the second went green only when the sweep started
reading the document, and its two guards above it were passing the whole time.

The sweep's own gate went with it. It read `if ext in owner_exts and residue`
— a **process-global** counter, so one session's stuck scratchpad suppressed
the `.owner` sweep for every *other* session in the directory, each of them
losing a handle to files the sweep was about to remove perfectly well. The
condition is about one file belonging to one stem, so it is tested that way
(`_still_owns`), and the check excludes the other owner extension: `.owner` and
`.owner.tmp` are the same account id, erased together or not at all, so left in
the list they certify each other and an interrupted `record_owner` makes both
of them immortal. Pinned by
`test_an_owner_and_its_staging_file_do_not_keep_each_other_alive`.

**And `delete_all` reported the erasure finished when it had not.** The
document loop was a `sum(...)` over `delete()`'s boolean, so it discarded the
`leftover` out-param that already listed which unlinks raised — and the residue
sweep, globbing the sidecars only, never saw the `.json` either. A transcript
that would not unlink (held open, read-only mount) was counted by nobody, so
the route answered `{"deleted": 0, "residue": 0}`, dropped ownership, and told
the user their mail was erased. `residue` counts from the sweep alone, which
is a strict superset of the document loop — it globs the same `_SESSION_EXT`
in the same directory and runs after — so adding `.json` to that glob is what
closes it. Counting in both places counted every file on a read-only mount
twice. Pinned by
`test_a_document_that_would_not_unlink_is_counted_as_residue` and
`test_erase_all_keeps_the_ownership_when_the_document_would_not_unlink`.

The remaining pins are `test_an_owner_with_nothing_left_to_erase_is_still_pruned`
(the guard is not a leak in the other direction), `test_a_delete_that_could_not_finish_keeps_the_ownership`
and `test_erase_all_that_left_residue_keeps_the_ownership`.

**`?token=` is refused in jwt mode and nowhere else.** A URL reaches this
server's access log, every proxy's log ahead of it, and the browser history. A
self-hoster's `AGENT_SECRET` is one secret on their own box; a hosted JWT is a
*person's* account, and there the query spelling writes a credential down. The
WebSocket subprotocol is the header spelling and is what the extension already
uses.

**The cap is one statement, not a comparison.** `authorize_task_start` used to
read the row, compare in Python and write the result — two concurrent starts
both read `used = 9`, both pass, both write 10, one task free. The cap is the
control that stops a hosted account spending our compute, so the predicate moved
into the `WHERE` clause of the `UPDATE` (`reserve_task_slot`). The read stays,
because revocation and invitation are genuinely reads; only the increment had to
be atomic.

**The two open sign-in routes are metered, and the limiter itself is not the
oracle.** They are unauthenticated by definition, so they are a way to drive
outbound email to arbitrary third-party addresses through our Resend account.
The bucket keys on the peer (the forwarded hop, because behind a proxy
`client.host` is the proxy for everybody and the limit would be five sign-ins
per ten minutes for the whole beta) and on the **normalised** address the
caller typed. It never consults anything that knows who is in the beta.

**`request-code` itself DOES now name the roster state** — see
*The sign-in reply is a deliberate oracle* below. That is a product decision
the owner made against the earlier uniform reply; it does not extend to the
limiter, which still branches on neither address.

## The client names an account, and it is the last local namespace

The fifth thing "one operator per server" cost was not on the server at all:
**two accounts in one Chrome profile shared every piece of local state.** The
only separator was the server address, and on the hosted relay that is one
string for the whole beta. History, provider, model and the saved API key were
each one flat slot — and the key is the one that mattered, because account A's
run paid with account B's credential. `panel-ui.md` owns the mechanism; what
belongs here is what the identity **is** and where it is allowed to land.

**`account_id` is an opaque `profiles.id` uuid — the JWT `sub` — and it is an
identifier, not user content.** Nothing derived from an AX tree, page text, a
URL, typed input or a task title may appear in that response or land in an
operator table, and none does. It is written to `chrome.storage.local`
unencrypted, which is safe precisely because it names nothing about the user:
it is a handle they already hold for themselves. **No new table, no migration,
no new refusal reason** — the account already existed as `profiles.id`.

**It is handed over as a field because the extension never parses the
credential.** `verify_jwt` is stdlib `hmac` and the relay signed the token
seconds earlier, so reading the `sub` out of it costs no control-plane round
trip. But the point is not the cost: a `sub` *decoded by the client* is the
credential being parsed, which is the one rule the whole credential design
rests on (see `extension.md`). A server-sent field lets the client scope local
state without ever opening the token.

**`GET /v1/account` exists because `exchange` is not enough.** A panel opened
days later holds a stored token and has no exchange in this session, and
without an id it cannot tell whose history it is showing. It goes through
`_approved`, the same choke point as every other gated route and **deliberately
including the roster**: an identity route reachable without a credential is an
`/health`-shaped leak of every account id on the relay. So a bad credential
answers **404, not 403**, and no credential answers 404 — the same answers as
every other route, for the same reason.

**Self-host is untouched and answers `{"account_id": null}`.** `Claims` exists
only when a JWT authenticated; there is no account, and the client's namespace
and storage keys are then byte-identical to what they were before accounts
existed. Note the small asymmetry, which is deliberate on both sides: a
*degraded* `exchange` answers `""` (the id could not be verified, and the
caller still gets a signed-in response) while `/v1/account` answers `null` (no
claims object). Every one of those values means "no account" to the client.

**No `approved` on `/v1/account`.** `_approved` already refused, so the field
would be a constant — and one derived from the *type* of the claims object it
read would answer `false` for a valid `AGENT_SECRET` in secret mode, which
reads as a denial that never happened. `account_id` is null in exactly the
no-account case, which is all a caller needs.

**Nothing is migrated from the flat key, on purpose.** A pre-change flat
`modelApiKey` belongs to whoever was signed in when it was written and nothing
records which, so copying it into whichever account signs in next hands that
account a credential that may be someone else's — the exact harm the split
exists to prevent. The cloud path ignores it and a cloud user re-pastes once.
The cost is one re-paste, paid by people who asked for accounts, and the
alternative is a silent cross-account credential, which is not a trade.

## The sign-in reply is a deliberate oracle

`POST /v1/auth/request-code` answers `{"sent": true}` or
`{"sent": false, "reason": "not_on_list" | "pending" | "revoked" | "try_again"}`.
A stranger who types an address learns whether it is on the waitlist, whether
it has been admitted, and whether it was withdrawn. **That is an
account-existence oracle on an unauthenticated route, and it is on purpose.**

The earlier design refused this: the reply was byte-identical whether or not a
code was minted, on the reasoning that a conditional answer is a directory of
the beta handed to anyone who can reach a public URL. The comment in
`jwt_auth.py` and `test_the_reply_cannot_tell_a_member_from_a_stranger` existed
to hold that line.

**The owner reversed it**, because the uniform reply produced the sentence "if
this address is in the beta, a code is on its way" — a system that does not
know what it just did — and left a non-member waiting for a mail that was
never coming. Four distinguishable answers produce four honest sentences and
an immediate offer of the waitlist. The decision is recorded in
`docs/product/decisions/2026-10-12-sign-in-reply-names-the-roster.md`.

What the trade buys and what it costs, stated once so nobody rediscovers it:

- **Cost:** anyone who can reach `POST /v1/auth/request-code` can enumerate
  the waitlist, the roster, and the withdrawals, one address at a time. The
  rate limiter bounds the speed but not the fact.
- **Buy:** a person who is not in the beta is told so, immediately, and can
  join the waitlist from the same screen. A person who is waiting is told
  they are waiting. A person who was withdrawn is told that too.
- **What did NOT change:** `POST /v1/auth/exchange` still answers one opaque
  `"invalid or expired code"` for every failure. The code space is 10^6 and
  that route is the one an attacker would grind; it stays non-oracular. The
  rate limiter still branches on neither address. `sign_in_events` is still
  one row per successful exchange.

**Revisit when the roster stops being ~ten people.** The original decision
said the check moves to a capability the user has already paid for rather than
to a bare address. That is still the upgrade path: the oracle is tolerable
while the directory is small and the product is invite-only, and it is not
tolerable once membership is worth knowing.

## Failure reports are the operator's question, asked without a page

The operator needs to answer one thing: *did the run happen, and if not, which
of our fixed codes says why?* That is not analytics — analytics answers *what
did the user do*, which is the posture rule 1 forbids — and the difference is
entirely in whether the vocabulary is closed. `failure_reason` already is: the
relay writes it, the panel turns it into a sentence (`FAILURE_NOTE`). So the
report is the same code, and nothing else.

**`build_row` is the boundary, and it raises.** It takes named scalars and
`**extra` is a `ValueError`, not a filter — a filter is something a later commit
widens with a reason that reads well. This is the same decision as
`begin_turn(ax_diff_chars: int)`, and `test_failure_reports.py` posts a body
carrying a task, a URL, page text, typed input, an email, a user id and a model
key, then asserts none of them appear in the built row. It passes because
`build_client_rows` has *no parameter* for them. The test failing is the
guarantee; the test passing is only evidence.

**The client never sends who it is.** `owner` is read off the verified token by
the relay, the same identity `profiles` already holds. So no user id is on the
wire — only in a table we already had a row for.

**A relay that is down cannot receive a report about being down.** So the codes
queue in `chrome.storage.local` and flush on the next `ws.onopen`: the first
moment the relay is answering *and* the credential has been accepted. Three
things fall out of that one choice. A refused sign-in still gets reported, once
the user signs in again — which is when it is worth having. Self-host is
structurally excluded twice over, because `/health` says `open` or `secret` and
never sets `relayIsCloud`, and because the route answers 404 unless
`reporting_enabled()`. And **no CORS change was needed at all**: the extension
already POSTs to the same relay origin, and `allow_origin_regex` already permits
exactly `chrome-extension://<id>`.

**Five codes are deliberately not reported, and the reason is written next to
each.** `CANCELLED` is the user pressing stop — counting it counts what the user
chose to do. `TASK_ERROR` and `WS_ERROR` are already counted from the relay as
`internal` and `CONNECTION_LOST`, so counting them from both ends makes one
outage look like two. `scripts/test-failure-reasons.test.js` requires every code
the extension writes to be either in `CLIENT_CODES` or in `NOT_REPORTED`, because
an omission is an *absence* and an absence reads clean in review.

**What the operator must do by hand:** run
`supabase/migrations/002_failure_reports.sql` on the Supabase
project, or `/v1/reports` answers 500 on every insert and the code says only that
a PostgREST call failed.

## The waitlist is the first data from someone who is not an account

Every row above belongs to a person who installed the extension and pointed it
at their own browser. `POST /v1/waitlist` is the exception: a visitor on a
public marketing page, no credential, no account, and an address they typed
into a form. That makes it the one place the operator holds data about someone
who has not decided to give us anything — and it applies exactly the same
discipline the rest of this file applies.

**The route does not exist on a self-hosted box.** `waitlist_enabled()` is
`auth_mode() == "jwt"` *and* a configured service key, and the answer is 404 —
not "does nothing". The gate is `auth_mode()` rather than "is a Supabase
configured" for the reason `failure_report.reporting_enabled()` is: a self-hoster
with a stray `SUPABASE_URL` pasted out of the cloud env must not start
collecting strangers' addresses because they copied it.

**The row is four columns, and the shape is what enforces it.** `build_row`
takes `email`, `name` and nothing else user-supplied — no referrer, no user
agent, no page URL, no IP — and `**extra` **raises** rather than filtering.
`batch` is the one addition that is not user content: the operator stamps it
from `BROTTO_WAITLIST_BATCH` when they send an invite round. `asked_at` is
stamped here. `approved_at` and `revoked_at` are deliberately **not** in
`COLUMNS`: a row this path can produce is a request, never an admission. This
is `begin_turn(ax_diff_chars: int)` and `failure_report.build_row` again — the
boundary is a signature, not a habit.

**The answer is the same whether the address is new.** The uniqueness
constraint lives in the migration and a duplicate arrives as a 409, which the
route reads as success. A read-then-insert would be a race a double-clicked
submit wins, and — the reason this is worth stating — a route that answered
differently for the two outcomes is a route anyone with a public URL can ask
*"is this address on your list?"*.

**The confirmation made that guard load-bearing rather than tidy, and it is the
one place where the distinction exists internally.** A signup is confirmed by
mail, and the mail belongs to a *first* signup — a second submit is a no-op on
the table and must not be a second email to a stranger. So `add` returns
`Signup.CREATED` / `DUPLICATE` / `REFUSED` rather than a bare bool, and the
route maps the first two onto one identical `200 {"ok": true}`. The distinction
is real, it is internal, and nothing outside this process can read it: not the
body, not a header, not a status code.

**The send is a background task, and that is the same guard rather than a
performance choice.** Awaiting it inside the route would answer a duplicate in
ten milliseconds and a new address in however long Resend and a page fetch
take — the same oracle, delivered through a stopwatch instead of a string, and
the one a caller can measure without being told anything. Starlette sends the
response first and runs the task after it, so the visitor's answer cannot
depend on Resend existing, being reachable, or being configured at all.
Pinned by `test_the_response_is_sent_before_the_mail_is_attempted`, which holds
Resend open on a gate and waits for the 200 to reach the wire, and by
`test_a_duplicate_is_answered_identically_and_sends_nothing`.

**A mail failure is not a signup failure, and there is no rollback to reach
for.** The row is written before the mail is attempted, so a Resend 500, a
timeout, or a dead writing page changes nothing the visitor can see and nothing
the table holds. Every failure path ends in a log line carrying a type and
nothing else.

**Nothing about the address is logged, ever.** Not on success, and not on
failure: a PostgREST insert error quotes the row, and the row is the entire
payload. Only a status code crosses into a log line. The response on a broken
control plane is a fixed 502 — see 3b's lesson that a promise made in a
published policy is an invariant with one call site per code path.

**It is metered on the sign-in limiter**, reused rather than duplicated: the
socket peer, the forwarded hop and the normalised address, and it consults
nothing that knows who is on the list, so a stranger and a beta user are
metered for the same reason after the same number of attempts. The form is
open by definition and there is no key to put in front of it.

**The peer key is the socket, not the header — and the header was the whole
bug.** It used to be the first hop of `X-Forwarded-For`, which the caller
sets: rotating it minted a fresh bucket per request, and on an open form the
submitted address is chosen by the attacker too, so both halves of the limit
were the thing being varied rather than a backstop. CORS does not help — a
cross-origin POST is still sent, it just cannot be read back. Trusting the
header is only correct behind a proxy that *overwrites* it; trusting the
socket alone collapses every visitor behind one NAT (and every beta user
behind one Heroku router) into a single bucket. So both are charged, at
different capacities, and the socket one is the bound because it is the one
the caller cannot forge. `ponytail:` the honest ceiling is written beside it
in `main.py` — 20 writes per ten minutes per router address, and an attacker
who keeps that bucket drained starves whoever shares the address. The upgrade
is a bot check in front of the route, not a bigger bucket.

**CORS is scoped to a sub-application, because an allowlist entry is not a
grant of access to one route.** `https://brotto.dev` and its GitHub Pages
host used to sit in the *global* `allow_origin_regex`, added so the marketing
form could reach `/v1/waitlist`. The effect was that those two origins could
read every CORS-protected route on every install — `GET /v1/sessions`,
`GET /v1/sessions/{id}/audit`, `DELETE /v1/sessions` — including an
open-mode self-host, where `validate_token` passes for everyone. Chrome's
Private Network Access hid part of it and Firefox and Safari implement
neither, so what stood between the entry and a transcript was a browser
mitigation rather than a guard.

Starlette has no per-route CORS; middleware is per-application. So the
waitlist is its own `FastAPI()` mounted at `/v1`, carrying its own allowlist,
and the global one names only `chrome-extension://<id>` and loopback. Two
consequences that are not obvious and are both pinned by tests in
`test_cors_scope.py`: the mount is at `/v1` and **not** at `/v1/waitlist`,
because the latter compiles to a regex the form's exact URL does not match
and answers 307; and the global middleware answers the sub-app's **preflight**
before the sub-app ever sees it, so it skips that one path entirely rather
than refusing the form's preflight with a 400.

## Writing new code here

Before adding a field, an endpoint or a metric, ask: **is this user content,
and where does it land?**

- Content going into a counter → it does not.
- Content going onto the operator's disk at all → it needs a reason that
  survives "would I be comfortable if this leaked".

Note what is *not* on that list any more: "content going into an audit
document → the sidecar." The sidecar had no writer before this rule stopped
being true, and following it would put page bodies back on disk behind a
privacy document that promises they never land there. Audit documents carry
counts and digests; anything that needs the body is fetched from the page
again, because the page is still there.
