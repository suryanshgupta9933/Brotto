from __future__ import annotations

import logging
import os

from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.store import load_user_config

log = logging.getLogger(__name__)


def _from_env() -> tuple[ModelConfig, UserCredentials] | None:
    raw_model = os.getenv("AGENT_MODEL")
    if not raw_model or raw_model == "no-model":
        return None
    if ":" not in raw_model:
        raise ValueError(
            f"AGENT_MODEL={raw_model!r} must be of the form 'provider:model'"
        )
    provider, model_id = raw_model.split(":", 1)
    context_window = int(os.getenv("CONTEXT_WINDOW_TOKENS", "400000"))
    creds = UserCredentials(
        api_key=os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"),
        base_url=os.getenv("ANTHROPIC_BASE_URL"),
    )
    return ModelConfig(provider=provider, model=model_id, context_window=context_window), creds


def resolve_model_config(
    client_ip: str,
    inline_config: ModelConfig | None,
    inline_creds: UserCredentials | None,
) -> tuple[ModelConfig, UserCredentials]:
    """Three-tier resolution: inline → per-user file → env vars.

    `inline_creds` is only honored when `inline_config` is also provided.
    Returns `(ModelConfig, UserCredentials)`. Raises `ValueError` if no
    tier resolves.
    """
    if inline_config is not None:
        creds = inline_creds or UserCredentials(api_key=None, base_url=None)
        log.debug("model resolved inline: %s/%s", inline_config.provider, inline_config.model)
        return inline_config, creds

    per_user = load_user_config(client_ip)
    if per_user is not None:
        creds = inline_creds or UserCredentials(api_key=None, base_url=None)
        log.debug(
            "model resolved per-user for %s: %s/%s", client_ip, per_user.provider, per_user.model
        )
        return per_user, creds

    env = _from_env()
    if env is not None:
        log.debug("model resolved from env: %s/%s", env[0].provider, env[0].model)
        return env

    raise ValueError(
        "No model configuration available. Send model_config + api_key in "
        "task_start, save a per-user config, or set AGENT_MODEL env var."
    )