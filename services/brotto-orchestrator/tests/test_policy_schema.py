"""Policy schema.

Two fields, both content the user owns. There is no floor policy to load
and no mode to set — the blacklist is whatever the user set in the panel
and every gate runs. What is left to test is the schema itself, and the
one tolerance that still matters: a policy file written by an older build
is still on disk and must keep parsing.
"""

from __future__ import annotations

from brotto_orchestrator.policy.schema import Policy, UserPolicy


def test_defaults_are_empty_blacklist_with_sensitive_actions():
    p = Policy()
    assert p.blacklist == []
    assert p.sensitive_actions  # a curated list ships by default


def test_user_policy_is_a_policy():
    # The extension payload is validated as UserPolicy and consumed as
    # Policy; a future split that breaks the subclass relationship would
    # fail at the harness boundary with a type error, not a readable one.
    assert issubclass(UserPolicy, Policy)
    assert UserPolicy(blacklist=["a.com"]).blacklist == ["a.com"]


def test_legacy_whitelist_fields_are_dropped_not_rejected():
    """A policy saved by a pre-redesign build carries `whitelist` and
    `block_blacklisted`; one saved by a build that still had a mode carries
    `mode`. Pydantic 2 drops unknown fields silently, so an upgrade keeps
    working instead of every existing user hitting a parse error on their
    own saved settings."""
    p = UserPolicy.model_validate({
        "mode": "secure",
        "whitelist": ["bank.com"],
        "blacklist": ["evil.com"],
        "block_blacklisted": False,
        "first_time_seen_prompt": True,
    })
    assert p.blacklist == ["evil.com"]
    assert not hasattr(p, "mode")
    assert not hasattr(p, "whitelist")
    assert not hasattr(p, "block_blacklisted")
