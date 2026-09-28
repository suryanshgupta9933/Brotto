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


# The wave each outcome points at. Mirrors
# docs/superpowers/specs/2026-09-28-capability-map-design.md.
WAVE_BY_OUTCOME: dict[Outcome, str] = {
    Outcome.PASS: "-",
    Outcome.PERCEPTION_FAILURE: "0A",
    Outcome.ACTION_FAILURE: "1",
    Outcome.RECOVERY_FAILURE: "2",
    Outcome.LOGIN_FAILURE: "2E",
    Outcome.BUDGET_EXHAUSTED: "5C",
    Outcome.HARNESS_ERROR: "0C",
}

# Order matters: the first substring found wins, so the more specific
# failure reasons are tested before the broader ones.
_RULES: tuple[tuple[Outcome, tuple[str, ...]], ...] = (
    (Outcome.LOGIN_FAILURE, ("login required", "login page", "session expired")),
    (Outcome.PERCEPTION_FAILURE, (
        "did not resolve", "not found in ax", "no target", "not visible", "truncated",
        "shadow", "iframe", "aria-hidden", "canvas",
    )),
    (Outcome.ACTION_FAILURE, (
        "did not change", "no effect", "element is not", "ref is stale",
    )),
    (Outcome.RECOVERY_FAILURE, ("stagnat", "loop", "popup", "cookie banner")),
    (Outcome.BUDGET_EXHAUSTED, ("budget exhausted", "token limit")),
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
