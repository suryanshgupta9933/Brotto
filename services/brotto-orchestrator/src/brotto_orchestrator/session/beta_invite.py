"""The mail that goes out when the operator admits an address to the beta.

`scripts/beta-roster.sh add` is the only way in, and it calls this. There is no
HTTP route for it, for the same reason there is no HTTP route for the roster
write itself: anything reachable from the internet that appends an address is a
weakly-authenticated write into the front door of the hosted beta.

The design language, the escaping and the transport are all `waitlist_email`'s,
imported rather than copied. Two people reading the two mails should not be
able to tell they came from different files.

**The invitation is the roster row, so this fires at the moment of admission,
not at first sign-in.** Somebody on the list who never redeems their code still
got a correct invitation, which is what we said when they asked for one.
"""

import asyncio
import html as html_lib
import logging
import os
import sys
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

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

log = logging.getLogger(__name__)

BETA_URL = f"{SITE}/closed-beta"

#: The published Chrome Web Store listing. The id is the listing's own, and is
#: stable for its life — the `?authuser=…&hl=…` someone copies out of their own
#: address bar is a per-viewer session parameter and is deliberately dropped.
#: **Without this the invite tells a reader to "sign in" with a copy of Brotto
#: they may not have, in a browser with no extension to run it in.**
CWS_URL = "https://chromewebstore.google.com/detail/brotto/kblfiddjaeekmlpmgpgchcfbakjhflpd"

#: What one admitted member gets. Stated in public copy, so it is the same
#: number as `BROTTO_BETA_TASK_CAP` on the relay — and if that changes, this and
#: `/closed-beta` are the two places that have to change with it.
TASKS_PER_WEEK = 100


def _esc(value: str) -> str:
    return html_lib.escape(value, quote=True)


def _masthead() -> str:
    """The wordmark. Identical to the confirmation's, mark or no mark.

    Asks `mark_attachment()` rather than `_mark()` for the same yes/no the
    payload asks. Two lookups of one condition is how the markup grows a
    `cid:` that the attachment list does not have bytes for — the mail sends,
    the logo does not, and nothing in the response says why.
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


def render() -> tuple[str, str]:
    """The HTML and the plain text. Both say the same thing.

    No address argument, for the reason the confirmation has none: the wordmark
    is the name, and the address reaches Resend in `to` and nowhere else.

    **Deliberately not the confirmation's layout.** That mail answers "did my
    address arrive"; this one is the invitation itself, so it is built like a
    launch: an eyebrow, a word, a number worth reading, and three things that
    are true. Reusing the confirmation's tick-and-one-paragraph shape made two
    mails that were the same mail, and the person this goes to is somebody we
    chose, not somebody who clicked a button.
    """
    eyebrow = (
        "font-size:12px;line-height:1;letter-spacing:0.18em;text-transform:uppercase;"
        "color:#6E6E6E;font-weight:500;"
    )
    label = (
        "font-size:12px;line-height:1.3;letter-spacing:0.1em;text-transform:uppercase;"
        "color:#6E6E6E;font-weight:600;"
    )
    text = f"font-family:{_FONT};font-size:17px;line-height:1.6;color:#000000;"

    def row(heading: str, copy: str) -> str:
        return (
            # `padding:20px 0`, not `20px 0 0`: a top border gets its space *below* from
            # its own padding and its space *above* from the previous row's padding-bottom,
            # so an asymmetric value is what makes a rule hug the paragraph above it.
            '<tr><td style="padding:20px 0;border-top:1px solid #E5E5E5;">\n'
            f'  <p style="margin:0;font-family:{_FONT};font-size:12px;line-height:1.3;'
            f'letter-spacing:0.1em;text-transform:uppercase;color:#6E6E6E;font-weight:600;">'
            f"{_esc(heading)}</p>\n"
            f'  <p style="margin:8px 0 0;{text}max-width:32em;">{copy}</p>\n</td></tr>\n'
        )

    rows = (
        # The first row is the only one with a link in it, and that is the
        # whole reason it exists: before the listing was published this read
        # "Nothing to install", which was quietly wrong — the reader has no
        # Brotto to sign into yet.
        row(
            "Add it to Chrome",
            "One click, and then sign in with this address and ask for something "
            "in the tab you are already signed in to."
            f'<a href="{CWS_URL}" style="color:#000000;text-decoration:underline;">'
            "Get the extension</a>.",
        )
        + row(
            "Your key, your provider",
            "The page you are looking at goes to the provider you chose, not to us. "
            "We run the agent, not the model.",
        )
        + row(
            "No ceiling on a single run",
            "If a job is going to take twenty minutes, it takes twenty minutes. We would "
            "rather cut a task short than have you watching it wait.",
        )
        + row(
            "Tell us what breaks",
            "When a run fails the panel offers to send us the reason code and your "
            "account id. We also keep one record per sign-in — your account id, "
            "the network you came from, and the browser — so we can tell a new "
            "laptop from somebody else holding the account.",
        )
    )

    body = (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8">'
        "<title>Brotto Cloud &mdash; the closed beta is open</title></head>\n"
        '<body style="margin:0;padding:0;background:#FFFFFF;">\n'
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">'
        "Brotto Cloud is open to you &mdash; 100 tasks a week.</div>\n"
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
        f'  <p style="margin:0;font-family:{_FONT};{eyebrow}">'
        "Brotto Cloud &mdash; closed beta</p>\n</td></tr>\n\n"
        '<tr><td style="padding:16px 0 0;">\n'
        f'  <h1 style="margin:0;font-family:{_FONT};font-size:38px;line-height:1.05;'
        'font-weight:600;letter-spacing:-0.035em;color:#000000;">'
        'Come in. <span style="font-size:30px;letter-spacing:0;">\U0001f389</span></h1>\n'
        "</td></tr>\n\n"
        '<tr><td style="padding:24px 0 0;">\n'
        f'  <p style="margin:0;{text}max-width:34em;">'
        "You are on the first round. Brotto Cloud is the extension you already use, with "
        "our server running it instead of yours &mdash; and you have it from now.</p>\n"
        "</td></tr>\n\n"
        '<tr><td style="padding:14px 0 0;">\n'
        f'  <p style="margin:0;{text}max-width:34em;color:#3D3D3D;">'
        "We are keeping the limits deliberately generous for the closed beta, so you can "
        "test it rigorously instead of rationing your own curiosity.</p>\n"
        "</td></tr>\n\n"
        '<tr><td style="padding:32px 0 0;">\n'
        '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="border:1px solid #000000;"><tr>\n'
        '    <td width="164" valign="top" style="padding:26px 0 26px 28px;">\n'
        f'      <p style="margin:0;font-family:{_FONT};font-size:52px;line-height:0.85;'
        'font-weight:600;letter-spacing:-0.04em;color:#000000;">100</p>\n'
        f'      <p style="margin:12px 0 0;font-family:{_FONT};{eyebrow}">Tasks a week</p>\n'
        "    </td>\n"
        '    <td valign="top" style="padding:26px 28px 26px 20px;">\n'
        f'      <p style="margin:0;font-family:{_FONT};font-size:15px;line-height:1.6;'
        'color:#000000;">Free for as long as the beta lasts, resetting every Monday. '
        "It is not a teaser &mdash; the number is set high on purpose, so you never have "
        "to pause and ask whether to spend a run.</p>\n"
        "    </td>\n  </tr></table>\n</td></tr>\n\n"
        f'<tr><td style="padding:20px 0 0;">\n{rows}</td></tr>\n\n'
        '<tr><td style="padding:32px 0;">\n'
        f'  <p style="margin:0;{text}max-width:34em;">'
        "What the beta involves, and exactly what we can see while it runs, is "
        f'<a href="{BETA_URL}" style="color:#000000;text-decoration:underline;">'
        "on the beta page</a>.</p>\n</td></tr>\n\n"
        '<tr><td style="padding:36px 0 0;border-top:1px solid #E5E5E5;">\n'
        f'  <p style="margin:0;font-family:{_FONT};font-size:13px;line-height:1.7;color:#6E6E6E;">'
        f'<a href="mailto:{_esc(mailbox(from_address()))}?subject=unsubscribe" '
        'style="color:#5C5C5C;text-decoration:underline;">Remove from the beta</a> &nbsp;&middot;&nbsp; '
        f'<a href="{SITE}/privacy" style="color:#5C5C5C;text-decoration:underline;">Privacy</a>'
        f' &nbsp;&middot;&nbsp; <a href="{SITE}/security" '
        'style="color:#5C5C5C;text-decoration:underline;">Security</a>'
        f' &nbsp;&middot;&nbsp; <a href="{SITE}" '
        'style="color:#5C5C5C;text-decoration:underline;">brotto.dev</a></p>\n</td></tr>\n\n'
        "</table>\n</td></tr></table>\n</body></html>"
    )

    plain = (
        "Brotto\n\nBROTTO CLOUD — CLOSED BETA\n\n"
        "Come in. 🎉\n\n"
        "You are on the first round. Brotto Cloud is the extension you already use, with our "
        "server running it instead of yours — and you have it from now.\n\n"
        "We are keeping the limits deliberately generous for the closed beta, so you can test "
        "it rigorously instead of rationing your own curiosity.\n\n"
        f"100 TASKS A WEEK\n\n"
        "Free for as long as the beta lasts, resetting every Monday. It is not a teaser — the "
        "number is set high on purpose, so you never have to pause and ask whether to spend a "
        "run.\n\n"
        "ADD IT TO CHROME\n"
        "One click, and then sign in with this address and ask for something in the tab "
        f"you are already signed in to.\nGet the extension: {CWS_URL}\n\n"
        "YOUR KEY, YOUR PROVIDER\n"
        "The page you are looking at goes to the provider you chose, not to us. We run the "
        "agent, not the model.\n\n"
        "NO CEILING ON A SINGLE RUN\n"
        "If a job is going to take twenty minutes, it takes twenty minutes. We would rather "
        "cut a task short than have you watching it wait.\n\n"
        "TELL US WHAT BREAKS\n"
        "When a run fails the panel offers to send us the reason code and your account id. "
        "We also keep one record per sign-in — your account id, the network you came from, "
        "and the browser — so we can tell a new laptop from somebody else holding the "
        "account.\n\n"
        f"What the beta involves, and exactly what we can see while it runs: {BETA_URL}\n\n"
        f"Remove from the beta: mailto:{mailbox(from_address())}?subject=unsubscribe\n"
        f"Privacy: {SITE}/privacy\n"
        f"Security: {SITE}/security\n"
        f"{SITE}\n"
    )

    return body, plain


def payload(email: str) -> dict:
    html, text = render()
    return {
        "from": from_address(),
        "to": [email],
        "subject": "You are in — Brotto Cloud closed beta",
        "html": html,
        "text": text,
        "reply_to": from_address(),
        # Shared with `waitlist_email` rather than written here: this file's
        # first draft used an *object* for `headers` and omitted
        # `attachments` entirely, so the mail that ships an unsubscribe offer
        # and a logo in its HTML carried neither. Both are silent — Resend
        # accepts the body and drops what it does not recognise.
        "headers": unsubscribe_header(),
        "tags": [{"name": "kind", "value": "beta-invite"}],
        "attachments": mark_attachment(),
    }


async def _deliver(email: str) -> int:
    """One POST to Resend. The status, or a raise — nothing else."""
    headers = {
        "Authorization": f"Bearer {os.getenv('RESEND_API_KEY', '').strip()}",
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=SEND_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(ENDPOINT, json=payload(email), headers=headers) as resp:
            return resp.status


async def send_invite(email: str) -> int:
    """Mail one invitation. Returns the Resend status; raises on transport.

    The roster row is already written by the time this runs, so a failure here
    is reported and not retried by anything: `beta-roster.sh` prints it and the
    operator re-sends by hand with `resend` if they want to.
    """
    return await _deliver(email)


def _preview(path: str) -> None:
    """Write the HTML to a file so it can be looked at in a browser."""
    html, text = render()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(text)
    print(f"\nHTML written to {path}", file=sys.stderr)


#: The *dev* `.env` — `services/brotto-orchestrator/.env`, the one that carries
#: a model key. Explicit rather than `find_dotenv()` walking up from cwd, and
#: deliberately not the repo-root `.env` beside `docker-compose.yml` (only
#: `AGENT_SECRET`; the two are not interchangeable).
_DEV_ENV = Path(__file__).resolve().parents[3] / ".env"


def main(argv: list[str]) -> int:
    # Load here, not at import: `test_beta_invite.py` imports this module and
    # must not pick up whatever the operator has in their `.env`.
    # `override=False` keeps `RESEND_API_KEY=… ./scripts/beta-roster.sh add …`
    # winning over the file, exactly as the script's header documents.
    load_dotenv(_DEV_ENV, override=False)
    if len(argv) == 3 and argv[1] == "--preview":
        _preview(argv[2])
        return 0
    if len(argv) != 2:
        print("usage: python -m brotto_orchestrator.session.beta_invite <address>", file=sys.stderr)
        print("       … --preview <file.html>   write the HTML and print the text", file=sys.stderr)
        return 2
    if not enabled():
        print("RESEND_API_KEY is not set — add it to services/brotto-orchestrator/.env, or export it.", file=sys.stderr)
        return 3
    email = argv[1].strip()
    try:
        status = asyncio.run(send_invite(email))
    except Exception as exc:  # TYPE only — a transport exception can quote the body
        print(f"invite not sent: {type(exc).__name__}", file=sys.stderr)
        return 1
    if status >= 400:
        print(f"invite not sent: Resend answered {status}", file=sys.stderr)
        return 1
    print(f"invite sent to {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))