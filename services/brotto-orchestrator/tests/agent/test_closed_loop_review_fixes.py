"""The four defects the architecture review found in the closed loop."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT
import brotto_orchestrator.agent.harness as harness_mod


def _deps(*, grid_value: str | None = "age", grid_ok: bool = True) -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value="Typed 4 characters")
    cdp.grid_op = AsyncMock(return_value={
        "ok": grid_ok, "address": "A1", "value": grid_value,
        "state": "ok" if grid_ok else "unreadable",
        "error": "" if grid_ok else "no mirror",
    })
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run(deps, action, args):
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=None, turn=1)


# --- 1. only a MISMATCH escalates ---------------------------------------

@pytest.mark.asyncio
async def test_three_unreadable_writes_do_not_end_the_run():
    deps = _deps(grid_ok=False)
    for cell in ("A1", "B2", "C3"):
        await _run(deps, "write_text", {"target": {"cell": cell}, "value": "name"})
    assert len(deps.ledger) == 3
    assert deps.blocked_attempts == 0, "an unknown is not a blocked write"
    assert deps.result is None


@pytest.mark.asyncio
async def test_three_mismatched_writes_end_the_run():
    deps = _deps(grid_value="age")
    for cell in ("A1", "B2", "C3"):
        await _run(deps, "write_text", {"target": {"cell": cell}, "value": "name"})
    assert deps.blocked_attempts == 3
    out = await _run(deps, "write_text", {"target": {"cell": "D4"}, "value": "name"})
    assert "REFUSED" in out
    assert deps.result is not None
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == "cannot_complete"


@pytest.mark.asyncio
async def test_unreadable_attempts_do_not_exhaust_one_target():
    deps = _deps(grid_ok=False)
    for value in ("a", "b", "c", "d"):
        out = await _run(deps, "write_text",
                         {"target": {"cell": "A1"}, "value": value})
    assert "already been written" not in out
    assert len(deps.ledger) == 4


# --- 2. no plan is not a free pass --------------------------------------

@pytest.mark.asyncio
async def test_a_run_with_a_ledger_and_no_plan_is_verified():
    deps = _deps(grid_value="age")
    await _run(deps, "write_text", {"target": {"cell": "A1"}, "value": "name"})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" in out
    assert "age" in out
    assert deps.result is None


@pytest.mark.asyncio
async def test_an_unreadable_ledger_target_refuses_with_the_unknown_wording():
    deps = _deps(grid_ok=False)
    await _run(deps, "write_text", {"target": {"cell": "A1"}, "value": "name"})
    out = await _run(deps, "task_complete", {"summary": "done"})
    assert "REFUSED" in out
    assert "could not be read back" in out


@pytest.mark.asyncio
async def test_a_run_with_no_plan_and_no_ledger_completes_as_before():
    deps = _deps()
    out = await _run(deps, "task_complete", {"summary": "read the page"})
    assert out == "Task complete"
    assert deps.result.status == "completed"
    assert deps.result.summary == "read the page"


@pytest.mark.asyncio
async def test_the_second_completion_after_a_refusal_fails_the_run():
    deps = _deps(grid_value="age")
    await _run(deps, "write_text", {"target": {"cell": "A1"}, "value": "name"})
    await _run(deps, "task_complete", {"summary": "A1 = name"})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert deps.result is not None
    # Still unresolved: the run ends as a failure, never as a completion.
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == "cannot_complete"
    assert "not confirmed" in deps.result.summary
    assert out.startswith("Task closed as failed")


# --- 3. reads and bookkeeping are read-only -----------------------------

def test_read_state_and_set_plan_do_not_arm_the_unverified_guard():
    assert harness_mod._is_mutating("read_state") is False
    assert harness_mod._is_mutating("set_plan") is False
    assert "read_state" in harness_mod._READ_ONLY_ACTIONS
    assert "set_plan" in harness_mod._READ_ONLY_ACTIONS


# --- 4. one write path in the prompt ------------------------------------

def test_the_prompt_states_one_write_path():
    assert "write_text into the content box" not in SYSTEM_PROMPT
    assert "write_text with a CELL target" in SYSTEM_PROMPT
    # The closed loop's own statement is the one that stays.
    assert "READS THE TARGET" in SYSTEM_PROMPT


# --- smaller points ------------------------------------------------------

def test_a_refusal_is_not_recorded_as_an_ok():
    assert harness_mod._action_ok("write_text → confirmed: A1 now reads 'name'")
    assert not harness_mod._action_ok("REFUSED: you already tried 'name' into A1")
    assert not harness_mod._action_ok("Error executing click")


@pytest.mark.asyncio
async def test_the_ledger_keeps_only_the_last_fifty_entries():
    deps = _deps(grid_value="name")
    for i in range(55):
        await _run(deps, "write_text",
                   {"target": {"cell": f"A{i}"}, "value": "name"})
    assert len(deps.ledger) == harness_mod.LEDGER_MAX == 50
    assert deps.ledger[-1].target_key == "cell:A54"