from __future__ import annotations

import pathlib

import pytest

from brotto_orchestrator.testing.fixtures import FIXTURES, load_fixture

WEB = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "web"

EXPECTED = {
    "auth-iframe": "iframe",
    "auth-aria-hidden": "aria_hidden",
    "auth-canvas": "canvas",
    "auth-slowjs": "slow_js",
    "auth-inbox": "truncation",
    "auth-popup": "popup",
    "auth-tabbed": "tabbed",
}


def test_all_seven_fixtures_registered():
    assert {f.name for f in FIXTURES} == set(EXPECTED)


def test_every_fixture_has_a_page_on_disk():
    for f in FIXTURES:
        assert (WEB / f.name / "index.html").is_file(), f.name


def test_gap_mapping_is_exact():
    assert {f.name: f.targets_gap for f in FIXTURES} == EXPECTED


def test_every_fixture_declares_a_target_name():
    for f in FIXTURES:
        assert f.target_name, f.name


def test_iframe_fixture_uses_a_second_origin():
    """A same-origin iframe is not a cross-origin test."""
    html = (WEB / "auth-iframe" / "index.html").read_text()
    assert f":{load_fixture('auth-iframe').iframe_port}" in html


def test_every_fixture_requires_a_login():
    for f in FIXTURES:
        html = (WEB / f.name / "index.html").read_text()
        assert 'id="login"' in html, f"{f.name} must present a login form first"


def test_load_fixture_rejects_unknown():
    with pytest.raises(KeyError):
        load_fixture("auth-nope")


def test_server_serves_every_fixture():
    """The catalogue tests read files off disk; only this one proves the server
    resolves WEB_ROOT and answers. A wrong WEB_ROOT passes all of them."""
    import urllib.request

    from brotto_orchestrator.testing.fixtures import MAIN_PORT
    from brotto_orchestrator.testing.server import serve_fixtures

    with serve_fixtures(MAIN_PORT):
        for f in FIXTURES:
            with urllib.request.urlopen(f"http://127.0.0.1:{f.port}{f.path}") as r:
                assert r.status == 200, f.name
