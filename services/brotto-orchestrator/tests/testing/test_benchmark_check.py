"""`--check` — the only thing standing between a silent break and a commit.

Every case runs against a tmp baseline, so these never depend on the recorded
one being current (it is a moving target by design).
"""

import importlib.util
import json
import pathlib

from brotto_orchestrator.testing.outcome import Outcome
from brotto_orchestrator.testing.records import TaskRecord

# _check lives in the CLI script, not the package — load it by path.
_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "run_benchmark.py"
_spec = importlib.util.spec_from_file_location("brotto_run_benchmark", _SCRIPT)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_check = _mod._check


def _record(fixture, outcome, steps):
    return TaskRecord(
        task_id=f"t-{fixture}", fixture=fixture, outcome=outcome,
        steps_taken=steps, timing={"steps": steps, "total": 1.0},
    )


def _baseline(path, rows):
    path.write_text(json.dumps({
        "records": [
            {"fixture": f, "outcome": o.value, "timing": {"steps": s}}
            for f, o, s in rows
        ],
        "tally": {},
    }))


def test_regression_exits_1(tmp_path):
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-iframe", Outcome.PASS, 6)])
    assert _check([_record("auth-iframe", Outcome.PERCEPTION_FAILURE, 6)], baseline) == 1


def test_improvement_exits_0(tmp_path):
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-inbox", Outcome.PERCEPTION_FAILURE, 4)])
    assert _check([_record("auth-inbox", Outcome.PASS, 6)], baseline) == 0


def test_unchanged_exits_0(tmp_path):
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-inbox", Outcome.PERCEPTION_FAILURE, 4)])
    assert _check([_record("auth-inbox", Outcome.PERCEPTION_FAILURE, 4)], baseline) == 0


def test_same_rank_fewer_steps_exits_1(tmp_path):
    """The rank-equal case rank() cannot see.

    Dropping the AX context budget moves auth-inbox's failure to the login
    step: same outcome class, same reason string, same final_url — only the
    step count moves. Without this branch the run exits 0 with a broken row.
    """
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-inbox", Outcome.PERCEPTION_FAILURE, 4)])
    assert _check([_record("auth-inbox", Outcome.PERCEPTION_FAILURE, 3)], baseline) == 1


def test_same_rank_fewer_steps_on_pass_exits_0(tmp_path):
    """A PASS doing fewer steps is a faster pass, not a regression."""
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-popup", Outcome.PASS, 6)])
    assert _check([_record("auth-popup", Outcome.PASS, 5)], baseline) == 0


def test_missing_baseline_exits_1(tmp_path):
    assert _check([], tmp_path / "nope.json") == 1


def test_unbaselined_fixture_is_a_warning_not_a_regression(tmp_path, caplog):
    baseline = tmp_path / "baseline.json"
    _baseline(baseline, [("auth-iframe", Outcome.PASS, 6)])
    with caplog.at_level("WARNING"):
        assert _check([_record("auth-new", Outcome.PASS, 6)], baseline) == 0
    assert "no baseline entry" in caplog.text
