# Conversation Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `session_id` per conversation. A follow-up message ("now write a LinkedIn post about the top one and post it") runs as a new task inside the same session, same audit document, same transcript, with the earlier tasks still in the model's context.

**Architecture:** The audit document goes to `schema_version: 2` with three deliberately separate collections — `tasks[]` (segmentation), `messages[]` (the transcript a human reads), `turns[]` (the audit, now carrying a `task` index). A single explicit `resume: bool` on the `task_start` frame splits the two paths that today share one code path and do opposite things: resuming a crashed run, and appending a new task to a finished one.

**Tech Stack:** Python 3.11 / FastAPI / pydantic-ai 2.31 (server), TypeScript + MV3 (extension), pytest (repo-root `.venv`), `tsc --noEmit` + `npm run build`.

**Spec:** `docs/superpowers/specs/2026-09-30-conversation-sessions-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- `_TERMINAL_DOC_STATUSES` must gain `"interrupted"`. It is written *only* on a resume refusal (`harness.py:1185`), overwriting the terminal status it was refusing to resume from, so a second resume attempt currently reads a finished run as resumable. Conversation continuation deliberately routes far more traffic down the resume path, which is why this ships with it.
- Atomic write is the whole durability mechanism: `json.dump` to `<id>.json.tmp` then `os.replace`. Nothing in this change may introduce a non-atomic write, and no audit method may raise — the agent loop is the caller.
- A turn with `ended_at: null` is unfinished, never a resume point and never the source of an assistant message.
- Key order inside a turn is causal and pinned by tests: `model → prompts → actions`. Adding a `task` key to a turn must not disturb it.
- Redaction asymmetry: over-redacting costs a replay that says `[redacted]`; under-redacting costs a plaintext credential on disk forever. Every ambiguous branch resolves toward redact. `is_secret_field` stays in exactly one place.
- No `Co-Authored-By` or other Claude attribution in any commit message.
- `docs/` is gitignored — force-add spec/plan changes with `git add -f`.
- Run pytest from `services/brotto-orchestrator/` with the repo-root interpreter: `../../.venv/bin/python -m pytest tests/ -q`.
- Audit write failures must be counted in `dropped_writes`, counted into `totals["errors"]`, and logged with the exception *type* and not its message.

**Deliberate deviation from the spec.** The spec introduced a `ChatMessage` pydantic model in `agent/context.py`. The plan does not: nothing validates it, the document holds plain dicts, and `add_message` only needs a field cap that `_cap` already provides. A model no code constructs is scaffolding. `tasks[]` and `messages[]` entries are dict literals built in `audit.py`. Everything else in the spec stands.

## Review Focus

The failure modes a person using this would hit, most likely first. Each gets a test pinned to the task that owns the code.

1. **Follow-up task after a completed run** — the second goal must be answered using the first task's findings, and the document must contain both tasks in order.
2. **Follow-up after a *failed* run** — the transcript up to the failure is still valid context; the new task continues from it rather than being refused as terminal.
3. **Follow-up sent while a run is still live** — refused as a second agent on one browser, never started.
4. **A v1 document on disk** — a follow-up into it is refused with a readable reason, not a crash and not a silent truncation.
5. **A crashed run's approval, then a follow-up** — the follow-up is refused and the approved-but-unexecuted action is not replayed.
6. **A run cancelled at step 0** — the user's prompt is still in the transcript, because it is written at `task_start` and not per turn.
7. **A second resume attempt after a refused one** — the document is still terminal and the second attempt is refused the same way (the `interrupted` hazard).
8. **A long conversation** — the prompt's `<conversation>` block names how many messages it dropped, and the full text is still on disk.
9. **Task 0's prompt** — byte-identical to before this change. The conversation block is empty for a first task.

---

### Task 1: Audit document, schema v2

The document and its two new collections. Nothing else in this plan can land before it.

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/audit.py` (`SCHEMA_VERSION` at :37, `__init__` doc at :259-278, `_adopt_document` key list in `harness.py:1039`, `list_sessions` at :670)
- Test: `services/brotto-orchestrator/tests/agent/test_audit_conversation.py` (create)

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces, for Tasks 2-5:
  - `SCHEMA_VERSION == 2`
  - `AuditTrail.begin_task(goal: str) -> int` — appends a `tasks[]` entry, sets `title` when the document had none, returns the new task's index. Never raises.
  - `AuditTrail.add_message(*, role: str, content: str, task: int, turn: int | None) -> str` — appends a `messages[]` entry, returns its `id`. `content` is capped by `_cap`. Never raises.
  - `AuditTrail.conversation() -> list[dict]` — the `messages[]` list, deep-copied, in order.
  - Document keys `tasks`, `messages`, `title` exist on every v2 document; `_adopt_document` `setdefault`s all three so a hand-written or v1 document never raises.

- [ ] **Step 1: Write the failing test**

`tests/agent/test_audit_conversation.py`:

```python
"""A session holds every task the user sends into it, not one run.

The document is the record, so these tests read the file back rather than
inspecting the in-memory trail: what survives a crash is the contract.
"""

import json

import pytest

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail, list_sessions, read


@pytest.fixture
def trail(tmp_path):
    t = AuditTrail("conv-1", dir=tmp_path / "sessions")
    yield t
    t.close()


def _doc(trail):
    return json.loads(trail.path.read_text())


def test_a_new_document_is_v2_with_the_three_collections(trail):
    doc = _doc(trail)
    assert doc["schema_version"] == 2
    assert doc["tasks"] == []
    assert doc["messages"] == []


def test_begin_task_segments_and_titles_the_conversation(trail):
    first = trail.begin_task("research the top 5 repos")
    second = trail.begin_task("write a linkedin post about the top one")
    doc = _doc(trail)
    assert [t["goal"] for t in doc["tasks"]] == [
        "research the top 5 repos",
        "write a linkedin post about the top one",
    ]
    assert [t["index"] for t in doc["tasks"]] == [0, 1]
    # The label is the FIRST task, not the latest — a conversation is named
    # after how it started, which is what the history list shows.
    assert doc["title"] == "research the top 5 repos"
    assert (first, second) == (0, 1)


def test_a_user_message_survives_a_run_cancelled_before_any_turn(trail):
    idx = trail.begin_task("go")
    trail.add_message(role="user", content="go", task=idx, turn=None)
    doc = _doc(trail)
    assert len(doc["messages"]) == 1
    m = doc["messages"][0]
    assert m["role"] == "user" and m["turn"] is None
    assert m["task"] == 0 and m["id"] and m["at"]


def test_an_assistant_message_points_at_the_turn_it_came_from(trail):
    idx = trail.begin_task("go")
    turn = trail.begin_turn(step=0, url="https://x.test", page_title="X",
                            ax_targets=1, ax_chars=10, ax_diff="",
                            page_text_chars=0)
    mid = trail.add_message(role="assistant", content="found 5 repos",
                            task=idx, turn=turn)
    assert mid
    assert _doc(trail)["messages"][0]["turn"] == 0


def test_message_content_is_capped_like_every_other_field(trail):
    trail.add_message(role="user", content="x" * (audit_mod.MAX_FIELD_CHARS + 500),
                      task=0, turn=None)
    assert len(_doc(trail)["messages"][0]["content"]) <= audit_mod.MAX_FIELD_CHARS


def test_conversation_returns_a_copy_not_the_live_list(trail):
    trail.add_message(role="user", content="hi", task=0, turn=None)
    first = trail.conversation()
    first.append({"role": "user", "content": "tampered"})
    assert len(trail.conversation()) == 1


def test_a_v1_document_is_readable_and_reports_its_version(tmp_path):
    d = tmp_path / "sessions"
    d.mkdir()
    (d / "old.json").write_text(json.dumps(
        {"schema_version": 1, "session_id": "old", "status": "completed",
         "goal": "the old way", "turns": [], "totals": {"steps": 3}}))
    doc = read("old", dir=d)
    assert doc["schema_version"] == 1
    assert doc["goal"] == "the old way"


def test_list_sessions_reports_the_conversation_title_and_task_count(tmp_path):
    d = tmp_path / "sessions"
    t = AuditTrail("conv-2", dir=d)
    t.begin_task("first goal")
    t.begin_task("second goal")
    t.close()
    row = [r for r in list_sessions(dir=d) if r["session_id"] == "conv-2"][0]
    assert row["title"] == "first goal"
    assert row["task_count"] == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_audit_conversation.py -q`

Expected: FAIL — `AttributeError: 'AuditTrail' object has no attribute 'begin_task'`

- [ ] **Step 3: Bump the version and add the collections**

In `agent/audit.py`, change line 37:

```python
SCHEMA_VERSION = 2
```

In `AuditTrail.__init__`, add three keys to `self._doc`. Put them next to `"goal"` so the header stays grouped:

```python
            "status": "running",
            "goal": "",
            # A session is a conversation. `title` labels it in the history
            # list and is fixed by the first task; `tasks` segments it; and
            # `messages` is the transcript a human reads. `turns` below stays
            # the audit, joined to the rest by turns[].task.
            "title": "",
            "tasks": [],
            "messages": [],
            "client": {},
```

- [ ] **Step 4: Add `begin_task`, `add_message`, `conversation`**

Add after `set_status` (line 422), before the `# ── turns ──` divider:

```python
    # ── conversation ───────────────────────────────────────────
    def begin_task(self, goal: str) -> int:
        idx = self._record(self._begin_task, goal)
        return -1 if idx is None else idx

    def _begin_task(self, goal: str) -> int:
        tasks = self._doc.setdefault("tasks", [])
        entry: dict = {"index": len(tasks)}
        _text(entry, "goal", goal)
        entry["started_at"] = _now()
        entry["ended_at"] = None
        entry["status"] = "running"
        entry["steps"] = 0
        tasks.append(entry)
        # Named after how the conversation started, not how it ended: the
        # history list needs one stable label for the whole session.
        if not self._doc.get("title"):
            _text(self._doc, "title", goal)
        return entry["index"]

    def add_message(self, *, role: str, content: str, task: int,
                    turn: int | None) -> str:
        mid = self._record(self._add_message, role=role, content=content,
                           task=task, turn=turn)
        return mid or ""

    def _add_message(self, *, role: str, content: str, task: int,
                     turn: int | None) -> str:
        messages = self._doc.setdefault("messages", [])
        mid = f"m{len(messages) + 1}"
        entry: dict = {"id": mid, "role": role, "at": _now()}
        _text(entry, "content", content)
        entry["task"] = task
        entry["turn"] = turn
        messages.append(entry)
        return mid

    def conversation(self) -> list[dict]:
        with self._lock:
            return copy.deepcopy(self._doc.get("messages") or [])
```

`_text` already exists (line 106) and is the project's cap-and-drop-empty helper; reusing it is why `add_message` needs no validation of its own.

- [ ] **Step 5: Make `_adopt_document` tolerant of documents without the new keys**

A v1 or hand-written document is carried over wholesale, and the record methods append to `tasks` / `messages` / `errors`. In `harness.py:1039` `_adopt_document`, extend the existing loop:

```python
    for key in ("turns", "prompts", "actions", "policy_events", "errors",
                "tasks", "messages"):
        audit._doc.setdefault(key, [])
    audit._doc.setdefault("totals", {})
    audit._doc.setdefault("title", "")
```

- [ ] **Step 6: Add title and task count to the session index**

In `list_sessions` (line 670), add two keys to the appended dict. A v1 document has no `title`, so fall back to the `goal` it does have — that is what the panel labels old rows with today:

```python
            "session_id": doc.get("session_id", p.stem),
            "title": doc.get("title") or doc.get("goal", ""),
            "task_count": len(doc.get("tasks") or []) or 1,
            "task": doc.get("title") or doc.get("goal", ""),
```

`task` is kept alongside `title` because the panel's history rows read `task`; changing both in this task would break the panel before Task 5 lands.

- [ ] **Step 7: Run the new tests and the full suite**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_audit_conversation.py -q`

Expected: 8 passed

Then: `../../.venv/bin/python -m pytest tests/ -q`

Expected: all pass. `list_sessions` gaining keys and `SCHEMA_VERSION` becoming 2 are the two things that can break other suites — if a test asserts on the exact session-index shape, it is asserting on the contract this task deliberately extended.

- [ ] **Step 8: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/agent/audit.py \
        services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py \
        services/brotto-orchestrator/tests/agent/test_audit_conversation.py
git commit -m "audit: a session is a conversation — schema v2

tasks[] segments a session, messages[] is the transcript a human
reads, and turns[] joins to both by a task index. The title is fixed
by the first task, so a twenty-task conversation still has one stable
label in the history list."
```

---

### Task 2: The task lifecycle fork, and the conversation in the prompt

Where a follow-up is told apart from a crash resume, and where the model learns what happened earlier.

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py` (`_TERMINAL_DOC_STATUSES` :967, `_resume_state` :972, `run` :1117, `_turn_to_prompt` :181, `end_turn` call site in the loop)
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/context.py` (`AgentDeps` :150)
- Test: `services/brotto-orchestrator/tests/agent/test_conversation.py` (create)
- Test: `services/brotto-orchestrator/tests/agent/test_resume.py` (extend)

**Interfaces:**
- Consumes: `AuditTrail.begin_task`, `add_message`, `conversation`, `SCHEMA_VERSION` from Task 1.
- Produces, for Task 3:
  - `AgentHarness.run(deps, *, resume_from: int = 0, resume: bool = False)` — `resume=True` is a crash resume; `resume=False` with an existing document is a new task.
  - `AgentDeps.task_index: int = 0` — which `tasks[]` entry this run is writing.
  - `AgentDeps.conversation: list[dict]` — the full `messages[]`, carried on deps so `_turn_to_prompt` can render the window.

- [ ] **Step 1: Write the failing tests**

`tests/agent/test_conversation.py`:

```python
"""A follow-up task continues the conversation; a crash resumes the run.

These two share a document and today share a code path, which is the bug:
one must re-run the unfinished turn, the other must start a new one.
"""

import json

import pytest

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.audit import AuditTrail, read
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.agent.testing import ScriptedPlanner


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    return tmp_path / "sessions"


def _finished_run(sessions, session_id, goal, status="completed", summary="done"):
    """A session that already ended, written the way a real run writes it."""
    t = AuditTrail(session_id, dir=sessions)
    t.begin_task(goal)
    turn = t.begin_turn(step=0, url="https://x.test", page_title="X",
                        ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.end_turn(turn, timings={})
    t.set_status(status)
    t.finish({"status": status, "summary": summary, "timing": {"wall_s": 1.0}})
    t.close()


def _doc(sessions, session_id):
    return json.loads((sessions / f"{session_id}.json").read_text())


def test_a_followup_appends_a_task_instead_of_resuming(sessions):
    """Review focus 1: the second goal is answered on the first's findings."""
    _finished_run(sessions, "c1", "research the top 5 repos")
    assert read("c1", dir=sessions)["status"] == "completed"

    # The decision itself, which is what the harness consults.
    state = harness_mod._conversation_state("c1", resume=False)
    assert state["action"] == "new_task"
    assert state["task_index"] == 1
    assert state["why"] == ""


def test_a_followup_after_a_failed_run_is_allowed(sessions):
    """Review focus 2: a failure still leaves a usable transcript."""
    _finished_run(sessions, "c2", "research", status="failed")
    state = harness_mod._conversation_state("c2", resume=False)
    assert state["action"] == "new_task"
    assert state["why"] == ""


def test_a_followup_into_a_v1_document_is_refused_with_a_reason(sessions):
    """Review focus 4: readable refusal, not a crash and not truncation."""
    sessions.mkdir(parents=True, exist_ok=True)
    (sessions / "c3.json").write_text(json.dumps(
        {"schema_version": 1, "session_id": "c3", "status": "completed",
         "goal": "old", "turns": [], "totals": {"steps": 1}}))
    state = harness_mod._conversation_state("c3", resume=False)
    assert state["action"] == "refuse"
    assert "v1" in state["why"] or "schema" in state["why"]


def test_a_followup_into_a_live_run_is_refused(sessions):
    """Review focus 5: a crashed run's approval is not replayed silently."""
    t = AuditTrail("c4", dir=sessions)
    t.begin_task("go")
    t.begin_turn(step=0, url="https://x.test", page_title="X",
                 ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.close()
    state = harness_mod._conversation_state("c4", resume=False)
    assert state["action"] == "refuse"
    assert "running" in state["why"]


def test_a_crash_resume_still_resumes(sessions):
    t = AuditTrail("c5", dir=sessions)
    t.begin_task("go")
    t.begin_turn(step=0, url="https://x.test", page_title="X",
                 ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.end_turn(0, timings={})
    t.close()
    state = harness_mod._conversation_state("c5", resume=True)
    assert state["action"] == "resume"
    assert state["first_step"] == 1


def test_a_resume_of_a_finished_run_is_refused(sessions):
    _finished_run(sessions, "c6", "done")
    state = harness_mod._conversation_state("c6", resume=True)
    assert state["action"] == "refuse"


def test_interrupted_is_terminal_so_a_second_resume_still_refuses(sessions):
    """Review focus 7: the stamp a refusal leaves behind must not reopen the run."""
    _finished_run(sessions, "c7", "done")
    _finished_run(sessions, "c7", "done")
    # First attempt: refused, and it stamps `interrupted` over `completed`.
    doc = read("c7", dir=sessions)
    doc["status"] = "interrupted"
    (sessions / "c7.json").write_text(json.dumps(doc))
    second = harness_mod._conversation_state("c7", resume=True)
    assert second["action"] == "refuse"


def test_the_prompt_window_names_what_it_dropped():
    from brotto_orchestrator.agent.harness import _conversation_block
    messages = [{"role": "user" if i % 2 == 0 else "assistant",
                 "content": f"m{i}", "task": 0, "turn": None}
                for i in range(20)]
    block = _conversation_block(messages, current_task=1)
    assert "12 earlier messages omitted" in block
    assert "m0" in block and "m19" in block
    assert "m5" not in block


def test_a_first_task_prompt_is_unchanged():
    """Review focus 9: task 0 sees exactly the prompt it saw before."""
    from brotto_orchestrator.agent.harness import _conversation_block
    assert _conversation_block([], current_task=0) == ""


def test_the_conversation_block_excludes_the_current_task():
    """The current goal is in `## Task` already; showing it twice is noise."""
    from brotto_orchestrator.agent.harness import _conversation_block
    block = _conversation_block(
        [{"role": "user", "content": "earlier", "task": 0, "turn": None},
         {"role": "user", "content": "this one", "task": 1, "turn": None}],
        current_task=1)
    assert "earlier" in block and "this one" not in block
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_conversation.py -q`

Expected: FAIL — `AttributeError: module 'brotto_orchestrator.agent.harness' has no attribute '_conversation_state'`

- [ ] **Step 3: Fix the terminal-status set**

`harness.py:967`:

```python
# "interrupted" is written *only* on a resume refusal, and it overwrites the
# terminal status it was refusing to resume from. Leaving it out means a
# second resume attempt reads a finished run as resumable and starts it again.
_TERMINAL_DOC_STATUSES = {
    "completed", "failed", "awaiting_human", "stagnated", "cancelled",
    "interrupted",
}
```

- [ ] **Step 4: Add `_conversation_state`**

Add directly above `_resume_state` (line 972). This is the one place the spec's lifecycle table is encoded:

```python
def _conversation_state(session_id: str, *, resume: bool) -> dict:
    """Decide what a task_start means for this document.

    Returns {"action": "new_task" | "resume" | "refuse", "doc", "summaries",
    "visited", "first_step", "task_index", "why"}.

    The two paths do opposite things with the same document, which is why
    they cannot share one: `resume` continues an unfinished turn of a run the
    socket dropped, and `new_task` appends another thing the user asked for.
    Only the first may re-enter a turn; only the second may start at step 0.
    """
    doc = read(session_id)
    if not doc.get("found"):
        return {"action": "new_task", "doc": None, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": 0,
                "why": ""}
    if doc.get("corrupt"):
        return {"action": "refuse", "doc": doc, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": 0,
                "why": "the session document is corrupt"}

    if resume:
        # A resume never starts a new task, so it never needs a segmentation
        # the document does not have.
        return _resume_state(session_id)

    status = doc.get("status")
    if status in _TERMINAL_DOC_STATUSES:
        if doc.get("schema_version", 1) < 2:
            return {"action": "refuse", "doc": doc, "summaries": [],
                    "visited": set(), "first_step": 0, "task_index": 0,
                    "why": (
                        "this conversation was recorded before tasks were "
                        "tracked, so there is no way to add a follow-up to it. "
                        "Start a new conversation instead — the old one stays "
                        "readable in history."
                    )}
        return {"action": "new_task", "doc": doc, "summaries": [],
                "visited": set(), "first_step": 0,
                "task_index": len(doc.get("tasks") or []), "why": ""}

    return {"action": "refuse", "doc": doc, "summaries": [], "visited": set(),
            "first_step": 0, "task_index": 0,
            "why": (f"a run on this conversation is still in flight "
                    f"(status={status})")}
```

The v1 check is ordered after the terminal check on purpose: a v1 document is
always terminal, and the refusal reason is about the schema, not about a run
that ended.

- [ ] **Step 5: Add the two deps fields**

In `context.py`, in `AgentDeps`, next to `task_id`:

```python
    task_id: str = ""  # set by harness for run logging
    # Which `tasks[]` entry this run writes. -1 before the first
    # `begin_task`, which is what a refusal path leaves behind.
    task_index: int = -1
    # The whole transcript, carried on deps so `_turn_to_prompt` can window
    # it. Read through the existing `_CURRENT_DEPS` global for the same
    # reason the secure-mode preamble is.
    conversation: list = field(default_factory=list)
```

- [ ] **Step 6: Wire the fork into `run()`**

Change the signature (line 1117):

```python
    async def run(self, deps: AgentDeps, *, resume_from: int = 0,
                  resume: bool = False) -> TaskResult:
```

Replace the block at lines 1151-1198 with:

```python
    state = _conversation_state(deps.task_id, resume=resume)
    first_step = max(resume_from, state["first_step"])

    audit = AuditTrail(deps.task_id)
    _task = asyncio.current_task()
    if _task is not None:
        _task.add_done_callback(_seal_if_cancelled(audit))
    a_turn = -1

    if state["doc"] and not state["doc"].get("corrupt"):
        _adopt_document(audit, state["doc"])
    if state["summaries"]:
        deps.step_summaries.extend(state["summaries"])
        deps.visited_domains |= state["visited"]
        log.info("[%s] resuming at step %d  summaries=%d  domains=%d",
                 deps.user_id, first_step, len(state["summaries"]),
                 len(state["visited"]))

    # A document we cannot act on is reported, never silently re-run.
    # Ahead of the first flush, because that flush overwrites the file.
    if state["action"] == "refuse":
        log.error("[%s] refused: %s", deps.user_id, state["why"])
        if state["doc"] and not state["doc"].get("corrupt"):
            audit.record_error(code="task_refused", where="run",
                               message=state["why"])
            audit.set_status("interrupted")
            audit.close()
        return TaskResult(
            status="failed",
            summary=state["why"],
            failure_reason="task_refused",
            policy_mode=_policy_mode(deps),
            final_url=deps.step_url,
        )

    # The user's prompt is written here, not per turn: a run cancelled at
    # step 0 has no turns, and the prompt they typed is the one thing that
    # must survive it. Only a new task writes one — a resume is the same
    # task continuing, and its prompt is already on disk.
    if state["action"] == "new_task" and state["doc"]:
        task_index = audit.begin_task(deps.task)
    elif state["action"] == "new_task":
        task_index = 0
    else:
        task_index = 0
    deps.task_index = task_index
    if state["action"] == "new_task":
        audit.add_message(role="user", content=deps.task, task=task_index,
                          turn=None)
        # Only earlier tasks. The current goal is in the prompt already, and
        # showing it twice is both noise and a chance for the two copies to
        # disagree.
        deps.conversation = [m for m in audit.conversation()
                             if m.get("task", 0) < task_index]

    audit.set_goal(deps.task)
```

The `resume` action keeps the old behaviour exactly: `state` came from
`_resume_state`, so `summaries` and `first_step` are populated, and
`begin_task` is skipped because the document already has its task.

`task_index` is spelled out as three branches rather than a conditional
expression because `_resume_state`'s dict has no `"task_index"` key at all —
the resume action must not read it, and a `dict.get` would hide that.

- [ ] **Step 7: Write the assistant message at turn end**

`end_turn` is where a turn becomes finished, which is the only point an
assistant message can honestly describe one. There are two `audit.end_turn`
calls in the loop: line 1231 closes the *previous* turn on its way into a new
step, and line 1727 closes the turn that just ran. The message belongs at
1727, where `decision` is in scope and the turn is genuinely complete. Add
immediately after it:

```python
        # One assistant message per completed turn, not per action: the
        # transcript is what a human reads, and a turn's outcome is the unit
        # they can act on. `thought` is the field AgentDecision carries.
        if decision.thought:
            audit.add_message(role="assistant", content=decision.thought,
                              task=deps.task_index, turn=a_turn)
```

A turn closed by the abort gate (line 1720's `_close`) never reaches here, so
it gets no assistant message. That is the same rule as resume: an unfinished
turn describes actions that may not have run, and the transcript should not
claim otherwise. The task's outcome reaches the next task's context through
`tasks[]` and the user's own next message, which is what the user is reading
anyway.

- [ ] **Step 8: Add `_conversation_block` and render it**

Add next to `_turn_to_prompt` (line 181):

```python
# A conversation message is a whole exchange, not one step's summary, so its
# window is much smaller than _HISTORY_WINDOW. The goal is for the model to
# remember how this started and what just happened, not to re-read the log.
_CONV_HEAD = 2
_CONV_TAIL = 6


def _conversation_block(messages: list[dict], *, current_task: int) -> str:
    """Render earlier tasks' messages into the prompt, windowed.

    Returns "" when there is nothing earlier, which is the case for every
    first task — so task 0's prompt is byte-identical to the one it got
    before this feature existed.
    """
    earlier = [m for m in messages if m.get("task", 0) < current_task]
    if not earlier:
        return ""
    if len(earlier) > _CONV_HEAD + _CONV_TAIL:
        shown = earlier[:_CONV_HEAD] + earlier[-_CONV_TAIL:]
        skipped = len(earlier) - (_CONV_HEAD + _CONV_TAIL)
    else:
        shown = earlier
        skipped = 0
    lines = []
    for m in shown:
        who = "User" if m.get("role") == "user" else "Assistant"
        lines.append(f"{who}: {m.get('content', '')}")
    if skipped:
        # Named, not silent. A model told a turn was dropped and not told
        # how many will assume the gap is small.
        lines.insert(_CONV_HEAD, f"... {skipped} earlier messages omitted ...")
    return ("\n## This conversation so far\n"
            + "\n".join(lines) + "\n")
```

Then in `_turn_to_prompt`, read deps the way the secure-mode preamble already
does (`deps = _CURRENT_DEPS or _TEST_DEPS`, already there) and add the block
to the returned f-string, immediately before `## Task`:

```python
    conv_section = ""
    if deps is not None:
        conv_section = _conversation_block(
            getattr(deps, "conversation", []),
            current_task=getattr(deps, "task_index", 0),
        )
```

and in the return, `{secure_prefix}{conv_section}## Task`:

```python
    return f"""{secure_prefix}{conv_section}## Task
{turn.task}
```

- [ ] **Step 9: Run the new tests, then the full suite**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_conversation.py -q`

Expected: 10 passed

Then: `../../.venv/bin/python -m pytest tests/ -q`

Expected: all pass. `test_resume.py` in particular asserts on resume refusals and the `interrupted` stamp — those paths now go through `_conversation_state`, and a failure there is the fork not being fully separated.

- [ ] **Step 10: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/agent/harness.py \
        services/brotto-orchestrator/src/brotto_orchestrator/agent/context.py \
        services/brotto-orchestrator/tests/agent/test_conversation.py
git commit -m "agent: split a follow-up task from a crash resume

A resume continues an unfinished turn of a run the socket dropped; a
follow-up starts a new tasks[] entry at step 0. Today both arrive as
the same task_start and take the same path, so one of them has to be
wrong. An explicit resume flag on the frame is what tells them apart.

interrupted joins the terminal statuses: it is written only by a
resume refusal, over the status it was refusing, so leaving it out
meant a second attempt could resume a run that had already ended."
```

---

### Task 3: The wire

`resume` reaches the server on the frame, and every refusal comes back as a message the panel can show.

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/main.py` (`websocket_extension` `task_start` parse ~:490, harness call site)
- Test: `services/brotto-orchestrator/tests/test_conversation_ws.py` (create)

**Interfaces:**
- Consumes: `AgentHarness.run(deps, *, resume_from=0, resume=False)` from Task 2.
- Produces, for Tasks 4-5: `task_start` accepts `"resume": bool`; a refused task sends `task_failed` with `failure_reason: "task_refused"`.

- [ ] **Step 1: Write the failing test**

`tests/test_conversation_ws.py`:

```python
"""The task_start frame carries the resume flag, and the default is a follow-up.

The harness is stubbed so the test is about the wire — what the server reads
off the frame and hands to the agent — and not about CDP, a model, or a
network. Everything downstream of `run()` is Task 2's concern.
"""

import pytest
from fastapi.testclient import TestClient

from brotto_orchestrator.agent.context import TaskResult
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def captured(monkeypatch):
    """Replace AgentHarness.run with a recorder that returns straight away."""
    seen: list[dict] = []

    async def fake_run(self, deps, *, resume_from=0, resume=False, **kw):
        seen.append({"resume": resume, "resume_from": resume_from,
                     "task": deps.task})
        return TaskResult(status="completed", summary="stubbed")

    monkeypatch.setattr(AgentHarness, "run", fake_run)
    return seen


def _drive(client, frame: dict) -> None:
    with client.websocket_connect("/ws/ext/wire-1") as ws:
        ws.send_json(frame)
        # The handler sends observe/action frames as the run progresses; the
        # terminal one is what proves the agent task ran to completion.
        for _ in range(20):
            msg = ws.receive_json()
            if msg.get("type") == "task_result":
                return


def test_resume_true_is_forwarded(captured):
    with TestClient(app) as c:
        _drive(c, {"type": "task_start", "task": "go", "resume": True})
    assert captured[0]["resume"] is True


def test_a_frame_without_the_flag_is_a_followup_not_a_resume(captured):
    """An extension that predates the flag never reconnects with resume
    intent, so defaulting the other way would let a new task silently
    restart a run the user already approved."""
    with TestClient(app) as c:
        _drive(c, {"type": "task_start", "task": "go"})
    assert captured[0]["resume"] is False
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/test_conversation_ws.py -q`

Expected: FAIL — `fake_run` is not called with `resume`, so the real
`run()` runs instead and the CDP preflight fails it before `task_result`.

- [ ] **Step 3: Parse the flag**

In `main.py`, in the `task_start` block near line 494, after `task` is read:

```python
        # A follow-up task and a crash resume arrive on the same frame and do
        # opposite things with the same document. The extension sets this, and
        # a frame without it is a follow-up: an extension that predates the
        # flag never reconnects with resume intent, so defaulting the other
        # way would let a new task silently restart an approved run.
        resume = bool(msg.get("resume", False))
```

Log it next to the existing `task_start` log line:

```python
        log.info("[%s] task_start  task=%r  resume=%s", session_id, task[:100],
                 resume)
```

- [ ] **Step 4: Pass it to the harness**

Find where `run_local_task` calls `AgentHarness(...).run(deps...)` and add
the keyword:

```python
            result = await harness.run(deps, resume=resume)
```

If the call site passes `resume_from=` too, keep it.

- [ ] **Step 5: Run the test, then the suite**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/test_conversation_ws.py -q && ../../.venv/bin/python -m pytest tests/ -q`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/main.py \
        services/brotto-orchestrator/tests/test_conversation_ws.py
git commit -m "server: the task_start frame says whether this is a resume

A missing flag is a follow-up, not a resume — an extension that
predates it only ever reconnects with the flag set, so the other
default would let a new task silently restart an approved run."
```

---

### Task 4: The extension reuses the session

**Files:**
- Modify: `clients/brotto-extension/src/background.ts` (`startRelay` :665, the `run_local_task` case :1111, the `task_start` send)
- Test: none (no JS runner in this repo — this is the standing gap, see Review Focus 11 in `brotto-current-state.md`; build + `tsc` is the check available)

**Interfaces:**
- Consumes: `task_start.resume` from Task 3.
- Produces, for Task 5: `run_local_task` accepts `continueSession: boolean`. `startRelay` takes `opts: { resume?: boolean; continueSession?: boolean }`.

- [ ] **Step 1: Widen the session-reuse branch**

`startRelay` currently reuses the session only for a resume. A follow-up
reuses it too — that is the entire feature client-side.

```typescript
async function startRelay(
  goal: string,
  plannerUrl: string,
  startingUrl?: string,
  opts: { resume?: boolean; continueSession?: boolean } = {},
): Promise<void> {
```

and the branch condition at line 676:

```typescript
  // A crash resume and a follow-up task both continue an existing session, so
  // both reuse its id and its tab. Minting a new id here would make a
  // follow-up a second conversation; re-picking the tab could aim it at a
  // different one than the task before it was driving.
  const continues = (opts.resume || opts.continueSession) === true;
  if (continues && sessionId !== null && activeTabId !== null) {
```

Everything inside that branch stays as it is, with one exception: the
`resume` flag on the outgoing `task_start` must reflect `opts.resume`, not
`continues`. Find the `task_start` send in `ws.onopen` and set:

```typescript
      payload: { type: "task_start", task: currentGoal, model_config, api_key, resume: opts.resume === true },
```

- [ ] **Step 2: Reset the per-run state that a new task must not inherit**

`observationSeq` is reset in the mint branch (line 752) and must stay that
way. A follow-up runs in the same session, and the server's dedupe tracker is
per session — resetting the counter would resend observations the server has
already accepted and the whole task would be rejected as duplicate. Add a
comment where it is reset saying exactly that, so the next reader does not
"fix" it into the reuse branch.

A follow-up *does* reset the panel-side run state, which the `run_local_task`
handler already does at lines 1120-1129. Verify it is reached for a
continuation and add `continueSession` to its payload:

```typescript
          startRelay(goal, plannerUrl, message.startingUrl as string | undefined, {
            continueSession: message.continueSession === true,
          })
```

- [ ] **Step 3: Build and typecheck**

Run: `cd clients/brotto-extension && npx tsc --noEmit && npm run build`

Expected: clean. `opts.resume` must be narrowed to a boolean at both uses —
`=== true` — because `opts` is optional and TS will not narrow it for you.

- [ ] **Step 4: Commit**

```bash
git add clients/brotto-extension/src/background.ts
git commit -m "extension: a follow-up reuses the session it was sent into

startRelay reused a session only for a crash resume, so every message
started a new one. Both cases now take the same branch, and the
outgoing task_start carries resume so the server can still tell them
apart. observationSeq is deliberately not reset: the dedupe tracker
is per session, and a follow-up's observations have to keep climbing."
```

---

### Task 5: The panel treats a conversation as a conversation

**Files:**
- Modify: `clients/brotto-extension/src/sidepanel.js` (`sendUserMessage` :1126, `resetForNewTask` :1234, `saveSession` :272, `renderHistory` :311, `renderTranscript` :443, `openTranscript` :415)
- Modify: `clients/brotto-extension/src/sidepanel.html` (the `#newTaskBtn` label at :1485)
- Test: none — same standing gap as Task 4.

**Interfaces:**
- Consumes: `run_local_task.continueSession` from Task 4; `title` / `task_count` / `messages[]` / `tasks[]` from Task 1's document.

- [ ] **Step 1: Stop clearing the conversation on send**

`sendUserMessage` calls `clearMessages()` at line 1184 and, before that, the
same function is reached from `resetForNewTask` — which is the bug in one
line. Replace lines 1183-1192 with:

```javascript
  // A message continues the conversation unless the user asked for a new
  // one. Clearing here is what made every follow-up look like a fresh run to
  // both the panel and the server.
  const continuing = state.sessionId !== null;
  if (continuing) {
    appendMessage({ role: 'user', text });
  } else {
    clearMessages();
    seenTabs.clear();
    updateTabCount();
    appendMessage({ role: 'user', text });
  }
  state.lastGoal = text;
  goalEl.value = '';
  goalEl.style.height = 'auto';
```

- [ ] **Step 2: Pass `continueSession` to the background**

The `run_local_task` send at line 1211 becomes:

```javascript
  const response = await sendMessage({
    type: 'run_local_task',
    task: text,
    continueSession: state.sessionId !== null,
  });
```

Read `state.sessionId` *before* anything can clear it — Step 1 no longer
clears it, and `resetForNewTask` is only reachable from the button.

- [ ] **Step 3: Make the history list show conversations**

`renderHistory` renders one row per `saveSession` entry. `saveSession`
already dedupes on `session_id`, so a follow-up updates its row rather than
adding one — that is the behaviour we want and it is already there. What is
missing is the label. In `renderHistory`'s row builder, show the task count
alongside the row's existing title and time, reading it from the fetched
document if the row has it, and falling back to omitting it when the document
is v1 and has no `tasks[]`.

- [ ] **Step 4: Render the transcript by task**

`renderTranscript(doc, entry)` at line 443 already walks a document. Change it
to group by `doc.tasks[]` when `schema_version >= 2` and `doc.tasks` is
present, falling through to today's single-task rendering otherwise — which is
what every v1 document on disk needs.

Inside each task group, render `doc.messages` in order, and keep the existing
turn/prompt/action detail beneath the assistant message each turn belongs to,
joined by `messages[].turn` → `turns[]`.

- [ ] **Step 5: Relabel the button**

`sidepanel.html:1485`:

```html
<button class="new-task-btn" id="newTaskBtn" title="Start a new conversation">New conversation</button>
```

Keep the id and the class. The panel is narrow and the design language is
square and tight; if the label wraps or clips at 360px, revert to "New task"
and put the full wording in the `title` attribute rather than shrinking the
type. Check it in the panel, not by reading the CSS.

- [ ] **Step 6: Build and typecheck**

Run: `cd clients/brotto-extension && npx tsc --noEmit && npm run build`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add clients/brotto-extension/src/sidepanel.js clients/brotto-extension/src/sidepanel.html
git commit -m "panel: a message continues the conversation

sendUserMessage cleared the transcript and the session id before
every send, so a follow-up could not reach the server as one. The
New task button still clears both — that is now the explicit way to
start a new conversation."
```

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md` (the "## Audit trail" section, and the repo layout line for `agent/audit.py`)
- Modify: `docs/product/brotto-current-state.md` (the "## Audit trail" section, "## UX surface", the wire-protocol frame list)

- [ ] **Step 1: Update `CLAUDE.md`**

Add a "### A session is a conversation" subsection under "## Audit trail"
covering: `session_id` is minted once per conversation and reused; `tasks[]`
segments it, `messages[]` is the transcript, `turns[].task` joins them; the
`resume` flag on `task_start` is the fork; the `<conversation>` block in the
prompt is windowed first-2 + last-6 and excludes the current task; and
`interrupted` is terminal because a refusal stamps it over what it refused.

- [ ] **Step 2: Update `docs/product/brotto-current-state.md`**

The "## Audit trail" section gains the v2 shape. The wire-protocol frame list
gains `resume` on `task_start`. The UX surface section's history-list line
changes from "per-run" to "per-conversation, with a task count".

- [ ] **Step 3: Commit**

```bash
git add -f CLAUDE.md docs/product/brotto-current-state.md
git commit -m "docs: a session holds a conversation, not a run"
```

---

## End-to-end verification

After all six tasks, the three things a person actually checks:

```bash
cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/ -q
cd ../../clients/brotto-extension && npx tsc --noEmit && npm run build
```

Then, in the browser with the extension loaded against a freshly restarted
server:

1. **Continuation** — send "research the top 5 repos for suryansh", let it
   finish, then send "now write a linkedin post about the top one". The second
   task must reference the first's findings, and
   `logs/sessions/<id>.json` must show both entries in `tasks[]` with
   `messages[]` holding four entries in order.
2. **One conversation, one row** — the history list shows a single row with a
   task count of 2, not two rows.
3. **New conversation** — "New conversation" clears the panel, mints a new
   `session_id`, and writes a second file.
