"""A decision the model left incomplete must be recoverable, not fatal.

Measured against MiniMax-M3 on a Gmail search-results prompt: 2 of 6 runs
called `final_result` with `reasoning` and `thought` and no `actions` at
all. pydantic-ai's retry prompt for that is a raw pydantic error
(`[{'type': 'missing', 'loc': ('actions',), ...}]`), and the model repeated
the identical omission on all three attempts — so the run died with
"Exceeded maximum output retries (2)" and the document said nothing about
why. The schema is changed to absorb the omission and the retry prompt is
replaced with one that says what to do about it.
"""

import pytest
from pydantic import ValidationError
from pydantic_ai.exceptions import ModelRetry

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.context import ActionCall, AgentDecision


def _validator():
    """The output validator registered on the module-level agent."""
    assert harness_mod._require_actions, "validator not registered"
    return harness_mod._require_actions


def test_a_missing_actions_field_is_accepted_by_the_schema():
    """The omission has to reach the validator to be retried at all.

    While `actions` was required, pydantic-ai rejected the tool call
    before any validator ran and sent the raw pydantic error back as the
    retry prompt — which is the message the model demonstrably could not
    act on.
    """
    d = AgentDecision(reasoning="looking", thought="reading the list")
    assert d.actions == []


def test_a_decision_with_no_actions_is_retried_with_an_actionable_message():
    d = AgentDecision(reasoning="Task is complete", thought="nothing needs a reply")
    with pytest.raises(ModelRetry) as ei:
        _validator()(None, d)
    msg = str(ei.value)
    assert "actions" in msg
    assert "task_complete" in msg, "the retry must name the action to emit"


def test_a_decision_with_actions_passes_through_untouched():
    d = AgentDecision(
        reasoning="read it", thought="reading",
        actions=[ActionCall(action="read_page_text", action_args={})],
    )
    assert _validator()(None, d) is d


def test_the_recorded_failure_names_the_cause_not_just_the_wrapper():
    """`str(exc)` on this failure is literally "Exceeded maximum output
    retries (2)" — it names neither what was wrong nor what to do. The
    cause chain is the whole reason the run is diagnosable at all."""
    wrapper = RuntimeError("Exceeded maximum output retries (2)")
    wrapper.__cause__ = RuntimeError("actions: Field required")
    detail = harness_mod._failure_detail(wrapper)
    assert "actions: Field required" in detail
    assert "Exceeded maximum output retries" in detail


def test_the_failure_detail_survives_a_bare_exception():
    assert "boom" in harness_mod._failure_detail(ValueError("boom"))
