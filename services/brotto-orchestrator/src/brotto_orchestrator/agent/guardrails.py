from __future__ import annotations

import asyncio
import re


# URL path fragments that indicate a real login/auth flow: the sign-in and
# sign-up steps, and the second-factor steps that follow them (2FA, OTP,
# challenge, passcode). Sign-up is in the same set as sign-in because both
# leave the user mid-authentication with nothing the agent can click.
#
# No "/verif": email/account verification pages are caught by their title
# ("Verify your email address"), and the bare fragment also matches ordinary
# routes like /guides/verify-your-backup. No "/register" or "/join" either —
# both are at least as likely to be event registration or "join a call" as
# account creation, and sign-up is caught by title ("Sign up", "Create
# account") anyway. A false positive halts a signed-in user, so this list
# stays unambiguous.
LOGIN_URL_PATTERNS = (
    "/login", "/signin", "/sign-in", "/log-in", "/auth", "/sso", "/session/",
    "/signup", "/sign-up",
    "/oauth/",
    "/2fa", "/two-factor", "/twofactor", "/mfa",
    "/totp", "/otp", "/passcode", "/challenge",
    "/step-up", "/second-factor",
)

# Force-trigger: a session-expired message means the user was logged out,
# even on a page that otherwise looks normal.
_SESSION_EXPIRED_RE = re.compile(r"session.*expired", re.I)

# Force-trigger: a second-factor prompt means the login is still in progress,
# so the user is not done authenticating even if the page looks otherwise
# ordinary. Scoped to phrases that ask for a code rather than merely naming
# the feature: a signed-in Security-settings page whose heading is "Two-factor
# authentication" must not pause the agent, so `two.?factor` lives in the
# title and URL signals instead, where a matching value is a prompt by
# definition. "security code" is excluded because at checkout it is a card
# CVV.
_MULTISTEP_AUTH_RE = re.compile(
    r"enter (the |your )?(verification |one.?time |two.?factor )?code"
    r"|code (from|sent to|you (received|entered))"
    r"|one.?time (password|passcode)"
    r"|verification code"
    r"|(sms|text message) code",
    re.I,
)

# Patterns that match a login-flavoured or verification-flavoured page title.
_LOGIN_TITLE_RE = re.compile(
    r"sign.?in|log.?in|authenticate"
    r"|sign.?up|create (an |your )?account"
    r"|two.?factor|two.?step|second factor|passcode"
    r"|one.?time (password|code|passcode)"
    r"|verification code|verify (your|identity|the|it)"
    r"|enter (the |your )?code|check your (phone|device|inbox)"
    r"|\b2fa\b|\botp\b",
    re.I,
)


def check_login_page(page_title: str, ax_tree: str, url: str) -> bool:
    """Detect a login or second-factor page. True → pause for the human.

    Title and URL are each independently authoritative — a page titled
    "Sign in" IS a login page, and a URL on a known auth path is too.
    Both cover the second factor (2FA / OTP / passcode / challenge),
    because those steps arrive on their own pages after the password is
    already accepted; catching only the password step means the agent
    resumes into a verification prompt it cannot answer.

    Two content phrases force-trigger regardless of title or URL, because
    they mean the same thing on any site: "session expired" (logged out
    mid-page) and an explicit second-factor prompt.

    Deliberately NOT a general content scan. "password" appears on Google
    Search via the password manager and "oauth" appears in Gmail from
    integration tags; combined with the "Sign in" link in Google's own AX
    tree, any marker-plus-corroboration rule flags both of those signed-in
    pages as login pages. So the only content signal is the narrow
    second-force-trigger above — see tests/test_agent_e2e.py.
    """
    if _SESSION_EXPIRED_RE.search(ax_tree) or _MULTISTEP_AUTH_RE.search(ax_tree):
        return True

    if _LOGIN_TITLE_RE.search(page_title):
        return True

    return any(p in url.lower() for p in LOGIN_URL_PATTERNS)


CRITICAL_PATTERNS = [
    r"delete", r"submit.*form", r"send.*email", r"create.*ticket",
    r"approve", r"reject", r"payment", r"transfer",
    r"publish", r"deploy", r"confirm",
]

_CRITICAL_RE = [re.compile(p, re.I) for p in CRITICAL_PATTERNS]


def check_critical_action(action: str, action_args: dict) -> bool:
    if action in {"task_complete", "cannot_complete", "ask_human"}:
        return False
    combined = f"{action} {action_args}"
    return any(r.search(combined) for r in _CRITICAL_RE)


def check_sensitive_action(action: str, action_args: dict, policy) -> bool:
    """True iff secure mode is on AND the action matches an entry in
    `policy.sensitive_actions`. The list is matched as a substring against
    either the action name or any string in action_args — admins author
    both forms (``"payment"`` matches a ``payment`` action OR a click
    with ``description="payment button"``).

    Normal mode → always False (the regex `CRITICAL_PATTERNS` guard above
    still applies; sensitive_actions is the secure-mode-only escalation).

    Terminal / internal / question actions are skipped — those are
    metadata, not things the user should approve. (E.g. a click with
    description matching `payment` should fire; but a scratchpad write
    whose notes happen to mention "payment" should not.)
    """
    if getattr(policy, "mode", None) != "secure":
        return False
    patterns = getattr(policy, "sensitive_actions", None) or []
    if not patterns:
        return False
    if action in {"task_complete", "cannot_complete", "ask_human",
                  "write_scratchpad", "append_scratchpad", "read_scratchpad",
                  "recall_memory", "read_page_text"}:
        return False
    # Match against action name + arg values joined into one string.
    # Cheap substring scan; no regex needed for the curated list.
    haystack = " ".join([action] + [str(v) for v in action_args.values()]).lower()
    return any(p.lower() in haystack for p in patterns)


async def wait_for_redirect(get_url_fn, from_url: str, timeout: int = 120) -> str:
    """Poll until URL changes from from_url. Returns new URL."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        current = await get_url_fn()
        if current != from_url:
            return current
        await asyncio.sleep(1.5)
    raise TimeoutError(f"No redirect from {from_url} after {timeout}s")
