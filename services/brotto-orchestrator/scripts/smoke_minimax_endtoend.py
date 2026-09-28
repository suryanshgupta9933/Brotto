#!/usr/bin/env python3
"""Smoke test: legacy task_start (no model_config) reaches MiniMax via env.

Run with:
    AGENT_MODEL=anthropic:MiniMax-M3 CONTEXT_WINDOW_TOKENS=1000000 \
        .venv/bin/python services/brotto-orchestrator/scripts/smoke_minimax_endtoend.py
"""
from __future__ import annotations

import asyncio

from brotto_orchestrator.model.resolver import resolve_model_config
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY


async def main() -> None:
    cfg, creds = resolve_model_config("127.0.0.1", inline_config=None, inline_creds=None)
    print(f"resolved: provider={cfg.provider} model={cfg.model} ctx={cfg.context_window}")
    print(f"creds:    api_key=...{creds.api_key[-8:] if creds.api_key else None}")

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