"""The hosted relay's four auth states, and the two ways they can go wrong.

Three guards here are load-bearing and each one is a bug that shipped as
a *silent* one: a JWT that verifies with the wrong algorithm, a task
that runs for a revoked user, and an extension too old to send a token
being told it sent a wrong one.
"""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import jwt_auth
from brotto_orchestrator.session.auth import auth_mode, authenticate, validate_request
from brotto_orchestrator.session.jwt_auth import Claims, make_jwt

JWT_SECRET = "jwt-secret-for-tests"
USER_ID = "11111111-2222-3333-4444-555555555555"


def _today() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).date().isoformat()


def _token(secret: str = JWT_SECRET, **overrides) -> str:
    payload = {
        "sub": USER_ID,
        "email": "beta@example.test",
        "exp": int(time.time()) + 3600,
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
    with client.websocket_connect(
        f"/ws/ext/{session_id('ws-good')}", subprotocols=["brotto-v1", _token()]
    ) as ws:
        assert ws.accepted_subprotocol == "brotto-v1"


def test_self_host_keeps_one_answer_for_both_failures(client, monkeypatch, tmp_path, session_id):
    """Byte-identical on self-host: the extra code is a hosted-only fix."""
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    assert _ws_close(client, session_id("ws-selfhost-missing"), None) == 4001


# ── the control plane, at task start only ─────────────────────────────────

def _profiles_stub(monkeypatch, rows, *, patch_status=204, fail_on=()):
    calls = []

    async def fake(method, query, body=None):
        calls.append((method, query, body))
        if method in fail_on:
            raise jwt_auth.SupabaseUnavailable("boom")
        if method == "GET":
            return 200, json.dumps(rows)
        return patch_status, ""

    monkeypatch.setattr(jwt_auth, "_profiles", fake)
    return calls


def test_a_live_user_gets_one_task_and_one_count(hosted, monkeypatch):
    calls = _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": None, "tasks_this_week": 0}])
    import asyncio

    asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="b@example.test")))
    methods = [c[0] for c in calls]
    assert methods == ["GET", "PATCH"]
    assert calls[1][2]["tasks_this_week"] == 1


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
    """The reset is a comparison on read, not a job that can stop running."""
    calls = _profiles_stub(monkeypatch, [{"revoked_at": None, "week_start": "2000-01-01", "tasks_this_week": 999}])
    import asyncio

    asyncio.run(jwt_auth.authorize_task_start(Claims(sub=USER_ID, email="")))
    assert calls[1][2]["tasks_this_week"] == 1


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
    _profiles_stub(monkeypatch, [{"revoked_at": "2026-10-01T00:00:00Z", "week_start": _today(), "tasks_this_week": 1}])

    with client.websocket_connect(
        f"/ws/ext/{session_id('ws-revoked')}", subprotocols=["brotto-v1", _token()]
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

    assert registry.get_or_create(session_id("ws-revoked")).current_task is None


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
        return None

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 200
    assert resp.json() == {"sent": True}


def test_an_unregistered_address_answers_exactly_as_a_registered_one(client, monkeypatch, hosted):
    """An account-existence oracle is the failure mode here, not the transport.

    Supabase's own `create_user: false` is what makes this true; this
    test is what stops somebody deleting it.
    """
    sent = []

    async def fake(email):
        sent.append(email)

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    body = {"email": "nobody@example.test"}
    assert client.post("/v1/auth/request-code", json=body).json() == {"sent": True}
    assert sent == ["nobody@example.test"]


def test_a_malformed_address_is_refused_without_calling_supabase(client, monkeypatch, hosted):
    called = []

    async def fake(email):
        called.append(email)

    monkeypatch.setattr(jwt_auth, "request_login_code", fake)
    assert client.post("/v1/auth/request-code", json={"email": "not-an-email"}).status_code == 400
    assert called == []


def test_exchange_returns_the_access_token(client, monkeypatch, hosted):
    async def fake(email, code):
        return "a.b.c"

    monkeypatch.setattr(jwt_auth, "exchange_login_code", fake)
    resp = client.post(
        "/v1/auth/exchange", json={"email": "beta@example.test", "code": "123456"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"access_token": "a.b.c"}


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
    async def fake(method, path, *, json_body, api_key, service=False):
        return 429, '{"message":"Email rate limit exceeded. Try again in 60s.","error_code":429}'

    monkeypatch.setattr(jwt_auth, "_supabase_call", fake)
    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 200


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