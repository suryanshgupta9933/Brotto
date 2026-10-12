"""The waitlist: one field in, one field on disk, and nothing to ask about it.

The load-bearing test is `test_a_waitlist_row_is_exactly_the_form_fields_and_the_ask`.
This is the first thing the project holds about someone who is *not* an
account — a stranger who filled in a form — and the guarantee that matters is
that there is nowhere to put a referrer, a user agent, a URL or a note. `build_row`
takes named arguments and raises on the rest, so widening the payload is a
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

def test_a_waitlist_row_is_exactly_the_form_fields_and_the_ask(monkeypatch):
    row = wl.build_row(email=VISITOR)
    assert set(row) == set(wl.COLUMNS), "a column nobody wrote a reason for"
    assert row["email"] == VISITOR
    assert row["batch"] == ""
    assert row["asked_at"]
    # The oracle guard: a row this path can build is a request, never a grant
    # or a withdrawal. `beta-roster.sh` writes those two columns alone.
    assert "approved_at" not in wl.COLUMNS and "revoked_at" not in wl.COLUMNS


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


def test_a_typed_name_is_stored_bounded(hosted, client, monkeypatch):
    """The one field the visitor typed that is not an address, for one
    reason: the operator is about to send these people an invite and cannot
    say their name without it. Bounded because a paragraph is the form being
    used as storage."""
    seen = _supabase_stub(monkeypatch)
    resp = client.post("/v1/waitlist", json={"email": VISITOR, "name": "  Ada Lovelace "})
    assert resp.status_code == 200
    assert seen[0]["body"]["name"] == "Ada Lovelace"
    client.post("/v1/waitlist", json={"email": VISITOR, "name": "A" * 500})
    assert len(seen[1]["body"]["name"]) == wl.NAME_MAX_CHARS


def test_a_name_a_spreadsheet_would_run_is_stored_as_text(hosted, client, monkeypatch):
    """CSV is how the operator gets this table out, and Excel and Google
    Sheets both execute a leading `=`, `+`, `-` or `@` when they open one.

    So a stranger typing into a public form is a thing the operator's own
    machine runs, on the export they open to send invites from. The four
    characters are quoted with the apostrophe both spreadsheets read as
    "text, not formula" — not stripped, so a name that genuinely starts
    with a dash still reads as the name the visitor typed.
    """
    for typed in ("=cmd|' /C calc'!A0", "+1+1", "-2+3", "@SUM(A1)", "\tName", "\rName"):
        stored = wl.build_row(email=VISITOR, name=typed)["name"]
        assert stored.startswith("'"), f"{typed!r} stored as {stored!r}"
        assert not wl._NAME_FORMULA_RE.match(stored), f"{typed!r} stored as {stored!r}"
    # An ordinary name is untouched — no prefix, no apostrophe.
    assert wl.build_row(email=VISITOR, name="Ada Lovelace")["name"] == "Ada Lovelace"
    # And the one the operator reads is not a guess: the prefix is what
    # makes it display without itself.
    assert wl.build_row(email=VISITOR, name="=x")["name"] == "'=x"
    # The row that actually reaches the table, not just the helper's return
    # value — the sink is the CSV export, and this is what lands in it.
    seen = _supabase_stub(monkeypatch)
    client.post("/v1/waitlist", json={"email": VISITOR, "name": "=cmd|' /C calc'!A0"})
    assert seen[0]["body"]["name"] == "'=cmd|' /C calc'!A0"


def test_an_email_a_spreadsheet_would_run_is_refused_not_quoted(hosted, client, monkeypatch):
    """The same attack on the same export, one column over — with a different
    answer from the name, on purpose.

    `name` was guarded in `_safe_name` and in `005`'s CHECK; `email` was
    forgotten in both. `EMAIL_RE` is "looks like an email" and nothing more —
    its local part is `[^@\\s]{1,64}`, which admits a leading `+` — so
    `+1+1@example.test` reaches `build_row` and is executed by the operator's
    spreadsheet the moment the waitlist is exported to send invites from.

    **Refused rather than prefixed.** Quoting is right for a name, which is
    arbitrary text we want back in the export and where the apostrophe is
    invisible once the cell renders as text. An address has to round-trip: the
    operator exports this column to send invites from, and a stored
    `'+tag@example.test` is no longer the mailbox that person signs in with —
    silently wrong until an invite does not arrive. And the rejection costs
    nobody anything real, because a `+tag` address and the plain one are the
    *same mailbox*: the visitor submits the base one, and the operator can add
    the tagged spelling straight to `beta_access`, which nothing here
    constrains or prefixes.
    """
    for typed in ("+1+1@example.test", "+tag@example.test", "-2+3@example.test",
                  "=1+1@example.test", "@evil@example.test",
                  "\tvisitor@example.test", "\rvisitor@example.test"):
        with pytest.raises(ValueError) as caught:
            wl.build_row(email=typed)
        assert str(caught.value) == wl.EMAIL_FORMULA_REFUSAL
        assert typed not in str(caught.value), "the refusal must not echo the address"

    # An ordinary address is stored verbatim — the assertion the quoted
    # version could not make, and the one that would fail against it.
    assert wl.build_row(email=VISITOR)["email"] == VISITOR
    # A `+` mid-local-part is an ordinary address, not a trigger — the guard is
    # on the first character, and only a *leading* `+` is something a
    # spreadsheet executes. `user+tag@` is a real mailbox and is stored
    # exactly as typed.
    assert wl.build_row(email="ada+b@example.test")["email"] == "ada+b@example.test"

    # Through the route: a 4xx carrying the instruction, not a 500 and not a
    # write. `build_row` raises inside the mounted sub-application, where the
    # `_BadRequest` handler is not registered, so this is where the 400 is
    # bought back.
    seen = _supabase_stub(monkeypatch)
    resp = client.post("/v1/waitlist", json={"email": "+tag@example.test"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == wl.EMAIL_FORMULA_REFUSAL
    assert seen == [], "a refused address must not reach the table"

    # And the neighbour is untouched, so the refusal is not a blanket one.
    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 200
    assert seen[0]["body"]["email"] == VISITOR


def test_the_formula_guard_holds_after_the_length_bound(monkeypatch):
    """Truncation must not run *after* the guard, or a name whose first
    `NAME_MAX_CHARS` are safe and whose lead is not... is not the case
    here — but the bound runs first, so a guard applied to a different
    string than the one stored would be a guard against nothing.

    This pins the order rather than the truth table: the stored value is
    exactly `stored[:NAME_MAX_CHARS + 1]`, the guard and the bound applied
    to the same string.
    """
    long_name = "=" + "A" * wl.NAME_MAX_CHARS * 2
    stored = wl.build_row(email=VISITOR, name=long_name)["name"]
    assert len(stored) == wl.NAME_MAX_CHARS + 1  # the quote, and nothing else
    assert stored == "'=" + "A" * (wl.NAME_MAX_CHARS - 1)


def test_a_name_is_optional_and_the_answer_does_not_mention_it(hosted, client, monkeypatch):
    """A signup stays `{"ok": true}` whatever the body said — a name is not
    an oracle and not a status."""
    _supabase_stub(monkeypatch)
    assert client.post("/v1/waitlist", json={"email": VISITOR}).json() == {"ok": True}
    assert client.post(
        "/v1/waitlist", json={"email": VISITOR, "name": "Ada Lovelace"}
    ).json() == {"ok": True}


def test_a_name_is_not_a_back_door_for_the_fields_that_are_refused(hosted, client, monkeypatch):
    """Still nowhere to put a referrer, a URL or a note. The shape that
    enforced this is `build_row`'s named arguments, and adding `name` did
    not turn it into `**kwargs`."""
    seen = _supabase_stub(monkeypatch)
    client.post("/v1/waitlist", json={
        "email": VISITOR, "name": "Ada",
        "referrer": "https://example.test/pricing", "note": "the Gmail one",
    })
    body = seen[0]["body"]
    assert set(body) == set(wl.COLUMNS)
    assert body["email"] == VISITOR and body["name"] == "Ada" and body["batch"] == ""
    with pytest.raises(ValueError):
        wl.build_row(email=VISITOR, note="the Gmail one")


def test_self_host_is_answered_a_404_and_stores_no_name(monkeypatch, client):
    """The name is the cloud relay's business. A self-hosted box does not
    have this route at all, so it has nowhere to put one."""
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")

    async def explode(*a, **k):
        raise AssertionError("self-host wrote to the waitlist")

    monkeypatch.setattr(fresh_jwt, "_profiles", explode)
    assert client.post(
        "/v1/waitlist", json={"email": VISITOR, "name": "Ada Lovelace"}
    ).status_code == 404


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
    # `beta_access` now — `010` merged the waitlist in, and the row this
    # writes is a request (`asked_at`) on that one table.
    assert [c["path"] for c in seen] == ["rest/v1/beta_access"]
    body = seen[0]["body"]
    assert set(body) == set(wl.COLUMNS)
    assert body["email"] == VISITOR and body["name"] == "" and body["batch"] == ""


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
    body = seen[0]["body"]
    assert set(body) == set(wl.COLUMNS)
    assert body["email"] == VISITOR and body["name"] == "" and body["batch"] == ""


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
    """Submitting somebody else's address five times must not stop that person
    asking for their own sign-in code for ten minutes.

    Both halves of the limiter are namespaced to the waitlist now — the peer
    bucket included, which is the other half of this test below.
    """
    _supabase_stub(monkeypatch)
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    async def otp(*a, **kw):
        return 200, "{}"

    monkeypatch.setattr(fresh_jwt, "_supabase_call", otp)
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


def test_the_waitlist_cannot_drain_the_sign_in_peer_bucket(hosted, client, monkeypatch):
    """The peer bucket used to be shared, and that was a denial of service.

    Behind Heroku every caller shares one router address, so the peer key is
    one bucket for the whole beta. An anonymous visitor could spend it twenty
    times on the open form and lock out every beta user asking for a login
    code — the one route a signed-in person needs and the one route an
    anonymous stranger can reach. Same limiter, same anti-spam argument, a
    separate set of keys.
    """
    _supabase_stub(monkeypatch)
    from brotto_orchestrator import main
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    async def otp(*a, **kw):
        return 200, "{}"

    monkeypatch.setattr(fresh_jwt, "_supabase_call", otp)

    def submit(i):
        return client.post(
            "/v1/waitlist",
            json={"email": f"visitor{i}@example.test"},
            # A fresh address and a fresh header per request: the two halves
            # a caller controls, so only the shared peer key can stop them.
            headers={"x-forwarded-for": f"203.0.113.{i}"},
        ).status_code

    statuses = [submit(i) for i in range(int(main._SHARED_PEER_CAPACITY) + 5)]
    assert statuses[-1] == 429, "the open form is not metered on its own peer bucket"

    resp = client.post("/v1/auth/request-code", json={"email": "beta@example.test"})
    assert resp.status_code == 200, "the waitlist spent the sign-in routes' peer budget"


def test_the_peer_key_is_the_socket_and_the_namespace_is_not_optional(hosted, client):
    """Stated against the unit both routes call, so the property does not
    depend on how many requests a test happens to make."""
    from brotto_orchestrator import main

    main._SIGNIN_BUCKETS.clear()
    peer = main._signin_peer(_FakeRequest(host="198.51.100.9"))
    for i in range(int(main._SHARED_PEER_CAPACITY)):
        assert main._signin_allowed(peer, f"visitor{i}@example.test", f"203.0.113.{i}",
                                    prefix="waitlist:")
    assert not main._signin_allowed(peer, "last@example.test", "203.0.113.250",
                                    prefix="waitlist:")
    # The drained bucket is the waitlist's alone.
    assert main._signin_allowed(peer, "beta@example.test", "203.0.113.250")
    assert peer == "198.51.100.9", "the peer is still the socket, never the header"


def test_a_malformed_body_is_a_400_not_a_500(hosted, client):
    """The `_BadRequest` handler is registered on `app`; this route is
    dispatched by the mounted sub-application, so an uncaught raise came back
    as a 500 on a route whose every other error path is a 400."""
    resp = client.post("/v1/waitlist", content=b"{not json",
                       headers={"Content-Type": "application/json"})
    assert resp.status_code == 400, resp.text


def test_a_body_that_is_not_an_object_is_a_400(hosted, client):
    for payload in (b'["an"]', b'"a string"', b"null", b"3"):
        resp = client.post("/v1/waitlist", content=payload,
                           headers={"Content-Type": "application/json"})
        assert resp.status_code == 400, (payload, resp.status_code, resp.text)


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