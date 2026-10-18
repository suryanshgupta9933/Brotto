"""The vision-capture gate: default refusal, and never on a blocked domain.

A screenshot is the one page-content channel redaction cannot see, so this is
a gate rather than a redaction pass. The assertions below are mostly about
**absences** — a capture that happens where it should not is invisible in a
diff and irreversible once it has reached a provider.

No model, no network, no browser: `check_domain_policy` and the env read are
the whole surface.
"""

from __future__ import annotations

import pytest

from brotto_orchestrator.policy.gate import (
    REFUSAL_CAPTURE_OFF,
    REFUSAL_DOMAIN_BLOCKED,
    REFUSAL_UNKNOWN_URL,
    SCREENSHOT_CAPTURE_ENV,
    capture_enabled,
    screenshot_block_reason,
)
from brotto_orchestrator.policy.schema import Policy

BOARD = "https://example.com/board"
BANK = "https://secure.bank.com/login/otp"


@pytest.fixture(autouse=True)
def _capture_off(monkeypatch):
    """Default is refusal, so nothing leaks into a test that doesn't set it."""
    monkeypatch.delenv(SCREENSHOT_CAPTURE_ENV, raising=False)


def _on(monkeypatch):
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")


# ── default refusal ────────────────────────────────────────────────────────

def test_capture_is_off_unless_it_was_turned_on():
    """The load-bearing default: a new egress channel does not arrive hot."""
    assert capture_enabled() is False


def test_an_unset_environment_refuses():
    assert screenshot_block_reason(BOARD, Policy()) == REFUSAL_CAPTURE_OFF


@pytest.mark.parametrize("value", ["", "off", "false", "0", "no", "maybe", "On!"])
def test_only_an_explicit_spelling_turns_capture_on(monkeypatch, value):
    """A malformed value reads as off. The safe reading of "I am not sure what
    this should be" for a channel that cannot be redacted is no."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, value)
    assert capture_enabled() is False
    assert screenshot_block_reason(BOARD, Policy()) == REFUSAL_CAPTURE_OFF


@pytest.mark.parametrize("value", ["on", "ON", "1", "true", "yes"])
def test_an_explicit_spelling_turns_capture_on(monkeypatch, value):
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, value)
    assert capture_enabled() is True


# ── the user's own blocklist, which outranks the switch ────────────────────

def test_a_blocked_domain_is_refused_even_with_capture_on(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason(BANK, Policy(blacklist=["bank.com"])) == \
        REFUSAL_DOMAIN_BLOCKED


def test_a_wildcard_blocklist_entry_is_refused(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason(BANK, Policy(blacklist=["*.bank.com"])) == \
        REFUSAL_DOMAIN_BLOCKED


def test_a_wildcard_entry_also_covers_www(monkeypatch):
    """`etld1` and `_hostname_only` both strip `www.`, and `*.bank.com` means
    subdomains only — so the one spelling a user actually types did not match
    the site they typed it for. A user who believes a site is blocked, and
    isn't, is worse off than one who never tried."""
    _on(monkeypatch)
    assert screenshot_block_reason(
        "https://www.bank.com/login/otp", Policy(blacklist=["*.bank.com"])
    ) == REFUSAL_DOMAIN_BLOCKED


def test_a_wildcard_entry_covers_the_bare_domain_too(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason(
        "https://bank.com/", Policy(blacklist=["*.bank.com"])
    ) == REFUSAL_DOMAIN_BLOCKED


def test_a_wildcard_entry_still_matches_subdomains(monkeypatch):
    """The widening is additive: nothing that matched before stopped."""
    _on(monkeypatch)
    assert screenshot_block_reason(
        "https://a.b.bank.com/x", Policy(blacklist=["*.bank.com"])
    ) == REFUSAL_DOMAIN_BLOCKED


def test_the_switch_allows_an_ordinary_page(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason(BOARD, Policy()) is None


def test_the_switch_allows_an_ordinary_page_with_no_policy(monkeypatch):
    """`deps.policy` is optional. No policy is not a refusal — the switch
    already decided, and inventing a blocklist here would be a server floor
    the user never asked for."""
    _on(monkeypatch)
    assert screenshot_block_reason(BOARD, None) is None


# ── a host this gate cannot name is a refusal, not an allow ───────────────

@pytest.mark.parametrize("url", [
    "http://192.168.1.1/",          # IP literal — etld1() returns None
    "http://10.0.0.5:8080/admin",
    "http://[::1]:8080/",
    "http://localhost:8080/",      # single label
    "http://intranet/",             # single label
    "not a url",                    # unparseable
    "",
    None,
])
def test_a_host_the_gate_cannot_name_is_refused(monkeypatch, url):
    """`check_domain_policy` answers n/a for all of these, and n/a is right for
    the approval path and wrong here: this gate's only answer to "I cannot
    resolve this" is no."""
    _on(monkeypatch)
    assert screenshot_block_reason(url, Policy()) == REFUSAL_UNKNOWN_URL


def test_an_unresolvable_url_is_refused_even_with_no_policy(monkeypatch):
    """The blocklist is the user's, but the hostname is the gate's own
    precondition — it does not need a policy to fail closed."""
    _on(monkeypatch)
    assert screenshot_block_reason("http://localhost:3000/", None) == \
        REFUSAL_UNKNOWN_URL


def test_the_unknown_url_reason_is_refused_before_the_domain(monkeypatch):
    """An unresolvable URL is refused whatever is on the list; the reason for
    an unresolvable host does not depend on the user's blacklist."""
    _on(monkeypatch)
    assert screenshot_block_reason(
        "http://intranet/", Policy(blacklist=["bank.com"])
    ) == REFUSAL_UNKNOWN_URL


# ── the reason is a closed vocabulary ──────────────────────────────────────

def test_the_reason_never_carries_the_url(monkeypatch):
    """It is read by a model and can reach a user-facing frame, so the domain
    must not be in it."""
    _on(monkeypatch)
    reason = screenshot_block_reason(BANK, Policy(blacklist=["bank.com"]))
    assert reason == REFUSAL_DOMAIN_BLOCKED
    assert "bank" not in reason and "otp" not in reason


def test_the_switch_is_checked_before_the_domain(monkeypatch):
    """With capture off the caller should learn nothing about where it is —
    including that this particular URL would have been blocked."""
    reason = screenshot_block_reason(BANK, Policy(blacklist=["bank.com"]))
    assert reason == REFUSAL_CAPTURE_OFF

# ── an internal name is not a public one, however many labels it has ───────

@pytest.mark.parametrize("url", [
    "http://nas.home/",       # two labels, and still a machine on a LAN
    "http://wiki.internal/",
    "http://router.lan/",
    "http://db.corp/",
    "http://nas.HOME/",       # case-folded before the comparison
    "http://x.onion/",
    "http://printer.local/",
    "http://host.invalid/",
    "http://gw.home.arpa/",
])
def test_an_internal_suffix_is_refused(monkeypatch, url):
    """`len(labels) < 2` refused `localhost` but let `nas.home` through, and
    a name inside somebody's network is the same thing wearing a second
    label. Refused for the same reason and with the same reason string.

    `box.dev` used to be in this list and is not any more: `.dev` is a
    delegated TLD, and refusing it also refused `agent.brotto.dev`, which is
    ours. See `test_our_own_relay_resolves_with_the_switch_on` for the trade
    this makes, which is that a `.dev` name on a LAN now resolves too."""
    _on(monkeypatch)
    assert screenshot_block_reason(url, Policy()) == REFUSAL_UNKNOWN_URL


@pytest.mark.parametrize("url", [
    BOARD,
    BANK,
    "https://www.example.com/",   # `example` is the reserved TLD, not the
                                  # registrable one — the suffix, not a name
    "https://agent.brotto.dev/",  # our own relay — the reason `dev` is not
                                  # in the deny set; see the test below
])
def test_a_public_host_is_still_allowed_when_the_switch_is_on(monkeypatch, url):
    """The negative control: a deny list that refused everything would pass
    every case above it."""
    _on(monkeypatch)
    assert screenshot_block_reason(url, Policy()) is None


def test_our_own_relay_resolves_with_the_switch_on(monkeypatch):
    """`dev` is a delegated TLD, not a special-use name, and this is the cost
    of getting that wrong in the other direction: `agent.brotto.dev` is a
    real host that the first-run wizard and the fallback UI point at, so a
    deny set containing `dev` refused to photograph our own relay.

    The trade this makes is deliberate and has to be stated, because it is
    not free: `_raw_host` sees only labels, so a `box.dev` on somebody's
    network is indistinguishable from a registrable `.dev` and now resolves
    too. The right side of that trade is to leave a real delegated TLD out —
    one name on a LAN is a user's own network, and they have their own
    blocklist — rather than in, where it also costs a shipped host.
    """
    _on(monkeypatch)
    assert screenshot_block_reason("https://agent.brotto.dev/", Policy()) is None
    # …and it is the *suffix* decision, not a special case for our domain:
    # another registrable `.dev` host is allowed by the same rule.
    assert screenshot_block_reason("https://someone-elses.dev/", Policy()) is None
