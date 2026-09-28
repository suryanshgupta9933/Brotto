"""TaskRecord shape and the runner's error paths (no browser required)."""

from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.testing.outcome import OUTCOMES
from brotto_orchestrator.testing.records import TaskRecord, usd_estimate
from brotto_orchestrator.testing import runner as runner_mod


def test_usd_estimate():
    assert usd_estimate(1_000_000, 0, in_per_mtok=3.0, out_per_mtok=15.0) == 3.0
    assert usd_estimate(0, 2_000_000, in_per_mtok=3.0, out_per_mtok=15.0) == 30.0
    assert usd_estimate(0, 0, in_per_mtok=3.0, out_per_mtok=15.0) == 0.0


def test_record_requires_a_known_outcome():
    with pytest.raises(ValidationError):
        TaskRecord(task_id="t", fixture="f", outcome="NOT_A_CLASS",
                   steps_taken=0, tokens_in=None, tokens_out=None, usd=None,
                   timing={}, final_url="", approval_requested=False, reason="")


def test_record_round_trips_to_json():
    """The value, not the member name, is what lands in committed benchmark
    JSON — a rename must break loudly rather than corrupt history."""
    rec = TaskRecord(task_id="t", fixture="auth-shadow", outcome=OUTCOMES.PASS,
                     steps_taken=2, tokens_in=10, tokens_out=20, usd=0.001,
                     timing={"wall": 1.0}, final_url="http://x/",
                     approval_requested=False, reason="")
    dumped = rec.model_dump_json()
    assert '"outcome":"PASS"' in dumped
    assert TaskRecord.model_validate_json(dumped) == rec


@pytest.mark.asyncio
async def test_timeout_is_a_harness_error_not_a_hang(monkeypatch):
    """Review Focus #1. A run that cannot reach the server must fail fast and
    be attributable to the harness, never to the agent."""

    async def _never(*a, **k):
        await asyncio.sleep(3600)

    monkeypatch.setattr(runner_mod, "_post_run", _never)
    rec = await runner_mod.run_task(
        script_name="s", fixture_name="auth-shadow",
        base_url="http://127.0.0.1:9", start_url="http://127.0.0.1:1/auth-shadow",
        timeout=0.05,
    )
    assert rec.outcome == OUTCOMES.HARNESS_ERROR
    assert "timeout" in rec.reason.lower() or "error" in rec.reason.lower()


@pytest.mark.asyncio
async def test_http_error_is_attributable_not_a_crash(monkeypatch):
    """A non-2xx from /run is broken infrastructure, not an agent failure —
    it still has to come back as a record naming the status."""

    async def _boom(*a, **k):
        raise RuntimeError("HTTP 500: boom")

    monkeypatch.setattr(runner_mod, "_post_run", _boom)
    rec = await runner_mod.run_task(
        script_name="s", fixture_name="auth-shadow",
        base_url="http://127.0.0.1:9", start_url="http://127.0.0.1:1/auth-shadow",
        timeout=5.0,
    )
    assert rec.outcome == OUTCOMES.HARNESS_ERROR
    assert "500" in rec.reason
