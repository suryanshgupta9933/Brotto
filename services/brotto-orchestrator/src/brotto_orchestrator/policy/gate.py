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
from ipaddress import ip_address
from urllib.parse import urlsplit

from .domains import _normalize_pattern, domain_matches, etld1
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
# because a feature got switched on. Two gaps in that shared function are
# closed *here* rather than in `check_domain_policy`, because that one also
# decides whether to prompt the user and `n/a` means "don't ask" there; see
# `_host_is_blocked` and privacy.md for both.

SCREENSHOT_CAPTURE_ENV = "BROTTO_VISION_CAPTURE"

# Closed set of machine words. They end up in a note the model reads and, if
# the run stops, in a failure_reason — so no URL, no domain and no free text,
# for the same reason `_REFUSAL_REASON` exists.
REFUSAL_CAPTURE_OFF = "capture_not_enabled"
REFUSAL_DOMAIN_BLOCKED = "domain_blocked"
REFUSAL_UNKNOWN_URL = "unresolvable_url"

# Rightmost labels that name a network, not a place on the public internet.
# `len(labels) < 2` below already refuses `localhost` and `intranet`; these are
# the same names wearing a second label, so without this set `printer.local` and
# `gw.home.arpa` walked straight through and were capturable — which is the
# entire class `_raw_host` exists to refuse.
#
# **Every entry is one an RFC reserves, with one deliberate exception.** That is
# the admission rule, and it is stated because the set used to be nearly twice
# this long and the difference was the point. Alongside the RFC 2606 / 6761
# reserved names (`test`, `invalid`, `example`, `localhost`), mDNS `.local`
# (RFC 6762), `home.arpa` (RFC 8375), bare `arpa` (IANA infrastructure), and
# `.onion` (RFC 7686), this set once also carried `internal`, `intranet`,
# `lan`, `home` and `corp` — plausible words people type on a LAN, and nothing
# more. They were added in rounds rather than derived, and they fail the bar: a
# reserved label *cannot* name a public site, so refusing one costs no
# legitimate capture and closes the case for good; a guessed one might, so it
# refuses a real host on the strength of a typing habit and leaves the class
# behind it just as open.
#
# The exception is `dev`, which is a delegated TLD and not a reserved name. It
# is here anyway, and **our own relay is refused with it**: `agent.brotto.dev`
# is not capturable. That was the other trade, and it is the one taken — a
# name-based grant on a channel that cannot be redacted is the wrong shape, and
# the refusal is the cheap direction because the cost is one task losing its
# eyes on a canvas page, which this module's header already names as the
# acceptable failure. The alternative — resolving DNS to tell a delegated TLD
# from a LAN name — was made and recorded, and it is a blocking lookup on the
# agent hot path to save one screenshot. A bad trade.
#
# `localhost` is redundant with the `len(labels) < 2` check above and is kept
# only because deleting it would make the set read as though the single-label
# rule and this one were describing different things.
#
# A curated set, not a public-suffix list: the question is never "is this
# registrable", only "is this a name this gate has no business photographing",
# and a PSL would be a ~10k-entry table imported to answer a yes/no that only
# ever refuses. `domains.MULTI_PART_SUFFIXES` is not a TLD set and cannot be
# extended into one without that table.
_INTERNAL_SUFFIXES = frozenset({
    "local", "localhost", "test", "invalid", "example",
    "arpa", "home.arpa", "onion", "dev",
})

# The hostname alphabet, minus "." (split on) and "-" is allowed by RFC 1123
# for hostnames but is rare enough in a policy entry to be refused.
_HOST_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyz0123456789-_:"
)


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

    **This gate refuses; it never falls back to "allow".** `check_domain_policy`
    answers `n/a` for anything with no eTLD+1 — an IP literal, a single-label
    host, garbage — and `n/a` is the right answer for the *approval* path,
    which prompts rather than refusing. Here it was the fail-open: a run on
    `http://192.168.1.1/` or `http://localhost:8080/` photographed a page with
    no blocklist check in front of it at all. So the host is resolved here, and
    a host this gate cannot name is a refusal. There is no exception: someone
    photographing a local page has told us nothing about whether it is safe,
    and `BROTTO_VISION_CAPTURE` is the switch that already exists for them.
    """
    if not capture_enabled():
        return REFUSAL_CAPTURE_OFF
    host = _raw_host(url)
    if host is None:
        return REFUSAL_UNKNOWN_URL
    if policy is not None and _host_is_blocked(url, host, policy):
        return REFUSAL_DOMAIN_BLOCKED
    return None


def _raw_host(url: str | None) -> str | None:
    """The hostname as written, lowercased — or None if there isn't one.

    Deliberately not `etld1`: this returns the *whole* host including `www.`
    and it does not care whether the host is a registrable domain. A policy
    entry names a host, and only the caller knows which of those two readings
    it wants.
    """
    if not url or not isinstance(url, str):
        return None
    try:
        host = urlsplit(url if "://" in url else f"http://{url}").hostname
    except ValueError:
        return None
    host = (host or "").lower().strip(".")
    if not host:
        return None
    # `urlsplit` is permissive: it will hand back "not a url" as a hostname,
    # spaces and all. A host this gate cannot name is a refusal, and
    # "everything that parses" is a wider set than "everything that is a
    # host" — so spell out the two shapes we accept. No trailing/leading dot,
    # no empty label, no whitespace, nothing outside the hostname alphabet.
    # An IP literal is accepted by the loop and refused by the caller.
    body = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    labels = body.split(".")
    if any(
        not label
        or any(ch not in _HOST_CHARS for ch in label)
        for label in labels
    ):
        return None
    # An IP literal and a single label are both "no registered domain":
    # `192.168.1.1` is a machine on somebody's network and `localhost` /
    # `intranet` are names inside one. `etld1` never named either, so the
    # blocklist was never consulted for them. Unresolvable by this gate's own
    # definition, and refused as such.
    if _is_ip(body) or len(labels) < 2:
        return None
    # `host` is already case-folded above, so `printer.LOCAL` is compared as
    # `printer.local` and cannot slip past on spelling.
    if any(host == s or host.endswith("." + s) for s in _INTERNAL_SUFFIXES):
        return None
    return host


def _is_ip(host: str) -> bool:
    try:
        ip_address(host)
    except ValueError:
        return False
    return True


def _host_is_blocked(url: str, host: str, policy: Policy) -> bool:
    """The shared policy decision, plus the two gaps it cannot close here.

    `check_domain_policy` is left exactly as the extension-facing callers
    expect it — it gates an approval prompt, where `n/a` means "don't ask",
    and its wildcard semantics are `*.bank.com` means subdomains *only*.
    Both are wrong for a gate whose job is to refuse:

      - it matches on eTLD+1 and a `www.`-stripped host, so `*.bank.com`
        misses `www.bank.com` entirely — a user who believes a site is
        blocked, and isn't, is worse off than one who never tried;
      - it short-circuits to `n/a` before the blacklist is consulted, so a
        host with no eTLD+1 was never checked against the list at all.

    So the raw host is matched here as well, and a `*.suffix` entry also
    matches `suffix` itself. Widening only ever refuses, which is the
    direction this gate is allowed to move.
    """
    if check_domain_policy(url, policy) is GateDecision.BLOCK:
        return True
    for pattern in policy.blacklist:
        if domain_matches(host, pattern):
            return True
        normalized = _normalize_pattern(pattern)
        if normalized.startswith("*."):
            if domain_matches(host, normalized[2:]):
                return True
    return False


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
