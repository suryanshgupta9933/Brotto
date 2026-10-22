"""The vocabulary the closed loop is written against."""

from brotto_orchestrator.agent.closed_loop import (
    CONFIRMED, MISMATCH, UNKNOWN, ADAPTERS, DEFAULT_ADAPTER,
    PlanItem, WriteAttempt, adapter_for, canonical_target_key,
    compare_observed, normalise_value, render_ledger, render_plan,
)


def test_a_cell_reference_is_canonicalised():
    assert canonical_target_key({"cell": " a1 "}) == "cell:A1"
    assert canonical_target_key({"cell": "A1"}) == "cell:A1"


def test_a_description_is_normalised():
    assert canonical_target_key({"description": "  The   Search Box "}) == \
        "desc:the search box"


def test_a_ref_key_uses_the_resolved_description_not_the_ephemeral_ref():
    key = canonical_target_key({"ref": "0:12"}, resolved="textbox:Search")
    assert key == "ref:textbox:Search"
    assert "0:12" not in key


def test_a_ref_with_no_resolution_falls_back_to_the_ref():
    assert canonical_target_key({"ref": "0:12"}) == "ref:0:12"


def test_comparison_is_normalised():
    assert compare_observed("  Name ", "name") == CONFIRMED
    assert compare_observed("age", "name") == MISMATCH


def test_an_unreadable_target_is_unknown_not_a_mismatch():
    assert compare_observed(None, "name") == UNKNOWN


def test_an_empty_read_of_a_filled_cell_is_a_mismatch():
    # The read WAS performed: the mirror held nothing, so the cell is empty.
    assert compare_observed("", "name") == MISMATCH


def test_the_grid_adapter_needs_the_origin_and_the_path():
    assert adapter_for("https://docs.google.com/spreadsheets/d/abc/edit").app \
        == "google-sheets"
    # Same host, different application.
    assert adapter_for("https://docs.google.com/document/d/abc/edit") is DEFAULT_ADAPTER
    # Same path, different host.
    assert adapter_for("https://evil.example/spreadsheets/d/abc") is DEFAULT_ADAPTER


def test_the_ledger_renders_the_discrepancy():
    out = render_ledger([
        WriteAttempt(target_key="cell:A1", intended="name", observed="age",
                     confirmed=False, mechanism="content-box", step=4),
    ])
    assert "A1" in out and "name" in out and "age" in out
    assert "NOT confirmed" in out


def test_the_plan_renders_its_status():
    out = render_plan([
        PlanItem(id=1, intent="write A1 = name", target_key="cell:A1",
                 value="name", status="confirmed"),
        PlanItem(id=2, intent="write B1 = age", target_key="cell:B1",
                 value="age", status="pending"),
    ])
    assert "write A1 = name" in out and "confirmed" in out
    assert "write B1 = age" in out and "pending" in out


def test_an_empty_ledger_and_an_empty_plan_say_so():
    assert render_ledger([]) == "(no writes yet)"
    assert render_plan([]) == "(no plan declared)"


def test_an_unreadable_ledger_entry_says_it_could_not_be_read_back():
    out = render_ledger([
        WriteAttempt(target_key="cell:A1", intended="name", observed=None,
                     confirmed=False, mechanism="grid_write_cell", step=2),
    ])
    assert "could not be read back" in out
    assert "NOT confirmed" not in out


def test_a_target_that_is_none_of_the_three_raises_for_the_harness_to_refuse():
    import pytest

    for bad in ({}, {"x": 1}, {"cell": "  "}, {"ref": ""}):
        with pytest.raises(ValueError):
            canonical_target_key(bad)