"""Redaction of page text before it reaches the model or the disk."""

from brotto_orchestrator.agent.context import Scratchpad
from brotto_orchestrator.agent.redact import (
    REDACTED,
    contains_sensitive,
    redact_text,
)


def test_a_live_card_number_is_replaced():
    out, counts = redact_text("Card 4111 1111 1111 1111 charged")
    assert "4111" not in out
    assert counts == {"card": 1}
    assert REDACTED in out


def test_a_number_that_fails_luhn_is_left_alone():
    # Order numbers are not cards, and redacting them is the known cost of
    # this module. A 16-digit id that fails the checksum is the cheap case.
    out, counts = redact_text("Order 4111111111111112 shipped")
    assert "4111111111111112" in out
    assert counts == {}


def test_credentials_keys_and_identifiers_are_replaced():
    for secret in (
        "ghp_abcdefghijklmnopqrstuvwxyz012345",
        "AKIAIOSFODNN7EXAMPLE",
        "xoxb-1234567890-abcdefghijkl",
        "sk-abcdefghijklmnopqrstuvwxyz",
        "eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM",
        "123-45-6789",
    ):
        out, counts = redact_text(f"value {secret} here")
        assert secret not in out, secret
        assert counts, secret


def test_an_ordinary_page_is_untouched():
    text = "Your order 4821 arrives Thursday. Total $38.20. Ref: XZ-9912."
    out, counts = redact_text(text)
    assert out == text
    assert counts == {}


def test_counts_are_per_kind_and_never_carry_the_value():
    out, counts = redact_text(
        "AKIAIOSFODNN7EXAMPLE AKIAIOSFODNN7EXAMPLE 123-45-6789")
    assert counts == {"aws-key-id": 2, "ssn": 1}
    assert "EXAMPLE" not in out


def test_empty_and_none_are_total():
    assert redact_text(None) == ("", {})
    assert redact_text("") == ("", {})
    assert contains_sensitive(None) is False
    assert contains_sensitive("nothing here") is False
    assert contains_sensitive("ghp_abcdefghijklmnopqrstuvwxyz012345") is True
