"""Whose session is this? Five call sites, and one that used to lie.

Before the hosted relay there was one operator per server, so a session id
was a name and `AGENT_SECRET` was the whole of "whose". Ten beta accounts
made that wrong, and `SessionRegistry.owns` is the guard that replaced it —
fail-closed, so a stale id or an evicted entry reads 404 rather than handing
one account another account's inbox.

**The guard had no test anywhere in the suite.** `grep -rn "registry.owns"
tests/` returned nothing, which is the CodeQL finding shape twice over now:
a control that exists, is correct, and would survive a well-meaning
refactor of any one call site because nothing would notice it had gone.

The second half of this file is the other bug. Ownership lived in an
in-memory dict, so Heroku's daily restart emptied it, and `DELETE
/v1/sessions` then answered `{"deleted": 0, "residue": 0}` with every
transcript still on disk — a user told their data was erased while it sat
in a file. That is a promise kept in one process and broken in every
process after it.
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail, Scratchpad
from brotto_orchestrator.session.jwt_auth import make_jwt

JWT_SECRET = "jwt-secret-for-tests"
ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


def _token(sub: str) -> str:
    return make_jwt({"sub": sub, "email": f"{sub[:4]}@example.test",
                     "exp": int(time.time()) + 3600}, JWT_SECRET)


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://project.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")


@pytest.fixture
def client():
    from brotto_orchestrator.main import app

    return TestClient(app)


@pytest.fixture
def clean_registry():
    """An empty registry around every test.

    `registry` is module-level process state shared by the whole suite, and a
    test that leaves an owner behind is a test that decides the next one.
    """
    from brotto_orchestrator import main

    main.registry._sessions.clear()
    yield
    main.registry._sessions.clear()


def _seed_run(session_id: str, goal: str = "find the cheapest flight") -> None:
    """A real document on disk, with the page digest a transcript would hold."""
    trail = AuditTrail(session_id)
    idx = trail.begin_task(goal)
    trail.add_message(role="user", content=goal, task=idx, turn=None)
    trail.set_scratchpad(Scratchpad().capture_page(
        url="https://a.test/x", step=0, text="a page you visited"))
    trail.close()


def _open_as(client: TestClient, sub: str) -> str:
    """Mint a session as `sub` and return its id — the real mint path."""
    resp = client.post("/v1/sessions", headers={"authorization": f"Bearer {_token(sub)}"})
    assert resp.status_code == 201, resp.text
    return resp.json()["session_id"]


# ── cross-tenant, at every call site ───────────────────────────────────────

def test_another_account_cannot_read_the_transcript(client, hosted, clean_registry):
    """Call site 1 of 5: `GET /v1/sessions/{id}/audit`."""
    sid = _open_as(client, ALICE)
    _seed_run(sid)
    other = _token(BOB)
    resp = client.get(f"/v1/sessions/{sid}/audit", headers={"authorization": f"Bearer {other}"})
    assert resp.status_code == 404, "a 403 would confirm the id is real"
    assert "find the cheapest flight" not in resp.text


def test_another_account_does_not_see_it_in_the_index(client, hosted, clean_registry):
    """Call site 2 of 5: `GET /v1/sessions`."""
    _seed_run(_open_as(client, ALICE))
    mine = client.get("/v1/sessions", headers={"authorization": f"Bearer {_token(ALICE)}"})
    assert [s["session_id"] for s in mine.json()["sessions"]] != []
    theirs = client.get("/v1/sessions", headers={"authorization": f"Bearer {_token(BOB)}"})
    assert theirs.json()["sessions"] == [], "the index is the directory of whose browsing this is"


def test_another_account_cannot_delete_it(client, hosted, clean_registry):
    """Call site 3 of 5: `DELETE /v1/sessions/{id}`. One wrong id here is the
    difference between "I erased it" and "I erased the wrong one"."""
    sid = _open_as(client, ALICE)
    _seed_run(sid)
    resp = client.delete(f"/v1/sessions/{sid}", headers={"authorization": f"Bearer {_token(BOB)}"})
    assert resp.status_code == 404
    assert (Path(audit_mod.default_dir()) / f"{sid}.json").exists(), "the document is gone"


def test_erase_all_only_reaches_your_own(client, hosted, clean_registry):
    """Call site 4 of 5: `DELETE /v1/sessions`, scoped through owned_sessions."""
    alice_sid = _open_as(client, ALICE)
    bob_sid = _open_as(client, BOB)
    _seed_run(alice_sid, "alice's task")
    _seed_run(bob_sid, "bob's task")
    resp = client.delete("/v1/sessions", headers={"authorization": f"Bearer {_token(ALICE)}"})
    assert resp.json() == {"deleted": 1, "residue": 0}
    d = Path(audit_mod.default_dir())
    assert not (d / f"{alice_sid}.json").exists()
    assert (d / f"{bob_sid}.json").exists(), "the unscoped residue sweep unlinked bob's"


def test_the_relay_socket_refuses_a_session_you_do_not_own(client, hosted, clean_registry):
    """Call site 5 of 5: `POST /ws/ext/{id}`, which closes 4004.

    A valid credential for another account is not a credential failure — it
    authenticated perfectly — so it must not get 4001/4003 either, or the
    difference between the codes is a directory of real session ids.
    """
    from starlette.websockets import WebSocketDisconnect

    sid = _open_as(client, ALICE)
    with pytest.raises(WebSocketDisconnect) as caught:
        with client.websocket_connect(
            f"/ws/ext/{sid}",
            subprotocols=["brotto-v1", _token(BOB)],
        ):
            pass
    assert caught.value.code == 4004, "4001/4003 would say the credential was the problem"


def test_a_session_with_no_owner_belongs_to_nobody(client, hosted, clean_registry):
    """Fail-closed is the whole finding: absent owner → 404 for everyone,
    including whoever is holding a perfectly valid token."""
    from brotto_orchestrator import main

    sid = str(__import__("uuid").uuid4())
    main.registry.get_or_create(sid)  # a session the registry saw but nobody claimed
    _seed_run(sid)
    for sub in (ALICE, BOB):
        resp = client.get(f"/v1/sessions/{sid}/audit", headers={"authorization": f"Bearer {_token(sub)}"})
        assert resp.status_code == 404, f"{sub} was served an unowned transcript"


def test_self_host_is_untouched_by_ownership(client, monkeypatch):
    """One credential, one person: owner is None and every route behaves as it
    did before identities existed."""
    from brotto_orchestrator import main

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    main.registry._sessions.clear()
    resp = client.post("/v1/sessions")
    sid = resp.json()["session_id"]
    _seed_run(sid)
    assert client.get(f"/v1/sessions/{sid}/audit").status_code == 200
    assert client.get("/v1/sessions").json()["sessions"] != []
    main.registry._sessions.clear()


# ── erasure that survives a restart ────────────────────────────────────────

def test_the_owner_is_persisted_not_just_held_in_memory(client, hosted, clean_registry):
    sid = _open_as(client, ALICE)
    sidecar = Path(audit_mod.default_dir()) / f"{sid}{audit_mod._OWNER_EXT}"
    assert sidecar.exists(), "ownership that lives only in a dict dies with the process"
    assert sidecar.read_text() == ALICE
    main_registry = __import__("brotto_orchestrator.main", fromlist=["registry"]).registry
    main_registry._sessions.clear()  # the dyno restart
    main_registry.hydrate_owners(audit_mod.load_owners())
    assert main_registry.owns(sid, ALICE)
    assert not main_registry.owns(sid, BOB)


def test_self_host_writes_no_owner_sidecar(client, monkeypatch):
    from brotto_orchestrator import main

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    main.registry._sessions.clear()
    sid = client.post("/v1/sessions").json()["session_id"]
    assert not (Path(audit_mod.default_dir()) / f"{sid}{audit_mod._OWNER_EXT}").exists(), \
        "a file reading None beside every self-hoster's session"
    main.registry._sessions.clear()


def test_erase_all_is_still_true_after_a_restart(client, hosted, clean_registry):
    """The bug, in full: a restarted relay told the user nothing remained
    while everything remained."""
    sid = _open_as(client, ALICE)
    _seed_run(sid)
    d = Path(audit_mod.default_dir())
    assert (d / f"{sid}.json").exists()

    from brotto_orchestrator import main

    main.registry._sessions.clear()  # dyno restart, disk intact
    assert main._restore_ownership() == 1, "nothing survived to answer with"

    resp = client.delete("/v1/sessions", headers={"authorization": f"Bearer {_token(ALICE)}"})
    body = resp.json()
    assert body["deleted"] == 1, f"erase-all reported {body} while the file was still there"
    assert body["residue"] == 0
    assert not (d / f"{sid}.json").exists()
    assert not (d / f"{sid}.scratchpad.txt").exists()


def test_the_owner_sidecar_is_erased_with_the_session(client, hosted, clean_registry):
    """An account id left beside a transcript someone just erased is not an
    erasure. It has to be in the residue list both `delete` and `delete_all`
    sweep — the `*.pages.json` shape, in miniature."""
    sid = _open_as(client, ALICE)
    _seed_run(sid)
    d = Path(audit_mod.default_dir())
    assert audit_mod._OWNER_EXT in audit_mod._SESSION_RESIDUE_EXT
    client.delete(f"/v1/sessions/{sid}", headers={"authorization": f"Bearer {_token(ALICE)}"})
    assert not (d / f"{sid}{audit_mod._OWNER_EXT}").exists()


def test_ownership_survives_eviction_at_the_tracking_cap(client, hosted, clean_registry, monkeypatch):
    """The same lie, without the restart: the cap, not the process.

    `_prune_sessions` evicts from `_sessions` on a scale threshold, with
    nothing red and no process dying. When ownership lived in the
    `SessionState` that eviction drops, `owned_sessions()` shrank with it and
    a scoped `DELETE /v1/sessions` answered `{"deleted": 0, "residue": 0}`
    while every transcript was still on disk. `.owner` survives a restart;
    this asserts it survives eviction, which is the other way that map was
    emptied.

    The eviction is asserted, not assumed: a test that only checked
    ownership survived would pass against the old code too, and prove
    nothing.
    """
    from brotto_orchestrator import main

    cap = 3
    monkeypatch.setattr(main, "MAX_TRACKED_SESSIONS", cap)
    minted = [_open_as(client, ALICE) for _ in range(6)]
    for sid in minted:
        _seed_run(sid)

    evicted = [s for s in minted if s not in main.registry._sessions]
    assert len(main.registry._sessions) <= cap
    assert len(evicted) >= 3, "nothing was evicted, so this test proves nothing"

    # Ownership is not per-run state. It answers for every session ever
    # minted, evicted or not.
    assert set(main.registry.owned_sessions(ALICE)) == set(minted)
    for sid in minted:
        assert main.registry.owns(sid, ALICE), f"{sid} stopped being hers at the cap"
    assert not main.registry.owns(minted[0], BOB)

    # And the promise is the truth: the count describes files that are gone.
    d = Path(audit_mod.default_dir())
    resp = client.delete("/v1/sessions", headers={"authorization": f"Bearer {_token(ALICE)}"})
    body = resp.json()
    assert body == {"deleted": len(minted), "residue": 0}, \
        f"erase-all reported {body} with {len(minted)} transcripts on disk"
    assert not [p for p in d.glob("*.json")], "erased transcripts are still on disk"


def test_a_scoped_erase_all_leaves_an_unowned_orphan_alone(client, hosted, clean_registry):
    """Fail-closed in the sweep as well as in the read: residue that belongs
    to no account is nobody's to delete, so a scoped sweep must skip it rather
    than unlink a stranger's file while counting something else."""
    d = Path(audit_mod.default_dir())
    d.mkdir(parents=True, exist_ok=True)
    (d / "abandoned.owner").write_text(BOB)
    body = client.delete(
        "/v1/sessions", headers={"authorization": f"Bearer {_token(ALICE)}"
                                 }).json()
    assert body == {"deleted": 0, "residue": 0}
    assert (d / "abandoned.owner").exists()


def test_an_unscoped_erase_all_sweeps_every_sidecar(client, monkeypatch):
    """Self-host, where there is one identity and therefore no scoping."""
    from brotto_orchestrator import main

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("AGENT_SECRET", "s3cret")
    main.registry._sessions.clear()
    d = Path(audit_mod.default_dir())
    d.mkdir(parents=True, exist_ok=True)
    (d / "abandoned.owner").write_text(BOB)
    resp = client.delete("/v1/sessions", headers={"authorization": "Bearer s3cret"})
    assert resp.json()["deleted"] == 0
    assert not (d / "abandoned.owner").exists(), "residue whose document is gone is still residue"
    main.registry._sessions.clear()


def test_a_stray_owner_file_does_not_become_a_session():
    """`load_owners` walks a directory; the stem check is what keeps a file
    somebody dropped there from being a session in the registry."""
    from brotto_orchestrator.agent.audit import default_dir, load_owners

    d = default_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "notes.owner").write_text(BOB)
    assert "notes" not in load_owners()

# ── ownership is only given up when the erasure finished ───────────────────

def _wedge_a_sidecar(d: Path, session_id: str) -> Path:
    """Make one of a session's files impossible to unlink.

    A directory where a file is expected: `unlink` raises
    `IsADirectoryError`, which is an `OSError`, so this exercises the real
    failure path rather than monkeypatching `audit.delete` into reporting
    something it does not report.
    """
    d.mkdir(parents=True, exist_ok=True)
    blocked = d / f"{session_id}.scratchpad.txt"
    if blocked.exists():
        blocked.unlink()
    blocked.mkdir()
    return blocked


def test_a_delete_that_could_not_finish_keeps_the_ownership(client, hosted, clean_registry):
    """`audit.delete` names every file a session owns, and one of them can
    stay put. Forgetting the owner anyway is the untruthful erasure in
    miniature: the registry stops claiming a file that is still on disk, so
    the next scoped erase-all cannot reach it and reports nothing left.
    """
    from brotto_orchestrator import main

    sid = _open_as(client, ALICE)
    _seed_run(sid)
    d = Path(audit_mod.default_dir())
    blocked = _wedge_a_sidecar(d, sid)

    body = client.delete(f"/v1/sessions/{sid}",
                         headers={"authorization": f"Bearer {_token(ALICE)}"}).json()

    assert body["residue"] == 1, f"an unfinished erasure answered {body}"
    assert blocked.exists()
    assert main.registry.owns(sid, ALICE), "nobody can reach that file again"
    assert (d / f"{sid}{audit_mod._OWNER_EXT}").exists(), \
        "the sidecar has to survive the restart too, not just the registry entry"
    assert sid in main.registry.owned_sessions(ALICE)


def test_erase_all_that_left_residue_keeps_the_ownership(client, hosted, clean_registry):
    """Same promise at the scope the hosted relay actually uses. The ownership
    entries are dropped as a batch, so an unguarded loop strands every file
    the sweep could not remove in one go."""
    from brotto_orchestrator import main

    sid = _open_as(client, ALICE)
    _seed_run(sid)
    d = Path(audit_mod.default_dir())
    blocked = _wedge_a_sidecar(d, sid)

    body = client.delete("/v1/sessions",
                         headers={"authorization": f"Bearer {_token(ALICE)}"}).json()

    assert body["residue"] == 1, f"erase-all answered {body} with a file on disk"
    assert blocked.exists()
    assert sid in main.registry.owned_sessions(ALICE), \
        "a retry of erase-all can no longer be scoped to this session"
    assert (d / f"{sid}{audit_mod._OWNER_EXT}").exists()
