# Roadmap

What is being built next, and — as importantly — what is deliberately not.
Ordered by what unblocks someone using Brotto today.

## In progress

### The one install step left

The extension is on the Chrome Web Store, under review — one click as soon as it
clears. What survives that is `docker compose up`, and it is the only thing
between someone who does not write code and using Brotto.

Removing it is a one-command installer for the **server half only**: check
Docker, generate `AGENT_SECRET`, write `.env`, `compose up`, print the address
and the secret. It is not the extension installer — the store is that, and is
strictly better. This is the only work gated on the store clearing, so nothing
else compounds until it does.

A prebuilt extension zip on GitHub Releases covers the review window, so
outreach replies have something to hand a stranger. It is deleted when the
listing lands.

## Next

### Google Docs and Sheets — spiked separately, before anything is built

Canvas surfaces are the one place Brotto is blind: no page text, no AX value, no
screenshot to fall back on. The closest alternative shares the blindness, so
this is a tie that costs both of us.

Docs and Sheets are not the same problem, and neither answer is known. **Docs is
a contenteditable DOM with a rich ARIA tree** and may largely already work — the
documented canvas blindness may not apply to it at all. **Sheets genuinely
draws its grid to canvas.** Measure both before writing anything; this may be a
configuration fix rather than a subsystem. Whatever the spike finds becomes a
first-run example, because "it works in your Google Doc and the obvious
alternative doesn't" is the claim that converts a non-developer.

This is sequenced before the benchmark, and the benchmark before routines.

### Scoring the harness against a real model

The harness is built: eight fixtures, a scoring rule that separates *refused*
from *failed to decide*, an unattended runner, and a recorded baseline. What it
does not have is a number.

The baseline in `tests/fixtures/baseline.json` runs the **scripted planner** —
no model, no API key — so it measures AX extraction, filtering and action
dispatch, and says nothing about the agent's judgement. That was the right
first half: it is what makes a change to `ax_filter` measurable at all.

The second half is pointing the same runner at a real model and scoring runs
from the audit document each one already writes. Until that reports, the
README's "no published benchmark yet" stays true, and that sentence is the most
expensive one in the product — it is an invitation to assume somebody else's
reliability number is better.

The numbers it has to move are weekly active runs and 30-day retention. Stars
are a donation to a premise, not a usage signal.

### Routines, replay and scheduling

Saved reusable tasks — *every weekday, summarise these* — re-run or resumed from
the audit document. Held back until the benchmark reports, because shipping
automation on an unmeasured loop is the failure mode that costs the most.

### Pro: the paid half, and what it hangs off

**Pro does not exist yet and there is nothing to buy.** What follows is the
shape it is planned to take, and it is narrower than
`docs/product/launch-roadmap.md` §3 because that document was written for a
*hosted* Pro with an operator behind it. The free tier is self-hosted and there
is no operator, so three of its six items are gone rather than deferred:
**server-side history and replay** (free already has local history, export and
delete — the Pro delta was always *sync*, which needs an operator),
**cross-device routine sync** (same reason; local routines survive, sync does
not), and the **support SLA** (staffing, not code).

**Planned, unbuilt — the friction each one removes:**

| Feature | Friction it removes | Needs an operator? |
|---|---|---|
| Multi-tab parallelism | One tab at a time, the largest ceiling there is | No |
| Speed pack | ~30s per step: larger observation budgets, a prompt cache that engages, cheaper models routed well | No |
| Routines (local recipes) | Describing the same task again, every time | No |

None of the three needs an operator, which is the point — a Pro built on them
does not reopen the hosted tier that "Not planned" closed. The speed pack is
worth noting separately: it pays for itself out of the user's own token bill,
so it needs no extra spend to be worth having.

**Deliberately not Pro, even once it exists:** the benchmark harness, reconnect
robustness, and idle-page suggestions. Those are quality and trust; charging for
them would say the free build is the broken one.

**Built and gated.** Per-run cost and the per-task ceiling are the two things
that exist. The free build has the code and cannot reach it: `BROTTO_PRO` is
unset, `_catalog_for` returns `None`, and since that is the loop's only route
to a price, nothing is priced, `TaskResult.cost_usd` stays `None` and the panel
draws no cost. `BROTTO_MAX_TASK_COST_USD` without `BROTTO_PRO` is refused with a
warning rather than half-honoured — a free build that can be capped is still a
build that knows what things cost. What Pro still needs is a way to switch the
flag on that is not "edit the compose file", and whatever that mechanism is, it
is the only thing standing between the pricing and a stranger's key.

### The cache-read anomaly — settled 2026-10-05, needs one live run to confirm

`cache_read_tokens` was 0 in every recorded run while the design assumed a
cached prefix. The cause was not a reporting gap: nothing was asking for a
cache. Anthropic caching is opt-in and the `cache_control` breakpoint was never
set, so a stable 8–9.5K prefix was being re-billed at the full input rate on
every step. `AnthropicFactory.model_settings` now sets it, for Anthropic only.

What is left is confirmation: the flag is pinned by a test, but that the API
honours it and `cache_read_tokens` goes non-zero has not been observed on a real
run. A MiniMax cache story is also open, and deliberately not guessed.

### An action schema the model cannot guess

`action_args` is a bare `dict`, so the output tool's JSON schema tells the model
nothing about any action's argument names or types. Every one is inferred from
the prompt prose, and the model infers them inconsistently: one run sent
`recall_memory` with `{"id": …}` against a handler reading `entry_id`, and
`{"max_chars": "3000"}` as a string. The two are now accepted defensively,
which treats the symptom. Typing the field as a union discriminated on `action`
is the fix, and it is not cheap: about thirty call sites construct an
`ActionCall` with a literal dict.

## Being worked

### The Chrome Web Store listing

**Submitted, under review.** Icons, screenshots, the privacy-practices
disclosure and the category are done; nothing is outstanding but the review
itself. `debugger` plus `<all_urls>` is the combination reviewers slow down on,
so the clock is budgeted at one to two weeks rather than days — which is why the
server installer above is the thing being built in parallel, not after it.

No code change was needed to submit: the origin allow-list matches any valid
extension id, so the store-assigned id is allowed automatically.

### Idle-page suggestions, re-measured

The first half of this was wrong when written: suggestions are **off** by
default (`settings.contextSuggestions === true` is the only thing that enables
them), a fresh install reads nothing, and a sensitive page is refused outright.
What is left is the disclosure *after* the read — a "Reading page" badge covers
the seconds the read takes, but the lines it produced sit on screen long after
the badge is gone, and they did not say where they came from. That is now a
caption under the buttons, and it survives a cache hit, which is the common
case after a reopen.

What is still owed is the usefulness measurement. Three earlier prompt
revisions looked fine in a diff and were only caught by reading the sentences
the model actually produced.

## Not planned

**A public hosted tier.** The hosted relay at `agent.brotto.dev` exists and is
running, but it is a **capped, invite-only beta** and not a tier. Self-host
remains free, permanent and the product; the relay exists to produce three
measurements — support tickets per invited user, voluntary returners, and any
conversion signal — and the kill criterion was written down before it shipped:
after 8–10 invited users with no returners and no public writeups, it does not
proceed to a free public beta and the effort goes back into making the six-step
self-host install a two-step install.

The deferral reasoning was never "no operator exists"; it was "no operator to
protect until we know whether anyone wants this". The first two records on disk
assumed no operator and were **superseded by new ones rather than edited** —
`2026-10-10-hosted-beta-accounts-and-the-secret.md`, then
`2026-10-10-hosted-beta-accounts-supabase-and-resend.md`, which replaced the
per-invitation `AGENT_SECRET` with Supabase Auth and Resend. That part is
accepted and unbuilt; the relay itself is live behind `AGENT_SECRET`.

`docs/architecture/privacy.md` rule 2a and `docs/architecture/deployment.md`
carry the operational detail, and `PRIVACY.md` discloses the relay in as many
words as the self-hosted default gets.

Pro sells compounding and performance — routines syncing, throughput, support —
and **never custody**. The rule that survives: if a Pro feature can be phrased as
"we keep your data", it is not a Pro feature.

**Free-tier task caps.** 1 concurrent, 25/day. On a box the user runs, against
a key the user owns, a cap spends the user's tokens for them. It is friction
without a beneficiary.

**Relocating history *out* of `/data/sessions` entirely.** The IndexedDB half of
this shipped — `session_store.js` mirrors each audit document into the browser
and answers only when the server cannot, which is what an ephemeral relay disk
needs. What has not been built is the full local-first move where the server
holds no session history at all. The volume is still the right default: on
self-host it is the user's own disk, and nothing about a relay justifies making
that the exception.

**A second browser.** `chrome.debugger` has no Firefox equivalent, and
emulating it is a re-implementation of the extension rather than a port of it.

**Retrieval over the run's own history.** The agent recalls pages it visited
from a scratchpad it wrote itself. Adding a vector store over the audit
document would be a second memory that disagrees with the first.

## Last shipped

- Privacy, security and contributing folded into the README
- Idle-page suggestions labelled with the page they came from
- Per-task cost, priced from the catalogue — now behind `BROTTO_PRO`
- Session retention — `BROTTO_RETENTION_DAYS`, swept at startup, off by default
- Access-control-tree capture, cross-origin frames included, pooled over CDP
- The rescan gate — a settled page is observed once, not four times
- Mid-task steering from a composer that stays live during a run
- `press_key`, and two argument-name bugs it exposed
- Auth across every route the extension calls; a bad key gets 404, not 403
- The panel's working line, as a phase key rather than a sentence
