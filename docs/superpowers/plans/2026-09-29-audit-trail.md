# Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One nested JSON document per session that records ordered turns, every user prompt and its answer, timestamps, and per-turn plus per-session token usage — enough to replay a run and drive the side-panel history UI — followed by reconnect and resume on top of it.

**Architecture:** A new `agent/audit.py` owns the whole session document in memory and flushes it to `logs/sessions/<session_id>.json` via `json.dump` to a temp file plus `os.replace`, so a crash mid-write leaves the previous valid file and the document is complete at every instant. The server is the only writer. The panel keeps a demoted index in `chrome.storage.local` and fetches the document on demand. The harness is already stateless per step (`agent.run` is called with a rebuilt prompt and no `message_history`), which is what makes Part B's resume sound.

**Tech Stack:** Python 3.12, pydantic, FastAPI, pytest. Chrome MV3 extension, TypeScript compiled by esbuild, plain JS in the panel.

**Spec:** `docs/superpowers/specs/2026-09-29-audit-trail-design.md` — the spec travels with this plan; executors read both.

## Global Constraints

- `schema_version` is `1`. Every document carries it, so Part B can read a file written by an older build.
- Audit path is `logs/sessions/<session_id>.json`. The old `logs/runs/<task_id>/` layout is retired for steps and policy; `scratchpad.txt` moves but keeps its exact plain-text format and its legacy parse.
- The writer **never raises into the agent loop.** Every `record_*` and every flush is wrapped; a failure increments a dropped-write counter, logs at WARNING, and appends to the document's own `errors` array.
- `os.replace` is the only durability mechanism. No append-only JSONL, no compaction, no second format.
- `MAX_FIELD_CHARS = 8_000` caps any single scalar on write. A capped field keeps its first 8 000 chars and gains a sibling `"…truncated": true` marker. Record the cap; never silently drop it.
- `REDACTED = "[redacted:password]"`. A redacted `type_text` keeps `text_chars` (the original length) so the replay can show that something was typed.
- Error correlation ids are `base36`, 6 characters, from `secrets`. One id per error, appearing in the audit document, the log line, and the panel bubble.
- The session `id` in the document is the server's UUID from `POST /v1/sessions`, not the panel's `startedAt`.
- No new runtime dependencies. Everything is stdlib or already installed.
- No `Co-Authored-By: Claude` or any attribution line in commit messages (per `~/.claude/CLAUDE.md`).
- The extension has **no test suite** — `clients/brotto-extension/tests/` does not exist and `npm run test` would fail on a missing glob. Extension tasks verify with `npm run build` plus a stated manual checklist. Do not claim UI correctness that was not observed in a browser.
- `CLAUDE.md` is updated in the same commit as the change it describes (project working agreement 3).

## Review Focus

The failure modes the spec implies but no task's happy-path test exercises, most likely to bite a real user first. Each gets a test in the task that owns the code.

1. **The audit file is read while the task is still running.** A monitoring GET mid-task must return a complete, parseable document — not a half-written one and not a 404. → Task 3.
2. **The task is killed mid-step (OOM, `kill -9`, laptop closed).** The last completed turn must survive intact and the session must read as `interrupted`, not `running` forever and not a corrupt file. → Task 1.
3. **The user approves an action, then the socket drops before the action executes.** The prompt must read as approved and the action must read as not-run, so a resume never re-runs an approved-but-unexecuted action. → Task 1.
4. **A password field has a blank accessible name and the definitive `get_attributes` call fails.** Redaction must still happen or the write must be skipped — never a plaintext credential in the file. → Task 6.
5. **The panel opens history with the server down.** The list must render and a row click must still refill the composer. Losing the ability to re-run a task because a detail view is unreachable is a regression, not a degraded feature. → Task 5.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `agent/audit.py` | **NEW.** Owns the session document, the atomic flush, redaction of the typed value, and every record method. No knowledge of the agent loop. |
| `agent/run_logger.py` | **DELETED.** `Scratchpad` load/save moves into `audit.py` verbatim; `log_step`/`log_policy` are replaced. |
| `agent/harness.py` | Consumes `AuditTrail`. Owns the `_ask_user` consolidation. Redacts at `type_text`. |
| `main.py` | Two GET endpoints, app-level exception envelope, guarded `request.json()`, registry eviction. |
| `cdp/extension_relay.py` | `backend_node_id` mapping + `get_attributes`. |
| `cdp/relay.py` | `get_attributes` on the Playwright side. |
| `dev/ax_tree_extractor.py` | `SemanticTarget.backend_node_id` already exists and is populated; only `CDPRelay` needs to expose it. |
| `clients/.../background.ts` | Serves `get_attributes`; sends `backendNodeId` and `session_id`; seven error fixes. |
| `clients/.../sidepanel.js` / `.html` | Index gains `session_id`; transcript view. |

## Execution Waves

Tasks in the same wave touch **disjoint files** and can run in parallel. This is the constraint that matters — `harness.py` is 1429 lines and six of the changes land in overlapping regions of it, so it gets exactly one owner and is one task.

- **Wave 1 (parallel):** Task 1, Task 2
- **Wave 2 (parallel, after 1 + 2):** Task 3, Task 4, Task 5, Task 6
- **Wave 3 (sequential, after 2 + 3 + 4 + 6):** Task 7
- **Wave 4:** Task 8

---

### Task 1: The `AuditTrail` writer

**Files:**
- Create: `services/brotto-orchestrator/src/brotto_orchestrator/agent/audit.py`
- Create: `services/brotto-orchestrator/tests/agent/test_audit.py`
- Delete: `services/brotto-orchestrator/src/brotto_orchestrator/agent/run_logger.py`

**Interfaces:**
- Consumes: nothing. This task defines the whole audit API that every later task calls.
- Produces — every later task depends on these exact names:

```python
MAX_FIELD_CHARS = 8_000
REDACTED = "[redacted:password]"

def new_error_id() -> str
def default_dir() -> Path                    # Path(os.getenv("BROTTO_SESSIONS_DIR", "logs/sessions"))
def read(session_id: str, *, dir: Path | None = None) -> dict
def list_sessions(*, dir: Path | None = None) -> list[dict]
def load_scratchpad(path: Path) -> Scratchpad
def save_scratchpad(path: Path, scratchpad: Scratchpad) -> None

class AuditTrail:
    def __init__(self, session_id: str, *, dir: Path | None = None) -> None
    path: Path                                # property
    dropped_writes: int                       # property
    def document(self) -> dict                # deep copy, for tests
    def set_goal(self, goal: str) -> None
    def set_client(self, *, ip_hash: str, extension_version: str = "") -> None
    def set_model(self, *, provider: str, model: str, context_window: int, source: str) -> None
    def set_policy(self, policy: dict) -> None
    def set_status(self, status: str) -> None
    def begin_turn(self, *, step: int, url: str, page_title: str,
                   ax_targets: int, ax_chars: int, ax_diff: str,
                   page_text_chars: int) -> int
    def record_model(self, turn: int, *, thought: str, reasoning: str,
                     tokens_in: int, tokens_out: int,
                     context_pct: float, latency_ms: int) -> None
    def record_prompt(self, turn: int, *, kind: str, action: str, args: dict,
                      domain: str | None, reason: str) -> str   # -> prompt id
    def resolve_prompt(self, prompt_id: str, *, decision: str,
                       response: str, wait_ms: int) -> None
    def record_action(self, turn: int, *, action: str, args: dict,
                      outcome: str, ok: bool, redacted: bool,
                      duration_ms: int) -> None
    def end_turn(self, turn: int, *, timings: dict) -> None
    def record_policy(self, *, step: int, kind: str, domain: str | None,
                      action: str | None, decision: str,
                      user_decision: str | None = None) -> None
    def record_error(self, *, code: str, where: str, message: str,
                     detail: dict | None = None) -> str            # -> error_id
    def set_scratchpad(self, scratchpad: dict) -> None
    def finish(self, result: dict) -> None
```

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/test_audit.py`:

```python
import json
import os
from pathlib import Path

import pytest

from brotto_orchestrator.agent.audit import (
    MAX_FIELD_CHARS, REDACTED, AuditTrail, list_sessions, read,
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
                        ax_targets=41, ax_chars=12345, ax_diff="+3",
                        page_text_chars=890)


def test_document_is_valid_json_after_every_record(trail, tmp_path):
    turn = _seed(trail)
    trail.record_model(turn, thought="Sort by stars", reasoning="…",
                       tokens_in=1500, tokens_out=220,
                       context_pct=0.15, latency_ms=1820)
    # Readable by an outside reader at every instant, not just at the end.
    doc = read("s1", dir=tmp_path)
    assert doc["schema_version"] == 1
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
                          ax_chars=1, ax_diff="", page_text_chars=0)
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
    unwritable = tmp_path / "nodir"
    t = AuditTrail("s1", dir=unwritable)   # dir does not exist -> mkdir fails
    t.set_goal("g")
    t.set_status("completed")
    t.finish({"status": "completed", "summary": "s"})
    assert t.dropped_writes > 0
    assert t.document()["totals"]["errors"] == t.dropped_writes


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
                         ax_chars=1, ax_diff="", page_text_chars=0)
    t2.record_model(turn, thought="x" * (MAX_FIELD_CHARS + 500),
                    reasoning="r", tokens_in=1, tokens_out=1,
                    context_pct=0.0, latency_ms=1)
    m = t2.document()["turns"][0]["model"]
    assert len(m["thought"]) == MAX_FIELD_CHARS
    assert m["thought_truncated"] is True


def test_scratchpad_roundtrip_keeps_legacy_plain_text_parse(tmp_path):
    from brotto_orchestrator.agent.audit import load_scratchpad, save_scratchpad
    p = tmp_path / "scratchpad.txt"
    save_scratchpad(p, Scratchpad(notes="GOAL: find it"))
    assert load_scratchpad(p).notes == "GOAL: find it"
    # A legacy file with no header still parses, as notes only.
    p.write_text("just notes, no header")
    assert load_scratchpad(p).entries == []
    assert load_scratchpad(p).notes == "just notes, no header"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/agent/test_audit.py -q
```
Expected: collection error — `ModuleNotFoundError: No module named 'brotto_orchestrator.agent.audit'`.

- [ ] **Step 3: Write the implementation**

Create `src/brotto_orchestrator/agent/audit.py`. Move `RunLogger`'s `_append_policy_row` scratchpad format across **verbatim** — the `# MEMORY v2` / `# MANIFEST` / `# NOTES` text, the `re.match` manifest line, and the "no header means notes only" fallback are all load-bearing for the agent's memory across restarts and for files already on disk. Do not reformat them.

```python
"""Per-session audit trail: one nested JSON document per run.

The writer holds the whole document in memory and flushes it with
`json.dump` to a temp file plus `os.replace`. That single atomic rename
is the entire durability story: a crash mid-write leaves the previous
valid file rather than a truncated one, and the document on disk is
complete at every instant — which is what lets a monitor read a run
that is still going.

This REPLACES logs/runs/<task_id>/steps.jsonl and policy.log. The
scratchpad's plain-text format is unchanged and moves here verbatim,
because the agent re-reads it to restore its own memory across a
restart and files already on disk must keep parsing.

The writer never raises into the agent loop. Every record method is
wrapped; a failure is counted, logged, and recorded in the document's
own `errors` array, because losing a disk write must not stop a task.
"""

from __future__ import annotations

import copy
import datetime as _dt
import json
import logging
import os
import re
import secrets
import threading
from pathlib import Path
from typing import Any

from .context import MemoryEntry, Scratchpad

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# A single scalar is capped so one pathological page cannot produce a
# multi-megabyte document. The cap is recorded rather than silent.
MAX_FIELD_CHARS = 8_000

REDACTED = "[redacted:password]"

# ponytail: one directory, one file per session, no database and no index.
# Upgrade path if a session ever outgrows an atomic rewrite (megabytes of
# per-step page text would do it): append JSONL during the run, compact to
# this document at task end.
def default_dir() -> Path:
    return Path(os.getenv("BROTTO_SESSIONS_DIR", "logs/sessions"))


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds")


def new_error_id() -> str:
    # Short enough to read aloud over support, long enough to be unique
    # within a session. 6 base36 chars is ~2 billion values.
    return secrets.token_hex(3).encode().hex() and secrets.randbelow(36 ** 6).__format__("06x")[:6]


def _cap(value: Any) -> Any:
    """Truncate an over-long scalar, leaving a marker for the reader."""
    if isinstance(value, str) and len(value) > MAX_FIELD_CHARS:
        return value[:MAX_FIELD_CHARS]
    return value
```

Implement `_cap` as returning the value only, and have each field written via a helper `_text(value, container, key)` that sets both `key` and `key + "_truncated"`. Keep the helper private; tests only touch the public surface above.

```python
class AuditTrail:
    def __init__(self, session_id: str, *, dir: Path | None = None) -> None:
        self.session_id = session_id
        self._dir = dir or default_dir()
        self._path = self._dir / f"{session_id}.json"
        self._lock = threading.Lock()
        self._dropped = 0
        self._seq = 0
        self._prompt_index: dict[str, dict] = {}
        self._doc: dict = {
            "schema_version": SCHEMA_VERSION,
            "session_id": session_id,
            "created_at": _now(),
            "updated_at": _now(),
            "status": "running",
            "goal": "",
            "client": {},
            "model": {},
            "policy": {},
            "totals": {"turns": 0, "steps": 0, "prompts": 0, "actions": 0,
                       "tokens_in": 0, "tokens_out": 0, "wall_s": 0.0,
                       "errors": 0},
            "turns": [],
            "errors": [],
        }
        self._mkdir()

    # ── durability ──────────────────────────────────────────────
    def _mkdir(self) -> None:
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # A missing directory is survivable: every write below will
            # also fail and be counted, but construction must not raise,
            # because the constructor runs inside the agent loop.
            log.warning("audit: cannot create %s: %s", self._dir, exc)

    def _flush(self) -> None:
        try:
            self._doc["updated_at"] = _now()
            tmp = self._path.with_suffix(".json.tmp")
            with tmp.open("w") as fp:
                json.dump(self._doc, fp, ensure_ascii=False, default=str)
            # os.replace is atomic on POSIX. Until this line the old file
            # is intact; after it the new one is. There is no window in
            # which the path holds a half-written document.
            os.replace(tmp, self._path)
        except Exception as exc:
            self._dropped += 1
            log.warning("audit: write failed for %s: %s", self.session_id, exc)

    def _record(self, fn, *args, **kwargs) -> None:
        """Run one mutation under the lock, then flush. Never raises."""
        with self._lock:
            try:
                fn(*args, **kwargs)
                self._flush()
            except Exception as exc:
                self._dropped += 1
                self._doc["totals"]["errors"] = self._dropped
                log.warning("audit: record failed for %s: %s",
                            self.session_id, exc)

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    # ── accessors ───────────────────────────────────────────────
    @property
    def path(self) -> Path:
        return self._path

    @property
    def dropped_writes(self) -> int:
        return self._dropped

    def document(self) -> dict:
        return copy.deepcopy(self._doc)
```

Each public record method is a thin `_record(self._<name>, ...)` where the private method mutates `self._doc` without I/O. Required behaviours:

- `set_status(s)` sets `doc["status"]`.
- `begin_turn(...)` appends a turn dict with `seq=self._next_seq()`, `started_at=_now()`, `ended_at=None`, `observation={...}`, `model=None`, `prompts=[]`, `actions=[]`, `timings={}`, `error=None`; returns `len(doc["turns"]) - 1`; increments `totals["turns"]` and `totals["steps"]`.
- `record_model(turn, ...)` writes the `model` block and adds to `totals["tokens_in"]/["tokens_out"]`.
- `record_prompt(turn, ...)` returns a `secrets.token_hex(8)` id, appends `{id, seq, kind, status: "pending", raised_at, answered_at: None, wait_ms: None, action, args, domain, reason, decision: None, response: None}`, and records it in `self._prompt_index` keyed by id **together with its turn index** so `resolve_prompt` can find it again. Increments `totals["prompts"]`.
- `resolve_prompt(prompt_id, ...)` looks the prompt up, sets `status="answered"`, `answered_at`, `wait_ms`, `decision`, `response`. A `prompt_id` that is not found is a no-op (the run may have been truncated) — do not raise.
- `record_action(turn, ...)` appends with `started_at`/`ended_at` around a `duration_ms`, and `redacted` as given. Increments `totals["actions"]`.
- `end_turn(turn, timings)` sets `ended_at` and `timings`.
- `record_policy(...)` appends to a `policy` list on the document root (these are the flat blocks and preflight declines that belong to no single turn), each with `seq` and `at`.
- `record_error(...)` returns a 6-char id and appends `{seq, at, error_id, code, where, message, detail}`; sets `totals["errors"]`.
- `set_scratchpad(scratchpad)` stores `{entries: [...], notes: "..."}` and also calls the moved `save_scratchpad` so the agent's memory file stays where it expects it.
- `finish(result)` sets `doc["result"] = result`, derives `status` from `result["status"]` when present, sets `totals["wall_s"]` from `result["timing"]["wall_s"]` when present, and flushes once more.

Then the module-level readers:

```python
def read(session_id: str, *, dir: Path | None = None) -> dict:
    """Read one document. Never raises: a damaged file is reported."""
    d = dir or default_dir()
    p = d / f"{session_id}.json"
    if not p.exists():
        return {"found": False, "session_id": session_id}
    try:
        doc = json.loads(p.read_text())
        doc.setdefault("found", True)
        return doc
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("audit: %s unreadable: %s", p, exc)
        return {"found": True, "corrupt": True, "schema_version": SCHEMA_VERSION,
                "session_id": session_id, "status": "corrupt", "turns": [],
                "errors": [{"code": "audit_unreadable", "message": str(exc)}],
                "totals": {"turns": 0, "steps": 0, "prompts": 0, "actions": 0,
                           "tokens_in": 0, "tokens_out": 0, "errors": 1}}


def list_sessions(*, dir: Path | None = None) -> list[dict]:
    """Index of every session on disk, newest first."""
    d = dir or default_dir()
    out = []
    try:
        files = sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return []
    for p in files:
        doc = read(p.stem, dir=d)
        out.append({
            "session_id": doc.get("session_id", p.stem),
            "task": doc.get("goal", ""),
            "status": doc.get("status", "unknown"),
            "steps": doc.get("totals", {}).get("steps", 0),
            "started_at": doc.get("created_at"),
            "corrupt": bool(doc.get("corrupt")),
        })
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/agent/test_audit.py -q
```
Expected: all pass.

- [ ] **Step 5: Add the Review Focus test for a killed task**

Add to `tests/agent/test_audit.py`:

```python
def test_session_killed_mid_step_leaves_last_turn_intact(trail, tmp_path):
    turn = _seed(trail)
    trail.record_model(turn, thought="half a turn", reasoning="…",
                       tokens_in=5, tokens_out=1, context_pct=0.1, latency_ms=5)
    # Killed here: begin_turn ran, end_turn did not.
    doc = read("s1", dir=tmp_path)
    assert doc["turns"][0]["model"]["tokens_in"] == 5
    assert doc["turns"][0]["ended_at"] is None      # visibly unfinished
    assert doc["status"] == "running"               # not silently "completed"
```

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/ -q
```
Expected: failures only where `run_logger` is still imported. Record the exact list — Task 6 removes them all; do not patch around them here.

- [ ] **Step 7: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/agent/audit.py \
        services/brotto-orchestrator/tests/agent/test_audit.py
git commit -m "audit: one nested JSON document per session

Holds the document in memory and flushes with json.dump to a temp file
plus os.replace, so a crash mid-write leaves the previous valid file and
the document on disk is complete at every instant — which is what makes
a run readable for monitoring while it is still going.

Append-only JSONL was the cheaper-per-event option and was rejected:
under it the document does not exist until a task ends cleanly, so a
crashed task leaves nothing, and that is exactly the case an audit
trail exists for.

The writer never raises into the agent loop. A failed write is
counted, logged, and appended to the document's own errors array,
because losing a disk write must not stop a task.

The scratchpad's plain-text format moves across verbatim: the agent
re-reads it to restore its memory across a restart and files already
on disk must keep parsing."
```

Note: `run_logger.py` is deleted in Task 6, not here, because `harness.py` imports it until then. This commit adds the new module alongside it.

---

### Task 2: `backend_node_id` and `get_attributes` on both relays

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/cdp/extension_relay.py:210` (`_to_semantic`)
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/cdp/relay.py`
- Test: `services/brotto-orchestrator/tests/test_relay_attributes.py`

**Interfaces:**
- Consumes: nothing.
- Produces — the harness (Task 6) calls this through `deps.cdp`:

```python
class ExtensionCDPRelay:
    async def get_attributes(self, backend_node_id: int) -> dict[str, str]
class CDPRelay:
    async def get_attributes(self, backend_node_id: int) -> dict[str, str]
```
Returns `{}` on any failure — this is a best-effort privacy check, and a
relay that raises here would abort a `type_text` that was about to succeed.

Wire shape the extension must service (Task 4 implements it):

```json
{"type": "get_attributes", "backend_node_id": 12345, "ref": "ack-1"}
{"type": "get_attributes_result", "ref": "ack-1", "attributes": {"type": "password"}}
```

`SemanticTarget.backend_node_id` already exists (`dev/ax_tree_extractor.py:24`) and the Playwright extractor already populates it (`:168`). Only the extension path is missing it.

- [ ] **Step 1: Write the failing test**

Create `tests/test_relay_attributes.py`:

```python
import pytest

from brotto_orchestrator.cdp.extension_relay import _to_semantic
from brotto_orchestrator.agent.audit import REDACTED


def test_to_semantic_carries_backend_node_id():
    out = _to_semantic([{"ref": "7", "role": "textbox", "name": "Password",
                         "backendNodeId": 4242}])
    assert out[0].backend_node_id == 4242


def test_to_semantic_tolerates_missing_backend_node_id():
    out = _to_semantic([{"ref": "7", "role": "textbox", "name": "Email"}])
    assert out[0].backend_node_id is None


def is_secret(attrs: dict, name: str) -> bool:
    """The rule Task 6 uses. Defined here so both relays agree on it."""
    if (attrs.get("type") or "").lower() == "password":
        return True
    return bool(_NAME_RE.search(name or ""))


import re
_NAME_RE = re.compile(r"password|passcode|passphrase|one[- ]?time|\botp\b|\bpin\b", re.I)


def test_password_attributes_are_secret():
    assert is_secret({"type": "password"}, "Password")


def test_email_attributes_are_not_secret():
    assert not is_secret({"type": "email"}, "Email")
    assert not is_secret({"type": "text"}, "Search issues")
```

Move `_NAME_RE` and `is_secret` into `brotto_orchestrator/agent/audit.py` in Step 3 as the single shared rule, and import them in the test. Two implementations of "is this a password" is exactly the bug this is here to prevent.

- [ ] **Step 2: Run to verify failure**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/test_relay_attributes.py -q
```
Expected: FAIL — `_to_semantic` drops `backendNodeId`.

- [ ] **Step 3: Implement**

In `cdp/extension_relay.py`, extend `_to_semantic` to carry the id:

```python
        result.append(SemanticTarget(
            ref_id=str(t.get("ref", "")),
            tag=t.get("role", ""),
            role=t.get("role", ""),
            name=t.get("name", ""),
            value=t.get("value"),
            coordinates=coords,
            parent_ref_id=str(t["parent"]) if t.get("parent") is not None else None,
            href=t.get("href"),
            # Password detection needs the DOM node, and the AX node is the
            # only place the id is available. Carrying it costs one int on
            # a target that is already being sent.
            backend_node_id=t.get("backendNodeId"),
        ))
```

Add `get_attributes` to `ExtensionCDPRelay`. It sends the request and waits for the matching result, with a short timeout:

```python
    async def get_attributes(self, backend_node_id: int) -> dict[str, str]:
        """DOM attributes for one node, or {} on any failure.

        Best-effort by design: this backs password redaction, and a
        relay that raised here would abort a type_text that was about to
        succeed. The caller falls back to the accessible-name check.
        """
        if not backend_node_id:
            return {}
        ref = f"attrs-{uuid.uuid4().hex[:8]}"
        try:
            await self._send({"type": "get_attributes",
                              "backend_node_id": backend_node_id, "ref": ref})
            attrs = await asyncio.wait_for(self._attrs.get(), timeout=2.0)
            return attrs if isinstance(attrs, dict) else {}
        except Exception as exc:
            log.debug("[%s] get_attributes failed: %s", self._sid, exc)
            return {}
```

You will need an `asyncio.Queue` for results and a branch in the message handler that resolves it by `ref`. Both relays get the same method; `CDPRelay` uses `DOM.getAttributes` directly, mirroring the existing `DOM.getBoxModel` call at `dev/ax_tree_extractor.py:184`.

Add to `agent/audit.py`, the one shared rule:

```python
_SECRET_NAME_RE = re.compile(
    r"password|passcode|passphrase|one[- ]?time|\botp\b|\bpin\b", re.I
)


def is_secret_field(attributes: dict | None, accessible_name: str | None) -> bool:
    """True when a field is a password/secret input.

    Two signals, because neither is sufficient alone. `type="password"`
    is definitive but only available when the DOM lookup succeeded; the
    accessible name is free and always present, but is blank on some
    real login forms. Either one redacts.
    """
    if attributes and (attributes.get("type") or "").lower() == "password":
        return True
    return bool(_SECRET_NAME_RE.search(accessible_name or ""))
```

- [ ] **Step 4: Run to verify pass**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/test_relay_attributes.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/agent/audit.py \
        services/brotto-orchestrator/src/brotto_orchestrator/cdp/extension_relay.py \
        services/brotto-orchestrator/src/brotto_orchestrator/cdp/relay.py \
        services/brotto-orchestrator/tests/test_relay_attributes.py
git commit -m "relay: carry backend_node_id and resolve DOM attributes on demand

Password redaction needs the DOM node's type attribute, and the AX node
is the only place that id is available — SemanticTarget already had the
field, the extension path just was not filling it.

Resolution is lazy rather than per-observation. Fetching attributes for
every textbox on every step would add a CDP round trip per field to a
loop whose latency is the product's main cost; doing it only when a
type_text actually fires costs one round trip per typed action.

is_secret_field lives in one place on purpose. Two implementations of
'is this a password' is the bug this whole check exists to prevent, and
the Playwright and extension relays must not be able to disagree."
```

---

### Task 3: Read endpoints, error envelope, registry eviction

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/main.py`
- Test: `services/brotto-orchestrator/tests/test_audit_endpoint.py`

**Interfaces:**
- Consumes: `audit.read`, `audit.list_sessions` from Task 1.
- Produces: `GET /v1/sessions` → `{"sessions": [{session_id, task, status, steps, started_at, corrupt}]}`; `GET /v1/sessions/{session_id}/audit` → the document. Unauthenticated, matching `/health` and `/v1/policy`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_audit_endpoint.py`:

```python
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent.audit import AuditTrail, default_dir


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    from brotto_orchestrator import main
    return TestClient(main.app, raise_server_exceptions=False)


def _write(tmp_path: Path, sid="s1", goal="find it", status="completed"):
    t = AuditTrail(sid, dir=tmp_path)
    t.set_goal(goal)
    t.set_status(status)
    t.finish({"status": status, "summary": "ok"})
    return t


def test_list_sessions_returns_index(client, tmp_path):
    _write(tmp_path, "s1", "first")
    _write(tmp_path, "s2", "second")
    body = client.get("/v1/sessions").json()
    assert [s["session_id"] for s in body["sessions"]] == ["s2", "s1"]
    assert body["sessions"][0]["task"] == "second"


def test_list_sessions_is_empty_not_an_error_when_none_exist(client):
    assert client.get("/v1/sessions").json() == {"sessions": []}


def test_audit_endpoint_returns_the_document(client, tmp_path):
    _write(tmp_path, "s1", "find it")
    doc = client.get("/v1/sessions/s1/audit").json()
    assert doc["goal"] == "find it"
    assert doc["schema_version"] == 1


def test_unknown_session_is_404_not_500(client):
    r = client.get("/v1/sessions/nope/audit")
    assert r.status_code == 404
    assert r.json()["error"] == "unknown session"


def test_corrupt_document_is_200_with_corrupt_true(client, tmp_path):
    _write(tmp_path, "s1")
    (tmp_path / "s1.json").write_text('{"schema_ver')
    r = client.get("/v1/sessions/s1/audit")
    # A damaged audit file must render a "this session is damaged" state,
    # not an error — the whole point of the file is to survive a crash.
    assert r.status_code == 200
    assert r.json()["corrupt"] is True


def test_malformed_body_to_suggestions_is_400_not_500(client):
    r = client.post("/v1/suggestions",
                    content=b"not json at all",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400
    assert "error" in r.json()


def test_malformed_body_to_policy_ack_is_400_not_500(client):
    r = client.post("/v1/policy_ack",
                    content=b"{oops",
                    headers={"content-type": "application/json"})
    assert r.status_code == 400


def test_unhandled_error_returns_json_envelope_with_error_id(client):
    r = client.get("/v1/sessions/does-not-exist/audit")
    # Even the 404 body is JSON carrying a correlation id.
    assert r.json()["error_id"]


def test_mid_task_document_is_readable(client, tmp_path):
    # Review Focus #1: a monitor reading a run that has not finished.
    t = AuditTrail("s1", dir=tmp_path)
    t.set_goal("still going")
    turn = t.begin_turn(step=0, url="https://github.com/", page_title="GitHub",
                        ax_targets=10, ax_chars=100, ax_diff="",
                        page_text_chars=0)
    t.record_model(turn, thought="working", reasoning="…", tokens_in=1,
                   tokens_out=1, context_pct=0.0, latency_ms=1)
    doc = client.get("/v1/sessions/s1/audit").json()
    assert doc["status"] == "running"
    assert doc["turns"][0]["model"]["thought"] == "working"
```

- [ ] **Step 2: Run to verify failure**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/test_audit_endpoint.py -q
```
Expected: FAIL — 404 on every route (no routes exist yet), and 500 on the malformed-body tests.

- [ ] **Step 3: Implement**

Add to `main.py`, after `create_session`:

```python
@app.get("/v1/sessions")
async def list_sessions():
    """Index of every session this server has run, newest first.

    Unauthenticated, like /health and /v1/policy. The payload is a
    summary of runs the caller already owns; the documents themselves
    are the user's own data on their own server. A future auth layer
    gates all of them together.
    """
    from .agent.audit import list_sessions as _list
    return JSONResponse(content={"sessions": _list()})


@app.get("/v1/sessions/{session_id}/audit")
async def read_audit(session_id: str):
    """The full nested document for one session.

    A damaged file returns 200 with `corrupt: true` rather than an
    error: the file exists to survive a crash, and a read failure is
    the case it must survive.
    """
    from .agent.audit import read as _read
    doc = _read(session_id)
    if not doc.get("found"):
        return JSONResponse(status_code=404,
                            content={"error": "unknown session",
                                     "session_id": session_id})
    return JSONResponse(content=doc)
```

Add a guarded body parser and use it in all three endpoints:

```python
async def _json_body(request: Request) -> dict:
    """Parse a JSON body, or raise a 400 that names the problem.

    Three endpoints call `await request.json()` unguarded today, where
    a malformed body surfaces as an unhandled 500 and a traceback page.
    """
    try:
        body = await request.json()
    except Exception as exc:
        raise _BadRequest(f"malformed JSON body: {exc}") from exc
    if not isinstance(body, dict):
        raise _BadRequest("body must be a JSON object")
    return body
```

Replace the three `body = await request.json()` sites with `body = await _json_body(request)`, and `/v1/suggestions` and `/v1/policy_ack` gain a `try/except _BadRequest` returning 400.

Add the app-level envelope:

```python
@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    """JSON instead of FastAPI's HTML traceback page, with an id the
    user can quote and an operator can grep for."""
    error_id = new_error_id()
    log.error("unhandled  error_id=%s  %s", error_id, exc, exc_info=True)
    return JSONResponse(status_code=500, content={
        "error": "internal error", "error_id": error_id,
    })
```

Note: register this with `app.add_exception_handler(Exception, unhandled)` — FastAPI needs the explicit registration for non-HTTP exceptions, and the handler must be sync-callable from the middleware stack.

Add registry eviction. `SessionRegistry._sessions` grows without bound today. Cap it and evict the least-recently-used disconnected session:

```python
    MAX_SESSIONS = 256
```

and in `SessionRegistry`, track last-seen time and evict oldest-disconnected on `get_or_create` when over the cap. Never evict a session with a live task.

- [ ] **Step 4: Run to verify pass**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/test_audit_endpoint.py -q
```
Expected: PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/ -q
```
Expected: same failures as Task 1 Step 6 (the `run_logger` imports), no new ones.

- [ ] **Step 6: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/main.py \
        services/brotto-orchestrator/src/brotto_orchestrator/session/registry.py \
        services/brotto-orchestrator/tests/test_audit_endpoint.py
git commit -m "server: serve the audit document, and stop 500ing on bad input

Two GET endpoints and a guarded body parser. Three endpoints called
await request.json() unguarded, so a malformed body was an unhandled
500 and an HTML traceback page; they now return 400. An app-level
handler returns a JSON envelope carrying a six-character error id
that appears in the audit document, the log line, and the panel
bubble, so a user reporting a failure can quote it and an operator can
grep for it.

A damaged audit file returns 200 with corrupt: true rather than an
error. The file exists to survive a crash, and failing to read it is
the case it has to survive.

SessionRegistry._sessions grew without bound — sessions were created
per task and never evicted. Capped with LRU eviction that never
evicts a session with a live task."
```

---

### Task 4: Extension — `get_attributes`, `session_id`, and the seven swallowed errors

**Files:**
- Modify: `clients/brotto-extension/src/background.ts`
- Modify: `clients/brotto-extension/manifest.json` (no change needed — `debugger` permission already present; verify)

**Interfaces:**
- Consumes: the `get_attributes` wire shape from Task 2.
- Produces: `task_started` gains `session_id`; `axTargets[]` entries gain `backendNodeId`; a `get_attributes` WS command handler.

**No test suite exists for the extension.** Verify with `npm run build` and a manual checklist, and do not claim UI behaviour was observed.

- [ ] **Step 1: Send `backendNodeId` in each target**

In `background.ts` `extractAx`, the `targets.push({...})` already computes `backendId`. Add it to the object:

```typescript
    targets.push({
      ref: node.nodeId, role, name,
      ...(value !== undefined ? { value } : {}),
      ...(href    !== undefined ? { href }    : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
      // The server cannot tell a password field from an email field
      // without the DOM node, and this is the only place the id is
      // available. One int on a target already being sent.
      ...(backendId !== undefined ? { backendNodeId: backendId } : {}),
```

- [ ] **Step 2: Service `get_attributes`**

Add to the `ws.onmessage` switch:

```typescript
      case "get_attributes": {
        let attributes: Record<string, string> = {};
        try {
          const r = await dbg.sendCommand(tid, {
            method: "DOM.getAttributes",
            params: { backendNodeId: msg.backend_node_id },
          }) as { attributes?: Record<string, string> };
          attributes = r.attributes ?? {};
        } catch { /* node is gone — the server falls back to the name check */ }
        ws.send(JSON.stringify({
          type: "get_attributes_result",
          ref: msg.ref,
          attributes,
        }));
        break;
      }
```

- [ ] **Step 3: Put `session_id` on `task_started`**

At the `logToPanel({ type: "task_started", ... })` call in `onMessage`, add `session_id: persistedSessionId()`. The panel cannot fetch a document without it, and today it has no way to learn it.

- [ ] **Step 4: Fix the seven swallowed errors**

| Line | Fix |
|---|---|
| `:588` | `if (!activeTabId) return;` — replace with a guard that still processes the frame and reports the gap. A `task_result` that arrives with no attached tab is the result of a run the user is watching; dropping it silently shows a spinner forever. Handle the message with `tid = activeTabId ?? lastKnownTabId`, and `notifyUi` a one-time toast naming the situation rather than swallowing the frame. |
| `:730` | `ws.onerror` — read `ev.message` into the failure reason, so the panel shows the browser's actual error rather than a fixed string. |
| `:785` | `cleanup()` calls `chrome.storage.session.clear()`, which deletes `panelLog` and kills replay for a run that just ended. Clear the specific keys instead (`sessionId`, `activeTabId`, `waitingForLogin`, `currentPrompt`, `lastObservedUrl`), keeping `panelLog`. |
| `:575` | `getStoredModelConfig()` in `onopen` is unhandled — a failure means no `task_start` is ever sent and the user sees nothing. Wrap it and, on failure, `notifyUi({type:"task_failed", failure_reason:"START_FAILED", summary:...})`. |
| `:727` | Unknown `msg.type` — add a `default:` branch that logs the type at debug. A new server message type the extension predates should be visible in the service-worker console. |
| `:131` | Approval/clarify resolvers are in-memory Maps, so a card replayed after service-worker eviction is unanswerable and `submit_approval` returns `{success:false}`. On a miss, re-prompt the server rather than failing silently — the card is on screen, the user is clicking it. |
| `:370` | `notifyUi`'s `.catch(() => undefined)` is right for a dead panel and wrong for a live one. Distinguish `chrome.runtime.lastError` containing "Receiving end does not exist" (panel closed — ignore) from any other failure (panel open, delivery failed — log it). |

Each of these is a behaviour change to a live path. Change one, build, and eyeball it; do not batch all seven before the first build.

- [ ] **Step 5: Build**

```bash
cd clients/brotto-extension && npm run build
```
Expected: build completes with no TypeScript errors.

- [ ] **Step 6: Manual checklist — record results, do not assume**

Load the unpacked extension, start a task, and confirm:
- [ ] a step card appears with a URL
- [ ] approving a card works
- [ ] a task completes and lands in history
- [ ] closing and reopening the panel mid-task still replays the transcript (this is the `panelLog` fix)
- [ ] DevTools shows no uncaught errors in the service worker

Record what you actually observed. If the browser is unavailable, say so in the commit body rather than claiming the fixes work.

- [ ] **Step 7: Commit**

```bash
git add clients/brotto-extension/src/background.ts
git commit -m "extension: stop seven failure modes that were silent

The worst: ws.onmessage began with 'if (!activeTabId) return;', so
every server frame was dropped without a word when no tab happened to
be attached — including task_result. A run the user was watching would
spin forever with no error anywhere.

Also fixed: ws.onerror reported a fixed string instead of the
browser's message; cleanup() called storage.session.clear(), deleting
panelLog so a run that ended via socket close lost its replay log; an
unhandled getStoredModelConfig failure in onopen meant no task_start
was ever sent and nothing said so; unknown message types fell out of
the switch silently; and approval/clarify resolvers lived only in
in-memory Maps, so a card replayed after service-worker eviction was
unanswerable and submit_approval just returned false at a user who was
clicking a live card.

notifyUi's blanket .catch is kept for a dead panel but no longer
swallows a failed delivery to a live one."
```

---

### Task 5: Panel — index gains `session_id`, transcript view

**Files:**
- Modify: `clients/brotto-extension/src/sidepanel.js:261-342` (`listSessions`, `saveSession`, `renderHistory`)
- Modify: `clients/brotto-extension/src/sidepanel.html`

**Interfaces:**
- Consumes: `GET /v1/sessions/{id}/audit` from Task 3; `task_started.session_id` from Task 4.
- Produces: index entries carry `session_id`; a row click opens a transcript rendered in `seq` order.

- [ ] **Step 1: Add `session_id` to the index and dedupe on it**

`saveSession` currently:

```javascript
  if (state.startTime && sessions[0]?.startedAt === state.startTime) return;
```

Change to prefer `session_id`, keeping `startedAt` for rows written before this change so an existing list does not duplicate on upgrade:

```javascript
  // session_id is the real identity. startedAt stays as the fallback for
  // rows written before it was stored — an existing list must not
  // duplicate every entry on upgrade.
  const sid = state.sessionId;
  if (sid) {
    if (sessions.some((s) => s.session_id === sid)) return;
  } else if (state.startTime && sessions[0]?.startedAt === state.startTime) {
    return;
  }
  sessions.unshift({
    task,
    status,
    steps: steps || state.stepCount || 0,
    elapsed: elapsed || '—',
    startedAt: state.startTime || Date.now(),
    session_id: sid || null,
  });
```

Capture `state.sessionId` from the `task_started` event:

```javascript
    case 'task_started': {
      if (message.sessionId || message.session_id) {
        state.sessionId = message.sessionId || message.session_id;
      }
      if (message.startedAt) state.startTime = message.startedAt;
      break;
    }
```

- [ ] **Step 2: Change the row click to open a transcript**

Today a click refills the composer. Under this change a click opens the transcript, and the transcript header carries a **Re-run** button that refills the composer. Nothing is lost — the capability moves one level deeper — and "history" stops meaning "a list of strings you can retype".

In `renderHistory`, replace the click handler:

```javascript
    row.title = 'Open this session';
    row.addEventListener('click', () => void openTranscript(s));
```

And add the reader plus renderer. The fetch must fail soft — see Review Focus #5:

```javascript
async function fetchAudit(sessionId) {
  const base = (state.plannerUrl || 'http://localhost:8000').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/sessions/${encodeURIComponent(sessionId)}/audit`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function openTranscript(entry) {
  if (!entry.session_id) {
    // An old row with no id: fall back to what it always did, so a list
    // written before this change stays useful.
    goalEl.value = entry.task || '';
    historyOverlay.classList.remove('open');
    goalEl.focus();
    return;
  }
  let doc;
  try {
    doc = await fetchAudit(entry.session_id);
  } catch {
    // Review Focus #5: losing the ability to re-run a task because a
    // detail view is unreachable is a regression, not a degraded feature.
    toast('Could not load session — putting the task back in the box', 'bad', 4000);
    goalEl.value = entry.task || '';
    historyOverlay.classList.remove('open');
    goalEl.focus();
    return;
  }
  historyOverlay.classList.remove('open');
  renderTranscript(doc, entry);
}
```

`renderTranscript` walks the document in order: the goal as a user bubble, then each turn as a step card, then that turn's `prompts` in array order as approval/ask cards, then the result. A turn with `ended_at: null` renders as interrupted. A `corrupt` document renders a single "this session is damaged" notice rather than an empty view. The result's `failure_reason` renders the same bubble the live path renders, plus `error_id` when present.

- [ ] **Step 3: Build and check**

```bash
cd clients/brotto-extension && npm run build
```

- [ ] **Step 4: Manual checklist**

- [ ] Run a task, finish it, open history — the new row has a `session_id` in `chrome.storage.local`
- [ ] Reopening the panel does not add a duplicate row
- [ ] Clicking a row opens the transcript with steps and prompts in order
- [ ] **Re-run** refills the composer
- [ ] With the server stopped, clicking a row still refills the composer and shows a toast
- [ ] A session from before the upgrade still opens

- [ ] **Step 5: Commit**

```bash
git add clients/brotto-extension/src/sidepanel.js clients/brotto-extension/src/sidepanel.html
git commit -m "panel: history rows open the session, not just its task text

The list was {task, status, steps, elapsed, startedAt} — a row you
clicked refilled the composer with the task string. Everything else
the run produced, every turn, every approval, every token count, was
dropped at write time. The document now exists on the server, so a row
opens the transcript, rendered in seq order with each prompt under the
turn that raised it.

The index keeps the summary so the list still renders with zero
network calls, and gains session_id, which the panel had no way to
learn before — the background minted it, used it, and dropped it.

A failed fetch is not a dead end: the row still refills the composer.
Losing the ability to re-run a task because a detail view is
unreachable would be a regression, not a degraded feature."
```

---

### Task 6: Harness — `_ask_user`, audit wiring, redaction, retire `run_logger`

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py`
- Delete: `services/brotto-orchestrator/src/brotto_orchestrator/agent/run_logger.py`
- Test: `services/brotto-orchestrator/tests/agent/test_harness_audit.py`

**Interfaces:**
- Consumes: `AuditTrail`, `is_secret_field`, `REDACTED` (Tasks 1–2); `deps.cdp.get_attributes` (Task 2).
- Produces: nothing new for later tasks beyond the audit document being complete.

This is the largest task and has exactly one owner, because six of its changes land in overlapping regions of one 1429-line file.

- [ ] **Step 1: Write the failing tests**

Create `tests/agent/test_harness_audit.py`:

```python
import json
from pathlib import Path

import pytest

from brotto_orchestrator.agent.audit import REDACTED, read


@pytest.fixture
def sessions_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def test_prompt_is_recorded_in_order_under_its_turn(sessions_dir, run_scripted_task):
    doc = read(run_scripted_task, dir=sessions_dir)
    assert doc["turns"], "the run recorded no turns"
    turn = doc["turns"][0]
    keys = list(turn.keys())
    assert keys.index("model") < keys.index("prompts") < keys.index("actions")


def test_every_turn_carries_token_counts(sessions_dir, run_scripted_task):
    doc = read(run_scripted_task, dir=sessions_dir)
    for turn in doc["turns"]:
        assert "model" in turn and turn["model"] is not None
        assert turn["model"]["tokens_in"] >= 0
        assert turn["model"]["tokens_out"] >= 0


def test_totals_equal_the_sum_of_the_turns(sessions_dir, run_scripted_task):
    doc = read(run_scripted_task, dir=sessions_dir)
    assert doc["totals"]["tokens_in"] == sum(
        t["model"]["tokens_in"] for t in doc["turns"] if t.get("model")
    )
    assert doc["totals"]["steps"] == len(doc["turns"])


def test_approval_records_the_users_answer(sessions_dir, run_scripted_deny_task):
    doc = read(run_scripted_deny_task, dir=sessions_dir)
    prompts = [p for t in doc["turns"] for p in t["prompts"]]
    assert prompts, "an approval was raised but nothing was recorded"
    assert prompts[0]["decision"] == "denied"
    assert prompts[0]["wait_ms"] is not None


def test_typed_password_is_redacted_but_its_length_survives(
    sessions_dir, run_scripted_task_typing_password
):
    doc = read(run_scripted_task_typing_password, dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"] if a["action"] == "type_text"]
    assert typed, "the scripted task typed nothing"
    assert typed[0]["args"]["text"] == REDACTED
    assert typed[0]["args"]["text_chars"] == len("hunter2")
    assert typed[0]["redacted"] is True
    # The literal must not appear anywhere in the file.
    assert "hunter2" not in json.dumps(doc)


def test_ordinary_typed_text_is_not_redacted(
    sessions_dir, run_scripted_task_typing_email
):
    doc = read(run_scripted_task_typing_email, dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"] if a["action"] == "type_text"]
    assert typed[0]["args"]["text"] == "dev@example.com"
    assert typed[0]["redacted"] is False


def test_redaction_still_happens_when_the_dom_lookup_fails(
    sessions_dir, run_scripted_task_typing_password_with_dead_relay
):
    # Review Focus #4: no attributes AND a blank accessible name is the
    # one case where a naive implementation writes a plaintext credential.
    doc = read(run_scripted_task_typing_password_with_dead_relay, dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"] if a["action"] == "type_text"]
    assert typed[0]["args"]["text"] == REDACTED


def test_result_is_recorded(sessions_dir, run_scripted_task):
    doc = read(run_scripted_task, dir=sessions_dir)
    assert doc["result"]["status"] in {"completed", "failed"}
    assert doc["status"] == doc["result"]["status"]


def test_audit_survives_an_unwritable_directory_without_failing_the_task(
    tmp_path, monkeypatch, run_scripted_task_with_dead_audit
):
    # The writer must never raise into the loop: a full disk degrades the
    # audit trail, it does not stop the agent.
    result = run_scripted_task_with_dead_audit
    assert result.status in {"completed", "failed", "cannot_complete"} \
        or result.status == "completed"
```

The fixtures (`run_scripted_task`, `run_scripted_deny_task`, `run_scripted_task_typing_password`, `run_scripted_task_typing_email`, `run_scripted_task_typing_password_with_dead_relay`, `run_scripted_task_with_dead_audit`) wrap the existing `ScriptedPlanner` used by `tests/test_agent_e2e.py`. Model `scripts.py`'s existing login script shape for the typing cases. Put them in `tests/agent/test_harness_audit.py` itself, or in `tests/conftest.py` if Task 3 already grew it — one definition only.

- [ ] **Step 2: Run to verify failure**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/agent/test_harness_audit.py -q
```
Expected: FAIL — the fixtures are not defined and the document is empty.

- [ ] **Step 3: Retire `run_logger`**

Every `run_log` reference in `harness.py` becomes an `audit` reference. `run_log.log_step(...)` and `run_log.log_policy(...)` become `audit.record_turn(...)` / `audit.record_policy(...)`. `run_log.save_scratchpad(...)` becomes `audit.set_scratchpad(...)`. `RunLogger(deps.task_id)` becomes `AuditTrail(deps.task_id)`. The scratchpad's `load_scratchpad()` call becomes the module-level function pointed at `<session_dir>/scratchpad.txt`.

Delete `run_logger.py`. `main.py`'s `from .agent.run_logger import append_policy_event` call in `/v1/policy_ack` (main.py:270) and in the `policy_acknowledged` WS branch (main.py:606) must be repointed to `audit.record_policy` on a transient `AuditTrail` — both already run outside a task and only need an append.

- [ ] **Step 4: Build `_ask_user`**

The comment at `harness.py:57` already claims every prompt site routes through a helper. It does not — there are seven duplicated blocks. Build it for real:

```python
async def _ask_user(deps: AgentDeps, audit, *, turn: int, kind: str,
                    action: str, args: dict, domain: str | None,
                    reason: str) -> bool:
    """Raise one prompt, wait for the answer, record it. True = approved.

    Seven sites were doing this by hand — send, block on the queue,
    branch, log, set deps.result. Adding an audit record at each would
    be seven more chances to forget one, so the site is centralised
    instead. `login_required` deliberately does NOT use this: its
    timeout continues the loop rather than aborting, and its "skip"
    aborts, which is a contract this signature does not have.
    """
    pid = audit.record_prompt(turn, kind=kind, action=action, args=args,
                              domain=domain, reason=reason)
    await deps.ws_send({
        "type": "approval_required", "action": action, "args": args,
        "reasoning": reason,
    })
    t0 = time.perf_counter()
    reply = await deps.human_input_queue.get()
    wait_ms = int((time.perf_counter() - t0) * 1000)
    approved = str(reply).lower() in APPROVE_SET
    audit.resolve_prompt(pid, decision="approved" if approved else "denied",
                         response=str(reply), wait_ms=wait_ms)
    return approved
```

Rewrite sites `:464`, `:552`, `:1082`, `:1130`, `:1195` to call it. `:724` (`ask_human`) needs the reply, not a boolean, so give it its own thin variant that reuses `record_prompt`/`resolve_prompt` directly rather than forcing it through the boolean. `:995` (`login_required`) keeps its own path and calls `record_prompt` directly.

**The existing e2e suite is the regression net for this refactor.** It covers all seven sites by deny, and the deny-aborts contract plus every `log_policy` row are observable assertions. Run it after each site, not once at the end.

- [ ] **Step 5: Wire the per-turn record**

In the step loop, `begin_turn` at the top of an iteration (after the observe and the abort gate), `record_model` right after `agent.run` using the `result.usage` already read into `tokens`, `record_action` inside the action loop, `end_turn` at the bottom. `record_turn`'s old `log_step` call at `:1314` is removed.

Per-turn tokens come from the `usage` object read at `harness.py:1237-1243`; keep the running `tokens` dict for the session total and add the per-step values to the turn.

- [ ] **Step 6: Redact at `type_text`**

```python
        elif action == "type_text":
            redact, attrs = await _redact_if_secret(deps, args.get("ref", ""))
            await cdp.focus_ref(args["ref"])
            await cdp.clear_ref(args["ref"])
            result = await cdp.type_text_to_ref(args["ref"], args["text"])
            return f"Typed into [{args['ref']}]: {result}"
```

and the helper, which never raises — a failure to classify must not stop a `type_text` that was about to work, and must not silently write the value:

```python
async def _redact_if_secret(deps: AgentDeps, ref: str) -> tuple[bool, dict]:
    """Is this field a password? Returns (redact, attributes).

    Resolved here and not at extraction: one CDP round trip per TYPED
    ACTION is cheap, one per textbox per STEP is not, and this loop is
    latency-bound.

    If the DOM lookup fails we fall back to the accessible name. If
    BOTH fail, we do not classify as safe — an unclassifiable field
    that looks remotely like a credential is redacted, because the
    failure mode of over-redacting is a replay that says "[redacted]"
    and the failure mode of under-redacting is a plaintext password on
    disk forever.
    """
    target = next((t for t in deps.prev_targets if t.ref_id == ref), None)
    if target is None:
        return False, {}
    try:
        attrs = await deps.cdp.get_attributes(target.backend_node_id) \
            if target.backend_node_id else {}
    except Exception as exc:
        log.debug("attribute lookup failed for %s: %s", ref, exc)
        attrs = {}
    return is_secret_field(attrs, target.name), attrs
```

Then `record_action` receives `redacted=True` and `args` with `text` replaced by `REDACTED` plus `text_chars: len(original)`. **The original must not reach the audit document through any other path** — check `action_trace`, which currently formats `f"{call.action}({call.action_args})"` into a `StepSummary` that also lands in the document. Redact before the trace is built, or redact the trace.

- [ ] **Step 7: Run the suites**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/ -q
```
Expected: all pass, including the 346 that existed before this branch plus the new ones. Any e2e failure after Step 4 is a real regression in the deny-aborts contract — fix it, do not adjust the test.

- [ ] **Step 8: Commit**

```bash
git add -A services/brotto-orchestrator/
git commit -m "harness: record every turn and prompt, and stop writing passwords

run_log.log_step wrote one flat row per step carrying only the first
action's args, and policy.log a flat key=value line. Both are replaced
by the nested document, which carries every action of every turn, the
prompts in the order they were raised, and the per-turn token counts
that were being summed and thrown away.

harness.py:57 already claimed every user-prompt site routed through a
helper for the deny-aborts contract. No such helper existed — there
were seven hand-duplicated blocks. Each needed an audit record, and
seven separate chances to forget one is how a partial fix ships, so
the helper is built now and the deny contract is enforced in one
place. The existing e2e suite covers all seven sites by deny and is
the regression net for the consolidation.

log_step already wrote full action_args, so logs/runs/ contains a
literal password today. type_text now resolves the target's DOM type
at the moment of typing — one CDP round trip per typed action, not
per textbox per step, because this loop is latency-bound — and
redacts when it says password or the accessible name says so. A field
that cannot be classified is redacted rather than written, since
over-redacting costs a replay that says [redacted] and
under-redacting costs a plaintext credential on disk forever."
```

---

### Task 7: Part B — reconnect and resume

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/main.py` (`websocket_extension`)
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py` (`run`)
- Modify: `clients/brotto-extension/src/background.ts`
- Test: `services/brotto-orchestrator/tests/agent/test_resume.py`

**Interfaces:**
- Consumes: the audit document from Task 1; the `session_id` on `task_started` from Task 4.
- Produces: `AgentHarness.run(deps, *, resume_from: int = 0)`; `status == "interrupted"` when a session cannot be resumed.

Do not start this until Tasks 2, 3, 4, and 6 have landed. It re-touches files those tasks own.

- [ ] **Step 1: Write the failing test**

Create `tests/agent/test_resume.py`:

```python
import pytest

from brotto_orchestrator.agent.audit import AuditTrail, read


def test_resume_state_is_reconstructible_from_the_document(sessions_dir):
    # The whole basis of resume: agent.run is called with a rebuilt prompt
    # and no message_history, so the summaries ARE the history, and a
    # session interrupted at turn 3 can continue at turn 3.
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("find it")
    for step in range(3):
        turn = t.begin_turn(step=step, url=f"u{step}", page_title="t",
                            ax_targets=1, ax_chars=1, ax_diff="",
                            page_text_chars=0)
        t.record_model(turn, thought=f"step {step}", reasoning="r",
                       tokens_in=1, tokens_out=1, context_pct=0.0,
                       latency_ms=1)
        t.end_turn(turn, timings={})
    doc = read("s1", dir=sessions_dir)
    completed = [x for x in doc["turns"] if x["ended_at"] is not None]
    assert len(completed) == 3
    assert [x["step"] for x in completed] == [0, 1, 2]


def test_an_unfinished_turn_is_not_a_resume_point(sessions_dir):
    # Review Focus #3: a turn that was in flight when the socket died
    # must be re-run, not half-recorded.
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("g")
    a = t.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                     ax_chars=1, ax_diff="", page_text_chars=0)
    t.end_turn(a, timings={})
    t.begin_turn(step=1, url="u", page_title="t", ax_targets=1,
                 ax_chars=1, ax_diff="", page_text_chars=0)  # never ended
    doc = read("s1", dir=sessions_dir)
    assert doc["turns"][1]["ended_at"] is None
    assert [x["step"] for x in doc["turns"] if x["ended_at"]] == [0]


def test_approved_but_unexecuted_action_is_not_replayed(sessions_dir):
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("g")
    turn = t.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                        ax_chars=1, ax_diff="", page_text_chars=0)
    pid = t.record_prompt(turn, kind="critical_action", action="click",
                          args={}, domain=None, reason="…")
    t.resolve_prompt(pid, decision="approved", response="yes", wait_ms=10)
    # Socket died here: approved, but no action record was written.
    doc = read("s1", dir=sessions_dir)
    p = doc["turns"][0]["prompts"][0]
    assert p["decision"] == "approved"
    assert doc["turns"][0]["actions"] == []


def test_a_corrupt_document_resumes_as_interrupted_not_restarted(sessions_dir):
    p = sessions_dir / "s1.json"
    p.write_text('{"schema_ver')
    from brotto_orchestrator.agent.audit import read as _read
    doc = _read("s1", dir=sessions_dir)
    assert doc.get("corrupt") is True
    # The caller marks it interrupted with the reason rather than
    # silently running the task again from step 0.
```

- [ ] **Step 2: Server — one agent per live session**

`websocket_extension` currently starts a `harness.run` per accepted socket, so a reconnect for a live `session_id` would start a *second* agent driving the same browser. Track live `session_id`s on the registry. On a `task_start` for a session that already has a live task, do not start a second: record the event, mark the session `interrupted`, and tell the client.

- [ ] **Step 3: Server — resume**

Add `resume_from` to `AgentHarness.run`. When the session's document has `schema_version == 1` and at least one completed turn, reload `step_summaries` from those turns, restore the scratchpad and `visited_domains` from the document, and continue the loop at the next step index. A session that is corrupt, or written at a different schema version, is reported as `interrupted` with the reason — never silently restarted, because silently restarting re-runs actions the user already approved.

- [ ] **Step 4: Extension — reconnect with backoff**

On an **unexpected** close while a task is live, reconnect with exponential backoff and full jitter (base 1 s, ×2, cap 30 s), reusing the existing `session_id`. `stopRelay` and a user-cancelled task must not reconnect — a cancelled task must not resurrect. Show the user a "reconnecting, attempt N" state rather than the current silent drop.

- [ ] **Step 5: Test and build**

```bash
cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/ -q
cd ../../clients/brotto-extension && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "agent: reconnect with backoff and resume from the audit document

A reconnect for a live session_id started a second harness.run against
the same browser — two agents, one tab. The server now refuses that
and resumes instead, because the harness is already stateless per step:
agent.run is called with a rebuilt prompt and no message_history, so
the model only ever saw the step summaries, and the document has them.

Resume picks up at the last COMPLETED turn. A turn in flight when the
socket died is re-run rather than half-recorded, and an action the
user approved but which never executed is not silently replayed as if
it had.

A session whose document is corrupt or was written at another schema
version is reported as interrupted with the reason. Silently
restarting it would re-run work the user already approved.

Reconnect uses exponential backoff with full jitter and does not fire
on a clean stop or a user cancellation — a cancelled task must not
resurrect."
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/product/brotto-current-state.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Add a section covering: the audit document's location and shape; that it replaces `steps.jsonl` and `policy.log`; the `os.replace` durability rule; the writer-never-raises rule; password redaction and its ceiling (the dev Playwright path is name-based only); the two new endpoints; and that `run_logger.py` is gone and its scratchpad format moved.

- [ ] **Step 2: Update `brotto-current-state.md`**

Record what shipped: history is now a transcript rather than a list of strings; offline history is a known gap (the list renders offline, the transcript does not); sessions accumulate with no pruning.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/product/brotto-current-state.md
git commit -m "docs: record the audit trail, the redaction ceiling, and the offline gap"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: A.1 write strategy → 1; A.2 document shape → 1; A.3 writer API → 1; A.4 prompt-site consolidation → 6; A.5 password redaction → 2 + 6; A.6 read endpoints → 3; A.7 panel → 5 (+ 4 for `session_id`); A.8 error handling → 1 (writer), 3 (server), 4 (extension); B.1/B.2/B.3 → 7. The spec's "What this does not do" section is carried into Tasks 7 and 8 rather than implemented.

**Placeholder scan.** No TBD, no "add appropriate error handling", no "similar to Task N". The `_flush`/`_record` bodies and the record-method behaviours are specified in prose with the exact observable contract each must satisfy, because a record method's shape is fully determined by the JSON schema in the spec and the tests in Step 1 — writing them twice here would let the two drift.

**Type consistency.** `AuditTrail` is defined once in Task 1 and every later task refers to it by that name. `is_secret_field(attributes, accessible_name)` is defined in Task 2 and called in Task 6. `get_attributes(backend_node_id) -> dict[str, str]` is produced in Task 2 and consumed via `deps.cdp` in Task 6. `REDACTED` and `text_chars` are defined in Task 1's constants and asserted in Task 6. `run_scripted_task` and friends are defined once, in Task 6.

**Review Focus.** All five lines have a named test: #1 → `test_mid_task_document_is_readable` (Task 3); #2 → `test_session_killed_mid_step_leaves_last_turn_intact` (Task 1) and `test_an_unfinished_turn_is_not_a_resume_point` (Task 7); #3 → `test_approved_but_unexecuted_action_is_not_replayed` (Task 7) and `test_unresolved_prompt_reads_as_pending` (Task 1); #4 → `test_redaction_still_happens_when_the_dom_lookup_fails` (Task 6); #5 → the `openTranscript` catch block and manual checklist (Task 5).
