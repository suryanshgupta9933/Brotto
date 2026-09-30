"""What the model can still reach, and what it quietly lost.

Three fixes that only matter past step ~12, which is exactly where a
step-capped harness stopped and let the bug hide:

- the AX tree budget decays with the step number (latency)
- the step-summary window names what it dropped and `recall_steps` gets it
  back (amnesia)
- a model that cannot produce a decision fails the run instead of
  leaving the document `running` forever
"""

import pytest

from brotto_orchestrator.agent import ax_filter
from brotto_orchestrator.agent.context import StepSummary


# ── the tree budget decays ───────────────────────────────────────────────


def test_the_tree_gets_smaller_as_a_task_ages():
    """The tree is worth most at step 0, where it decides what to try at
    all. Past that the model is executing a plan it already holds, and most
    of the tree is pages it has already rejected."""
    w = 1_000_000
    assert ax_filter.budget_for_window(w, step=0) == 50_000
    assert ax_filter.budget_for_window(w, step=15) < 50_000


def test_the_decay_saves_the_tokens_that_were_actually_being_paid_for():
    """~35K chars off every step past 15. The tree is uncacheable — the
    page changes — so this is a per-step saving for the rest of the task,
    not a one-off."""
    w = 1_000_000
    late = ax_filter.budget_for_window(w, step=30)
    assert 50_000 - late >= 30_000


def test_a_late_step_still_gets_a_real_tree():
    """The floor is the window budget, not the 6K MAX_CHARS. A step that
    needs to re-find something late should see a page, not a token."""
    assert ax_filter.budget_for_window(1_000_000, step=200) >= ax_filter.BUDGET_FLOOR
    assert ax_filter.budget_for_window(1_000_000, step=200) > ax_filter.MAX_CHARS


def test_the_budget_never_decays_below_the_window_floor():
    """A small-window model was already near the floor, and must not be
    pushed under it by a second step."""
    for step in (0, 5, 15, 150):
        assert ax_filter.budget_for_window(204_000, step) >= ax_filter.BUDGET_FLOOR


def test_an_unresolved_window_is_unchanged_by_the_step():
    """Step 0's budget is read before the model resolves; that path must
    not also start decaying."""
    assert ax_filter.budget_for_window(None, step=99) == ax_filter.MAX_CHARS


def test_budget_only_ever_goes_down():
    w = 1_000_000
    prev = ax_filter.budget_for_window(w, step=0)
    for step in range(1, 40):
        cur = ax_filter.budget_for_window(w, step=step)
        assert cur <= prev, step
        prev = cur


# ── the step-summary window has a way back ───────────────────────────────


def _summaries(n):
    return [StepSummary(step=i, url=f"https://x.test/{i}",
                        action_taken=f"clicked {i}", outcome="ok",
                        extracted=f"found {i}")
            for i in range(n)]


def _history(n):
    from brotto_orchestrator.agent.context import AgentTurn
    from brotto_orchestrator.agent.harness import _turn_to_prompt
    return _turn_to_prompt(AgentTurn(
        task="t", step_number=n, scratchpad_notes="", scratchpad_entries=[],
        current_url="https://x.test", current_page_title="X",
        ax_tree="", ax_diff="", step_summaries=_summaries(n)))


def test_a_dropped_step_range_is_named():
    """`... 5 steps omitted ...` gave the model nothing to act on. It has
    to know WHICH steps before it can ask for them."""
    h = _history(20)
    # shown = 0,1,2 + 11..19, so 3..10 is what got dropped.
    assert "steps 3–10" in h
    assert "recall_steps" in h


def test_the_omission_marker_does_not_appear_when_nothing_was_dropped():
    assert "recall_steps" not in _history(5)


def test_the_window_still_keeps_the_discovery_where_it_is():
    """First 3 + last 9 is the shape; this pins that the *first* steps —
    where an entry-point URL gets found — are the ones never dropped."""
    h = _history(20)
    assert "Step 0 |" in h
    assert "Step 19 |" in h
    assert "Step 10 |" not in h


def test_recall_steps_fetches_what_the_window_dropped():
    import asyncio

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import _execute_action

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None,
                     step_summaries=_summaries(20))

    async def _go(args):
        return await _execute_action(
            ActionCall(action="recall_steps", action_args=args), deps)

    out = asyncio.new_event_loop().run_until_complete(_go({"from": 3, "to": 11}))
    assert "Step 3 |" in out and "Step 11 |" in out
    assert "Step 2 |" not in out and "Step 12 |" not in out
    # The extracted value is the point of recalling — a step that found
    # something must come back with it.
    assert "found 7" in out


def test_recall_steps_of_one_step_and_of_a_reversed_range():
    import asyncio

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import _execute_action

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None,
                     step_summaries=_summaries(20))

    async def _go(args):
        return await _execute_action(
            ActionCall(action="recall_steps", action_args=args), deps)

    loop = asyncio.new_event_loop()
    one = loop.run_until_complete(_go({"from": 7}))
    assert "Step 7 |" in one and "Step 8 |" not in one
    rev = loop.run_until_complete(_go({"from": 9, "to": 5}))
    assert "Step 5 |" in rev and "Step 9 |" in rev


def test_recall_steps_out_of_range_says_what_exists():
    import asyncio

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import _execute_action

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None,
                     step_summaries=_summaries(20))

    out = asyncio.new_event_loop().run_until_complete(_execute_action(
        ActionCall(action="recall_steps", action_args={"from": 500}), deps))
    assert "No steps in range" in out
    assert "19" in out  # the last step it does have


# ── a model that cannot decide fails the run ────────────────────────────


def test_an_undecidable_model_fails_the_run_instead_of_hanging():
    """Unhandled, UnexpectedModelBehavior propagated out of run(): the
    document kept status=running with an open turn, the trail was never
    closed, and the panel got a bare 'Exceeded maximum output retries'."""
    from brotto_orchestrator.agent.harness import _make_bad_decision_result
    from brotto_orchestrator.agent.context import AgentDeps

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None)
    deps.step_number = 16
    r = _make_bad_decision_result("minimax", "MiniMax-M3", deps)
    assert r.status == "failed"
    assert r.failure_reason == "invalid_decision"
    assert r.steps_taken == 16
    # Names the model and what to do — the old path named neither.
    assert "MiniMax-M3" in r.summary
    assert "different model" in r.summary


def test_plan_step_catches_it_and_records_why(tmp_path, monkeypatch):
    """The whole point of catching it: the reason was being thrown away,
    so a model that kept failing left a document saying errors: []."""
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    from brotto_orchestrator.agent import harness as harness_mod
    from brotto_orchestrator.agent.audit import AuditTrail
    from brotto_orchestrator.agent.context import AgentDeps, AgentTurn

    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x" * 8)

    async def _boom(*a, **kw):
        raise UnexpectedModelBehavior("Exceeded maximum output retries (2)")

    monkeypatch.setattr(harness_mod.agent, "run", _boom)

    audit = AuditTrail("s1")
    audit.begin_task("go")
    turn_no = audit.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                               ax_chars=1, ax_diff="", page_text_chars=0)
    deps = AgentDeps(user_id="u", task="go", cdp=None, ws_send=None)
    deps.step_number = 16

    turn = AgentTurn(task="go", step_number=0, scratchpad_notes="",
                     scratchpad_entries=[], current_url="u",
                     current_page_title="t", ax_tree="", ax_diff="",
                     step_summaries=[])

    import asyncio
    loop = asyncio.new_event_loop()
    out = loop.run_until_complete(
        harness_mod._plan_step(deps, turn, harness_mod.agent, audit))
    audit.close()

    assert out is None, "a failed plan must abandon the step, not fall through"
    assert deps.result is not None
    assert deps.result.failure_reason == "invalid_decision"

    import json
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert doc["errors"], "the reason must reach the document"
    assert doc["errors"][-1]["code"] == "invalid_decision"
    assert "retries" in doc["errors"][-1]["detail"]


# ── the runaway backstop is not a task limit ─────────────────────────────


def test_the_backstop_is_not_a_task_limit():
    """It was 30 and reported 'Max steps reached' on tasks that were
    still working, which is the one thing a user must never be told."""
    from brotto_orchestrator.agent.harness import AgentHarness
    assert AgentHarness.MAX_STEPS >= 100


@pytest.mark.parametrize("bad", ["max_steps_exceeded"])
def test_no_result_claims_a_step_policy_was_hit(bad):
    from brotto_orchestrator.agent import harness as harness_mod
    src = harness_mod.__file__
    with open(src) as fh:
        assert bad not in fh.read()
