"""Policy schema.

The floor policy is gone: the blacklist is whatever the user set in the
panel, so there is nothing to load and nothing to merge. What is left is
the schema itself, and the one tolerance that still matters — a policy
file written by an older build is still on disk in
`~/.brotto/policies/` and must keep parsing.
"""

from __future__ import annotations

from brotto_orchestrator.policy.schema import Policy, UserPolicy


def test_defaults_are_normal_and_empty():
    p = Policy()
    assert p.mode == "normal"
    assert p.blacklist == []
    assert p.first_time_seen_prompt is True


def test_user_policy_is_a_policy():
    # The extension payload is validated as UserPolicy and consumed as
    # Policy; a future split that breaks the subclass relationship would
    # fail at the harness boundary with a type error, not a readable one.
    assert issubclass(UserPolicy, Policy)
    assert UserPolicy(mode="secure", blacklist=["a.com"]).blacklist == ["a.com"]


def test_legacy_whitelist_fields_are_dropped_not_rejected():
    """A policy saved by a pre-redesign build carries `whitelist` and
    `block_blacklisted`. Pydantic 2 drops unknown fields silently, so an
    upgrade keeps working instead of every existing user hitting a parse
    error on their own saved settings."""
    p = UserPolicy.model_validate({
        "mode": "secure",
        "whitelist": ["bank.com"],
        "blacklist": ["evil.com"],
        "block_blacklisted": False,
    })
    assert p.mode == "secure"
    assert p.blacklist == ["evil.com"]
    assert not hasattr(p, "whitelist")
    assert not hasattr(p, "block_blacklisted")
