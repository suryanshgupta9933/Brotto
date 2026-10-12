"""The waitlist confirmation: a mail, and four ways it must not become one.

The load-bearing test is `test_a_duplicate_is_answered_identically_and_sends_nothing`.
The route used to answer one way for a new address and one for a known one, and
that is a directory of strangers' inbox membership on a public URL. A
confirmation email makes the temptation worse — the two outcomes now differ in
*whether a third party was called at all* — so the distinction has to be made
inside the process and nowhere else. The send is a background task, so the two
answers do not differ in how long they take either.

Everything else here is that rule from other sides: no key sends nothing, a 500
from Resend changes nothing the visitor can see, a broken writing page drops the
card and not the mail, and a blog title we do not control is escaped at the
moment it becomes markup.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

VISITOR = "visitor@example.test"
KEY = "re_test_key"

POST_PAGE = """
<ul class="post-list">
  <li>
    <a href="/blog/2026-10-09-twenty-tabs-one-sentence.html">Twenty tabs, one sentence</a>
    <span class="post-when">2026-10-09</span>
    <span class="post-stand">Why cloud browser agents ask for your passwords, and what it
    looks like to drive the tab you are already signed into.</span>
  </li>
</ul>"""


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret-for-tests")
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def _no_mail_by_default(monkeypatch):
    """No key unless a test asks for one, and an empty limiter around each test.

    Resolved inside the fixture because `test_failure_modes` purges
    `brotto_orchestrator` from `sys.modules` and re-imports it, so a
    module-level alias would name the pre-purge module.
    """
    from brotto_orchestrator import main as fresh

    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("RESEND_FROM", raising=False)
    fresh._SIGNIN_BUCKETS.clear()
    fresh._SIGNIN_SWEEP_AT = 0.0
    yield
    fresh._SIGNIN_BUCKETS.clear()
    fresh._SIGNIN_SWEEP_AT = 0.0


@pytest.fixture
def supabase(monkeypatch):
    """Stub the one PostgREST seam. `.rows` is what was written, `.at` the status."""
    from brotto_orchestrator.session import jwt_auth as fresh_jwt

    class _Stub:
        rows: list = []
        status = 201

        async def __call__(self, method, query, body=None, *, path="rest/v1/profiles"):
            _Stub.rows.append({"method": method, "body": body, "path": path})
            return _Stub.status, json.dumps(body or {})

    _Stub.rows = []
    monkeypatch.setattr(fresh_jwt, "_profiles", _Stub())
    return _Stub


@pytest.fixture
def sent(monkeypatch):
    """A key, and a capture of every payload that would have gone to Resend."""
    from brotto_orchestrator.session import waitlist_email as we

    calls: list = []

    async def fake_deliver(email, post):
        calls.append({"email": email, "post": post, "payload": we.payload(email, post)})
        return 200

    async def no_post():
        return None

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "_deliver", fake_deliver)
    monkeypatch.setattr(we, "latest_post", no_post)
    return calls


# ── dormant ───────────────────────────────────────────────────────────────

def test_no_key_sends_nothing_and_the_route_still_answers(hosted, client, supabase, monkeypatch):
    """A self-hosted box has no key, so it must attempt nothing at all."""
    from brotto_orchestrator.session import waitlist_email as we

    def _boom(*a, **kw):
        raise AssertionError("a self-hosted install must not open a socket")

    assert we.enabled() is False
    monkeypatch.setattr(we, "_deliver", _boom)
    monkeypatch.setattr(we, "latest_post", _boom)

    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert supabase.rows, "the row is still written — the mail is the optional part"


# ── the send ──────────────────────────────────────────────────────────────

def test_a_new_address_gets_exactly_one_confirmation(hosted, client, supabase, sent):
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(sent) == 1
    assert sent[0]["email"] == VISITOR
    assert sent[0]["payload"]["to"] == [VISITOR]


def test_the_mark_is_an_inline_attachment_the_html_can_resolve():
    """A `cid:` with nothing behind it is the broken-image box this avoids."""
    from brotto_orchestrator.session import waitlist_email as we

    body = we.payload(VISITOR, None)
    attachments = body["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["content_id"] == we.MARK_CID
    assert attachments[0]["content"], "the mark must actually be there, not a name"
    assert f"cid:{we.MARK_CID}" in body["html"]
    assert 'alt=""' in body["html"], "a blocked image must degrade to the wordmark"
    assert "Brotto</td>" in body["html"], "the name is beside the mark, not replaced by it"
    # A remote src is the failure this design exists to avoid: Gmail holds it
    # until a human clicks, and the masthead becomes a broken-image box.
    assert 'src="http' not in body["html"]
    assert "border-radius" not in body["html"], "square corners throughout"


def test_headers_are_an_array_of_pairs_with_the_unsubscribe_on_them():
    """An object here sends a mail with no unsubscribe on it, and no error."""
    from brotto_orchestrator.session import waitlist_email as we

    body = we.payload(VISITOR, None)
    assert isinstance(body["headers"], list)
    assert all(set(h) == {"name", "value"} for h in body["headers"])
    values = {h["name"]: h["value"] for h in body["headers"]}
    assert values["List-Unsubscribe"] == "<mailto:hello@brotto.dev?subject=unsubscribe>"
    # No one-click endpoint exists, so advertising one would 404.
    assert "List-Unsubscribe-Post" not in values
    assert body["reply_to"] == "hello@brotto.dev"


def test_reply_to_and_unsubscribe_follow_the_configured_sender(monkeypatch):
    from brotto_orchestrator.session import waitlist_email as we

    monkeypatch.setenv("RESEND_FROM", "Brotto Beta <beta@example.test>")
    body = we.payload(VISITOR, None)
    assert body["from"] == "Brotto Beta <beta@example.test>"
    assert body["reply_to"] == "beta@example.test"
    assert body["headers"][0]["value"] == "<mailto:beta@example.test?subject=unsubscribe>"


# ── the oracle ────────────────────────────────────────────────────────────

def test_a_duplicate_is_answered_identically_and_sends_nothing(hosted, client, supabase, sent):
    """The pin. Same bytes, same status, and no third party is called.

    Byte-identical rather than merely equal-as-JSON, because a body that differs
    in key order is a body that differs.
    """
    supabase.status = 201
    fresh = client.post("/v1/waitlist", json={"email": VISITOR})
    supabase.status = 409
    repeat = client.post("/v1/waitlist", json={"email": VISITOR})

    assert repeat.status_code == fresh.status_code == 200
    assert repeat.content == fresh.content == b'{"ok":true}'
    assert len(sent) == 1, "a repeat submit must not mail the same person again"
    assert sent[0]["email"] == VISITOR
    # Both attempts reached the table and the *schema* stopped the second one —
    # not this module, and not a header at the mail API. The 409 the stub
    # returns is what `email unique` produces, so the guarantee being relied on
    # is the constraint, and it is visible here in the write that was refused.
    assert [r["method"] for r in supabase.rows] == ["POST", "POST"]
    assert [r["body"]["email"] for r in supabase.rows] == [VISITOR, VISITOR]


def test_a_deleted_row_that_comes_back_is_mailed_again(hosted, client, supabase, sent):
    """The regression the header caused, measured on the wire.

    An operator who clears a row and re-adds the same address is doing a
    **new** signup: a new row, a send that is owed. Under the old
    `Idempotency-Key` — hashed from the address, and Resend holds one for 24
    hours — Resend answered `409 invalid_idempotent_request` and the mail was
    silently dropped while the signup returned `200 {"ok":true}`.

    Nothing here can distinguish that from the shape above except the insert, so
    this is the same path with a different database history: no unique-constraint
    refusal between the two submissions, therefore two sends.
    """
    supabase.status = 201
    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 200
    assert len(sent) == 1

    # The row is gone. Same address, same route, no 409 in between.
    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 200
    assert len(sent) == 2, "a genuinely new row must still get its confirmation"
    assert [s["email"] for s in sent] == [VISITOR, VISITOR]


async def test_the_response_is_sent_before_the_mail_is_attempted(hosted, supabase, monkeypatch):
    """The two answers must not differ in time either — a slow path is an oracle.

    Awaiting the send inside the route would answer a duplicate in 10ms and a
    new address in however long Resend and the writing page take, which is the
    same membership oracle as a different body. So the send is a background
    task, and this drives the ASGI protocol directly — the only level at which
    "the response has gone out" is observable at all, since both `TestClient`
    and `ASGITransport` wait for the app to *return*. Resend is held on a gate
    this test owns, and the 200 has to reach the wire before that gate opens.
    """
    import asyncio

    from brotto_orchestrator.main import app
    from brotto_orchestrator.session import waitlist_email as we

    gate = asyncio.Event()
    on_the_wire = asyncio.Event()
    body = json.dumps({"email": VISITOR}).encode()

    async def gated_deliver(email, post):
        await gate.wait()
        return 200

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", _none)
    monkeypatch.setattr(we, "_deliver", gated_deliver)

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        if message["type"] == "http.response.body" and message.get("body"):
            on_the_wire.set()

    call = asyncio.create_task(app(
        {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "path": "/v1/waitlist", "raw_path": b"/v1/waitlist",
            "query_string": b"", "root_path": "", "scheme": "http",
            "headers": [(b"host", b"relay.test"),
                        (b"content-type", b"application/json")],
            "client": ("198.51.100.1", 4321), "server": ("relay.test", 80),
        },
        receive, send,
    ))
    # Red against an inline `await send_confirmation(...)`: the body cannot be
    # written until the gate opens, and the gate is this test's to open.
    await asyncio.wait_for(on_the_wire.wait(), timeout=2)
    gate.set()
    await asyncio.wait_for(call, timeout=2)


# ── failure never reaches the visitor ─────────────────────────────────────

def test_a_resend_error_leaves_the_response_and_the_row_alone(hosted, client, supabase, monkeypatch):
    """The row is written before the mail is attempted, and nothing here rolls
    it back — there is no rollback path in this feature, by design."""
    from brotto_orchestrator.session import waitlist_email as we

    async def refusing(email, post):
        return 500

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", lambda: _none())
    monkeypatch.setattr(we, "_deliver", refusing)

    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert [r["body"] for r in supabase.rows] == [{"email": VISITOR, "name": "", "batch": ""}]


def test_a_transport_exception_is_swallowed(hosted, client, supabase, monkeypatch):
    from brotto_orchestrator.session import waitlist_email as we

    async def boom(email, post):
        raise OSError(f"POST https://api.resend.com failed for {VISITOR}")

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", lambda: _none())
    monkeypatch.setattr(we, "_deliver", boom)

    assert client.post("/v1/waitlist", json={"email": VISITOR}).status_code == 200
    assert [r["body"] for r in supabase.rows] == [{"email": VISITOR, "name": "", "batch": ""}]


async def test_an_exception_the_enumeration_never_imagined_is_swallowed_too(
    monkeypatch, caplog
):
    """The pin on the whole-body `try`, not just on the transport's.

    `latest_post` catches three types it thought of. Anything else — a resolver
    error, an `AttributeError` in the parsing, a `CancelledError` from a client
    teardown — used to escape into a background task whose response is already
    on the wire. Red the moment the `try` stops spanning the fetch, which is
    where it used to start.
    """
    from brotto_orchestrator.session import waitlist_email as we

    async def exotic():
        raise ValueError(f"no resolver for brotto.dev ({VISITOR})")

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", exotic)
    with caplog.at_level("WARNING"):
        await we.send_confirmation(VISITOR)  # returns; does not raise

    assert "ValueError" in caplog.text, "the type is what crosses into the log"
    assert VISITOR not in caplog.text


def test_a_transport_exception_never_writes_the_address_to_the_log(
    hosted, client, supabase, monkeypatch, caplog
):
    from brotto_orchestrator.session import waitlist_email as we

    async def boom(email, post):
        raise OSError(f"POST https://api.resend.com failed for {VISITOR}")

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", lambda: _none())
    monkeypatch.setattr(we, "_deliver", boom)
    with caplog.at_level("WARNING"):
        client.post("/v1/waitlist", json={"email": VISITOR})
    assert VISITOR not in caplog.text


# ── the card ──────────────────────────────────────────────────────────────

async def test_the_newest_post_is_read_from_the_writing_page(monkeypatch):
    from brotto_orchestrator.session import waitlist_email as we

    monkeypatch.setattr(we.aiohttp, "ClientSession", lambda *a, **kw: _Response(POST_PAGE, 200))
    post = await we.latest_post()
    assert post["title"] == "Twenty tabs, one sentence"
    assert post["url"] == "https://brotto.dev/blog/2026-10-09-twenty-tabs-one-sentence.html"
    assert post["stand"].startswith("Why cloud browser agents ask for your passwords")
    assert "\n" not in post["stand"], "the standfirst is one line"


@pytest.mark.parametrize("page,status", [
    ("<main><h1>Writing</h1><p>no list yet</p></main>", 200),
    (POST_PAGE, 404),
    ("", 200),
])
async def test_a_broken_writing_page_yields_no_post_at_all(monkeypatch, page, status):
    """Any failure is a missing card. Never a raise, never a retry."""
    from brotto_orchestrator.session import waitlist_email as we

    monkeypatch.setattr(we.aiohttp, "ClientSession", lambda *a, **kw: _Response(page, status))
    assert await we.latest_post() is None


def test_a_missing_card_drops_the_block_and_not_the_mail(hosted, client, supabase, sent):
    resp = client.post("/v1/waitlist", json={"email": VISITOR})
    assert resp.status_code == 200
    assert len(sent) == 1, "a missing card is not a missing email"
    html = sent[0]["payload"]["html"]
    assert "Meanwhile, the long version" not in html
    assert "On the list" in html


def test_a_present_card_is_rendered(hosted, client, supabase, monkeypatch):
    from brotto_orchestrator.session import waitlist_email as we

    sent = []

    async def fake_deliver(email, post):
        sent.append(we.payload(email, post))
        return 200

    async def one_post():
        return {"title": "Twenty tabs, one sentence",
                "stand": "Why cloud browser agents ask for your passwords.",
                "url": "https://brotto.dev/blog/2026-10-09-twenty-tabs-one-sentence.html"}

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", one_post)
    monkeypatch.setattr(we, "_deliver", fake_deliver)

    client.post("/v1/waitlist", json={"email": VISITOR})
    html = sent[0]["html"]
    assert "Meanwhile, the long version" in html
    assert "https://brotto.dev/blog/2026-10-09-twenty-tabs-one-sentence.html" in html
    assert "Twenty tabs, one sentence" in html


# ── untrusted input ───────────────────────────────────────────────────────

def test_markup_in_the_blog_title_never_reaches_the_body_as_markup():
    from brotto_orchestrator.session import waitlist_email as we

    hostile = {
        "title": '</a><script>alert(1)</script><a href="https://evil.test">',
        "stand": "<img src=x onerror=alert(2)>",
        "url": "https://brotto.dev/blog/2026-10-09-twenty-tabs-one-sentence.html",
    }
    body = we.payload(VISITOR, hostile)
    # The payload text still contains `onerror=` — what must not survive is the
    # `<` that would make it an attribute rather than prose.
    assert "<script>" not in body["html"]
    assert "<img src=x" not in body["html"]
    assert "&lt;script&gt;" in body["html"], "escaped, not dropped"
    assert "&lt;img src=x onerror=alert(2)&gt;" in body["html"]
    assert "<script>" not in body["text"], "the plain part is not markup at all"


def test_the_address_is_never_interpolated_into_a_body():
    """The approved design names nobody's address; only `to` carries it.

    `render` takes no address at all — a dead `del email` parameter is a
    signature that lies about what it reads, and this is the assertion that
    keeps the copy honest: the greeting can only be added by widening the
    signature, and the signature is what this pins.
    """
    import inspect

    from brotto_orchestrator.session import waitlist_email as we

    assert list(inspect.signature(we.render).parameters) == ["post"]
    html, text = we.render(None)
    assert VISITOR not in html
    assert VISITOR not in text

    hostile = '"><script>alert(1)</script>@example.test'
    body = we.payload(hostile, None)
    assert body["to"] == [hostile], "the address reaches Resend in `to`"
    assert VISITOR not in body["html"]
    assert hostile not in body["html"]
    assert hostile not in body["text"]


def test_the_check_mark_is_a_character_and_not_an_entity():
    """Gmail does not know `&check;`, so it escapes the `&` and the reader sees
    the characters. The document declares utf-8 and Resend sends utf-8, so the
    mark ships as U+2713. Asserted on the output we generate, which is why
    `&check;` is a valid substring check here — nothing escapes it on the way
    out, and `&amp;check;` would still fail the `in` half below.
    """
    from brotto_orchestrator.session import waitlist_email as we

    html, _ = we.render(None)
    assert "✓" in html, "the mark must be the character, not markup"
    assert "&check;" not in html


def test_the_subject_is_the_approved_line():
    """Signed off as a whole; `Cloud` is what tells it apart from other mail."""
    from brotto_orchestrator.session import waitlist_email as we

    assert we.SUBJECT == "You're on the Brotto Cloud list"
    assert we.payload(VISITOR, None)["subject"] == we.SUBJECT


async def test_the_request_carries_no_idempotency_key(monkeypatch):
    """The header is gone, and this is what stops it coming back.

    There used to be an `Idempotency-Key` hashed from the address, which made a
    *legitimately* new signup for someone mailed in the last 24 hours fail
    silently as a `409 invalid_idempotent_request` — a second row, a second send
    that was owed, and no mail. It protected against nothing: `waitlist.email` is
    `UNIQUE`, so one address is one row is one send. Asserted on the headers
    `_deliver` actually puts on the wire, not on the absence of a function.
    """
    from brotto_orchestrator.session import waitlist_email as we

    captured = {}

    class _Session:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def post(self, url, **kw):
            captured.update(kw.get("headers") or {})
            raise _Sent()

    class _Sent(Exception):
        pass

    async def no_post():
        return None

    monkeypatch.setenv("RESEND_API_KEY", KEY)
    monkeypatch.setattr(we, "latest_post", no_post)
    monkeypatch.setattr(we.aiohttp, "ClientSession", _Session)

    with pytest.raises(_Sent):
        await we._deliver(VISITOR, None)

    assert captured, "the POST must still carry its auth and content type"
    assert captured["Authorization"] == f"Bearer {KEY}"
    assert "Idempotency-Key" not in captured
    assert not hasattr(we, "idempotency_key"), "the key builder goes with the header"


# ── helpers ───────────────────────────────────────────────────────────────

async def _none():
    return None


class _Response:
    """The two things `latest_post` reads off a response, and nothing else."""

    def __init__(self, body: str, status: int):
        self.status = status
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def text(self):
        return self._body

    def get(self, *a, **kw):
        return self