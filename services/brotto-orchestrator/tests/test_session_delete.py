"""Deleting a session has to mean deleting *all* of it.

Ephemeral is only credible if the user can erase. A partial delete is
worse than no delete at all: the user believes they erased something, and
the part that survived is the part with the page digests in it.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail, Scratchpad, delete, delete_all, list_sessions


@pytest.fixture
def sessions_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _seed(sessions_dir: Path, session_id: str) -> Path:
    trail = AuditTrail(session_id, dir=sessions_dir)
    idx = trail.begin_task("find the cheapest flight")
    trail.add_message(role="user", content="find the cheapest flight", task=idx, turn=None)
    trail.set_scratchpad(Scratchpad().capture_page(
        url="https://a.test/x", step=0, text="a page you visited"))
    trail.close()
    return trail.path


def test_delete_removes_the_document(sessions_dir):
    path = _seed(sessions_dir, "abc")
    assert path.exists()
    assert delete("abc", dir=sessions_dir) is True
    assert not path.exists()


def test_delete_removes_the_scratchpad_too(sessions_dir):
    # The sidecar holds page digests. Leaving it behind means the user
    # erased the session and left the content on disk.
    _seed(sessions_dir, "abc")
    scratch = sessions_dir / "abc.scratchpad.txt"
    assert scratch.exists(), "fixture is not seeding a sidecar"
    delete("abc", dir=sessions_dir)
    assert not scratch.exists()


def test_delete_removes_the_pages_sidecar(sessions_dir):
    (sessions_dir / "abc.json").write_text("{}")
    (sessions_dir / "abc.pages.json").write_text('{"p1": "full page text"}')
    delete("abc", dir=sessions_dir)
    assert not (sessions_dir / "abc.pages.json").exists()


def test_delete_drops_the_live_trail(sessions_dir):
    # Otherwise the running loop rewrites the whole document on its next
    # flush and the "deleted" session reappears in the history list.
    trail = AuditTrail("abc", dir=sessions_dir)
    trail.begin_task("something")
    assert "abc" in audit_mod._LIVE, "fixture is not registering a live trail"
    delete("abc", dir=sessions_dir)
    assert "abc" not in audit_mod._LIVE


def test_delete_is_not_recreated_by_a_live_flush(sessions_dir):
    # The real hazard: deleting mid-run and then having the loop flush.
    trail = AuditTrail("abc", dir=sessions_dir)
    trail.begin_task("something")
    path = trail.path
    assert path.exists()
    delete("abc", dir=sessions_dir)
    assert not path.exists()
    # The loop keeps writing; the file does not come back.
    trail.add_message(role="user", content="still here", task=0, turn=None)
    assert not path.exists()


def test_delete_is_a_noop_for_an_unknown_session(sessions_dir):
    assert delete("nope", dir=sessions_dir) is False


@pytest.mark.parametrize("evil", [
    "../../etc/passwd",
    "..",
    "abc.pages",
    "abc/../../x",
    "/etc/passwd",
    "",
    ".",
])
def test_delete_refuses_paths_and_sidecars(sessions_dir, evil):
    # Same guard as read(). The session id is off a URL path.
    assert delete(evil, dir=sessions_dir) is False


def test_delete_all_empties_the_directory(sessions_dir):
    for sid in ("aaa", "bbb", "ccc"):
        _seed(sessions_dir, sid)
    assert delete_all(dir=sessions_dir) == 3
    assert list_sessions(dir=sessions_dir) == []
    assert list(sessions_dir.iterdir()) == [], "a sidecar survived delete-all"


def test_delete_all_does_not_count_sidecars_as_sessions(sessions_dir):
    _seed(sessions_dir, "aaa")
    (sessions_dir / "aaa.pages.json").write_text("{}")
    assert delete_all(dir=sessions_dir) == 1


def test_delete_all_on_an_empty_directory_is_zero(sessions_dir):
    assert delete_all(dir=sessions_dir) == 0


# ── the routes ───────────────────────────────────────────────────────────────

@pytest.fixture
def auth(monkeypatch):
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.delenv("AGENT_AUTH_DISABLED", raising=False)
    return {"Authorization": "Bearer s3cret"}


@pytest.fixture
def client(sessions_dir, auth):
    from brotto_orchestrator.main import app
    return TestClient(app)


def test_delete_route_requires_the_secret(client, sessions_dir):
    _seed(sessions_dir, "abc")
    assert client.delete("/v1/sessions/abc").status_code == 404
    assert client.delete("/v1/sessions/abc", headers={"Authorization": "Bearer no"}).status_code == 404
    assert (sessions_dir / "abc.json").exists(), "an unauthenticated delete did something"


def test_delete_route_erases_the_session(client, auth, sessions_dir):
    _seed(sessions_dir, "abc")
    r = client.delete("/v1/sessions/abc", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"deleted": True}
    assert not (sessions_dir / "abc.json").exists()


def test_delete_route_on_a_missing_session_is_not_an_error(client, auth):
    # Idempotent: a second delete is not a failure the user has to
    # understand. `deleted: false` says it was already gone.
    r = client.delete("/v1/sessions/ghost", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"deleted": False}


def test_delete_all_route_requires_the_secret(client, sessions_dir):
    _seed(sessions_dir, "abc")
    assert client.delete("/v1/sessions").status_code == 404
    assert (sessions_dir / "abc.json").exists()


def test_delete_all_route_empties_the_directory(client, auth, sessions_dir):
    for sid in ("aaa", "bbb"):
        _seed(sessions_dir, sid)
    r = client.delete("/v1/sessions", headers=auth)
    assert r.status_code == 200
    assert r.json() == {"deleted": 2}
    assert list(sessions_dir.iterdir()) == []


def test_delete_route_refuses_a_path(client, auth):
    r = client.delete("/v1/sessions/..%2F..%2Fetc", headers=auth)
    # Starlette normalises the path; either it 404s or it 200s with
    # deleted:false. What it must never do is delete anything outside.
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert r.json() == {"deleted": False}


def test_delete_removes_an_interrupted_write_leftover(sessions_dir):
    """The atomic write stages into `<id>.json.tmp` before os.replace, so a
    crash between the two leaves a whole document on disk. `list_sessions`
    globs `*.json` and will never show it — which is exactly why naming it
    here is the only thing that clears it."""
    _seed(sessions_dir, "sess-tmp")
    orphan = sessions_dir / "sess-tmp.json.tmp"
    orphan.write_text('{"tasks": [{"goal": "find the cheapest flight"}]}')

    assert delete("sess-tmp", dir=sessions_dir) is True
    assert not orphan.exists()


def test_delete_all_removes_a_staging_file_whose_document_is_gone(sessions_dir):
    """delete_all walks the `*.json` glob, so a staging file left by a
    crashed write belongs to no session as far as it is concerned. Without
    this sweep, delete-all left a user's transcript on disk that nothing in
    the product would ever list or remove."""
    orphan = sessions_dir / "gone.json.tmp"
    orphan.write_text('{"tasks": [{"goal": "book the hotel"}]}')
    _seed(sessions_dir, "live-one")

    assert delete_all(dir=sessions_dir) == 1
    assert not orphan.exists()
    assert not list_sessions(dir=sessions_dir)


def test_a_staging_file_never_counts_as_a_session(sessions_dir):
    """It must stay invisible to the index either way — the sweep is a
    cleanup, not a way for debris to show up in the user's history."""
    (sessions_dir / "stray.json.tmp").write_text('{"title": "not a session"}')
    assert list_sessions(dir=sessions_dir) == []


def test_delete_all_removes_a_page_sidecar_whose_document_is_gone(sessions_dir):
    """The same hole as the staging file, with page text in it.

    Nothing writes a `.pages.json` sidecar any more, but a build that did
    left one beside its document — real page bodies, tens of kilobytes. Once
    that document is removed by hand the sidecar belongs to no session as far
    as the `*.json` glob is concerned, so delete-all walked past it and the
    panel reported every session erased while the pages stayed on disk.
    """
    orphan = sessions_dir / "gone.pages.json"
    orphan.write_text(json.dumps({"r1": "Inbox 664 Starred Snoozed" * 40}))
    _seed(sessions_dir, "live-one")

    assert delete_all(dir=sessions_dir) == 1
    assert not orphan.exists()
    assert not list_sessions(dir=sessions_dir)


def test_a_page_sidecar_is_still_removed_with_its_own_session(sessions_dir):
    """The per-session path already named it; this pins that the new sweep
    did not replace that with a glob that only catches orphans."""
    _seed(sessions_dir, "sess-sidecar")
    sidecar = sessions_dir / "sess-sidecar.pages.json"
    sidecar.write_text(json.dumps({"r1": "Inbox 664 Starred Snoozed"}))

    assert delete("sess-sidecar", dir=sessions_dir) is True
    assert not sidecar.exists()
