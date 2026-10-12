"""The hosted relay's four auth states, and the two ways they can go wrong.

Three guards here are load-bearing and each one is a bug that shipped as
a *silent* one: a JWT that verifies with the wrong algorithm, a task
that runs for a revoked user, and an extension too old to send a token
being told it sent a wrong one.
"""
from __future__ import annotations

import json
from pathlib import Path
import time
from urllib.parse import quote, unquote

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import jwt_auth
from brotto_orchestrator.session.auth import auth_mode, authenticate, validate_request
from brotto_orchestrator.session.jwt_auth import AccountRefused, Claims, make_jwt

JWT_SECRET = "jwt-secret-for-tests"
USER_ID = "11111111-2222-3333-4444-555555555555"


def _today() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).date().isoformat()


def _token(secret: str = JWT_SECRET, **overrides) -> str:
    # A fixed exp, not `int(time.time()) + 3600`. Two mints of the same claims
    # have to be the same string, and a live clock splits them whenever the
    # stub and the assertion land on different seconds — which is how
    # `test_a_listed_address_approves_itself_at_exchange` flaked in CI.
    # Tests that care about expiry pass their own `exp`.
    payload = {
        "sub": USER_ID,
        "email": "beta@example.test",
        "exp": 2000000000,
        **overrides,
    }
    return make_jwt(payload, secret)


@pytest.fixture
def hosted(monkeypatch):
    """A relay in JWT mode with a configured control plane."""
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


# ── the mode, and what it does to self-host ───────────────────────────────

def test_open_without_any_credential(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    assert auth_mode() == "open"
    assert validate_request(None) is True


def test_secret_mode_is_unchanged_by_this_work(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    assert auth_mode() == "secret"
    assert validate_request("Bearer s3cret") is True
    assert validate_request("Bearer wrong") is False


def test_jwt_mode_is_on_when_the_project_secret_is(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    assert auth_mode() == "jwt"


def test_the_project_secret_wins_over_a_shared_secret(monkeypatch):
    """Both set is a downgrade waiting to happen.

    The shared secret is the model this mode exists to replace: every
    beta user indistinguishable from every other, no revoke short of
    rotating it for the whole beta. Silently accepting it back would
    hand it out again.
    """
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    assert auth_mode() == "jwt"
    # The shared secret is not a credential in this mode.
    assert validate_request("Bearer s3cret") is False


def test_an_empty_jwt_secret_is_not_a_mode(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "   ")
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    assert auth_mode() == "open"


def test_health_names_the_mode_the_panel_renders_from(client, monkeypatch, hosted):
    """The extension cannot send a JWT it was not asked for."""
    assert client.get("/health").json()["auth_mode"] == "jwt"


def test_health_still_answers_without_a_credential(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    body = client.get("/health").json()
    assert body["auth_mode"] == "open"
    assert body["status"] == "ok"


# ── the verifier ──────────────────────────────────────────────────────────

def test_a_good_token_carries_its_own_identity(hosted):
    claims = jwt_auth.verify_jwt(_token())
    assert claims is not None
    assert claims.sub == USER_ID
    assert claims.email == "beta@example.test"


def test_a_token_signed_with_another_secret_is_refused(hosted):
    assert jwt_auth.verify_jwt(_token(secret="not-the-secret")) is None


def test_an_expired_token_is_refused(hosted):
    assert jwt_auth.verify_jwt(_token(exp=int(time.time()) - 1)) is None


def test_a_token_with_no_expiry_is_refused(hosted):
    # Supabase always sets exp. A token without one is not one this
    # project issued, and honouring it would be an indefinite credential.
    assert jwt_auth.verify_jwt(_token(exp=None)) is None


def test_alg_none_is_refused(hosted):
    """Algorithm confusion: the classic unsigned-token forgery.

    The signature is checked against a secret this relay chose, so a
    token that says `alg: none` must die before the comparison rather
    than be accepted because it carries no signature to disagree with.
    """
    import base64

    def seg(obj):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    token = f"{seg({'alg': 'none', 'typ': 'JWT'})}.{seg({'sub': USER_ID, 'exp': int(time.time()) + 60})}."
    assert jwt_auth.verify_jwt(token) is None


def test_another_algorithm_is_refused(hosted):
    import base64

    def seg(obj):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    header = seg({"alg": "RS256", "typ": "JWT"})
    body = seg({"sub": USER_ID, "exp": int(time.time()) + 60})
    assert jwt_auth.verify_jwt(f"{header}.{body}.bm90LWEtc2lnbmF0dXJl") is None


def test_a_token_with_no_subject_is_refused(hosted):
    # `sub` is the key into profiles. A token without one passes every
    # cryptographic check and then has nothing to look up.
    assert jwt_auth.verify_jwt(_token(sub="")) is None


@pytest.mark.parametrize("junk", ["", "not-a-token", "a.b", "a.b.c.d", "a.b.c"])
def test_malformed_tokens_are_refused_not_raised(hosted, junk):
    assert jwt_auth.verify_jwt(junk) is None


def test_an_unset_secret_accepts_nothing(hosted, monkeypatch):
    """A relay that has lost its JWT secret must not accept everything.

    An unset secret reads as "no hosted mode" and the verifier refuses
    rather than falling back to comparing against the empty string.
    """
    monkeypatch.delenv("SUPABASE_JWT_SECRET")
    assert jwt_auth.jwt_enabled() is False
    assert jwt_auth.verify_jwt(_token()) is None


# ── per-request, through the one choke point ──────────────────────────────

def test_http_routes_answer_404_to_a_bad_token_not_403(client, monkeypatch, hosted):
    """A 403 confirms the route is worth probing, and this holds transcripts."""
    assert client.get("/v1/sessions", headers={"authorization": "Bearer nope"}).status_code == 404


def test_http_routes_stay_shut_with_no_token(client, monkeypatch, hosted):
    assert client.get("/v1/sessions").status_code == 404


def test_a_good_token_opens_the_route(client, monkeypatch, hosted):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so this is not the thing under test
    resp = client.get("/v1/sessions", headers={"authorization": f"Bearer {_token()}"})
    assert resp.status_code == 200


# ── the two close codes ───────────────────────────────────────────────────

def _ws_close(client, session_id, subprotocols):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(
            f"/ws/ext/{session_id}", subprotocols=subprotocols
        ) as ws:
            ws.receive_text()
    return caught.value.code


def _mint(client, token: str) -> str:
    """A session id minted over HTTP by the holder of `token`.

    Ownership is recorded at mint time, so a WS test that skips this is
    connecting to a session that belongs to nobody — which the relay now
    refuses, correctly.
    """
    resp = client.post("/v1/sessions", headers={"authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    return resp.json()["session_id"]


def test_no_credential_at_all_closes_4003(client, monkeypatch, hosted, session_id):
    """An extension too old to send a token cannot be told "wrong token".

    Its own 120-character cap silently drops a JWT, so it sends nothing,
    and both cases used to close 4001 — so a beta user saw "wrong
    secret" and could not tell "sign in again" from "your token is old".
    """
    assert _ws_close(client, session_id("ws-missing"), None) == 4003


def test_a_wrong_credential_still_closes_4001(client, monkeypatch, hosted, session_id):
    assert _ws_close(client, session_id("ws-bad"), ["brotto-v1", "not-a-jwt"]) == 4001


def test_a_good_credential_connects(client, monkeypatch, hosted, session_id):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    _profiles_stub(monkeypatch, [_APPROVED])
    minted = _mint(client, _token())
    with client.websocket_connect(
        f"/ws/ext/{minted}", subprotocols=["brotto-v1", _token()]
    ) as ws:
        assert ws.accepted_subprotocol == "brotto-v1"


def test_self_host_keeps_one_answer_for_both_failures(client, monkeypatch, tmp_path, session_id):
    """Byte-identical on self-host: the extra code is a hosted-only fix."""
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    assert _ws_close(client, session_id("ws-selfhost-missing"), None) == 4001


# ── the control plane, at task start only ─────────────────────────────────

#: An approved, un-revoked row. The hosted relay now asks the roster on
#: every route, not only at task start, so a test that is exercising the
#: route needs this to get past the gate.
_APPROVED = {"revoked_at": None, "week_start": None, "tasks_this_week": 0}


def _profiles_stub(monkeypatch, rows, *, fail_on=()):
    calls = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles"):
        calls.append((method, query, body))
        if method in fail_on:
            raise jwt_auth.SupabaseUnavailable("boom")
        if method == "GET":
            return 200, json.dumps(rows)
        return 200, "true"

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    return calls


def test_a_live_user_gets_one_task_and_one_count(hosted, monkeypatch):
    calls = _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": None, "tasks_this_week": 0}])
    import asyncio

    asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="b@example.test")))
    methods = [c[0] for c in calls]
    # The reservation is one conditional statement, not a read-then-write.
    assert methods == ["GET", "POST"]


def test_a_revoked_user_is_refused(hosted, monkeypatch):
    _profiles_stub(monkeypatch, [{"revoked_at": "2026-10-01T00:00:00Z", "week_start": None, "tasks_this_week": 0}])
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert caught.value.reason == "revoked"


def test_a_user_over_the_weekly_cap_is_refused(hosted, monkeypatch):
    _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": _today(), "tasks_this_week": 10}])
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert caught.value.reason == "task_cap_reached"


def test_the_cap_is_configurable(hosted, monkeypatch):
    monkeypatch.setenv("BROTTO_BETA_TASK_CAP", "100")
    _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": _today(), "tasks_this_week": 10}])
    import asyncio

    asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))


def test_a_valid_token_with_no_invitation_is_refused(hosted, monkeypatch):
    """Signups are off in Supabase, but the row is still the invitation.

    A held a valid token for somebody who was never invited — revoked
    off one project and pointed at another, or simply someone who found
    the sign-in route — is still not a beta user.
    """
    _profiles_stub(monkeypatch, [])
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert caught.value.reason == "not_invited"


def test_a_stale_week_resets_the_counter(hosted, monkeypatch):
    """The reset is a comparison inside the reservation, not a job that
    can stop running — the Postgres function resets in the same UPDATE."""
    calls = _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": "2000-01-01", "tasks_this_week": 999}])
    import asyncio

    asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert calls[1][2]["cap"] == 10


def test_an_unreachable_supabase_fails_closed(hosted, monkeypatch):
    """Fail *closed*: a hosted user's transcript lands on our disk.

    "We could not check whether this person was revoked" is not a
    licence to record another task for them, and the alternative — run
    them — makes a third party's outage into an access-control decision.
    """
    _profiles_stub(monkeypatch, [], fail_on=("GET",))
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert caught.value.reason == "control_plane_unavailable"


def test_a_refusal_message_never_carries_supabase_text(hosted, monkeypatch):
    _profiles_stub(monkeypatch, [], fail_on=("GET",))
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    # This string reaches the panel.
    assert "boom" not in caught.value.detail


def test_a_relay_with_no_supabase_configuration_refuses_the_task(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused):
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))


def test_a_cap_that_is_not_a_number_falls_back_to_the_default(hosted, monkeypatch):
    monkeypatch.setenv("BROTTO_BETA_TASK_CAP", "ten")
    assert jwt_auth._task_cap() == 10
    monkeypatch.setenv("BROTTO_BETA_TASK_CAP", "0")
    assert jwt_auth._task_cap() == 10


def test_a_task_start_from_a_revoked_user_never_reaches_the_agent(client, monkeypatch, hosted, session_id, tmp_path):
    """The refusal has to happen on the socket, not just in the helper.

    A guard that exists only in a function nothing calls is the failure
    this suite exists to prevent, so this drives the real frame: connect
    with a good token, ask for a task, and watch it be refused before an
    agent exists.
    """
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    # Minted while the account is still approved — POST /v1/sessions asks
    # the roster now too — and revoked before the task starts.
    _profiles_stub(monkeypatch, [_APPROVED])
    minted = _mint(client, _token())
    _profiles_stub(monkeypatch, [{"revoked_at": "2026-10-01T00:00:00Z", "week_start": _today(), "tasks_this_week": 1}])

    with client.websocket_connect(
        f"/ws/ext/{minted}", subprotocols=["brotto-v1", _token()]
    ) as ws:
        ws.send_text(json.dumps({"type": "task_start", "task": "read my inbox"}))
        frames = []
        for _ in range(3):
            try:
                frames.append(json.loads(ws.receive_text()))
            except Exception:
                break
            if frames[-1]["type"] == "task_failed":
                break
    assert frames[-1]["failure_reason"] == "revoked"
    # No agent was ever created for this session, which is the whole
    # point of refusing before the loop starts.
    from brotto_orchestrator.main import registry

    assert registry.get_or_create(minted).current_task is None


def test_a_self_host_task_start_asks_no_control_plane(client, monkeypatch, tmp_path, session_id):
    """No Supabase configured, no claims, no call — byte-for-byte the old path."""
    from brotto_orchestrator.main import app  # noqa: F401

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))

    def explode(*a, **k):  # a network call here is the regression
        raise AssertionError("self-host must not reach the control plane")

    monkeypatch.setattr(jwt_auth, "_profiles", explode)
    with client.websocket_connect(
        f"/ws/ext/{session_id('ws-selfhost')}", subprotocols=["brotto-v1", "s3cret"]
    ) as ws:
        assert ws.accepted_subprotocol == "brotto-v1"


# ── sign-in ───────────────────────────────────────────────────────────────

def test_a_code_request_is_open(client, monkeypatch, hosted):
    async def fake(email):
        return "sent"

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 200
    assert resp.json() == {"sent": True}


def test_an_unregistered_address_is_told_so(client, monkeypatch, hosted):
    """The reversal, at the route: a stranger no longer gets `sent: true`.

    This used to assert the opposite — byte-identical bodies — because a
    reply that branched on membership is a directory of the beta. The owner
    traded that away so a person outside the closed beta learns it
    immediately; see the docstring on the route. What must *not* happen is
    the reason being wrong for the state: pinned by
    `test_the_reply_names_the_roster_state_it_actually_read`.
    """
    sent = []

    async def fake(email):
        sent.append(email)
        return "not_on_list"

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    body = {"email": "nobody@example.test"}
    assert client.post("/v1/auth/request-code", json=body).json() == {
        "sent": False, "reason": "not_on_list",
    }
    assert sent == ["nobody@example.test"]


def test_a_malformed_address_is_refused_without_calling_supabase(client, monkeypatch, hosted):
    called = []

    async def fake(email):
        called.append(email)

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    assert client.post("/v1/auth/request-code", json={"email": "not-an-email"}).status_code == 400
    assert called == []


@pytest.mark.parametrize("route,body", [
    ("/v1/auth/request-code", {"email": "beta@example.test\n"}),
    ("/v1/auth/exchange", {"email": "beta@example.test\n", "code": "123456"}),
    ("/v1/auth/exchange", {"email": "\nbeta@example.test", "code": "123456"}),
])
def test_a_trailing_newline_is_not_an_address(client, monkeypatch, hosted, route, body):
    """`EMAIL_RE` is anchored `^…$`, and `$` also matches immediately *before* a
    trailing newline — so `match` accepted `beta@example.test\\n` and
    `fullmatch` does not.

    These two routes normalise **after** validating, so what the regex saw
    was the caller's byte-for-byte string, and it went on to Supabase that
    way. An address is a thing a stranger controls on two routes that exist
    precisely to be open, and this one sits behind an outbound email send.
    """
    async def fake_code(email):
        pytest.fail(f"a newline-terminated address reached supabase: {email!r}")

    async def fake_exchange(email, code):
        pytest.fail(f"a newline-terminated address reached supabase: {email!r}")

    monkeypatch.setattr(jwt_auth, "request_login_code", fake_code)
    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake_exchange)
    resp = client.post(route, json=body)
    assert resp.status_code == 400, resp.text


def test_exchange_returns_the_access_token(client, monkeypatch, hosted):
    async def fake(email, code):
        return "a.b.c"

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)
    monkeypatch.setattr(jwt_auth, "approve_at_exchange", _no_approval)
    resp = client.post(
        "/v1/auth/exchange", json={"email": "beta@example.test", "code": "123456"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"access_token": "a.b.c", "approved": False}


async def _no_approval(token: str) -> bool:
    """The approval step answered False. Used wherever approval is not the
    subject of the test, so those tests never reach the control plane."""
    return False


def test_a_wrong_code_answers_400_and_leaks_nothing(client, monkeypatch, hosted):
    async def fake(email, code):
        raise ValueError("invalid or expired code")

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)
    resp = client.post(
        "/v1/auth/exchange", json={"email": "beta@example.test", "code": "000000"}
    )
    assert resp.status_code == 400
    body = resp.json()
    assert "signups not allowed" not in json.dumps(body)
    assert "rate limit" not in json.dumps(body)


def test_supabase_error_text_never_reaches_the_caller(client, monkeypatch, hosted):
    """Status only, never the body — a PostgREST error can echo the filter.

    An unreadable roster is a 502 and not one of the roster reasons: it
    says nothing about the address, and `not_on_list` here would be an
    unapplied migration presenting as a product decision.
    """
    async def fake(method, path, *, json_body, api_key, service=False):
        return 429, '{"message":"Email rate limit exceeded. Try again in 60s.","error_code":429}'

    monkeypatch.setattr(jwt_auth, "_supabase_call", fake)
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 502
    assert "rate limit" not in resp.text
    assert "Email rate limit" not in resp.text


def test_a_sign_in_service_that_is_down_is_reported_as_down(client, monkeypatch, hosted):
    async def fake(email):
        raise jwt_auth.SupabaseUnavailable("connect timeout")

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 502


# ── the refusal that is really a bind ─────────────────────────────────────

def test_a_wide_bind_with_no_credential_is_refused(monkeypatch):
    """compose binds 127.0.0.1; behind Caddy it publishes every transcript.

    That is why this used to be a startup *warning*: the only thing
    between an attacker with the URL and someone's logged-in browser was
    an operator who read a log line.
    """
    from brotto_orchestrator.cli import run_server

    monkeypatch.delenv("AGENT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    with pytest.raises(SystemExit):
        run_server("0.0.0.0", 8000, False)


def test_a_wide_bind_with_a_shared_secret_still_boots(monkeypatch):
    from brotto_orchestrator import cli

    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    launched = []

    import uvicorn
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: launched.append(kw))
    cli.run_server("0.0.0.0", 8000, False)
    assert launched and launched[0]["host"] == "0.0.0.0"


def test_a_wide_bind_on_the_hosted_relay_boots(monkeypatch, hosted):
    """Heroku binds 0.0.0.0 and sets no AGENT_SECRET.

    A refusal keyed on AGENT_SECRET alone would refuse to boot the one
    deployment that has a real credential.
    """
    from brotto_orchestrator import cli

    import uvicorn
    launched = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: launched.append(kw))
    cli.run_server("0.0.0.0", 8000, False)
    assert launched


def test_a_loopback_bind_with_no_credential_still_boots(monkeypatch):
    """Open mode on loopback is not a degraded mode."""
    from brotto_orchestrator import cli

    import uvicorn
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    launched = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: launched.append(kw))
    cli.run_server("127.0.0.1", 8000, False)
    assert launched


# ── retention, which the hosted relay defaults on ─────────────────────────

def test_retention_is_off_on_a_self_host_by_default(monkeypatch):
    from brotto_orchestrator.main import retention_days

    monkeypatch.delenv("BROTTO_RETENTION_DAYS", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    assert retention_days() is None


def test_the_hosted_relay_ages_sessions_out_without_being_asked(monkeypatch, hosted):
    """An ephemeral dyno is not a self-hoster's own disk.

    Every beta transcript would otherwise sit on the filesystem until the
    filesystem died, decided by nobody.
    """
    from brotto_orchestrator.main import retention_days

    monkeypatch.delenv("BROTTO_RETENTION_DAYS", raising=False)
    assert retention_days() == 30.0


def test_an_operator_setting_retention_still_wins(monkeypatch, hosted):
    from brotto_orchestrator.main import retention_days

    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "7")
    assert retention_days() == 7.0
    # Including 0, which is the one value that must still mean "off":
    # a hosted operator may have a reason to keep everything.
    monkeypatch.setenv("BROTTO_RETENTION_DAYS", "0")
    assert retention_days() is None

# ── the control plane's own table ─────────────────────────────────────────
#
# SUPABASE_ANON_KEY is public by Supabase's design — it is the key every
# browser client ships — so the table holding the beta roster has to deny it
# explicitly. Nothing in the Python asserts this: a migration file is not
# imported by anything.

MIGRATION = (
    Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "001_profiles.sql"
)


def _migration() -> str:
    return MIGRATION.read_text().lower()


def test_profiles_is_closed_to_the_public_key():
    """RLS with no policy is deny-all; the revokes say so out loud."""
    sql = _migration()
    assert "alter table profiles enable row level security" in sql
    assert "revoke all on profiles from anon" in sql
    assert "revoke all on profiles from authenticated" in sql
    # A policy would re-open exactly what the revokes closed, and the
    # relay needs none — its service role bypasses RLS by design.
    assert "create policy" not in sql


def test_the_weekly_cap_is_reserved_by_one_statement():
    sql = _migration()
    assert "create or replace function public.reserve_task_slot" in sql
    # The predicate is the cap: a caller that loses the race updates zero
    # rows and is refused, rather than having compared a stale read.
    assert "tasks_this_week < cap" in sql


# ── one account cannot reach another's ────────────────────────────────────
#
# With one operator per server, "is this token valid" was the whole
# question and the answer was always yes. Ten accounts make it the wrong
# question: a valid token is not ownership.

OTHER_ID = "99999988-7777-6666-5555-444444444444"


def _b_token(**overrides) -> str:
    return _token(sub=OTHER_ID, email="other@example.test", **overrides)


def _write_transcript(session_id: str) -> str:
    """Put a real document on disk for `session_id`."""
    from brotto_orchestrator.agent.audit import AuditTrail

    trail = AuditTrail(session_id)
    trail.begin_task("read my inbox")
    trail.close()
    return session_id


def test_another_account_cannot_see_the_session_in_the_index(client, monkeypatch, hosted, tmp_path):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    _mint(client, _token())
    _write_transcript(_mint(client, _b_token()))
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    resp = client.get("/v1/sessions", headers={"authorization": f"Bearer {_token()}"})
    assert [s["session_id"] for s in resp.json()["sessions"]] == []
    resp_b = client.get("/v1/sessions", headers={"authorization": f"Bearer {_b_token()}"})
    assert len(resp_b.json()["sessions"]) == 1


def test_another_account_gets_404_not_403_on_the_audit(client, monkeypatch, hosted):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    mine = _write_transcript(_mint(client, _token()))
    resp = client.get(
        f"/v1/sessions/{mine}/audit", headers={"authorization": f"Bearer {_b_token()}"}
    )
    # 403 would confirm the id is real, which is the whole of its value.
    assert resp.status_code == 404
    # And the answer is the one a nonexistent session gets, byte for byte.
    absent = client.get(
        f"/v1/sessions/00000000-0000-4000-8000-000000000000/audit",
        headers={"authorization": f"Bearer {_b_token()}"},
    )
    assert resp.json()["error"] == absent.json()["error"]


def test_another_account_cannot_delete_the_session(client, monkeypatch, hosted):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    mine = _mint(client, _token())
    resp = client.delete(
        f"/v1/sessions/{mine}", headers={"authorization": f"Bearer {_b_token()}"}
    )
    assert resp.status_code == 404
    assert not client.get(
        f"/v1/sessions/{mine}/audit", headers={"authorization": f"Bearer {_token()}"}
    ).json().get("corrupt")


def test_another_account_cannot_connect_to_the_socket(client, monkeypatch, hosted, session_id):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    """A valid token for the wrong person is not a credential failure.

    4001/4003 say "your credential"; 4004 says "this is not a session you
    can drive", which is what a session owned by somebody else is.
    """
    mine = _mint(client, _token())
    assert _ws_close(client, mine, ["brotto-v1", _b_token()]) == 4004


def test_delete_all_only_reaches_the_callers_own_sessions(client, monkeypatch, hosted, tmp_path):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    mine = _write_transcript(_mint(client, _token()))
    theirs = _write_transcript(_mint(client, _b_token()))
    resp = client.delete("/v1/sessions", headers={"authorization": f"Bearer {_token()}"})
    body = resp.json()
    assert body["deleted"] == 1 and body["residue"] == 0
    assert not (tmp_path / "sessions" / f"{mine}.json").exists()
    assert (tmp_path / "sessions" / f"{theirs}.json").exists()


def test_the_owner_still_reaches_their_own_session(client, monkeypatch, hosted):
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so POST /v1/sessions is not the thing under test
    mine = _write_transcript(_mint(client, _token()))
    assert client.get(
        f"/v1/sessions/{mine}/audit", headers={"authorization": f"Bearer {_token()}"}
    ).status_code == 200


def test_a_session_with_no_owner_belongs_to_nobody(client, monkeypatch, hosted, session_id):
    """Fail closed. A stale id or an evicted registry entry is nobody's."""
    _profiles_stub(monkeypatch, [_APPROVED])  # the roster, so this is not the thing under test
    resp = client.get(
        f"/v1/sessions/{session_id('ownerless')}/audit",
        headers={"authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404


def test_self_host_ownership_is_unchanged(client, monkeypatch, tmp_path):
    """One shared secret is one shared identity: every route is the same."""
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    first = client.post("/v1/sessions", headers={"authorization": "Bearer s3cret"}).json()
    _write_transcript(first["session_id"])
    listing = client.get("/v1/sessions", headers={"authorization": "Bearer s3cret"})
    assert [s["session_id"] for s in listing.json()["sessions"]] == [first["session_id"]]
    assert client.get(
        f"/v1/sessions/{first['session_id']}/audit", headers={"authorization": "Bearer s3cret"}
    ).status_code == 200
    assert client.delete(
        f"/v1/sessions/{first['session_id']}", headers={"authorization": "Bearer s3cret"}
    ).status_code == 200


# ── ?token= is a credential in a url ──────────────────────────────────────

def test_jwt_mode_refuses_the_query_string_credential(client, monkeypatch, hosted):
    """A URL reaches every access log on the way here, permanently.

    On self-host the token is one secret on the operator's own box. Here it
    is a person's account, so it does not get written down.
    """
    assert client.get(f"/v1/sessions?token={_token()}").status_code == 404
    # …and not even as a "missing credential" distinction, which would
    # confirm the token was well-formed enough to be worth noticing.
    assert authenticate(None, _token()).verdict == "missing"


def test_secret_mode_keeps_the_query_string_credential(monkeypatch):
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    assert validate_request(None, "s3cret") is True


# ── the cap, under concurrency ────────────────────────────────────────────

def test_concurrent_task_starts_never_grant_more_than_the_cap(hosted, monkeypatch):
    """Ten simultaneous starts against one account, cap of three.

    The stub models the database, not the caller: `reserve_task_slot` is
    atomic because it is one UPDATE with the cap in its WHERE clause, so
    the relay's job is to make exactly one reservation per task and to
    treat a `false` as a refusal. The old shape — read, compare in
    Python, PATCH the result — grants every caller whose read happened
    before any write, which is the whole finding.
    """
    import asyncio

    monkeypatch.setenv("BROTTO_BETA_TASK_CAP", "3")
    state = {"used": 0}
    lock = asyncio.Lock()
    reservations = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles"):
        # The yield is what makes this a race and not ten sequential
        # calls: every caller finishes its read before any of them writes.
        await asyncio.sleep(0)
        if method == "GET":
            return 200, json.dumps([{"revoked_at": None, "week_start": _today(),
                                     "tasks_this_week": state["used"]}])
        async with lock:  # the UPDATE takes the row lock
            reservations.append(body)
            if state["used"] >= body["cap"]:
                return 200, "false"
            state["used"] += 1
            return 200, "true"

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    claims = Claims(sub=USER_ID, email="beta@example.test")

    async def run():
        outcomes = await asyncio.gather(
            *(jwt_auth.authorize_task_start(claims) for _ in range(10)),
            return_exceptions=True,
        )
        return [o for o in outcomes if not isinstance(o, BaseException)], \
               [o for o in outcomes if isinstance(o, jwt_auth.AccountRefused)]

    granted, refused = asyncio.run(run())
    assert len(granted) == 3
    assert len(refused) == 7
    assert {r.reason for r in refused} == {"task_cap_reached"}
    # Every caller reached the reservation — none was refused on a stale
    # read of the counter — and the counter agrees with the grants.
    assert len(reservations) == 10
    assert state["used"] == len(granted)


def test_a_lost_race_is_refused_as_the_cap_not_an_outage(hosted, monkeypatch):
    """The false return means "no slot", which is not a control-plane failure."""
    async def fake(method, query, body=None, *, path="rest/v1/profiles"):
        if method == "GET":
            return 200, json.dumps([{"revoked_at": None, "week_start": _today(),
                                     "tasks_this_week": 9}])
        return 200, "false"

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert caught.value.reason == "task_cap_reached"


# ── the two open routes are metered ───────────────────────────────────────

def _stub_send(monkeypatch):
    sent = []

    async def fake(email):
        sent.append(email)
        return "sent"

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    return sent


def test_request_code_is_throttled(client, monkeypatch, hosted):
    sent = _stub_send(monkeypatch)
    codes = [
        client.post("/v1/auth/request-code", json={"email": "beta@example.test"}).status_code
        for _ in range(8)
    ]
    assert 429 in codes
    # Throttled before the call, not after: the point is not spending our
    # Resend quota or Supabase's rate limit on a hammering caller.
    assert len(sent) < 8


def test_the_limiter_also_follows_the_address(client, monkeypatch, hosted):
    """Rotating the peer address does not get around the per-address bucket."""
    from brotto_orchestrator import main

    main._SIGNIN_BUCKETS.clear()
    for i in range(5):
        main._signin_allowed(f"peer-{i}", "beta@example.test")
    assert main._signin_allowed("peer-new", "beta@example.test") is False


def test_addresses_are_normalised_before_they_are_counted(client, monkeypatch, hosted):
    """Both spellings have to land on one bucket.

    It passes the *normalised* address both times, which is what the routes
    do and what this is about. It used to pass the raw spelling five times and
    the normalised one next, and was then refused by the peer bucket rather
    than the address bucket — so it was asserting "five calls exhaust the
    peer", and only looked like it was about normalisation. Widening the
    shared peer bucket (so that the key a caller cannot forge is the one
    doing the bounding) is what stopped this test passing for the wrong
    reason.
    """
    from brotto_orchestrator import main
    from brotto_orchestrator.session.jwt_auth import normalize_email

    main._SIGNIN_BUCKETS.clear()
    for _ in range(5):
        main._signin_allowed("peer", normalize_email("Beta@Example.Test"))
    assert main._signin_allowed("peer", normalize_email("beta@example.test")) is False


def test_the_throttle_is_not_an_account_existence_oracle(client, monkeypatch, hosted):
    """The property the routes were written for has to survive the limiter.

    Two addresses, one on the operator's roster and one not, asked the
    same number of times from the same peer: the same statuses at every
    step, and the same body once the limiter starts refusing. It holds
    because the bucket keys on the peer address and on what the caller
    typed, and never consults anything that knows who is in the beta —
    so there is no branch in the limiter that *could* differ. `error_id`
    is excluded: it is a fresh correlation id on every response and says
    nothing about the address.
    """
    invited = "invited@example.test"
    stranger = "stranger@example.test"
    roster = {invited}

    async def fake(email):
        # The roster exists; nothing downstream is allowed to see it.
        assert (email in roster) is not None
        return "sent"

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    answers = {}
    from brotto_orchestrator import main

    for addr in (invited, stranger):
        # Reset between the two, because the peer bucket is shared and a
        # spent one would throttle the second address for the wrong
        # reason. Each is measured from a fresh limiter, as two different
        # peers would be.
        main._SIGNIN_BUCKETS.clear()
        main._SIGNIN_SWEEP_AT = 0.0
        answers[addr] = [
            client.post("/v1/auth/request-code", json={"email": addr})
            for _ in range(6)
        ]
    assert [r.status_code for r in answers[stranger]] == [r.status_code for r in answers[invited]]
    assert 429 in [r.status_code for r in answers[invited]]
    throttled = [
        {k: v for k, v in r.json().items() if k != "error_id"}
        for r in answers[invited] if r.status_code == 429
    ]
    throttled_other = [
        {k: v for k, v in r.json().items() if k != "error_id"}
        for r in answers[stranger] if r.status_code == 429
    ]
    assert throttled == throttled_other


def test_exchange_is_throttled_too(client, monkeypatch, hosted):
    async def fake(email, code):
        return "a.b.c"

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)
    monkeypatch.setattr(jwt_auth, "approve_at_exchange", _no_approval)
    codes = [
        client.post("/v1/auth/exchange",
                    json={"email": "beta@example.test", "code": "123456"}).status_code
        for _ in range(8)
    ]
    assert 429 in codes


def test_the_sign_in_limiter_sees_through_a_proxy(client, monkeypatch, hosted):
    """Behind Heroku's router every caller shares one peer address.

    Keying the bucket on `request.client.host` would be five sign-ins per
    ten minutes for the entire beta, which is a broken product rather than
    a throttle.
    """
    sent = _stub_send(monkeypatch)
    for i in range(5):
        resp = client.post(
            "/v1/auth/request-code",
            json={"email": f"user{i}@example.test"},
            headers={"x-forwarded-for": f"203.0.113.{i}"},
        )
        assert resp.status_code == 200
    assert len(sent) == 5


# ── self-approval: the roster, not the invitation ─────────────────────────
#
# Invitations were rows the operator typed. Now the roster is a table of
# approved addresses and the row in `profiles` is written by the relay at
# exchange — which moves three things onto code that used to have none of
# them, and each is pinned below: signups must exist at all, the open route
# must not learn who is on the roster, and the insert must not be able to
# un-revoke anybody.

LISTED = "listed@example.test"


def _parse_postgrest(query):
    r"""Parse a PostgREST query the way PostgREST does.

    Two steps, **in this order**, and the order is the whole point of
    this helper: every value is URL-decoded first, and only then handed to
    the filter grammar. Percent-encoding a comma therefore does not stop
    it being a comma — it is a comma by the time anything reads it, which
    is why a test that compares the decoded string back against the input
    proves nothing about the parser that will actually see it.

    The grammar: `column.op.value`, where an unquoted `value` is a
    comma-separated *list* and a `"…"` literal is one value. Anything
    after a literal's closing quote is grammar again, so it is reported
    separately rather than being silently dropped — a value that closes
    its own quoting and then appends a second column is exactly the bug.
    Returns one dict per filter.

    **Escapes are processed before the closing quote is located**, because
    that is the order PostgREST's lexer is in: `\` is the escape character
    *inside* a literal, so `\"` does not end the string and `\\` is one
    backslash. A parser that searches for the next `"` instead will end
    the literal early on exactly the inputs that were built to escape —
    it reports the tail as `trailing` grammar, and a test written against
    it asserts the *wrong* parse while looking entirely reasonable. That
    is not hypothetical: the percent-encoding round last round got through
    because this helper shared the implementation's assumption rather than
    checking the grammar independently.
    """
    filters = []
    for part in query.lstrip("?").split("&"):
        # Decode the whole `name=value` and only then split it: the column
        # and the operator are part of the grammar, so taking them off
        # before the decode would be parsing something PostgREST never
        # sees.
        decoded = unquote(part)
        name, sep, rest = decoded.partition("=")
        if name in ("select", "on_conflict", "order", "limit"):
            continue
        assert sep, f"filter has no value: {decoded!r}"
        op, sep, value = rest.partition(".")
        assert sep, f"filter {name} has no operator: {decoded!r}"
        column = name
        trailing = ""
        if value.startswith('"'):
            # Walk the literal one character at a time, consuming escapes
            # as pairs, so the quote we stop on is the one that is not
            # escaped. `find` cannot do this and must not be used here.
            chars, i, closed = [], 1, False
            while i < len(value):
                c = value[i]
                if c == "\\" and i + 1 < len(value):
                    chars.append(value[i + 1])
                    i += 2
                    continue
                if c == '"':
                    closed = True
                    break
                chars.append(c)
                i += 1
            assert closed, f"unterminated string literal on {column}: {decoded!r}"
            values, trailing = ["".join(chars)], value[i + 1:]
        else:
            values = value.split(",")
        filters.append({"column": column, "op": op, "values": values, "trailing": trailing})
    return filters


def _roster_stub(monkeypatch, *, listed=(), profiles=(), revoked=(), waitlisted=()):
    """The control plane as the approval path uses it.

    Models the three tables rather than answering the same thing to every
    query: `beta_access` and `waitlist` filter by the address asked for (so
    a claim that is *not* the one the caller typed finds nothing), and
    `profiles` hands back whatever rows it was seeded with. Returns the
    calls.

    The `beta_access`/`waitlist` branches go through `_parse_postgrest`, so
    the stub agrees with the server about where the filter ends — stubbing
    the raw string would make any encoding look correct, because the test
    would be the only parser in the room. `revoked` are addresses that are
    on the roster *and* withdrawn.
    """
    calls = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        calls.append({"method": method, "query": query, "body": body,
                      "path": path, "prefer": prefer})
        if path == jwt_auth.BETA_ACCESS_PATH or path == jwt_auth.WAITLIST_PATH:
            parsed = [f for f in _parse_postgrest(query) if f["column"] == "email"]
            # A filter that does not resolve to exactly one address is not a
            # lookup for anybody, which is the outcome a parser differential
            # produces and the one this stub has to be able to produce.
            want = parsed[0]["values"][0] if (
                len(parsed) == 1 and len(parsed[0]["values"]) == 1 and not parsed[0]["trailing"]
            ) else None
            if path == jwt_auth.WAITLIST_PATH:
                return 200, json.dumps([{"email": r} for r in waitlisted if r == want])
            return 200, json.dumps([
                {"email": r, "revoked_at": "2026-10-01T00:00:00Z" if r in revoked else None}
                for r in listed if r == want
            ])
        if method == "POST":
            return 201, ""
        return 200, json.dumps(list(profiles))

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    return calls


def _stub_verify(monkeypatch, email=LISTED):
    """Supabase hands back a token whose claims name the listed address.

    The claims — not the body — are what the approval reads, so the stub
    has to agree with the roster or every happy-path test is really
    testing the miss.
    """
    async def fake(_email, _code):
        return _token(email=email)

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)


def test_the_account_is_created_at_exchange_and_supabase_mails_nothing(
    hosted, monkeypatch,
):
    """Superseded: this used to pin `POST auth/v1/otp` with `create_user: True`.

    That call is what made Supabase send its own branded "Confirm your email
    address" template — with a localhost link in it — so the relay took the
    code over and the account is now created at **exchange**, through the
    service-role admin API with `email_confirm: true`. A code is minted for
    an address with no account (pinned by
    `test_a_code_is_issued_to_an_address_that_need_not_have_an_account`), so
    creating at mint time would mint an auth account for someone who never
    redeemed.
    """
    import asyncio

    minted = []
    created = []

    async def fake(method, path, *, json_body, api_key, service=False, prefer=""):
        minted.append((method, path, json_body))
        # `startwith`, not `==`: `_profiles` concatenates the query onto the
        # path, so the lookup arrives as `rest/v1/beta_access?email=...`.
        if path.startswith(jwt_auth.BETA_ACCESS_PATH):
            return 200, json.dumps([{"email": "beta@example.test", "revoked_at": None}])
        if path == "rest/v1/sign_in_codes":
            return 201, ""
        if path == "auth/v1/admin/users":
            created.append((method, json_body))
            return 200, json.dumps({"id": USER_ID})
        return 200, "{}"

    monkeypatch.setattr(jwt_auth, "_supabase_call", fake)
    monkeypatch.setattr("brotto_orchestrator.session.sign_in_code_email.send_code",
                        _noop_send)
    asyncio.run(jwt_auth.request_login_code("  Beta@Example.TEST "))
    assert any(p == "rest/v1/sign_in_codes" for _, p, _ in minted), (
        "no code was minted — the assertion below would pass vacuously"
    )
    assert created == [], "minting a code must not create an auth account"
    assert not any(p == "auth/v1/otp" for _, p, _ in minted), (
        "Supabase's otp endpoint is what sent the branded mail — it is gone"
    )

    async def redeem(method, path, *, json_body, api_key, service=False, prefer=""):
        created.append((path, json_body))
        if path == "rest/v1/rpc/redeem_sign_in_code":
            return 200, "true"
        if path == "auth/v1/admin/users":
            return 200, json.dumps({"id": USER_ID})
        return 200, "{}"

    monkeypatch.setattr(jwt_auth, "_supabase_call", redeem)
    token = asyncio.run(jwt_auth.exchange_login_code("beta@example.test", "123456"))
    assert jwt_auth.verify_jwt(token).sub == USER_ID
    admin = next(c for c in created if c[0] == "auth/v1/admin/users")
    # `email_confirm: true` is what stops Supabase mailing a confirmation of
    # its own — the whole reason this path exists rather than `auth/v1/otp`.
    assert admin[1] == {"email": "beta@example.test", "email_confirm": True}


def test_the_reply_names_the_roster_state_it_actually_read(client, monkeypatch, hosted):
    """Replaces `test_the_reply_cannot_tell_a_member_from_a_stranger`.

    That test pinned byte-identical replies, which was the property this
    route was written to hold: a conditional answer on an unauthenticated
    route is a directory of the beta. The product owner traded it away so a
    stranger is told immediately that they are not in the closed beta. The
    new property is the opposite shape and the same discipline — **the
    right reason for the right roster state**, never a reason that belongs
    to a different state, and a code minted only for the one that should
    get one.
    """
    admitted = "admitted@example.test"
    withdrawn = "withdrawn@example.test"
    waiting = "waiting@example.test"
    stranger = "stranger@example.test"
    calls = _roster_stub(
        monkeypatch,
        listed=[admitted, withdrawn], revoked=[withdrawn], waitlisted=[waiting],
    )
    monkeypatch.setattr("brotto_orchestrator.session.sign_in_code_email.send_code",
                        _noop_send)
    expected = {
        admitted: {"sent": True},
        withdrawn: {"sent": False, "reason": "revoked"},
        waiting: {"sent": False, "reason": "pending"},
        stranger: {"sent": False, "reason": "not_on_list"},
    }
    for addr, want in expected.items():
        resp = client.post("/v1/auth/request-code", json={"email": addr})
        assert resp.status_code == 200, addr
        assert resp.json() == want, addr
    minted = [c["body"]["email"] for c in calls if c["path"] == "rest/v1/sign_in_codes"]
    assert minted == [admitted], "a code was minted for a state that should not get one"


def test_a_failed_mint_for_an_admitted_address_says_try_again(client, monkeypatch, hosted):
    """The one outcome that is not a roster state, and the one that must not
    be a 502.

    The address *is* admitted, so telling them `not_on_list` is a lie and
    a 502 is the oracle this reply is now allowed to be, only in a status
    code. The person needs to know to retry; the panel already has copy for
    a reason it does not recognise.
    """
    admitted = "admitted@example.test"
    monkeypatch.setattr("brotto_orchestrator.session.sign_in_code_email.send_code",
                        _noop_send)

    # The roster must still answer; only the insert fails.
    async def fake(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        if path == jwt_auth.BETA_ACCESS_PATH:
            return 200, json.dumps([{"email": admitted, "revoked_at": None}])
        if path == "rest/v1/sign_in_codes":
            return 500, '{"message":"nope"}'
        return 200, "[]"

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    resp = client.post("/v1/auth/request-code", json={"email": admitted})
    assert resp.status_code == 200
    assert resp.json() == {"sent": False, "reason": "try_again"}
    assert "nope" not in resp.text


def test_a_roster_we_cannot_read_is_not_told_as_a_roster_answer(
    client, monkeypatch, hosted, caplog,
):
    """A miss and an unreadable roster were the same answer to `_listed_for_beta`
    because that caller had already proved inbox control. This one has not,
    and its reply is now the product's public face — so a control-plane
    failure is 502, never `not_on_list`. Otherwise an unapplied migration
    presents as "you are not in the beta".
    """
    import asyncio
    import logging

    async def broken(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        raise TimeoutError("upstream connect timeout")

    monkeypatch.setattr(jwt_auth, "_profiles", broken)
    with caplog.at_level(logging.ERROR, logger="brotto.jwt_auth"):
        with pytest.raises(jwt_auth.SupabaseUnavailable):
            asyncio.run(jwt_auth.request_login_code("beta@example.test"))
    assert "TimeoutError" in caplog.text

    caplog.clear()
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 502
    assert "not_on_list" not in resp.text


def test_a_listed_address_approves_itself_at_exchange(client, monkeypatch, hosted):
    calls = _roster_stub(monkeypatch, listed=[LISTED], profiles=[{"revoked_at": None}])
    _stub_verify(monkeypatch)
    resp = client.post(
        "/v1/auth/exchange", json={"email": LISTED, "code": "123456"}
    )
    assert resp.json() == {"access_token": _token(email=LISTED), "approved": True}
    insert = next(c for c in calls if c["method"] == "POST" and c["path"] == "rest/v1/profiles")
    assert insert["body"] == {"id": USER_ID, "email": LISTED}
    # Insert-if-absent, not an upsert. Written as an upsert it would touch an
    # existing row, and `test_a_revoked_member_keeps_the_revocation` is what
    # that costs.
    assert insert["query"] == "?on_conflict=id"
    assert insert["prefer"] == "resolution=ignore-duplicates"


def test_the_filter_is_a_bare_literal_not_a_quoted_identifier():
    """`eq."addr"` matches no row — this is the bug that hid a rostered address.

    PostgREST treats `"…"` as a value delimiter only inside `in.(…)` and
    `or=(…)`. Standalone, the quote characters travel with the value and
    the lookup finds nothing. Measured against a live PostgREST: bare
    `eq.suryanshgupta9933%40gmail.com` returns the row, quoted
    `eq."suryanshgupta9933%40gmail.com"` returns `[]`. A round-trip test
    cannot see this — only the wire shape can.
    """
    got = jwt_auth._filter_value("someone@example.test")
    assert not got.startswith('"') and not got.endswith('"'), got
    assert "%22" not in got
    assert got == quote("someone@example.test", safe="")


def test_a_comma_in_an_address_is_refused_rather_than_split(
    client, monkeypatch, hosted
):
    """The comma is the list separator; refusing it is the guard.

    `EMAIL_RE`'s local part admits a comma, and PostgREST URL-decodes
    *before* it parses the filter grammar — so `quote()` turning `,` into
    `%2C` buys nothing, the parser still sees a comma and reads two
    values. `in.("…")` is PostgREST's documented escape for this; refused
    here rather than guessed at, same as `"` and `\\`.
    """
    nasty = "a,b(c)@example.test"
    calls = _roster_stub(monkeypatch, listed=[nasty])
    _stub_verify(monkeypatch, email=nasty)
    resp = client.post("/v1/auth/exchange", json={"email": nasty, "code": "123456"})
    assert resp.json()["approved"] is False
    assert [c for c in calls if c["path"] == jwt_auth.BETA_ACCESS_PATH] == []
    with pytest.raises(ValueError):
        jwt_auth._filter_value(nasty)


def test_the_roster_filter_survives_a_postgrest_parser(client, monkeypatch, hosted):
    """The address comes back out of the filter parser exactly as typed.

    **This asserts against a parser, not against a round trip.** A round
    trip through *this* decoder always gets the value back, whatever
    PostgREST then does with it. PostgREST URL-decodes **before** it parses
    the filter grammar; `_parse_postgrest` does it in that order, and the
    assertion is on the structure that comes back. Parens and a plus are
    in this address on purpose — legal in a local part, and not the
    characters the grammar reserves.
    """
    addr = "a(b)+c@example.test"
    calls = _roster_stub(monkeypatch, listed=[addr], profiles=[{"revoked_at": None}])
    _stub_verify(monkeypatch, email=addr)
    resp = client.post("/v1/auth/exchange", json={"email": addr, "code": "123456"})
    assert resp.json()["approved"] is True

    roster = next(c for c in calls if c["path"] == jwt_auth.BETA_ACCESS_PATH)
    parsed = _parse_postgrest(roster["query"])
    assert len(parsed) == 1, f"one filter in, {len(parsed)} out: {roster['query']}"
    got = parsed[0]
    assert got["column"] == "email"
    assert got["op"] == "eq"
    assert got["values"] == [addr]
    assert not got["trailing"]


def test_a_quote_in_an_address_is_refused_rather_than_quoted(client, monkeypatch, hosted):
    """A value must not be able to open its own quoting.

    `"` is what opens a PostgREST value literal, and a value carrying one
    can reshape the filter. `quote()` percent-encodes it, which buys
    nothing — PostgREST decodes before it parses. There is no escape
    sequence used here that has been checked against PostgREST, so the
    value is rejected.
    """
    nasty = 'a"b@example.test'
    calls = _roster_stub(monkeypatch, listed=[nasty])
    _stub_verify(monkeypatch, email=nasty)
    resp = client.post("/v1/auth/exchange", json={"email": nasty, "code": "123456"})
    assert resp.json()["approved"] is False
    assert [c for c in calls if c["path"] == jwt_auth.BETA_ACCESS_PATH] == []


def test_a_backslash_in_an_address_is_refused_rather_than_quoted(client, monkeypatch, hosted):
    """The escape character is the other half of the same hole.

    Inside a PostgREST literal `\\` is the escape character, so a value
    carrying one can reshape the filter even though it never contains a
    `"`. `EMAIL_RE`'s local part is `[^@\\s]{1,64}` and accepts a
    backslash, so this is reachable from a real address typed on a form.

    The guard is deny-by-default on what the grammar *reserves*, not
    allow-by-default on what it does not; an allow-list of safe characters
    would have passed both of these and is the version that keeps getting
    written by accident.
    """
    nasty = "a\\b@example.test"
    calls = _roster_stub(monkeypatch, listed=[nasty])
    _stub_verify(monkeypatch, email=nasty)
    resp = client.post("/v1/auth/exchange", json={"email": nasty, "code": "123456"})
    assert resp.json()["approved"] is False
    # Refused *before* the lookup: the address never reaches the query.
    assert [c for c in calls if c["path"] == jwt_auth.BETA_ACCESS_PATH] == []
    with pytest.raises(ValueError):
        jwt_auth._filter_value(nasty)


def test_the_test_parser_reads_escapes_before_it_finds_the_closing_quote():
    """The parser must assert against PostgREST's grammar, not mirror the code.

    `_parse_postgrest` is the only PostgREST in the room, so a parser that
    shared the implementation's assumption would agree with it on every
    input including the wrong ones — which is exactly how the
    percent-encoding bug survived a round that had a test for it. This
    case is the one that separates them: `\\"` is an escaped quote and does
    **not** end the literal, and an old `value.find('"', 1)` parser reads
    the whole tail as `trailing` grammar.
    """
    parsed = _parse_postgrest('?email=eq."a\\"b,c@example.test"')
    assert len(parsed) == 1
    assert parsed[0]["values"] == ['a"b,c@example.test'], (
        "an escaped quote must not end the literal"
    )
    assert parsed[0]["trailing"] == ""

    # A doubled backslash on the wire is one backslash in the value, and
    # the comma after it is inside the literal, not a list separator.
    parsed = _parse_postgrest(r'?email=eq."a\\b,c@example.test"')
    assert parsed[0]["values"] == ["a\\b,c@example.test"]
    assert parsed[0]["trailing"] == ""


def test_an_unreadable_roster_is_loud_where_a_genuine_miss_is_not(monkeypatch, hosted, caplog):
    """`PGRST204` must not be able to pass for "not in the beta".

    Both call sites deliberately answer a control-plane failure the way they
    answer a genuine miss — that is the right direction to fail, and a
    caller who has already proved inbox control gets the same answer
    either way. So the log is the *only* place the two can be told apart,
    and it is the only thing between an unapplied migration and every
    approved member being refused while the log says they were never
    listed. The status goes in; the body does not, because on some errors
    PostgREST echoes the filter, and the filter is somebody's address.
    """
    import asyncio
    import logging

    missing_column = json.dumps(
        {"code": "PGRST204", "details": "Could not find the 'revoked_at' column"}
    )

    async def broken(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        return 400, missing_column

    monkeypatch.setattr(jwt_auth, "_profiles", broken)

    with caplog.at_level(logging.ERROR, logger="brotto.jwt_auth"):
        assert asyncio.run(jwt_auth._listed_for_beta(LISTED)) is False
    assert "400" in caplog.text
    assert "migrations" in caplog.text
    assert "PGRST204" not in caplog.text and "revoked_at" not in caplog.text

    caplog.clear()
    with caplog.at_level(logging.ERROR, logger="brotto.jwt_auth"):
        with pytest.raises(AccountRefused) as caught:
            asyncio.run(jwt_auth.ensure_on_roster(Claims(sub=USER_ID, email=LISTED)))
    # The refusal the user sees is unchanged — it is a control-plane
    # problem, not "this account is not part of the beta" — but it is now
    # an answer the operator can trace.
    assert caught.value.reason == "control_plane_unavailable"
    assert "400" in caplog.text
    assert "PGRST204" not in caplog.text

    # A lookup that raises is one event, so it is **one record** carrying
    # both the what and the why. It used to log the exception type and then
    # call `_control_plane_failed`, which is two ERROR records for one
    # failure and reads as two incidents.
    async def boom(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        raise TimeoutError("upstream connect timeout")

    monkeypatch.setattr(jwt_auth, "_profiles", boom)
    caplog.clear()
    with caplog.at_level(logging.ERROR, logger="brotto.jwt_auth"):
        assert asyncio.run(jwt_auth._listed_for_beta(LISTED)) is False
    records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(records) == 1, f"one event, {len(records)} records: {caplog.text}"
    assert "TimeoutError" in caplog.text
    # The message can carry the address; the type cannot.
    assert "upstream connect timeout" not in caplog.text


def test_an_unlisted_address_says_nothing_at_all(monkeypatch, hosted, caplog):
    """The other half of the distinction: a real miss is not an incident."""
    import asyncio
    import logging

    async def empty(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        return 200, "[]"

    monkeypatch.setattr(jwt_auth, "_profiles", empty)
    with caplog.at_level(logging.ERROR, logger="brotto.jwt_auth"):
        assert asyncio.run(jwt_auth._listed_for_beta(LISTED)) is False
    assert caplog.text == ""


def test_a_withdrawn_roster_row_is_refused_even_though_it_is_still_listed(client, monkeypatch, hosted):
    """`revoked_at` on `beta_access` is the withdrawal; the row is still there.

    The row surviving is what makes this the trap. `profiles.id` is an FK
    into `auth.users`, so deleting the auth account cascades the
    `profiles` row away and takes `profiles.revoked_at` — the thing
    `authorize_task_start` reads — with it. A member in that state who
    signs back in would otherwise find the roster row still present,
    write a fresh `profiles` row, and re-admit themselves. Withdrawn
    here means no row is written at all.
    """
    calls = _roster_stub(
        monkeypatch, listed=[LISTED], profiles=[{"revoked_at": None}], revoked=[LISTED]
    )
    _stub_verify(monkeypatch)
    resp = client.post("/v1/auth/exchange", json={"email": LISTED, "code": "123456"})
    assert resp.status_code == 200
    assert resp.json()["approved"] is False
    # Sign-in still succeeded — the credential is real — and nothing was written.
    assert [c["method"] for c in calls if c["path"] == "rest/v1/profiles"] == []


def test_an_unlisted_address_is_approved_by_nobody_and_writes_nothing(client, monkeypatch, hosted):
    """Sign-in still succeeds — the credential is real — and no row appears."""
    calls = _roster_stub(monkeypatch, listed=[LISTED])
    _stub_verify(monkeypatch)
    monkeypatch.setattr(
        jwt_auth, "verify_jwt", lambda token: Claims(sub=USER_ID, email="stranger@example.test")
    )
    resp = client.post(
        "/v1/auth/exchange", json={"email": "stranger@example.test", "code": "123456"}
    )
    assert resp.status_code == 200
    assert resp.json()["approved"] is False
    assert [c["method"] for c in calls if c["path"] == "rest/v1/profiles"] == []


def test_the_approved_email_is_the_claims_and_not_the_body(client, monkeypatch, hosted):
    """The body is caller-supplied and this is the one function acting on it.

    The roster holds the address the caller *typed*; the token Supabase
    issued says somebody else. Acting on the body would approve the wrong
    inbox, so the claim wins even when the claim is the unwelcome answer.
    """
    calls = _roster_stub(monkeypatch, listed=[LISTED])
    _stub_verify(monkeypatch)  # these claims say listed@example.test; the roster holds it
    monkeypatch.setattr(jwt_auth, "verify_jwt",
                        lambda token: Claims(sub=USER_ID, email="stranger@example.test"))
    resp = client.post("/v1/auth/exchange", json={"email": LISTED, "code": "123456"})
    assert resp.json()["approved"] is False
    assert [c["method"] for c in calls if c["path"] == "rest/v1/profiles"] == []


def test_a_revoked_member_keeps_the_revocation_by_signing_in_again(client, monkeypatch, hosted):
    """**The trap.** Self-approval must be an insert-if-absent.

    Written as an upsert — or with `revoked_at: null` in the body "because
    the row should be active" — a member the operator deliberately
    withdrew signs back in and is silently reinstated, with nothing
    anywhere recording that it happened. `revoked_at` is not written by any
    path here, and the `Prefer` header is what declines to touch the row.
    """
    calls = _roster_stub(
        monkeypatch, listed=[LISTED], profiles=[{"revoked_at": "2026-10-01T00:00:00Z"}]
    )
    _stub_verify(monkeypatch)
    resp = client.post("/v1/auth/exchange", json={"email": LISTED, "code": "123456"})
    assert resp.status_code == 200
    assert resp.json()["approved"] is False
    # No write touched the revocation — not even naming the field. The
    # *read* below it selects `revoked_at`, which is the whole point of the
    # re-read, so this is scoped to the calls that write.
    writes = [c for c in calls if c["method"] == "POST"]
    assert "revoked_at" not in json.dumps(writes)
    assert set(writes[0]["body"]) == {"id", "email"}


def test_the_second_wall_still_stands_after_an_approved_sign_in(client, monkeypatch, hosted, session_id, tmp_path):
    """`approved` is a report for the panel; the decision is at task start.

    The row is active when the person signs in and revoked a minute later —
    which is the whole point of reading the roster at task start instead of
    trusting a token.
    """
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    calls = _roster_stub(monkeypatch, listed=[LISTED], profiles=[{"revoked_at": None}])
    _stub_verify(monkeypatch)
    assert client.post(
        "/v1/auth/exchange", json={"email": LISTED, "code": "123456"}
    ).json()["approved"] is True

    calls.clear()
    rows = [{"revoked_at": None, "week_start": _today(), "tasks_this_week": 0}]
    _profiles_stub(monkeypatch, rows)
    minted = _mint(client, _token())

    rows[0]["revoked_at"] = "2026-10-02T00:00:00Z"  # the operator, mid-session
    import asyncio

    with pytest.raises(jwt_auth.AccountRefused) as caught:
        asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email=LISTED)))
    assert caught.value.reason == "revoked"


def test_an_unreachable_control_plane_leaves_the_caller_signed_in(client, monkeypatch, hosted):
    """The credential is real and the answer is only a report.

    Failing the whole exchange would sign a valid person out because
    Supabase's REST side blinked; failing *this* costs one confusing UI
    state, and task start refuses on the same failure.
    """
    async def fake(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        raise jwt_auth.SupabaseUnavailable("boom")

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    _stub_verify(monkeypatch)
    resp = client.post("/v1/auth/exchange", json={"email": LISTED, "code": "123456"})
    assert resp.status_code == 200
    assert resp.json() == {"access_token": _token(email=LISTED), "approved": False}


# ── the same wall on every use path, not only at task start ──────────────

#: Every route that spends the operator's credits, stores the user's data or
#: writes to a table. None of them may answer on a valid signature alone.
USE_ROUTES = [
    ("/v1/model/check", {"model_config": {}}),
    ("/v1/policy", None),
    ("/v1/sessions", {}),
    ("/v1/policy_ack", {"settings": {}}),
    ("/v1/reports", {"reports": []}),
    ("/v1/suggestions", {"url": "https://example.test"}),
]


@pytest.mark.parametrize("route,body", USE_ROUTES)
def test_an_unapproved_token_is_refused_on_every_use_path(
    client, monkeypatch, hosted, route, body
):
    """The signature is not the invitation.

    A successful exchange hands anybody who proved inbox control a token
    that verifies — a signature proves an account exists, and these six
    routes were answering on that alone. Two of them spend the operator's
    model credits, which is the cost this is really about.
    """
    _profiles_stub(monkeypatch, [])  # a valid JWT with no profile row
    headers = {"Authorization": f"Bearer {_token()}"}
    resp = (client.get(route, headers=headers) if body is None
            else client.post(route, json=body, headers=headers))
    assert resp.status_code == 403, f"{route} answered {resp.status_code}"


@pytest.mark.parametrize("route,body", USE_ROUTES)
def test_an_unreachable_control_plane_fails_closed_on_every_use_path(
    client, monkeypatch, hosted, route, body
):
    """Same direction as task start, same reason: "we could not check"
    is not a licence to serve. An outage must not become an access
    decision — especially on the two routes that call a provider.
    """
    _profiles_stub(monkeypatch, [], fail_on=("GET",))
    headers = {"Authorization": f"Bearer {_token()}"}
    resp = (client.get(route, headers=headers) if body is None
            else client.post(route, json=body, headers=headers))
    assert resp.status_code == 403, f"{route} answered {resp.status_code}"


@pytest.mark.parametrize("route,body", USE_ROUTES)
def test_a_revoked_account_is_refused_on_every_use_path(
    client, monkeypatch, hosted, route, body
):
    _profiles_stub(monkeypatch, [{"revoked_at": "2026-10-01T00:00:00Z"}])
    headers = {"Authorization": f"Bearer {_token()}"}
    resp = (client.get(route, headers=headers) if body is None
            else client.post(route, json=body, headers=headers))
    assert resp.status_code == 403, f"{route} answered {resp.status_code}"


def test_an_approved_account_reaches_every_use_path(client, monkeypatch, hosted):
    """The guard is not a door that does not open — the roster hit passes."""
    _profiles_stub(monkeypatch, [{"revoked_at": None}])
    headers = {"Authorization": f"Bearer {_token()}"}
    assert client.get("/v1/policy", headers=headers).status_code == 200
    assert client.post("/v1/sessions", json={}, headers=headers).status_code == 201


def test_a_bad_credential_is_still_a_404_not_a_403(client, monkeypatch, hosted):
    """403 confirms the route is worth probing, and this server holds the
    user's transcripts. 403 is reserved for a real credential whose
    account is not on the roster."""
    _profiles_stub(monkeypatch, [{"revoked_at": None}])
    resp = client.get("/v1/policy", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 404


def test_self_host_answers_every_use_path_unchanged(client, monkeypatch):
    """No `Claims` object exists on self-host, so the roster is never
    consulted and a self-hoster's own box behaves exactly as it did."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    headers = {"Authorization": "Bearer s3cret"}
    assert client.get("/v1/policy", headers=headers).status_code == 200
    assert client.post("/v1/sessions", json={}, headers=headers).status_code == 201


# ── the code is ours: digest, mint, and the one sign-in row ────────────────


def test_the_stored_code_is_a_digest_and_never_the_code(hosted, monkeypatch):
    """`code_hash` is 64 lowercase hex, and the code itself is not on the row.

    A table dump is the threat this shapes: a six-digit code stored in the
    clear is a list of live credentials, and a column named `code_hash` that
    *holds* the code is the same list with a reassuring name. The SQL CHECK
    refuses a plaintext row (`test_the_column_cannot_hold_a_code`); this pins
    what the relay actually writes.
    """
    import asyncio
    import re

    calls = _roster_stub(monkeypatch, listed=["beta@example.test"])
    monkeypatch.setattr("brotto_orchestrator.session.sign_in_code_email.send_code",
                        _noop_send)
    asyncio.run(jwt_auth.request_login_code("beta@example.test"))
    sent = [c["body"] for c in calls if c["path"] == "rest/v1/sign_in_codes"]
    assert len(sent) == 1
    body = sent[0]
    assert set(body) == {"email", "code_hash", "expires_at"}
    assert re.fullmatch(r"[0-9a-f]{64}", body["code_hash"]), body["code_hash"]
    assert not re.fullmatch(r"\d{6}", body["code_hash"])


async def _noop_send(email, code):
    return None


def test_the_digest_is_keyed_so_a_dump_is_not_a_list_of_codes(hosted):
    """Unkeyed `sha256` of a 10^6 space is a rainbow table of one line.

    Whoever holds the table could recompute every digest offline in under a
    second. HMAC keyed on `SUPABASE_JWT_SECRET` is the difference, and the
    domain prefix keeps a digest minted for one purpose from replaying as
    one for another under the same key.
    """
    import hashlib
    import hmac as hmac_mod

    code = "123456"
    digest = jwt_auth.hash_sign_in_code(code)
    assert digest != hashlib.sha256(code.encode()).hexdigest()
    assert digest != hashlib.sha256(f"brotto.sign-in-code:{code}".encode()).hexdigest()
    keyed = hmac_mod.new(
        JWT_SECRET.encode(), f"brotto.sign-in-code:{code}".encode(), hashlib.sha256
    ).hexdigest()
    assert digest == keyed


def test_the_mint_is_six_digits_from_secrets(hosted):
    codes = {jwt_auth.mint_sign_in_code() for _ in range(50)}
    assert all(c.isdigit() and len(c) == 6 for c in codes)
    assert len(codes) > 1, "a constant mint is not a code"


def test_make_jwt_and_verify_jwt_are_one_key_one_algorithm(hosted):
    """`make_jwt` is no longer a test helper — `exchange_login_code` signs
    the production access token with it, against the same secret
    `verify_jwt` checks. A round trip is the whole contract; anything the
    verifier refuses here is a beta member who cannot sign in.
    """
    token = make_jwt(
        {"sub": USER_ID, "email": "beta@example.test", "role": "authenticated",
         "exp": int(time.time()) + jwt_auth.TOKEN_TTL_SECONDS},
        JWT_SECRET,
    )
    claims = jwt_auth.verify_jwt(token)
    assert claims is not None
    assert claims.sub == USER_ID
    assert jwt_auth.verify_jwt(make_jwt(
        {"sub": USER_ID, "exp": int(time.time()) + 60}, "other-secret"
    )) is None


def test_every_failure_is_one_opaque_sentence(hosted, monkeypatch):
    """Wrong, expired, spent and never-issued are the same words.

    Distinguishing them would name whether an address has a live code, which
    is the account-existence oracle `request-code` refuses to be. Asserted at
    the function, because the HTTP layer already maps `ValueError` to one
    fixed body.
    """
    import asyncio

    async def no_row(method, path, *, json_body, api_key, service=False, prefer=""):
        return 200, "false"

    async def error(method, path, *, json_body, api_key, service=False, prefer=""):
        return 404, '{"message":"whatever the database said"}'

    for fake in (no_row, error):
        monkeypatch.setattr(jwt_auth, "_supabase_call", fake)
        with pytest.raises(ValueError) as exc:
            asyncio.run(jwt_auth.exchange_login_code("beta@example.test", "000000"))
        assert str(exc.value) == "invalid or expired code"


def test_a_successful_exchange_records_one_sign_in_event(client, monkeypatch, hosted):
    """One row per successful exchange, owner from the verified token, the
    peer as a **network**.

    The peer is `_signin_peer` — the socket identity, not a forwarded header
    a caller can rewrite — so the test pins that seam rather than
    `x-forwarded-for`. `test_the_peer_is_stored_as_a_network_and_never_as_a_host`
    owns the masking itself.

    The background task is the whole reason a control-plane hiccup cannot
    turn a finished sign-in into an error — and it is why a failed exchange
    must write nothing at all.
    """
    rows = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        if path == "rest/v1/sign_in_events":
            rows.append(body)
            return 201, ""
        return 200, "{}"

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    monkeypatch.setattr(jwt_auth, "exchange_login_code",
                        lambda e, c: _ok_token())
    monkeypatch.setattr(jwt_auth, "approve_at_exchange", _no_approval)
    monkeypatch.setattr("brotto_orchestrator.main._signin_peer",
                        lambda request: "203.0.113.42")
    resp = client.post(
        "/v1/auth/exchange",
        json={"email": "beta@example.test", "code": "123456"},
        headers={"user-agent": "Mozilla/5.0 (test)", "x-forwarded-for": "203.0.113.42"},
    )
    assert resp.status_code == 200
    assert len(rows) == 1, rows
    row = rows[0]
    assert row["owner"] == USER_ID
    assert row["ip"] == "203.0.113.0/24"
    assert row["user_agent"] == "Mozilla/5.0 (test)"


async def _ok_token():
    return _token()


def test_a_failed_exchange_records_no_sign_in_event(client, monkeypatch, hosted):
    rows = []

    async def fake(method, path, *, json_body, api_key, service=False, prefer=""):
        if path == "rest/v1/sign_in_events":
            rows.append(json_body)
        return 200, "{}"

    async def boom(email, code):
        raise ValueError("invalid or expired code")

    monkeypatch.setattr(jwt_auth, "_supabase_call", fake)
    monkeypatch.setattr(jwt_auth, "exchange_login_code", boom)
    resp = client.post(
        "/v1/auth/exchange", json={"email": "beta@example.test", "code": "000000"}
    )
    assert resp.status_code == 400
    assert rows == [], "a wrong guess is not a sign-in"


def test_the_peer_is_stored_as_a_network_and_never_as_a_host(hosted):
    assert jwt_auth._mask_peer("203.0.113.42") == "203.0.113.0/24"
    assert jwt_auth._mask_peer("2001:db8:abcd:1234::1") == "2001:db8:abcd::/48"
    assert jwt_auth._mask_peer("not-an-address") is None
    assert jwt_auth._mask_peer("") is None


def test_an_oversized_user_agent_is_dropped_rather_than_truncated(hosted, monkeypatch):
    """Same call `clean_version` makes: truncating leaves 512 characters of a
    hostile string in the one column a human reads. The table's CHECK is the
    backstop; this is the relay not walking up to it."""
    rows = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles", prefer=""):
        if path == "rest/v1/sign_in_events":
            rows.append(body)
        return 201, ""

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    import asyncio
    asyncio.run(jwt_auth.record_sign_in_event(
        _token(), "203.0.113.42", "x" * (jwt_auth.MAX_USER_AGENT_CHARS + 1)
    ))
    assert rows and rows[0]["user_agent"] == ""
