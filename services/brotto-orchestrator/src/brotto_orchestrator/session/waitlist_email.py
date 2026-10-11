"""The waitlist confirmation: one transactional email, sent through Resend.

**Resend is a third party in the data path for waitlist addresses, and for
nothing else in this project.** An account's identity is Supabase's; a
waitlist address additionally crosses Resend's API and lands in its logs, which
is why the address is never written to a log line here and never appears in an
idempotency key — only a hash of it does.

Three rules hold this module together, and each one is a way the feature can
quietly become a liability:

- **A send failure never fails the signup.** The row is written before this is
  called, and it stays written whatever happens here. Every path that is not an
  outright success ends in a `return`, and the only thing that crosses into a
  log is the exception's TYPE — a transport error can quote the payload, and the
  payload is the address.
- **No key, no send.** `RESEND_API_KEY` unset is not a degraded mode, it is the
  mode a self-hosted box is always in: the route must behave exactly as it did
  before this module existed.
- **Only a first signup sends** (`waitlist.Signup.CREATED`), and the caller
  answers the visitor before this runs.

**The blog card is fetched at send time and is optional in the strict sense** —
a timeout, a non-200, a page that no longer has the shape below, all mean the
mail goes out without the card. It is never retried and never raised: a
confirmation is worth more than its illustration.

**The mark is an inline CID attachment, not a URL.** Gmail blocks remote images
until a human clicks, which would put a broken box in the masthead. Resend's own
docs make the attachment carry `content_id` and the HTML reference `cid:`; there
is no `disposition` field to set, and adding one the API does not document is
how a send silently becomes a 422.

The body is a port of a reviewed HTML file, not a template — the markup is
inline, square, and image-free apart from the mark, and the plain-text part is
written by hand to say the same thing.
"""

from __future__ import annotations

import asyncio
import base64
import functools
import hashlib
import html as html_lib
import logging
import os
import re
from pathlib import Path

import aiohttp

log = logging.getLogger("brotto.waitlist_email")

#: The whole reason this module is dormant on a self-hosted box.
API_KEY_ENV = "RESEND_API_KEY"
FROM_ENV = "RESEND_FROM"
DEFAULT_FROM = "Brotto <hello@brotto.dev>"

ENDPOINT = "https://api.resend.com/emails"
WRITING_URL = "https://brotto.dev/writing"
SITE = "https://brotto.dev"

#: Long enough for a slow TLS handshake on a cold dyno, short enough that a
#: stuck third party is not a stuck signup.
SEND_TIMEOUT_SECONDS = 10
#: The card is an illustration. Three seconds is what it gets.
FETCH_TIMEOUT_SECONDS = 3

#: The CID the HTML references and the attachment publishes.
MARK_CID = "brotto-mark"
_MARK_PATH = Path(__file__).with_name("brotto-mark.png")

#: Approved copy, signed off as a whole. "Cloud" is what tells this mail apart
#: from anything else Brotto might send later — it is not decoration, and it is
#: not the eyebrow.
SUBJECT = "You're on the Brotto Cloud list"

_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"

# ponytail: four regexes against one known static page. The honest ceiling is
# that a rewrite of brotto.dev/writing silently drops the card out of the email
# rather than sending the wrong post; if posts ever arrive from a generator with
# markup in a title, this is the line that stops being enough.
_LIST_RE = re.compile(r'<ul class="post-list">(.*?)</ul>', re.S)
_ITEM_RE = re.compile(r"<li>(.*?)</li>", re.S)
_LINK_RE = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_STAND_RE = re.compile(r'<span class="post-stand">(.*?)</span>', re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_ADDRESS_RE = re.compile(r"<([^>]+)>")


def enabled() -> bool:
    """Whether a send would be attempted at all."""
    return bool(os.getenv(API_KEY_ENV, "").strip())


def from_address() -> str:
    """The `From` header, and the source of `reply_to` and `List-Unsubscribe`."""
    return os.getenv(FROM_ENV, "").strip() or DEFAULT_FROM


def mailbox(value: str) -> str:
    """The bare address inside `Brotto <hello@brotto.dev>`."""
    found = _ADDRESS_RE.search(value)
    return (found.group(1) if found else value).strip()


def idempotency_key(email: str) -> str:
    """A stable key per address, and **not** the address.

    Resend keeps the key for 24 hours, so a retried send of the same signup
    does not mail twice. It is a hash because a key is still a request field on
    their side, and the address is the one field this project does not hand to
    anyone but Supabase.
    """
    digest = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return f"waitlist-confirm/{digest[:32]}"


def _esc(value: str) -> str:
    """Escape at the string-into-markup boundary.

    Defence in depth, not validation: `EMAIL_RE` has already rejected anything
    exotic, and the blog title arrives from a remote page we do not control.
    """
    return html_lib.escape(value, quote=True)


def _text(markup: str) -> str:
    """The visible text of a fragment, on one line."""
    return " ".join(html_lib.unescape(_TAG_RE.sub("", markup)).split())


@functools.lru_cache(maxsize=1)
def _mark() -> str | None:
    """The base64 PNG, or `None` if this install has no mark.

    `None` omits the image from the masthead rather than emitting a `cid:` that
    resolves to nothing — the wordmark is beside it, so the degradation is a
    gap and the name, never a broken-image icon. `brotto-mark.png` lives inside
    the package (and `pyproject.toml` ships it) because the extension's
    `dist/icons/` is a build artifact that is gitignored and absent from the
    image.
    """
    try:
        return base64.b64encode(_MARK_PATH.read_bytes()).decode("ascii")
    except OSError:
        log.warning("waitlist email: mark not found — sending without it")
        return None


async def latest_post() -> dict | None:
    """The newest post, as `{title, stand, url}`, or `None`.

    One fetch, one `<li>`: the writing page is already the index and is already
    newest-first, so there is no feed to build and no sitemap to read. Every
    failure is a `None`, because the alternative is an email nobody gets.
    """
    timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(WRITING_URL) as resp:
                if resp.status != 200:
                    return None
                page = await resp.text()
    except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError) as exc:
        log.warning("waitlist email: writing page unavailable (%s)", type(exc).__name__)
        return None

    listing = _LIST_RE.search(page)
    item = _ITEM_RE.search(listing.group(1)) if listing else None
    if not item:
        return None
    link = _LINK_RE.search(item.group(1))
    stand = _STAND_RE.search(item.group(1))
    if not link:
        return None
    href, title = link.group(1), _text(link.group(2))
    if not title:
        return None
    return {
        "title": title,
        "stand": _text(stand.group(1)) if stand else "",
        "url": href if href.startswith(("http://", "https://")) else f"{SITE}{href}",
    }


def render(post: dict | None) -> tuple[str, str]:
    """The HTML and the plain text. Both say the same thing.

    No address argument, because the approved design names nobody's address: the
    wordmark is the name, and adding a greeting would be copy nobody wrote. The
    address reaches Resend in `to` and nowhere else.
    """
    mark = _mark()
    masthead = (
        f'<td style="vertical-align:middle;"><img src="cid:{MARK_CID}" width="22" '
        'height="22" alt="" style="width:22px;height:22px;border:0;display:block;"></td>'
        "\n    "
        '<td style="padding-left:10px;vertical-align:middle;'
        f'font-family:{_FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;'
        'color:#000000;">Brotto</td>'
        if mark
        else (
            '<td style="vertical-align:middle;'
            f'font-family:{_FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;'
            'color:#000000;">Brotto</td>'
        )
    )

    card_html = ""
    card_text = ""
    if post:
        url = _esc(post["url"])
        title = _esc(post["title"])
        stand = _esc(post["stand"])
        card_html = (
            '<tr><td style="padding:28px 0 0;">\n'
            '  <table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            'style="background:#F5F5F5;border:1px solid #E5E5E5;width:100%;">\n'
            '    <tr><td style="padding:20px 20px 18px;">\n'
            '      <p style="margin:0 0 12px;font-family:' + _FONT + ';font-size:12px;'
            'line-height:1.2;color:#6E6E6E;letter-spacing:0.06em;text-transform:uppercase;">'
            "Meanwhile, the long version</p>\n"
            '      <p style="margin:0 0 8px;font-family:' + _FONT + ';font-size:19px;'
            'line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:#000000;">'
            f'<a href="{url}" style="color:#000000;text-decoration:none;">{title}</a></p>\n'
            '      <p style="margin:0 0 16px;font-family:' + _FONT + ';font-size:15px;'
            f'line-height:1.6;color:#5C5C5C;">{stand}</p>\n'
            '      <p style="margin:0;font-family:' + _FONT + ';font-size:15px;line-height:1.6;">'
            f'<a href="{url}" style="color:#000000;text-decoration:underline;">Read it&nbsp;&rarr;</a></p>\n'
            "    </td></tr>\n  </table>\n</td></tr>\n"
        )
        card_text = (
            "\nMEANWHILE, THE LONG VERSION\n\n"
            # `_text`, not `_esc`: escaping in a plain-text part would show the
            # reader `&lt;script&gt;`, and a part no renderer parses has no
            # business carrying markup at all. The parser already strips it;
            # this is the same strip at the boundary.
            f"{_text(post['title'])}\n{_text(post['stand'])}\n"
            f"Read it -> {_text(post['url'])}\n"
        )

    body = (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8">'
        "<title>Brotto — waitlist confirmation</title></head>\n"
        '<body style="margin:0;padding:0;background:#FFFFFF;">\n'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        "Brotto Cloud is opening, a few people at a time.</div>\n"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#FFFFFF;">\n'
        '<tr><td align="center" style="padding:40px 16px;">\n'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:600px;max-width:600px;">\n\n'
        '<tr><td style="padding:0 0 28px;">\n'
        '  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>\n    '
        f"{masthead}\n  </tr></table>\n"
        "</td></tr>\n\n"
        '<tr><td style="border-top:1px solid #000000;font-size:0;line-height:0;">&nbsp;</td></tr>\n\n'
        '<tr><td style="padding:32px 0 0;">\n'
        '  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>\n'
        f'    <td style="font-family:{_FONT};font-size:26px;line-height:1;color:#15803D;">'
        "✓</td>\n"
        f'    <td style="padding-left:14px;font-family:{_FONT};font-size:13px;line-height:1.2;'
        'color:#6E6E6E;letter-spacing:0.06em;text-transform:uppercase;">On the list</td>\n'
        "  </tr></table>\n</td></tr>\n\n"
        '<tr><td style="padding:22px 0 0;">\n'
        f'  <h1 style="margin:0;font-family:{_FONT};font-size:26px;line-height:1.25;'
        'font-weight:600;letter-spacing:-0.02em;color:#000000;">'
        "Brotto Cloud is opening, a few people at a time.</h1>\n</td></tr>\n\n"
        '<tr><td style="padding:18px 0 0;">\n'
        f'  <p style="margin:0;font-family:{_FONT};font-size:17px;line-height:1.65;color:#000000;'
        "max-width:34em;\">It is the same extension, with our server running it instead of "
        "yours. We let people in as we have room.</p>\n</td></tr>\n\n"
        f"{card_html}"
        "\n"
        '<tr><td style="padding:24px 0 0;">\n'
        f'  <p style="margin:0;font-family:{_FONT};font-size:17px;line-height:1.65;color:#000000;'
        f'max-width:34em;">If you would rather not wait, <a href="{SITE}/#try" '
        'style="color:#000000;text-decoration:underline;">install Brotto yourself</a> &mdash; '
        "it is free, permanent, and it is the better version anyway.</p>\n</td></tr>\n\n"
        '<tr><td style="padding:36px 0 0;border-top:1px solid #E5E5E5;">\n'
        f'  <p style="margin:0;font-family:{_FONT};font-size:13px;line-height:1.6;color:#6E6E6E;">'
        "Closed beta, with limits. "
        f'<a href="mailto:{mailbox(from_address())}?subject=unsubscribe" '
        'style="color:#5C5C5C;text-decoration:underline;">Unsubscribe</a> &middot; '
        f'<a href="{SITE}/privacy" style="color:#5C5C5C;text-decoration:underline;">Privacy</a> '
        f'&middot; <a href="{SITE}/security" style="color:#5C5C5C;text-decoration:underline;">'
        f'Security</a> &middot; <a href="{SITE}" style="color:#5C5C5C;text-decoration:underline;">'
        "brotto.dev</a></p>\n</td></tr>\n\n</table>\n</td></tr></table>\n</body></html>"
    )

    plain = (
        "Brotto\n\nON THE LIST\n\n"
        "Brotto Cloud is opening, a few people at a time.\n\n"
        "It is the same extension, with our server running it instead of yours. "
        "We let people in as we have room.\n"
        f"{card_text}\n"
        f"If you would rather not wait, install Brotto yourself — {SITE}/#try — "
        "it is free, permanent, and it is the better version anyway.\n\n"
        "Closed beta, with limits.\n"
        f"Unsubscribe: mailto:{mailbox(from_address())}?subject=unsubscribe\n"
        f"Privacy: {SITE}/privacy\n"
        f"Security: {SITE}/security\n"
        f"{SITE}\n"
    )
    return body, plain


def payload(email: str, post: dict | None) -> dict:
    """The exact JSON body posted to Resend.

    **`headers` is an array of `{name, value}`**, not an object — the mistake
    that sends the mail with no `List-Unsubscribe` on it and no error to notice.
    There is no `List-Unsubscribe-Post`: there is no one-click endpoint, and
    advertising one that 404s is worse than not having it.
    """
    sender = from_address()
    address = mailbox(sender)
    body, plain = render(post)
    mark = _mark()
    return {
        "from": sender,
        "to": [email],
        "subject": SUBJECT,
        "html": body,
        "text": plain,
        "reply_to": address,
        "headers": [
            {
                "name": "List-Unsubscribe",
                "value": f"<mailto:{address}?subject=unsubscribe>",
            }
        ],
        "tags": [{"name": "kind", "value": "waitlist-confirm"}],
        "attachments": [
            {
                "filename": f"{MARK_CID}.png",
                "content": mark,
                "content_id": MARK_CID,
                "content_type": "image/png",
            }
        ] if mark else [],
    }


async def _deliver(email: str, post: dict | None) -> int:
    """One POST to Resend. The status, or a raise — nothing else.

    The seam the tests replace, so no test in the suite touches the network.
    """
    key = os.getenv(API_KEY_ENV, "").strip()
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key(email),
    }
    timeout = aiohttp.ClientTimeout(total=SEND_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(ENDPOINT, json=payload(email, post),
                                headers=headers) as resp:
            return resp.status


async def send_confirmation(email: str) -> None:
    """Mail one confirmation. Never raises, and never blocks the caller.

    Everything below this line is best effort by construction: the row is
    already written, and no outcome here is worth an error response or a
    rollback. That holds *by construction* because one `try` spans the whole
    body — an exception type nobody enumerated is exactly the case this rule is
    about, and it arrives in a background task whose response is already on the
    wire.
    """
    if not enabled():
        return
    try:
        post = await latest_post()
        status = await _deliver(email, post)
    except Exception as exc:  # a bug here must not take the signup with it
        # TYPE only. A transport exception can quote the request body, and the
        # body holds the address.
        log.warning("waitlist confirmation not sent: %s", type(exc).__name__)
        return
    if status >= 400:
        log.warning("waitlist confirmation answered %d", status)