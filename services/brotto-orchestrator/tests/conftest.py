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
