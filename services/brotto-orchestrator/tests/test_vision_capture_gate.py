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


def test_the_switch_allows_an_ordinary_page(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason(BOARD, Policy()) is None


def test_the_switch_allows_an_ordinary_page_with_no_policy(monkeypatch):
    """`deps.policy` is optional. No policy is not a refusal — the switch
    already decided, and inventing a blocklist here would be a server floor
    the user never asked for."""
    _on(monkeypatch)
    assert screenshot_block_reason(BOARD, None) is None


def test_an_unparseable_url_is_not_gated_on_garbage(monkeypatch):
    _on(monkeypatch)
    assert screenshot_block_reason("not a url", Policy(blacklist=["bank.com"])) \
        is None


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