from __future__ import annotations

import logging
import os
from dataclasses import replace

from brotto_orchestrator.model.catalog import is_keyless_ok
from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.store import load_user_config

log = logging.getLogger(__name__)


def _authenticates(config: ModelConfig | None, creds: UserCredentials | None) -> bool:
    """Whether this pair can actually reach a provider. A keyless provider
    counts, so `ollama:llama3.1` resolves without one; everything else still
    requires a key, which is the rule the "keyless inline config" note below
    describes."""
    if config is None or creds is None:
        return False
    return bool(creds.api_key) or is_keyless_ok(config.provider)


def _with_base_url(config: ModelConfig, creds: UserCredentials) -> UserCredentials:
    """The factories read `creds.base_url`; the base URL is stored on the
    config, because that is the half that persists. Copying it across here
    rather than at each call site is what makes every OpenAI-compatible
    vendor reachable — a caller that forgets is a vendor that silently talks
    to the wrong endpoint."""
    if not config.base_url or creds.base_url:
        return creds
    return replace(creds, base_url=config.base_url)


def _from_env() -> tuple[ModelConfig, UserCredentials] | None:
    raw_model = os.getenv("AGENT_MODEL")
    # "no-model" is the placeholder; "test" is pydantic-ai's TestModel
    # sentinel, read directly by the harness (harness._plan_step). Neither
    # is a provider:model, so neither resolves here — the harness has
    # already bypassed the resolver by the time these could be read.
    if not raw_model or raw_model in {"no-model", "test"}:
        return None
    if ":" not in raw_model:
        raise ValueError(
            f"AGENT_MODEL={raw_model!r} must be of the form 'provider:model'"
        )
    provider, model_id = raw_model.split(":", 1)
    context_window = int(os.getenv("CONTEXT_WINDOW_TOKENS", "400000"))
    api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
    if not api_key and not is_keyless_ok(provider):
        # Every registered provider needs a key, so returning one without it
        # only defers the failure into the provider constructor, where
        # pydantic-ai reports it as a generic AnthropicProvider error that
        # names neither this model nor this file. Name them here.
        raise ValueError(
            f"AGENT_MODEL={raw_model!r} is set but there is no key to authenticate "
            "with. Put ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) in .env, or send "
            "a key from the extension."
        )
    # AGENT_BASE_URL is the provider-neutral name; ANTHROPIC_BASE_URL is read
    # first for the configs that predate it.
    base_url = os.getenv("AGENT_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL")
    creds = UserCredentials(api_key=api_key, base_url=base_url)
    return ModelConfig(
        provider=provider, model=model_id, context_window=context_window, base_url=base_url
    ), creds


_TRUTHY = {"1", "true", "yes", "on"}


def resolve_model_config(
    client_ip: str,
    inline_config: ModelConfig | None,
    inline_creds: UserCredentials | None,
) -> tuple[ModelConfig, UserCredentials]:
    """Three-tier resolution: inline → per-user file → env vars.

    Returns `(ModelConfig, UserCredentials)`. Raises `ValueError` if no
    tier resolves.

    Two rules that aren't obvious from the tiering:

    BROTTO_FORCE_ENV_MODEL=1 short-circuits all of it and runs on .env.
    For local development, where the server is the thing that holds a
    working key and the extension is just a client.

    An inline config WITHOUT credentials is not honored at all — it falls
    through. The extension keeps model_config in chrome.storage.local
    (survives a browser restart) but the api_key in chrome.storage.session
    (does not), so every restart it sends a config and no key. Honoring
    it produced a keyless AnthropicProvider and the recurring "Set
    ANTHROPIC_API_KEY or pass it via AnthropicProvider(api_key=...)"
    error, shadowing the working .env config the user never asked to
    override. All three registered providers need a key, so there is no
    keyless case worth preserving.
    """
    if os.getenv("BROTTO_FORCE_ENV_MODEL", "").lower() in _TRUTHY:
        env = _from_env()
        if env is None:
            raise ValueError(
                "BROTTO_FORCE_ENV_MODEL is set but AGENT_MODEL is not — "
                "unset the flag or set the model in .env"
            )
        log.info(
            "model FORCED from env (BROTTO_FORCE_ENV_MODEL): %s/%s",
            env[0].provider, env[0].model,
        )
        return env

    if _authenticates(inline_config, inline_creds):
        assert inline_config is not None and inline_creds is not None
        log.debug("model resolved inline: %s/%s", inline_config.provider, inline_config.model)
        return inline_config, _with_base_url(inline_config, inline_creds)

    if inline_config is not None:
        log.info(
            "extension sent model_config %s/%s with no api_key — ignoring it, "
            "falling through to server config",
            inline_config.provider, inline_config.model,
        )

    per_user = load_user_config(client_ip)
    if per_user is not None and _authenticates(per_user, inline_creds):
        log.debug(
            "model resolved per-user for %s: %s/%s", client_ip, per_user.provider, per_user.model
        )
        return per_user, _with_base_url(per_user, inline_creds)

    env = _from_env()
    if env is not None:
        log.debug("model resolved from env: %s/%s", env[0].provider, env[0].model)
        return env

    if per_user is not None:
        # Nothing to authenticate with. Better than a confusing provider
        # error later — say what's actually missing.
        raise ValueError(
            f"per-user config for {client_ip} ({per_user.provider}/{per_user.model}) "
            "has no api_key and no AGENT_MODEL is set in the environment"
        )

    raise ValueError(
        "No model configuration available. Send model_config + api_key in "
        "task_start, save a per-user config, or set AGENT_MODEL env var."
    )