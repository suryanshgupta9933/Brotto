# Measurement Spine Implementation Plan (0B + 0C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Wave 0 something to develop against, and a way to tell improvement from regression — a scripted planner seam, a failure-attribution taxonomy, a real-browser harness that loads the actual extension, and eight authenticated fixture sites.

**Architecture:** A six-line seam in the harness lets a `ScriptedPlanner` replace `agent.run()` entirely, so perception and action work can be tested with no model, no key, and no network. The harness runs as a real subprocess; Playwright loads the real Chrome extension against it; the runner is a WebSocket client speaking the extension side of the existing wire protocol. Every run resolves to exactly one `Outcome` class, and the seven classes map 1:1 onto the capability map's waves — so the tally is what derives the next plan.

**Tech Stack:** Python 3.12, pytest (asyncio_mode=auto), Playwright 1.62 (already in the venv), pydantic v2, FastAPI + uvicorn, esbuild (existing).

**Spec:** `docs/superpowers/specs/2026-09-28-measurement-spine-design.md`
**Parent map:** `docs/superpowers/specs/2026-09-28-capability-map-design.md`

## Scope

This plan covers plan-decomposition steps 1–3 from the spec. It deliberately **excludes** the Tier 1 Mind2Web subset and the real logged-in chores, both of which trail without blocking Wave 0. Exit criteria 1–4 and 6 are in scope; exit criterion 5 (a public Tier 1 number) is not.

## Global Constraints

- **No new dependencies.** The JS runner is `node:test` against the existing esbuild output. Playwright is already an orchestrator dependency. Do not add vitest, jest, or a Node browser driver.
- **Test command is `./.venv/bin/python -m pytest tests/ -q` from `services/brotto-orchestrator/`.** The existing 188 tests must stay green at every commit. Task 1 is a seam addition, not a refactor.
- **`testing/` is a dev-and-test package, never imported by production paths.** It ships in the tree but nothing under `brotto_orchestrator.agent` or `brotto_orchestrator.main` may import it at runtime except the single guarded lookup in Task 5, which is a dev/test-only frame field.
- **The scripted planner must never be reachable in production.** The `script` field on `task_start` is honored only when `BROTTO_ENV=dev`; otherwise it is logged and ignored.
- **Every fixture is authenticated by design.** A fixture that does not require a login does not belong in the suite.
- **Comments explain WHY only.** Match the existing `ponytail:` comment convention for deliberate simplifications.
- **Never commit `Co-Authored-By: Claude ...`** in commit messages.

## Environment notes

Two things the implementing engineer will hit in the first hour. Neither
changes the design; both are one-line fixes.

1. **`websockets` is only a transitive dependency** (via `uvicorn[standard]`).
   `testing/runner.py` imports it directly, so add `"websockets>=12.0"` to the
   `dependencies` list in `pyproject.toml` as part of Task 3. This declares
   what is already installed (16.1.1 in the venv); it does not pull anything new.
2. **`pyproject.toml` declares `packages = ["brotto_orchestrator"]`**, which
   omits every subpackage. Today the project is installed editable via a plain
   `src` `.pth`, so `brotto_orchestrator.testing` resolves fine. Add
   `"brotto_orchestrator.testing"` to that list in Task 1 anyway — the list is
   what a wheel build would use, and `testing/` is the first subpackage anyone
   has added.

## Review Focus

Five input classes the spec implies but no task's happy-path test exercises. Each has a test pinned to the task that owns the code.

1. **The extension never loads** (bad path, service worker asleep, MV3 manifest error). Expected: the run fails fast as `HARNESS_ERROR` within a timeout — never hangs and never reports a `PERCEPTION_FAILURE` that blames the agent. → Task 5
2. **The fixture script is shorter than the task needs.** Expected: explicit planner exhaustion, not a silent 30-step `BUDGET_EXHAUSTED` that reads like a model failure. → Task 1
3. **A fixture that 404s or has a typo in its path.** Expected: fixture load is verified before the task starts; a load failure is `HARNESS_ERROR`, never a scored agent failure. → Task 4
4. **A stale Chrome profile with a previous session.** Expected: every fixture run starts from a clean profile, so "authenticated" is genuinely exercised. A reused profile silently converts an auth test into an anonymous one. → Task 5
5. **The target element moves between steps** (dynamic fixture, ref invalidated). Expected: the planner re-resolves the ref from the current AX tree on each step rather than caching it, and a failed resolution raises instead of clicking a stale ref. → Task 1

## File Structure

**New — orchestrator (`services/brotto-orchestrator/`):**

| Path | Responsibility |
|---|---|
| `src/brotto_orchestrator/testing/__init__.py` | Empty. Marks the package. |
| `src/brotto_orchestrator/testing/scripted_planner.py` | `ScriptedStep`, `ScriptedPlanner`, `resolve_ref`, `ref_by_name`. Deterministic decisions + AX-name→ref lookup. No I/O, no model. |
| `src/brotto_orchestrator/testing/scripts.py` | Named registry of `ScriptedPlanner` scripts, keyed by string. Dev-only lookup surface. |
| `src/brotto_orchestrator/testing/outcome.py` | `Outcome` enum + `classify()`. Pure function over a `TaskResult`. |
| `src/brotto_orchestrator/testing/records.py` | `TaskRecord` — one row of benchmark output. |
| `src/brotto_orchestrator/testing/fixtures.py` | `FixtureDef`, `FIXTURES`, `load_fixture()`. Data only, no serving. |
| `src/brotto_orchestrator/testing/server.py` | Serves fixture HTML. Two origins (main + iframe) for the cross-origin case. |
| `src/brotto_orchestrator/testing/browser.py` | Playwright persistent context with the extension loaded. |
| `src/brotto_orchestrator/testing/runner.py` | `run_task()` — orchestrator subprocess + browser + WS client. Emits `TaskRecord`. |
| `scripts/run_benchmark.py` | CLI. `--list`, `--fixture`, `--all`, `--out`. |
| `tests/fixtures/web/<name>/index.html` | Eight fixture sites, plus `auth-iframe/form.html` on the second origin. |

**Modified:**

| Path | Change |
|---|---|
| `src/brotto_orchestrator/agent/context.py` | Add `scripted_planner` field to `AgentDeps`. |
| `src/brotto_orchestrator/agent/harness.py` | Six-line seam at the plan call site; `_scripted_decision()` helper. |
| `src/brotto_orchestrator/main.py` | Parse `task_start.script` (dev-only) and pass into `AgentDeps`. |
| `clients/brotto-extension/package.json` | Add `test` script. |

**New — tests:**

| Path | Covers |
|---|---|
| `tests/testing/test_scripted_planner.py` | Task 1 |
| `tests/testing/test_outcome.py` | Task 2 |
| `tests/testing/test_runner.py` | Task 3 |
| `tests/testing/test_fixtures.py` | Task 4 |
| `tests/testing/test_browser_harness.py` | Task 5 |

---

### Task 1: Scripted planner seam

The smallest task; everything else depends on it. Adds a way for the harness to produce decisions with no model, no key, and no network.

**Files:**
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/__init__.py`
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/scripted_planner.py`
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/context.py:122-145` (add field to `AgentDeps`)
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py:865-870` (plan call site)
- Test: `services/brotto-orchestrator/tests/testing/test_scripted_planner.py`

**Interfaces:**
- Consumes: `ActionCall`, `AgentDecision`, `AgentTurn` from `brotto_orchestrator.agent.context` (all existing).
- Produces:
  - `resolve_ref(ax_tree: str, name: str, *, role: str | None = None) -> str | None`
  - `ref_by_name(name: str, *, role: str | None = None) -> Callable[[str], str | None]` — an action-arg value that resolves the ref at execution time, not at script-build time
  - `ScriptedStep(thought: str, actions: Sequence[ActionCall])`
  - `ScriptedPlanner(steps: Sequence[ScriptedStep], *, on_exhausted: str = "cannot_complete")` with `.next(turn: AgentTurn) -> AgentDecision`, `.steps`, `.cursor: int`, `.remaining: int`
  - `AgentDeps.scripted_planner: object | None = None`
  - `harness._scripted_decision(deps, turn) -> AgentDecision | None`

- [ ] **Step 1: Write the failing test**

Create `services/brotto-orchestrator/tests/testing/__init__.py` (empty) and `services/brotto-orchestrator/tests/testing/test_scripted_planner.py`:

```python
"""ScriptedPlanner: deterministic decisions with no model, key, or network."""

from __future__ import annotations

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentTurn
from brotto_orchestrator.testing.scripted_planner import (
    ScriptedPlanner,
    ScriptedStep,
    ref_by_name,
    resolve_ref,
)


AX = (
    'heading "Inbox"  [ref=heading_aaa111]\n'
    '[button_a1b2c3] button "Next"  [ref=button_a1b2c3]\n'
    '[textbox_d4e5f6] textbox "Search"  value=""\n'
    '[off-screen] [link_99aa11] link "Settings"  [ref=link_99aa11]\n'
)


def _turn(ax_tree: str = AX) -> AgentTurn:
    return AgentTurn(
        task="t", step_number=0, scratchpad_notes="", scratchpad_entries=[],
        current_url="http://x/", current_page_title="x", ax_tree=ax_tree,
        ax_diff="", step_summaries=[],
    )


# ── resolve_ref ─────────────────────────────────────────────────────────────

def test_resolve_ref_finds_by_accessible_name():
    assert resolve_ref(AX, "Next") == "button_a1b2c3"


def test_resolve_ref_ignores_off_screen_marker_in_ref():
    """The off-screen block is a second prefixed copy of the line. The ref
    captured there must still be the plain ref, not a line index."""
    assert resolve_ref(AX, "Settings") == "link_99aa11"


def test_resolve_ref_filters_by_role():
    assert resolve_ref(AX, "Next", role="link") is None
    assert resolve_ref(AX, "Next", role="button") == "button_a1b2c3"


def test_resolve_ref_missing_returns_none():
    """Never raises and never returns a stale ref — a fabricated ref would
    click whatever happens to occupy that slot."""
    assert resolve_ref(AX, "Nonexistent") is None


def test_resolve_ref_empty_tree_returns_none():
    assert resolve_ref("", "Next") is None


# ── ScriptedPlanner sequencing ──────────────────────────────────────────────

def _click(name: str) -> ScriptedStep:
    return ScriptedStep(
        thought=f"click {name}",
        actions=[ActionCall(action="click", action_args={"ref": ref_by_name(name)})],
    )


def test_next_returns_steps_in_order_then_exhausts():
    planner = ScriptedPlanner([_click("Next"), _click("Search")])
    assert planner.next(_turn()).actions[0].action_args["ref"] == "button_a1b2c3"
    assert planner.cursor == 1
    assert planner.next(_turn()).actions[0].action_args["ref"] == "textbox_d4e5f6"
    assert planner.cursor == 2


def test_exhaustion_is_explicit_not_a_silent_budget_failure():
    """Review Focus #2. Running past the script must say so, so a short
    script is never misread as a 30-step model failure."""
    planner = ScriptedPlanner([_click("Next")])
    planner.next(_turn())
    decision = planner.next(_turn())
    assert [a.action for a in decision.actions] == ["cannot_complete"]
    assert "script exhausted" in decision.reasoning


def test_exhaustion_on_empty_script():
    planner = ScriptedPlanner([])
    assert [a.action for a in planner.next(_turn()).actions] == ["cannot_complete"]


def test_on_exhausted_can_terminate_instead():
    planner = ScriptedPlanner([], on_exhausted="task_complete")
    assert [a.action for a in planner.next(_turn()).actions] == ["task_complete"]


def test_ref_is_resolved_per_step_not_cached():
    """Review Focus #5. Dynamic pages renumber refs constantly, so the ref
    must be looked up in the AX tree the step is actually about to act on."""
    planner = ScriptedPlanner([_click("Next"), _click("Next")])
    assert planner.next(_turn(AX)).actions[0].action_args["ref"] == "button_a1b2c3"
    moved = AX.replace("button_a1b2c3", "button_zzz999")
    assert planner.next(_turn(moved)).actions[0].action_args["ref"] == "button_zzz999"


def test_unresolvable_ref_raises_instead_of_clicking_stale():
    """A vanished target must fail loudly. Falling back to the previously
    resolved ref would click whatever now occupies that slot."""
    planner = ScriptedPlanner([_click("Next")])
    planner.next(_turn(AX))
    with pytest.raises(LookupError):
        planner.next(_turn(AX.replace('"Next"', '"Gone"')))
```

**Interfaces note:** pass `ref_by_name("Archive")` — not `resolve_ref(tree, "Archive")` —
as an `action_args` value. The planner calls it with the *current* turn's
`ax_tree` immediately before the step executes, so a script never holds a ref
that went stale while the page re-rendered.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_scripted_planner.py -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'brotto_orchestrator.testing'`

- [ ] **Step 3: Write the minimal implementation**

Create `src/brotto_orchestrator/testing/__init__.py` (empty file) and `src/brotto_orchestrator/testing/scripted_planner.py`:

```python
"""Deterministic planner for perception and action tests.

The harness normally calls ``agent.run()``. This module replaces that with a
fixed sequence of ``AgentDecision`` values so that AX extraction, filtering,
and action execution can be tested with no model, no API key, and no network.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Sequence

from ..agent.context import ActionCall, AgentDecision, AgentTurn

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
            raise LookupError(
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
```

- [ ] **Step 4: Add the `AgentDeps` field**

In `src/brotto_orchestrator/agent/context.py`, inside the `AgentDeps` dataclass, after the `policy` field, add:

```python
    # Test/dev only: a brotto_orchestrator.testing.ScriptedPlanner that
    # replaces agent.run() so perception and action work can be exercised
    # with no model, no key, and no network. Typed loosely to keep the
    # production package free of a dependency on testing/.
    scripted_planner: object = None
```

- [ ] **Step 5: Add the harness seam**

In `src/brotto_orchestrator/agent/harness.py`, add immediately above `class AgentHarness:`:

```python
def _scripted_decision(deps: AgentDeps, turn: AgentTurn) -> AgentDecision | None:
    """Return a scripted decision, or None to use the model as normal.

    Kept as a separate function so the branch is unit-testable without
    driving the full observe→plan→act loop.
    """
    planner = getattr(deps, "scripted_planner", None)
    if planner is None:
        return None
    return planner.next(turn)
```

Then, in `run()`, make **exactly two edits** inside the plan `try:` block.

**Edit 1** — replace this line:

```python
                if os.getenv("AGENT_MODEL") == "test":
```

with:

```python
                scripted = _scripted_decision(deps, turn)
                if scripted is not None:
                    # Test/dev path: no model, no key, no network. result is
                    # left None so the shared assignment below stays valid.
                    context_window = _CONTEXT_WINDOW_TOKENS
                    result = None
                elif os.getenv("AGENT_MODEL") == "test":
```

**Edit 2** — replace this line:

```python
                decision: AgentDecision = result.output
```

with:

```python
                decision: AgentDecision = (
                    scripted if scripted is not None else result.output
                )
```

Nothing else in the `try:` moves: the `else:` branch that resolves the model
config and calls `agent.run` keeps its current indentation and body.

**Edit 3** — immediately before `except UserError as e:`, add a third handler.
A scripted ref that no longer resolves is *the perception gap showing up*, not
a harness fault, so it must be attributed as one rather than crashing the task:

```python
            except LookupError as e:
                # A scripted ref that will not resolve means the target the
                # script asked for is not in the AX tree the agent sees —
                # that is the Wave 0 gap itself, not an infrastructure fault.
                deps.result = TaskResult(
                    status="failed",
                    summary=f"scripted target not found: {e}",
                    failure_reason=f"scripted target did not resolve: {e}",
                    policy_mode=_policy_mode(deps),
                )
                _CURRENT_DEPS = None
                continue
```

- [ ] **Step 6: Run the new tests and the full suite**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_scripted_planner.py -q
```
Expected: PASS

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/ -q
```
Expected: 188 passed (the pre-existing count) plus the new ones. **If any pre-existing test fails, the seam broke a path — fix that before continuing.**

- [ ] **Step 7: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/testing/ \
        services/brotto-orchestrator/src/brotto_orchestrator/agent/context.py \
        services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py \
        services/brotto-orchestrator/pyproject.toml \
        services/brotto-orchestrator/tests/testing/
git commit -m "harness: scripted-planner seam for model-free perception tests"
```

In the same commit, change `pyproject.toml`'s `packages = ["brotto_orchestrator"]`
to `packages = ["brotto_orchestrator", "brotto_orchestrator.testing"]` so the new
subpackage survives a wheel build.

---

### Task 2: Failure attribution taxonomy

The spec's core decision. Seven outcome classes, each mapping onto a wave.

**Files:**
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/outcome.py`
- Test: `services/brotto-orchestrator/tests/testing/test_outcome.py`

**Interfaces:**
- Consumes: `TaskResult` from `brotto_orchestrator.agent.context`.
- Produces: `Outcome` (str enum), `classify(result: TaskResult, *, harness_error: BaseException | None = None) -> Outcome`, `WAVE_BY_OUTCOME: dict[Outcome, str]`.

- [ ] **Step 1: Write the failing test**

Create `tests/testing/test_outcome.py`:

```python
"""Failure attribution: exactly one Outcome per run, mapped to a wave."""

from __future__ import annotations

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.testing.outcome import (
    OUTCOMES,
    WAVE_BY_OUTCOME,
    classify,
)


def _failed(reason: str, steps: int = 3) -> TaskResult:
    return TaskResult(status="failed", summary="", failure_reason=reason,
                      steps_taken=steps)


def test_harness_error_wins_over_everything():
    """A broken harness must never be scored as an agent failure — that
    blames the agent for our infrastructure."""
    assert classify(_failed("element not found"), harness_error=RuntimeError("boom")) \
        == OUTCOMES.HARNESS_ERROR


def test_completed_is_pass():
    assert classify(TaskResult(status="completed", summary="done")) == OUTCOMES.PASS


def test_perception_failure():
    assert classify(_failed("target not found in AX tree")) \
        == OUTCOMES.PERCEPTION_FAILURE


def test_unresolvable_scripted_target_is_perception_not_harness():
    """This is the shape a shadow-DOM / canvas / iframe gap actually takes
    end to end: the script asks for a target and the AX tree has no such
    name. Attributing it to the harness would empty the Wave 0 signal."""
    assert classify(_failed("scripted target did not resolve: 'Archive'")) \
        == OUTCOMES.PERCEPTION_FAILURE


def test_action_failure():
    assert classify(_failed("click did not change page state")) \
        == OUTCOMES.ACTION_FAILURE


def test_recovery_failure():
    assert classify(_failed("stagnated: 3 repeats at same url")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_login_failure():
    assert classify(_failed("login required")) == OUTCOMES.LOGIN_FAILURE


def test_budget_exhausted_at_max_steps():
    assert classify(_failed("unknown", steps=30)) == OUTCOMES.BUDGET_EXHAUSTED


def test_budget_exhausted_on_explicit_reason():
    assert classify(_failed("token budget exhausted")) == OUTCOMES.BUDGET_EXHAUSTED


def test_unknown_failure_is_recovery_not_pass():
    """Anything unrecognised must still land somewhere real. Defaulting to
    PASS would silently inflate the headline number."""
    assert classify(_failed("something nobody has seen before")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_awaiting_human_is_blocked_not_a_pass():
    assert classify(TaskResult(status="awaiting_human", summary="")) \
        == OUTCOMES.RECOVERY_FAILURE


def test_stagnated_status_is_a_recovery_failure():
    assert classify(TaskResult(status="stagnated", summary="", steps_taken=6)) \
        == OUTCOMES.RECOVERY_FAILURE


def test_login_page_beats_a_generic_stagnation_reason():
    """Rule order matters: a session wall is a LOGIN_FAILURE even when the
    harness also noticed the URL had stopped changing."""
    assert classify(_failed("login page — stagnant: 3 repeats", steps=3)) \
        == OUTCOMES.LOGIN_FAILURE


def test_every_outcome_maps_to_a_wave():
    assert set(WAVE_BY_OUTCOME) == set(OUTCOMES)
    assert all(isinstance(v, str) and v for v in WAVE_BY_OUTCOME.values())


def test_outcome_values_are_stable_strings():
    """Written into committed benchmark JSON. Renaming one silently breaks
    historical comparison."""
    assert OUTCOMES.PERCEPTION_FAILURE.value == "PERCEPTION_FAILURE"
    assert OUTCOMES.BUDGET_EXHAUSTED.value == "BUDGET_EXHAUSTED"
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_outcome.py -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'brotto_orchestrator.testing.outcome'`

- [ ] **Step 3: Write the implementation**

Create `src/brotto_orchestrator/testing/outcome.py`:

```python
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
```

Then add the `OUTCOMES` alias the test imports, at the bottom of the same file:

```python
# Alias so callers can write `OUTCOMES.PASS` without importing the class
# name, which reads better at call sites that never subclass it.
OUTCOMES = Outcome
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_outcome.py -q
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/testing/outcome.py \
        services/brotto-orchestrator/tests/testing/test_outcome.py
git commit -m "testing: failure attribution taxonomy mapped to capability waves"
```

---

### Task 3: Task record + runner

**Files:**
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/records.py`
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/runner.py`
- Test: `services/brotto-orchestrator/tests/testing/test_runner.py`

**Interfaces:**
- Consumes: `TaskResult` (existing), `Outcome`/`classify` (Task 2).
- Produces:
  - `TaskRecord` pydantic model, fields: `task_id: str`, `fixture: str`, `outcome: Outcome`, `steps_taken: int`, `tokens_in: int | None`, `tokens_out: int | None`, `usd: float | None`, `timing: dict[str, float]`, `final_url: str`, `approval_requested: bool`, `reason: str`
  - `usd_estimate(tokens_in: int, tokens_out: int, *, in_per_mtok: float, out_per_mtok: float) -> float`
  - `async def run_task(*, script_name: str, fixture_name: str, ws_base: str, timeout: float = 120.0) -> TaskRecord`

- [ ] **Step 1: Write the failing test**

Create `tests/testing/test_runner.py`:

```python
"""TaskRecord shape and the runner's error paths (no browser required)."""

from __future__ import annotations

import pytest

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.testing.outcome import OUTCOMES
from brotto_orchestrator.testing.records import TaskRecord, usd_estimate
from brotto_orchestrator.testing import runner as runner_mod


def test_usd_estimate():
    assert usd_estimate(1_000_000, 0, in_per_mtok=3.0, out_per_mtok=15.0) == 3.0
    assert usd_estimate(0, 2_000_000, in_per_mtok=3.0, out_per_mtok=15.0) == 30.0
    assert usd_estimate(0, 0, in_per_mtok=3.0, out_per_mtok=15.0) == 0.0


def test_record_requires_a_known_outcome():
    with pytest.raises(Exception):
        TaskRecord(task_id="t", fixture="f", outcome="NOT_A_CLASS",
                   steps_taken=0, tokens_in=None, tokens_out=None, usd=None,
                   timing={}, final_url="", approval_requested=False, reason="")


def test_record_round_trips_to_json():
    rec = TaskRecord(task_id="t", fixture="auth-shadow", outcome=OUTCOMES.PASS,
                     steps_taken=2, tokens_in=10, tokens_out=20, usd=0.001,
                     timing={"wall": 1.0}, final_url="http://x/",
                     approval_requested=False, reason="")
    assert '"PERCEPTION_FAILURE"' not in rec.model_dump_json()
    assert "auth-shadow" in rec.model_dump_json()


@pytest.mark.asyncio
async def test_timeout_is_a_harness_error_not_a_hang(monkeypatch):
    """Review Focus #1. A run that cannot connect must fail fast and be
    attributable to the harness, never to the agent."""
    async def _never(*a, **k):
        import asyncio
        await asyncio.sleep(3600)

    monkeypatch.setattr(runner_mod, "_connect", _never)
    rec = await runner_mod.run_task(
        script_name="s", fixture_name="auth-shadow", ws_base="ws://127.0.0.1:9",
        timeout=0.05,
    )
    assert rec.outcome == OUTCOMES.HARNESS_ERROR
    assert "timeout" in rec.reason.lower() or "error" in rec.reason.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_runner.py -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'brotto_orchestrator.testing.records'`

- [ ] **Step 3: Write `records.py`**

```python
"""One row of benchmark output."""

from __future__ import annotations

from pydantic import BaseModel

from .outcome import Outcome


class TaskRecord(BaseModel):
    task_id: str
    fixture: str
    outcome: Outcome
    steps_taken: int = 0
    tokens_in: int | None = None
    tokens_out: int | None = None
    usd: float | None = None
    timing: dict[str, float] = {}
    final_url: str = ""
    approval_requested: bool = False
    reason: str = ""


def usd_estimate(
    tokens_in: int, tokens_out: int, *, in_per_mtok: float, out_per_mtok: float
) -> float:
    return round(
        (tokens_in / 1_000_000) * in_per_mtok + (tokens_out / 1_000_000) * out_per_mtok,
        6,
    )
```

- [ ] **Step 4: Write `runner.py`**

Add `"websockets>=12.0"` to the `dependencies` list in `pyproject.toml` — it
arrives with `uvicorn[standard]` but `runner.py` imports it directly, so it
belongs declared.

```python
"""Drives one fixture task end to end and returns a TaskRecord.

The runner is a WebSocket client speaking the *extension* side of the
existing wire protocol. The real Chrome extension does the CDP work; this
module never touches CDP itself.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any

from .outcome import Outcome, classify
from .records import TaskRecord

log = logging.getLogger("brotto.testing.runner")

# Sonnet 4.6 class pricing, used only to put a number next to a run.
# Update when the default model changes; the benchmark stores the raw
# token counts too, so historical rows stay recomputable.
USD_IN_PER_MTOK = 3.00
USD_OUT_PER_MTOK = 15.00


async def _connect(ws_base: str, session_id: str, timeout: float) -> Any:
    """Open the extension WebSocket. Overridden in tests."""
    import websockets

    url = f"{ws_base.rstrip('/')}/ws/ext/{session_id}"
    return await asyncio.wait_for(websockets.connect(url), timeout=timeout)


def _record_from_result(
    *, task_id: str, fixture: str, result, final_url: str,
    approval_requested: bool, harness_error: BaseException | None = None,
) -> TaskRecord:
    outcome = classify(result, harness_error=harness_error)
    timing = dict(result.timing or {})
    tokens = timing.pop("tokens", None)
    tok_in = timing.pop("tokens_in", None)
    tok_out = timing.pop("tokens_out", None)
    usd = None
    if tok_in is not None or tok_out is not None:
        usd = usd_estimate(
            int(tok_in or 0), int(tok_out or 0),
            in_per_mtok=USD_IN_PER_MTOK, out_per_mtok=USD_OUT_PER_MTOK,
        )
    return TaskRecord(
        task_id=task_id,
        fixture=fixture,
        outcome=outcome,
        steps_taken=result.steps_taken,
        tokens_in=tok_in if tok_in is not None else tokens,
        tokens_out=tok_out,
        usd=usd,
        timing=timing,
        final_url=final_url,
        approval_requested=approval_requested,
        reason=result.failure_reason or ("" if harness_error is None else repr(harness_error)),
    )


def _err_record(*, task_id: str, fixture: str, reason: str) -> TaskRecord:
    return TaskRecord(
        task_id=task_id, fixture=fixture, outcome=Outcome.HARNESS_ERROR,
        steps_taken=0, tokens_in=None, tokens_out=None, usd=None,
        timing={}, final_url="", approval_requested=False, reason=reason,
    )


async def run_task(
    *, script_name: str, fixture_name: str, ws_base: str, timeout: float = 120.0
) -> TaskRecord:
    """Run one fixture. Always returns a TaskRecord; never raises."""
    task_id = f"{fixture_name}-{uuid.uuid4().hex[:8]}"
    try:
        session_id = str(uuid.uuid4())
        ws = await _connect(ws_base, session_id, timeout)
    except (asyncio.TimeoutError, OSError) as exc:
        # Review Focus #1 — fail fast, attributable to the harness.
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"connect failed: {exc!r}")
    except Exception as exc:  # noqa: BLE001
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"connect error: {exc!r}")

    approval_requested = False
    final_url = ""
    try:
        async with ws:
            await ws.send(json.dumps({
                "type": "task_start",
                "task": f"fixture:{fixture_name}",
                "script": script_name,
            }))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind in ("approval_required", "login_required"):
                    approval_requested = True
                    await ws.send(json.dumps({"type": "human_reply", "text": "skip"}))
                elif kind == "task_result":
                    final_url = msg.get("final_url", final_url)
                    return _record_from_result(
                        task_id=task_id, fixture=fixture_name,
                        result=_result_from_payload(msg), final_url=final_url,
                        approval_requested=approval_requested,
                    )
    except asyncio.TimeoutError:
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"timeout after {timeout}s")
    except Exception as exc:  # noqa: BLE001
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"protocol error: {exc!r}")


def _result_from_payload(msg: dict) -> Any:
    """Rebuild a TaskResult from the task_result WS frame."""
    from ..agent.context import TaskResult

    return TaskResult(
        status=msg.get("status", "failed"),
        summary=msg.get("summary", ""),
        extracted_data=msg.get("extracted_data"),
        steps_taken=int(msg.get("steps_taken", 0) or 0),
        failure_reason=msg.get("failure_reason"),
        tried=list(msg.get("tried", []) or []),
        timing=msg.get("timing"),
    )
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_runner.py -q
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/testing/records.py \
        services/brotto-orchestrator/src/brotto_orchestrator/testing/runner.py \
        services/brotto-orchestrator/tests/testing/test_runner.py \
        services/brotto-orchestrator/pyproject.toml
git commit -m "testing: TaskRecord and runner that always returns an attributable result"
```

---

### Task 4: Fixture sites

Eight authenticated sites, one per verified gap.

**Files:**
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-shadow/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-iframe/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-iframe/form.html` (second origin)
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-aria-hidden/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-canvas/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-slowjs/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-inbox/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-popup/index.html`
- Create: `services/brotto-orchestrator/tests/fixtures/web/auth-tabbed/index.html`
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/fixtures.py`
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/server.py`
- Test: `services/brotto-orchestrator/tests/testing/test_fixtures.py`

**Interfaces:**
- Produces: `FixtureDef(name, path, port, target_name, targets_gap, iframe_port=None)`, `FIXTURES: list[FixtureDef]`, `load_fixture(name) -> FixtureDef` (raises `KeyError`), `MAIN_PORT = 8811`, `IFRAME_PORT = 8812`, and `server.serve_fixtures(port)` / `server.serve_iframe_origin(port)` context managers.

- [ ] **Step 1: Write the failing test**

Create `tests/testing/test_fixtures.py`:

```python
from __future__ import annotations

import pathlib

import pytest

from brotto_orchestrator.testing.fixtures import FIXTURES, load_fixture

WEB = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "web"

EXPECTED = {
    "auth-shadow": "shadow_dom",
    "auth-iframe": "iframe",
    "auth-aria-hidden": "aria_hidden",
    "auth-canvas": "canvas",
    "auth-slowjs": "slow_js",
    "auth-inbox": "truncation",
    "auth-popup": "popup",
    "auth-tabbed": "tabbed",
}


def test_all_eight_fixtures_registered():
    assert {f.name for f in FIXTURES} == set(EXPECTED)


def test_every_fixture_has_a_page_on_disk():
    for f in FIXTURES:
        assert (WEB / f.name / "index.html").is_file(), f.name


def test_gap_mapping_is_exact():
    assert {f.name: f.targets_gap for f in FIXTURES} == EXPECTED


def test_every_fixture_declares_a_target_name():
    for f in FIXTURES:
        assert f.target_name, f.name


def test_iframe_fixture_uses_a_second_origin():
    """A same-origin iframe is not a cross-origin test."""
    html = (WEB / "auth-iframe" / "index.html").read_text()
    assert f":{load_fixture('auth-iframe').iframe_port}" in html


def test_every_fixture_requires_a_login():
    for f in FIXTURES:
        html = (WEB / f.name / "index.html").read_text()
        assert 'id="login"' in html, f"{f.name} must present a login form first"


def test_load_fixture_rejects_unknown():
    with pytest.raises(KeyError):
        load_fixture("auth-nope")
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_fixtures.py -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'brotto_orchestrator.testing.fixtures'`

- [ ] **Step 3: Write `fixtures.py`**

```python
"""Fixture catalogue. Data only — serving lives in server.py."""

from __future__ import annotations

from pydantic import BaseModel

# Two ports so auth-iframe can embed a genuinely cross-origin frame.
MAIN_PORT = 8811
IFRAME_PORT = 8812


class FixtureDef(BaseModel):
    name: str
    path: str
    port: int
    target_name: str      # accessible name the scripted task must reach
    targets_gap: str
    iframe_port: int | None = None


FIXTURES: list[FixtureDef] = [
    FixtureDef(name="auth-shadow", path="/auth-shadow/", port=MAIN_PORT,
               target_name="Archive", targets_gap="shadow_dom"),
    FixtureDef(name="auth-iframe", path="/auth-iframe/", port=MAIN_PORT,
               target_name="Confirm", targets_gap="iframe", iframe_port=IFRAME_PORT),
    FixtureDef(name="auth-aria-hidden", path="/auth-aria-hidden/", port=MAIN_PORT,
               target_name="Publish", targets_gap="aria_hidden"),
    FixtureDef(name="auth-canvas", path="/auth-canvas/", port=MAIN_PORT,
               target_name="Draw", targets_gap="canvas"),
    FixtureDef(name="auth-slowjs", path="/auth-slowjs/", port=MAIN_PORT,
               target_name="Loaded", targets_gap="slow_js"),
    FixtureDef(name="auth-inbox", path="/auth-inbox/", port=MAIN_PORT,
               target_name="Message 60", targets_gap="truncation"),
    FixtureDef(name="auth-popup", path="/auth-popup/", port=MAIN_PORT,
               target_name="Accept", targets_gap="popup"),
    FixtureDef(name="auth-tabbed", path="/auth-tabbed/", port=MAIN_PORT,
               target_name="Panel Three", targets_gap="tabbed"),
]

_BY_NAME = {f.name: f for f in FIXTURES}


def load_fixture(name: str) -> FixtureDef:
    return _BY_NAME[name]
```

- [ ] **Step 4: Write the fixture pages**

Every fixture shares the same login gate — the content only mounts *after*
`enter()` runs, so "authenticated" is a real state change and a test that
never logs in scores a perception failure rather than passing vacuously.

**`tests/fixtures/web/auth-shadow/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — shadow</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      const host = document.getElementById('app');
      host.innerHTML = '<div id="root"></div>';
      const root = document.getElementById('root').attachShadow({ mode: 'open' });
      root.innerHTML = '<h2>Inbox</h2><button aria-label="Archive">Archive</button>';
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-iframe/index.html`** — the form lives in a second origin, so the frame is genuinely cross-origin.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — iframe</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      document.getElementById('app').innerHTML =
        '<h2>Payment</h2>' +
        '<iframe src="http://127.0.0.1:8812/form.html" width="420" height="140"></iframe>';
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-iframe/form.html`** — second origin, holds the only `Confirm` control on the page.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Payment form</title></head>
<body style="font-family:system-ui">
  <label for="card">Card</label><input id="card">
  <button aria-label="Confirm">Confirm</button>
</body></html>
```

**`tests/fixtures/web/auth-aria-hidden/index.html`** — the control is focusable and in the DOM but removed from the AX tree.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — aria-hidden</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      document.getElementById('app').innerHTML =
        '<h2>Draft</h2>' +
        '<div aria-hidden="true"><button>Publish</button></div>';
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-canvas/index.html`** — everything is painted; nothing is in the AX tree. A canvas fallback is the only way to see the target.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — canvas</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      document.getElementById('app').innerHTML = '<canvas id="c" width="420" height="160"></canvas>';
      const g = document.getElementById('c').getContext('2d');
      g.fillStyle = '#eee'; g.fillRect(0, 0, 420, 160);
      g.fillStyle = '#111'; g.font = '16px system-ui';
      g.fillText('Board', 20, 40);
      g.fillRect(20, 70, 200, 44);
      g.fillText('Draw', 90, 98);
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-slowjs/index.html`** — content lands well after the document is ready, so an un-waited read sees an empty page.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — slowjs</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      setTimeout(function () {
        document.getElementById('app').innerHTML =
          '<h2>Report</h2><button>Loaded</button>';
      }, 1200);
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-inbox/index.html`** — 60 rows, well past the 6000-char / 50-target caps. The last row is the target.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — inbox</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      let rows = '';
      for (let i = 1; i <= 60; i++) {
        rows += '<div><a href="#m' + i + '">Message ' + i + '</a></div>';
      }
      document.getElementById('app').innerHTML = '<h2>Inbox</h2>' + rows;
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-popup/index.html`** — a modal that blocks the underlying control until dismissed.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — popup</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      document.getElementById('app').innerHTML =
        '<h2>Settings</h2><button>Delete account</button>';
      const back = document.createElement('div');
      back.setAttribute('role', 'dialog');
      back.setAttribute('aria-label', 'Cookie notice');
      back.style.cssText = 'position:fixed;inset:0;background:#0008;display:flex;' +
        'align-items:center;justify-content:center';
      back.innerHTML = '<div style="background:#fff;padding:24px">' +
        '<p>We use cookies.</p><button aria-label="Accept">Accept</button></div>';
      document.body.appendChild(back);
    }
  </script>
</body></html>
```

**`tests/fixtures/web/auth-tabbed/index.html`** — nested frames, the multi-tab / frame-tree surface.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Brotto fixture — tabbed</title></head>
<body>
  <h1>Sign in</h1>
  <form id="login" onsubmit="event.preventDefault();enter()">
    <label for="u">Email</label><input id="u" type="email">
    <label for="p">Password</label><input id="p" type="password">
    <button type="submit">Sign in</button>
  </form>
  <div id="app"></div>
  <script>
    function enter() {
      document.getElementById('app').innerHTML =
        '<div role="tablist">' +
        '<button role="tab" onclick="show(3)">Open Panel Three</button>' +
        '</div><div id="panel"></div>';
      show(3);
    }
    function show(n) {
      document.getElementById('panel').innerHTML =
        '<div>Panel ' + n + ' content' +
        '<div><iframe srcdoc="&lt;button aria-label=&quot;Panel Three&quot;&gt;Panel Three&lt;/button&gt;" width="300" height="80"></iframe></div>' +
        '</div>';
    }
  </script>
</body></html>
```

The target `Panel Three` appears **only inside a nested frame** — the visible
tab is named `Open Panel Three` so it cannot satisfy the lookup. The script
cannot reach the target until frame traversal lands, which is the point.

- [ ] **Step 5: Write `server.py`**

**`src/brotto_orchestrator/testing/server.py`**

```python
"""Serves the fixture sites on two ports so auth-iframe is really cross-origin."""

from __future__ import annotations

import contextlib
import functools
import pathlib
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ponytail: the fixture HTML lives under tests/ rather than inside the
# package. Fixtures are test assets, not a shipped artifact, and copying
# them would let the benchmark drift from the pages it measures.
PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[2]   # src/brotto_orchestrator
REPO_ORCHESTRATOR = PACKAGE_ROOT.parents[1]                   # services/brotto-orchestrator
WEB_ROOT = REPO_ORCHESTRATOR / "tests" / "fixtures" / "web"


class _Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # silence per-request noise
        pass


@contextlib.contextmanager
def serving(directory: pathlib.Path, port: int):
    """Serve `directory` on `port` for the life of the context."""
    handler = functools.partial(_Handler, directory=str(directory))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def serve_fixtures(port: int):
    return serving(WEB_ROOT, port)


def serve_iframe_origin(port: int):
    # Rooted one level down so the auth-iframe page can reference /form.html
    # while living on a different port than the page that embeds it.
    return serving(WEB_ROOT / "auth-iframe", port)
```

The static server lives here rather than under `tests/` because `testing/` is an
installed package and `tests/` is not — an import across that boundary only
works from a source checkout, and `run_benchmark.py` has to run installed.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_fixtures.py -q
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/brotto-orchestrator/tests/fixtures/ \
        services/brotto-orchestrator/src/brotto_orchestrator/testing/fixtures.py \
        services/brotto-orchestrator/src/brotto_orchestrator/testing/server.py \
        services/brotto-orchestrator/tests/testing/test_fixtures.py
git commit -m "testing: eight authenticated fixtures, one per verified Wave 0 gap"
```

---

### Task 5: Real-browser harness

**Files:**
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/browser.py`
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/testing/scripts.py`
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/main.py` (insert the `script` parse immediately before `deps = AgentDeps(`, and add `scripted_planner=scripted_planner,` to that call)
- Modify: `clients/brotto-extension/package.json` (add `test` script)
- Test: `services/brotto-orchestrator/tests/testing/test_browser_harness.py`

**Interfaces:**
- Consumes: `ScriptedPlanner`/`ScriptedStep`/`ref_by_name` (Task 1), `FixtureDef`/`load_fixture` (Task 4).
- Produces: `brotto_browser(*, extension_dir, headless=True)` async context manager yielding a Playwright `BrowserContext`; `build_script(name) -> ScriptedPlanner`, `get_script(name) -> ScriptedPlanner` (raises `KeyError` naming what is available), `SCRIPT_NAMES: tuple[str, ...]`; `task_start` accepts optional `script: str`.

- [ ] **Step 1: Write the failing test**

Create `tests/testing/test_browser_harness.py`:

```python
"""Real-browser harness. Slow and networkless; opt in explicitly."""

from __future__ import annotations

import os
import pathlib

import pytest

from brotto_orchestrator.testing.fixtures import load_fixture
from brotto_orchestrator.testing.scripts import get_script, SCRIPT_NAMES

pytestmark = pytest.mark.skipif(
    os.getenv("BROTTO_E2E") != "1",
    reason="set BROTTO_E2E=1 to run real-browser tests",
)

EXT = pathlib.Path(__file__).resolve().parents[2].parents[1] / "clients" / "brotto-extension" / "dist"


def test_every_fixture_has_a_script():
    """A fixture with no script can only ever record HARNESS_ERROR."""
    for f in ("auth-shadow", "auth-iframe", "auth-aria-hidden", "auth-canvas",
              "auth-slowjs", "auth-inbox", "auth-popup", "auth-tabbed"):
        assert f in SCRIPT_NAMES, f


def test_script_reaches_fixture_target():
    from brotto_orchestrator.testing.fixtures import FIXTURES
    for fx in FIXTURES:
        script = get_script(fx.name)
        assert script.steps, fx.name


def test_extension_dist_exists():
    assert (EXT / "manifest.json").is_file(), "run `npm run build` in clients/brotto-extension first"


@pytest.mark.asyncio
async def test_browser_launches_with_clean_profile():
    """Review Focus #4. A reused profile carries a previous session, which
    silently turns an authenticated fixture test into an anonymous one."""
    from brotto_orchestrator.testing.browser import brotto_browser
    async with brotto_browser(extension_dir=str(EXT)) as ctx:
        assert ctx is not None
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/testing/test_browser_harness.py -q
```
Expected: SKIPPED without `BROTTO_E2E=1`; with `BROTTO_E2E=1`, FAIL — `ModuleNotFoundError: ... testing.browser`

- [ ] **Step 3: Write `browser.py`**

```python
"""Playwright context with the real Brotto extension loaded."""

from __future__ import annotations

import contextlib
import pathlib
import tempfile
from typing import AsyncIterator

from playwright.async_api import BrowserContext, async_playwright


@contextlib.asynccontextmanager
async def brotto_browser(
    *, extension_dir: str, headless: bool = True
) -> AsyncIterator[BrowserContext]:
    """Launch Chrome with the extension and a throwaway profile.

    ponytail: a temp profile per launch. A persistent one would carry the
    previous fixture's session, so an 'authenticated' test could pass
    without ever logging in.
    """
    ext = str(pathlib.Path(extension_dir).resolve())
    if not (pathlib.Path(ext) / "manifest.json").is_file():
        raise FileNotFoundError(
            f"no manifest.json under {ext} — run `npm run build` in "
            f"clients/brotto-extension first"
        )
    with tempfile.TemporaryDirectory(prefix="brotto-profile-") as profile:
        args = [
            f"--disable-extensions-except={ext}",
            f"--load-extension={ext}",
            f"--user-data-dir={profile}",
        ]
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=headless, args=args, channel="chrome"
            )
            try:
                yield await browser.new_context(no_viewport=True)
            finally:
                await browser.close()
```

If `channel="chrome"` is unavailable in the dev environment, drop that
argument and use Playwright's bundled Chromium; note the change in the commit
body. The `FileNotFoundError` guard is Review Focus #1 — a missing build must
fail loudly at launch, not produce a browser with no extension and a run full
of phantom perception failures.

- [ ] **Step 4: Write `scripts.py`**

```python
"""Named scripted tasks, one per fixture. Dev/test only."""

from __future__ import annotations

from ..agent.context import ActionCall
from .fixtures import FIXTURES, load_fixture
from .scripted_planner import ScriptedPlanner, ScriptedStep, ref_by_name

SCRIPT_NAMES: tuple[str, ...] = tuple(f.name for f in FIXTURES)


def _login_steps() -> list[ScriptedStep]:
    """Every fixture gates its content behind the same login form."""
    return [
        ScriptedStep(
            thought="enter email",
            actions=[ActionCall(action="type_text",
                                action_args={"text": "dev@example.com",
                                             "ref": ref_by_name("Email", role="textbox")})],
        ),
        ScriptedStep(
            thought="enter password",
            actions=[ActionCall(action="type_text",
                                action_args={"text": "hunter2",
                                             "ref": ref_by_name("Password", role="textbox")})],
        ),
        ScriptedStep(
            thought="sign in",
            actions=[ActionCall(action="click",
                                action_args={"ref": ref_by_name("Sign in", role="button")})],
        ),
    ]


def build_script(name: str) -> ScriptedPlanner:
    """Steps that log in, then reach the fixture's declared target."""
    fx = load_fixture(name)
    return ScriptedPlanner(
        _login_steps()
        + [
            ScriptedStep(
                thought=f"reach {fx.target_name}",
                actions=[ActionCall(action="click",
                                    action_args={"ref": ref_by_name(fx.target_name)})],
            ),
            ScriptedStep(thought="done", actions=[ActionCall(
                action="task_complete", action_args={})]),
        ],
        on_exhausted="task_complete",
    )


def get_script(name: str) -> ScriptedPlanner:
    if name not in SCRIPT_NAMES:
        raise KeyError(f"no script {name!r}; available: {', '.join(SCRIPT_NAMES)}")
    return build_script(name)
```

`on_exhausted="task_complete"` rather than `cannot_complete`: a script that
ran off its end means the fixture never presented an obstacle the script
did not anticipate, so the chore is done. Real `cannot_complete` comes from
the model, which is not in the loop here.

The login steps assume the AX extractor surfaces the `<label>` text as the
control's accessible name (`Email`, `Password`) and Chrome's role for both as
`textbox`. If `resolve_ref` returns `None` on the first real run, that
assumption is wrong — check `dev/ax_tree_extractor.py` for how `name` is
derived and correct the string here, rather than loosening the matcher.

- [ ] **Step 5: Wire `script` through `task_start`**

In `main.py`, add this immediately before the `deps = AgentDeps(` call — after
`merge_policy` has run, so the planner is constructed with the task's real
policy in place:

```python
    # Test/dev only. Honor `script` solely in dev so a production server
    # can never be driven by a client-supplied decision sequence.
    scripted_planner = None
    script_name = msg.get("script")
    if script_name:
        if os.getenv("BROTTO_ENV", "dev") == "prod":
            log.warning("[%s] ignoring task_start script in prod  name=%s",
                        session_id, script_name)
        else:
            from .testing.scripts import SCRIPT_NAMES, build_script
            if script_name not in SCRIPT_NAMES:
                log.warning("[%s] unknown script %r — closing", session_id, script_name)
                await websocket.close(code=4000)
                return
            scripted_planner = build_script(script_name)
```

and add `scripted_planner=scripted_planner,` to the `AgentDeps(...)`
construction in the same handler.

- [ ] **Step 6: Add the extension test script**

In `clients/brotto-extension/package.json`, add:

```json
"test": "npm run build && node --test tests/*.test.js"
```

- [ ] **Step 7: Run the tests**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python -m pytest tests/ -q
cd ../../clients/brotto-extension && npm run build && npm test
```
Expected: all pass; the harness tests skip without `BROTTO_E2E=1`.

- [ ] **Step 8: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/testing/browser.py \
        services/brotto-orchestrator/src/brotto_orchestrator/testing/scripts.py \
        services/brotto-orchestrator/src/brotto_orchestrator/main.py \
        services/brotto-orchestrator/tests/testing/test_browser_harness.py \
        clients/brotto-extension/package.json
git commit -m "testing: real-browser harness loading the actual extension"
```

---

### Task 6: Baseline and the regression proof

Exit criterion 6. If this task cannot make the suite go red, the harness is decorative and the workstream is not done.

**Files:**
- Create: `services/brotto-orchestrator/scripts/run_benchmark.py`
- Create: `services/brotto-orchestrator/tests/fixtures/baseline.json`

**Interfaces:**
- Consumes: `run_task` (Task 3), `FIXTURES` (Task 4), `brotto_browser` (Task 5).
- Produces: CLI writing `tests/fixtures/baseline.json`; `--check` exits non-zero on regression.

- [ ] **Step 1: Write the CLI**

Create `scripts/run_benchmark.py`:

```python
#!/usr/bin/env python
"""Run the authenticated fixture suite and report failure attribution.

The score is secondary. The output that matters is the per-Outcome tally,
because each Outcome maps onto one wave of the capability map — the tally is
what derives the next plan's priority order.

Usage:
    python scripts/run_benchmark.py --list
    python scripts/run_benchmark.py --all --out tests/fixtures/baseline.json
    python scripts/run_benchmark.py --all --check
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from brotto_orchestrator.testing.fixtures import FIXTURES, IFRAME_PORT, MAIN_PORT, load_fixture
from brotto_orchestrator.testing.outcome import WAVE_BY_OUTCOME
from brotto_orchestrator.testing.records import TaskRecord
from brotto_orchestrator.testing.runner import run_task
from brotto_orchestrator.testing.server import serve_fixtures, serve_iframe_origin

log = logging.getLogger("brotto.benchmark")

WS_BASE = "ws://127.0.0.1:8000"
BASELINE = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "baseline.json"

# Ordered worst-first: a PASS to its left is a regression, a PASS to its
# right is progress. This is the only ordering that matters for --check.
_SEVERITY = [
    "PERCEPTION_FAILURE", "ACTION_FAILURE", "RECOVERY_FAILURE",
    "LOGIN_FAILURE", "BUDGET_EXHAUSTED", "HARNESS_ERROR", "PASS",
]


def _rank(outcome: str) -> int:
    return _SEVERITY.index(outcome) if outcome in _SEVERITY else len(_SEVERITY)


def _tally(records: list[TaskRecord]) -> dict[str, int]:
    tally: dict[str, int] = {}
    for rec in records:
        tally[rec.outcome.value] = tally.get(rec.outcome.value, 0) + 1
    return tally


def _report(records: list[TaskRecord]) -> dict[str, int]:
    tally = _tally(records)
    for outcome, wave in WAVE_BY_OUTCOME.items():
        if tally.get(outcome.value):
            log.info("%-20s %2d  → wave %s", outcome.value, tally[outcome.value], wave)
    return tally


async def _run(names: list[str]) -> list[TaskRecord]:
    with serve_fixtures(MAIN_PORT), serve_iframe_origin(IFRAME_PORT):
        records = []
        for name in names:
            fx = load_fixture(name)
            records.append(await run_task(
                script_name=fx.name,
                fixture_name=fx.name,
                ws_base=WS_BASE,
            ))
            log.info("%-16s %s", name, records[-1].outcome.value)
    return records


def _check(records: list[TaskRecord]) -> int:
    """Exit 1 if any fixture is worse than its recorded baseline."""
    if not BASELINE.is_file():
        log.error("no baseline at %s — record one before using --check", BASELINE)
        return 1
    baseline = {
        r["fixture"]: r["outcome"]
        for r in json.loads(BASELINE.read_text())["records"]
    }
    regressions = 0
    for rec in records:
        was = baseline.get(rec.fixture)
        if was is None:
            log.warning("%-16s no baseline entry", rec.fixture)
            continue
        if _rank(rec.outcome.value) > _rank(was):
            log.error("REGRESSION %-16s %s → %s", rec.fixture, was, rec.outcome.value)
            regressions += 1
        elif _rank(rec.outcome.value) < _rank(was):
            log.info("improved    %-16s %s → %s", rec.fixture, was, rec.outcome.value)
    return 1 if regressions else 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="list fixtures and exit")
    ap.add_argument("--fixture", action="append", default=[], help="run one fixture (repeatable)")
    ap.add_argument("--all", action="store_true", help="run every fixture")
    ap.add_argument("--check", action="store_true", help="fail on regression vs baseline.json")
    ap.add_argument("--out", help="write the run document here")
    args = ap.parse_args()

    if args.list:
        for f in FIXTURES:
            print(f"{f.name:<18} targets {f.targets_gap:<12} goal={f.target_name!r}")
        return 0

    names = [f.name for f in FIXTURES] if args.all else args.fixture
    if not names:
        ap.error("pass --list, --fixture NAME, or --all")

    records = asyncio.run(_run(names))
    tally = _report(records)
    document = {
        "records": [r.model_dump(mode="json") for r in records],
        "tally": tally,
    }

    if args.out:
        out = pathlib.Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(document, indent=2) + "\n")
        log.info("wrote %s", out)
    else:
        print(json.dumps(document, indent=2))

    if args.check:
        return _check(records)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Note `_SEVERITY` puts `HARNESS_ERROR` below `PERCEPTION_FAILURE` deliberately: a
broken harness is not a perception regression, and a run dominated by harness
errors should not read as though perception got worse.

- [ ] **Step 2: Record the baseline**

```bash
cd services/brotto-orchestrator && ./.venv/bin/python scripts/run_benchmark.py --all \
  --out tests/fixtures/baseline.json
```
Expected: eight `TaskRecord`s. Commit the file even if most outcomes are
`PERCEPTION_FAILURE` — that is the honest starting point, since the seven
gaps are unfixed.

- [ ] **Step 3: Prove the harness detects a regression**

Deliberately break perception in `src/brotto_orchestrator/agent/ax_filter.py` by
raising `KEEP_ROLES` filtering so `button` is stripped:

```python
STRIP_ROLES = {"generic", "none", "presentation", "separator", "button"}
```

Then:

```bash
cd services/brotto-orchestrator && ./.venv/bin/python scripts/run_benchmark.py --all --check
```
Expected: **non-zero exit**, with `auth-shadow` regressing from its recorded
baseline. If it still passes, the harness is not observing the agent's
perception and Task 5 is not actually done — go back to it.

- [ ] **Step 4: Revert the deliberate break and confirm green**

```bash
cd services/brotto-orchestrator && git checkout src/brotto_orchestrator/agent/ax_filter.py
./.venv/bin/python scripts/run_benchmark.py --all --check
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/brotto-orchestrator/scripts/run_benchmark.py \
        services/brotto-orchestrator/tests/fixtures/baseline.json
git commit -m "testing: benchmark CLI and recorded baseline; verified it catches a real regression"
```

---

## Follow-on (deliberately out of this plan)

- **Tier 1 Mind2Web subset** — spec exit criterion 5. Needs a frozen subset decision and outbound network.
- **Real logged-in chores** — needs accounts we control; slowest and least deterministic.
- **JS unit tests for the extension** — the `npm test` script is wired in Task 5; the first real `*.test.js` files belong with Wave 0A, when there is extension logic worth pinning.

## Follow-ups

- [ ] Record the Tier 1 subset choice and the real-chores account decision in `docs/product/open-questions.md`
- [ ] Return the outcome tally to the capability map after each run so the work order stays derived
