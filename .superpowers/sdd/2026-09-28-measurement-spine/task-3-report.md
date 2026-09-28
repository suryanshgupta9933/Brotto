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
