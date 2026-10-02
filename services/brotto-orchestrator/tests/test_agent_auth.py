"""AGENT_SECRET has to actually gate the relay.

The bug this pins: `AGENT_AUTH_DISABLED` defaulted to "true" and
`AGENT_SECRET` defaulted to the literal "dev-secret", so a self-hoster who
did exactly what docker-compose told them — set AGENT_SECRET — got a
secret nobody read, on the one route a Chrome Web Store install uses.
"""
from __future__ import annotations

import importlib

import pytest

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
