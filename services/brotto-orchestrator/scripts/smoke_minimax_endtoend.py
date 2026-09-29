#!/usr/bin/env python3
"""Smoke test: legacy task_start (no model_config) reaches MiniMax via env.

    .venv/bin/python services/brotto-orchestrator/scripts/smoke_minimax_endtoend.py

Reads .env, so with the dev defaults set there this needs no arguments.
Importing brotto_orchestrator.main would pull in the FastAPI app; load
.dotenv directly instead.
"""
from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv

from brotto_orchestrator.model.resolver import resolve_model_config
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY

load_dotenv()
# Same propagation main.py does — the smoke script never imports it.
if not os.getenv("ANTHROPIC_API_KEY") and os.getenv("ANTHROPIC_AUTH_TOKEN"):
    os.environ["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_AUTH_TOKEN"]


async def main() -> None:
    cfg, creds = resolve_model_config("127.0.0.1", inline_config=None, inline_creds=None)
    print(f"resolved: provider={cfg.provider} model={cfg.model} ctx={cfg.context_window}")
    print(f"creds:    api_key={'set' if creds.api_key else 'MISSING'}")

    factory = PROVIDER_REGISTRY[cfg.provider]
    assert factory.validate_model_id(cfg.model), f"registry rejects {cfg.model}"
    model = factory.build(cfg.model, creds)
    print(f"built:    {type(model).__name__}")

    from pydantic_ai import Agent
    agent = Agent(model, output_type=str, system_prompt="Reply with just 'ok'.")
    result = await agent.run("Say ok.")
    print(f"output:   {result.output!r}")
    print(f"usage:    in={result.usage.input_tokens} out={result.usage.output_tokens}")
    assert result.output.strip().lower() == "ok"
    print("PASS: legacy env-var path still reaches MiniMax after the refactor.")


if __name__ == "__main__":
    asyncio.run(main())