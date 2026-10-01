"""`GET /v1/models` — the single source of truth the extension renders.

This endpoint exists to delete two of the three hand-kept copies of the model
list (sidepanel.js, welcome.js), which had already drifted. The risk that
replaces the drift is a payload that drops a field the panel needs: a provider
that forgets `accepts_base_url` renders with no URL box, and forgets
`accepts_any_model` renders an un-editable select that cannot reach
`qwen2.5-coder:7b`. So the assertions are on the flags, not just the count.

Imports are inside the fixture, not at file scope — see the note at the top of
test_suggestions_endpoint.py: test_failure_modes.py purges sys.modules
mid-session.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from brotto_orchestrator.main import app
    return TestClient(app)


def test_every_catalog_provider_is_served(client):
    from brotto_orchestrator.model.catalog import PROVIDER_CATALOG
    body = client.get("/v1/models").json()
    assert [p["id"] for p in body["providers"]] == list(PROVIDER_CATALOG)


def test_the_response_carries_the_flags_the_panel_renders_by(client):
    providers = {p["id"]: p for p in client.get("/v1/models").json()["providers"]}
    # A base-URL box, prefilled.
    assert providers["ollama"]["accepts_base_url"] is True
    assert providers["ollama"]["default_base_url"] == "http://localhost:11434/v1"
    # A fixed endpoint — no box, so the panel must not offer one.
    assert providers["minimax"]["accepts_base_url"] is False
    # Free text rather than a select, so OpenRouter's catalogue and
    # `qwen2.5-coder:7b` are reachable at all.
    assert providers["openrouter"]["accepts_any_model"] is True
    # Ollama has no key; every other provider does.
    assert providers["ollama"]["keyless_ok"] is True
    assert providers["anthropic"]["keyless_ok"] is False


def test_models_ship_their_context_window_and_pricing(client):
    providers = {p["id"]: p for p in client.get("/v1/models").json()["providers"]}
    sonnet = providers["anthropic"]["models"][0]
    assert sonnet["id"] == "claude-3-5-sonnet-latest"
    assert sonnet["context_window"] > 0
    assert sonnet["pricing"]["input_per_mtok"] > 0
    # MiniMax is deliberately unpriced; `null` must survive serialization as
    # null rather than becoming 0, which would read as "free".
    assert providers["minimax"]["models"][0]["pricing"] is None


def test_a_provider_with_no_models_still_ships(client):
    """`custom` is a base URL and a free-text field. Rendering nothing for it
    would leave a user with a self-hosted endpoint unable to describe it."""
    custom = {p["id"]: p for p in client.get("/v1/models").json()["providers"]}["custom"]
    assert custom["models"] == []
    assert custom["accepts_any_model"] is True


def test_the_endpoint_is_reachable_without_credentials(client):
    """The panel opens Settings before any key exists, and /ws/ext is
    unauthenticated anyway."""
    assert client.get("/v1/models").status_code == 200


def test_the_payload_carries_no_secrets(client):
    raw = client.get("/v1/models").text.lower()
    for leak in ("api_key", "api-key", "auth_token", "bearer", "sk-"):
        assert leak not in raw, leak
