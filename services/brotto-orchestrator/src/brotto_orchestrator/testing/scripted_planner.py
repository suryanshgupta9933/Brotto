"""Deterministic planner for perception and action tests.

The harness normally calls ``agent.run()``. This module replaces that with a
fixed sequence of ``AgentDecision`` values so that AX extraction, filtering,
and action execution can be tested with no model, no API key, and no network.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Sequence

from ..agent.context import (
    ActionCall,
    AgentDecision,
    AgentTurn,
    ScriptTargetUnresolved,
)

# One filtered AX line: `[off-screen] [ref] role "name"`. The off-screen
# block re-emits lines under a second prefix, so the prefix is matched
# optionally and never captured.
_AX_LINE = re.compile(r'(?:\[off-screen\]\s*)?\[([^\]]+)\]\s+(\S+)\s+"([^"]*)"')

_EXHAUSTED = "script exhausted"


def resolve_ref(ax_tree: str, name: str, *, role: str | None = None) -> str | None:
    """First ref whose accessible name matches, optionally filtered by role.

    Returns None rather than raising or guessing: a fabricated ref would be
    dispatched as a click against whatever occupies that slot, which turns a
    lookup miss into a silent mis-click.
    """
    for match in _AX_LINE.finditer(ax_tree or ""):
        ref, node_role, node_name = match.group(1), match.group(2), match.group(3)
        if node_name != name:
            continue
        if role is not None and node_role != role:
            continue
        return ref
    return None


def ref_by_name(name: str, *, role: str | None = None) -> Callable[[str], str | None]:
    """An action-arg value that resolves its ref when the step executes.

    Dynamic pages renumber refs on every re-render, so a ref baked into the
    script goes stale between the step being written and the step being run.
    """

    def _resolve(ax_tree: str) -> str | None:
        return resolve_ref(ax_tree, name, role=role)

    return _resolve


@dataclass(frozen=True)
class ScriptedStep:
    thought: str
    actions: Sequence[ActionCall]


def _resolve_args(action_args: dict, ax_tree: str) -> dict:
    """Call every callable arg against the current tree; literals pass through."""
    out: dict = {}
    for key, value in action_args.items():
        if not callable(value):
            out[key] = value
            continue
        resolved = value(ax_tree)
        if resolved is None:
            # Raising beats falling back to a previously-resolved ref, which
            # would click whatever now occupies that slot.
            raise ScriptTargetUnresolved(
                f"scripted action arg {key!r} did not resolve in the current AX tree"
            )
        out[key] = resolved
    return out


class ScriptedPlanner:
    """Replays a fixed decision sequence, then reports exhaustion."""

    def __init__(
        self,
        steps: Sequence[ScriptedStep],
        *,
        on_exhausted: str = "cannot_complete",
    ) -> None:
        if on_exhausted not in ("task_complete", "cannot_complete"):
            raise ValueError(
                f"on_exhausted must be task_complete or cannot_complete, "
                f"got {on_exhausted!r}"
            )
        self._steps = list(steps)
        self._on_exhausted = on_exhausted
        self._cursor = 0

    @property
    def steps(self) -> list[ScriptedStep]:
        return list(self._steps)

    @property
    def cursor(self) -> int:
        return self._cursor

    @property
    def remaining(self) -> int:
        return len(self._steps) - self._cursor

    def next(self, turn: AgentTurn) -> AgentDecision:
        if self._cursor < len(self._steps):
            step = self._steps[self._cursor]
            self._cursor += 1
            actions = [
                ActionCall(
                    action=a.action,
                    action_args=_resolve_args(a.action_args, turn.ax_tree),
                )
                for a in step.actions
            ]
            return AgentDecision(
                reasoning=f"scripted step {self._cursor}/{len(self._steps)}",
                thought=step.thought,
                actions=actions,
            )
        return AgentDecision(
            reasoning=f"{_EXHAUSTED} after {self._cursor} step(s)",
            thought=_EXHAUSTED,
            actions=[ActionCall(action=self._on_exhausted, action_args={})],
        )
