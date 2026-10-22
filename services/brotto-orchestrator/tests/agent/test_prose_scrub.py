"""The model's own words are the model's, and a scrub must not eat them.

Two defects, both measured on a failed Google Sheets run whose audit document
is the record of both.

(a) The substitution was a bare `str.replace`, so a value that happened to be
    a PREFIX of an ordinary word ate it. "Age" inside "Agent" came out as
    "[withheld from the record]nt": the model could not read its own sentence
    and the user saw gibberish.

(b) The list mixed two different things. `latched` holds values a field
    POSITIVELY identified as credentials. `typed_secrets` held every value we
    merely refused to write — and on a canvas every typed value is one of
    those, because a canvas cell has no backend node and a blank accessible
    name. So ordinary words went on the list and were rewritten out of the
    model's own sentences: a measured run's thought read "A1 should say
    [withheld from the record]" for the header it had typed a moment before.

An ambiguous value is still masked where it was typed — the action's own
arguments carry the per-action `redact` flag — and that is where the masking
belongs. PRIVACY.md says the model's prose about the page survives in full
and only credential-shaped fields are masked.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import (
    AgentHarness, _scrub_known_secrets,
)
from brotto_orchestrator.agent.prompt import WITHHELD
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


# --- the substitution -------------------------------------------------------

def test_a_value_does_not_eat_the_word_it_is_a_prefix_of():
    """The measured failure. "Age" is a prefix of "Agent"."""
    out = _scrub_known_secrets(
        "The page Agent shows Messages about the age of the Image.", ["Age"])
    assert "Agent" in out, "an ordinary word was eaten by a value inside it"
    assert "[withheld from the record]nt" not in out


def test_a_value_is_still_replaced_where_it_stands_alone():
    out = _scrub_known_secrets("I typed Age into the first cell.", ["Age"])
    assert "Age" not in out
    assert WITHHELD in out


def test_the_longest_value_wins():
    out = _scrub_known_secrets("token abcdef here", ["abc", "abcdef"])
    assert "def" not in out, "the short value won over the long one"
    assert out.count(WITHHELD) == 1


def test_a_value_is_not_replaced_inside_a_longer_word():
    out = _scrub_known_secrets("cabin and cabin", ["cab"])
    assert "cabin" in out
    assert WITHHELD not in out


# --- the list ---------------------------------------------------------------

class _EmptyResult:
    usage = None


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="write a name", cdp=cdp, ws_send=ws_send)


@pytest.mark.asyncio
async def test_an_unclassified_value_stays_in_the_models_own_words(monkeypatch):
    """A canvas cell has no backend node, so every value typed into one is
    redacted-but-unclassified. That is ordinary data — a name, a heading —
    and rewriting it out of the model's narration is what broke the run."""
    value = "Alice"

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        deps.result = None
        return AgentDecision(
            reasoning="s", thought=f"A1 should say {value}.",
            actions=[
                ActionCall(action="type_text",
                           action_args={"ref": "0:99", "text": value}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert value in deps.step_summaries[0].extracted, (
        "the model's own sentence was rewritten by a value it typed itself")


@pytest.mark.asyncio
async def test_an_unclassified_value_is_still_masked_where_it_was_typed(monkeypatch):
    """The other half of the same rule: the value never reaches the disk.

    The masking lives in the action's arguments, and it is the per-action
    `redact` flag that puts it there — not the prose scrub list, which is
    about the model's words and nothing else.
    """
    value = "Alice"
    audit_doc: list = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        audit_doc.append(audit)
        deps.result = None
        return AgentDecision(
            reasoning="s", thought=f"A1 should say {value}.",
            actions=[
                ActionCall(action="type_text",
                           action_args={"ref": "0:99", "text": value}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert audit_doc, "the run wrote no audit document to check"
    written = json.dumps([a.document() for a in audit_doc])
    assert "[redacted:password]" in written, "the typed value was not masked"
    # The prose is not the place the value is masked — so it is there, and
    # that is the published rule, not a leak.
    assert value in written, "the model's own prose was rewritten on disk"


@pytest.mark.asyncio
async def test_a_credential_is_still_scrubbed_out_of_the_models_words(monkeypatch):
    """Only the *list* narrowed. A positively identified credential is
    still rewritten wherever the model's own words carry it."""
    secret = "hunter2"

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        deps.result = None
        return AgentDecision(
            reasoning="s", thought=f"Filling the form with {secret}.",
            actions=[
                ActionCall(action="type_text",
                           action_args={"ref": "0:2", "text": secret}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:2", tag="input", role="textbox",
                       name="Password")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="sign in", cdp=cdp, ws_send=ws_send)
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert secret not in deps.step_summaries[0].extracted
    assert WITHHELD in deps.step_summaries[0].extracted
