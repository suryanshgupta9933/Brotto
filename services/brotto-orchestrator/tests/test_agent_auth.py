"""AGENT_SECRET has to actually gate the relay.

The bug this pins: `AGENT_AUTH_DISABLED` defaulted to "true" and
`AGENT_SECRET` defaulted to the literal "dev-secret", so a self-hoster who
did exactly what docker-compose told them — set AGENT_SECRET — got a
secret nobody read, on the one route a Chrome Web Store install uses.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import auth as auth_mod
from brotto_orchestrator.session.auth import auth_enabled, validate_request, validate_token


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_AUTH_DISABLED", raising=False)


def test_no_secret_means_open(monkeypatch):
    # A developer on loopback has no secret and needs none. Absent must
    # not mean "auth on with an empty shared string".
    monkeypatch.setenv("AGENT_SECRET", "")
    assert auth_enabled() is False
    assert validate_token("anything at all") is True


def test_setting_the_secret_turns_auth_on(monkeypatch):
    # The regression. Reading AGENT_SECRET is not enough — it has to
    # switch the gate, without a second variable flipped too.
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    assert auth_enabled() is True
    assert validate_token("s3cret") is True
    assert validate_token("wrong") is False


def test_no_dev_secret_default(monkeypatch):
    # Unset must not resolve to a published literal anyone can guess.
    monkeypatch.setenv("AGENT_SECRET", "dev-secret")
    assert validate_token("dev-secret") is True
    monkeypatch.delenv("AGENT_SECRET")
    assert auth_enabled() is False


def test_explicit_disable_overrides_a_set_secret(monkeypatch):
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("AGENT_AUTH_DISABLED", "true")
    assert auth_enabled() is False
    assert validate_token("wrong") is True


def test_bearer_header_and_query_token_agree(monkeypatch):
    # A browser cannot set headers on a WebSocket, so the relay uses
    # ?token= while HTTP uses Authorization. Both must resolve.
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    assert validate_request("Bearer s3cret") is True
    assert validate_request(None, "s3cret") is True
    assert validate_request("Bearer wrong", None) is False
    assert validate_request(None, None) is False


def test_env_is_read_per_call_not_at_import(monkeypatch):
    # main.py calls load_dotenv() and tests set the env after import; a
    # cached module constant silently ignores both.
    monkeypatch.setenv("AGENT_SECRET", "later")
    importlib.reload(auth_mod)
    assert auth_mod.validate_token("later") is True


def test_whitespace_in_the_secret_is_ignored(monkeypatch):
    # A secret pasted out of a terminal or a .env carries trailing
    # newlines; that must not lock the user out of their own server.
    monkeypatch.setenv("AGENT_SECRET", "  s3cret\n")
    assert validate_token("s3cret") is True


def test_relay_carries_the_secret_in_the_subprotocol(monkeypatch, tmp_path, session_id):
    """The secret must never reach an access log.

    `?token=` writes it in plain text into this server's log and into any
    reverse proxy's, permanently. `Sec-WebSocket-Protocol` reaches
    neither, which is why the extension uses it — and the server must
    select the protocol *name* back, not the secret, or the handshake
    reintroduces the leak it was moved to avoid.
    """
    from brotto_orchestrator.main import app as live_app

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    client = TestClient(live_app)

    with client.websocket_connect(
        f"/ws/ext/{session_id('relay-subprotocol')}", subprotocols=["brotto-v1", "s3cret"]
    ) as ws:
        # The response echoes the protocol name, never the credential.
        assert ws.accepted_subprotocol == "brotto-v1"


def test_relay_refuses_a_bad_subprotocol(monkeypatch, tmp_path, session_id):
    from brotto_orchestrator.main import app as live_app

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    client = TestClient(live_app)

    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(
            f"/ws/ext/{session_id('relay-wrong-secret')}", subprotocols=["brotto-v1", "wrong"]
        ) as ws:
            ws.receive_text()
    # 4001 is the credential. 4004 would mean the id was rejected first and
    # the wrong secret was never actually tested.
    assert caught.value.code == 4001


def test_relay_refuses_no_token_at_all(monkeypatch, tmp_path, session_id):
    from brotto_orchestrator.main import app as live_app

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    client = TestClient(live_app)

    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/ext/{session_id("abc")}") as ws:
            ws.receive_text()


def test_the_placeholder_secret_is_refused(monkeypatch):
    """`.env.example` used to ship a working secret.

    It was enforced, not ignored, so a user who copied the file without
    editing it was running with a credential published in this repository —
    guarding a relay that can drive their logged-in browser. The file now
    ships empty and compose's `${AGENT_SECRET:?}` fires; this is the backstop
    for `python main.py` and for a `.env` copied before the change.
    """
    from brotto_orchestrator.session.auth import is_placeholder

    assert is_placeholder("replace-me-with-secrets-token-urlsafe-32")
    assert not is_placeholder("some-real-random-secret")


def test_the_example_file_does_not_ship_a_usable_secret():
    """The guard above is useless if the file still hands out a working value.

    Read as text rather than parsed, so a comment or a key without a trailing
    newline cannot pass.
    """
    from pathlib import Path

    repo = Path(__file__).resolve().parents[3]
    body = (repo / ".env.example").read_text()
    assigned = [
        line.split("=", 1)[1].strip()
        for line in body.splitlines()
        if line.startswith("AGENT_SECRET=")
    ]
    assert assigned == [""], f".env.example ships a value: {assigned}"


def test_the_playwright_socket_refuses_a_non_uuid_user_id(monkeypatch, tmp_path):
    """`user_id` was logged before the token check, with no uuid guard.

    That is the same log-forging primitive already closed on `device_id` and
    `session_id`. It must be rejected before anything is written to a log.
    """
    from brotto_orchestrator.main import app as live_app
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    client = TestClient(live_app)

    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(
            "/ws/forged", headers={"authorization": "Bearer s3cret"}
        ) as ws:
            ws.receive_text()
    # 4004 is the id. 4001 would mean it reached the credential check, which
    # is the thing being fixed.
    assert caught.value.code == 4004
