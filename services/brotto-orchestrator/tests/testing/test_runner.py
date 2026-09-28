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


# ── Token / USD extraction ──────────────────────────────────────────────────


def _harness_timing(tokens_in: int, tokens_out: int) -> dict:
    """A `timing` dict in exactly the shape `AgentHarness._log_timings`
    returns — no more, no less, so a harness key rename breaks here."""
    return {
        "steps": 3,
        "wall_s": 5.42,
        "wall_agent_s": 3.1,
        "human_pause_s": 2.32,
        "components": {"observe": 0.31, "execute": 1.4, "model_plan": 2.79},
        "per_step": [{"observe": 0.11, "execute": 0.5, "model_plan": 0.9}],
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


def test_populated_timing_yields_tokens_and_a_hand_computed_usd():
    """Pins the full extraction path. Without this, a record can be built and
    committed with `tokens_in: null, usd: null` forever and nothing fails.

    USD by hand at the pinned Sonnet-class rates ($3/Mtok in, $15/Mtok out):
        1_234_567/1e6 * 3 = 3.703701
          89_012/1e6 * 15 = 1.335180
                          = 5.038881
    Hard-coded rather than recomputed from the constants, so a pricing change
    cannot pass silently.
    """
    result = TaskResult(
        status="completed", summary="ok", steps_taken=3,
        timing=_harness_timing(1_234_567, 89_012),
    )
    rec = runner_mod._record_from_result(
        task_id="t", fixture="auth-shadow", result=result,
        final_url="http://127.0.0.1:1/auth-shadow", approval_requested=False,
    )
    assert rec.tokens_in == 1_234_567
    assert rec.tokens_out == 89_012
    assert rec.usd == 5.038881
    # The token keys are popped, not copied — the residual timing is timing.
    assert "tokens_in" not in rec.timing
    assert "tokens_out" not in rec.timing
    assert rec.timing["wall_s"] == 5.42


def test_timing_without_token_keys_leaves_tokens_and_usd_null():
    """A result with no token keys (older server, or a timing dict built by
    hand) must not raise and must not invent a cost — null means unknown,
    not zero."""
    result = TaskResult(
        status="completed", summary="ok", steps_taken=1,
        timing={"steps": 1, "wall_s": 1.0, "wall_agent_s": 1.0,
                "human_pause_s": 0.0, "components": {}, "per_step": []},
    )
    rec = runner_mod._record_from_result(
        task_id="t", fixture="auth-shadow", result=result,
        final_url="http://127.0.0.1:1/auth-shadow", approval_requested=False,
    )
    assert rec.tokens_in is None
    assert rec.tokens_out is None
    assert rec.usd is None


def test_scripted_run_reports_zero_tokens_not_null():
    """The scripted-planner path never calls the model, so the harness
    reports 0/0. That is a real fact and must price at $0.00 — not be
    recorded as unknown."""
    result = TaskResult(
        status="completed", summary="ok", steps_taken=2,
        timing=_harness_timing(0, 0),
    )
    rec = runner_mod._record_from_result(
        task_id="t", fixture="auth-shadow", result=result,
        final_url="http://127.0.0.1:1/auth-shadow", approval_requested=False,
    )
    assert rec.tokens_in == 0
    assert rec.tokens_out == 0
    assert rec.usd == 0.0


# ── The /run body path ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_task_maps_a_real_response_body(monkeypatch):
    """Covers `run_task` → `_post_run` → `_result_from_payload` →
    `_record_from_result` end to end. Every other test in this file hands
    `_record_from_result` a hand-built TaskResult, which means
    `_result_from_payload` — the real path, and the one that dropped a field
    in the first round — could rot silently.

    Assertions are per-field on purpose: an outcome-only check passes even
    when half the record is empty. Deleting any single `msg.get(...)` line in
    `_result_from_payload` fails a specific assertion below.
    """
    result = TaskResult(
        status="failed",
        summary="could not reach the dashboard",
        extracted_data={"last_seen": "login"},
        steps_taken=3,
        failure_reason="login required to reach the dashboard",
        tried=["click:submit", "wait:selector=.dash"],
        timing=_harness_timing(1_234_567, 89_012),
        final_url="http://127.0.0.1:1/dashboard",
    )

    async def _fake_post_run(base_url, payload, timeout):
        return result.model_dump()

    monkeypatch.setattr(runner_mod, "_post_run", _fake_post_run)
    rec = await runner_mod.run_task(
        script_name="s", fixture_name="auth-shadow",
        base_url="http://127.0.0.1:1", start_url="http://127.0.0.1:1/login",
        timeout=5.0,
    )

    assert rec.fixture == "auth-shadow"
    assert rec.task_id.startswith("auth-shadow-")
    # Mapped, not defaulted: `_result_from_payload` must not coerce status.
    # Proves failure_reason reached classify(), not just `reason` — a dropped
    # msg.get("failure_reason") in _result_from_payload fails here.
    assert rec.outcome == OUTCOMES.LOGIN_FAILURE
    assert rec.steps_taken == 3
    # The URL where the task actually got to — not the one it started at.
    assert rec.final_url == "http://127.0.0.1:1/dashboard"
    assert rec.approval_requested is False
    assert rec.reason == "login required to reach the dashboard"
    # Nested timing survives the round trip; only the token keys are popped.
    assert rec.tokens_in == 1_234_567
    assert rec.tokens_out == 89_012
    assert rec.usd == 5.038881
    assert rec.timing["components"] == {
        "observe": 0.31, "execute": 1.4, "model_plan": 2.79,
    }
    assert rec.timing["per_step"] == [
        {"observe": 0.11, "execute": 0.5, "model_plan": 0.9}
    ]
    assert rec.timing["wall_s"] == 5.42
    assert "tokens_in" not in rec.timing and "tokens_out" not in rec.timing


@pytest.mark.asyncio
async def test_run_task_falls_back_to_start_url_when_body_has_none(monkeypatch):
    """A body with no final_url (older server, or a harness that aborted
    before its first observe) records the start URL rather than an empty
    string that reads as 'never navigated'."""

    async def _fake_post_run(base_url, payload, timeout):
        return TaskResult(status="completed", summary="ok", steps_taken=1).model_dump()

    monkeypatch.setattr(runner_mod, "_post_run", _fake_post_run)
    rec = await runner_mod.run_task(
        script_name="s", fixture_name="auth-shadow",
        base_url="http://127.0.0.1:1", start_url="http://127.0.0.1:1/login",
        timeout=5.0,
    )
    assert rec.final_url == "http://127.0.0.1:1/login"
