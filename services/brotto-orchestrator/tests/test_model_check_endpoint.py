"""`POST /v1/model/check` — one provider request before the user pays for a run.

The panel calls this before starting a task, so every way a model can be
unusable has to come back as a `kind` it can act on. Two of those ways are
silent until a real run is already burning: an expired key (HTTP 401) and an
exhausted balance (a 400 with a sentence in it, from MiniMax and OpenAI
alike). Both used to surface as a run that failed after the first step.

The probe is a fake — `factory.build` is replaced — so this file asserts the
*classification* of a failure and the resolution path, never a live vendor.
A real call is exactly what the endpoint must not do in a unit test.

Modules are imported inside fixtures, not at file scope: `test_failure_modes.py`
deletes every `brotto_orchestrator*` entry from `sys.modules` mid-session, and
a top-level import here would then hold an orphan the endpoint never sees.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _main():
    import brotto_orchestrator.main as m
    return m


@pytest.fixture
def client():
    import brotto_orchestrator.main as main_mod

    with TestClient(main_mod.app) as c:
        yield c


@pytest.fixture(autouse=True)
def no_env_model(monkeypatch):
    """Force the inline path. The repo `.env` sets BROTTO_FORCE_ENV_MODEL, which
    short-circuits the resolver — every assertion here would be about env
    instead of about the config the panel sent."""
    monkeypatch.setenv("BROTTO_FORCE_ENV_MODEL", "0")
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)


class _FakeModel:
    def __init__(self, exc=None):
        self.exc = exc
        self.calls = []

    async def request(self, messages, model_settings, model_request_parameters):
        self.calls.append((messages, model_settings, model_request_parameters))
        if self.exc:
            raise self.exc


@pytest.fixture
def probe(monkeypatch):
    """Replace every factory's `build` so no vendor is contacted. Yields a
    setter that decides what the fake model does."""
    import brotto_orchestrator.model.registry as registry

    holder = {}

    def install(exc=None, model_id="claude-sonnet-5-5"):
        fake = _FakeModel(exc)
        # Every factory, not just Anthropic's: a classification test that
        # names Gemini in its body but posts `provider: anthropic` proves
        # nothing about the Gemini path, and the fixture was silently
        # letting that stand.
        for factory in registry.PROVIDER_REGISTRY.values():
            monkeypatch.setattr(factory, "build", lambda _id, _creds: fake)
        holder["fake"] = fake
        return fake

    holder["install"] = install
    return holder


def _http_error(status: int, body: str | None = None):
    from pydantic_ai.exceptions import ModelHTTPError

    return ModelHTTPError(status_code=status, model_name="claude-sonnet-5-5", body=body)


def _send(client, **body):
    return client.post("/v1/model/check", json=body)


# ── The happy path ──────────────────────────────────────────────────────────

def test_a_valid_key_reports_the_model_it_resolved(client, probe):
    probe["install"]()
    r = _send(client,
              model_config={"provider": "anthropic", "model": "claude-sonnet-5-5",
                            "context_window": 1_000_000},
              api_key="sk-ant-valid")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # The panel shows this, so it has to be the resolved pair, not the payload
    # echoed back — those differ whenever the resolver fell through a tier.
    assert body["model"] == "anthropic:claude-sonnet-5-5"
    assert body["context_window"] == 1_000_000


def test_the_probe_really_calls_the_model(client, probe):
    """A check that never calls anything answers `ok` for every key ever
    typed — including the wrong one. That is the bug this endpoint exists to
    not have."""
    fake = probe["install"]()
    _send(client,
          model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
          api_key="sk-ant-valid")
    assert len(fake.calls) == 1


# ── Nothing to run with ─────────────────────────────────────────────────────

def test_no_model_anywhere_blocks_the_run(client, probe):
    """The case the panel turns into "open Settings → Model". Distinct from an
    auth failure: no key was ever tried."""
    r = _send(client)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["kind"] == "no_model"


def test_an_empty_provider_is_no_model_not_an_error(client, probe):
    """The panel sends `{provider: ""}` until Settings is opened. Treating
    that as an unknown provider is what closed the socket on every task."""
    r = _send(client, model_config={"provider": "", "model": ""}, api_key="sk-ant-x")
    assert r.json()["kind"] == "no_model"


def test_the_response_does_not_name_the_servers_environment(client, probe):
    """`resolve_model_config` raises a ValueError naming the env var it could
    not find. The panel ignores this field and writes its own copy, so putting
    `str(exc)` here told the caller about the host's configuration and gave
    the person reading it nothing. The text is in the log instead."""
    r = _send(client, model_config={"provider": "", "model": ""}, api_key="sk-ant-x")
    body = r.json()
    assert body["kind"] == "no_model"
    assert "AGENT_MODEL" not in body["error"]


def test_an_unknown_model_is_named_back(client, probe):
    r = _send(client,
              model_config={"provider": "anthropic", "model": "gpt-4o"},
              api_key="sk-ant-x")
    body = r.json()
    assert body["kind"] == "unknown_model"
    assert "gpt-4o" in body["error"]


# ── The two failures that used to reach the user mid-run ────────────────────

@pytest.mark.parametrize("status", [401, 403])
def test_a_rejected_key_is_reported_as_auth_failed(client, probe, status):
    probe["install"](_http_error(status))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-expired").json()
    assert body["ok"] is False
    assert body["kind"] == "auth_failed"
    # The sentence is what the user acts on, so it has to say what to do.
    assert "Settings" in body["error"]


def test_a_gemini_rejected_key_is_reported_as_auth_failed(client, probe):
    """Google answers a bad key with a 400, not a 401.

    Verified against Google's own error reference: `400 INVALID_ARGUMENT`
    with "API key not valid. Please pass a valid API key." Status code
    alone put every Gemini user with a bad key in the generic branch, where
    they read a raw provider body instead of being told to paste the key
    again.
    """
    probe["install"](_http_error(
        400, '{"error":{"code":400,"status":"INVALID_ARGUMENT",'
             '"message":"API key not valid. Please pass a valid API key."}}'))
    body = _send(client,
                 model_config={"provider": "gemini", "model": "gemini-3.5-flash"},
                 api_key="bad-key").json()
    assert body["kind"] == "auth_failed"
    assert "Settings" in body["error"]


def test_a_rejected_key_is_not_mistaken_for_an_empty_balance(client, probe):
    """Both arrive as a 400, so the ordering of the two hint sets is the
    part that can regress: a key that says "invalid" must not reach the
    credit branch and send a paid user to top up."""
    probe["install"](_http_error(
        400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'))
    body = _send(client,
                 model_config={"provider": "gemini", "model": "gemini-3.5-flash"},
                 api_key="bad-key").json()
    assert body["kind"] == "auth_failed"


def test_an_empty_balance_sent_as_402_is_no_credits(client, probe):
    probe["install"](_http_error(402))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-valid").json()
    assert body["kind"] == "no_credits"


def test_an_empty_balance_sent_as_400_is_still_no_credits(client, probe):
    """MiniMax and OpenAI answer an exhausted balance with a 400 and a
    sentence. Classifying on the status code alone loses the one field that
    names the problem."""
    probe["install"](_http_error(400, '{"error":"insufficient balance"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-valid").json()
    assert body["kind"] == "no_credits"


def test_a_400_that_is_not_about_money_stays_an_error(client, probe):
    """The keyword test has to not swallow every 400 — a schema complaint
    reported as `no_credits` sends the user to top up a paid account."""
    probe["install"](_http_error(400, '{"error":"thinking.type is invalid"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-valid").json()
    assert body["kind"] == "error"


@pytest.mark.parametrize("status", [500, 502, 503, 529])
def test_a_provider_that_is_down_is_not_a_bad_key(client, probe, status):
    """A 5xx got past auth and failed at the provider. Reported as `error` it
    reads as "your key is wrong", which sends the user to re-paste a key that
    was fine — the exact case the product owner named: *the model is down,
    show the error*."""
    probe["install"](_http_error(status, '{"error":"upstream unavailable"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-valid").json()
    assert body["ok"] is False
    assert body["kind"] == "provider_error"
    # The status is what the user needs; the fix it names is what stops them
    # doing the wrong thing.
    assert f"HTTP {status}" in body["error"]


def test_a_provider_5xx_never_echoes_the_provider_body(client, probe):
    """`error` is the one branch that forwards provider text, and a 5xx body
    is where a gateway echoes the URL it called. This branch must not grow a
    `body[:300]`."""
    probe["install"](_http_error(
        503, '{"error":"upstream http://gpu-box.lan:8000/v1 unavailable"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-secret-value").json()
    assert body["kind"] == "provider_error"
    assert "gpu-box.lan" not in body["error"]
    assert "sk-ant-secret-value" not in body["error"]


def test_the_generic_error_branch_never_echoes_the_provider_body(client, probe):
    """The other half of the same guard, on the branch that did the echoing.

    `error` used to return `body[:300]`, and the panel persists the sentence
    to `chrome.storage.local` to survive a close — so a third party's HTTP
    response landed on the user's disk, indefinitely. A body that does not
    name the key is still a body: the panel only ever needed a kind.
    """
    probe["install"](_http_error(
        404, '{"error":"unknown model, called http://gpu-box.lan:8000/v1"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-secret-value").json()
    assert body["kind"] == "error"
    # The status is still there — it is the one part of the response the user
    # can quote to whoever they ask for help.
    assert "HTTP 404" in body["error"]
    # And the fix is named, like every other branch.
    assert "Settings" in body["error"]
    # The provider's own text is not, in whole or in part.
    assert "gpu-box.lan" not in body["error"]
    assert "unknown model" not in body["error"]
    assert "sk-ant-secret-value" not in body["error"]


def test_a_refused_connection_is_unreachable_not_a_bad_key(client, probe):
    """A LAN base URL that is down is the self-hosted user's common failure,
    and `auth_failed` would send them to re-paste a key that was fine.

    Raised the way pydantic-ai actually raises it — a ModelAPIError wrapping
    the transport error on `__cause__` — because that is the only shape the
    endpoint ever sees from a real provider.
    """
    import httpx
    from pydantic_ai.exceptions import ModelAPIError

    wrapped = ModelAPIError(model_name="qwen2.5-coder:7b", message="connection refused")
    wrapped.__cause__ = httpx.ConnectError("connection refused")
    probe["install"](wrapped)
    body = _send(client,
                 model_config={"provider": "custom", "model": "qwen2.5-coder:7b",
                               "base_url": "http://gpu-box.lan:8000/v1"},
                 api_key="sk-local").json()
    assert body["kind"] == "unreachable"


# ── What the log keeps ──────────────────────────────────────────────────────

def test_a_hostile_provider_body_is_redacted_and_flattened_in_the_log(
        client, probe, caplog):
    """The log is the one place provider text still goes, and a log file keeps
    text indefinitely — so "moved it to the log" is not by itself safe.

    A self-hoster who typed their own `base_url` is dialling a host that is not
    necessarily a model provider at all, so the body is attacker-supplied on
    every install. Two things must not survive into the file:

    - the secret. `redact_text` runs first and only the per-kind *counts* are
      logged beside it — the operator still learns something happened.
    - the newline. A raw LF in the body forges a log line the application never
      wrote (CWE-117), so the reader sees an entry that did not happen.
    """
    injected = (
        'WARNING:root:model check: forger: key sk-ant-injected000000000000 accepted\n'
        'ERROR:root:model check: forged entry that never happened'
    )
    probe["install"](_http_error(
        404,
        '{"error":"unknown model","key":"sk-ant-leaked0123456789ab",'
        f'"note":"{injected}"}}',
    ))
    with caplog.at_level("WARNING"):
        body = _send(client,
                     model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                     api_key="sk-ant-secret-value").json()
    assert body["kind"] == "error"

    logged = "\n".join(r.getMessage() for r in caplog.records)
    # The body is still logged — dropping it would make this branch invisible
    # in production, which is where the operator needs it.
    assert "unknown model" in logged
    # ...but not the key, and not the forged line.
    assert "sk-ant-leaked0123456789ab" not in logged
    assert "key sk-ant-injected000000000000 accepted" not in logged
    # One record, one line: the record's own text has no embedded newline.
    record = [r for r in caplog.records if "unknown model" in r.getMessage()]
    assert len(record) == 1
    assert "\n" not in record[0].getMessage()
    # The count is what replaces the secret.
    assert "api-key" in record[0].getMessage()


def test_a_body_with_nothing_sensitive_still_reaches_the_log(client, probe, caplog):
    """Redaction must not become a mute — the counts are a *disclosure*, not
    the only reason to log."""
    probe["install"](_http_error(404, '{"error":"unknown model: v9"}'))
    with caplog.at_level("WARNING"):
        _send(client,
              model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
              api_key="sk-ant-secret-value")
    assert "unknown model: v9" in "\n".join(r.getMessage() for r in caplog.records)


# ── The key must not come back out ──────────────────────────────────────────

def test_the_response_never_echoes_the_key(client, probe):
    probe["install"](_http_error(401, '{"detail":"invalid x-api-key: sk-ant-secret-value"}'))
    body = _send(client,
                 model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                 api_key="sk-ant-secret-value").json()
    # The vendor echoed the key back in its error body. The panel puts this
    # string on screen and in chrome.storage.
    assert "sk-ant-secret-value" not in body["error"]


def test_the_base_url_scheme_is_still_enforced(client, probe):
    """`/ws/ext` is unauthenticated, so a client-supplied base_url is a
    request-forgery primitive. The check endpoint inherited that surface when
    it took the same payload."""
    r = _send(client,
              model_config={"provider": "custom", "model": "qwen",
                            "base_url": "file:///etc/passwd"},
              api_key="sk-local")
    # Rejected by ModelConfig, so it falls through to the resolver rather than
    # pointing the server at a local file.
    assert r.json()["kind"] in {"no_model", "unreachable"}


def test_a_provider_body_echoing_the_callers_own_key_is_scrubbed_by_equality(
        client, probe, caplog):
    """A gateway that reflects the caller's key answers in a shape
    `redact_text` does not know — the rule matches key *formats*, and BYOK keys
    are only nominally `sk-ant-*`. The exact secret is in hand at the call site,
    so it is replaced by equality before the pattern pass. Exact beats clever.
    """
    opaque = "ZZq7-not-a-shape-any-rule-knows-4f2b"
    probe["install"](_http_error(
        404, f'{{"error":"rejected","echo":"token={opaque} (revoked)"}}'))
    with caplog.at_level("WARNING"):
        body = _send(client,
                     model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
                     api_key=opaque).json()
    assert body["kind"] == "error"
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert opaque not in logged
    assert "[redacted]" in logged
    # Redaction is not a mute — the operator still sees what failed.
    assert "rejected" in logged


def test_a_body_far_longer_than_the_log_window_is_still_bounded(client, probe, caplog):
    """The scan window is derived from the emitted one, not chosen: `_one_line`
    only shrinks text, so nothing past the log window could reach the file and
    nothing inside it is cut off. Pin the relationship, not the constant.
    """
    opaque = "QQz1-also-opaque-and-not-rule-shaped-9c3e"
    probe["install"](_http_error(
        404, '{"pad":"' + "a" * 20_000 + f'","echo":"{opaque}"}}'))
    with caplog.at_level("WARNING"):
        _send(client,
              model_config={"provider": "anthropic", "model": "claude-sonnet-5-5"},
              api_key=opaque)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert opaque not in logged
    # And the window holds: the log line stays one screenful, not the body.
    body_lines = [ln for ln in logged.splitlines() if "model check:" in ln]
    assert body_lines and len(max(body_lines, key=len)) < 2_000
