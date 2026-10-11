"""The waitlist: one field in, one field on disk, and nothing to ask about it.

The load-bearing test is `test_a_waitlist_row_is_exactly_the_email_and_a_batch`.
This is the first thing the project holds about someone who is *not* an
account — a stranger who filled in a form — and the guarantee that matters is
that there is nowhere to put a referrer, a user agent or a URL. `build_row`
takes one named argument and raises on the rest, so widening the payload is a
code change this suite fails on rather than something a later commit does
quietly.

The rest is the public surface: an open form is a spam target, so the meter is
there; and a route that answered differently for "new" and "already on the
list" would be a directory of strangers' inbox membership.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session import waitlist as wl
from brotto_orchestrator.session import jwt_auth

JWT_SECRET = "jwt-secret-for-tests"
MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "003_waitlist.sql"

VISITOR = "visitor@example.test"


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def _fresh_buckets():
    """Empty the shared sign-in/waitlist limiter around every test.

    Imported inside the fixture, not aliased at module scope: `test_failure_modes`
    purges `brotto_orchestrator` from `sys.modules` and re-imports, so a
    module-level alias names the pre-purge module while `main` looks the bucket
    up on the post-purge one.
    """
    from brotto_orchestrator import main as fresh

    fresh._SIGNIN_BUCKETS.clear()
    fresh._SIGNIN_SWEEP_AT = 0.0
    yield
    fresh._SIGNIN_BUCKETS.clear()
    fresh._SIGNIN_SWEEP_AT = 0.0


def _supabase_stub(monkeypatch, *, status=201, raises=None):
    """Stub the one PostgREST seam. Returns the calls it was handed.

    The module is resolved *inside* the helper, for the same reason the
    bucket fixture above is: `test_failure_modes` purges `brotto_orchestrator`
    from `sys.modules` and re-imports, so a module-level alias names the
    pre-purge module while `waitlist` imports the post-purge one — and the
    patch then lands somewhere nothing reads.
    """
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    seen = []

    async def fake(method, query, body=None, *, path="rest/v1/profiles"):
        seen.append({"method": method, "query": query, "body": body, "path": path})
        if raises is not None:
            raise raises
        return status, json.dumps(body or {})

    monkeypatch.setattr(fresh_jwt, "_profiles", fake)
    return seen


# ── the boundary ──────────────────────────────────────────────────────────

def test_a_waitlist_row_is_exactly_the_email_and_a_batch(monkeypatch):
    row = wl.build_row(email=VISITOR)
    assert set(row) == set(wl.COLUMNS), "a column nobody wrote a reason for"
    assert row["email"] == VISITOR
    assert row["batch"] == ""


def test_the_row_cannot_carry_a_referrer_a_url_or_a_typed_field():
    """The guarantee. A filter is a later commit's widening; a raise is not."""
    for extra in (
        {"referer": "https://example.test/pricing"},
        {"url": "https://example.test/?utm_source=x"},
        {"user_agent": "Mozilla/5.0"},
        {"ip": "203.0.113.7"},
        {"note": "I want the Gmail one"},
    ):
        with pytest.raises(ValueError):
            wl.build_row(email=VISITOR, **extra)


def test_the_batch_is_the_operators_label_not_the_callers(monkeypatch):
    monkeypatch.setenv(wl.BATCH_ENV, "batch-2")
    assert wl.build_row(email=VISITOR)["batch"] == "batch-2"


# ── where it runs at all ──────────────────────────────────────────────────

def test_self_host_has_no_waitlist(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    # A self-hoster with a leftover cloud env must not start collecting
    # strangers' addresses because they pasted SUPABASE_URL in.
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    assert wl.waitlist_enabled() is False


def test_self_host_does_not_answer_the_route_at_all(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 404


def test_a_jwt_relay_with_no_service_key_does_not_answer(hosted, monkeypatch, client):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert wl.waitlist_enabled() is False
    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 404


def test_the_waitlist_route_does_not_disturb_health_or_the_socket(client, monkeypatch):
    """Self-host untouched: the route is 404 and everything else still answers."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    client.post("/v1/waitlist", json={"email": VISITOR})
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"


# ── the public form ───────────────────────────────────────────────────────

def test_a_valid_email_is_accepted(hosted, client, monkeypatch):
    seen = _supabase_stub(monkeypatch)
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert [c["path"] for c in seen] == ["rest/v1/waitlist"]
    assert seen[0]["body"] == {"email": VISITOR, "batch": ""}


def test_the_address_is_normalised_before_it_is_written(hosted, client, monkeypatch):
    """Case and padding are the same person, and the table has one of them."""
    seen = _supabase_stub(monkeypatch)
    client.post("/v1/waitlist", json={"email": "  Visitor@Example.TEST "})
    assert seen[0]["body"]["email"] == "visitor@example.test"


def test_the_body_carries_nothing_else(hosted, client, monkeypatch):
    """Anything else in the body is not read, so there is nothing to store."""
    seen = _supabase_stub(monkeypatch)
    resp = client.post("/v1/waitlist", json={
        "email": VISITOR,
        "referrer": "https://example.test/pricing",
        "page": "https://example.test/",
        "utm_source": "twitter",
    })
    assert resp.status_code == 200
    assert seen[0]["body"] == {"email": VISITOR, "batch": ""}


@pytest.mark.parametrize("bad", ["", "not-an-email", "a@b", "@example.test", "a b@example.test", None])
def test_a_malformed_email_is_rejected_and_never_written(hosted, client, monkeypatch, bad):
    seen = _supabase_stub(monkeypatch)
    resp = client.post("/v1/waitlist", json={"email": bad})
    assert resp.status_code == 400
    assert seen == [], "a rejected address must not reach the table"


def test_a_missing_email_is_rejected(hosted, client, monkeypatch):
    seen = _supabase_stub(monkeypatch)
    assert client.post("/v1/waitlist", json={}).status_code == 400
    assert seen == []


def test_a_repeat_submit_is_not_an_error(hosted, client, monkeypatch):
    """The constraint is in the migration, so the duplicate arrives as a 409.

    Answering that as success is what keeps the route from being a directory of
    who is already on the list.
    """
    _supabase_stub(monkeypatch, status=409)
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_a_new_and_a_known_address_answer_identically(hosted, client, monkeypatch):
    _supabase_stub(monkeypatch, status=201)
    first = client.post("/v1/waitlist", json={"email": VISITOR})
    _supabase_stub(monkeypatch, status=409)
    second = client.post("/v1/waitlist", json={"email": VISITOR})
    assert (first.status_code, first.json()) == (second.status_code, second.json())


# ── the meter ─────────────────────────────────────────────────────────────

def test_the_form_is_rate_limited(hosted, client, monkeypatch):
    """An open write is a bulk-write button without one."""
    _supabase_stub(monkeypatch)
    statuses = [
        client.post(
            "/v1/waitlist",
            json={"email": f"visitor{i}@example.test"},
            headers={"x-forwarded-for": "203.0.113.9"},
        ).status_code
        for i in range(8)
    ]
    assert 429 in statuses, "eight submits from one peer should not all succeed"
    assert statuses[-1] == 429


def test_varying_the_header_and_the_address_does_not_defeat_the_meter(hosted, client, monkeypatch):
    """The limiter used to key on the caller's own `X-Forwarded-For` header.

    That made it decorative rather than merely loose: rotating the header
    minted a fresh bucket per request, and on an open form the submitted
    address is chosen by the attacker as well — so both halves of the limit
    were the thing being varied. The bucket that does the work now is keyed on
    the socket address, which comes off the connection and cannot be set by
    the caller. CORS does not help here: a cross-origin POST is still sent,
    it just cannot be read back.
    """
    _supabase_stub(monkeypatch)
    from brotto_orchestrator import main

    statuses = [
        client.post(
            "/v1/waitlist",
            json={"email": f"visitor{i}@example.test"},
            headers={"x-forwarded-for": f"203.0.113.{i}"},
        ).status_code
        for i in range(int(main._SHARED_PEER_CAPACITY) + 5)
    ]
    assert 429 in statuses, "a fresh header and a fresh address per request is the whole attack"
    assert statuses[-1] == 429


class _FakeRequest:
    def __init__(self, host: str, xff: str = ""):
        self.client = type("C", (), {"host": host})()
        self.headers = {"x-forwarded-for": xff} if xff else {}


def test_the_metered_key_is_the_socket_not_the_header(hosted, client, monkeypatch):
    """Stated against the unit the routes call, so the property does not
    depend on how many requests a test happens to make."""
    from brotto_orchestrator import main

    main._SIGNIN_BUCKETS.clear()
    peer = main._signin_peer(_FakeRequest(host="198.51.100.7"))
    for i in range(int(main._SHARED_PEER_CAPACITY)):
        assert main._signin_allowed(peer, f"visitor{i}@example.test", f"203.0.113.{i}")
    # Every hop and every address is new; the socket is not, so this is refused.
    assert not main._signin_allowed(peer, "last@example.test", "203.0.113.250")
    # And the peer that key names is the socket, never the header.
    assert peer == "198.51.100.7"
    assert main._signin_peer(_FakeRequest(host="198.51.100.7", xff="203.0.113.99")) == "198.51.100.7"


def test_a_malformed_address_does_not_spend_a_token(hosted, client, monkeypatch):
    """Otherwise a typo'd form teaches a visitor the site is rejecting them."""
    _supabase_stub(monkeypatch)
    headers = {"x-forwarded-for": "203.0.113.10"}
    for _ in range(6):
        assert client.post("/v1/waitlist", json={"email": "nope"}, headers=headers).status_code == 400
    assert client.post("/v1/waitlist", json={"email": VISITOR}, headers=headers).status_code == 200


def test_a_stranger_cannot_burn_an_addresss_sign_in_budget(hosted, client, monkeypatch):
    """The open form shares the peer bucket, not the address one.

    Submitting somebody else's address five times must not stop that person
    asking for their own sign-in code for ten minutes.
    """
    _supabase_stub(monkeypatch)
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    async def otp(*a, **kw):
        return 200, "{}"

    monkeypatch.setattr(fresh_jwt, "_supabase_call", otp)
    # Same address, a *different* peer: the peer half is deliberately shared
    # (it is the anti-spam half), so only the address half is under test here.
    for i in range(6):
        client.post(
            "/v1/waitlist",
            json={"email": VISITOR},
            headers={"x-forwarded-for": "203.0.113.11"},
        )
    resp = client.post(
        "/v1/auth/request-code",
        json={"email": VISITOR},
        headers={"x-forwarded-for": "203.0.113.12"},
    )
    assert resp.status_code != 429, "the waitlist metered somebody else's sign-in budget"


# ── what a broken control plane may say ───────────────────────────────────

def test_a_supabase_error_never_reaches_the_response(hosted, client, monkeypatch):
    _supabase_stub(monkeypatch, status=400)
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 502
    assert VISITOR not in resp.text
    assert "rest/v1" not in resp.text
    assert "duplicate" not in resp.text.lower()


def test_a_supabase_exception_never_reaches_the_response(hosted, client, monkeypatch):
    """A PostgREST/transport exception quotes the request body in its text."""
    class Boom(Exception):
        pass

    _supabase_stub(monkeypatch, raises=Boom(f"insert into waitlist failed for {VISITOR}"))
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 502
    assert VISITOR not in resp.text
    assert "Boom" not in resp.text
    assert "waitlist" not in resp.text.lower()


def test_a_control_plane_that_is_down_is_a_502_not_a_500(hosted, client, monkeypatch):
    _supabase_stub(monkeypatch, raises=jwt_auth.SupabaseUnavailable("boom"))
    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 502


def test_the_address_is_not_written_into_the_log(hosted, client, monkeypatch, caplog):
    _supabase_stub(monkeypatch, raises=jwt_auth.SupabaseUnavailable(f"boom {VISITOR}"))
    with caplog.at_level("WARNING"):
        client.post("/v1/waitlist", json={"email": VISITOR})
    assert VISITOR not in caplog.text


# ── CORS ──────────────────────────────────────────────────────────────────

def test_only_the_named_origin_may_post(hosted, client):
    allowed = {"Origin": "https://brotto.dev"}
    refused = {"Origin": "https://evil.example.test"}
    assert "access-control-allow-origin" in client.options(
        "/v1/waitlist", headers={**allowed, "Access-Control-Request-Method": "POST"}
    ).headers
    assert "access-control-allow-origin" not in client.options(
        "/v1/waitlist", headers={**refused, "Access-Control-Request-Method": "POST"}
    ).headers


def test_the_pages_host_is_allowed_too(hosted, client):
    resp = client.options(
        "/v1/waitlist",
        headers={
            "Origin": "https://suryanshgupta9933.github.io",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "https://suryanshgupta9933.github.io"


def test_a_subdomain_of_the_site_is_not(hosted, client):
    """A prefix match here is the reflection this middleware exists to refuse."""
    resp = client.options(
        "/v1/waitlist",
        headers={
            "Origin": "https://brotto.dev.evil.test",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in resp.headers


# ── the migration ─────────────────────────────────────────────────────────
# A migration file is imported by nothing, so nothing in the Python asserts
# these lines. Same reasoning as `test_profiles_is_closed_to_the_public_key`.

def _sql() -> str:
    return MIGRATION.read_text().lower()


def test_the_waitlist_is_closed_to_the_public_key():
    """RLS with no policy is deny-all; the revokes say so out loud."""
    sql = _sql()
    assert "alter table waitlist enable row level security" in sql
    assert "revoke all on waitlist from anon" in sql
    assert "revoke all on waitlist from authenticated" in sql
    assert "create policy" not in sql


def test_the_table_has_a_column_for_the_ask_and_a_dedupe():
    sql = _sql()
    assert "email" in sql
    assert "unique" in sql
    # There is nowhere to put a referrer, a user agent or an IP. If one ever
    # appears, this test is what should make the commit explain itself.
    for forbidden in ("ip_address", "user_agent", "referer", "utm_"):
        assert forbidden not in sql