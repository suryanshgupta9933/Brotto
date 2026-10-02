"""`POST /run` is a dev tool and is refused the moment the server is prod.

Not a privacy nicety: `/run` launches a headless Chromium on a task and URL
supplied by whoever made the request. Nothing shipped calls it — the extension
drives the agent over `/ws/ext`, inside the user's own logged-in browser — so
the only callers are tests and a developer on loopback. On a reachable port it
is a browser nobody asked for, and AGENT_SECRET does not make it safer, it just
makes it reachable by whoever has the secret.

404 rather than 403: a refused route should not confirm to a prober that it
exists.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    from brotto_orchestrator import main

    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c


def test_run_is_refused_in_prod(client, monkeypatch):
    monkeypatch.setenv("BROTTO_ENV", "prod")
    r = client.post("/run", json={"task": "go somewhere", "start_url": "https://example.com"})
    assert r.status_code == 404


def test_unset_is_dev_and_that_is_deliberate(client, monkeypatch):
    """The default is development, and the *image* is what makes it prod.

    A comment in main.py claimed a deploy forgetting BROTTO_ENV would get the
    safe behaviour. It has always done the opposite, here and on the two
    `script` guards. Flipping the default would break every developer's
    `python main.py` and the whole test suite, so the dependency is stated
    where it actually lives instead: the Dockerfile and docker-compose both
    set BROTTO_ENV=prod, and `test_the_shipped_image_sets_prod` pins that.
    """
    monkeypatch.delenv("BROTTO_ENV", raising=False)
    r = client.post("/run", content=b"", headers={"content-type": "application/json"})
    # Reached, and answered by the body parser. 404 here would mean the guard
    # closed on unset and this test's premise was wrong in the other
    # direction — a real browser launch follows a well-formed body, so a 400
    # is also what keeps this test from starting one.
    assert r.status_code == 400


def test_the_shipped_image_sets_prod():
    """The thing that actually closes /run on a self-hoster's box."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[3]
    dockerfile = (root / "Dockerfile").read_text()
    compose = (root / "docker-compose.yml").read_text()
    assert "BROTTO_ENV: prod" in dockerfile.replace("BROTTO_ENV=prod", "BROTTO_ENV: prod")
    assert "BROTTO_ENV: prod" in compose


def test_dev_still_has_it(client, monkeypatch):
    # Otherwise the dev harness is gone and the guard has no cost measured
    # against anything. The body is malformed, so the answer is the parser's
    # 400 — proof the route was reached rather than refused.
    monkeypatch.setenv("BROTTO_ENV", "dev")
    r = client.post("/run", content=b"", headers={"content-type": "application/json"})
    assert r.status_code == 400
