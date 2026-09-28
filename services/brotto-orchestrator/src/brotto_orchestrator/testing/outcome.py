"""Failure attribution.

The benchmark's primary output is not a score — it is which capability
failed. Each Outcome maps onto exactly one wave of the capability map, so
the tally of outcomes is what derives the next plan's priority order.
"""

from __future__ import annotations

from enum import Enum

from ..agent.context import TaskResult


class Outcome(str, Enum):
    PASS = "PASS"
    PERCEPTION_FAILURE = "PERCEPTION_FAILURE"
    ACTION_FAILURE = "ACTION_FAILURE"
    RECOVERY_FAILURE = "RECOVERY_FAILURE"
    LOGIN_FAILURE = "LOGIN_FAILURE"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    HARNESS_ERROR = "HARNESS_ERROR"


# The wave each outcome points at, using the spec's own labels
# (docs/superpowers/specs/2026-09-28-measurement-spine-design.md). The id is
# a comma/span string, not a single wave, where the spec lists more than one —
# collapsing 2A-2E to "2" would destroy the resolution that makes the tally
# usable as a work order.
WAVE_BY_OUTCOME: dict[Outcome, str] = {
    Outcome.PASS: "-",
    Outcome.PERCEPTION_FAILURE: "0A",
    Outcome.ACTION_FAILURE: "1A/1B/1C",
    Outcome.RECOVERY_FAILURE: "2A-2E",
    Outcome.LOGIN_FAILURE: "2E, 3A",
    Outcome.BUDGET_EXHAUSTED: "5C",
    Outcome.HARNESS_ERROR: "0C",
}

# Order matters: the first substring found wins, so the more specific
# failure reasons are tested before the broader ones. Every needle below is a
# string the repo actually emits — see agent/harness.py and agent/stagnation.py.
# HARNESS_ERROR is first: `auth_failed` is the *model provider* rejecting our
# API key (broken infrastructure), not a website login wall, and
# `model_not_found` / `cdp_preflight_failed` are equally ours, not the agent's.
# Note: user_denied, policy_blocked and policy_preflight are deliberate
# human/policy gates, not agent failures — they deliberately fall through to
# the RECOVERY_FAILURE default. Leave them there.
_RULES: tuple[tuple[Outcome, tuple[str, ...]], ...] = (
    (Outcome.HARNESS_ERROR, ("auth_failed", "model_not_found", "cdp_preflight_failed")),
    (Outcome.LOGIN_FAILURE, (
        "login required", "login page", "session expired", "user_skipped_login",
    )),
    (Outcome.PERCEPTION_FAILURE, (
        "did not resolve", "not found in ax", "does not exist in ax", "no target",
        "not visible", "truncated", "shadow", "iframe", "aria-hidden", "canvas",
    )),
    (Outcome.ACTION_FAILURE, (
        "did not change", "no effect", "element is not", "ref is stale",
    )),
    (Outcome.RECOVERY_FAILURE, ("stagnat", "loop", "popup", "cookie banner")),
    (Outcome.BUDGET_EXHAUSTED, ("budget exhausted", "token limit", "max_steps_exceeded")),
)

MAX_STEPS = 30  # harness.AgentHarness.MAX_STEPS


def classify(
    result: TaskResult,
    *,
    harness_error: BaseException | None = None,
    max_steps: int = MAX_STEPS,
) -> Outcome:
    """Resolve exactly one Outcome. Never raises, never defaults to PASS."""
    if harness_error is not None:
        return Outcome.HARNESS_ERROR
    if result.status == "completed":
        return Outcome.PASS
    if result.status in ("stagnated", "awaiting_human"):
        # TaskResult.status is authoritative here — these mean the task was
        # blocked, whatever the reason string happens to say.
        return Outcome.RECOVERY_FAILURE
    reason = (result.failure_reason or "").lower()
    for outcome, needles in _RULES:
        if any(needle in reason for needle in needles):
            return outcome
    if result.steps_taken >= max_steps:
        return Outcome.BUDGET_EXHAUSTED
    # Unrecognised failures are recovery failures: still a real failure, and
    # the reason string is preserved on the TaskRecord for triage.
    return Outcome.RECOVERY_FAILURE


# Alias so callers can write `OUTCOMES.PASS` without importing the class
# name, which reads better at call sites that never subclass it.
OUTCOMES = Outcome
