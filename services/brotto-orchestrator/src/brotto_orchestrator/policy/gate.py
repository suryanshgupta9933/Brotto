"""Pure decision functions for the policy gate.

Enforcement is:
  - blacklist match → BLOCK (task terminates; no user override)
  - a (domain, action) pair not yet seen → prompt

Both were previously gated on `mode == "secure"`, which made the
permissive path the default and gave it a name implying the other one
was a hardening option. There is no mode.

# ponytail: removed whitelist (impractical for admins to maintain;
# "approve the rest" is the wrong mental model for a bank). Removed
# block_blacklisted flag (blacklist match is always a hard block — no
# user override path). See schema.py header for the
# full rationale.
"""

from __future__ import annotations

import os
from enum import Enum

from .domains import domain_matches, etld1
from .schema import Policy


class GateDecision(str, Enum):
    ALLOW = "allow"
    BLOCK = "block"
    N_A = "n/a"


# ── the vision-capture gate ────────────────────────────────────────────────
#
# A screenshot is the one channel of page content that redaction cannot see.
# `redact_text` is pattern matching over strings; a JPEG is pixels, so a card
# number, an OTP or an account balance rendered into a `<canvas>` reaches the
# provider whole — the same content as page text would have been redacted. That
# makes this a gate and not a redaction pass, and it is why the rule here is
# *default refusal* rather than a list of pages to worry about.
#
# **Why a list is not the answer.** A pattern list is a denylist against an
# open-ended threat, and the trigger that reaches this gate is "the
# accessibility tree came back empty" — a fact about how the page is
# *implemented*, not about how sensitive it is. Google Docs, Figma and a
# hostile canvas page are identical to that predicate. The harm case has no
# reliable URL shape to match on, so a list would be untestable for
# completeness while reading as if it were complete.
#
# **Why the default is off.** Capture is a *new egress channel*, and every
# other one here is either redacted unconditionally or explicitly asked for.
# Redaction having no off switch is a different claim from a new channel
# having no off switch; the first only ever narrows what leaves, the second
# widens it. The user enables this the same way they enable every other
# feature: by turning it on.
#
# The cost is real and stated: until it is on, W2 does nothing, and a canvas
# page is reported as unseen rather than described. A refused capture costs one
# task its eyes; an unredacted card number in a provider's logs is not
# reversible.
#
# The user's own blocklist still refuses regardless of the switch. That is not
# a new list — it is `check_domain_policy` over the blacklist they already
# wrote, and a site someone deliberately blacklisted is not one to photograph
# because a feature got switched on.

SCREENSHOT_CAPTURE_ENV = "BROTTO_VISION_CAPTURE"

# Closed set of machine words. They end up in a note the model reads and, if
# the run stops, in a failure_reason — so no URL, no domain and no free text,
# for the same reason `_REFUSAL_REASON` exists.
REFUSAL_CAPTURE_OFF = "capture_not_enabled"
REFUSAL_DOMAIN_BLOCKED = "domain_blocked"


def capture_enabled() -> bool:
    """Whether viewport capture is enabled. Read at call time, not import.

    Off unless explicitly on, and only an explicit spelling turns it on — a
    stray `BROTTO_VISION_CAPTURE=false` or `0` in a `.env` is a *refusal*, and
    the safe reading of an unrecognised value here is the same one as for
    `AGENT_SECRET` and `BROTTO_RETENTION_DAYS`: anything unparseable means off.
    """
    return os.getenv(SCREENSHOT_CAPTURE_ENV, "").strip().lower() in {
        "on", "1", "true", "yes",
    }


def screenshot_block_reason(
    url: str | None, policy: Policy | None = None,
) -> str | None:
    """Why this step may not capture a screenshot, or None if it may.

    Ordered so the switch is checked first: a run with capture off should not
    be told anything about the URL's domain, and the reason string is read by
    a model.
    """
    if not capture_enabled():
        return REFUSAL_CAPTURE_OFF
    if policy is not None and check_domain_policy(
        url or "", policy
    ) is GateDecision.BLOCK:
        return REFUSAL_DOMAIN_BLOCKED
    return None


def check_domain_policy(url: str, policy: Policy) -> GateDecision:
    """Decide what to do with a URL given the policy.

    Precedence:
      1. URL can't be parsed → n/a (don't gate on garbage)
      2. blacklist pattern matches eTLD+1 or hostname → block
      3. Otherwise → allow

    Always returns n/a for a URL that cannot be parsed.
    """
    domain = etld1(url)
    if domain is None:
        return GateDecision.N_A
    hostname = _hostname_only(url)
    if policy.blacklist:
        for pat in policy.blacklist:
            if domain_matches(domain, pat) or (hostname and domain_matches(hostname, pat)):
                return GateDecision.BLOCK
    return GateDecision.ALLOW


def _hostname_only(url: str) -> str:
    """Pull the hostname out of a URL without depending on the URL being well-formed."""
    raw = url.split("://", 1)[-1].split("/", 1)[0]
    raw = raw.split("@")[-1].split(":")[0]
    host = raw.lower().strip(".")
    if host.startswith("www.") and host.count(".") >= 2:
        host = host[4:]
    return host


def check_first_time_seen(
    key: str,
    seen: set[str],
    policy: Policy,
) -> bool:
    """True iff this key has not been seen this session.

    The key is a domain (or `domain:hidden` — see `harness._first_time_key`),
    not an action: approving a site approves the site. Keying it any finer made
    a single run ask the same question once per action type on the same page.

    Caller adds the key to `seen` after acting on the result (whether
    approved or denied) — re-asking on deny would loop, and on approve
    we don't want to re-prompt on every subsequent step.
    """
    return key not in seen
