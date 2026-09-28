"""Minimal brotto contracts — shared Pydantic models for observation and action."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ObservationV1(BaseModel):
    observation_id: str = ""
    sequence: int = 0
    payload: dict[str, Any] = {}
    url: str = ""
    title: str = ""
    semantic_targets: list[dict[str, Any]] = []
    timestamp: Any = None


class BrowserAction(BaseModel):
    type: str
    target_id: str | None = None
    text: str | None = None
    url: str | None = None
    key: str | None = None
    direction: str | None = None
    duration_ms: int | None = None
    answer: str | None = None
    reason: str | None = None


class ModelConfigWire(BaseModel):
    """Wire shape for ModelConfig over WS. Server converts to the
    internal `ModelConfig` dataclass via ModelConfig(provider=..., ...)."""

    provider: str
    model: str
    context_window: int | None = None


class TaskStart(BaseModel):
    """Additive fields for task_start (extension → server). Existing
    fields preserved; new fields are optional for backward compatibility
    with older extension builds."""

    model_config = ConfigDict(populate_by_name=True)

    type: str = "task_start"
    goal: str
    # pydantic reserves `model_config` for the Config class, so the field
    # is named `model_cfg` internally and the wire alias is `model_config`.
    model_cfg: ModelConfigWire | None = Field(default=None, alias="model_config")
    api_key: str | None = None
    remember_key: bool = False
    client_ip: str | None = None


__all__ = ["ObservationV1", "BrowserAction", "ModelConfigWire", "TaskStart"]
