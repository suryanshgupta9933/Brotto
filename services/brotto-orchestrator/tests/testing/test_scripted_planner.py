"""ScriptedPlanner: deterministic decisions with no model, key, or network."""

from __future__ import annotations

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentTurn
from brotto_orchestrator.testing.scripted_planner import (
    ScriptedPlanner,
    ScriptedStep,
    ref_by_name,
    resolve_ref,
)


AX = (
    'heading "Inbox"  [ref=heading_aaa111]\n'
    '[button_a1b2c3] button "Next"  [ref=button_a1b2c3]\n'
    '[textbox_d4e5f6] textbox "Search"  value=""\n'
    '[off-screen] [link_99aa11] link "Settings"  [ref=link_99aa11]\n'
)


def _turn(ax_tree: str = AX) -> AgentTurn:
    return AgentTurn(
        task="t", step_number=0, scratchpad_notes="", scratchpad_entries=[],
        current_url="http://x/", current_page_title="x", ax_tree=ax_tree,
        ax_diff="", step_summaries=[],
    )


# ── resolve_ref ─────────────────────────────────────────────────────────────

def test_resolve_ref_finds_by_accessible_name():
    assert resolve_ref(AX, "Next") == "button_a1b2c3"


def test_resolve_ref_ignores_off_screen_marker_in_ref():
    """The off-screen block is a second prefixed copy of the line. The ref
    captured there must still be the plain ref, not a line index."""
    assert resolve_ref(AX, "Settings") == "link_99aa11"


def test_resolve_ref_filters_by_role():
    assert resolve_ref(AX, "Next", role="link") is None
    assert resolve_ref(AX, "Next", role="button") == "button_a1b2c3"


def test_resolve_ref_missing_returns_none():
    """Never raises and never returns a stale ref — a fabricated ref would
    click whatever happens to occupy that slot."""
    assert resolve_ref(AX, "Nonexistent") is None


def test_resolve_ref_empty_tree_returns_none():
    assert resolve_ref("", "Next") is None


# ── ScriptedPlanner sequencing ──────────────────────────────────────────────

def _click(name: str) -> ScriptedStep:
    return ScriptedStep(
        thought=f"click {name}",
        actions=[ActionCall(action="click", action_args={"ref": ref_by_name(name)})],
    )


def test_next_returns_steps_in_order_then_exhausts():
    planner = ScriptedPlanner([_click("Next"), _click("Search")])
    assert planner.next(_turn()).actions[0].action_args["ref"] == "button_a1b2c3"
    assert planner.cursor == 1
    assert planner.next(_turn()).actions[0].action_args["ref"] == "textbox_d4e5f6"
    assert planner.cursor == 2


def test_exhaustion_is_explicit_not_a_silent_budget_failure():
    """Review Focus #2. Running past the script must say so, so a short
    script is never misread as a 30-step model failure."""
    planner = ScriptedPlanner([_click("Next")])
    planner.next(_turn())
    decision = planner.next(_turn())
    assert [a.action for a in decision.actions] == ["cannot_complete"]
    assert "script exhausted" in decision.reasoning


def test_exhaustion_on_empty_script():
    planner = ScriptedPlanner([])
    assert [a.action for a in planner.next(_turn()).actions] == ["cannot_complete"]


def test_on_exhausted_can_terminate_instead():
    planner = ScriptedPlanner([], on_exhausted="task_complete")
    assert [a.action for a in planner.next(_turn()).actions] == ["task_complete"]


def test_ref_is_resolved_per_step_not_cached():
    """Review Focus #5. Dynamic pages renumber refs constantly, so the ref
    must be looked up in the AX tree the step is actually about to act on."""
    planner = ScriptedPlanner([_click("Next"), _click("Next")])
    assert planner.next(_turn(AX)).actions[0].action_args["ref"] == "button_a1b2c3"
    moved = AX.replace("button_a1b2c3", "button_zzz999")
    assert planner.next(_turn(moved)).actions[0].action_args["ref"] == "button_zzz999"


def test_unresolvable_ref_raises_instead_of_clicking_stale():
    """A vanished target must fail loudly. Falling back to the previously
    resolved ref would click whatever now occupies that slot."""
    planner = ScriptedPlanner([_click("Next"), _click("Next")])
    planner.next(_turn(AX))
    with pytest.raises(LookupError):
        planner.next(_turn(AX.replace('"Next"', '"Gone"')))
