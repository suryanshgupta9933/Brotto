import json
from pathlib import Path

import pytest

from brotto_orchestrator.agent.audit import (
    MAX_FIELD_CHARS, REDACTED, SCHEMA_VERSION, AuditTrail, is_secret_field,
    list_sessions, load_scratchpad, read,
)
from brotto_orchestrator.agent.context import MemoryEntry, Scratchpad


@pytest.fixture
def trail(tmp_path: Path) -> AuditTrail:
    return AuditTrail("s1", dir=tmp_path)


def _seed(t: AuditTrail) -> int:
    t.set_goal("find my most starred repo")
    t.set_client(ip_hash="sha256:abc")
    t.set_model(provider="minimax", model="MiniMax-M3",
                context_window=1_000_000, source="env")
    t.set_policy({"mode": "secure", "blacklist": ["mail.google.com"]})
    return t.begin_turn(step=0, url="https://github.com/", page_title="GitHub",
                        ax_targets=41, ax_chars=12345, ax_diff_chars=2,
                        page_text_chars=890)


def test_document_is_valid_json_after_every_record(trail, tmp_path):
    turn = _seed(trail)
    trail.record_model(turn, thought="Sort by stars", reasoning="…",
                       tokens_in=1500, tokens_out=220,
                       context_pct=0.15, latency_ms=1820)
    # Readable by an outside reader at every instant, not just at the end.
    doc = read("s1", dir=tmp_path)
    assert doc["schema_version"] == SCHEMA_VERSION
    assert doc["turns"][0]["model"]["tokens_in"] == 1500


def test_prompt_sits_between_model_and_actions(trail):
    turn = _seed(trail)
    trail.record_model(turn, thought="Click", reasoning="…",
                       tokens_in=10, tokens_out=2, context_pct=0.1, latency_ms=5)
    pid = trail.record_prompt(turn, kind="first_time_seen", action="click",
                              args={"ref": "r1"}, domain="github.com",
                              reason="First time on github.com: …")
    trail.record_action(turn, action="click", args={"ref": "r1"},
                        outcome="Clicked", ok=True, redacted=False,
                        duration_ms=812)
    assert trail.document()["turns"][0]["prompts"][0]["id"] == pid
    # Causal order inside the turn is model -> prompts -> actions.
    assert list(trail.document()["turns"][0].keys()).index("model") \
        < list(trail.document()["turns"][0].keys()).index("prompts") \
        < list(trail.document()["turns"][0].keys()).index("actions")


def test_seq_is_monotonic_across_turns(trail):
    a = _seed(trail)
    trail.end_turn(a, timings={"observe": 0.3})
    b = trail.begin_turn(step=1, url="u", page_title="t", ax_targets=1,
                          ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    p = trail.record_prompt(b, kind="ask_human", action="ask_human",
                            args={}, domain=None, reason="Which repo?")
    assert trail.document()["turns"][1]["prompts"][0]["seq"] \
        > trail.document()["turns"][0]["seq"]


def test_totals_track_turns_prompts_actions_and_tokens(trail):
    turn = _seed(trail)
    trail.record_model(turn, thought="t", reasoning="r", tokens_in=10,
                       tokens_out=2, context_pct=0.1, latency_ms=5)
    trail.record_prompt(turn, kind="critical_action", action="click",
                        args={}, domain=None, reason="…")
    trail.record_action(turn, action="click", args={}, outcome="ok", ok=True,
                        redacted=False, duration_ms=1)
    totals = trail.document()["totals"]
    assert totals == {"turns": 1, "steps": 1, "prompts": 1, "actions": 1,
                      "tokens_in": 10, "tokens_out": 2,
                      "cache_read_tokens": 0, "cache_write_tokens": 0,
                      "wall_s": 0.0, "errors": 0}


def test_resolve_prompt_records_decision_and_wait(trail):
    turn = _seed(trail)
    pid = trail.record_prompt(turn, kind="sensitive_action", action="click",
                              args={}, domain=None, reason="…")
    trail.resolve_prompt(pid, decision="denied", response="no", wait_ms=4210)
    p = trail.document()["turns"][0]["prompts"][0]
    assert p["decision"] == "denied"
    assert p["response"] == "no"
    assert p["wait_ms"] == 4210
    assert p["status"] == "answered"
    assert p["raised_at"] and p["answered_at"]


def test_unresolved_prompt_reads_as_pending(trail):
    turn = _seed(trail)
    trail.record_prompt(turn, kind="critical_action", action="click",
                        args={}, domain=None, reason="…")
    # The socket died between raising and answering.
    assert trail.document()["turns"][0]["prompts"][0]["status"] == "pending"


def test_previous_file_survives_a_crash_mid_dump(trail, tmp_path, monkeypatch):
    _seed(trail)
    before = trail.path.read_text()

    class Boom(Exception):
        pass

    real = json.dump

    def exploding_dump(obj, fp, **kw):
        fp.write('{"partial":')      # half a document on disk
        raise Boom("killed mid-write")

    monkeypatch.setattr(json, "dump", exploding_dump)
    trail.set_status("failed")
    monkeypatch.setattr(json, "dump", real)

    # os.replace never ran, so the temp file was discarded and the last
    # good document is intact — not truncated.
    assert trail.path.read_text() == before
    assert json.loads(trail.path.read_text())["status"] != "failed"
    assert trail.dropped_writes == 1


def test_write_failure_never_raises_into_the_caller(tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("not a directory")
    unwritable = blocker / "sessions"   # a file stands where a dir must be
    t = AuditTrail("s1", dir=unwritable)   # mkdir fails -> every write fails
    t.set_goal("g")
    t.set_status("completed")
    t.finish({"status": "completed", "summary": "s"})
    assert t.dropped_writes > 0
    assert t.document()["totals"]["errors"] == t.dropped_writes


def test_write_failure_log_line_does_not_quote_the_payload(tmp_path, caplog):
    """A serialization failure can quote the value that failed to serialize,
    and that value is the document. The log is the broadly-visible sink, so it
    gets the exception type; the message stays in the per-session document."""
    blocker = tmp_path / "afile"
    blocker.write_text("not a directory")
    t = AuditTrail("s1", dir=blocker / "sessions")
    with caplog.at_level("WARNING"):
        t.set_goal("g")
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "NotADirectoryError" in logged
    assert "not a directory" not in logged


def test_scratchpad_is_per_session_not_shared(tmp_path):
    """`dir` holds every session, so a bare scratchpad.txt would make
    concurrent tasks overwrite each other's memory and read each other's."""
    a = AuditTrail("alpha", dir=tmp_path)
    b = AuditTrail("beta", dir=tmp_path)
    assert a.scratchpad_path != b.scratchpad_path
    assert a.scratchpad_path.parent == b.scratchpad_path.parent == tmp_path
    assert "alpha" in a.scratchpad_path.name

    a.set_scratchpad(Scratchpad(notes="alpha was here"))
    b.set_scratchpad(Scratchpad(notes="beta was here"))
    assert load_scratchpad(a.scratchpad_path).notes == "alpha was here"
    assert load_scratchpad(b.scratchpad_path).notes == "beta was here"


def test_non_password_secrets_are_still_redacted():
    """An API-key or token field is usually type=text, so the definitive
    check misses it and the accessible name is all there is."""
    for name in ("API Key", "Access Token", "Client Secret", "Authorization",
                 "Recovery Code", "CSRF token", "Private Key"):
        assert is_secret_field({}, name) is True, name
    assert is_secret_field({"type": "password"}, "anything at all") is True


def test_ordinary_fields_are_not_redacted():
    """The cost of a false positive is a replay that says [redacted], so the
    vocabulary has to stay narrower than 'contains a sensitive-ish word'."""
    for name in ("Email", "Search", "First name", "Shipping address",
                 "Username", "Phone"):
        assert is_secret_field({}, name) is False, name


def test_record_error_returns_id_and_appends(trail):
    eid = trail.record_error(code="ws_send_failed", where="harness.run",
                             message="socket gone", detail={"type": "action"})
    assert len(eid) == 6
    assert trail.document()["errors"][0]["error_id"] == eid
    assert trail.document()["totals"]["errors"] == 1


def test_read_of_truncated_file_returns_corrupt_stub(tmp_path):
    p = tmp_path / "s1.json"
    p.write_text('{"schema_version": 1, "session_id": "s1", "tur')
    doc = read("s1", dir=tmp_path)
    assert doc["corrupt"] is True
    assert doc["session_id"] == "s1"
    assert doc["turns"] == []


def test_read_of_missing_session_returns_404_shaped_stub(tmp_path):
    doc = read("nope", dir=tmp_path)
    assert doc["found"] is False


def test_a_sidecar_is_not_reachable_as_a_session(tmp_path):
    """`<id>.pages.json` is the full page text of every step, and `read()`
    builds its path by concatenation — so `GET /v1/sessions/<id>.pages/audit`
    used to hand it over verbatim. The endpoint is unauthenticated, which is
    what makes the one-line guard below load-bearing rather than tidy.
    """
    (tmp_path / "s1.json").write_text('{"schema_version": 2, "session_id": "s1"}')
    (tmp_path / "s1.pages.json").write_text('{"e1": "the user banked at 09:14"}')

    assert read("s1.pages", dir=tmp_path)["found"] is False
    # And it must not be listed as a session of its own.
    assert [e["session_id"] for e in list_sessions(dir=tmp_path)] == ["s1"]


def test_a_traversing_session_id_reads_nothing(tmp_path):
    """`session_id` is an untrusted path segment. Anything that is not a bare
    dot-free token is refused before it reaches the filesystem."""
    outside = tmp_path.parent / "secret.json"
    outside.write_text('{"session_id": "not-yours"}')
    assert read("../secret", dir=tmp_path)["found"] is False
    assert read("..", dir=tmp_path)["found"] is False
    assert read("", dir=tmp_path)["found"] is False


def test_list_sessions_returns_newest_first(tmp_path):
    for sid, goal in (("a", "first"), ("b", "second")):
        t = AuditTrail(sid, dir=tmp_path)
        t.set_goal(goal)
        t.set_status("completed")
        t.finish({"status": "completed", "summary": ""})
    listed = list_sessions(dir=tmp_path)
    assert [e["session_id"] for e in listed] == ["b", "a"]
    assert listed[0]["task"] == "second"


def test_long_field_is_capped_and_marked(trail):
    t2 = AuditTrail("s1", dir=trail.dir)
    turn = t2.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                         ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    t2.record_model(turn, thought="x" * (MAX_FIELD_CHARS + 500),
                    reasoning="r", tokens_in=1, tokens_out=1,
                    context_pct=0.0, latency_ms=1)
    m = t2.document()["turns"][0]["model"]
    assert len(m["thought"]) == MAX_FIELD_CHARS
    assert m["thought_truncated"] is True


def test_session_killed_mid_step_leaves_last_turn_intact(trail, tmp_path):
    turn = _seed(trail)
    trail.record_model(turn, thought="half a turn", reasoning="…",
                       tokens_in=5, tokens_out=1, context_pct=0.1, latency_ms=5)
    # Killed here: begin_turn ran, end_turn did not.
    doc = read("s1", dir=tmp_path)
    assert doc["turns"][0]["model"]["tokens_in"] == 5
    assert doc["turns"][0]["ended_at"] is None      # visibly unfinished
    assert doc["status"] == "running"               # not silently "completed"


def test_scratchpad_roundtrip_keeps_legacy_plain_text_parse(tmp_path):
    from brotto_orchestrator.agent.audit import load_scratchpad, save_scratchpad
    p = tmp_path / "scratchpad.txt"
    save_scratchpad(p, Scratchpad(notes="GOAL: find it"))
    assert load_scratchpad(p).notes == "GOAL: find it"
    # A legacy file with no header still parses, as notes only.
    p.write_text("just notes, no header")
    assert load_scratchpad(p).entries == []
    assert load_scratchpad(p).notes == "just notes, no header"


def test_scratchpad_entries_survive_a_restart(tmp_path):
    """The format the agent re-reads to restore its memory after a kill."""
    from brotto_orchestrator.agent.audit import load_scratchpad, save_scratchpad
    p = tmp_path / "scratchpad.txt"
    entry = MemoryEntry(id="r1", step=0, selector="body", around=None,
                        digest="Top 5 repos for suryansh", body="Top 5 repos...",
                        was_truncated=False)
    save_scratchpad(p, Scratchpad(entries=[entry], notes="GOAL: find it"))
    back = load_scratchpad(p)
    assert [e.id for e in back.entries] == ["r1"]
    assert back.entries[0].selector == "body"
    assert back.entries[0].body == "Top 5 repos for suryansh"
    assert back.notes == "GOAL: find it"


def test_set_scratchpad_snapshots_into_the_document(trail):
    from brotto_orchestrator.agent.audit import load_scratchpad
    trail.set_scratchpad(Scratchpad(notes="GOAL: find it"))
    assert trail.document()["scratchpad"]["notes"] == "GOAL: find it"
    # The memory file landed next to the document, in the same format.
    assert load_scratchpad(trail.scratchpad_path).notes == "GOAL: find it"


def test_approve_then_socket_drop_leaves_action_not_run(trail, tmp_path):
    """Review focus 3: approved, but the action never executed. A resume
    must see the approval and the absence of the action, never a re-run."""
    turn = _seed(trail)
    pid = trail.record_prompt(turn, kind="sensitive_action", action="click",
                              args={"ref": "r1"}, domain=None,
                              reason="clicking Send")
    trail.resolve_prompt(pid, decision="approved", response="yes", wait_ms=90)
    # Socket died here — no record_action, no end_turn.
    doc = read("s1", dir=tmp_path)
    p = doc["turns"][0]["prompts"][0]
    assert (p["status"], p["decision"]) == ("answered", "approved")
    assert doc["turns"][0]["actions"] == []
    assert doc["turns"][0]["ended_at"] is None
    assert doc["status"] == "running"


def test_redacted_action_keeps_text_length(trail):
    turn = _seed(trail)
    original = "hunter2"
    trail.record_action(turn, action="type_text",
                        args={"text": REDACTED, "text_chars": len(original)},
                        outcome="Typed", ok=True, redacted=True, duration_ms=12)
    a = trail.document()["turns"][0]["actions"][0]
    assert a["redacted"] is True
    assert a["args"]["text"] == REDACTED
    assert a["args"]["text_chars"] == len(original)


def test_record_policy_appends_off_turn(trail):
    trail.set_policy({"mode": "secure"})
    trail.record_policy(step=2, kind="preflight", domain=None, action=None,
                        decision="blocked", user_decision=None)
    ev = trail.document()["policy_events"][0]
    assert (ev["kind"], ev["decision"]) == ("preflight", "blocked")
    # The policy config itself is untouched by the event log.
    assert trail.document()["policy"]["mode"] == "secure"


def test_bad_turn_index_is_a_no_op_not_a_crash(trail):
    _seed(trail)
    trail.record_model(99, thought="t", reasoning="r", tokens_in=1,
                       tokens_out=1, context_pct=0.0, latency_ms=1)
    trail.record_action(99, action="click", args={}, outcome="", ok=True,
                        redacted=False, duration_ms=1)
    trail.end_turn(99, timings={})
    assert trail.dropped_writes == 0
    assert trail.document()["totals"]["actions"] == 0


def test_resolve_of_an_unknown_prompt_is_a_no_op(trail):
    _seed(trail)
    trail.resolve_prompt("nope", decision="approved", response="y", wait_ms=1)
    assert trail.dropped_writes == 0


def test_new_error_id_is_six_base36_chars():
    from brotto_orchestrator.agent.audit import new_error_id
    ids = {new_error_id() for _ in range(200)}
    assert len(ids) == 200
    for i in ids:
        assert len(i) == 6 and all(c in "0123456789abcdefghijklmnopqrstuvwxyz" for c in i)


def test_policy_event_during_a_run_goes_through_the_live_writer(tmp_path):
    """A running trail holds the document in memory and rewrites the whole
    file on every flush. A second writer read-modify-writing the path would
    be clobbered by the next flush, so the event has to reach the instance.
    Recording it, then writing again, must not lose the event."""
    from brotto_orchestrator.agent.audit import append_policy_event

    t = AuditTrail("live", dir=tmp_path)
    t.set_goal("g")
    t.begin_turn(step=0, url="u", page_title="t", ax_targets=1, ax_chars=1,
                 ax_diff_chars=0, page_text_chars=0)

    append_policy_event("live", step=None, kind="policy_acknowledged",
                        domain=None, action=None, decision="mode=secure")

    # Anything the loop writes afterwards must not erase it.
    t.end_turn(0, timings={})
    t.set_status("running")

    doc = json.loads((tmp_path / "live.json").read_text())
    kinds = [e["kind"] for e in doc["policy_events"]]
    assert kinds == ["policy_acknowledged"]
    assert doc["policy_events"][0]["decision"] == "mode=secure"
    t.close()


def test_policy_event_for_an_unknown_session_creates_nothing(tmp_path,
                                                              monkeypatch):
    from brotto_orchestrator.agent.audit import append_policy_event
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))

    append_policy_event("never-ran", step=None, kind="policy_acknowledged",
                        domain=None, action=None, decision="mode=secure")

    assert list(tmp_path.glob("*.json")) == []


def test_a_traversing_session_id_writes_no_policy_event(tmp_path, monkeypatch):
    """`read` and `delete` have always refused a `session_id` that is not a
    bare dot-free token. This sink did not, and nothing tested it, so the gap
    was invisible: CodeQL found the un-guarded path, not a test.

    It read-modify-writes, and `exists()` only admits a file that is already
    there — so a caller-supplied `../../..` could open and rewrite whatever
    JSON sat above the sessions directory. The panel's Save and
    `/v1/policy_ack` both reach this with a caller-supplied id.
    """
    from brotto_orchestrator.agent.audit import append_policy_event

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    outside = tmp_path / "victim.json"
    original = '{"session_id": "not-yours"}'
    outside.write_text(original)
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(sessions))

    for hostile in ("../victim", "..", "", "a/b"):
        append_policy_event(hostile, step=0, kind="policy_acknowledged",
                            domain=None, action=None, decision="mode=secure")

    assert outside.read_text() == original, "a policy event wrote outside the directory"
    assert list(sessions.glob("*.json")) == []


def test_closed_trail_stops_accepting_live_events(tmp_path):
    t = AuditTrail("sealed", dir=tmp_path)
    t.set_goal("g")
    t.close()
    from brotto_orchestrator.agent import audit as audit_mod
    with audit_mod._LIVE_LOCK:
        assert "sealed" not in audit_mod._LIVE
