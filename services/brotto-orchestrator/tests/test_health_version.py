from fastapi.testclient import TestClient

from brotto_orchestrator.__version__ import __version__
from brotto_orchestrator.main import app


def test_health_reports_the_package_version():
    client = TestClient(app)
    body = client.get("/health").json()
    assert body["version"] == __version__
    assert body["version"] == app.version


def test_no_hardcoded_version_left_in_main():
    import inspect

    from brotto_orchestrator import main

    src = inspect.getsource(main)
    # The two literals this change removes. If either comes back, the constant
    # stopped being the single source and the CI guard is checking a tree that lies.
    assert '"2.0.0"' not in src
