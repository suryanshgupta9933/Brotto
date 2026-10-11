"""One page's origin may reach one route, and the test that keeps it there.

`allow_origin_regex` is app-wide. Listing `https://brotto.dev` in it so a
marketing form could POST to `/v1/waitlist` also granted that origin every
CORS-protected route in the process — including `GET /v1/sessions` (every task
title), `GET /v1/sessions/{id}/audit` (the transcript) and `DELETE /v1/sessions`
— on **every install**, including an open-mode self-host where the credential
check passes for everyone.

Chrome partly hides that: it enforces Private Network Access for public →
loopback, and Starlette never sends `Access-Control-Allow-Private-Network`.
Firefox and Safari implement neither. What stood between the allowlist entry
and every user's transcript was a browser mitigation, not a guard.

There is no per-route CORS in Starlette, so the fix is structural: the
waitlist lives on its own `FastAPI()` application, which carries its own
middleware, mounted under the main app. These tests are what stop that from
quietly becoming an app-wide entry again.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.session.jwt_auth import make_jwt

WAITLIST_ORIGIN = "https://brotto.dev"
PAGES_ORIGIN = "https://suryanshgupta9933.github.io"
STRANGER = "https://attacker.example"


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


def _preflight(client: TestClient, origin: str, path: str, method: str = "GET"):
    return client.options(
        path,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "authorization, content-type",
        },
    )


def _granted(resp) -> bool:
    return bool(resp.headers.get("access-control-allow-origin"))


# ── the regression ─────────────────────────────────────────────────────────

def test_the_marketing_origin_cannot_read_the_session_index(client):
    """The regression. This is every task title on the server, to a page on
    the open internet, from an install with no credential at all."""
    resp = client.get("/v1/sessions", headers={"Origin": WAITLIST_ORIGIN})
    assert resp.status_code == 200, "the route still exists; the page must not be able to read it"
    assert not _granted(resp), "brotto.dev may read GET /v1/sessions"


def test_the_marketing_origin_cannot_read_a_transcript(client):
    sid = client.post("/v1/sessions").json()["session_id"]
    resp = client.get(f"/v1/sessions/{sid}/audit", headers={"Origin": WAITLIST_ORIGIN})
    assert not _granted(resp), "brotto.dev may read somebody's transcript"
    assert not _preflight(client, WAITLIST_ORIGIN, f"/v1/sessions/{sid}/audit").headers.get(
        "access-control-allow-origin"
    )


def test_the_marketing_origin_cannot_delete_a_transcript(client):
    """A preflight that is refused is not a request that was never sent, so
    this is asserted at both layers."""
    sid = client.post("/v1/sessions").json()["session_id"]
    assert not _granted(
        client.delete(f"/v1/sessions/{sid}", headers={"Origin": WAITLIST_ORIGIN})
    ), "brotto.dev may delete a session"
    assert not _granted(_preflight(client, WAITLIST_ORIGIN, f"/v1/sessions/{sid}", "DELETE"))


def test_the_pages_host_is_scoped_the_same_way(client):
    """Two spellings of one site, and both are outside the transcript routes."""
    assert not _granted(client.get("/v1/sessions", headers={"Origin": PAGES_ORIGIN}))


def test_the_session_routes_keep_the_extension_and_loopback(client):
    """Reverted, not removed: the extension and the dev panel are still the
    legitimate clients of every route."""
    origin = "chrome-extension://" + "a" * 32
    assert _granted(client.get("/v1/sessions", headers={"Origin": origin}))
    assert _granted(client.get("/v1/sessions", headers={"Origin": "http://localhost:8000"}))


def test_an_unlisted_origin_is_refused_everywhere(client):
    for origin in (STRANGER, "https://brotto.dev.attacker.example", "http://brotto.dev"):
        assert not _granted(client.get("/v1/sessions", headers={"Origin": origin})), origin
        assert not _granted(client.post("/v1/waitlist", json={}, headers={"Origin": origin})), origin


# ── the waitlist, which is the reason the sub-app exists ───────────────────

def test_the_waitlist_url_is_the_one_the_form_already_posts_to(client):
    """`app.mount("/v1/waitlist", …)` compiles to `^/v1/waitlist/(?P<path>.*)$`,
    which this URL does not match — it 307s. The form is written against the
    exact path, so this is a live question and not a style one."""
    resp = client.post("/v1/waitlist", json={"email": "visitor@example.test"})
    assert resp.status_code in (200, 404, 429), resp.status_code
    assert "location" not in resp.headers, "a redirect means the marketing form breaks"


def test_the_waitlist_origin_is_allowed_to_post_the_form(client, monkeypatch):
    from brotto_orchestrator.session import waitlist as wl

    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret-for-tests")
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    assert wl.waitlist_enabled()

    seen = []

    async def fake_add(email):
        seen.append(email)
        return wl.Signup.CREATED

    monkeypatch.setattr(wl, "add", fake_add)
    resp = client.post(
        "/v1/waitlist", json={"email": "visitor@example.test"},
        headers={"Origin": WAITLIST_ORIGIN},
    )
    assert resp.status_code == 200
    assert seen == ["visitor@example.test"]
    assert resp.headers.get("access-control-allow-origin") == WAITLIST_ORIGIN


def test_the_form_survives_its_preflight(client):
    """The failure this shape invites, and the one that ships silently.

    The parent's CORS middleware wraps the whole app, so it answers the
    waitlist's preflight before the sub-app sees it — with a 400, because the
    marketing origins are correctly absent from the parent's allowlist. The
    form then never submits, in every browser, and the route still looks
    fine to `curl`.
    """
    resp = client.options(
        "/v1/waitlist",
        headers={
            "Origin": WAITLIST_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("access-control-allow-origin") == WAITLIST_ORIGIN


def test_the_waitlist_sub_app_does_not_lend_its_cors_to_anything_else(client):
    """The sub-app is mounted at `/v1`, so the question it has to keep
    answering is whether it swallowed its siblings."""
    for path in ("/v1/sessions", "/v1/reports", "/v1/suggestions"):
        assert not _granted(client.post(path, json={}, headers={"Origin": WAITLIST_ORIGIN})), path


def test_the_waitlist_still_answers_the_same_everyway(client, monkeypatch):
    """Kept by the move: a duplicate is a 409 the route reads as success, so
    the two outcomes cannot be told apart by anyone with the URL.

    The stubs differ now, which is the point — `add` reports which one happened
    so the confirmation mail goes to a first signup only, and the route maps
    both onto one answer."""
    from brotto_orchestrator.session import waitlist as wl

    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret-for-tests")
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(wl, "add", _always(wl, wl.Signup.CREATED))
    first = client.post("/v1/waitlist", json={"email": "visitor@example.test"})
    monkeypatch.setattr(wl, "add", _always(wl, wl.Signup.DUPLICATE))
    second = client.post("/v1/waitlist", json={"email": "visitor@example.test"})
    assert (first.status_code, first.content) == (second.status_code, second.content)


def _always(wl, value):
    async def add(email):
        return value

    return add


def test_a_self_host_has_no_waitlist_and_the_move_did_not_change_that(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    resp = client.post("/v1/waitlist", json={"email": "visitor@example.test"})
    assert resp.status_code == 404
    assert resp.json()["error"] == "not found", "a route that does nothing is not the same as one that does not exist"