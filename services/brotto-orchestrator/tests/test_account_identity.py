"""Who is this? A stable, opaque account id for the extension to scope by.

Two cloud accounts signed into one Chrome profile share every namespace,
because the only thing separating local state was the server address — and
the address is the same for everybody on the hosted relay. The fix is an id
from the relay that is the account's own uuid and nothing else, so the
extension can namespace history and settings without ever holding a value
that is PII or a parsed credential.

Three things are load-bearing here and each has a test that fails without
it: `account_id` is the **uuid, not the email**; the route that names the
account is **authenticated**, because an identity route shaped like
`/health` hands every account id on the relay to anyone who can reach the
URL; and a bad credential gets **404, not 403**, because 403 confirms the
route is worth probing.

Self-host must be untouched, so there is a test for that too: a self-hoster
has no account and answers `{"account_id": null}`.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import jwt_auth
from brotto_orchestrator.session.jwt_auth import make_jwt

JWT_SECRET = "jwt-secret-for-account-identity"
ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


def _token(sub: str) -> str:
    return make_jwt(
        {"sub": sub, "email": f"{sub[:4]}@example.test",
         "exp": int(time.time()) + 3600},
        JWT_SECRET,
    )


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    async def _approved_row(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        if method == "GET":
            return 200, '[{"revoked_at": null, "week_start": null, "tasks_this_week": 0}]'
        return 200, "true"

    monkeypatch.setattr(jwt_auth, "_profiles", _approved_row)


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


def _exchange(client, monkeypatch, token: str):
    async def fake(email, code):
        return token

    async def no_approval(tok):
        return True

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)
    monkeypatch.setattr(jwt_auth, "approve_at_exchange", no_approval)
    return client.post(
        "/v1/auth/exchange", json={"email": "beta@example.test", "code": "123456"}
    )


# ---------------------------------------------------------------------------
# exchange names the account
# ---------------------------------------------------------------------------

def test_exchange_returns_the_account_uuid(client, monkeypatch, hosted):
    resp = _exchange(client, monkeypatch, _token(ALICE))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["approved"] is True
    assert body["account_id"] == ALICE


def test_exchange_never_returns_the_email(client, monkeypatch, hosted):
    """The email is PII and it is the thing the uuid exists to replace."""
    resp = _exchange(client, monkeypatch, _token(ALICE))
    assert "example.test" not in resp.text
    assert "aaaa@example.test" not in resp.text


def test_two_accounts_get_two_different_ids(client, monkeypatch, hosted):
    """The whole point: the same browser, two namespaces."""
    one = _exchange(client, monkeypatch, _token(ALICE)).json()["account_id"]
    two = _exchange(client, monkeypatch, _token(BOB)).json()["account_id"]
    assert one != two


def test_an_unverifiable_token_still_signs_the_caller_in(client, monkeypatch, hosted):
    """`approve_at_exchange` already answers False for this token, so the
    route must not 500 on it — an unknown id is better than an error page."""
    resp = _exchange(client, monkeypatch, "a.b.c")
    assert resp.status_code == 200, resp.text
    assert resp.json()["account_id"] == ""


# ---------------------------------------------------------------------------
# GET /v1/account — the panel opened days later
# ---------------------------------------------------------------------------

def test_account_route_names_the_account(client, hosted):
    resp = client.get("/v1/account", headers={"authorization": f"Bearer {_token(ALICE)}"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"account_id": ALICE, "approved": True}


def test_account_route_answers_the_same_id_as_exchange(client, monkeypatch, hosted):
    """The extension has two sources for this value; they must not disagree."""
    exchanged = _exchange(client, monkeypatch, _token(BOB)).json()["account_id"]
    asked = client.get("/v1/account", headers={"authorization": f"Bearer {_token(BOB)}"})
    assert asked.json()["account_id"] == exchanged


def test_account_route_needs_a_credential(client, hosted):
    """An open identity route is an `/health`-shaped leak of every account
    id on the relay. This is the test that keeps it closed."""
    assert client.get("/v1/account").status_code == 404


def test_account_route_answers_404_not_403_for_a_bad_key(client, hosted):
    """403 confirms the route is worth probing."""
    resp = client.get("/v1/account", headers={"authorization": "Bearer not-a-token"})
    assert resp.status_code == 404


def test_account_route_leaks_no_other_account(client, hosted):
    """Only the caller's own id, never the roster."""
    resp = client.get("/v1/account", headers={"authorization": f"Bearer {_token(ALICE)}"})
    assert BOB not in resp.text


# ---------------------------------------------------------------------------
# Self-host is untouched
# ---------------------------------------------------------------------------

def test_self_host_answers_null_and_needs_no_credential(client):
    """No account exists, so there is no id to scope by and the extension
    keeps its old server-address namespace."""
    resp = client.get("/v1/account")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"account_id": None, "approved": False}