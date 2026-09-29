"""One row of benchmark output."""

from __future__ import annotations

from typing import Any

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
    # The harness's timing dict is not flat: `components` is a dict and
    # `per_step` a list of per-step dicts. Typed as dict[str, float] this
    # record rejected every real run at validation.
    timing: dict[str, Any] = {}
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
