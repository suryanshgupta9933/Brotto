"""Token accounting in the harness loop.

The benchmark's TaskRecord carries `tokens_in` / `tokens_out` / `usd`, and
`testing/runner.py` gets those numbers by popping them from
`TaskResult.timing`. That only works if the harness actually accumulates
`result.usage` across steps and reports it. These tests pin the accumulate →
`_log_timings` → timing path end to end through `AgentHarness.run`, so the
record cannot silently be built with nulls forever.

`_plan_step` is stubbed rather than TestModel-driven: the property under test
is "whatever `result.usage` says gets added up", and a stub states the input
exactly instead of hoping the test model reports non-zero usage.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDecision, AgentDeps
from brotto_orchestrator.agent.harness import AgentHarness
import brotto_orchestrator.agent.harness as harness_mod


class _Usage:
    def __init__(self, input_tokens: int, output_tokens: int,
                 cache_read: int = 0, cache_write: int = 0) -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_read_tokens = cache_read
        self.cache_write_tokens = cache_write


class _PlanResult:
    """Stands in for pydantic-ai's RunResult: only `.usage` is read."""

    def __init__(self, usage: _Usage | None) -> None:
        self.usage = usage


_COMPLETE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


def _deps() -> AgentDeps:
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="btn_ok", tag="button", role="button", name="OK")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


def _stub_plan(monkeypatch, usages: list[_Usage | None]) -> None:
    """Make each step's plan return the next usage in the list, repeating the
    last one once exhausted."""
    seq = list(usages)

    async def _fake_plan(deps, turn, agent, audit=None):
        usage = seq[min(len(seq) - 1, getattr(_fake_plan, "n", 0))] if seq else None
        _fake_plan.n = getattr(_fake_plan, "n", 0) + 1
        return _COMPLETE, 400_000, _PlanResult(usage)

    _fake_plan.n = 0
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)


@pytest.mark.asyncio
async def test_step_usage_lands_in_the_returned_timing(monkeypatch):
    """A step's `result.usage` must reach `TaskResult.timing` — this is the
    only source `testing/runner.py` has for `tokens_in` / `tokens_out`."""
    _stub_plan(monkeypatch, [_Usage(1_500, 320)])
    result = await AgentHarness().run(_deps())
    assert result.status == "completed"
    assert result.timing["tokens_in"] == 1_500
    assert result.timing["tokens_out"] == 320


@pytest.mark.asyncio
async def test_usage_accumulates_across_steps(monkeypatch):
    """Two steps, two usages, two sums — not a last-write-wins overwrite."""
    # First step's task_complete ends the run, so drive the second step by
    # returning a non-terminal decision first.
    seq = iter([
        AgentDecision(reasoning="look", thought="look",
                      actions=[ActionCall(action="recall_memory",
                                          action_args={"entry_id": "r1"})]),
        _COMPLETE,
    ])
    usages = iter([_Usage(1_000, 100), _Usage(2_000, 200)])

    async def _fake_plan(deps, turn, agent, audit=None):
        return next(seq), 400_000, _PlanResult(next(usages))

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    result = await AgentHarness().run(_deps())
    assert result.timing["tokens_in"] == 3_000
    assert result.timing["tokens_out"] == 300


@pytest.mark.asyncio
async def test_cache_tokens_are_counted_separately(monkeypatch):
    """Cache read/write are reported by the API as their own counts, not a
    subset of `input_tokens`. They dominate a multi-step run and are priced an
    order of magnitude below input, so folding them into tokens_in or dropping
    them both misprice the normal workload."""
    _stub_plan(monkeypatch, [_Usage(1_500, 320, cache_read=48_000, cache_write=9_000)])
    result = await AgentHarness().run(_deps())
    assert result.timing["tokens_in"] == 1_500
    assert result.timing["cache_read_tokens"] == 48_000
    assert result.timing["cache_write_tokens"] == 9_000


@pytest.mark.asyncio
async def test_step_without_usage_leaves_totals_unchanged(monkeypatch):
    """No usage (or a `result` whose usage read raises — the scripted-planner
    path, a provider that omits counts) contributes nothing and must not fail
    the step."""
    class _Exploding:
        @property
        def usage(self):
            raise RuntimeError("no usage on this result")

    async def _fake_plan(deps, turn, agent, audit=None):
        return _COMPLETE, 400_000, _Exploding()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    result = await AgentHarness().run(_deps())
    assert result.status == "completed"
    assert result.timing["tokens_in"] == 0
    assert result.timing["tokens_out"] == 0


def test_log_timings_reports_zero_tokens_when_none_passed():
    """Direct `_log_timings` check: zero, not a missing key. A missing key
    would make `runner.py` record `usd: null` for every scripted run."""
    from brotto_orchestrator.agent.harness import TIMING_BUCKETS
    out = AgentHarness._log_timings("u", {b: 0.0 for b in TIMING_BUCKETS}, steps=0, wall=0.0)
    assert out["tokens_in"] == 0
    assert out["tokens_out"] == 0


def test_every_run_return_site_stamps_final_url():
    """A new return path in run() that forgets `final_url` would silently
    report the task's start URL as where it ended.

    Completeness check over the exits of `run()`, not a behaviour test: a new
    exit must either stamp the field or be listed here deliberately.
    """
    import ast
    import inspect

    import brotto_orchestrator.agent.harness as harness_mod

    src = inspect.getsource(harness_mod.AgentHarness.run)
    lines = src.splitlines()
    tree = ast.parse(src.lstrip())
    unstamped = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Return) or node.value is None:
            continue
        if "final_url" in (ast.get_source_segment(src.lstrip(), node) or ""):
            continue
        if "deps.result" in (ast.get_source_segment(src.lstrip(), node) or ""):
            # `return deps.result` — the stamp must appear above it, in the
            # same block, not somewhere else in the method.
            head = "\n".join(lines[max(0, node.lineno - 8) : node.lineno - 1])
            if "deps.result.final_url" not in head:
                unstamped.append(f"line {node.lineno}: return deps.result")
        else:
            unstamped.append(f"line {node.lineno}: {(ast.get_source_segment(src.lstrip(), node) or '')[:60]}")
    assert not unstamped, f"return sites missing final_url: {unstamped}"
