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

Two things this value is not allowed to be, because the routes carrying it
were unauthenticated when it was introduced and a caller-controlled string in
a log field, an audit key and a filename is one incident:

- **Not arbitrary text.** See `test_a_string_that_is_not_a_uuid_is_not_an_identity`.
- **Not a credential.** A uuid is 122 bits of entropy, so it cannot be
  guessed — but "unguessable" is a weaker property than "authenticated", and
  it is only true because these routes now check the secret anyway. The
  routes are gated in `test_every_caller_route_needs_the_secret` below.
"""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.main import _caller_key

SECRET = "s3cret-for-the-test"
OTHER = "00000000-0000-4000-8000-000000000002"


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


def test_a_string_that_is_not_a_uuid_is_not_an_identity():
    """The reason the format is checked, in one place.

    The value lands in a log field, in an interpolated key inside an audit
    document, and in a filename. Before the format check, a body carrying
    `"a\nWARNING: everything is fine"` wrote that second line into the
    server's own log — an unauthenticated caller forging operator output in
    the one place an operator looks when something goes wrong. The peer
    address was never exposed to this: it comes off the socket.
    """
    for hostile in (
        "a\nWARNING: everything is fine",
        "x" * 10_000,
        "../../etc/passwd",
        "192.168.1.5",       # looks like an address, is not a uuid
        "d3adb33f000040008000000000000 1",   # uuid-ish, wrong alphabet
        "d3adb33f-0000-4000-8000-00000000000",  # one digit short
        "d3adb33f-0000-4000-8000-000000000001extra",
        "z3adb33f-0000-4000-8000-000000000001",
    ):
        assert _caller_key(_transport("192.168.1.5"), hostile) == "192.168.1.5", hostile


def test_a_uuid_containing_a_newline_is_rejected():
    # The one that matters most, spelled out: a newline is what makes a log
    # line forgeable, and the check is a fullmatch on the whole string, not a
    # search within it.
    assert _caller_key(_transport("192.168.1.5"),
                       "d3adb33f-0000-4000-8000-000000000001\nINFO: ok") == "192.168.1.5"


def test_a_uuid_is_accepted_in_upper_and_lower_case():
    # `crypto.randomUUID()` is lowercase, but the id is compared by
    # filesystem name, so a hand-restored one should not silently miss.
    up = "D3ADB33F-0000-4000-8000-000000000001"
    assert _caller_key(_transport("192.168.1.5"), up) == up


# ── the routes that resolve one ──────────────────────────────────────────────

INSTALL_ID = "d3adb33f-0000-4000-8000-000000000001"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENT_SECRET", SECRET)
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    # `_DIR` is read at import, so setenv would be too late — the same
    # monkeypatch the harness policy tests use.
    monkeypatch.setattr(pol, "_DIR", tmp_path / "policies")

    with TestClient(main.app, raise_server_exceptions=False) as c:
        yield c


def _auth():
    return {"Authorization": f"Bearer {SECRET}"}


def _policy_file(directory, key: str):
    return directory / f"{hashlib.sha256(key.encode()).hexdigest()[:32]}.json"


def test_saving_the_blocklist_lands_under_the_install_id(client, tmp_path):
    # The whole point: the file the user can find, on their own disk, is named
    # after the install rather than after whatever address the request came
    # from. Check the path, not the response — a 200 that wrote to the wrong
    # key is the bug this whole change exists to remove.
    r = client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}},
                    headers=_auth())
    assert r.status_code == 200
    saved = _policy_file(tmp_path / "policies", INSTALL_ID)
    assert saved.exists()
    assert "bank.com" in saved.read_text()
    # And nothing was written under the peer address, which TestClient
    # reports as "testclient" — the key this used to use.
    assert not _policy_file(tmp_path / "policies", "testclient").exists()


def test_reading_the_policy_back_finds_the_same_file(client):
    client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}},
                headers=_auth())
    r = client.get("/v1/policy", params={"user_id": INSTALL_ID}, headers=_auth())
    assert r.status_code == 200
    assert "bank.com" in r.json()["blacklist"]


def test_two_installs_do_not_share_a_blocklist(client):
    # The failure mode a shared key would produce: user B saving their own
    # blocklist silently overwrites user A's, and A then discovers their
    # approvals are gone.
    client.post("/v1/policy_ack", json={"user_id": INSTALL_ID, "settings": {"blacklist": ["bank.com"]}},
                headers=_auth())
    r = client.get("/v1/policy", params={"user_id": OTHER}, headers=_auth())
    assert "bank.com" not in r.json().get("blacklist", [])


# ── the routes carrying the key are gated ────────────────────────────────────

# A uuid is unguessable, which is why the key works as an identity at all.
# It is not a credential: it travels in a request body on a route anyone who
# can reach the port may call, and the routes below write the user's policy
# file and spend the user's model credits. `AGENT_SECRET` is the difference
# between "unguessable" and "authenticated", and only the second one is a
# privacy control.
CALLER_ROUTES = [
    ("POST", "/v1/policy_ack", {"user_id": INSTALL_ID, "settings": {"blacklist": []}}),
    ("POST", "/v1/model/check", {"model_config": None}),
    ("POST", "/v1/suggestions", {"url": "https://example.com"}),
]


@pytest.mark.parametrize("method,path,body", CALLER_ROUTES)
def test_every_caller_route_needs_the_secret(client, method, path, body):
    r = getattr(client, method.lower())(path, json=body)
    # 404 rather than 403: a refused route should not confirm it exists.
    assert r.status_code == 404, f"{path} answered {r.status_code} with no secret"


@pytest.mark.parametrize("method,path,body", CALLER_ROUTES)
def test_a_wrong_secret_is_refused(client, method, path, body):
    r = getattr(client, method.lower())(path, json=body,
                                         headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 404, f"{path} answered {r.status_code} with a wrong secret"


def test_reading_the_policy_needs_the_secret_too(client):
    r = client.get("/v1/policy", params={"user_id": INSTALL_ID})
    assert r.status_code == 404


def test_an_unauthenticated_write_leaves_no_file(client, tmp_path):
    """The consequence, not the status code.

    A 404 is a fine answer to a probe, but the thing worth pinning is that
    the caller's chosen key does not become a file on the user's disk. An
    endpoint that creates a file per request is a way to fill one.
    """
    client.post("/v1/policy_ack", json={"user_id": OTHER, "settings": {"blacklist": ["x"]}})
    assert list((tmp_path / "policies").glob("*.json")) == []

