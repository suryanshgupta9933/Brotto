"""A saved policy has to survive a restart, which means the key it was
saved under has to survive too.

The filename is `sha256(key)[:32]` — a one-way hash — so nothing on disk
carried the key. `load_all` keyed by the stem, the registry was handed a
map nothing could look up against, and every returning user's blacklist
and standing domain grants were gone after a restart. The user only saw
it as "Brotto forgot my blocklist", with no error anywhere.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from brotto_orchestrator.policy import persist


@pytest.fixture
def policy_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(persist, "_DIR", tmp_path)
    return tmp_path


def test_load_all_is_keyed_by_the_key_the_policy_was_saved_for(policy_dir):
    persist.save_if_changed("device-abc", {"blacklist": ["tracker.test"]})
    loaded = persist.load_all()

    assert "device-abc" in loaded
    assert loaded["device-abc"]["blacklist"] == ["tracker.test"]


def test_a_restart_finds_the_policy_the_user_saved_yesterday(policy_dir):
    persist.save_if_changed("device-abc", {"blacklist": ["tracker.test"]})
    # What main.py does at startup.
    rehydrated = persist.load_all()
    assert persist.load("device-abc") == rehydrated.get("device-abc")
    assert rehydrated["device-abc"]["blacklist"] == ["tracker.test"]


def test_the_stored_key_does_not_make_a_no_op_save_look_changed(policy_dir):
    assert persist.save_if_changed("device-abc", {"blacklist": ["a.test"]}) is True
    # Underscore-prefixed fields are stripped before hashing, so an unchanged
    # re-save must still be skipped — otherwise "Last verified" never settles.
    assert persist.save_if_changed("device-abc", {"blacklist": ["a.test"]}) is False


def test_a_file_written_before_the_key_existed_is_still_readable(policy_dir):
    (policy_dir / "deadbeef.json").write_text(
        json.dumps({"blacklist": ["old.test"], "_saved_at": "2026-01-01T00:00:00+00:00"})
    )
    loaded = persist.load_all()
    # Unreachable, exactly as it was before — but it must not crash the
    # startup sweep, and it must not be mistaken for a user's policy.
    assert loaded["deadbeef"]["blacklist"] == ["old.test"]


def test_two_users_keep_separate_policies(policy_dir):
    persist.save_if_changed("device-abc", {"blacklist": ["mine.test"]})
    persist.save_if_changed("device-xyz", {"blacklist": ["theirs.test"]})
    loaded = persist.load_all()
    assert loaded["device-abc"]["blacklist"] == ["mine.test"]
    assert loaded["device-xyz"]["blacklist"] == ["theirs.test"]
