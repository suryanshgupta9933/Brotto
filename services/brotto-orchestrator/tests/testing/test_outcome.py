"""Failure attribution: exactly one Outcome per run, mapped to a wave."""

from __future__ import annotations

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.testing.outcome import (
    WAVE_BY_OUTCOME,
    Outcome,
    classify,
)


def _failed(reason: str | None, steps: int = 3) -> TaskResult:
    return TaskResult(status="failed", summary="", failure_reason=reason,
                      steps_taken=steps)


def test_harness_error_wins_over_everything():
    """A broken harness must never be scored as an agent failure — that
    blames the agent for our infrastructure."""
    assert classify(_failed("element not found"), harness_error=RuntimeError("boom")) \
        == Outcome.HARNESS_ERROR


def test_completed_is_pass():
    assert classify(TaskResult(status="completed", summary="done")) == Outcome.PASS


def test_perception_failure():
    assert classify(_failed("target not found in AX tree")) \
        == Outcome.PERCEPTION_FAILURE


def test_unresolvable_scripted_target_is_perception_not_harness():
    """This is the shape a shadow-DOM / canvas / iframe gap actually takes
    end to end: the script asks for a target and the AX tree has no such
    name. Attributing it to the harness would empty the Wave 0 signal."""
    assert classify(_failed("scripted target did not resolve: 'Archive'")) \
        == Outcome.PERCEPTION_FAILURE


def test_action_failure():
    assert classify(_failed("click did not change page state")) \
        == Outcome.ACTION_FAILURE


def test_recovery_failure():
    assert classify(_failed("stagnated: 3 repeats at same url")) \
        == Outcome.RECOVERY_FAILURE


def test_login_failure():
    assert classify(_failed("login required")) == Outcome.LOGIN_FAILURE


def test_budget_exhausted_at_max_steps():
    assert classify(_failed("unknown", steps=30)) == Outcome.BUDGET_EXHAUSTED


def test_budget_exhausted_on_explicit_reason():
    assert classify(_failed("token budget exhausted")) == Outcome.BUDGET_EXHAUSTED


def test_unknown_failure_is_recovery_not_pass():
    """Anything unrecognised must still land somewhere real. Defaulting to
    PASS would silently inflate the headline number."""
    assert classify(_failed("something nobody has seen before")) \
        == Outcome.RECOVERY_FAILURE


def test_awaiting_human_is_blocked_not_a_pass():
    assert classify(TaskResult(status="awaiting_human", summary="")) \
        == Outcome.RECOVERY_FAILURE


def test_stagnated_status_is_a_recovery_failure():
    assert classify(TaskResult(status="stagnated", summary="", steps_taken=6)) \
        == Outcome.RECOVERY_FAILURE


def test_login_page_beats_a_generic_stagnation_reason():
    """Rule order matters: a session wall is a LOGIN_FAILURE even when the
    harness also noticed the URL had stopped changing."""
    assert classify(_failed("login page — stagnant: 3 repeats", steps=3)) \
        == Outcome.LOGIN_FAILURE


def test_every_outcome_maps_to_a_wave():
    """The ids are consumed by a later task as a work-order key, so they are
    pinned to the spec's exact labels
    (docs/superpowers/specs/2026-09-28-measurement-spine-design.md)."""
    assert WAVE_BY_OUTCOME == {
        Outcome.PASS: "-",
        Outcome.PERCEPTION_FAILURE: "0A",
        Outcome.ACTION_FAILURE: "1A/1B/1C",
        Outcome.RECOVERY_FAILURE: "2A–2E",
        Outcome.LOGIN_FAILURE: "2E, 3A",
        Outcome.BUDGET_EXHAUSTED: "5C",
        Outcome.HARNESS_ERROR: "0C",
    }
    assert all(isinstance(v, str) and v for v in WAVE_BY_OUTCOME.values())


# --- The real reason vocabulary, as emitted by src/ -------------------------
# These are not invented: each is the literal failure_reason (or summary)
# the harness actually writes.


def test_scripted_target_string_is_perception():
    """harness.py:761 emits `scripted target did not resolve: {e}`."""
    assert classify(_failed("scripted target did not resolve: 'Archive'")) \
        == Outcome.PERCEPTION_FAILURE


def test_stagnation_ax_signal_is_perception():
    """agent/stagnation.py:34 emits "…element does not exist in AX tree" —
    the canonical Wave 0A perception signal."""
    reason = "find_element failed 2 consecutive times — element does not exist in AX tree"
    assert classify(_failed(reason)) == Outcome.PERCEPTION_FAILURE


def test_user_skipped_login_is_login_failure():
    """harness.py:924 emits `user_skipped_login` — the user hit a login wall
    and backed out, which is the 2E/3A signal."""
    assert classify(_failed("user_skipped_login")) == Outcome.LOGIN_FAILURE


def test_auth_failed_is_harness_error_not_a_login_wall():
    """harness.py:270 emits `auth_failed`, but it is the *model provider*
    rejecting our API key. Calling it a login failure would send wave 2E at
    a broken credential."""
    assert classify(_failed("auth_failed")) == Outcome.HARNESS_ERROR


def test_model_not_found_is_harness_error():
    """harness.py:259 / main.py:367 emit `model_not_found` — a bad
    `provider:model` config string, i.e. our bug."""
    assert classify(_failed("model_not_found")) == Outcome.HARNESS_ERROR


def test_cdp_preflight_failed_is_harness_error():
    """harness.py:813 emits `cdp_preflight_failed` — we could not attach to
    the browser, so nothing about the agent is being measured."""
    assert classify(_failed("cdp_preflight_failed")) == Outcome.HARNESS_ERROR


def test_max_steps_exceeded_is_budget_exhausted():
    """harness.py:1267 emits `max_steps_exceeded` with steps_taken=MAX_STEPS.

    steps=0 so the name alone decides — at steps=30 the max_steps fallback
    would satisfy this and the needle would go unpinned.
    """
    assert classify(_failed("max_steps_exceeded", steps=0)) \
        == Outcome.BUDGET_EXHAUSTED


def test_human_gates_stay_in_recovery():
    """user_denied / policy_blocked / policy_preflight are deliberate human
    or policy gates. They are pinned to RECOVERY_FAILURE on purpose so the
    next reader does not "fix" them into a new class."""
    for reason in ("user_denied", "policy_blocked", "policy_preflight"):
        assert classify(_failed(reason)) == Outcome.RECOVERY_FAILURE, reason


# --- Headline invariant: an unrecognised failure is never a pass ------------


def test_completed_with_scary_reason_is_still_pass():
    """A completed run is a pass whatever its reason string says — a
    leftover reason must not demote it."""
    assert classify(TaskResult(status="completed", summary="done",
                               failure_reason="auth_failed")) == Outcome.PASS


def test_none_and_empty_reason_both_classify_to_a_real_class():
    """Neither may raise or slip through as PASS."""
    for reason in (None, ""):
        assert classify(_failed(reason)) == Outcome.RECOVERY_FAILURE, reason


def test_budget_exhausted_boundary():
    """Exactly at the cap and one past it both exhaust the budget; one below
    it does not."""
    assert classify(_failed("unrecognised", steps=29)) == Outcome.RECOVERY_FAILURE
    assert classify(_failed("unrecognised", steps=30)) == Outcome.BUDGET_EXHAUSTED
    assert classify(_failed("unrecognised", steps=31)) == Outcome.BUDGET_EXHAUSTED


def test_outcome_values_are_stable_strings():
    """Written into committed benchmark JSON. Renaming one silently breaks
    historical comparison."""
    assert Outcome.PERCEPTION_FAILURE.value == "PERCEPTION_FAILURE"
    assert Outcome.BUDGET_EXHAUSTED.value == "BUDGET_EXHAUSTED"
