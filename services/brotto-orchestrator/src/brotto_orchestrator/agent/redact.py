"""Redaction of page text before it leaves the machine.

Two different questions get confused here, so they are separated deliberately:

- `is_secret_field` (in `audit.py`) asks *is this a secret-bearing form
  field*, and is used to decide whether a value the agent is about to type
  reaches the audit. It is about actions.
- This module asks *what sensitive strings are in the text the model is about
  to read*, and is about perception.

The honest limit, stated once so it is not mistaken for a guarantee: this is
pattern matching. It catches the shapes that are unambiguous and high-harm —
credentials, API keys, payment cards, government identifiers — and it will
miss a novel national identifier format, and it will occasionally redact an
order number that happens to pass a checksum. Over-redaction is a known cost
here; it was already a bug once (`_scrubbed` over-redacting a Gmail search box
is documented in `docs/architecture/agent-loop.md`). The trade is deliberate
and unconditional — there is no setting that turns it off.

The checksum on card numbers is what makes that trade mostly one-directional:
a random 16-digit order number passes Luhn about one time in ten, so this is
not free — but a redacted tracking number is an inconvenience and a live card
number in a model provider's logs is not.
"""

from __future__ import annotations

import re
from typing import Callable, NamedTuple


REDACTED = "[redacted]"


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


class _Rule(NamedTuple):
    kind: str
    pattern: re.Pattern[str]
    # Optional post-check on the matched text. A rule without one replaces
    # every match; with one, only matches it accepts are replaced.
    accept: Callable[[str], bool] | None = None


def _card_ok(matched: str) -> bool:
    digits = re.sub(r"\D", "", matched)
    if not 13 <= len(digits) <= 19:
        return False
    return _luhn_ok(digits)


_RULES: tuple[_Rule, ...] = (
    # Private keys are matched whole — a PEM body is not something to try to
    # pattern piece by piece, and a partial match would leave a usable key.
    _Rule("private-key", re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        re.S,
    )),
    _Rule("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}")),
    _Rule("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{20,}=*")),
    # Prefixed keys. The prefix is the signal: a bare high-entropy string is
    # usually a hash or an id, and redacting those would shred most pages.
    _Rule("api-key", re.compile(
        r"\b(?:sk|pk|rk|api|key)[-_][A-Za-z0-9_-]{16,}\b", re.I)),
    _Rule("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b")),
    _Rule("aws-key-id", re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b")),
    _Rule("slack-token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b")),
    _Rule("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    _Rule("card", re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), accept=_card_ok),
)


def redact_text(text: str | None) -> tuple[str, dict[str, int]]:
    """Replace sensitive strings in `text`.

    Returns the redacted text and a per-kind count, so the caller can log what
    was withheld without ever logging what it was. A count is worth having:
    "secure mode redacted 3 card numbers on this page" is a disclosure the
    user can act on, and it costs nothing to produce.

    Pure and total — no exceptions, no I/O, no policy. Whether to call it is
    the caller's decision, and the caller is the harness.
    """
    if not text:
        return (text or ""), {}
    out = text
    counts: dict[str, int] = {}
    for rule in _RULES:
        def _sub(m: re.Match[str], _rule: _Rule = rule) -> str:
            matched = m.group(0)
            if _rule.accept is not None and not _rule.accept(matched):
                return matched
            counts[_rule.kind] = counts.get(_rule.kind, 0) + 1
            return f"{REDACTED}:{_rule.kind}"

        out = rule.pattern.sub(_sub, out)
    return out, counts


def contains_sensitive(text: str | None) -> bool:
    """True when `redact_text` would change anything. For gates, not logging."""
    if not text:
        return False
    redacted, counts = redact_text(text)
    return bool(counts)
