"""The sign-in code, mailed by us instead of by Supabase.

Until now `request_login_code` POSTed to Supabase's `auth/v1/otp` and the
project's own template sent a branded "Confirm your email address" mail with a
**localhost** link in it — a third party's template deciding what a Brotto
sign-in looks like. The relay mints the code now, and this is the mail.

The design language, the escaping and the transport are `waitlist_email`'s,
imported rather than copied. Two people reading the two mails should not be
able to tell they came from different files.

**The code is the point of the mail**, so it is the largest thing in the body
and there is nothing else to look at: no blog card, no marketing, no link to
click. A sign-in code with a link in it teaches the reader to click links in
mail that claim to be about their account.

**The address reaches Resend in `to` and nowhere else**, on the same rule
`waitlist_email` states at length: no greeting, no header, no tag. The payload
is not the place to be thorough.

**A send failure never fails the request.** The code row is already written
when this runs and the HTTP answer has already been decided, so every path
below ends in a `return` and the only thing that crosses into a log is the
exception's TYPE — a transport error can quote the payload, and the payload is
the address.
"""

from __future__ import annotations

import html as html_lib
import logging
import os

import aiohttp

from .waitlist_email import (
    ENDPOINT,
    MARK_CID,
    SEND_TIMEOUT_SECONDS,
    SITE,
    _FONT,
    enabled,
    from_address,
    mailbox,
    mark_attachment,
    unsubscribe_header,
)

log = logging.getLogger("brotto.sign_in_code_email")

#: Names Brotto and says what it is. A subject that only says "Brotto" is a
#: mail a reader files without opening, and one that says "Confirm your email
#: address" is the Supabase wording this module exists to replace.
SUBJECT = "Your Brotto sign-in code"

#: The lifetime `jwt_auth` mints the code with. Stated in the mail because a
#: code the reader finds after it died is a support question, not a code.
TEN_MINUTES = "ten minutes"


def _esc(value: str) -> str:
    return html_lib.escape(value, quote=True)


def _masthead() -> str:
    """The wordmark. Identical to the other mails', mark or no mark.

    Asks `mark_attachment()` rather than `_mark()` for the same yes/no the
    payload asks — two lookups of one condition is how the markup grows a
    `cid:` the attachment list has no bytes for.
    """
    word = (
        f'<td style="vertical-align:middle;font-family:{_FONT};font-size:24px;'
        'font-weight:600;letter-spacing:-0.03em;color:#000000;">Brotto</td>'
    )
    if not mark_attachment():
        return word
    return (
        f'<td style="vertical-align:middle;"><img src="cid:{MARK_CID}" width="22" '
        'height="22" alt="" style="width:22px;height:22px;border:0;display:block;"></td>'
        "\n    "
        f'<td style="padding-left:10px;vertical-align:middle;'
        f'font-family:{_FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;'
        'color:#000000;">Brotto</td>'
    )


def render(code: str) -> tuple[str, str]:
    """The HTML and the plain text. Both carry the code.

    No address argument, for the reason the other two mails have none: the
    wordmark is the name, and the address reaches Resend in `to` and nowhere
    else.
    """
    eyebrow = (
        "font-size:12px;line-height:1;letter-spacing:0.18em;text-transform:uppercase;"
        "color:#6E6E6E;font-weight:500;"
    )
    text = f"font-family:{_FONT};font-size:17px;line-height:1.6;color:#000000;"

    body = (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8">'
        "<title>Brotto &mdash; your sign-in code</title></head>\n"
        '<body style="margin:0;padding:0;background:#FFFFFF;">\n'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        f"{_esc(code)}</div>\n"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#FFFFFF;">\n'
        '<tr><td align="center" style="padding:40px 16px;">\n'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:600px;max-width:600px;">\n\n'
        '<tr><td style="padding:0 0 26px;">\n'
        '  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>\n    '
        f"{_masthead()}\n  </tr></table>\n"
        "</td></tr>\n\n"
        '<tr><td style="border-top:2px solid #000000;font-size:0;line-height:0;">&nbsp;</td></tr>\n\n'
        '<tr><td style="padding:34px 0 0;">\n'
        f'  <p style="margin:0;font-family:{_FONT};{eyebrow}">Sign in to Brotto</p>\n'
        "</td></tr>\n\n"
        '<tr><td style="padding:16px 0 0;">\n'
        f'  <h1 style="margin:0;font-family:{_FONT};font-size:26px;line-height:1.25;'
        'font-weight:600;letter-spacing:-0.02em;color:#000000;">'
        "Your sign-in code</h1>\n</td></tr>\n\n"
        # The code, and it is the largest thing here on purpose: it is the
        # only reason this mail exists, and a reader on a phone should not
        # have to hunt for it.
        '<tr><td style="padding:32px 0 0;">\n'
        '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="border:1px solid #000000;"><tr>\n'
        '    <td align="center" style="padding:34px 0 34px 28px;">\n'
        f'      <p style="margin:0;font-family:{_FONT};font-size:56px;line-height:1;'
        'font-weight:600;letter-spacing:0.12em;color:#000000;">'
        f"{_esc(code)}</p>\n"
        "    </td>\n  </tr></table>\n</td></tr>\n\n"
        '<tr><td style="padding:24px 0 0;">\n'
        f'  <p style="margin:0;{text}max-width:34em;">'
        f"Type this code into Brotto to finish signing in. It works once, and it expires "
        f"in {TEN_MINUTES}.</p>\n</td></tr>\n\n"
        '<tr><td style="padding:14px 0 0;">\n'
        f'  <p style="margin:0;{text}max-width:34em;color:#3D3D3D;">'
        "If you did not ask for this, nothing has happened and you can ignore this mail.</p>\n"
        "</td></tr>\n\n"
        '<tr><td style="padding:36px 0 0;border-top:1px solid #E5E5E5;">\n'
        f'  <p style="margin:0;font-family:{_FONT};font-size:13px;line-height:1.7;color:#6E6E6E;">'
        f'<a href="mailto:{_esc(mailbox(from_address()))}?subject=unsubscribe" '
        'style="color:#5C5C5C;text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; '
        f'<a href="{SITE}/privacy" style="color:#5C5C5C;text-decoration:underline;">Privacy</a>'
        f' &nbsp;&middot;&nbsp; <a href="{SITE}/security" '
        'style="color:#5C5C5C;text-decoration:underline;">Security</a>'
        f' &nbsp;&middot;&nbsp; <a href="{SITE}" '
        'style="color:#5C5C5C;text-decoration:underline;">brotto.dev</a></p>\n</td></tr>\n\n'
        "</table>\n</td></tr></table>\n</body></html>"
    )

    plain = (
        "Brotto\n\nSIGN IN TO BROTTO\n\n"
        "Your sign-in code\n\n"
        f"{code}\n\n"
        f"Type this code into Brotto to finish signing in. It works once, and it expires "
        f"in {TEN_MINUTES}.\n\n"
        "If you did not ask for this, nothing has happened and you can ignore this mail.\n\n"
        f"Unsubscribe: mailto:{mailbox(from_address())}?subject=unsubscribe\n"
        f"Privacy: {SITE}/privacy\n"
        f"Security: {SITE}/security\n"
        f"{SITE}\n"
    )
    return body, plain


def payload(email: str, code: str) -> dict:
    """The exact JSON body posted to Resend. The address is only in `to`."""
    html, text = render(code)
    return {
        "from": from_address(),
        "to": [email],
        "subject": SUBJECT,
        "html": html,
        "text": text,
        "reply_to": from_address(),
        # Shared rather than written here — `headers` as an object and a
        # missing `attachments` are both silent, and both shipped once.
        "headers": unsubscribe_header(),
        "tags": [{"name": "kind", "value": "sign-in-code"}],
        "attachments": mark_attachment(),
    }


async def _deliver(email: str, code: str) -> int:
    """One POST to Resend. The status, or a raise — nothing else.

    The seam the tests replace, so no test in the suite touches the network.
    """
    headers = {
        "Authorization": f"Bearer {os.getenv('RESEND_API_KEY', '').strip()}",
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=SEND_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(ENDPOINT, json=payload(email, code),
                                headers=headers) as resp:
            return resp.status


async def send_code(email: str, code: str) -> None:
    """Mail one code. Never raises, and never blocks the caller's answer.

    One `try` spans the whole body, on the same rule `send_confirmation`
    states: an exception type nobody enumerated is exactly the case this is
    about, and it has to end somewhere that is not the request.
    """
    if not enabled():
        return
    try:
        status = await _deliver(email, code)
    except Exception as exc:  # a bug here must not take the sign-in with it
        # TYPE only. A transport exception can quote the request body, and the
        # body holds the address.
        log.warning("sign-in code not sent: %s", type(exc).__name__)
        return
    if status >= 400:
        log.warning("sign-in code mail answered %d", status)
