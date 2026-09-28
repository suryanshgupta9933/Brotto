"""Drives one fixture task end to end and returns a TaskRecord.

Transport is the server's existing dev endpoint `POST /run`, which launches a
headless Playwright browser, runs the harness, and returns the TaskResult. The
runner never touches CDP itself. It is an HTTP client, not a WS one: the
extension mints its own session id at startup, so a harness cannot drive it
over `/ws/ext/{id}` — see the plan's Ruling 1.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import aiohttp

from .outcome import Outcome, classify
from .records import TaskRecord, usd_estimate

log = logging.getLogger("brotto.testing.runner")

# Sonnet 4.6 class pricing, used only to put a number next to a run.
# Update when the default model changes; the benchmark stores the raw
# token counts too, so historical rows stay recomputable.
USD_IN_PER_MTOK = 3.00
USD_OUT_PER_MTOK = 15.00


async def _post_run(base_url: str, payload: dict, timeout: float) -> dict:
    """POST to /run and return the parsed TaskResult body. Overridden in tests.

    The client-side timeout bounds the real HTTP path (including body read);
    `run_task`'s `asyncio.wait_for` is the transport-agnostic backstop that
    also covers a substituted transport.
    """
    url = f"{base_url.rstrip('/')}/run"
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=timeout),
    ) as session:
        async with session.post(url, json=payload) as resp:
            if resp.status >= 400:
                raise RuntimeError(f"HTTP {resp.status}: {(await resp.text())[:200]}")
            return await resp.json()


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


def _result_from_payload(msg: dict) -> Any:
    """Rebuild a TaskResult from the /run response body."""
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


async def run_task(
    *, script_name: str, fixture_name: str, base_url: str, start_url: str,
    timeout: float = 120.0,
) -> TaskRecord:
    """Run one fixture. Always returns a TaskRecord; never raises."""
    task_id = f"{fixture_name}-{uuid.uuid4().hex[:8]}"
    try:
        # The timeout is enforced here, not inside _post_run, so it holds for
        # any transport — a wedged server is a HARNESS_ERROR, not a hang.
        body = await asyncio.wait_for(
            _post_run(
                base_url,
                {"task": f"fixture:{fixture_name}", "start_url": start_url,
                 "script": script_name},
                timeout,
            ),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"timeout after {timeout}s")
    except Exception as exc:  # noqa: BLE001
        return _err_record(task_id=task_id, fixture=fixture_name,
                           reason=f"transport error: {exc!r}")

    # ponytail: approval_requested is unobservable on the HTTP path — /run
    # returns one final result and no intermediate approval frames. Restore it
    # if a streaming transport ever carries task_start/approval_required.
    return _record_from_result(
        task_id=task_id, fixture=fixture_name,
        result=_result_from_payload(body), final_url=start_url,
        approval_requested=False,
    )
