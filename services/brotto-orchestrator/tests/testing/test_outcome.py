"""Failure attribution: exactly one Outcome per run, mapped to a wave."""

from __future__ import annotations

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.testing.outcome import (
    OUTCOMES,
    WAVE_BY_OUTCOME,
    classify,
)


def _failed(reason: str, steps: int = 3) -> TaskResult:
    return TaskResult(status="failed", summary="", failure_reason=reason,
                      steps_taken=steps)


def test_harness_error_wins_over_everything():
    """A broken harness must never be scored as an agent failure — that
    blames the agent for our infrastructure."""
    assert classify(_failed("element not found"), harness_error=RuntimeError("boom")) \
        == OUTCOMES.HARNESS_ERROR


def test_completed_is_pass():
    assert classify(TaskResult(status="completed", summary="done")) == OUTCOMES.PASS


def test_perception_failure():
    assert classify(_failed("target not found in AX tree")) \
        == OUTCOMES.PERCEPTION_FAILURE


def test_unresolvable_scripted_target_is_perception_not_harness():
    """This is the shape a shadow-DOM / canvas / iframe gap actually takes
    end to end: the script asks for a target and the AX tree has no such
    name. Attributing it to the harness would empty the Wave 0 signal."""
    assert classify(_failed("scripted target did not resolve: 'Archive'")) \
        == OUTCOMES.PERCEPTION_FAILURE


def test_action_failure():
    assert classify(_failed("click did not change page state")) \
        == OUTCOMES.ACTION_FAILURE


def test_recovery_failure():
    assert classify(_failed("stagnated: 3 repeats at same url")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_login_failure():
    assert classify(_failed("login required")) == OUTCOMES.LOGIN_FAILURE


def test_budget_exhausted_at_max_steps():
    assert classify(_failed("unknown", steps=30)) == OUTCOMES.BUDGET_EXHAUSTED


def test_budget_exhausted_on_explicit_reason():
    assert classify(_failed("token budget exhausted")) == OUTCOMES.BUDGET_EXHAUSTED


def test_unknown_failure_is_recovery_not_pass():
    """Anything unrecognised must still land somewhere real. Defaulting to
    PASS would silently inflate the headline number."""
    assert classify(_failed("something nobody has seen before")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_awaiting_human_is_blocked_not_a_pass():
    assert classify(TaskResult(status="awaiting_human", summary="")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_stagnated_status_is_a_recovery_failure():
    assert classify(TaskResult(status="stagnated", summary="", steps_taken=6)) \
        == OUTCOMES.RECOVERY_FAILURE


def test_login_page_beats_a_generic_stagnation_reason():
    """Rule order matters: a session wall is a LOGIN_FAILURE even when the
    harness also noticed the URL had stopped changing."""
    assert classify(_failed("login page — stagnant: 3 repeats", steps=3)) \
        == OUTCOMES.LOGIN_FAILURE


def test_every_outcome_maps_to_a_wave():
    assert set(WAVE_BY_OUTCOME) == set(OUTCOMES)
    assert all(isinstance(v, str) and v for v in WAVE_BY_OUTCOME.values())


def test_outcome_values_are_stable_strings():
    """Written into committed benchmark JSON. Renaming one silently breaks
    historical comparison."""
    assert OUTCOMES.PERCEPTION_FAILURE.value == "PERCEPTION_FAILURE"
    assert OUTCOMES.BUDGET_EXHAUSTED.value == "BUDGET_EXHAUSTED"
