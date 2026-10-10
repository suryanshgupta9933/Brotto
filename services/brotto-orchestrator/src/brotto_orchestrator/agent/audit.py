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
import time
from pathlib import Path
from typing import Any

from .context import MemoryEntry, Scratchpad

log = logging.getLogger(__name__)

SCHEMA_VERSION = 2

# A single scalar is capped so one pathological page cannot produce a
# multi-megabyte document. The cap is recorded rather than silent.
MAX_FIELD_CHARS = 8_000

REDACTED = "[redacted:password]"

_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"

_SECRET_NAME_RE = re.compile(
    r"password|passcode|passphrase|one[- ]?time|\botp\b|\bpin\b"
    # Not just passwords. An API-key or token field is usually type="text" or
    # type="email", so the definitive check misses it and the name is all
    # there is. False positives cost a replay that says [redacted:...] — the
    # same asymmetry that decides the unresolvable-lookup case.
    r"|secret|token|api[-_ ]?key|auth(?:orization)?|credential|bearer"
    r"|private[-_ ]?key|csrf|xsrf|session[-_ ]?id"
    r"|(?:recovery|backup|security|verification|confirmation)[- _]?code",
    re.I,
)


def is_secret_field(attributes: dict | None, accessible_name: str | None) -> bool:
    """True when a field is a password/secret input.

    Two signals, because neither is sufficient alone. `type="password"`
    is definitive but only available when the DOM lookup succeeded; the
    accessible name is free and always present, but is blank on some
    real login forms. Either one redacts.

    Lives here, not in a relay, so the Playwright and extension paths
    cannot disagree about what counts as a secret.
    """
    if attributes and (attributes.get("type") or "").lower() == "password":
        return True
    return bool(_SECRET_NAME_RE.search(accessible_name or ""))


# ponytail: one directory, one file per session, no database and no index.
# Upgrade path if a session ever outgrows an atomic rewrite (megabytes of
# per-step page text would do it): append JSONL during the run, compact to
# this document at task end.
def default_dir() -> Path:
    return Path(os.getenv("BROTTO_SESSIONS_DIR", "logs/sessions"))


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="milliseconds")


def new_error_id() -> str:
    """Six base36 characters from `secrets` — short enough to read aloud
    over support, wide enough (~2 billion) to be unique within a session."""
    n = secrets.randbelow(36 ** 6)
    out = []
    for _ in range(6):
        n, r = divmod(n, 36)
        out.append(_B36[r])
    return "".join(out)


def _cap(value: Any) -> Any:
    """Truncate an over-long scalar, leaving a marker for the reader."""
    if isinstance(value, str) and len(value) > MAX_FIELD_CHARS:
        return value[:MAX_FIELD_CHARS]
    return value


def _text(container: dict, key: str, value: Any) -> None:
    """Write one capped scalar, plus a sibling marker when it was cut."""
    if isinstance(value, str) and len(value) > MAX_FIELD_CHARS:
        container[key] = value[:MAX_FIELD_CHARS]
        container[f"{key}_truncated"] = True
    else:
        container[key] = value


def _cap_deep(value: Any, depth: int = 0) -> Any:
    """Same cap, through the args/detail trees — page text arrives in args.

    Depth-limited because `json.dump(default=str)` is the only backstop and
    it would happily serialise a 5-deep cycle of page text.
    """
    if depth > 8:
        return _cap(value)
    if isinstance(value, str):
        return _cap(value)
    if isinstance(value, dict):
        return {k: _cap_deep(v, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_cap_deep(v, depth + 1) for v in value]
    return value


def _as_scratchpad(value: Scratchpad | dict) -> Scratchpad | None:
    if isinstance(value, Scratchpad):
        return value
    try:
        # `body` defaults to the digest: `_scratchpad_dict` no longer writes
        # it, and a reloaded entry genuinely holds nothing more than the
        # digest — the same thing `load_scratchpad` has always produced from
        # the sidecar. Without this default the model would lose its entire
        # manifest on resume rather than keep the digests.
        return Scratchpad(
            entries=[MemoryEntry(**{**e, "body": e.get("body", e.get("digest", ""))})
                     for e in value.get("entries", [])],
            notes=value.get("notes", ""),
        )
    except Exception as exc:  # a dict that is not entry-shaped
        log.debug("audit: cannot rebuild scratchpad: %s", exc)
        return None


def _scratchpad_dict(value: Scratchpad | dict) -> dict:
    # `body` is deliberately excluded. This runs on every step and the whole
    # document is rewritten each time, so a body here is a body re-serialised
    # every step. That was free while nothing was captured — entries=0 on
    # three Gmail runs, because `page_text` ships in the prompt so the model
    # never called `read_page_text` — and is not free now that every step's
    # page is captured: a 20-page run measured 200KB of growth for pages that
    # were 10x smaller. Nothing reads the body off disk; the digest is what a
    # resumed run's manifest renders.
    _FIELDS = ("id", "step", "selector", "around", "digest", "was_truncated", "url")
    if isinstance(value, Scratchpad):
        return {"entries": [{k: getattr(e, k) for k in _FIELDS} for e in value.entries],
                "notes": value.notes}
    return _cap_deep(value)


def load_scratchpad(path: Path) -> Scratchpad:
    """Parse the structured file. Returns an empty Scratchpad on legacy
    plain-text files (no header) — the run continues without entries.
    """
    if not path.exists():
        return Scratchpad()
    content = path.read_text()
    if not content.startswith("# MEMORY v2"):
        # Legacy plain text — treat as notes only, no entries.
        return Scratchpad(notes=content.strip())
    entries: list[MemoryEntry] = []
    notes_lines: list[str] = []
    in_notes = False
    current_entry_lines: list[str] = []
    current_header: dict[str, str] | None = None

    for raw_line in content.splitlines():
        line = raw_line.rstrip()
        if in_notes:
            notes_lines.append(line)
            continue
        if line.startswith("# NOTES"):
            in_notes = True
            continue
        if line.startswith("# MANIFEST") or line == "# MEMORY v2" or line == "":
            continue
        m = re.match(r"^\[(r\d+)\s+step=(\d+)\s+sel=([^\s]+)\s+around=(\S+)\s+truncated=(True|False)(?:\s+url=(\S*))?\]\s*$", line)
        if m:
            # Flush previous entry
            if current_header is not None:
                entries.append(MemoryEntry(
                    id=current_header["id"],
                    step=int(current_header["step"]),
                    selector=current_header["sel"],
                    around=None if current_header["around"] == "None" else current_header["around"],
                    digest="\n".join(current_entry_lines).strip(),
                    body="\n".join(current_entry_lines),  # body == digest on reload
                    was_truncated=(current_header["trunc"] == "True"),
                    url=current_header["url"],
                ))
            current_header = {
                "id": m.group(1),
                "step": m.group(2),
                "sel": m.group(3),
                "around": m.group(4),
                "trunc": m.group(5),
                # Optional: files written before entries carried a url have
                # no such field, and they must keep parsing unchanged.
                "url": m.group(6) or "",
            }
            current_entry_lines = []
        else:
            if current_header is not None:
                current_entry_lines.append(line)

    # Flush last entry
    if current_header is not None:
        entries.append(MemoryEntry(
            id=current_header["id"],
            step=int(current_header["step"]),
            selector=current_header["sel"],
            around=None if current_header["around"] == "None" else current_header["around"],
            digest="\n".join(current_entry_lines).strip(),
            body="\n".join(current_entry_lines),
            was_truncated=(current_header["trunc"] == "True"),
            url=current_header["url"],
        ))

    return Scratchpad(entries=entries, notes="\n".join(notes_lines).strip())


def save_scratchpad(path: Path, scratchpad: Scratchpad) -> None:
    """Serialize the structured Scratchpad to plain text.

    Format is unchanged from run_logger.py and must not be touched: the
    agent re-reads this file to restore its memory across a restart, and
    files already on disk have to keep parsing.
    """
    lines = ["# MEMORY v2", ""]
    lines.append("# MANIFEST")
    for e in scratchpad.entries:
        around = e.around if e.around is not None else "None"
        trunc = "True" if e.was_truncated else "False"
        # url is the trailing optional field the loader's regex made
        # optional; written only when present so a pre-url file is
        # byte-identical to what it always was.
        url = f" url={e.url}" if e.url else ""
        lines.append(
            f"[{e.id} step={e.step} sel={e.selector} around={around} truncated={trunc}{url}]"
        )
        lines.append(e.digest)
        lines.append("")
    lines.append("# NOTES")
    lines.append(scratchpad.notes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


# Live trails, by session id. A policy acknowledgement arrives from an HTTP
# handler while the agent loop is mid-run, and the loop's in-memory document is
# the source of truth — it rewrites the whole file on every flush. So a second
# writer read-modify-writing the same path would be clobbered by the very next
# flush. Routing the event to the live instance keeps one writer per document.
_LIVE: dict[str, "AuditTrail"] = {}
_LIVE_LOCK = threading.Lock()


class AuditTrail:
    def __init__(self, session_id: str, *, dir: Path | None = None) -> None:
        self.session_id = session_id
        self.dir = dir or default_dir()
        self._path = self.dir / f"{session_id}.json"
        self._lock = threading.Lock()
        self._dropped = 0
        self._seq = 0
        # Which `tasks[]` entry the turns being written belong to. Stamped
        # onto every turn rather than passed in, because there is one writer
        # per run and a dozen `begin_turn` call sites that would each have to
        # remember to pass it. 0 is right for a first task and for a resume
        # of one, and `resume_task` corrects it for a resume of a later one.
        self._task_index = 0
        self._prompt_index: dict[str, tuple[int, dict]] = {}
        # Set by `delete()` while the loop is still holding this object. The
        # caller keeps a reference, not a lookup, so dropping the `_LIVE`
        # entry alone does not stop the next flush from rewriting the file.
        self._deleted = False
        self._doc: dict = {
            "schema_version": SCHEMA_VERSION,
            "session_id": session_id,
            "created_at": _now(),
            "updated_at": _now(),
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
            "model": {},
            "policy": {},
            "totals": {"turns": 0, "steps": 0, "prompts": 0, "actions": 0,
                       "tokens_in": 0, "tokens_out": 0,
                       "cache_read_tokens": 0, "cache_write_tokens": 0,
                       "wall_s": 0.0, "errors": 0},
            "turns": [],
            "errors": [],
            # Policy decisions that belong to no single turn (preflight
            # blocks, flat approval rows). Kept off `policy`, which is the
            # policy configuration itself.
            "policy_events": [],
        }
        self._mkdir()
        with _LIVE_LOCK:
            _LIVE[session_id] = self

    def close(self) -> None:
        """Drop out of the live registry. Idempotent."""
        with _LIVE_LOCK:
            if _LIVE.get(self.session_id) is self:
                del _LIVE[self.session_id]

    # ── durability ──────────────────────────────────────────────
    def _mkdir(self) -> None:
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # A missing directory is survivable: every write below will
            # also fail and be counted, but construction must not raise,
            # because the constructor runs inside the agent loop.
            log.warning("audit: cannot create %s: %s", self.dir, exc)

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
            self._note_dropped(exc, "audit.flush")

    def _note_dropped(self, exc: Exception, where: str) -> None:
        """Count a lost write and record it in the document itself.

        Must not raise: this runs on the failure path of a method that is
        already failing, and the agent loop is the caller.
        """
        self._dropped += 1
        # The log is the broadly-visible sink, so it gets the exception *type*
        # and not its message: a serialization error can quote the value that
        # failed to serialize, and that value is the document we were writing.
        # The full message stays in the document below, which is per-session,
        # already field-capped, and is the only place a diagnosis is useful.
        log.warning("audit: write failed for %s at %s: %s",
                    self.session_id, where, type(exc).__name__)
        try:
            self._doc["errors"].append({
                "seq": self._next_seq(),
                "at": _now(),
                "error_id": new_error_id(),
                "code": "audit_write_failed",
                "where": where,
                "message": str(exc)[:MAX_FIELD_CHARS],
                "detail": {},
            })
            self._doc["totals"]["errors"] = len(self._doc["errors"])
        except Exception:  # nothing left to do but keep counting
            pass

    def _record(self, fn, *args, **kwargs) -> Any:
        """Run one mutation under the lock, then flush. Never raises.

        Returns whatever `fn` returned, or None if it blew up, or None if
        this session has been deleted — every mutation goes through here, so
        this is the one place that has to know.
        """
        with self._lock:
            if self._deleted:
                return None
            try:
                out = fn(*args, **kwargs)
                self._flush()
                return out
            except Exception as exc:
                self._note_dropped(exc, getattr(fn, "__name__", "audit.record"))
                return None

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _turn(self, index: int) -> dict | None:
        turns = self._doc["turns"]
        return turns[index] if isinstance(index, int) and 0 <= index < len(turns) else None

    # ── accessors ───────────────────────────────────────────────
    @property
    def path(self) -> Path:
        return self._path

    @property
    def scratchpad_path(self) -> Path:
        # Per-session filename, not a shared one. `dir` defaults to the root
        # that holds every session, so a bare "scratchpad.txt" here would make
        # concurrent tasks overwrite each other's memory and let one session
        # read another's. The old layout was logs/runs/<task_id>/scratchpad.txt,
        # which was per-task; this keeps that property while moving the parent.
        return self.dir / f"{self.session_id}.scratchpad.txt"

    @property
    def dropped_writes(self) -> int:
        return self._dropped

    def document(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._doc)

    # ── header fields ───────────────────────────────────────────
    def set_goal(self, goal: str) -> None:
        self._record(self._set_goal, goal)

    def _set_goal(self, goal: str) -> None:
        _text(self._doc, "goal", goal)

    def set_client(self, *, ip_hash: str, extension_version: str = "") -> None:
        self._record(self._set_client, ip_hash=ip_hash,
                     extension_version=extension_version)

    def _set_client(self, *, ip_hash: str, extension_version: str = "") -> None:
        _text(self._doc, "client", {"ip_hash": ip_hash,
                                    "extension_version": extension_version})

    def set_model(self, *, provider: str, model: str, context_window: int,
                  source: str) -> None:
        self._record(self._set_model, provider=provider, model=model,
                     context_window=context_window, source=source)

    def _set_model(self, *, provider: str, model: str, context_window: int,
                   source: str) -> None:
        self._doc["model"] = {
            "provider": provider, "model": model,
            "context_window": context_window, "source": source,
        }

    def set_policy(self, policy: dict) -> None:
        self._record(self._set_policy, policy)

    def _set_policy(self, policy: dict) -> None:
        self._doc["policy"] = _cap_deep(policy)

    def set_status(self, status: str) -> None:
        self._record(self._set_status, status)

    def _set_status(self, status: str) -> None:
        self._doc["status"] = status

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
        self._task_index = entry["index"]
        # Named after how the conversation started, not how it ended: the
        # history list needs one stable label for the whole session.
        if not self._doc.get("title"):
            _text(self._doc, "title", goal)
        return entry["index"]

    def seal_task(self, index: int, status: str) -> None:
        """Mark a task that nothing is running any more as ended.

        `begin_task` is the only other writer of `tasks[].status`, so a task
        whose run was abandoned — a dropped socket, a server restart, a
        killed process — would stay `running` forever and read in the history
        list as a task still in progress. Recorded on top of the existing
        task, never in place of it: the turns and the prompt stay.
        """
        self._record(self._seal_task, index, status)

    def _seal_task(self, index: int, status: str) -> None:
        for entry in self._doc.get("tasks") or []:
            if entry.get("index") == index:
                entry["status"] = status
                entry["ended_at"] = _now()
                return

    def resume_task(self) -> int:
        """Point at the task a crash-resume continues, without starting one.

        Defaults to 0, which is correct for a v1 document and for a resume of
        a first task. For a resume of a later task it is the last index —
        anything else writes the resumed run's turns and messages into the
        wrong segment of the transcript.
        """
        tasks = self._doc.get("tasks") or []
        self._task_index = int(tasks[-1].get("index", 0)) if tasks else 0
        return self._task_index

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

    # ── turns ───────────────────────────────────────────────────
    def begin_turn(self, *, step: int, url: str, page_title: str,
                   ax_targets: int, ax_chars: int, ax_diff_chars: int,
                   page_text_chars: int) -> int:
        # Key order is causal and load-bearing: model -> prompts -> actions,
        # because that is the order they happen in and the order a replay
        # walks. Test asserts on it.
        idx = self._record(
            self._begin_turn, step=step, url=url, page_title=page_title,
            ax_targets=ax_targets, ax_chars=ax_chars,
            ax_diff_chars=ax_diff_chars, page_text_chars=page_text_chars)
        return -1 if idx is None else idx

    def _begin_turn(self, *, step: int, url: str, page_title: str,
                    ax_targets: int, ax_chars: int, ax_diff_chars: int,
                    page_text_chars: int) -> int:
        obs: dict = {}
        _text(obs, "url", url)
        _text(obs, "page_title", page_title)
        obs["ax_targets"] = ax_targets
        obs["ax_chars"] = ax_chars
        # Counts, never content. This dict is the shape page text must not
        # take: the AX diff quotes the page verbatim, and it used to be the
        # one place raw page content reached disk. The prompt still gets the
        # text — the document gets how much there was.
        obs["ax_diff_chars"] = ax_diff_chars
        obs["page_text_chars"] = page_text_chars
        turn = {
            "seq": self._next_seq(),
            "step": step,
            # Which `tasks[]` entry this turn belongs to. The transcript join
            # is messages[].turn -> turns[] and turns[].task -> tasks[], so
            # without this the panel cannot group a conversation.
            "task": self._task_index,
            "started_at": _now(),
            "ended_at": None,
            "observation": obs,
            # Model/provider live once at the document root; repeating them
            # per turn is the second source of truth this feature exists to
            # remove. The turn keeps the usage numbers.
            "model": None,
            "prompts": [],
            "actions": [],
            "timings": {},
            "error": None,
        }
        self._doc["turns"].append(turn)
        self._doc["totals"]["turns"] += 1
        self._doc["totals"]["steps"] += 1
        return len(self._doc["turns"]) - 1

    def record_model(self, turn: int, *, thought: str, reasoning: str,
                     tokens_in: int, tokens_out: int, context_pct: float,
                     latency_ms: int, cache_read: int = 0,
                     cache_write: int = 0, cost_usd: float | None = None
                     ) -> None:
        self._record(self._record_model, turn, thought=thought,
                     reasoning=reasoning, tokens_in=tokens_in,
                     tokens_out=tokens_out, context_pct=context_pct,
                     latency_ms=latency_ms, cache_read=cache_read,
                     cache_write=cache_write, cost_usd=cost_usd)

    def _record_model(self, turn: int, *, thought: str, reasoning: str,
                      tokens_in: int, tokens_out: int, context_pct: float,
                      latency_ms: int, cache_read: int = 0,
                      cache_write: int = 0, cost_usd: float | None = None
                      ) -> None:
        t = self._turn(turn)
        if t is None:
            return
        block: dict = {}
        _text(block, "thought", thought)
        _text(block, "reasoning", reasoning)
        block["tokens_in"] = tokens_in
        block["tokens_out"] = tokens_out
        # Absent from every document written before this field existed, so a
        # reader must default them rather than require them.
        block["cache_read_tokens"] = cache_read
        block["cache_write_tokens"] = cache_write
        block["context_pct"] = context_pct
        block["latency_ms"] = latency_ms
        # Left out entirely when unpriced rather than written as 0.0 — same
        # reason the tokens above are read off a default: a reader must be able
        # to tell "this step cost nothing" from "this step cannot be priced".
        if cost_usd is not None:
            block["cost_usd"] = cost_usd
        t["model"] = block
        totals = self._doc["totals"]
        totals["tokens_in"] += tokens_in
        totals["tokens_out"] += tokens_out
        # A document written before these keys existed is still resumable, so
        # they are accumulated off a default rather than read directly.
        totals["cache_read_tokens"] = totals.get("cache_read_tokens", 0) + cache_read
        totals["cache_write_tokens"] = totals.get("cache_write_tokens", 0) + cache_write
        if cost_usd is not None:
            totals["cost_usd"] = totals.get("cost_usd", 0.0) + cost_usd

    def record_prompt(self, turn: int, *, kind: str, action: str, args: dict,
                      domain: str | None, reason: str) -> str:
        pid = self._record(self._record_prompt, turn, kind=kind, action=action,
                           args=args, domain=domain, reason=reason)
        return pid or ""

    def _record_prompt(self, turn: int, *, kind: str, action: str, args: dict,
                       domain: str | None, reason: str) -> str:
        t = self._turn(turn)
        if t is None:
            return ""
        prompt = {
            "id": secrets.token_hex(8),
            "seq": self._next_seq(),
            "kind": kind,
            # "pending" until resolve_prompt. A socket that dies between
            # raising and answering leaves it pending, which is not the
            # same thing as denied and must never read as denied.
            "status": "pending",
            "raised_at": _now(),
            "answered_at": None,
            "wait_ms": None,
            "action": action,
            "args": _cap_deep(args),
            "domain": domain,
        }
        _text(prompt, "reason", reason)
        prompt["decision"] = None
        prompt["response"] = None
        t["prompts"].append(prompt)
        self._prompt_index[prompt["id"]] = (turn, prompt)
        self._doc["totals"]["prompts"] += 1
        return prompt["id"]

    def resolve_prompt(self, prompt_id: str, *, decision: str, response: str,
                       wait_ms: int) -> None:
        self._record(self._resolve_prompt, prompt_id, decision=decision,
                     response=response, wait_ms=wait_ms)

    def _resolve_prompt(self, prompt_id: str, *, decision: str,
                        response: str, wait_ms: int) -> None:
        found = self._prompt_index.get(prompt_id)
        if found is None:
            # Not an error: the document may be a partial replay, and a
            # prompt answered in a previous run is not resolvable again.
            return
        _, prompt = found
        prompt["status"] = "answered"
        prompt["answered_at"] = _now()
        prompt["wait_ms"] = wait_ms
        prompt["decision"] = decision
        _text(prompt, "response", response)

    def record_action(self, turn: int, *, action: str, args: dict,
                      outcome: str, ok: bool, redacted: bool,
                      duration_ms: int) -> None:
        self._record(self._record_action, turn, action=action, args=args,
                     outcome=outcome, ok=ok, redacted=redacted,
                     duration_ms=duration_ms)

    def _record_action(self, turn: int, *, action: str, args: dict,
                       outcome: str, ok: bool, redacted: bool,
                       duration_ms: int) -> None:
        t = self._turn(turn)
        if t is None:
            return
        ended = _now()
        entry: dict = {"action": action, "args": _cap_deep(args)}
        _text(entry, "outcome", outcome)
        entry["ok"] = ok
        # The end timestamp is derived, not slept for: the harness already
        # measured the action, and an audit call must not add wall time.
        entry["started_at"] = ended
        entry["ended_at"] = ended
        entry["duration_ms"] = duration_ms
        entry["redacted"] = redacted
        t["actions"].append(entry)
        self._doc["totals"]["actions"] += 1

    def end_turn(self, turn: int, *, timings: dict) -> None:
        self._record(self._end_turn, turn, timings=timings)

    def _end_turn(self, turn: int, *, timings: dict) -> None:
        t = self._turn(turn)
        if t is None:
            return
        t["ended_at"] = _now()
        t["timings"] = _cap_deep(timings)

    # ── flat events ─────────────────────────────────────────────
    def record_policy(self, *, step: int, kind: str, domain: str | None,
                      action: str | None, decision: str,
                      user_decision: str | None = None) -> None:
        self._record(self._record_policy, step=step, kind=kind, domain=domain,
                     action=action, decision=decision,
                     user_decision=user_decision)

    def _record_policy(self, *, step: int, kind: str, domain: str | None,
                       action: str | None, decision: str,
                       user_decision: str | None = None) -> None:
        self._doc["policy_events"].append({
            "seq": self._next_seq(),
            "at": _now(),
            "step": step,
            "kind": kind,
            "domain": domain,
            "action": action,
            "decision": decision,
            "user_decision": user_decision,
        })

    def record_error(self, *, code: str, where: str, message: str,
                     detail: dict | None = None) -> str:
        eid = self._record(self._record_error, code=code, where=where,
                           message=message, detail=detail)
        return eid or ""

    def _record_error(self, *, code: str, where: str, message: str,
                      detail: dict | None = None) -> str:
        eid = new_error_id()
        entry: dict = {
            "seq": self._next_seq(),
            "at": _now(),
            "error_id": eid,
            "code": code,
            "where": where,
        }
        _text(entry, "message", message)
        entry["detail"] = _cap_deep(detail or {})
        self._doc["errors"].append(entry)
        self._doc["totals"]["errors"] = len(self._doc["errors"])
        return eid

    # ── terminal ────────────────────────────────────────────────
    def set_scratchpad(self, scratchpad: Scratchpad | dict) -> None:
        self._record(self._set_scratchpad, scratchpad)

    def _set_scratchpad(self, scratchpad: Scratchpad | dict) -> None:
        self._doc["scratchpad"] = _scratchpad_dict(scratchpad)
        model = _as_scratchpad(scratchpad)
        if model is not None:
            save_scratchpad(self.scratchpad_path, model)

    def finish(self, result: dict) -> None:
        self._record(self._finish, result)

    def _finish(self, result: dict) -> None:
        self._doc["result"] = _cap_deep(result)
        status = result.get("status")
        if status:
            self._doc["status"] = status
            # `begin_task` is the only other writer of `tasks[].status`, so
            # without this every finished task still reads "running" and the
            # history list cannot tell one from a run that was abandoned.
            self._seal_task(self._task_index, status)
        wall = (result.get("timing") or {}).get("wall_s")
        if wall is not None:
            try:
                self._doc["totals"]["wall_s"] = float(wall)
            except (TypeError, ValueError):
                pass


def _is_document_stem(name: str) -> bool:
    """Whether `name` is a session id rather than a path or a sidecar.

    Session ids are UUIDs, so the only legal shape is a single
    dot-free, path-free token. Rejecting everything else is what keeps
    `<id>.pages` and `../../secrets` off the filesystem.
    """
    return bool(name) and name == Path(name).name and "." not in name


# The audit document itself, and then everything a session owns beside it.
# `delete` builds `<stem><ext>` per session; `delete_all` sweeps `*<ext>` for
# the residue whose document is already gone. One list, because these two have
# to agree and have not before: a sidecar named in `delete` but not swept by
# `delete_all` is stranded on the user's disk by exactly the action that
# promises to erase it, and the panel says it was erased. `*.pages.json` is
# the shape that bit — 76KB of real Gmail text beside a document someone
# removed by hand. `*.scratchpad.txt` is the one current builds still write.
_DOCUMENT_EXT = ".json"
_SESSION_RESIDUE_EXT: tuple[str, ...] = (
    ".json.tmp",
    ".scratchpad.txt",
    ".pages.json",
)


def read(session_id: str, *, dir: Path | None = None) -> dict:
    """Read one document. Never raises: a damaged file is reported.

    `session_id` comes off an unauthenticated HTTP path, so it is treated as
    untrusted. A sidecar lives beside the document as `<id>.pages.json` (full
    page text) and `<id>.scratchpad.txt`; without this guard
    `GET /v1/sessions/<id>.pages/audit` reads the first one straight off disk
    and `../../..` walks out of the directory entirely.
    """
    d = dir or default_dir()
    p = d / f"{session_id}.json" if _is_document_stem(session_id) else None
    # CodeQL cannot see that the ternary above already rejected every name
    # containing a separator or a dot, which is the whole defence. The three
    # `codeql[py/path-injection]` comments below mark the sinks it still
    # reports; they are a record of a decision, not a silence.
    if p is None or not p.exists():  # codeql[py/path-injection]
        return {"found": False, "session_id": session_id}
    try:
        doc = json.loads(p.read_text())  # codeql[py/path-injection]
        doc.setdefault("found", True)
        return doc
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("audit: %s unreadable: %s", p, exc)
        # str(OSError) is the absolute path of the file that failed to open,
        # and this document is served over HTTP by /v1/sessions/{id}/audit —
        # so it hands the caller the server's directory layout. A parse
        # failure names a line and column inside the user's own file, helps
        # them repair it and says nothing about the host, so that one keeps
        # its text.
        detail = (str(exc) if isinstance(exc, json.JSONDecodeError)
                  else "the file could not be read")
        return {"found": True, "corrupt": True, "schema_version": SCHEMA_VERSION,
                "session_id": session_id, "status": "corrupt", "turns": [],
                "errors": [{"code": "audit_unreadable", "message": detail}],
                "totals": {"turns": 0, "steps": 0, "prompts": 0, "actions": 0,
                           "tokens_in": 0, "tokens_out": 0, "errors": 1}}


def delete(session_id: str, *, dir: Path | None = None) -> bool:
    """Remove one session's files. Returns whether anything was there.

    A session is only deleted when *all* of it is gone. Leaving the
    scratchpad behind would leave page digests on disk for a session the
    user believes they erased, and leaving the live trail in `_LIVE` is
    worse: the running loop rewrites the whole document on its next
    flush, so the "deleted" session reappears in the history list.
    """
    if not _is_document_stem(session_id):
        return False
    d = dir or default_dir()
    removed = False
    for name in (f"{session_id}{ext}" for ext in (_DOCUMENT_EXT, *_SESSION_RESIDUE_EXT)):
        # pages.json has no writer — page text stopped reaching disk — but
        # `read` and `list_sessions` already name it, and a sidecar written
        # by an older build is still on the user's disk.
        # The .tmp is the atomic write's staging file, so it holds a whole
        # document whenever a write was interrupted between the two steps.
        # `list_sessions` globs `*.json` and would never show it, which is
        # exactly why it has to be named here rather than swept: the user
        # is told the session is erased, and this would be what is left.
        try:
            # codeql[py/path-injection]
            # Same guard as `read`, one line above the loop: a session id with
            # a separator or a dot never reaches here.
            (d / name).unlink()
            removed = True
        except FileNotFoundError:
            pass
        except OSError as exc:
            log.warning("audit: could not remove %s/%s: %s", d, name, exc)
    with _LIVE_LOCK:
        live = _LIVE.pop(session_id, None)
    if live is not None:
        live._deleted = True
    return removed


def delete_all(*, dir: Path | None = None) -> tuple[int, int]:
    """Remove every session's files. Returns `(documents, residue_left)`.

    The second number is the count of files that could not be removed — held
    open, or owned by another user. It is part of the return because the
    alternative is a caller announcing a complete erasure it did not
    perform, and the only thing standing between that and the user is a log
    line they will not read.
    """
    d = dir or default_dir()
    count = sum(1 for p in _session_documents(d) if delete(p.stem, dir=d))
    # Residue whose document is already gone belongs to no session as far as
    # `_session_documents` is concerned — it globs `*.json` — so the loop
    # above never reaches it. Whatever is left here is a user's own content on
    # their disk that nothing in the product will ever list or remove: the
    # residue of an interrupted write, or a sidecar whose document someone
    # deleted by hand.
    #
    # Failures are counted and returned, not swallowed. A file held open or
    # owned by another user stays put, and the caller answers "everything
    # deleted" — so the user is told their mail is erased and it is not.
    residue = 0
    for ext in _SESSION_RESIDUE_EXT:
        for p in d.glob(f"*{ext}"):
            try:
                p.unlink()
            except OSError as exc:
                residue += 1
                log.error("audit: could not remove %s: %s", p, exc)
    if residue:
        log.error(
            "audit: delete_all left %d file(s) on disk — the erasure is "
            "incomplete and the caller must say so", residue,
        )
    return count, residue


def prune_older_than(days: float, *, dir: Path | None = None) -> int:
    """Remove sessions untouched for longer than `days`. Returns the count.

    Age is the document's own mtime, which the atomic rewrite bumps on every
    step — so this measures "last activity", not "when it started", and an
    abandoned run still ages out.

    A session with a live trail is never pruned regardless of its age. A run
    that has been going for a month is not stale, and `delete()` marking it
    deleted would silently discard the turns it is still producing.
    """
    d = dir or default_dir()
    cutoff = time.time() - days * 86400
    with _LIVE_LOCK:
        live = set(_LIVE)
    pruned = 0
    for p in _session_documents(d):
        if p.stem in live:
            continue
        try:
            if p.stat().st_mtime >= cutoff:
                continue
        except OSError:
            continue
        if delete(p.stem, dir=d):
            pruned += 1
    return pruned


def _session_documents(d: Path) -> list[Path]:
    """Every session document on disk, newest first, sidecars excluded."""
    try:
        files = sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return []
    return [p for p in files if _is_document_stem(p.stem)]


def list_sessions(*, dir: Path | None = None) -> list[dict]:
    """Index of every session on disk, newest first."""
    d = dir or default_dir()
    out = []
    # `<id>.pages.json` matches the glob and would otherwise be listed —
    # and readable — as if it were a session. `_session_documents` filters.
    for p in _session_documents(d):
        doc = read(p.stem, dir=d)
        out.append({
            "session_id": doc.get("session_id", p.stem),
            "title": doc.get("title") or doc.get("goal", ""),
            "task_count": len(doc.get("tasks") or []) or 1,
            "task": doc.get("title") or doc.get("goal", ""),
            "status": doc.get("status", "unknown"),
            "steps": doc.get("totals", {}).get("steps", 0),
            "started_at": doc.get("created_at"),
            "corrupt": bool(doc.get("corrupt")),
        })
    return out


def append_policy_event(session_id: str, *, step: int | None, kind: str,
                        domain: str | None, action: str | None,
                        decision: str,
                        user_decision: str | None = None) -> None:
    """Record a policy decision that belongs to no turn, from outside the loop.

    Replaces `run_logger.append_policy_event`, which the panel's Save and
    `/v1/policy_ack` handlers call mid-task. A running session is written
    through the live instance so the loop's own flush is the only writer.
    A finished one is read-modify-written in place. An unknown session is
    not created — an ack for a run that never happened is not worth a file.

    Never raises: the callers sit in HTTP handlers, and losing a policy
    audit row is not worth failing a settings save over.
    """
    try:
        with _LIVE_LOCK:
            live = _LIVE.get(session_id)
        if live is not None:
            live.record_policy(step=step, kind=kind, domain=domain,
                               action=action, decision=decision,
                               user_decision=user_decision)
            return

        # Same guard `read` and `delete` carry, and for the same reason. It
        # was missing here, which made this the one sink in the module that
        # would open a caller-supplied name: `exists()` only guards a file
        # that is already there, so `../../..` read-modify-wrote whatever
        # JSON happened to sit above the sessions directory.
        if not _is_document_stem(session_id):
            return
        # codeql[py/path-injection]
        # Same guard `read` and `delete` carry, three lines above: it rejects
        # every name containing a separator or a dot, so a `session_id` that
        # gets past it can only name a file inside `default_dir()`. CodeQL
        # sees the sink, not the predicate that decides it — and it does not
        # model that the predicate's failure returns from the function.
        path = default_dir() / f"{session_id}.json"
        if not path.exists():
            log.debug("audit: policy event for unknown session %s ignored",
                      session_id)
            return
        doc = json.loads(path.read_text())  # codeql[py/path-injection]
        doc.setdefault("policy_events", []).append({
            "seq": len(doc.get("turns", [])) + len(doc["policy_events"]) + 1,
            "at": _now(),
            "step": step,
            "kind": kind,
            "domain": domain,
            "action": action,
            "decision": decision,
            "user_decision": user_decision,
        })
        doc["updated_at"] = _now()
        tmp = path.with_suffix(".json.tmp")
        with tmp.open("w") as fp:
            json.dump(doc, fp, ensure_ascii=False, default=str)  # codeql[py/path-injection]
        os.replace(tmp, path)  # codeql[py/path-injection]
    except Exception as exc:
        log.warning("audit: policy event for %s dropped: %s",
                    session_id, type(exc).__name__)
