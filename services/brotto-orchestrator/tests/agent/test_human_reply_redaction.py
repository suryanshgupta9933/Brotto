"""An `ask_human` reply is the one secret a user types with no field to
type it into.

`type_text` is scrubbed at write time by `_scrubbed`; the ask_human path had
no equivalent, so a password or an OTP pasted into the reply box went to
disk twice — as the prompt's `response` and again inside the action outcome
the caller wraps it in.

The split that makes this safe to do at all: the outcome string is *also*
what the model reads on the next step. Redacting it in place would hand the
model `[redacted:password]` instead of the answer it needs to finish, so
disk gets the scrubbed value and the prompt does not.
"""

from __future__ import annotations

import asyncio

import pytest

from brotto_orchestrator.agent.audit import REDACTED, AuditTrail
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import (
    _ASK_REPLY_PREFIX,
    _execute_action,
    _recorded_reply_outcome,
)


def _deps() -> AgentDeps:
    async def _ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="u", task="t", cdp=None, ws_send=_ws_send)


def _turn(trail: AuditTrail) -> int:
    trail.set_goal("log in to my bank")
    return trail.begin_turn(step=0, url="https://bank.example/",
                            page_title="Bank", ax_targets=10, ax_chars=100,
                            ax_diff_chars=0, page_text_chars=50)


async def _run(trail, reply, question):
    """The reply, as the model sees it, and what the run loop wrote to
    disk. `record_action` lives in the loop rather than in
    `_execute_action`, so the second disk copy is produced the same way the
    loop produces it — otherwise this asserts on a path nothing writes."""
    deps = _deps()
    call = ActionCall(action="ask_human", action_args={"question": question})
    deps.human_input_queue.put_nowait(reply)
    turn = _turn(trail)
    outcome = await _execute_action(call, deps, audit=trail, turn=turn)

    rec_outcome, redacted = _recorded_reply_outcome(call, outcome)
    trail.record_action(turn, action=call.action, args=call.action_args,
                        outcome=rec_outcome, ok=True, redacted=redacted,
                        duration_ms=1)
    return outcome, trail.document()


@pytest.mark.parametrize("question,reply", [
    # Named by the reply — the shape type_text already covers.
    ("anything else?", "my password is hunter2"),
    # Named only by the question. Bare digits match no name pattern, so a
    # test on the reply alone misses this one entirely.
    ("what's the verification code?", "492013"),
])
async def test_a_secret_reply_never_reaches_disk(tmp_path, question, reply):
    outcome, doc = await _run(AuditTrail("s1", dir=tmp_path), reply, question)
    turns = doc["turns"][0]
    assert REDACTED in turns["prompts"][0]["response"], turns["prompts"][0]
    assert reply not in turns["actions"][0]["outcome"], turns["actions"][0]
    assert turns["actions"][0]["redacted"] is True
    # …and the model still gets the answer it needs to finish the task.
    assert outcome == f"{_ASK_REPLY_PREFIX}{reply}"


async def test_an_ordinary_reply_is_kept_verbatim(tmp_path):
    """The other half. Over-redaction costs a replay that reads
    `[redacted:password]` over the answer to "which repo?", which is a
    worse outcome than the leak it prevents."""
    reply = "the one under Work/personal"
    _, doc = await _run(AuditTrail("s1", dir=tmp_path), reply, "which repo?")
    turns = doc["turns"][0]
    assert turns["prompts"][0]["response"] == reply
    assert turns["actions"][0]["outcome"] == f"{_ASK_REPLY_PREFIX}{reply}"
    assert turns["actions"][0]["redacted"] is False