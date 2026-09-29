"""The two read endpoints, the guarded body parser, and the error envelope.

Everything here is a *server* concern: a user-reported failure has to be
traceable from the panel bubble to the log line to the audit document,
and that only works if the shape is the same for a 400, a 404 and a 500.

The imports are function-local for the same reason as
`test_suggestions_endpoint.py`: `test_failure_modes.py` evicts every
`brotto_orchestrator*` entry from `sys.modules` mid-session, and a
module-scope import would then hold an orphan the endpoints no longer use.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent.audit import AuditTrail


@pytest.fixture
def sessions_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(sessions_dir):
    from brotto_orchestrator import main

    # raise_server_exceptions=False so the app-level handler is what
    # answers — that is the path under test.
    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c


def _write(tmp_path: Path, sid="s1", goal="find it", status="completed"):
    t = AuditTrail(sid, dir=tmp_path)
    t.set_goal(goal)
    t.set_status(status)
    t.finish({"status": status, "summary": "ok"})
    return t


# ---------------------------------------------------------------------------
# GET /v1/sessions
# ---------------------------------------------------------------------------

def test_list_sessions_returns_index(client, sessions_dir):
    _write(sessions_dir, "s1", "first")
    _write(sessions_dir, "s2", "second")
    body = client.get("/v1/sessions").json()
    assert [s["session_id"] for s in body["sessions"]] == ["s2", "s1"]
    assert body["sessions"][0]["task"] == "second"


def test_list_sessions_is_empty_not_an_error_when_none_exist(client):
    assert client.get("/v1/sessions").json() == {"sessions": []}


# ---------------------------------------------------------------------------
# GET /v1/sessions/{id}/audit
# ---------------------------------------------------------------------------

def test_audit_endpoint_returns_the_document(client, sessions_dir):
    _write(sessions_dir, "s1", "find it")
    doc = client.get("/v1/sessions/s1/audit").json()
    assert doc["goal"] == "find it"
    assert doc["schema_version"] == 1


def test_unknown_session_is_404_not_500(client):
    r = client.get("/v1/sessions/nope/audit")
    assert r.status_code == 404
    assert r.json()["error"] == "unknown session"


def test_corrupt_document_is_200_with_corrupt_true(client, sessions_dir):
    _write(sessions_dir, "s1")
    (sessions_dir / "s1.json").write_text('{"schema_ver')
    r = client.get("/v1/sessions/s1/audit")
    # A damaged audit file must render a "this session is damaged" state,
    # not an error — the whole point of the file is to survive a crash.
    assert r.status_code == 200
    assert r.json()["corrupt"] is True


def test_mid_task_document_is_readable(client, sessions_dir):
    # Review Focus #1: a monitor reading a run that has not finished.
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("still going")
    turn = t.begin_turn(step=0, url="https://github.com/", page_title="GitHub",
                        ax_targets=10, ax_chars=100, ax_diff="",
                        page_text_chars=0)
    t.record_model(turn, thought="working", reasoning="…", tokens_in=1,
                   tokens_out=1, context_pct=0.0, latency_ms=1)
    doc = client.get("/v1/sessions/s1/audit").json()
    assert doc["status"] == "running"
    assert doc["turns"][0]["model"]["thought"] == "working"


def test_a_dot_dot_session_id_cannot_escape_the_sessions_dir(client, sessions_dir):
    # The id reaches the filesystem, so ".." is the one name worth
    # checking. Routing already decodes a slash into a separator, so a
    # single segment is the whole attack surface and it lands as a
    # filename inside the dir.
    r = client.get("/v1/sessions/%2E%2E/audit")
    assert r.status_code == 404
    assert r.json()["error"] == "unknown session"
    assert list(sessions_dir.iterdir()) == []


def test_routing_404s_use_the_same_envelope(client):
    body = client.get("/v1/not-a-route").json()
    assert set(body) == {"error", "error_id"}
    assert body["error"] == "Not Found"


# ---------------------------------------------------------------------------
# Guarded body parsing
# ---------------------------------------------------------------------------

def test_malformed_body_to_suggestions_is_400_not_500(client):
    r = client.post("/v1/suggestions",
                    content=b"not json at all",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400
    assert "error" in r.json()


def test_malformed_body_to_policy_ack_is_400_not_500(client):
    r = client.post("/v1/policy_ack",
                    content=b"{oops",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_malformed_body_to_run_is_400_not_500(client):
    r = client.post("/run", content=b"", headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_json_array_body_is_rejected_as_not_an_object(client):
    r = client.post("/v1/suggestions", content=b"[1, 2, 3]",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400
    assert "object" in r.json()["error"]


# ---------------------------------------------------------------------------
# The error envelope
# ---------------------------------------------------------------------------

def test_unhandled_error_returns_json_envelope_with_error_id(client):
    r = client.get("/v1/sessions/does-not-exist/audit")
    # Even the 404 body is JSON carrying a correlation id.
    assert r.json()["error_id"]


def test_every_error_carries_the_same_two_keys(client):
    bodies = [
        client.get("/v1/sessions/nope/audit").json(),
        client.post("/v1/suggestions", content=b"{",
                    headers={"content-type": "application/json"}).json(),
    ]
    for body in bodies:
        assert set(body) == {"error", "error_id"}
        assert len(body["error_id"]) == 6


def test_a_raised_error_becomes_a_500_envelope_not_a_traceback_page(client, monkeypatch):
    from brotto_orchestrator import main
    from brotto_orchestrator.agent import audit as audit_mod

    def boom(*_a, **_k):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(audit_mod, "read", boom)
    r = client.get("/v1/sessions/s1/audit")
    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert body["error"] == "internal error"
    assert len(body["error_id"]) == 6
    assert "traceback" not in r.text.lower()


def test_two_failures_get_two_different_error_ids(client, monkeypatch):
    from brotto_orchestrator.agent import audit as audit_mod

    def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(audit_mod, "read", boom)
    a = client.get("/v1/sessions/s1/audit").json()["error_id"]
    b = client.get("/v1/sessions/s2/audit").json()["error_id"]
    assert a != b


# ---------------------------------------------------------------------------
# Registry eviction
# ---------------------------------------------------------------------------

class _LiveTask:
    """Stands in for an asyncio.Task. Eviction only asks `.done()`."""

    def done(self) -> bool:
        return False


@pytest.fixture
def small_registry(client, monkeypatch):
    """Cap the registry hard, and put its contents back afterwards.

    `registry` is a module-level global shared by the rest of the suite;
    twenty throwaway sessions left behind would be an invisible change
    to every test that runs after this one.
    """
    from brotto_orchestrator import main

    monkeypatch.setattr(main, "MAX_TRACKED_SESSIONS", 4)
    saved = dict(main.registry._sessions)
    try:
        yield main.registry
    finally:
        main.registry._sessions.clear()
        main.registry._sessions.update(saved)


def test_registry_is_bounded(client, small_registry):
    for _ in range(20):
        client.post("/v1/sessions")
    assert len(small_registry._sessions) <= 4


def test_eviction_never_drops_a_session_with_a_live_task(client, small_registry):
    live = small_registry.get_or_create("live-session")
    live.current_task = _LiveTask()
    for _ in range(10):
        client.post("/v1/sessions")
    assert "live-session" in small_registry._sessions
