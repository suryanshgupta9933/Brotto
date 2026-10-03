"""Test-wide environment isolation.

main.py calls load_dotenv() at import, so whatever sits in a developer's
.env lands in os.environ for the whole pytest session. Most of it is
harmless, but BROTTO_FORCE_ENV_MODEL is a machine-local switch — on a
dev box it forces every resolution onto .env, which quietly rewrites
what the resolver tests are actually exercising.
"""

import uuid

import pytest


@pytest.fixture(autouse=True)
def _no_dev_model_override(monkeypatch):
    monkeypatch.delenv("BROTTO_FORCE_ENV_MODEL", raising=False)


@pytest.fixture(autouse=True)
def _offline_auth(monkeypatch):
    """Pin the model and auth env every test sees.

    Seven files used to do this with a module-level
    `os.environ.setdefault(...)`, which runs at *import* — so it mutates
    os.environ for the whole session and only in the order pytest
    happens to collect them. The suite passed because alphabetical order
    put test_agent_e2e.py before test_ws_protocol.py, and it failed the
    moment coverage reordered the imports. A developer's real
    AGENT_SECRET in .env was the trigger: load_dotenv() sets it, and
    auth_enabled() then returns True for every test that runs before the
    first setdefault.

    An autouse fixture is per-test and order-independent. It clears the
    auth pair rather than forcing it open — a test that needs auth *on*
    sets both variables itself (test_caller_key.py, test_agent_auth.py),
    and a fixture that pinned them shut would override exactly those.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("AGENT_MODEL", "test")  # use pydantic_ai TestModel
    monkeypatch.delenv("AGENT_SECRET", raising=False)
    monkeypatch.delenv("AGENT_AUTH_DISABLED", raising=False)


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path, monkeypatch):
    """Point the audit trail at a per-test directory.

    Without this the suite drops its fake runs into the real
    `logs/sessions/` — around 250 of them, named things like "delete the
    account, ask first" and "go" — and they show up in the panel's
    session history ahead of the developer's own runs. Seven test files
    needed this and none of them remembered, which is the argument for
    making it autouse rather than a per-file fixture.
    """
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))


@pytest.fixture
def session_id():
    """Mints a session id the server would actually accept."""
    return _uuid_id


def _uuid_id(label: str) -> str:
    """A session id the server would actually mint.

    The relay socket refuses any id that is not a uuid — the id is a log
    field on every line of the relay and the stem of the document written
    under logs/sessions/, and it arrives before the secret is checked, so
    an arbitrary string there forges operator output and names a file.
    Tests cannot keep readable labels in the url; the label stays in the
    test name.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_OID, f"test:{label}"))
