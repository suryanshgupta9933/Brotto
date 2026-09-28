"""Severity ordering — the contract that makes `--check` mean anything.

A reversed list fails silently: every run still exits 0, it just lies about
direction. So the two directions that matter are pinned here.
"""

from brotto_orchestrator.testing.outcome import SEVERITY, Outcome, rank


def test_pass_outranks_every_failure():
    """Closing a perception gap must move a fixture toward rank 0."""
    assert rank(Outcome.PASS.value) < rank(Outcome.PERCEPTION_FAILURE.value)
    for outcome in Outcome:
        if outcome is not Outcome.PASS:
            assert rank(Outcome.PASS.value) < rank(outcome.value), outcome


def test_harness_error_is_the_worst():
    """A broken harness produced no measurement, so it is not progress either."""
    assert rank(Outcome.HARNESS_ERROR.value) == len(SEVERITY) - 1
    for outcome in Outcome:
        assert rank(Outcome.HARNESS_ERROR.value) >= rank(outcome.value), outcome


def test_severity_covers_every_outcome_exactly_once():
    assert sorted(SEVERITY) == sorted(o.value for o in Outcome)


def test_unknown_outcome_ranks_worst():
    assert rank("SOMETHING_NEW") == len(SEVERITY)
