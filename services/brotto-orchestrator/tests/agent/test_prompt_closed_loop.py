"""The prompt teaches the closed loop and stops teaching the old way."""

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def test_the_prompt_offers_write_text_and_not_type_text():
    assert "write_text(" in SYSTEM_PROMPT
    assert "type_text(" not in SYSTEM_PROMPT


def test_the_prompt_explains_the_three_states():
    assert "could not be read back" in SYSTEM_PROMPT
    assert "NOT confirmed" in SYSTEM_PROMPT


def test_the_prompt_teaches_the_plan():
    assert "set_plan(" in SYSTEM_PROMPT


def test_the_old_summary_section_is_gone():
    assert "Writing the summary for task_complete" not in SYSTEM_PROMPT


def test_the_turn_carries_the_ledger_and_the_plan():
    from brotto_orchestrator.agent.harness import _turn_to_prompt
    from brotto_orchestrator.agent.context import AgentTurn

    turn = AgentTurn(
        task="write a name", step_number=1, scratchpad_entries=[],
        current_url="https://docs.google.com/spreadsheets/d/abc/edit",
        current_page_title="Sheet", ax_tree="(empty)", ax_diff="",
        step_summaries=[], page_text="", ledger_text="1 write attempt(s):\ncell:A1  confirmed",
        plan_text="1. write A1 = name  [pending]",
    )
    prompt = _turn_to_prompt(turn)
    assert "## Your plan" in prompt and "write A1 = name" in prompt
    assert "## What you have written so far" in prompt and "cell:A1" in prompt
    # The plan and the ledger sit BEFORE the page, not after the tree.
    assert prompt.index("## Your plan") < prompt.index("### AX Tree")
    assert prompt.index("## What you have written so far") < prompt.index("### AX Tree")


def test_a_turn_with_no_writes_still_says_so():
    from brotto_orchestrator.agent.harness import _turn_to_prompt
    from brotto_orchestrator.agent.context import AgentTurn

    turn = AgentTurn(
        task="read the page", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/", current_page_title="Example",
        ax_tree="(empty)", ax_diff="", step_summaries=[], page_text="",
    )
    prompt = _turn_to_prompt(turn)
    assert "## Your plan" in prompt, "an undeclared plan is still a fact"
    assert "## What you have written so far" in prompt