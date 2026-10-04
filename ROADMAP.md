# Roadmap

What is being built next, and — as importantly — what is deliberately not.
Ordered by what unblocks someone using Brotto today.

## Next

### A benchmark harness

The README currently says nobody has measured Brotto's completion rate, because
nobody has built the harness. That sentence is the largest single gap in the
project: a browser agent's whole claim is a reliability number, and Brotto
currently has none.

It needs a task set (things a real person wants automated, not synthetic
click-paths), a scoring rule that distinguishes *refused* from *failed to
decide*, and a way to run it unattended. The audit document already records
enough to score most of it from — outcome, step count, failure reason, cost,
latency per component.

### The cache-read anomaly, before anything is priced against it

`cache_read_tokens` is 0 in 17 of the 20 recorded runs, including the long
one. The design assumes the stable prompt prefix is cached, and the logs do not
show it. Two possibilities, and they point opposite ways: the provider is not
reporting the bucket Brotto reads, or the prefix genuinely is not being cached
and every run is being billed at the full uncached rate.

Until it is settled, the cost figures in the README are the pessimistic ones —
correct if nothing is cached, an overstatement if all of it is — and
`BROTTO_MAX_TASK_COST_USD` is calibrated against numbers that may be an order
of magnitude too high. A cap tuned on wrong numbers is worse than no cap.

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

The extension is loadable unpacked and the manifest and `welcome.html` are in
shape. What is missing is a review-ready package: icons at the required sizes,
screenshots, a privacy-practices disclosure that matches `PRIVACY.md`, and a
category. The review is the gate, not the build.

### Idle-page suggestions, re-measured

Suggestions are on by default, which is a real escalation: it reads the page
you are looking at with no task in flight and no indicator that it did. It
needs an indicator and a real usefulness measurement before that default is
defensible. Three earlier prompt revisions looked fine in a diff and were only
caught by reading the sentences the model actually produced.

## Not planned

**A hosted tier.** There is no operator to protect, no marginal cost to defend
and no signup to build. Every reason it was deferred still holds.

**Free-tier task caps.** 1 concurrent, 25/day. On a box the user runs, against
a key the user owns, a cap spends the user's tokens for them. It is friction
without a beneficiary.

**IndexedDB, or relocating history out of `/data/sessions`.** The volume is
already the user's disk. The whole relocation was justified by a hosted
operator who could read the files, and there is no operator.

**A second browser.** `chrome.debugger` has no Firefox equivalent, and
emulating it is a re-implementation of the extension rather than a port of it.

**Retrieval over the run's own history.** The agent recalls pages it visited
from a scratchpad it wrote itself. Adding a vector store over the audit
document would be a second memory that disagrees with the first.

## Last shipped

- Per-task cost, priced from the catalogue, with an optional ceiling
- Session retention — `BROTTO_RETENTION_DAYS`, swept at startup, off by default
- Access-control-tree capture, cross-origin frames included, pooled over CDP
- The rescan gate — a settled page is observed once, not four times
- Mid-task steering from a composer that stays live during a run
- `press_key`, and two argument-name bugs it exposed
- Auth across every route the extension calls; a bad key gets 404, not 403
- The panel's working line, as a phase key rather than a sentence
