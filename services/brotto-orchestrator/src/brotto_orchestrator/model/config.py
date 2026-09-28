from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    context_window: int

    def __post_init__(self) -> None:
        if not self.provider:
            raise ValueError("provider must be non-empty")
        if not self.model:
            raise ValueError("model must be non-empty")
        if self.context_window <= 0:
            raise ValueError("context_window must be positive")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ModelConfig":
        known = {"provider", "model", "context_window"}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown field(s) for ModelConfig: {sorted(unknown)}")
        return cls(**data)


@dataclass(frozen=True)
class UserCredentials:
    api_key: str | None
    base_url: str | None

    def __repr__(self) -> str:
        redacted = "***" if self.api_key else None
        return f"UserCredentials(api_key={redacted!r}, base_url={self.base_url!r})"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "UserCredentials":
        known = {"api_key", "base_url"}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown field(s) for UserCredentials: {sorted(unknown)}")
        return cls(**data)