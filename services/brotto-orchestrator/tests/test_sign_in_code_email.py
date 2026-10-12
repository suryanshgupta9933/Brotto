"""The sign-in code mail, written by us instead of by Supabase.

Same shape as `test_beta_invite.py`, and for the same reason: the two things
that can quietly break here are a *field* Resend silently ignores and a
`cid:` with no bytes behind it. A third one is unique to this mail — the
address must reach Resend in `to` and nowhere else, because the payload is
not the place to be thorough.

The code is the point of the mail, so both renderings carry it and it is the
largest thing in the body. There is deliberately no link to click: a sign-in
code with a link in it teaches the reader to click links in mail that claim
to be about their account.
"""
from __future__ import annotations

import json
import re

from brotto_orchestrator.session import sign_in_code_email, waitlist_email

CODE = "482913"
ADDR = "someone@example.test"


def test_both_renderings_carry_the_code():
    html, text = sign_in_code_email.render(CODE)
    assert CODE in html
    assert CODE in text


def test_the_code_is_the_largest_thing_in_the_body():
    html, _ = sign_in_code_email.render(CODE)
    sizes = [int(n) for n in re.findall(r"font-size:(\d+)px", html)]
    assert sizes, "no font sizes found"
    # The code block is set at 56px; nothing else comes close.
    assert max(sizes) >= 56
    # Twice on purpose: a hidden preview strip (so the client's snippet is
    # the code) and the 56px block the reader is meant to read.
    assert html.count(f">{CODE}<") == 2


def test_no_link_to_click():
    """A sign-in code with a link teaches the reader to click links in mail
    about their account. The footer's site/privacy links are not the mail's
    call to action; anything in the body would be."""
    html, text = sign_in_code_email.render(CODE)
    body = html.split("Your sign-in code</h1>")[1].split("border-top")[0]
    assert 'href="' not in body
    assert "http" not in text.split("Unsubscribe")[0]


def test_the_address_reaches_resend_in_to_and_nowhere_else():
    payload = sign_in_code_email.payload(ADDR, CODE)
    assert payload["to"] == [ADDR]
    rest = json.dumps({k: v for k, v in payload.items() if k != "to"})
    assert ADDR not in rest
    assert "someone" not in rest


def test_headers_is_the_array_resend_actually_accepts():
    payload = sign_in_code_email.payload(ADDR, CODE)
    assert isinstance(payload["headers"], list)
    assert all(set(h) == {"name", "value"} for h in payload["headers"])


def test_a_cid_in_the_markup_has_an_attachment_behind_it(monkeypatch):
    monkeypatch.setattr(waitlist_email, "_mark", lambda: b"\x89PNG-bytes")
    payload = sign_in_code_email.payload(ADDR, CODE)
    assert f"cid:{sign_in_code_email.MARK_CID}" in payload["html"]
    assert [a["content_id"] for a in payload["attachments"]] == [
        sign_in_code_email.MARK_CID
    ]


def test_no_attachment_entry_when_there_is_no_mark(monkeypatch):
    monkeypatch.setattr(waitlist_email, "_mark", lambda: None)
    payload = sign_in_code_email.payload(ADDR, CODE)
    assert payload["attachments"] == []
    assert "cid:" not in payload["html"]


def test_no_idempotency_key():
    """A key hashed from the address refuses a second code for the same inbox
    for 24 hours — and "send another" is the one thing a person who mistyped
    is told to do. Same rule as `waitlist_email`."""
    payload = sign_in_code_email.payload(ADDR, CODE)
    assert "idempotency" not in json.dumps(payload).lower()


def test_a_send_failure_never_raises(monkeypatch):
    """The code row is already written and the HTTP answer already decided;
    a transport exception quoting the payload must not reach the request."""
    import asyncio

    async def boom(email, code):
        raise RuntimeError(f"connection reset while sending to {email}")

    monkeypatch.setattr(sign_in_code_email, "enabled", lambda: True)
    monkeypatch.setattr(sign_in_code_email, "_deliver", boom)
    asyncio.run(sign_in_code_email.send_code(ADDR, CODE))  # must not raise


def test_no_test_can_open_a_real_socket(monkeypatch):
    """The wall in `conftest._no_real_http`, pinned.

    A real `RESEND_API_KEY` in the developer's `.env` reached this suite
    through `main.py`'s `load_dotenv()` and every unstubbed send in the run
    posted to Resend for real. Clearing the key is the root cause; this is
    what stops a test that sets its own key and forgets to stub `_deliver`.
    """
    import aiohttp

    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    try:
        aiohttp.ClientSession()
    except AssertionError as exc:
        assert "stub the seam" in str(exc)
    else:
        raise AssertionError("the suite opened a real HTTP session")
