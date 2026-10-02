"""The blocklist and the remembered model are keyed by the install's id.

The key used to be the peer address, and that is not an identity: the same
browser gets a new key the moment it joins a different network, and a server
in a container sees the docker gateway rather than the machine that dialled
it. Both cases reset an approved-sites list the user believed was saved, with
no error anywhere — the file is simply written under a name they have never
seen and the panel shows an empty list.

So the extension sends `device_id` and this pins that it wins, on every route
that resolves one. The fallback is deliberately kept: an extension predating
the id still works, and an unsent id must not resolve to a shared key.
"""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.main import _caller_key


def _transport(host: str | None):
    return SimpleNamespace(client=SimpleNamespace(host=host) if host else None)


def test_the_install_id_wins_over_the_address():
    # The container case: every request arrives from the same gateway.
    assert _caller_key(_transport("172.17.0.1"), "d3adb33f-0000-4000-8000-000000000001") == (
        "d3adb33f-0000-4000-8000-000000000001"
    )


def test_the_address_is_the_fallback():
    # An extension that never sends one. Behaviour unchanged, which is the
    # point: the id is additive, not a migration that breaks old clients.
    assert _caller_key(_transport("192.168.1.5")) == "192.168.1.5"


def test_no_address_and_no_id_is_unknown():
    # Neither is better than the other here, but they must not collide into
    # the empty string — that would put every such caller in one shared file.
    assert _caller_key(_transport(None)) == "unknown"
    assert _caller_key(_transport(None), "") == "unknown"


def test_an_empty_or_blank_id_falls_back_rather_than_sharing_a_key():
    # A field that arrived but is unusable is not an identity. Treating "" as
    # the key would put every caller who sent one into a single file.
    assert _caller_key(_transport("192.168.1.5"), "") == "192.168.1.5"
    assert _caller_key(_transport("192.168.1.5"), "   ") == "192.168.1.5"
    assert _caller_key(_transport("192.168.1.5"), None) == "192.168.1.5"


def test_a_non_string_id_is_not_an_identity():
    # An unvalidated frame field is attacker-controlled. It reaches disk as a
    # sha256 and as a filename filtered to alnum/.//-, so it cannot escape the
    # directory — but it must not become a key either.
    assert _caller_key(_transport("192.168.1.5"), 42) == "192.168.1.5"
    assert _caller_key(_transport("192.168.1.5"), {"a": 1}) == "192.168.1.5"


def test_the_key_is_bounded():
    # Only ever hashed or filtered, but a megabyte of it in a POST body
    # should not become a megabyte of work.
    assert len(_caller_key(_transport("1.2.3.4"), "x" * 10_000)) == 128


# ── the routes that resolve one ──────────────────────────────────────────────

INSTALL_ID = "d3adb33f-0000-4000-8000-000000000001"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    # `_DIR` is read at import, so setenv would be too late — the same
    # monkeypatch the harness policy tests use.
    monkeypatch.setattr(pol, "_DIR", tmp_path / "policies")

    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c


def _policy_file(directory, key: str):
    return directory / f"{hashlib.sha256(key.encode()).hexdigest()[:32]}.json"


def test_saving_the_blocklist_lands_under_the_install_id(client, tmp_path):
    # The whole point: the file the user can find, on their own disk, is named
    # after the install rather than after whatever address the request came
    # from. Check the path, not the response — a 200 that wrote to the wrong
    # key is the bug this whole change exists to remove.
    r = client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}})
    assert r.status_code == 200
    saved = _policy_file(tmp_path / "policies", INSTALL_ID)
    assert saved.exists()
    assert "bank.com" in saved.read_text()
    # And nothing was written under the peer address, which TestClient
    # reports as "testclient" — the key this used to use.
    assert not _policy_file(tmp_path / "policies", "testclient").exists()


def test_reading_the_policy_back_finds_the_same_file(client):
    client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}})
    r = client.get("/v1/policy", params={"user_id": INSTALL_ID})
    assert r.status_code == 200
    assert "bank.com" in r.json()["blacklist"]


def test_two_installs_do_not_share_a_blocklist(client):
    # The failure mode a shared key would produce: user B saving their own
    # blocklist silently overwrites user A's, and A then discovers their
    # approvals are gone.
    client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}})
    other = "00000000-0000-4000-8000-000000000002"
    r = client.get("/v1/policy", params={"user_id": other})
    assert "bank.com" not in r.json().get("blacklist", [])
