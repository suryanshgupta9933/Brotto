from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


_BASE_URL_SCHEMES = ("http://", "https://")


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    context_window: int
    # Where the provider's API lives, for the OpenAI-compatible and self-hosted
    # vendors. On the config rather than the credentials because it is not a
    # secret and must survive a browser restart: store.py persists this
    # dataclass, so an Ollama user does not re-paste the URL every session the
    # way they re-paste their key.
    base_url: str | None = None

    def __post_init__(self) -> None:
        if not self.provider:
            raise ValueError("provider must be non-empty")
        if not self.model:
            raise ValueError("model must be non-empty")
        if self.context_window <= 0:
            raise ValueError("context_window must be positive")
        if self.base_url is not None:
            # Client-supplied, and /ws/ext is unauthenticated, so an unchecked
            # value is a request-forgery primitive: point the server at
            # file:// or an internal host and it will POST there with the
            # caller's key. Scheme-only, because refusing private ranges would
            # break the http://localhost:11434/v1 case this exists for.
            if not self.base_url.lower().startswith(_BASE_URL_SCHEMES):
                raise ValueError("base_url must start with http:// or https://")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ModelConfig":
        known = {"provider", "model", "context_window", "base_url"}
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