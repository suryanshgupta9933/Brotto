"""Nothing expires unless the user asks it to, and then it expires completely.

Retention is opt-in: a self-hoster who has never heard of
`BROTTO_RETENTION_DAYS` keeps every session forever, which is the honest
default for their own disk. What is not acceptable is the opposite failure —
a sweep that runs and quietly leaves sidecars behind.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent.audit import (
    AuditTrail,
    Scratchpad,
    list_sessions,
    prune_older_than,
)
from brotto_orchestrator.main import retention_days, sweep_retention


@pytest.fixture
def sessions_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _seed(sessions_dir: Path, session_id: str, age_days: float = 0.0) -> Path:
    trail = AuditTrail(session_id, dir=sessions_dir)
    idx = trail.begin_task("find the cheapest flight")
    trail.add_message(role="user", content="find it", task=idx, turn=None)
    trail.set_scratchpad(Scratchpad().capture_page(
        url="https://a.test/x", step=0, text="a page you visited"))
    trail.close()
    if age_days:
        when = time.time() - age_days * 86400
        for p in sessions_dir.glob(f"{session_id}.*"):
            os.utime(p, (when, when))
    return trail.path


# ── the sweep itself ───────────────────────────────────────────────────────

def test_it_ages_out_a_stale_session(sessions_dir):
    _seed(sessions_dir, "old", age_days=40)
    assert prune_older_than(30, dir=sessions_dir) == 1
    assert list_sessions(dir=sessions_dir) == []


def test_it_keeps_a_recent_session(sessions_dir):
    _seed(sessions_dir, "new")
    assert prune_older_than(30, dir=sessions_dir) == 0
    assert len(list_sessions(dir=sessions_dir)) == 1


def test_it_takes_the_sidecar_with_it(sessions_dir):
    # A pruned document beside a live scratchpad is a worse outcome than no
    # retention at all: the page digests outlive the conversation.
    _seed(sessions_dir, "old", age_days=40)
    assert (sessions_dir / "old.scratchpad.txt").exists()
    prune_older_than(30, dir=sessions_dir)
    assert not (sessions_dir / "old.scratchpad.txt").exists()


def test_it_spares_a_session_that_is_still_running(sessions_dir):
    # A month-long run is not stale, and marking it deleted would throw away
    # every turn it is still producing.
    trail = AuditTrail("live", dir=sessions_dir)
    trail.begin_task("a very long task")
    when = time.time() - 90 * 86400
    for p in sessions_dir.glob("live.*"):
        os.utime(p, (when, when))
    assert prune_older_than(30, dir=sessions_dir) == 0
    assert trail.path.exists()
    trail.close()


def test_it_is_not_counted_as_pruned_when_nothing_is_old(sessions_dir):
    _seed(sessions_dir, "a")
    _seed(sessions_dir, "b")
    assert prune_older_than(365, dir=sessions_dir) == 0


def test_age_means_last_activity_not_start(sessions_dir):
    # A run that started 40 days ago and was touched yesterday is history the
    # user is still using. mtime is bumped by every flush, so it says so.
    _seed(sessions_dir, "old", age_days=40)
    os.utime(sessions_dir / "old.json", None)
    assert prune_older_than(30, dir=sessions_dir) == 0


# ── the setting ────────────────────────────────────────────────────────────

def test_unset_keeps_everything(monkeypatch):
    # Never configured is not the same as configured to zero.
    monkeypatch.delenv("BROTTO_RETENTION_DAYS", raising=False)
    assert retention_days() is None


def test_zero_disables_rather_than_deletes_everything(monkeypatch):
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "0")
    assert retention_days() is None


def test_a_negative_value_disables(monkeypatch):
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "-5")
    assert retention_days() is None


def test_a_fractional_value_is_allowed(monkeypatch):
    # An hour is a legitimate thing to test a self-host with.
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "0.04")
    assert retention_days() == pytest.approx(0.04)


def test_nonsense_keeps_everything_rather_than_raising(monkeypatch):
    # A typo in a compose file must not turn into a startup crash.
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "thirty")
    assert retention_days() is None


def test_sweep_is_a_noop_when_unset(sessions_dir, monkeypatch):
    _seed(sessions_dir, "old", age_days=400)
    monkeypatch.delenv("BROTTO_RETENTION_DAYS", raising=False)
    assert sweep_retention() == 0
    assert len(list_sessions(dir=sessions_dir)) == 1


def test_sweep_prunes_when_set(sessions_dir, monkeypatch):
    _seed(sessions_dir, "old", age_days=40)
    _seed(sessions_dir, "new")
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "30")
    assert sweep_retention() == 1
    assert [s["session_id"] for s in list_sessions(dir=sessions_dir)] == ["new"]


def test_a_broken_sweep_does_not_take_the_server_down(sessions_dir, monkeypatch):
    from brotto_orchestrator.agent import audit as audit_mod

    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "30")
    monkeypatch.setattr(audit_mod, "prune_older_than",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk gone")))
    assert sweep_retention() == 0


# ── the sweep actually runs ────────────────────────────────────────────────

def test_startup_sweeps(sessions_dir, monkeypatch):
    """A retention setting that only takes effect after a task starts is a
    setting that does not work, because the disk is already full by then."""
    _seed(sessions_dir, "old", age_days=400)
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "30")
    from brotto_orchestrator.main import app

    with TestClient(app):
        pass
    assert list_sessions(dir=sessions_dir) == []
