"""`POST /v1/suggestions` — the idle panel's model call, over HTTP.

The endpoint exists on HTTP rather than the WebSocket because the socket only
lives while a task is running, and the panel needs suggestions precisely when
no task is running. So this is a public, unauthenticated-by-session route
taking client-supplied model config, and every failure has to come back as a
clean status the panel can distinguish — it keeps its own fallback lines on
anything but a 200, so a 500 here would silently leave the user with the
generic suggestions and no idea why.

No model, no key, no network: `generate` is patched.

Every module is imported inside the fixtures, not at file scope, and that is
load-bearing. `test_failure_modes.py` deletes every `brotto_orchestrator*` entry
from `sys.modules` mid-session; a top-level import here would then hold an
orphaned module object while the endpoint's function-local
`from .agent.suggest import generate` pulls a fresh one, the monkeypatch would
land on the orphan, and the real model would be called for real.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _main():
    import brotto_orchestrator.main as m
    return m


def _suggest():
    import brotto_orchestrator.agent.suggest as m
    return m


@pytest.fixture
def client():
    import brotto_orchestrator.main as main_mod

    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture
def generate(monkeypatch):
    """Replaces the model call. Records the (url, title, page_text) it was handed."""
    import brotto_orchestrator.agent.suggest as suggest_mod

    seen: list[tuple[str, str, str]] = []

    async def _fake(url, title, cfg, creds, page_text=""):
        seen.append((url, title, page_text))
        return suggest_mod.SuggestionSet(
            lines=["Summarise the open issues.", "Read the oldest one.", "Draft a reply."],
            context_used=bool(page_text),
        )

    monkeypatch.setattr(suggest_mod, "generate", _fake)
    return seen


@pytest.fixture(autouse=True)
def resolves(monkeypatch):
    """A resolvable config without touching env or a real provider."""
    import brotto_orchestrator.main as main_mod
    from brotto_orchestrator.model.config import ModelConfig, UserCredentials

    def _fake_resolve(client_ip, inline_config, inline_creds):
        return (
            inline_config or ModelConfig("anthropic", "claude-3-5-sonnet-latest", 400_000),
            inline_creds or UserCredentials(api_key="k", base_url=None),
        )

    monkeypatch.setattr(main_mod, "resolve_model_config", _fake_resolve)


def test_returns_generated_lines(client, generate):
    r = client.post("/v1/suggestions", json={
        "url": "https://github.com/a/b/pulls", "title": "a/b: Pull requests",
    })
    assert r.status_code == 200
    assert r.json()["lines"] == [
        "Summarise the open issues.", "Read the oldest one.", "Draft a reply.",
    ]
    assert generate == [("https://github.com/a/b/pulls", "a/b: Pull requests", "")]


def test_page_text_reaches_the_model_and_is_reported_back(client, generate):
    """The whole feature. Without it the model has a URL and a title, which
    on a Gmail tab is nothing, and it writes the page's manual instead of a
    task. `context_used` is what the panel shortens the cache TTL on, so a
    line derived from a private page is not left on disk for a day."""
    r = client.post("/v1/suggestions", json={
        "url": "https://mail.google.com/mail/u/0/#inbox",
        "title": "Inbox (23) - someone@gmail.com",
        "page_text": "Ada - Q3 budget\nBen - lunch tomorrow",
    })
    assert r.status_code == 200
    assert generate[0][2] == "Ada - Q3 budget\nBen - lunch tomorrow"
    assert r.json()["context_used"] is True


def test_a_page_that_refused_the_script_omits_context_rather_than_guessing(
    client, generate,
):
    # chrome:// pages take no injected script, so the panel sends no text. The
    # prompt is told the text is unavailable and must not invent a subject to
    # fill the slot; the endpoint's job is to pass the absence through intact.
    r = client.post("/v1/suggestions", json={
        "url": "chrome://extensions/", "title": "Extensions",
    })
    assert r.status_code == 200
    assert generate[0][2] == ""
    assert r.json()["context_used"] is False


def test_blank_url_is_a_client_error(client, generate):
    # 400, not 502: the panel sent something wrong, not the server.
    assert client.post("/v1/suggestions", json={"url": "  "}).status_code == 400
    assert generate == []


def test_unresolvable_model_is_502_and_never_echoes_a_key(client, monkeypatch):
    def _boom(*_a, **_k):
        raise ValueError("Set ANTHROPIC_AUTH_TOKEN in .env, or send a key from the extension.")

    monkeypatch.setattr(_main(), "resolve_model_config", _boom)
    r = client.post("/v1/suggestions", json={"url": "https://x.com/", "api_key": "sk-secret"})
    assert r.status_code == 502
    assert "sk-secret" not in r.text


def test_model_failure_is_502_so_the_panel_keeps_its_fallback(client, monkeypatch):
    async def _boom(*_a, **_k):
        raise RuntimeError("upstream refused the connection")

    monkeypatch.setattr(_suggest(), "generate", _boom)
    r = client.post("/v1/suggestions", json={"url": "https://x.com/"})
    assert r.status_code == 502
    assert "refused" in r.json()["error"]


def test_known_provider_in_the_body_is_passed_through(client, generate):
    # The panel forwards the same model_config the user picked in Settings.
    # It has to reach the resolver, or every BYOK user silently falls back
    # to whatever the server has in env.
    r = client.post("/v1/suggestions", json={
        "url": "https://x.com/",
        "model_config": {"provider": "minimax", "model": "MiniMax-M3.1-Flash-Preview",
                         "context_window": 1000000},
        "api_key": "sk-test",
    })
    assert r.status_code == 200


@pytest.mark.parametrize("bad", [
    {"provider": "minimax", "model": "x", "context_window": "not-a-number"},
    {"provider": "minimax", "model": "", "context_window": 1},
    {"provider": "", "model": "x", "context_window": 1},
    "not-an-object",
])
def test_a_malformed_model_config_does_not_500(client, generate, bad):
    # The panel forwards whatever is in chrome.storage.local verbatim. A bad
    # shape there must degrade to the resolver's env path, not blow up the
    # request — a 500 leaves the user on the fallback lines with no idea why.
    r = client.post("/v1/suggestions", json={"url": "https://x.com/", "model_config": bad})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_context_used_reports_the_prompt_not_the_request(monkeypatch):
    """`context_used` is the panel's disclosure — it tells the user the
    suggestion came from the page rather than the URL alone. It has to come
    from what `generate` actually put in the prompt, not from whether the
    request happened to carry a page_text field, or it can assert a read
    that never happened."""
    import brotto_orchestrator.agent.suggest as suggest_mod
    from brotto_orchestrator.model.config import ModelConfig, UserCredentials

    class _StubAgent:
        def __init__(self, _model, system_prompt=""):
            pass

        async def run(self, prompt, **kwargs):
            self.prompt = prompt
            return type("_R", (), {"output": "Summarise the thread."})()

    monkeypatch.setattr(suggest_mod, "Agent", _StubAgent)

    cfg = ModelConfig("anthropic", "claude-sonnet-4-5", 400_000)
    creds = UserCredentials(api_key="k", base_url=None)

    used = await suggest_mod.generate(
        "https://mail.google.com/mail/u/0/#inbox", "Inbox", cfg, creds,
        page_text="Ada - Q3 budget",
    )
    assert used.context_used is True
    assert used.lines

    unused = await suggest_mod.generate(
        "https://mail.google.com/mail/u/0/#inbox", "Inbox", cfg, creds,
        page_text="",
    )
    assert unused.context_used is False
