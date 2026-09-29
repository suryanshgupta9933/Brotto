# Task 3 report — TaskRecord + runner

Status: **DONE_WITH_CONCERNS** (one necessary deviation, recorded below)

## What was created

Three files, nothing else touched. `pyproject.toml` left alone (no `websockets` added);
the pre-existing `CLAUDE.md` modification at the repo root is unstaged and out of the commit.

| File | Lines | Contents |
|---|---|---|
| `services/brotto-orchestrator/src/brotto_orchestrator/testing/records.py` | 30 | `TaskRecord` pydantic model + `usd_estimate`. Brief's Step 3 verbatim. |
| `services/brotto-orchestrator/src/brotto_orchestrator/testing/runner.py` | 133 | `run_task`, `_post_run`, `_record_from_result`, `_err_record`, `_result_from_payload`. Amendment's replacement Step 4, with one line added (see Deviations). |
| `services/brotto-orchestrator/tests/testing/test_runner.py` | 81 | Five tests: three from the brief (two retargeted by the amendment), one amendment timeout test, one new HTTP-error test. |

Style matches `testing/outcome.py` and `testing/scripted_planner.py`: module docstring,
`from __future__ import annotations`, relative imports within the package.

`runner.py` imports `TaskResult` lazily inside `_result_from_payload` (kept lazy as
instructed), and the dependency direction is one-way — `testing/` imports `agent/`,
nothing under `agent/` or `policy/` imports `testing/` (verified by grep).

## RED — actually observed

```
$ ./.venv/bin/python -m pytest services/brotto-orchestrator/tests/testing/test_runner.py -q
ERROR collecting tests/testing/test_runner.py
...
    from brotto_orchestrator.testing.records import TaskRecord, usd_estimate
E   ModuleNotFoundError: No module named 'brotto_orchestrator.testing.records'
=========================== short test summary info ============================
ERROR services/brotto-orchestrator/tests/testing/test_runner.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
============================== 1 error in 0.08s ===============================
```

Matches the brief's expected Step 2 failure exactly.

## GREEN — actually observed

```
$ ./.venv/bin/python -m pytest services/brotto-orchestrator/tests/testing/test_runner.py -q
.....                                                                    [100%]
5 passed in 0.13s
```

```
$ ./.venv/bin/python -m pytest services/brotto-orchestrator/tests/ -q
........................................................................ [ 27%]
........................................................................ [ 55%]
........................................................................ [ 82%]
.............................................                            [100%]
261 passed in 1.90s
```

261 = 256 baseline + 5 new. No failures, no skips, no warnings. Predicted count matched
exactly.

## Deviations

**One, and it was forced.** The amendment's `run_task` accepted a `timeout` parameter,
forwarded it to `_post_run`, and never used it to bound anything — `_post_run` ignores its
`timeout` argument, and `run_task` awaited it unbounded. The amendment's own timeout test
monkeypatches `_post_run` with a stub that sleeps 3600s and asserts the call returns a
`HARNESS_ERROR` record within `timeout=0.05`. Written verbatim, that test hangs for an
hour and the suite never finishes; the "fail fast, never a hang" property the test exists
to pin is not actually implemented.

Fix is one line, in the place where the contract belongs — `run_task` wraps the transport
call:

```python
        body = await asyncio.wait_for(
            _post_run(
                base_url,
                {"task": f"fixture:{fixture_name}", "start_url": start_url,
                 "script": script_name},
                timeout,
            ),
            timeout=timeout,
        )
```

Enforcing it in `run_task` rather than inside `_post_run` also means the bound holds for
any transport, not just `aiohttp` — which is what the monkeypatched test exercises. The
`asyncio.TimeoutError` handler already existed in the amendment and now actually fires,
producing `reason="timeout after 0.05s"`, satisfying both the `"timeout"` and `"error"`
assertions. Everything else — including the `ponytail:` ceiling comment on
`approval_requested` — is verbatim from the amendment.

## Concerns

1. **The one deviation above.** If the intent was for `_post_run` to own the timeout
   (e.g. via `aiohttp.ClientTimeout`), the same one-line guard can move there instead.
   Current placement is deliberate: it survives a transport swap and is what the test
   proves. Flagging rather than burying it because it contradicts "use the code verbatim."

2. **`_post_run`'s `timeout` parameter is now dead** — `run_task` bounds the call, and
   `_post_run` does not read its third argument. It is kept because the amendment
   specifies that signature and Task 4/5 may want the HTTP-level timeout wired properly
   once real fixtures exist. Worth deleting then if it is still unused.

3. **`"script"` is sent but not honoured.** `POST /run` does not read the field yet; the
   agent will run the fixture task against a live model. This is expected — Task 5 wires
   it behind a `BROTTO_ENV != prod` guard. Any end-to-end benchmark run before Task 5
   lands will produce real-API results and may be nondeterministic.

4. **`approval_requested` is always `False` on this path**, as the amendment states. It
   stays in the schema only to satisfy the spec's per-task record shape, so any consumer
   reading it must know it is a constant on the HTTP transport, not an observation.

5. **Not covered by tests:** `_record_from_result`'s token/USD extraction, the
   `final_url` passthrough, and `_result_from_payload`'s field mapping have no test. The
   brief specified none and adding them would have exceeded its scope, but the token-pop
   path (`timing.pop("tokens"/"tokens_in"/"tokens_out")`) is the part most likely to
   disagree with whatever the harness actually writes into `TaskResult.timing` — it will
   be validated for real only at Task 6, against a live run.

---

## Fix round 1

### Item 1 — timeout guard: upheld, no change

`run_task`'s `asyncio.wait_for` stays where it is. It is the only mechanism
that bounds a *substituted* transport, which is exactly what the spec'd
timeout test exercises.

### Item 2 — `_post_run`'s `timeout` now does something

`src/brotto_orchestrator/testing/runner.py:36-40` — the client session is
built with `aiohttp.ClientTimeout(total=timeout)`, so the real HTTP path is
bounded at the transport level (including the body read) rather than only by
the outer `wait_for`. Two mechanisms, two jobs: the client timeout is
transport-specific, the `wait_for` is transport-agnostic.

### Item 3 — `TaskRecord.tokens_in` / `tokens_out` / `usd` are now reachable

Root cause: `runner.py` popped `tokens_in` / `tokens_out` from
`TaskResult.timing`, but the harness never wrote them. `AgentHarness.run` read
`result.usage` once per step for the context-utilisation cell and threw the
value away, so every benchmark row would have been `tokens_in: null,
tokens_out: null, usd: null` forever.

Harness change (`src/brotto_orchestrator/agent/harness.py`):

- `:805-810` — `tokens: dict[str, int] = {"in": 0, "out": 0}` local to `run`.
  A local (not instance state) because one `AgentHarness` serves concurrent
  tasks.
- `:1160-1166` — the existing `try/except` around the usage read now also
  accumulates `usage.input_tokens` and `usage.output_tokens` into `tokens`.
  `except Exception` behaviour is unchanged: a `None` result, a `None` usage,
  or a raising `usage` property accumulates nothing and does not fail the step.
- `:1283-1284` — `_log_timings` takes `tokens: dict[str, int] | None = None`.
- `:1324-1331` — the returned dict gains `tokens_in` / `tokens_out` under
  exactly the two names `runner.py` pops.
- `:857, :899, :927, :1268, :1274` — all five `_log_timings` call sites pass
  `tokens=tokens`, so every exit path (abort gate, policy block, login skip,
  terminal step, max-steps) reports the same totals.

The scripted-planner path never calls `agent.run`, so `result` is `None` and
the totals stay `0`. That is left as a real fact, not synthesised data, and
`runner.py` prices it at `$0.00` rather than `null`.

`usd_estimate` and the pricing constants are untouched. The raw counts are
stored alongside, so historical rows stay recomputable.

Side-panel check: `clients/brotto-extension/src/sidepanel.js:2025-2028` reads
`timing.components`, `timing.steps` and `timing.wall_s` by name — it never
iterates — so two added keys cannot affect it.

### Bonus defect the new test exposed

`TaskRecord.timing` was typed `dict[str, float]` (`records.py:18`), but the
harness's real timing dict nests `components` (a dict) and `per_step` (a list
of dicts). Every real run would have failed pydantic validation in
`_record_from_result` — tokens or not. Retyped to `dict[str, Any]`
(`records.py:20-22`). No existing test exercised this, which is why it went
unnoticed.

### Tests

`tests/testing/test_runner.py`:

- `test_populated_timing_yields_tokens_and_a_hand_computed_usd` — builds a
  `TaskResult` whose `timing` uses the exact key set `_log_timings` returns
  (steps, wall_s, wall_agent_s, human_pause_s, components, per_step,
  tokens_in, tokens_out), runs it through `_record_from_result`, and pins
  `tokens_in == 1_234_567`, `tokens_out == 89_012`, `usd == 5.038881`. The
  USD is computed by hand (`1.234567 * 3 + 0.089012 * 15`) and hard-coded, so
  a pricing-constant change fails the test rather than passing silently. Also
  asserts the token keys are popped, not copied into the residual timing.
- `test_timing_without_token_keys_leaves_tokens_and_usd_null` — a timing dict
  with no token keys yields `tokens_in is None`, `tokens_out is None`,
  `usd is None`, and does not raise.
- `test_scripted_run_reports_zero_tokens_not_null` — 0/0 tokens price at
  `$0.00`, distinct from "unknown".

`tests/agent/test_harness_token_accounting.py` (new):

- `test_step_usage_lands_in_the_returned_timing` — one step's
  `result.usage` reaches `TaskResult.timing`.
- `test_usage_accumulates_across_steps` — two steps, two usages, summed
  (3000/300), not last-write-wins.
- `test_step_without_usage_leaves_totals_unchanged` — a `result` whose
  `usage` property raises still completes the step with totals at 0.
- `test_log_timings_reports_zero_tokens_when_none_passed` — direct check that
  the keys are present-and-zero, not absent.

`_plan_step` is stubbed rather than TestModel-driven: the property under test
is "whatever `result.usage` says gets added up", and a stub states the input
exactly.

No existing test was weakened or deleted.

### Verify

```
$ ./.venv/bin/python -m pytest services/brotto-orchestrator/tests/ -q
268 passed in 1.89s
```

Baseline was 261; +7 new tests, 0 failures.

Dependency direction still holds:

```
$ grep -rn "from.*testing" src/brotto_orchestrator/agent/
(no matches)
```

---

## Fix round 2

Addressed the two Important issues and both Minors from the task-3 review.

### Important 1 — `final_url` was a confident wrong number

`runner.py:131` recorded `final_url=start_url`, and `TaskResult` had no
`final_url` field at all, so there was nothing to read. A task that navigated
`/login → /dashboard` and then failed recorded `/login` — indistinguishable
from a task that never navigated. Unlike `approval_requested`, nothing marked
the field as unobserved.

- `src/brotto_orchestrator/agent/context.py:130-136` — added
  `final_url: str = ""` to `TaskResult`, with a `ponytail:` comment in the
  same style as the existing `policy_mode` note: the harness sets it, and it
  is optional so existing callers and tests need no change.
- `src/brotto_orchestrator/agent/harness.py:859-863` and `:1275-1279` — set
  `deps.result.final_url` immediately before both `return deps.result`
  sites. `deps.step_url` is the URL observed at the top of the last step this
  loop entered; no new state, no loop restructuring.
- `src/brotto_orchestrator/agent/harness.py:1286-1294` — a **third** return
  path turned up: the `MAX_STEPS`-exhausted `TaskResult` built at the bottom
  of `run()`. It now carries `final_url=deps.step_url` too. Without this, a
  run that hit the step ceiling would still have reported nothing.

The reads use `getattr(deps, "step_url", "") or ""`, not a bare attribute.
`step_url` is not declared on `AgentDeps` — it is set dynamically at
`harness.py:877`, and the abort gate at the top of the loop can return before
any observe has run. This is the same defensive read already used at
`harness.py:484` for the click cross-domain gate.

**Honest semantics.** `deps.step_url` is the URL observed at the *start* of
the final step, not after the final step's actions. This is a real
approximation and both the `context.py` and `harness.py` comments say so.
It needs upgrading only if a task whose last action is a navigation ever has
to be attributed to the destination page rather than the page it left.

- `src/brotto_orchestrator/testing/runner.py:87-99` — `_result_from_payload`
  now maps `final_url` (previously dropped, so the value never reached the
  parsed `TaskResult` at all).
- `src/brotto_orchestrator/testing/runner.py:126-136` — `run_task` reads the
  real value, `body.get("final_url") or result.final_url or start_url`, so a
  body that reports none still falls back to the start URL rather than to an
  empty string.

### Important 2 — `_result_from_payload` had zero coverage

Every existing test handed `_record_from_result` a hand-built `TaskResult`,
so the real `/run` body path — where the first commit's `dict[str, float]`
bug lived — never executed. Two tests added at
`tests/testing/test_runner.py:161-233`:

1. `test_run_task_maps_a_real_response_body` — monkeypatches `_post_run` to
   return `TaskResult(...).model_dump()` for a realistically populated
   failed run (`status="failed"`, `extracted_data`, `tried`,
   `failure_reason`, `steps_taken=3`, a full `_harness_timing` dict with the
   nested `components` dict and `per_step` list of dicts, and a
   `final_url` of `/dashboard` distinct from the `/login` start URL), then
   asserts the returned `TaskRecord` field by field. `failure_reason` is
   chosen so it classifies to `LOGIN_FAILURE`, which means the assertion
   proves the value reached `classify()`, not merely `rec.reason`.
2. `test_run_task_falls_back_to_start_url_when_body_has_none` — a body with
   no `final_url` records the start URL.

The assertions are per-field on purpose, per the review. Verified by
mutation: deleting a single `msg.get(...)` line from `_result_from_payload`
and re-running `pytest tests/testing/test_runner.py` fails a specific
assertion for `final_url`, `failure_reason`, `steps_taken` and `timing`.
(`summary`, `extracted_data` and `tried` are carried on `TaskResult` but are
not `TaskRecord` fields, so there is nothing downstream for them to break.)

### Minor 3 — dead line in a test

`tests/agent/test_harness_token_accounting.py:92` — removed the
`_stub_plan(monkeypatch, [...])` call that was immediately overwritten by the
`monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)` twelve lines
later.

### Minor 4 — dead `tokens` key in the runner

`src/brotto_orchestrator/testing/runner.py:53-70` — removed the
`timing.pop("tokens", None)` and the `tokens_in if tok_in is not None else
tokens` fallback. The harness never writes a `tokens` key into
`TaskResult.timing`; `tokens_in`/`tokens_out` are the only real source.
Behaviour is unchanged — the removed fallback could only ever have supplied
`None`, which is already what `tok_in` is when absent.

### Not changed

The review's other Minor — `_err_record` setting `final_url=""` while the
success path sets a URL — is a deliberate empty-means-unknown and was left
alone, as instructed.

### Verify

```
$ ./.venv/bin/python -m pytest services/brotto-orchestrator/tests/ -q
270 passed in 1.97s
```

Baseline was 268; +2 new tests, 0 failures.

Dependency direction still holds — the shipped package does not depend on
`testing/`:

```
$ grep -rn "from.*testing" services/brotto-orchestrator/src/brotto_orchestrator/agent/
(no matches)
```

Extension impact checked rather than assumed: `clients/brotto-extension/src/background.ts:454`
reads specific named fields off `msg.result` (`status`, `summary`,
`steps_taken`, `extracted_data`, `timing`, `failure_reason`) and ignores
everything else. `final_url` is additive and unread, so no extension change
is needed.
