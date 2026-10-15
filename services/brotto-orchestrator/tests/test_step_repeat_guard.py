"""Consecutive identical step_summaries must reach the model as a nudge."""

from brotto_orchestrator.agent.context import AgentTurn, StepSummary
from brotto_orchestrator.agent.harness import _turn_to_prompt, repeat_nudge


def _s(step, outcome, url="https://x.test/feed", action="find_element"):
    return StepSummary(step=step, url=url, action_taken=action, outcome=outcome)


def _turn(summaries):
    return AgentTurn(
        task="sort by stars", step_number=len(summaries),
        scratchpad_entries=[], current_url="https://x.test/feed",
        current_page_title="feed", ax_tree="", ax_diff="",
        step_summaries=summaries,
        repeat_warning=repeat_nudge(summaries),
    )


def test_identical_consecutive_steps_nudge():
    summaries = [
        _s(1, "Looking for the Stars sort option in the menu"),
        _s(2, "Looking for the Stars sort option in the menu"),
    ]
    nudge = repeat_nudge(summaries)
    assert nudge
    assert "Do not repeat it" in nudge
    # and it must actually reach the prompt
    assert "## Repeated step" in _turn_to_prompt(_turn(summaries))


def test_near_identical_steps_nudge():
    summaries = [
        _s(1, "Looking for the Stars sort option in the menu"),
        _s(2, "Finding the Stars option in the open sort menu"),
    ]
    assert repeat_nudge(summaries)
    assert "## Repeated step" in _turn_to_prompt(_turn(summaries))


def test_different_steps_do_not_nudge():
    summaries = [
        _s(1, "Clicked the Sort button", action="click"),
        _s(2, "Menu opened", action="read_page_text"),
    ]
    assert repeat_nudge(summaries) == ""
    assert "## Repeated step" not in _turn_to_prompt(_turn(summaries))


def test_single_step_does_not_nudge():
    assert repeat_nudge([_s(1, "Clicked the Sort button")]) == ""


def test_navigation_is_not_a_loop():
    summaries = [
        _s(1, "Looking for the Stars sort option", url="https://x.test/feed"),
        _s(2, "Looking for the Stars sort option", url="https://x.test/feed?q=stars"),
    ]
    assert repeat_nudge(summaries) == ""