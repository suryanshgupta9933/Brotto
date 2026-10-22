"""A cell's value is TYPED input, so it is redacted on the way to disk.

`write_text` types into a grid, which is the same class of thing as
`type_text`'s text — a value the user typed — and it was reaching the
session file in three places the `type_text` path already masked: the
recorded `args`, the recorded `outcome` (which names the value it read
back), and the step summary's `action_taken`. `read_state` returns a value
read off the page into its outcome.

The in-memory compare is on the REAL value: a masked read-back would turn
every write into `unknown`.
"""

from __future__ import annotations

import json

from brotto_orchestrator.agent.audit import AuditTrail
from brotto_orchestrator.agent.context import ActionCall
import brotto_orchestrator.agent.harness as harness_mod

CARD = "4111111111111111"


def _record(tmp_path, action: str, args: dict, outcome: str) -> str:
    """Write one action the way the loop does, and return the file's text."""
    audit = AuditTrail("s-redact", dir=tmp_path)
    audit.begin_task("fill a cell")
    turn = audit.begin_turn(step=1, url="https://docs.google.com/", page_title="S",
                            ax_targets=1, ax_chars=1, ax_diff_chars=0,
                            page_text_chars=0)
    call = ActionCall(action=action, action_args=args)
    rec_args, trace = harness_mod._scrubbed(call, False)
    rec_outcome, _ = harness_mod._recorded_reply_outcome(call, outcome)
    audit.record_action(turn, action=action, args=rec_args, outcome=rec_outcome,
                        ok=True, redacted=True, duration_ms=1, target="cell:A1")
    audit.close()
    # The step summary's `action_taken` is the trace, and it reaches the next
    # prompt (not the document — step summaries are not persisted).
    assert CARD not in trace or action == "read_state"
    return (tmp_path / "s-redact.json").read_text()


def test_a_typed_cell_value_does_not_reach_the_session_file(tmp_path):
    text = _record(
        tmp_path, "write_text",
        {"target": {"cell": "A1"}, "value": CARD},
        f"write_text → confirmed: cell:A1 now reads {CARD!r}")
    assert CARD not in text
    # The record is still a record: the target and the verdict survive.
    assert "cell:A1" in text
    assert "confirmed" in text
    assert "[redacted" in text


def test_the_ledger_keeps_the_real_value_in_memory(tmp_path):
    deps = harness_mod.AgentDeps(
        user_id="t", task="fill", cdp=None, ws_send=None)
    deps.ledger.append(harness_mod.WriteAttempt(
        target_key="cell:A1", intended=CARD, observed=CARD,
        confirmed=True, mechanism="content-box", step=1))
    # The compare is on the real value, so `is_redacted_value` says no and a
    # resumed run can grade from it.
    assert not harness_mod.is_redacted_value(deps.ledger[0].intended)
    assert deps.ledger[0].intended == CARD


def test_a_value_read_back_off_the_page_is_masked_in_the_outcome(tmp_path):
    text = _record(tmp_path, "read_state", {"target": {"cell": "A1"}},
                   f"read_state → cell:A1 = {CARD!r}")
    assert CARD not in text
    assert "read_state" in text and "cell:A1" in text


def test_an_ordinary_value_still_reads_as_itself(tmp_path):
    """Over-redaction is a cost, not a guarantee: `Alice` is not masked."""
    text = _record(tmp_path, "write_text",
                   {"target": {"cell": "A1"}, "value": "Alice"},
                   "write_text → confirmed: cell:A1 now reads 'Alice'")
    doc = json.loads(text)
    action = doc["turns"][0]["actions"][0]
    assert action["outcome"] == "write_text → confirmed: cell:A1 now reads 'Alice'"
    # The ARGUMENT is masked regardless — a cell value is typed input.
    assert action["args"]["value"] != "Alice"