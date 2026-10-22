"""A run must never end as "completed" while a verdict is unresolved.

And a target key that holds page text must not be compared raw: the
persisted blocks carry a digest of it, so the comparison is on the opaque
form of both sides.
"""

from __future__ import annotations

import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.closed_loop import (
    PlanItem, WriteAttempt, opaque_target_key,
)
import brotto_orchestrator.agent.harness as harness_mod


def _deps(*, cells: dict[str, str] | None = None) -> AgentDeps:
    """A grid whose cell values the test holds: `cells` maps A1 -> value."""
    values = dict(cells or {})

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()

    async def _grid(op, address, value=None):
        if op == "grid_write_cell":
            values[str(address).upper()] = str(value)
            return {"ok": True, "address": address, "state": "ok", "error": ""}
        return {"ok": True, "address": address,
                "value": values.get(str(address).upper()),
                "state": "ok", "error": ""}

    cdp.grid_op = AsyncMock(side_effect=_grid)
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run(deps, action, args):
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=None, turn=1)


# --- the completion rule -------------------------------------------------

@pytest.mark.asyncio
async def test_two_unresolved_completions_end_the_run_as_failed():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    await _run(deps, "task_complete", {"summary": "A1 = name"})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})

    assert deps.result is not None
    assert deps.result.status != "completed"
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == "cannot_complete"
    # The user must be able to read what the page actually holds.
    assert "age" in deps.result.summary
    assert "not confirmed" in deps.result.summary
    assert "closed as failed" in out


@pytest.mark.asyncio
async def test_a_fresh_write_that_lands_lets_the_run_finish():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    first = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" in first
    assert deps.result is None

    # The model fixes the cell...
    await _run(deps, "write_text",
               {"target": {"cell": "A1"}, "value": "name"})
    # ...and the fresh read confirms it.
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})

    assert "REFUSED" not in out
    assert deps.result is not None
    assert deps.result.status == "completed"
    assert deps.result.summary == "A1 = name"


@pytest.mark.asyncio
async def test_the_first_unresolved_completion_does_not_end_the_run():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" in out
    assert deps.result is None


# --- the target key ------------------------------------------------------

def test_a_cell_address_is_left_alone():
    assert opaque_target_key("cell:A1") == "cell:A1"


def test_a_ref_key_is_digested():
    out = opaque_target_key("ref:textbox:full name")
    assert re.fullmatch(r"sha256:ref:[0-9a-f]{16}", out)
    assert "full name" not in out


def test_a_description_key_is_digested():
    out = opaque_target_key("desc:some phrase")
    assert re.fullmatch(r"sha256:desc:[0-9a-f]{16}", out)
    assert "phrase" not in out


def test_a_readable_key_that_looks_like_a_digest_is_still_digested():
    """The collision the `sha256:` prefix exists to close: page text can spell
    out something shaped like a digest, and it must not be mistaken for one."""
    out = opaque_target_key("desc:d:0123456789abcdef")
    assert re.fullmatch(r"sha256:desc:[0-9a-f]{16}", out)
    assert out != "desc:d:0123456789abcdef"


def test_the_digest_is_idempotent():
    once = opaque_target_key("ref:textbox:full name")
    assert opaque_target_key(once) == once


def test_the_same_name_digests_the_same_and_a_different_one_does_not():
    assert (opaque_target_key("ref:textbox:full name")
            == opaque_target_key("ref:textbox:full name"))
    assert (opaque_target_key("ref:textbox:full name")
            != opaque_target_key("ref:textbox:other name"))


def test_a_digested_key_still_matches_the_readable_one():
    """The resume path: the document holds the digest, the run holds the key."""
    readable = "ref:textbox:full name"
    item = PlanItem(id=1, intent="write a name", target_key=opaque_target_key(readable),
                    value="name", status="pending")
    deps = _deps()
    deps.plan = [item]
    deps.ledger = [WriteAttempt(target_key=readable, intended="name",
                                observed="name", confirmed=True,
                                mechanism="ref", step=1)]
    assert harness_mod._current_attempt(item.target_key, deps) is not None
    harness_mod._sync_plan(deps)
    assert item.status == "confirmed"


def test_the_persisted_blocks_hold_no_page_text(tmp_path):
    """A `ref:` key names an element off the page, so the page's name does
    not go to disk — the digest of it does."""
    from brotto_orchestrator.agent.audit import AuditTrail

    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a name")
    trail.record_ledger(step=1, attempts=[{
        "target_key": "ref:textbox:full name", "intended": "name",
        "observed": "name", "confirmed": True, "mechanism": "ref", "step": 1,
    }])
    trail.record_plan(items=[{
        "id": 1, "intent": "write a name", "target_key": "ref:textbox:full name",
        "value": "name", "status": "pending",
    }])
    text = (tmp_path / "s1.json").read_text()
    assert "full name" not in text
    assert "sha256:ref:" in text
