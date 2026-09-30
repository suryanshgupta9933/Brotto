"""Test-wide environment isolation.

main.py calls load_dotenv() at import, so whatever sits in a developer's
.env lands in os.environ for the whole pytest session. Most of it is
harmless, but BROTTO_FORCE_ENV_MODEL is a machine-local switch — on a
dev box it forces every resolution onto .env, which quietly rewrites
what the resolver tests are actually exercising.
"""

import pytest


@pytest.fixture(autouse=True)
def _no_dev_model_override(monkeypatch):
    monkeypatch.delenv("BROTTO_FORCE_ENV_MODEL", raising=False)


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
