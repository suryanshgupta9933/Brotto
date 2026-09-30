"""Agent harness: observe → plan → act loop with guardrails."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Callable, Coroutine, Any

import logging

# Falls back to ANTHROPIC_AUTH_TOKEN so Claude Code-style setups (Token Plan
# / proxy auth) work without a second env var. pydantic-ai's AnthropicModel
# only reads ANTHROPIC_API_KEY, so we propagate before Agent construction.
if not os.getenv("ANTHROPIC_API_KEY") and os.getenv("ANTHROPIC_AUTH_TOKEN"):
    os.environ["ANTHROPIC_API_KEY"] = os.environ["ANTHROPIC_AUTH_TOKEN"]

from pydantic_ai import Agent
from pydantic_ai.exceptions import (
    UserError, ModelHTTPError, ModelRetry, UnexpectedModelBehavior,
)

from brotto_orchestrator.model.config import UserCredentials
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY
from brotto_orchestrator.model.resolver import resolve_model_config

from .context import (
    AgentDeps, AgentDecision, AgentTurn, ActionCall,
    StepSummary, TaskResult, Scratchpad, MemoryEntry, DIGEST_LEN,
    ScriptTargetUnresolved,
)
from .ax_filter import budget_for_window, filter_ax_targets
from .ax_diff import compute_ax_diff
from .guardrails import check_login_page, check_critical_action, check_sensitive_action
from ..policy.gate import GateDecision, check_domain_policy, check_first_time_seen
from ..policy.domains import etld1
from .prompt import SYSTEM_PROMPT, secure_mode_preamble
from .audit import (
    SCHEMA_VERSION, AuditTrail, REDACTED, is_secret_field, load_scratchpad, read,
)

_HISTORY_WINDOW = 12  # keep first 3 + last 9 steps in prompt

# Per-action approval prompt reasons, surfaced to the user via WS
# `reasoning` and to policy.log for audit.
#
# {action} is the human label from _ACTION_LABEL, never the tool name.
_REASON_FIRST_TIME = "First time on {domain}: the agent wants to {action}. Continue?"
# {thought} is the model's `thought` field, which the system prompt already
# contracts as one sentence of user-facing plain English. `reasoning` must
# NOT be used here — the prompt marks it "NEVER shown to the user", and an
# approval card is exactly that.
_REASON_CRITICAL = "{thought} This can't be undone from here — continue?"

# ponytail: every user-facing prompt in the harness routes through
# `_ask_user` (or its `_ask_user_text` variant) so the "deny → abort task"
# contract and the audit row are enforced exactly once. Without this,
# every prompt site carries its own bookkeeping for setting deps.result +
# audit + return — easy to forget one and ship a partial fix.

# Actions that don't fire a UI bubble. Scratchpad mutations and recall are
# metadata — the user sees the thought, not the write/recall itself.
_INTERNAL_ACTIONS = {
    "write_scratchpad", "append_scratchpad", "read_scratchpad",
    "recall_memory",
}
# Actions that short-circuit the rest of the multi-action list.
_TERMINAL_ACTIONS = {"task_complete", "cannot_complete"}

_ESCAPES = {"n": "\n", "t": "\t", "r": "\r"}


def _unescape(text: str) -> str:
    """Turn literal backslash-escapes in model prose into real characters.

    MiniMax-M3 double-escapes: it writes `\\n` inside a JSON string argument,
    so the value decodes to a backslash followed by 'n' rather than a newline.
    Measured on a completed job-alerts run — the task_complete summary and an
    append_scratchpad line both arrived holding literal escapes, and the panel
    rendered them verbatim as one wall of text. The thoughts on those same turns
    were clean, so this is the model writing JSON-shaped prose inside a string
    it was already inside.

    Fixed here rather than in the panel because the damage is not only visual:
    append_scratchpad feeds the agent's own memory, so a later step reading its
    notes back sees the escapes too.
    """
    if "\\" not in text:
        return text
    out: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] in _ESCAPES:
            out.append(_ESCAPES[text[i + 1]])
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)
# ponytail: ask_human is metadata too — it pauses for user input but the
# user is not "approving" an agent action, they're answering a question.
# Card UI is different (no Approve/Deny buttons).
_QUESTION_ACTIONS = {"ask_human"}
# Combined set: actions that should NEVER appear inside an approval card
# (terminal + internal + question). Every card-emitting loop filters on this
# before deciding whether to prompt — the internal four are the reason: their
# args are model-written prose, and check_critical_action regexes those, so a
# note reading "...to confirm star counts" tripped the gate on the word
# "confirm". See tests/test_agent_e2e.py.
_NEVER_APPROVE = _TERMINAL_ACTIONS | _INTERNAL_ACTIONS | _QUESTION_ACTIONS

# What the user sees in the card instead of the tool name. "click" and
# "type_text" are developer-facing; these are the only action names that can
# reach a card, and every one of them is a thing a person recognises doing.
_ACTION_LABEL = {
    "navigate": "open a page",
    "click": "click something on the page",
    "type_text": "type into a field",
    "scroll": "scroll the page",
    "find_element": "look up an element",
    "read_page_text": "read text off the page",
}


def _card_label(action: str, action_args: dict) -> str:
    """Human phrasing for an approval card. Prefers what the model wrote
    about the target (a click's `description`) over the generic verb."""
    return str(action_args.get("description") or _ACTION_LABEL.get(action, "do something"))

# ponytail: after the user clicks Approve on a policy/approval card, they
# have REVOKE_WINDOW_SECS to change their mind by sending human_reply
# "revoke". Subsequent steps on the same domain/action will re-prompt.
REVOKE_WINDOW_SECS = 5.0

log = logging.getLogger("brotto.harness")

# Component-timing buckets. Each step records how long each phase took.
# Reported at task end so we can see where wall time actually goes.
# `human_pause` (aggregate of all queue waits) is reported but EXCLUDED
# from `wall` — wall is "agent thinking" time only. Operators who want
# total elapsed time can read `total_elapsed` separately.
TIMING_BUCKETS = (
    "observe",          # CDP observation round-trip (get_targets/url/title)
    "filter",           # AX filter + diff computation
    "login_pause",      # ws_send(login_required) + queue wait for resume
    "model_plan",       # agent.run — the LLM call
    "approval_pause",   # CRITICAL_PATTERNS approval + queue wait
    "execute",          # _execute_actions (CDP actions + post-obs)
    "ws_send_progress", # step_progress notifications
)
# Subset of TIMING_BUCKETS that are pure human-wait — excluded from `wall`.
_HUMAN_PAUSE_BUCKETS = frozenset({"login_pause", "approval_pause"})

_MODEL = os.getenv("AGENT_MODEL", "no-model")
# Placeholder model id used to construct the module-level Agent object.
# defer_model_check=True defers validation; the real model is selected per
# task via resolve_model_config(deps) and passed to agent.run(model=...).
_PLACEHOLDER_MODEL = os.getenv("AGENT_MODEL", "anthropic:MiniMax-M3")
# Context window size (tokens) used for the side panel's CONTEXT cell
# (% of context used). Override per model in .env. Defaults to 400k.
_CONTEXT_WINDOW_TOKENS = int(os.getenv("CONTEXT_WINDOW_TOKENS", "400000"))

# User replies that approve a pending action (login, approval, policy gate).
APPROVE_SET = frozenset({"yes", "y", "approve", "ok", "confirm"})

# ponytail: _turn_to_prompt needs access to deps (for the secure-mode
# preamble). The harness loop sets `_CURRENT_DEPS` before each agent call;
# tests set `_TEST_DEPS` for the same purpose. Module globals are the
# smallest change that avoids changing the prompt's call signature.
_CURRENT_DEPS: AgentDeps | None = None
_TEST_DEPS: AgentDeps | None = None


def _build_context(tokens: int | None, window: int | None = None) -> dict:
    """Build the context payload the side panel renders.

    The cell shows `pct` (and tooltip `tokens` / `window`) — all math
    lives here so the frontend is a dumb display. `tokens` may be None
    when the model hasn't been called yet (e.g. before step 1); we
    return null pct so the cell shows "0%" via the frontend's
    null-tokens branch.

    `window` is the per-task context_window (resolved via ModelConfig).
    When None, falls back to the env var default. The fallback reads
    os.getenv fresh (not the module-level capture) so monkeypatch-based
    tests can vary it per test.
    """
    if window is None:
        window = int(os.getenv("CONTEXT_WINDOW_TOKENS", "400000"))
    if tokens is None or tokens < 0:
        return {"tokens": None, "window": window, "pct": None}
    pct = round((tokens / window) * 100, 1) if window else 0
    return {"tokens": tokens, "window": window, "pct": pct}


def _build_agent() -> Agent[AgentDeps, AgentDecision]:
    # Placeholder model id; defer_model_check=True means it's not validated
    # at construction. The real per-task model is selected via
    # resolve_model_config(deps) and passed to agent.run(model=...).
    return Agent(
        _PLACEHOLDER_MODEL,
        output_type=AgentDecision,
        deps_type=AgentDeps,
        system_prompt=SYSTEM_PROMPT,
        retries=2,
        defer_model_check=True,
    )


agent = _build_agent()


@agent.output_validator
def _require_actions(ctx, decision: AgentDecision) -> AgentDecision:
    """Re-ask when the model returns a decision with nothing in it.

    Measured against MiniMax-M3: it frequently concludes a step and then
    emits `final_result` carrying `reasoning` and `thought` with no
    `actions` key at all. `actions` used to be required, so pydantic-ai
    rejected the call before this validator could run and used pydantic's
    own error as the retry prompt —
    `[{'type': 'missing', 'loc': ('actions',), 'msg': 'Field required'}]`
    — which the model repeated verbatim on all three attempts, until the
    run died with "Exceeded maximum output retries (2)".

    The retry budget is still the backstop: raising ModelRetry spends one
    of `retries=2`, so a model that ignores the instruction three times
    still ends the run rather than spinning. What changes is that the
    model is told what to emit instead of being handed a schema diff.
    """
    if not decision.actions:
        raise ModelRetry(
            "Your decision had no actions, so there is nothing to do. Every "
            "decision needs an `actions` list with at least one entry. If you "
            "have finished the task, send "
            "actions=[{'action': 'task_complete', 'action_args': {'summary': "
            "<your answer>}}]. If you are blocked, use 'ask_human' or "
            "'cannot_complete'. Otherwise send the action you meant to take, "
            "e.g. actions=[{'action': 'read_page_text', 'action_args': {}}]."
        )
    return decision


def _failure_detail(exc: BaseException, limit: int = 500) -> str:
    """Flatten an exception's cause chain into one recorded string.

    `str(exc)` on the failure this exists for is literally "Exceeded
    maximum output retries (2)" — it names neither the model, the field,
    nor the fix, and the cause chain is the only place that does. The
    chain is walked rather than `exc.__cause__` alone read, because
    pydantic-ai wraps the specific complaint (a validation error, a
    ToolRetryError) one or two levels down.
    """
    parts: list[str] = []
    cur: BaseException | None = exc
    seen: set[int] = set()
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        parts.append(f"{type(cur).__name__}: {cur}")
        cur = cur.__cause__
    return " <- ".join(parts)[:limit]


# A conversation message is a whole exchange, not one step's summary, so its
# window is much smaller than _HISTORY_WINDOW. The goal is for the model to
# remember how this started and what just happened, not to re-read the log.
_CONV_HEAD = 2
_CONV_TAIL = 6
# Per message, in the prompt only. The audit already caps what it stores, but
# a `task_complete` summary is the model's own long-form answer and can be
# several thousand characters — and the harness is stateless per step, so this
# block is re-sent on EVERY step of the follow-up task, not once. Eight
# messages at this cap is a standing ~9K chars, which is what a step should
# pay to remember a conversation; without it one deep-dive answer is re-uploaded
# on every action for the rest of the task.
_CONV_MSG_CHARS = 1200
# Ceiling on one `recall_conversation` result. The whole point of the action
# is to reach a message the window dropped, not to become a way around the
# window — a fetch is still one step's prompt, and an unbounded one would be
# the largest thing in it.
_CONV_RECALL_CHARS = 8000


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
        content = str(m.get("content", ""))
        if len(content) > _CONV_MSG_CHARS:
            # Head AND tail, the same shape `step_summaries` is windowed with.
            # A long answer puts its method in the first paragraph and its
            # findings in the last, and a follow-up is asked about the
            # findings — head-only truncation would keep the preamble and
            # drop the answer, which is the worst of both ends. The full text
            # is never lost: recall_conversation fetches it by id.
            head = _CONV_MSG_CHARS // 2
            content = (content[:head] + " …[truncated, "
                       + str(len(content) - _CONV_MSG_CHARS)
                       + " chars — recall_conversation('"
                       + str(m.get("id", "?")) + "') for the full text]… "
                       + content[-(head - 1):])
        lines.append(f"{who}: {content}")
    if skipped:
        # Named, not silent, and addressable. A model told a turn was dropped
        # and not told how many will assume the gap is small; a model told it
        # was dropped but given no way back to the text will assume the
        # answer is unavailable rather than go looking for it.
        gap = earlier[_CONV_HEAD:len(earlier) - _CONV_TAIL]
        lines.insert(_CONV_HEAD, (
            f"... {skipped} earlier messages omitted "
            f"({gap[0].get('id')}–{gap[-1].get('id')}) — "
            "recall_conversation(from_id, to_id) to fetch any ..."))
    return ("\n## This conversation so far\n"
            + "\n".join(lines) + "\n")


def _turn_to_prompt(turn: AgentTurn) -> str:
    summaries = turn.step_summaries
    if len(summaries) > _HISTORY_WINDOW:
        shown = summaries[:3] + summaries[-(_HISTORY_WINDOW - 3):]
        skipped = len(summaries) - _HISTORY_WINDOW
    else:
        shown = summaries
        skipped = 0

    history_lines = [
        f"Step {s.step} | {s.url} | {s.action_taken} → {s.outcome}"
        + (f" [extracted: {s.extracted}]" if s.extracted else "")
        for s in shown
    ]
    if skipped:
        gap = summaries[3:len(summaries) - (_HISTORY_WINDOW - 3)]
        # Names WHICH steps, not just how many: "…steps omitted" gave the
        # model nothing to act on, and a model told a step is gone with no
        # way to read it concludes the answer is unavailable.
        history_lines.insert(3, (
            f"  ... {skipped} steps omitted (steps "
            f"{gap[0].step}–{gap[-1].step}) — recall_steps(from, to) "
            f"to fetch any ..."))
    history = "\n".join(history_lines) or "(none yet)"

    diff_section = f"\n### What changed after last action\n{turn.ax_diff}\n" if turn.ax_diff else ""

    # Placed after the tree, before the question: it is the last thing read,
    # and the values it carries (counts, prices, totals) are exactly what a
    # read-only question is answered from.
    text_section = (
        f"\n### Page text (values the tree above may not carry)\n"
        f"<page_text untrusted url=\"{turn.current_url}\">\n{turn.page_text}\n</page_text>\n"
        if turn.page_text
        else ""
    )

    # ponytail: steering goes last, immediately before the question. Position
    # is not cosmetic — the AX tree above is thousands of tokens and drowns
    # anything placed earlier, so an update the user typed five seconds ago
    # would land behind it and be missed.
    steer_section = (
        f"\n## User update (supersedes earlier intent)\n{turn.steering}\n"
        if turn.steering else ""
    )

    # ponytail: secure-mode preamble is injected here, not at Agent
    # construction, so we don't need to rebuild the Agent per-task. The
    # test-helper reads `_TEST_DEPS` (a module global); the harness loop
    # sets `_CURRENT_DEPS` before each call.
    deps = _CURRENT_DEPS or _TEST_DEPS
    secure_prefix = ""
    if deps is not None and getattr(deps.policy, "mode", None) == "secure":
        secure_prefix = secure_mode_preamble(deps.policy) + "\n\n"

    conv_section = ""
    if deps is not None:
        conv_section = _conversation_block(
            getattr(deps, "conversation", []),
            current_task=getattr(deps, "task_index", 0),
        )

    # Memory manifest: small per-entry digest. Full bodies are loaded on
    # demand via recall_memory(id). This is the "skills" pattern — the
    # agent sees the description (digest) for free, fetches full content
    # only when it actually needs it.
    manifest_lines = ["### Memory manifest (recall_memory(id) fetches full body)"]
    for e in turn.scratchpad_entries:
        around = f" around={e.around!r}" if e.around else ""
        trunc = " [truncated]" if e.was_truncated else ""
        manifest_lines.append(f"- `{e.id}` step={e.step} sel={e.selector}{around}{trunc}: {e.digest}")
    manifest_section = "\n".join(manifest_lines) + "\n"

    return f"""{secure_prefix}{conv_section}## Task
{turn.task}

## Your memory (notes)
{turn.scratchpad_notes or "(empty — append_scratchpad(line) to add your own findings here)"}

## Memory manifest (auto-captured reads)
{manifest_section}

## Steps completed
{history}

## Current page (step {turn.step_number})
URL: {turn.current_url}
Title: {turn.current_page_title}
{diff_section}
### AX Tree (interactive elements only)
<page_content untrusted url="{turn.current_url}">
{turn.ax_tree}
</page_content>
{text_section}{steer_section}
## What is your next action(s)?
"""


# ── Task-abort helpers ──────────────────────────────────────────────────────
# Every user-prompt site routes through `_ask_user` below. On deny, the
# task is set up to terminate on the next loop boundary via
# `deps.result = TaskResult(...)`. The `run()` loop checks `deps.result`
# at the top of every iteration. This keeps the "deny → abort" contract
# in one place.


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


async def _ask_user_text(deps: AgentDeps, audit, *, turn: int, action: str,
                         args: dict, message: dict) -> str:
    """`ask_human` needs the reply itself, not a boolean, so it gets its
    own thin variant over the same two audit calls."""
    pid = audit.record_prompt(turn, kind="ask_human", action=action, args=args,
                              domain=None,
                              reason=str(args.get("question", "")))
    await deps.ws_send(message)
    t0 = time.perf_counter()
    reply = await deps.human_input_queue.get()
    audit.resolve_prompt(pid, decision="answered", response=str(reply),
                         wait_ms=int((time.perf_counter() - t0) * 1000))
    return str(reply)


async def _redact_if_secret(deps: AgentDeps, ref: str) -> bool:
    """Is this field a password? Never raises.

    Resolved here and not at extraction: one CDP round trip per TYPED
    ACTION is cheap, one per textbox per STEP is not, and this loop is
    latency-bound.

    A field we cannot classify is redacted, not written. `get_attributes`
    is best-effort by contract and returns {} on a dead relay, a
    disconnected extension or a target with no backend node; the
    accessible name is blank on some real login forms. If both signals
    are silent there is no way to tell a password box from an email box,
    and the two failure modes are not symmetric — over-redacting costs a
    replay that says "[redacted:password]", under-redacting costs a
    plaintext credential on disk forever.

    ponytail: this redacts every typed value on a relay too old to answer
    get_attributes. Upgrade path: a per-task "attributes unavailable"
    counter, so the audit can say "this run had no DOM visibility" instead
    of a field that looks deliberately masked.
    """
    target = next((t for t in deps.prev_targets if t.ref_id == ref), None)
    if target is None:
        return True
    attrs: object = {}
    getter = getattr(deps.cdp, "get_attributes", None)
    if getter is not None and getattr(target, "backend_node_id", None):
        try:
            attrs = await getter(target.backend_node_id)
        except Exception as exc:  # never raise: this runs mid-typing
            log.debug("attribute lookup failed for %s: %s", ref, exc)
            attrs = {}
    if not isinstance(attrs, dict) or not attrs:
        # No usable DOM signal — the accessible name is all that is left.
        return is_secret_field(None, target.name) or not (
            target.name or ""
        ).strip()
    return is_secret_field(attrs, target.name)


def _step_timings(timings: dict[str, float],
                  snapshots: list[dict[str, float]]) -> dict:
    """What this step cost: the cumulative buckets minus the snapshot taken
    at the top of it. Same answer from the bottom of the loop and from the
    top of the next one, so end_turn can be called at either."""
    if not snapshots:
        return {}
    base = snapshots[-1]
    return {k: round(timings[k] - base[k], 3) for k in TIMING_BUCKETS}


def _scrubbed(call: ActionCall, redact: bool) -> tuple[dict, str]:
    """(args, trace-fragment) with the typed value masked when redacting.

    The trace is built from the same dict, so scrubbing here covers the
    second write path — StepSummary.action_taken goes into the next
    step's prompt and into the resumed document.
    """
    if not redact or call.action != "type_text":
        return call.action_args, f"{call.action}({call.action_args})"
    text = call.action_args.get("text", "")
    args = {**call.action_args, "text": REDACTED, "text_chars": len(str(text))}
    return args, f"{call.action}({args})"


def _policy_mode(deps: AgentDeps | None) -> str | None:
    """Read the policy mode off deps, defensively. Used to tag TaskResult
    with the mode that was in force at the time of failure/completion."""
    if deps is None:
        return None
    return getattr(getattr(deps, "policy", None), "mode", None)


def _make_user_denied_result(step: int, domain: str | None, kind: str, deps: AgentDeps | None = None) -> TaskResult:
    return TaskResult(
        status="failed",
        summary=f"User denied {kind} approval" + (f" on {domain}" if domain else ""),
        failure_reason="user_denied",
        steps_taken=step + 1,
        policy_mode=_policy_mode(deps),
    )


def _make_policy_blocked_result(step: int, domain: str, deps: AgentDeps | None = None) -> TaskResult:
    return TaskResult(
        status="failed",
        summary=f"Blocked by policy: {domain}",
        failure_reason="policy_blocked",
        steps_taken=step + 1,
        policy_mode=_policy_mode(deps),
    )


def _make_model_not_found_result(provider: str, model_id: str, deps: AgentDeps | None = None) -> TaskResult:
    return TaskResult(
        status="failed",
        summary=f"Unknown model {provider}:{model_id}",
        failure_reason="model_not_found",
        policy_mode=_policy_mode(deps),
    )


def _make_auth_failed_result(provider: str, deps: AgentDeps | None = None) -> TaskResult:
    # ponytail: do NOT echo the key. The user can re-enter it in extension
    # settings; the failure bubble just names the provider.
    return TaskResult(
        status="failed",
        summary=f"Authentication failed for {provider}. Check the API key in extension settings.",
        failure_reason="auth_failed",
        policy_mode=_policy_mode(deps),
    )


def _make_bad_decision_result(provider: str, model_id: str,
                              deps: AgentDeps | None = None) -> TaskResult:
    """The model returned something that is not a valid AgentDecision.

    pydantic-ai retries the call and then gives up with
    UnexpectedModelBehavior. Unhandled, that propagated out of `run()`,
    so the document kept `status: running` with an open turn, the trail
    was never closed, and the panel got a bare "Exceeded maximum output
    retries (2)" naming neither the model nor what to do about it.
    """
    return TaskResult(
        status="failed",
        summary=(f"{provider}:{model_id} could not produce a valid action "
                 f"after 3 attempts. Try a different model, or rephrase the "
                 f"task."),
        failure_reason="invalid_decision",
        steps_taken=deps.step_number if deps else 0,
        policy_mode=_policy_mode(deps),
    )


def _looks_like_blacklist_hit(domain_pattern: str, free_text: str) -> bool:
    """Light heuristic for whether the agent's free-text reason mentions
    a blacklisted domain. Used to decide whether a `cannot_complete` in
    secure mode is a POLICY PREFLIGHT (agent declined upfront) vs a
    generic failure. Matches by substring — case-insensitive — so
    "mail.google.com" / "Mail.Google.com" / "gmail" all hit. The pattern
    is the raw blacklist entry (which the user typed); the text is the
    agent's reason. False positives are tolerable here (just makes the
    enterprise bubble render instead of the generic one).
    """
    if not domain_pattern or not free_text:
        return False
    pat = domain_pattern.strip().lower()
    txt = free_text.lower()
    # ponytail: also strip URL artefacts so the heuristic matches the
    # user's intended domain even if the agent quoted the full URL.
    # `https://mail.google.com/` → take the part AFTER `://`, then strip
    # path/query/port. Order matters: stripping `://` first would lose
    # the hostname.
    if "://" in pat:
        pat = pat.split("://", 1)[1]
    for sep in ("/", "?", "#", ":"):
        if sep in pat:
            pat = pat.split(sep, 1)[0]
    if not pat:
        return False
    return pat in txt or txt in pat


def _should_prompt_cross_domain_click(
    pre_url: str | None, post_url: str | None, deps: AgentDeps,
) -> tuple[bool, str | None]:
    """Pure-function decision: did this click hop to a new eTLD+1 the
    user hasn't already approved in this task? Returns (needs_prompt,
    target_etld1) — caller handles the wire I/O.

    Reuses `deps.visited_domains` (same set `navigate()` populates). A
    domain in that set means the user has already approved visiting it
    this task — no re-prompt whether the hop came from navigate or
    click. New eTLD+1 not in the set → prompt, approve will add it.

    Safe-defaults for unknown inputs (None, unparseable URLs): no
    prompt. Better to under-prompt than to crash the harness on weird
    CDP results; the next iteration's observe-phase block catches
    anything we missed here.
    """
    if deps.policy is None or getattr(deps.policy, "mode", None) != "secure":
        return (False, None)
    if not pre_url or not post_url:
        return (False, None)
    try:
        pre_etld = etld1(pre_url)
        post_etld = etld1(post_url)
    except Exception:
        return (False, None)
    if not pre_etld or not post_etld or pre_etld == post_etld:
        return (False, None)
    if post_etld in (deps.visited_domains or ()):
        return (False, None)
    return (True, post_etld)


def _guard_first_time_seen_blacklist(
    deps: AgentDeps, current_url: str, audit, step: int, action: str,
) -> bool:
    """Defense-in-depth: if the current URL is blacklisted, block immediately
    instead of letting the first-time-seen prompt fire.

    The observe-phase block at the top of the loop should already catch this,
    but if a future refactor breaks that ordering (or the blacklist is
    updated mid-task) we don't want to prompt the user to do something
    they're already blocked from doing.

    Returns True iff the page should be hard-blocked (caller sets
    `deps.result` + `break`s out of the actions loop).
    """
    if check_domain_policy(current_url, deps.policy) != GateDecision.BLOCK:
        return False
    domain = etld1(current_url) or current_url
    log.warning(
        "[%s] POLICY VIOLATION (defense-in-depth): first-time-seen suppressed  "
        "step=%d  url=%s  domain=%s  action=%s",
        deps.user_id, step, current_url, domain, action,
    )
    audit.record_policy(
        step=step, kind="domain_blocked", domain=domain,
        action=action, decision="block",
    )
    deps.result = _make_policy_blocked_result(step, domain, deps=deps)
    return True


def _first_time_key(
    domain: str, call: ActionCall, targets: list,
) -> tuple[str, str]:
    """The `(domain, action)` pair the first-time-seen prompt is keyed on.

    One case gets its own key. A target the extension supplemented is one the
    site marked `aria-hidden` — deliberately out of the accessibility tree, so
    a screen-reader user cannot reach it either. It is very often still visible
    and clickable, and for "delete the draft" it is exactly the control the
    user means, which is why we surface it at all. But the site put it there
    *on purpose*, and the approval the user already gave for ordinary clicks on
    this domain was given without knowing that.

    So a hidden target never rides an existing `(domain, action)` approval: it
    gets a distinct key, which means one extra prompt the first time a run
    touches a supplemented control on a domain, and none after that. The
    alternative — treating it like any other click — is the failure mode this
    whole task exists to prevent: a hidden "Delete account" button arriving at
    the user pre-approved because the model had clicked something else on the
    same site twenty steps earlier.
    """
    ref = call.action_args.get("ref")
    target = next((t for t in targets if t.ref_id == ref), None)
    if getattr(target, "hidden", False):
        return (domain, f"{call.action}:hidden")
    return (domain, call.action)


async def _execute_action(call: ActionCall, deps: AgentDeps, audit=None,
                          turn: int = -1) -> str:
    """Execute a single action. Returns outcome string."""
    cdp = deps.cdp
    action = call.action
    args = call.action_args

    try:
        if action == "navigate":
            # Pre-flight domain policy check (secure mode only). Re-validates
            # the URL the agent wants to visit against the blacklist before
            # sending it to CDP — catches the case where the agent proposes
            # a navigate-to-blacklisted-site mid-flow even though the
            # observe-phase check used the page's current URL. In secure
            # mode, blacklist match is a hard block (no user override).
            if deps.policy is not None and getattr(deps.policy, "mode", None) == "secure":
                target = args.get("url", "")
                decision = check_domain_policy(target, deps.policy)
                if decision == GateDecision.BLOCK:
                    domain = etld1(target) or target
                    log.warning(
                        "[%s] POLICY VIOLATION: navigate BLOCKED  url=%s  domain=%s",
                        deps.user_id, target, domain,
                    )
                    if audit is not None:
                        audit.record_policy(
                            step=deps.step_number, kind="navigate_blocked", domain=domain,
                            action="navigate", decision="block",
                        )
                    deps.result = _make_policy_blocked_result(deps.step_number, domain, deps=deps)
                    return f"[BLOCKED] policy: cannot navigate to {target}"
                # Confirm-before-navigate: first navigation to a new eTLD+1
                # this task prompts the user. Approve → add to set;
                # deny → abort task. Stops the agent from silently hopping
                # to sites the user hasn't vetted in this task.
                target_domain = etld1(target)
                if target_domain and target_domain not in deps.visited_domains:
                    log.warning(
                        "[%s] POLICY VIOLATION: first navigation to domain  step=%d  domain=%s  (prompting user)",
                        deps.user_id, deps.step_number, target_domain,
                    )
                    audit.record_policy(
                        step=deps.step_number, kind="first_navigation",
                        domain=target_domain, action="navigate",
                        decision="require_approval",
                    )
                    approved = await _ask_user(
                        deps, audit, turn=turn, kind="first_navigation",
                        action="_policy_navigation",
                        args={"url": target, "domain": target_domain},
                        domain=target_domain,
                        reason=(
                            f"First navigation to {target_domain} in this "
                            f"task. Continue?"
                        ),
                    )
                    if not approved:
                        log.warning(
                            "[%s] POLICY VIOLATION: user DENIED first navigation  step=%d  domain=%s",
                            deps.user_id, deps.step_number, target_domain,
                        )
                        audit.record_policy(
                            step=deps.step_number, kind="first_navigation",
                            domain=target_domain, action="navigate",
                            decision="require_approval",
                            user_decision="denied",
                        )
                        deps.result = _make_user_denied_result(
                            deps.step_number, domain=target_domain,
                            kind="first navigation", deps=deps,
                        )
                        return f"[BLOCKED] policy: user denied navigation to {target}"
                    deps.visited_domains.add(target_domain)
                    audit.record_policy(
                        step=deps.step_number, kind="first_navigation",
                        domain=target_domain, action="navigate",
                        decision="require_approval",
                        user_decision="approved",
                    )
            await cdp.navigate(args["url"])
            await cdp.wait_for_network_idle()
            await cdp.refresh_target_map()
            return f"Navigated to {args['url']}"

        elif action == "click":
            result = await cdp.click_ref(args["ref"])
            await asyncio.sleep(0.5)
            await cdp.refresh_target_map()
            # ponytail: post-click URL check. A click can navigate the
            # browser (e.g. clicking a Gmail link on google.com). The
            # observe-phase guard catches it on the NEXT iteration, but
            # that's one step too late — the user already approved the
            # click believing it was on the current domain. Re-check
            # synchronously here so a blacklisted redirect aborts in
            # the same step.
            if (deps.policy is not None
                    and getattr(deps.policy, "mode", None) == "secure"):
                post_url = await cdp.get_current_url()
                decision = check_domain_policy(post_url, deps.policy)
                if decision == GateDecision.BLOCK:
                    domain = etld1(post_url) or post_url
                    log.warning(
                        "[%s] POLICY VIOLATION: click navigated to blacklisted URL  url=%s  domain=%s",
                        deps.user_id, post_url, domain,
                    )
                    if audit is not None:
                        audit.record_policy(
                            step=deps.step_number, kind="click_blocked_post",
                            domain=domain, action="click", decision="block",
                        )
                    deps.result = _make_policy_blocked_result(deps.step_number, domain, deps=deps)
                    return f"[BLOCKED] policy: click navigated to {post_url}"
                # Cross-domain click gate (Change 3): a click that hopped
                # to a new eTLD+1 not yet visited this task needs user
                # approval. Reuses `visited_domains` — already populated
                # by navigate()'s first-time-nav prompt, so a click into
                # an already-approved domain doesn't re-prompt. Deny aborts
                # the task. Pure decision in `_should_prompt_cross_domain_click`
                # (unit-tested); this is the wire side.
                pre_url = getattr(deps, "step_url", None)
                needs_prompt, target_domain = _should_prompt_cross_domain_click(
                    pre_url, post_url, deps,
                )
                if needs_prompt and target_domain is not None:
                    log.warning(
                        "[%s] POLICY: cross-domain click  step=%d  pre=%s  post=%s  domain=%s",
                        deps.user_id, deps.step_number, pre_url, post_url, target_domain,
                    )
                    if audit is not None:
                        audit.record_policy(
                            step=deps.step_number, kind="click_cross_domain",
                            domain=target_domain, action="click",
                            decision="require_approval",
                        )
                    approved = await _ask_user(
                        deps, audit, turn=turn, kind="click_cross_domain",
                        action="_policy_cross_domain_click",
                        args={"from_url": pre_url, "to_url": post_url,
                              "target_domain": target_domain},
                        domain=target_domain,
                        reason=(
                            f"Click would navigate to {target_domain}, a different "
                            f"organisation than the current page. Continue?"
                        ),
                    )
                    if not approved:
                        log.warning(
                            "[%s] POLICY VIOLATION: user DENIED cross-domain click  step=%d  target=%s",
                            deps.user_id, deps.step_number, target_domain,
                        )
                        if audit is not None:
                            audit.record_policy(
                                step=deps.step_number, kind="click_cross_domain",
                                domain=target_domain, action="click",
                                decision="require_approval", user_decision="denied",
                            )
                        deps.result = _make_user_denied_result(
                            deps.step_number, domain=target_domain,
                            kind=f"cross-domain click to {target_domain}", deps=deps,
                        )
                        return f"[BLOCKED] policy: user denied cross-domain click to {target_domain}"
                    if audit is not None:
                        audit.record_policy(
                            step=deps.step_number, kind="click_cross_domain",
                            domain=target_domain, action="click",
                            decision="require_approval", user_decision="approved",
                        )
                    # Approve → cache so subsequent hops/clicks in this
                    # task to the same domain don't re-prompt.
                    deps.visited_domains.add(target_domain)
            return f"Clicked [{args['ref']}]: {result}"

        elif action == "type_text":
            await cdp.focus_ref(args["ref"])
            await cdp.clear_ref(args["ref"])
            result = await cdp.type_text_to_ref(args["ref"], args["text"])
            return f"Typed into [{args['ref']}]: {result}"

        elif action == "press_key":
            # modifiers is CDP's bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8).
            # A search box commits on Enter; without this the model could
            # type a query and never run it.
            key = args["key"]
            result = await cdp.press_key(key, args.get("modifiers", 0))
            return f"Pressed {key}: {result}"

        elif action == "scroll":
            direction = args.get("direction", "down")
            amount = args.get("amount", args.get("amount_px", 300))
            await cdp.scroll(direction, amount)
            await cdp.refresh_target_map()
            return f"Scrolled {direction}"

        elif action == "read_page_text":
            selector = args.get("selector", "body")
            max_chars = args.get("max_chars", 2000)
            around = args.get("around")
            text = await cdp.read_page_text(selector, max_chars=max_chars, around=around)
            # Heuristic: if the returned text is near the cap, the page was
            # bigger than we saw. The agent can use this to decide whether
            # to read again with `around` set.
            was_truncated = len(text) >= max_chars - 16
            # Auto-capture: every read lands in memory. Zero tokens. The
            # agent sees the manifest in the next step's prompt and can
            # recall this entry's full body via recall_memory(id).
            entry_id = f"r{len(deps.scratchpad.entries) + 1}"
            digest_body = text[:DIGEST_LEN]
            digest = digest_body + ("…" if len(text) > DIGEST_LEN else "")
            deps.scratchpad = deps.scratchpad.with_entry(MemoryEntry(
                id=entry_id,
                step=deps.step_number,
                selector=selector,
                around=around,
                digest=digest,
                body=text,
                was_truncated=was_truncated,
            ))
            around_note = f" around={around!r}" if around else ""
            return (
                f"read_page_text({selector!r}{around_note}, max_chars={max_chars}) "
                f"→ {len(text)} chars. Auto-captured as {entry_id} in memory. "
                f"Use recall_memory('{entry_id}') for full body."
            )

        elif action == "find_element":
            targets = await cdp.get_targets()
            desc = args.get("description", "").lower()
            # Search all targets including generic-role elements (e.g. score spans, badges)
            scored: list[tuple[int, object]] = []
            for t in targets:
                name_text = (t.name or "").lower()
                value_text = str(t.value or "").lower()
                combined = f"{t.role} {name_text} {value_text}"
                # Prioritise: all words present > any word present
                words = desc.split()
                all_match = all(w in combined for w in words)
                any_match = any(w in combined for w in words)
                if all_match:
                    scored.append((2, t))
                elif any_match:
                    scored.append((1, t))
            if scored:
                scored.sort(key=lambda x: -x[0])
                t = scored[0][1]
                return f"Found: [{t.ref_id}] {t.role} '{t.name}' value='{t.value}'"
            return f"Element matching '{desc}' not found in {len(targets)} targets"

        elif action == "append_scratchpad":
            deps.scratchpad = deps.scratchpad.append_note(_unescape(args.get("line", "")))
            return "Memory note appended"

        elif action == "write_scratchpad":
            deps.scratchpad = deps.scratchpad.write_notes(_unescape(args.get("content", "")))
            return "Memory notes rewritten"

        elif action == "read_scratchpad":
            # Returns the manifest + notes as a single blob so the agent
            # can see everything in one call. (recall_memory is the
            # token-efficient path — call this only when you need a
            # full dump.)
            lines = []
            if deps.scratchpad.entries:
                lines.append("### Memory manifest")
                for e in deps.scratchpad.entries:
                    lines.append(f"- `{e.id}` step={e.step}: {e.digest}")
            if deps.scratchpad.notes:
                lines.append("### Notes")
                lines.append(deps.scratchpad.notes)
            return "\n".join(lines) or "(empty)"

        elif action == "recall_memory":
            entry_id = args.get("entry_id", "")
            entry = deps.scratchpad.lookup(entry_id)
            if entry is None:
                available = [e.id for e in deps.scratchpad.entries]
                return f"Memory entry {entry_id!r} not found. Available: {available}"
            return entry.body

        elif action == "recall_conversation":
            # The window in `<conversation>` is head-2 + tail-6, so on a long
            # conversation most of it is omitted. Without a way back, the
            # model reads the omission as unavailability: the answer is not
            # there, so it either guesses or asks the user. This is the same
            # digest/body shape `recall_memory` already has for the
            # scratchpad — everything stays on the document, only a slice is
            # in the prompt.
            msgs = [m for m in deps.conversation if m.get("id")]
            lo = args.get("from_id") or args.get("message_id")
            hi = args.get("to_id") or lo
            ids = [m["id"] for m in msgs]
            if not lo or lo not in ids:
                return (f"Message {lo!r} not found. This conversation holds "
                        f"{len(ids)} earlier messages: {ids[0]}–{ids[-1]}."
                        if ids else
                        "No earlier messages to recall.")
            # min/max on indices, so a span reads the same either way round.
            # An unknown to_id falls to the end, which is how a model asks for
            # "from here to the end" without knowing where that is.
            at = {m["id"]: i for i, m in enumerate(msgs)}
            a, b = at[lo], at.get(hi, len(msgs) - 1)
            fetched = msgs[min(a, b):max(a, b) + 1]
            out = [f"{m['id']} {'User' if m.get('role') == 'user' else 'Assistant'}: "
                   f"{m.get('content', '')}" for m in fetched]
            text = "\n".join(out)
            # Same ceiling the prompt window uses, so a fetch cannot be a way
            # to smuggle an unbounded history into one step.
            if len(text) > _CONV_RECALL_CHARS:
                text = text[:_CONV_RECALL_CHARS] + "\n…[span too large, narrow it]"
            return text

        elif action == "recall_steps":
            # The other half of the step-summary window. A window is only
            # worth having if what it dropped can be fetched back.
            summaries = deps.step_summaries
            if not summaries:
                return "No steps recorded yet."
            lo = args.get("from_step", args.get("from"))
            hi = args.get("to_step", args.get("to", lo))
            lo = summaries[0].step if lo is None else int(lo)
            hi = lo if hi is None else int(hi)
            if lo > hi:
                lo, hi = hi, lo
            got = [s for s in summaries if lo <= s.step <= hi]
            if not got:
                return (f"No steps in range {lo}-{hi}. This task has steps "
                        f"{summaries[0].step}-{summaries[-1].step}.")
            text = "\n".join(
                f"Step {s.step} | {s.url} | {s.action_taken} → {s.outcome}"
                + (f" [extracted: {s.extracted}]" if s.extracted else "")
                for s in got)
            if len(text) > _CONV_RECALL_CHARS:
                text = text[:_CONV_RECALL_CHARS] + "\n…[range too large, narrow it]"
            return text

        elif action == "task_complete":
            deps.result = TaskResult(
                status="completed",
                summary=_unescape(args.get("summary", "")),
                extracted_data=args.get("extracted_data"),
                steps_taken=deps.step_number,
                policy_mode=_policy_mode(deps),
            )
            return "Task complete"

        elif action == "cannot_complete":
            reason = _unescape(args.get("reason", "") or "")
            tried = args.get("tried", [])
            # ponytail: in secure mode, if the agent declines upfront
            # (the preamble told it to), surface it as a POLICY PREFLIGHT
            # failure rather than a generic "cannot_complete". The
            # sidepanel uses this code to render the enterprise bubble.
            # Otherwise (normal mode, or unrelated failure), preserve
            # the existing behaviour — the agent's reason becomes
            # both summary and failure_reason verbatim.
            preflight = (
                getattr(deps.policy, "mode", None) == "secure"
                and any(_looks_like_blacklist_hit(d, reason) for d in (deps.policy.blacklist or []))
            )
            deps.result = TaskResult(
                status="failed",
                summary=reason or "Task could not be completed",
                failure_reason="policy_preflight" if preflight else (reason or None),
                tried=tried,
                steps_taken=deps.step_number,
                policy_mode=_policy_mode(deps),
            )
            # Audit row so the compliance trail shows the agent declined
            # upfront because of the org's policy, not because of any
            # network or runtime failure.
            if preflight and audit is not None:
                audit.record_policy(
                    step=deps.step_number, kind="agent_declined_preflight",
                    domain=None, action="cannot_complete",
                    decision="block", user_decision=None,
                )
            return "Marked as cannot complete"

        elif action == "ask_human":
            question = args.get("question", "")
            if audit is None:
                await deps.ws_send({"type": "ask_human", "question": question})
                return f"User replied: {await deps.human_input_queue.get()}"
            reply = await _ask_user_text(
                deps, audit, turn=turn, action="ask_human",
                args={"question": question},
                message={"type": "ask_human", "question": question},
            )
            return f"User replied: {reply}"

        else:
            return f"Unknown action: {action}"

    except Exception as e:
        return f"Error executing {action}: {e}"


def _scripted_decision(deps: AgentDeps, turn: AgentTurn) -> AgentDecision | None:
    """Return a scripted decision, or None to use the model as normal.

    Kept as a separate function so the branch is unit-testable without
    driving the full observe→plan→act loop.
    """
    planner = getattr(deps, "scripted_planner", None)
    if planner is None:
        return None
    return planner.next(turn)


def _resolve_model(deps: AgentDeps) -> tuple:
    """The per-task model config, resolved once per run.

    Two reasons this is not per step. The AX budget is read at the TOP of
    every step, before `_plan_step` has run for the first time, so a window
    set there is one step behind the tree it sizes: step 0 budgeted against
    `budget_for_window(None)`, which is the 6K MAX_CHARS floor, and step 1
    onward against the model's real window. On a dense page that is the step
    deciding what the task tries first, shown a tenth of what every later step
    sees. And the answer cannot change inside a run, so re-reading a file and
    the environment on every step is pure cost.
    """
    cached = getattr(deps, "_model_config", None)
    if cached is None:
        cached = resolve_model_config(
            client_ip=getattr(deps, "client_ip", "127.0.0.1"),
            inline_config=getattr(deps, "model_config", None),
            inline_creds=(
                UserCredentials(api_key=deps.api_key, base_url=None)
                if getattr(deps, "api_key", None)
                else None
            ),
        )
        deps._model_config = cached
    return cached


async def _plan_step(
    deps: AgentDeps, turn: AgentTurn, agent: Agent, audit=None
) -> tuple[AgentDecision, int, object] | None:
    """Return (decision, context_window, pydantic-ai result), or None to
    abandon the step.

    Extracted from AgentHarness.run so the branch — scripted planner vs
    model path vs error mapping — is unit-testable without driving the full
    observe→plan→act loop. None means "deps.result is set, loop continues";
    the timing bucket is deliberately not charged for those steps.
    """
    global _CURRENT_DEPS
    _CURRENT_DEPS = deps
    try:
        # Resolve model_config first so we have context_window for the
        # CONTEXT cell regardless of which branch below runs.
        # AGENT_MODEL="test" is a pydantic-ai sentinel for TestModel;
        # bypass the resolver's env-fallback (which would reject "test")
        # by reading the env var directly for context_window only.
        scripted = _scripted_decision(deps, turn)
        if scripted is not None:
            # Test/dev path: no model, no key, no network. result is
            # left None so the shared assignment below stays valid.
            context_window = _CONTEXT_WINDOW_TOKENS
            result = None
        elif os.getenv("AGENT_MODEL") == "test":
            context_window = _CONTEXT_WINDOW_TOKENS
            result = await agent.run(_turn_to_prompt(turn), deps=deps)
        else:
            cfg, creds = _resolve_model(deps)
            context_window = cfg.context_window
            factory = PROVIDER_REGISTRY[cfg.provider]
            if not factory.validate_model_id(cfg.model):
                raise UserError(
                    f"Unknown model {cfg.provider}:{cfg.model}"
                )
            _per_task_model = factory.build(cfg.model, creds)
            result = await agent.run(
                _turn_to_prompt(turn),
                deps=deps,
                model=_per_task_model,
                model_settings=factory.model_settings(cfg.model),
            )
        decision: AgentDecision = (
            scripted if scripted is not None else result.output
        )
        deps.context_window = context_window
    except ScriptTargetUnresolved as e:
        # A scripted ref that will not resolve means the target the
        # script asked for is not in the AX tree the agent sees —
        # that is the Wave 0 gap itself, not an infrastructure fault.
        # Catches only this type: a KeyError from the model path
        # (bad provider in PROVIDER_REGISTRY) is a production
        # misconfiguration, not a perception gap, and must propagate.
        deps.result = TaskResult(
            status="failed",
            summary=f"scripted target not found: {e}",
            failure_reason=f"scripted target did not resolve: {e}",
            policy_mode=_policy_mode(deps),
        )
        return None
    except UserError as e:
        # Convert "Unknown model" failures to a model_not_found
        # TaskResult. The next iteration's abort gate returns it.
        if "Unknown model" in str(e):
            deps.result = _make_model_not_found_result(
                provider=cfg.provider, model_id=cfg.model, deps=deps,
            )
            return None
        # pydantic-ai auto-detect failures on bare model names —
        # raise with a hint that names the fix without hard-coding.
        raise UserError(
            f"{e}. Set AGENT_MODEL to '<provider>:<model>' "
            f"to route to the correct provider."
        ) from e
    except ModelHTTPError as http_err:
        # 401 / 403 → auth_failed. Don't echo any key in the summary.
        if http_err.status_code in (401, 403):
            deps.result = _make_auth_failed_result(
                provider=cfg.provider, deps=deps,
            )
            return None
        raise
    except UnexpectedModelBehavior as e:
        # The model failed output validation three times. Unhandled, this
        # propagates out of run(): the document keeps status=running with an
        # open turn, the trail is never closed, and the panel gets a bare
        # "Exceeded maximum output retries (2)" that names no model and no fix.
        deps.result = _make_bad_decision_result(
            provider=cfg.provider, model_id=cfg.model, deps=deps,
        )
        if audit is not None:
            audit.record_error(
                code="invalid_decision",
                where="plan_step",
                message=f"{cfg.provider}:{cfg.model} could not produce a valid "
                        f"action after 3 attempts",
                detail={"retries": 2, "step": deps.step_number,
                        "detail": _failure_detail(e)},
            )
        return None
    finally:
        # _turn_to_prompt reads _CURRENT_DEPS for the secure-mode
        # preamble; clear it after the call so it doesn't leak
        # across tasks (the loop is sequential but the value
        # outlives this iteration otherwise).
        _CURRENT_DEPS = None
    return decision, context_window, result


# A document in one of these states describes a run that is over. Resuming
# one is the same mistake as re-running an approved action: the user already
# got their answer, or already stopped the thing.
#
# "interrupted" is written *only* on a resume refusal, and it overwrites the
# terminal status it was refusing to resume from. Leaving it out means a
# second resume attempt reads a finished run as resumable and starts it again.
_TERMINAL_DOC_STATUSES = {
    "completed", "failed", "awaiting_human", "stagnated", "cancelled",
    "interrupted",
}


def _conversation_state(session_id: str, *, resume: bool) -> dict:
    """Decide what a task_start means for this document.

    Returns {"action": "new_task" | "resume" | "refuse", "doc", "summaries",
    "visited", "first_step", "task_index", "orphaned", "why"}.

    The two paths do opposite things with the same document, which is why
    they cannot share one: `resume` continues an unfinished turn of a run the
    socket dropped, and `new_task` appends another thing the user asked for.
    Only the first may re-enter a turn; only the second may start at step 0.
    """
    doc = read(session_id)
    if not doc.get("found"):
        # Nothing to resume, so `resume: true` is answered the same way.
        return {"action": "new_task", "doc": None, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": 0,
                "orphaned": None, "why": ""}
    if doc.get("corrupt"):
        return {"action": "refuse", "doc": doc, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": 0,
                "orphaned": None, "why": "the session document is corrupt"}

    if resume:
        # A resume never starts a new task, so it never needs a segmentation
        # the document does not have. `_resume_state` reports a refusal as a
        # non-empty `why`; this is where that becomes an action.
        r = _resume_state(session_id)
        return {"action": "refuse" if r["why"] else "resume", "doc": r["doc"],
                "summaries": r["summaries"], "visited": r["visited"],
                "first_step": r["first_step"], "task_index": 0,
                "orphaned": None, "why": r["why"]}

    if doc.get("schema_version", 1) < 2:
        # Checked before status, not after: a v1 document has no `tasks[]`
        # to append a follow-up to whatever it is doing, so the schema is
        # the reason — including when the run it recorded was abandoned.
        return {"action": "refuse", "doc": doc, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": 0,
                "orphaned": None,
                "why": (
                    "this conversation is a schema v1 document, recorded "
                    "before tasks were tracked, so there is no way to add "
                    "a follow-up to it. Start a new conversation instead "
                    "— the old one stays readable in history."
                )}

    tasks = doc.get("tasks") or []
    if doc.get("status") not in _TERMINAL_DOC_STATUSES:
        # `status: running` on disk is NOT evidence of a live run. main.py
        # already refuses a task_start while an agent is actually driving
        # this session (`duplicate_task_start`), so reaching here with
        # `running` means the previous run was ABANDONED — a dropped socket,
        # a server restart, a killed process. Refusing the user's prompt here
        # locked them out of their own conversation with "a run is still in
        # flight", which is both untrue and unrecoverable-looking; and since
        # the refusal also stamps the document `interrupted`, it destroyed
        # the abandoned run's real status on the way, so only the *second*
        # attempt got through.
        return {"action": "new_task", "doc": doc, "summaries": [],
                "visited": set(), "first_step": 0, "task_index": len(tasks),
                "orphaned": (tasks[-1].get("index")
                             if tasks and tasks[-1].get("status") == "running"
                             else None),
                "why": ""}

    return {"action": "new_task", "doc": doc, "summaries": [],
            "visited": set(), "first_step": 0, "task_index": len(tasks),
            "orphaned": None, "why": ""}


def _resume_state(session_id: str) -> dict:
    """Rebuild this session's history from its own audit document.

    The loop is stateless per step — `agent.run` is handed a freshly built
    prompt and no message_history — so `step_summaries` and `scratchpad`
    ARE the model's entire history, and the document holds both. That is
    what makes resume sound rather than a guess.

    Only turns that ENDED are history. A turn in flight when the socket
    died describes actions that may or may not have run, so it is re-run
    from scratch rather than half-recorded — an action the user approved
    but that never executed must not look like it did.

    Returns {doc, summaries, visited, first_step, why}. A non-empty `why`
    means the document cannot be trusted: the caller must report the
    session as interrupted rather than run it again from step 0.
    """
    doc = read(session_id)
    if not doc.get("found"):
        return {"doc": None, "summaries": [], "visited": set(),
                "first_step": 0, "why": ""}
    if doc.get("corrupt"):
        return {"doc": doc, "summaries": [], "visited": set(), "first_step": 0,
                "why": "the audit document could not be parsed"}
    if doc.get("schema_version") != SCHEMA_VERSION:
        return {"doc": doc, "summaries": [], "visited": set(), "first_step": 0,
                "why": (f"the audit document is schema_version "
                        f"{doc.get('schema_version')!r}, this server writes "
                        f"{SCHEMA_VERSION}")}
    if doc.get("status") in _TERMINAL_DOC_STATUSES:
        return {"doc": doc, "summaries": [], "visited": set(), "first_step": 0,
                "why": f"the run already ended ({doc.get('status')})"}

    completed = [t for t in (doc.get("turns") or [])
                 if t.get("ended_at") is not None]
    if not completed:
        # Nothing completed means nothing approved has been re-run, so a
        # fresh start is a start, not a replay.
        return {"doc": doc, "summaries": [], "visited": set(),
                "first_step": 0, "why": ""}

    summaries: list[StepSummary] = []
    for turn in completed:
        actions = turn.get("actions") or []
        outcomes = "; ".join(str(a.get("outcome") or "") for a in actions)
        summaries.append(StepSummary(
            step=int(turn.get("step", 0)),
            url=str((turn.get("observation") or {}).get("url") or ""),
            # Tool names, not the live path's scrubbed trace strings. The
            # history line is read by the model, not by a human, and the
            # document is what survived the crash.
            action_taken="; ".join(str(a.get("action") or "?") for a in actions)
                         or "no action",
            outcome=outcomes[:120] or "no action",
        ))
    # Only domains the user APPROVED get into visited_domains on the live
    # path, so only those are restored — re-adding a domain they never
    # approved would skip the prompt that exists to ask them.
    visited = {
        e["domain"] for e in (doc.get("policy_events") or [])
        if e.get("kind") == "first_navigation"
        and e.get("user_decision") == "approved" and e.get("domain")
    }
    return {"doc": doc, "summaries": summaries, "visited": visited,
            "first_step": int(completed[-1].get("step", 0)) + 1, "why": ""}


def _adopt_document(audit: AuditTrail, doc: dict) -> None:
    """Carry a previous run's record into a fresh trail.

    AuditTrail always opens an empty document, so without this a resume
    truncates the record at the reconnect — `GET /v1/sessions/{id}/audit`
    would show a run whose first turn is step 7 with nothing before it.

    The whole previous document rather than a named list of fields: the
    list is a list that has to be extended every time the schema grows,
    and each omission is a silently lost key. `status` is the one field the
    fresh document owns, because the run is live again by the time this
    is called.
    """
    previous = audit._doc  # noqa: SLF001 — audit.py exposes no adopt path
    status = previous["status"]
    audit._doc.clear()
    audit._doc.update(doc)
    audit._doc["status"] = status
    # `read` adds a lookup hint that is not part of the written shape.
    audit._doc.pop("found", None)
    audit._doc.pop("corrupt", None)
    # The seq counter is per-AuditTrail, and a new one is built for every run,
    # so without this a continuation restarts numbering at 1 and the document
    # ends up with three turns called seq 1. `seq` is the document's ordering
    # key, so a reader sorting on it gets the runs interleaved. errors[] draws
    # on the same counter, so it is scanned too.
    audit._seq = max(
        (int(e.get("seq", 0))
         for key in ("turns", "errors")
         for e in (doc.get(key) or [])
         if isinstance(e, dict)),
        default=0,
    )
    # A document this server did not write — a hand-edited file, or one from
    # a schema version whose collections are named differently — may be
    # missing the lists the record methods append to. Creating them here is
    # cheaper than a KeyError on the first write, and the audit never
    # raises into the loop.
    for key in ("turns", "prompts", "actions", "policy_events", "errors",
                "tasks", "messages"):
        audit._doc.setdefault(key, [])
    audit._doc.setdefault("totals", {})
    audit._doc.setdefault("title", "")


# Sessions the user explicitly stopped. A cancel reaches the server as a
# closed socket, which is indistinguishable from the server dying, and only
# one of those two may be resumed — so the client says which it was over a
# `cancel` frame instead of the server guessing from the disconnect.
# ponytail: a set of session ids, one entry per cancel, consumed by the
# sealing callback. Upgrade path if this ever grows unbounded: store the
# flag on the session registry instead.
_USER_CANCELLED: set[str] = set()


def mark_cancelled(task_id: str) -> None:
    """Record that the user stopped this task, so it is never resumed."""
    _USER_CANCELLED.add(task_id)


def _seal_if_cancelled(audit: AuditTrail):
    """Seal a user-cancelled run as `cancelled`, not `running`.

    Installed as a done-callback rather than an `except` around the loop:
    every terminal path out of the loop is a `return`, and re-indenting 500
    lines to add a handler buys nothing. The flag above is what separates
    "the user stopped this" from "the socket died and this can be picked
    back up" — a document left reading `running` after a stop is the one
    thing a later reconnect would happily resume.

    The open turn is deliberately left open. It really did not finish, and
    an open turn is what a crashed run looks like — the status is what
    separates the two.
    """

    def _done(task: asyncio.Task) -> None:
        if not task.cancelled():
            return  # already sealed by a normal return
        if audit.session_id not in _USER_CANCELLED:
            return  # a dropped socket, not a stop — resume it
        _USER_CANCELLED.discard(audit.session_id)
        log.warning("[audit] task cancelled by the user — sealing %s",
                    audit.session_id)
        audit.set_status("cancelled")
        audit.close()

    return _done


class AgentHarness:
    # A runaway backstop, not a task limit. The user is not bounded on how
    # long a session runs — context is managed by the age-scaled tree budget
    # and the windowed history blocks, neither of which needs a step ceiling.
    #
    # This used to be 30, and it reported "Max steps reached" on tasks that
    # were still working — the one thing a user must never be told. Progress
    # detection was tried in its place (URL then page-fingerprint hashing,
    # see git history) and removed: it fired falsely on two live runs that
    # both went on to succeed, and "stuck" is not separable from "working on
    # a slow-loading page" by hashing the top of a DOM. 150 is far enough out
    # that reaching it means the loop is genuinely spinning, and the message
    # below says exactly that rather than blaming the step policy.
    MAX_STEPS = 150

    async def run(self, deps: AgentDeps, *, resume_from: int = 0,
                  resume: bool = False) -> TaskResult:
        timings: dict[str, float] = {b: 0.0 for b in TIMING_BUCKETS}
        # Snapshot of `timings` taken at the start of each step iteration —
        # lets us report a per-step breakdown without instrumenting every
        # early-exit (continue) site in the loop.
        cumulative_snapshots: list[dict[str, float]] = []
        # Provider-reported token usage, summed across steps and reported in
        # the timing dict so the benchmark runner can price the run. The
        # scripted-planner path never calls `agent.run`, so these stay 0
        # there — a real fact (no model ran), not missing data.
        tokens: dict[str, int] = {"in": 0, "out": 0}
        steps_run = 0
        task_start = time.perf_counter()

        if not await deps.cdp.ping():
            return TaskResult(
                status="failed",
                summary="CDP not healthy at task start",
                failure_reason="cdp_preflight_failed",
                policy_mode=_policy_mode(deps),
                # Pre-observe: no URL was ever observed, so this is "".
                final_url=deps.step_url,
            )

        if not deps.task_id:
            deps.task_id = str(uuid.uuid4())

        # A follow-up task and a crash resume arrive on the same frame and do
        # opposite things with the same document, so the decision is made
        # here, once, before anything is written.
        #
        # Read BEFORE the trail is built: its first flush (set_goal, below)
        # rewrites the file, and a run that read it afterwards would find its
        # own empty document and conclude there is nothing to read.
        state = _conversation_state(deps.task_id, resume=resume)
        first_step = max(resume_from, state["first_step"])

        audit = AuditTrail(deps.task_id)
        _task = asyncio.current_task()
        if _task is not None:
            _task.add_done_callback(_seal_if_cancelled(audit))
        # Index of the current step's turn in the audit document, -1 before
        # the first begin_turn. Every audit call takes it; -1 means "no turn
        # yet", which record_prompt/record_action drop rather than guess at.
        a_turn = -1

        # Adopt before the first flush, so the file is never briefly truncated
        # at the reconnect point. Gated on "there is a document" and not "there
        # is something to resume": a run that already ended still has to keep
        # its turns when the refusal below is recorded on top of it.
        if state["doc"] and not state["doc"].get("corrupt"):
            _adopt_document(audit, state["doc"])
        if state["summaries"]:
            deps.step_summaries.extend(state["summaries"])
            deps.visited_domains |= state["visited"]
            log.info("[%s] resuming at step %d  summaries=%d  domains=%d",
                     deps.user_id, first_step, len(state["summaries"]),
                     len(state["visited"]))

        # A document we cannot act on is reported, never silently re-run: a
        # fresh run would re-do work the user already approved. Ahead of
        # set_goal, because set_goal is this trail's first flush and that
        # flush overwrites the file.
        if state["action"] == "refuse":
            log.error("[%s] refused: %s", deps.user_id, state["why"])
            if state["doc"] and not state["doc"].get("corrupt"):
                audit.record_error(code="task_refused", where="run",
                                   message=state["why"])
                audit.set_status("interrupted")
                audit.close()
            # A corrupt document is left exactly as found. Rewriting it would
            # replace the only copy of a broken run with a valid empty one,
            # and the corruption is the thing a human would need to see.
            return TaskResult(
                status="failed",
                summary=state["why"],
                failure_reason="task_refused",
                policy_mode=_policy_mode(deps),
                # No step ran, so this is the same pre-observe "" the CDP
                # preflight return carries.
                final_url=deps.step_url,
            )

        # The user's prompt is written here, not per turn: a run cancelled at
        # step 0 has no turns, and the prompt they typed is the one thing that
        # must survive it. Only a new task writes one — a resume is the same
        # task continuing, and its prompt is already on disk.
        if state["action"] == "new_task":
            # Every new task, including the first one on a session that has no
            # document yet. Skipping it for a fresh session left `tasks[]`
            # empty, so the SECOND task became index 0 — the conversation's
            # own segmentation lost its first task, and the first follow-up
            # saw an empty `deps.conversation` and answered with no memory of
            # what came before.
            if state["orphaned"] is not None:
                # The run this conversation was left holding is over, and
                # nothing is running it. Sealed before the new task so the
                # history list stops showing it as in progress — recorded on
                # top, so its turns and the prompt the user typed survive.
                audit.seal_task(state["orphaned"], "interrupted")
            task_index = audit.begin_task(deps.task)
        else:
            # A resume continues whatever task the document was last running.
            # Hardcoding 0 would put a crash in the second task's turns and
            # messages into the first task's segment of the transcript.
            task_index = audit.resume_task()
        deps.task_index = task_index
        if state["action"] == "new_task":
            audit.add_message(role="user", content=deps.task, task=task_index,
                              turn=None)
        # Earlier tasks, on both paths. Only *earlier*: the current goal is in
        # the prompt already, and showing it twice is both noise and a chance
        # for the two copies to disagree. A resume needs this as much as a new
        # task does — `step_summaries` covers the run being continued, not the
        # tasks that came before it, so without it a crash in the second task
        # of a conversation resumed with no memory of the first.
        deps.conversation = [m for m in audit.conversation()
                             if m.get("task", 0) < task_index]

        audit.set_goal(deps.task)

        if deps.policy is not None:
            # The effective policy in force for the whole task, once.
            audit.set_policy(deps.policy.model_dump()
                             if hasattr(deps.policy, "model_dump") else dict(deps.policy))
            # And one flat event so a reader can find it in the log too.
            audit.record_policy(
                step=-1, kind="policy_active", domain=None, action=None,
                decision=(
                    f"mode={deps.policy.mode}  "
                    f"blacklist={deps.policy.blacklist}  "
                    f"first_time_seen_prompt={deps.policy.first_time_seen_prompt}"
                ),
            )

        # Restore scratchpad if this task was previously interrupted.
        # load_scratchpad returns a structured Scratchpad (entries + notes).
        # Legacy plain-text files (no # MEMORY v2 header) parse as notes-only.
        loaded = load_scratchpad(audit.scratchpad_path)
        if loaded.entries or loaded.notes:
            deps.scratchpad = loaded

        # Size step 0's AX tree against the model that will actually read it.
        # `_plan_step` resolves the same config a moment later and can report
        # a bad model properly; this call only wants the window, so a failure
        # is swallowed rather than handled twice — step 0 hits the identical
        # error one line into `_plan_step` and takes the existing path.
        if os.getenv("AGENT_MODEL") != "test" and deps.scripted_planner is None:
            try:
                deps.context_window = _resolve_model(deps)[0].context_window
            except Exception as exc:
                log.warning("[%s] model config unresolved before step 0: %s",
                            deps.user_id, type(exc).__name__)

        for step in range(first_step, self.MAX_STEPS):
            deps.step_number = step
            # Close the previous turn here rather than at each exit: every
            # path that skips the bottom of the loop is a `continue`, and
            # this is the one place all of them pass through. end_turn is a
            # plain overwrite, so the bottom-of-loop call below (which has
            # exact numbers) simply wins on the normal path.
            if a_turn >= 0:
                audit.end_turn(a_turn, timings=_step_timings(timings, cumulative_snapshots))
            log.info("[%s] === step %d ===", deps.user_id, step)

            # Abort gate: if a previous iteration set deps.result (policy
            # block, user denial), exit cleanly before doing another round
            # of observe/plan/execute. Otherwise the loop would burn all
            # MAX_STEPS iterations re-entering the same `if deps.result is
            # not None: continue` short-circuits.
            if deps.result is not None:
                deps.result.timing = self._log_timings(
                    deps.user_id, timings, steps_run, time.perf_counter() - task_start, cumulative_snapshots,
                    tokens=tokens,
                )
                # deps.step_url is the URL observed at the top of the last
                # step this loop entered — pre-step, not post-action. It is
                # "" until the first observe, which is what the abort gate
                # can return on.
                deps.result.final_url = deps.step_url
                # The gate is the single point every terminal result passes
                # through, so it is the one place steps_taken can be counted
                # right: built elsewhere it is 0-indexed, step+1, or unset.
                deps.result.steps_taken = max(deps.result.steps_taken, steps_run)
                self._close(audit, a_turn, deps.result, cumulative_snapshots, timings,
                               task_index=deps.task_index)
                return deps.result

            steps_run += 1
            cumulative_snapshots.append(dict(timings))

            # Observe
            t0 = time.perf_counter()
            targets = await deps.cdp.get_targets()
            current_url = await deps.cdp.get_current_url()
            page_title = await deps.cdp.get_page_title()
            # Free on the extension path (already in the cached observation);
            # one evaluate on the dev path. Shipped every step because the
            # accessibility tree often omits the value a question is about.
            page_text = await deps.cdp.get_page_text()
            # ponytail: stash for the click cross-domain gate (Change 3).
            # The click handler runs inside this same step and needs to
            # compare pre-click URL to post-click URL.
            deps.step_url = current_url
            t1 = time.perf_counter()
            timings["observe"] += t1 - t0

            # Budget scales with the model actually in use — deps.context_window
            # is set by _plan_step once the per-task config resolves, so step 1
            # falls back to the env default, which is where that number came
            # from anyway.
            budget = budget_for_window(getattr(deps, "context_window", None), step=step)
            filtered_ax = filter_ax_targets(targets, max_chars=budget)
            ax_diff = compute_ax_diff(deps.prev_targets, targets, max_chars=budget // 10)
            # Published here, not at the bottom of the loop: the diff above
            # has already been taken, and everything after this point —
            # redaction in particular — resolves refs against the tree the
            # model was just shown. Leaving it a step stale meant step 0's
            # ref lookup had nothing to match.
            deps.prev_targets = targets
            timings["filter"] += time.perf_counter() - t1

            # Guardrail: domain policy (secure mode only). No-op in normal
            # mode. With the whitelist dropped, the only BLOCK path here is
            # "we landed on (or got redirected to) a blacklisted URL
            # mid-task". Hard block, no override.
            if deps.policy is not None and getattr(deps.policy, "mode", None) == "secure":
                decision = check_domain_policy(current_url, deps.policy)
                if decision == GateDecision.BLOCK:
                    domain = etld1(current_url) or current_url
                    log.warning(
                        "[%s] POLICY VIOLATION: domain BLOCKED  step=%d  url=%s  domain=%s",
                        deps.user_id, step, current_url, domain,
                    )
                    audit.record_policy(
                        step=step, kind="domain_blocked", domain=domain,
                        action="observe", decision="block",
                    )
                    timing_report = self._log_timings(
                        deps.user_id, timings, steps_run,
                        time.perf_counter() - task_start, cumulative_snapshots,
                        tokens=tokens,
                    )
                    deps.result = TaskResult(
                        status="failed",
                        summary=f"Blocked by policy: {domain}",
                        failure_reason="policy_blocked",
                        steps_taken=steps_run,
                        timing=timing_report,
                        policy_mode=_policy_mode(deps),
                    )
                    deps.result.final_url = deps.step_url
                    self._close(audit, a_turn, deps.result, cumulative_snapshots, timings,
                               task_index=deps.task_index)
                    return deps.result

            # The turn opens here — after the policy block, before the
            # login guardrail — so the login prompt has a turn to live in.
            # A turn that pauses for a login and never reaches the model
            # carries `model: None`, which is what happened, not a gap.
            a_turn = audit.begin_turn(
                step=step, url=current_url, page_title=page_title,
                ax_targets=len(targets), ax_chars=len(filtered_ax),
                ax_diff=ax_diff, page_text_chars=len(page_text),
            )

            # Guardrail: login detection. Skipped under a scripted planner:
            # there is no human to ask, the script carries its own login
            # steps, and /run has no reply channel to answer on — without
            # this the guardrail blocks 300s per step and every run records
            # a timeout instead of a measurement.
            #
            # ponytail: the only prompt site that does NOT go through
            # `_ask_user`. Its contract is different on both sides — a 300s
            # timeout continues the loop instead of aborting, and "skip"
            # aborts. Folding it into a helper that answers yes/no would
            # have meant a signature carrying both contracts.
            if deps.scripted_planner is None and check_login_page(
                page_title, filtered_ax, current_url
            ):
                t_lp = time.perf_counter()
                pid = audit.record_prompt(
                    a_turn, kind="login_required", action="login",
                    args={"url": current_url, "page_title": page_title},
                    domain=etld1(current_url),
                    reason=f"Please log in: {page_title}",
                )
                await deps.ws_send({
                    "type": "login_required",
                    "message": f"Please log in: {page_title}. Agent will continue when ready.",
                })
                try:
                    reply = await asyncio.wait_for(
                        deps.human_input_queue.get(), timeout=300,
                    )
                except asyncio.TimeoutError:
                    await deps.ws_send({"type": "login_timeout"})
                    audit.resolve_prompt(pid, decision="timeout", response="",
                                         wait_ms=int((time.perf_counter() - t_lp) * 1000))
                    timings["login_pause"] += time.perf_counter() - t_lp
                    continue
                if str(reply).lower() == "skip":
                    timings["login_pause"] += time.perf_counter() - t_lp
                    audit.resolve_prompt(pid, decision="skipped", response=str(reply),
                                         wait_ms=int((time.perf_counter() - t_lp) * 1000))
                    timing_report = self._log_timings(deps.user_id, timings, steps_run, time.perf_counter() - task_start, cumulative_snapshots, tokens=tokens)
                    deps.result = TaskResult(
                        status="failed",
                        summary="User skipped login",
                        failure_reason="user_skipped_login",
                        timing=timing_report,
                        policy_mode=_policy_mode(deps),
                    )
                    deps.result.final_url = deps.step_url
                    self._close(audit, a_turn, deps.result, cumulative_snapshots, timings,
                               task_index=deps.task_index)
                    return deps.result
                # reply == "resume" (or anything else): loop continues,
                # next step re-runs check_login_page to confirm we're out.
                audit.resolve_prompt(pid, decision="resumed", response=str(reply),
                                     wait_ms=int((time.perf_counter() - t_lp) * 1000))
                timings["login_pause"] += time.perf_counter() - t_lp
                continue

            # Drain steering here, not at the top of the loop: the policy block
            # above `return`s and the login guardrail `continue`s, so a drain
            # placed earlier would read a message and then drop the step
            # holding it. The model call is uninterruptible, so this lands at
            # the next step boundary — which is the right place anyway, since
            # you do not interrupt a tool call.
            if deps.steering:
                deps.pending_steering, deps.steering = deps.steering, ""

            # Build turn
            turn = AgentTurn(
                task=deps.task,
                step_number=step,
                scratchpad_notes=deps.scratchpad.notes,
                scratchpad_entries=list(deps.scratchpad.entries),  # manifest snapshot
                current_url=current_url,
                current_page_title=page_title,
                ax_tree=filtered_ax,
                ax_diff=ax_diff,
                step_summaries=deps.step_summaries,
                page_text=page_text,
                steering=deps.pending_steering,
            )

            log.info("[%s] step %d  url=%s  ax_elements=%d  memory_entries=%d",
                     deps.user_id, step, current_url[:80], len(targets), len(turn.scratchpad_entries))

            # Plan
            t_plan = time.perf_counter()
            log.debug("[%s] calling model...", deps.user_id)
            planned = await _plan_step(deps, turn, agent, audit)
            if planned is None:
                # deps.result is set; skip the rest of this step.
                continue
            decision, context_window, result = planned
            timings["model_plan"] += time.perf_counter() - t_plan
            actions_summary = ", ".join(f"{c.action}" for c in decision.actions) or "(none)"
            log.info("[%s] step %d  actions=[%s]", deps.user_id, step, actions_summary)

            # Read the provider's own usage once, here, and use it for both
            # the running total and the turn. Read this late it would miss
            # the cost of a step the user then denied — which is the step
            # they paid for.
            try:
                usage = result.usage if result is not None else None
                tokens_in = usage.input_tokens if usage else 0
                tokens_out = usage.output_tokens if usage else 0
                if usage is not None:
                    tokens["in"] += tokens_in
                    tokens["out"] += tokens_out
            except Exception:
                usage, tokens_in, tokens_out = None, 0, 0
            tokens_used = tokens_in if usage is not None else None
            context = _build_context(tokens_used, window=context_window)
            audit.record_model(
                a_turn, thought=decision.thought, reasoning=decision.reasoning,
                tokens_in=tokens_in, tokens_out=tokens_out,
                context_pct=context["pct"] or 0.0,
                latency_ms=int((time.perf_counter() - t_plan) * 1000),
            )

            # Secure-mode escalation: curated list of irreversible actions
            # that always require explicit approval in secure mode (even if
            # the regex CRITICAL_PATTERNS misses them). Fires before the
            # regex check so the bank-IT-curated list wins on overlap.
            t_ap = time.perf_counter()
            if deps.policy is not None and getattr(deps.policy, "mode", None) == "secure":
                for c in decision.actions:
                    if not check_sensitive_action(c.action, c.action_args, deps.policy):
                        continue
                    log.warning(
                        "[%s] POLICY VIOLATION: sensitive action  step=%d  action=%s  (prompting user)",
                        deps.user_id, step, c.action,
                    )
                    audit.record_policy(
                        step=step, kind="sensitive_action", domain=None,
                        action=c.action, decision="require_approval",
                    )
                    approved = await _ask_user(
                        deps, audit, turn=a_turn, kind="sensitive_action",
                        action=_card_label(c.action, c.action_args),
                        args=c.action_args, domain=None,
                        reason=(
                            f"Sensitive action (org policy): the agent wants to "
                            f"{_card_label(c.action, c.action_args)}. Continue?"
                        ),
                    )
                    if not approved:
                        log.warning(
                            "[%s] POLICY VIOLATION: user DENIED sensitive action  step=%d  action=%s",
                            deps.user_id, step, c.action,
                        )
                        audit.record_policy(
                            step=step, kind="sensitive_action", domain=None,
                            action=c.action, decision="require_approval",
                            user_decision="denied",
                        )
                        deps.step_summaries.append(StepSummary(
                            step=step, url=current_url,
                            action_taken=f"[BLOCKED] {c.action} (sensitive)",
                            outcome="User denied approval",
                        ))
                        deps.result = _make_user_denied_result(
                            step, domain=None, kind=f"sensitive action {c.action}",
                            deps=deps,
                        )
                        break
                if deps.result is not None:
                    timings["approval_pause"] += time.perf_counter() - t_ap
                    continue

            # Guardrail: critical action approval (check ALL actions in the
            # batch — checking only the first was a bypass: `click(delete) +
            # append_scratchpad` would only see the first critical action,
            # and if the model put a non-critical action first, critical
            # actions later in the batch ran unchecked). Deny on ANY
            # critical action aborts the entire task — the user's plan was
            # wrong, the agent shouldn't try a different angle.
            #
            # _NEVER_APPROVE first: the internal four carry model-written
            # prose in their args and check_critical_action regexes those,
            # so a scratchpad note could raise a card on its own.
            critical_actions = [
                c for c in decision.actions
                if c.action not in _NEVER_APPROVE
                and check_critical_action(c.action, c.action_args)
            ]
            for c in critical_actions:
                approved = await _ask_user(
                    deps, audit, turn=a_turn, kind="critical_action",
                    action=_card_label(c.action, c.action_args),
                    args=c.action_args, domain=None,
                    reason=_REASON_CRITICAL.format(thought=decision.thought),
                )
                if not approved:
                    log.warning(
                        "[%s] POLICY VIOLATION: user DENIED critical action  step=%d  action=%s",
                        deps.user_id, step, c.action,
                    )
                    audit.record_policy(
                        step=step, kind="critical_action", domain=None,
                        action=c.action, decision="require_approval",
                        user_decision="denied",
                    )
                    deps.step_summaries.append(StepSummary(
                        step=step, url=current_url,
                        action_taken=f"[BLOCKED] {c.action}",
                        outcome="User denied approval",
                    ))
                    deps.result = _make_user_denied_result(
                        step, domain=None, kind=f"critical action {c.action}",
                        deps=deps,
                    )
                    break
            if deps.result is not None:
                timings["approval_pause"] += time.perf_counter() - t_ap
                continue

            # Secure-mode add-on: first-time-seen on this domain for ANY
            # action (not just critical ones). Each (domain, action) pair
            # prompts once per session. The pair is added to seen_first_time
            # whether approved or denied — on deny the task aborts anyway,
            # but the cache entry prevents a retry-loop on a persistent
            # prompt-injection attempt.
            if deps.policy is not None and getattr(deps.policy, "mode", None) == "secure":
                for c in decision.actions:
                    # Skip terminal / internal / question actions — they
                    # are metadata, not things the user needs to approve.
                    if c.action in _NEVER_APPROVE:
                        continue
                    # Defense-in-depth: hard-block if current URL is blacklisted,
                    # even if the observe-phase block somehow let us through.
                    if _guard_first_time_seen_blacklist(
                        deps, current_url, audit, step, c.action,
                    ):
                        break
                    domain = etld1(current_url)
                    if domain is None:
                        continue
                    key = _first_time_key(domain, c, deps.prev_targets)
                    if not check_first_time_seen(key, deps.seen_first_time, deps.policy):
                        continue
                    log.warning(
                        "[%s] POLICY VIOLATION: first-time-seen on domain  step=%d  domain=%s  action=%s  (prompting user)",
                        deps.user_id, step, domain, c.action,
                    )
                    audit.record_policy(
                        step=step, kind="first_time_seen", domain=domain,
                        action=c.action, decision="require_approval",
                    )
                    approved = await _ask_user(
                        deps, audit, turn=a_turn, kind="first_time_seen",
                        action=_card_label(c.action, c.action_args),
                        args=c.action_args, domain=domain,
                        reason=_REASON_FIRST_TIME.format(
                            domain=domain, action=_card_label(c.action, c.action_args),
                        ),
                    )
                    deps.seen_first_time.add(key)
                    if not approved:
                        log.warning(
                            "[%s] POLICY VIOLATION: user DENIED first-time-seen  step=%d  domain=%s  action=%s",
                            deps.user_id, step, domain, c.action,
                        )
                        audit.record_policy(
                            step=step, kind="first_time_seen", domain=domain,
                            action=c.action, decision="require_approval",
                            user_decision="denied",
                        )
                        deps.step_summaries.append(StepSummary(
                            step=step, url=current_url,
                            action_taken=f"[BLOCKED] {c.action} (first-time)",
                            outcome="User denied approval",
                        ))
                        deps.result = _make_user_denied_result(
                            step, domain=domain, kind="first-time action",
                            deps=deps,
                        )
                        break
                    log.warning(
                        "[%s] POLICY: user APPROVED first-time-seen  step=%d  domain=%s  action=%s",
                        deps.user_id, step, domain, c.action,
                    )
                    audit.record_policy(
                        step=step, kind="first_time_seen", domain=domain,
                        action=c.action, decision="require_approval",
                        user_decision="approved",
                    )
            timings["approval_pause"] += time.perf_counter() - t_ap
            if deps.result is not None:
                continue

            # Stream progress — one bubble per decision. The lead action is
            # echoed at the top level for the icon and the destination URL.
            # Internal actions (scratchpad) are still silent — they're
            # metadata, not tool calls the user sees.
            t_ws = time.perf_counter()
            external = [c for c in decision.actions if c.action not in _INTERNAL_ACTIONS]
            if external:
                lead = external[0]
                await deps.ws_send({
                    "type": "step_progress",
                    "step": step,
                    "action": lead.action,
                    "action_target": lead.action_args.get("url") if lead.action == "navigate" else None,
                    "thought": decision.thought,
                    "url": current_url,
                    "context": context,
                    # ponytail: tells the sidepanel to show the SECURE badge
                    # on this step's bubble. Cheap to compute; piggybacks
                    # on step_progress instead of a separate WS frame.
                    "secure_mode": _policy_mode(deps) == "secure",
                })
            else:
                # ponytail: no external actions this step (e.g. a
                # scratchpad-only step). Still emit context so the sidepanel
                # utilization % updates on every step.
                await deps.ws_send({
                    "type": "context_update",
                    "context": context,
                })
            timings["ws_send_progress"] += time.perf_counter() - t_ws

            # Execute
            t_ex = time.perf_counter()
            outcomes: list[str] = []
            action_trace: list[str] = []
            for call in decision.actions:
                # One DOM lookup per TYPED action, not per textbox per step.
                redact = (call.action == "type_text"
                          and await _redact_if_secret(deps, call.action_args.get("ref", "")))
                rec_args, trace = _scrubbed(call, redact)
                action_trace.append(trace)
                t_a = time.perf_counter()
                outcome = await _execute_action(call, deps, audit=audit, turn=a_turn)
                audit.record_action(
                    a_turn, action=call.action, args=rec_args, outcome=outcome,
                    ok=not outcome.startswith("Error executing"),
                    redacted=redact,
                    duration_ms=int((time.perf_counter() - t_a) * 1000),
                )
                outcomes.append(outcome)
                # Short-circuit the rest of the batch on a terminal action
                # (task_complete/cannot_complete — sets deps.result) or on
                # ask_human (pauses for user input; any action after it in
                # the same batch would run before the user could see the
                # question, which is the wrong order). Also break if a
                # downstream _execute_action set deps.result on a hard
                # block (e.g. navigate to blacklisted URL).
                if call.action in _TERMINAL_ACTIONS or call.action == "ask_human":
                    break
                if deps.result is not None:
                    break
            timings["execute"] += time.perf_counter() - t_ex
            combined_outcome = "; ".join(outcomes) if outcomes else "no action"

            # Persist the full structured memory whenever any step touched
            # it: read_page_text (auto-capture), append_scratchpad /
            # write_scratchpad (synthesized notes). The file is the
            # source of truth — operators can inspect
            # <sessions>/scratchpad.txt to see what memory was
            # built. Auto-append writes the digest; the full body lives
            # only in-memory and is lost on restart.
            memory_actions = {
                "read_page_text", "write_scratchpad", "append_scratchpad",
            }
            if any(c.action in memory_actions for c in decision.actions):
                audit.set_scratchpad(deps.scratchpad)

            # Record
            deps.step_summaries.append(StepSummary(
                step=step,
                url=current_url,
                action_taken="; ".join(action_trace) if action_trace else "no action",
                outcome=combined_outcome[:120],
            ))

            # Terminal? Gate on deps.result, not on the action name. A
            # terminal action that raises an exception before setting
            # deps.result should not try to read .timing off a None.
            if deps.result is not None:
                deps.result.timing = self._log_timings(
                    deps.user_id, timings, steps_run, time.perf_counter() - task_start, cumulative_snapshots,
                    tokens=tokens,
                )
                # deps.step_url is the URL observed at the top of the last
                # step this loop entered — pre-step, not post-action. It is
                # "" until the first observe, which is what the abort gate
                # can return on.
                deps.result.final_url = deps.step_url
                # The gate is the single point every terminal result passes
                # through, so it is the one place steps_taken can be counted
                # right: built elsewhere it is 0-indexed, step+1, or unset.
                deps.result.steps_taken = max(deps.result.steps_taken, steps_run)
                self._close(audit, a_turn, deps.result, cumulative_snapshots, timings,
                               task_index=deps.task_index)
                return deps.result

            audit.end_turn(a_turn, timings=_step_timings(timings, cumulative_snapshots))
            # One assistant message per completed turn, not per action: the
            # transcript is what a human reads, and a turn's outcome is the
            # unit they can act on. A turn closed by the abort gate above
            # never reaches here, so it gets none — an unfinished turn
            # describes actions that may not have run.
            if decision.thought:
                audit.add_message(role="assistant", content=decision.thought,
                                  task=deps.task_index, turn=a_turn)

        timing_report = self._log_timings(
            deps.user_id, timings, steps_run, time.perf_counter() - task_start, cumulative_snapshots,
            tokens=tokens,
        )
        deps.result = TaskResult(
            status="failed",
            summary=f"Stopped after {self.MAX_STEPS} steps without finishing",
            failure_reason="runaway_backstop",
            steps_taken=self.MAX_STEPS,
            timing=timing_report,
            policy_mode=_policy_mode(deps),
        )
        deps.result.final_url = deps.step_url
        self._close(audit, a_turn, deps.result, cumulative_snapshots, timings,
                               task_index=deps.task_index)
        return deps.result

    @staticmethod
    def _close(audit, turn: int, result: TaskResult,
               snapshots: list[dict[str, float]],
               timings: dict[str, float] | None, task_index: int) -> None:
        """End the open turn and seal the document.

        Every terminal path out of the loop ends here so no route can
        return without writing `result` and `status` — a document that
        reads "running" after the task is over is worse than no document.
        """
        if turn >= 0:
            audit.end_turn(turn, timings=_step_timings(timings or {}, snapshots))
            # The turn that ends the task is the one a human most wants to
            # read back, and it never reaches the loop's end-of-turn line —
            # it returns from here. Its outcome is the result summary: what
            # was done, or why it could not be. `turn >= 0` is the abort
            # gate's exclusion, since a turn that never opened describes
            # actions that may not have run.
            if result.summary:
                audit.add_message(role="assistant", content=result.summary,
                                  task=task_index, turn=turn)
        audit.finish(result.model_dump())
        audit.set_status(result.status)
        # Deregister last, and only on a terminal path. A live trail holds
        # the document in memory and rewrites the whole file on every flush,
        # so a handle still pointing at it after the task ended would be
        # writing into a sealed run.
        audit.close()

    @staticmethod
    def _log_timings(
        user_id: str,
        timings: dict[str, float],
        steps: int,
        wall: float,
        snapshots: list[dict[str, float]] | None = None,
        tokens: dict[str, int] | None = None,
    ) -> dict:
        """Emit a per-component timing summary at task end.

        Returns the dict so the caller can attach it to TaskResult.timing
        (which flows to the side panel via WS task_result).

        Two wall figures are reported:
          - `wall_s`     — total elapsed time (raw).
          - `wall_agent_s` — wall minus human-in-the-loop waits
                            (`login_pause`, `approval_pause`). The metric
                            sidepanel cards care about: "how long was the
                            agent actually thinking vs sitting idle waiting
                            for me?". User-supplied data is in `human_pause_s`.

        Output line shape:
          [brotto.harness] TIMING  user=local  steps=3  wall=5.42s
            wall_agent=3.10s  human_pause=2.32s  observe=0.31 ...
        """
        human_pause_total = sum(timings.get(b, 0.0) for b in _HUMAN_PAUSE_BUCKETS)
        wall_agent = max(0.0, wall - human_pause_total)
        parts = "  ".join(f"{k}={timings[k]:.2f}" for k in TIMING_BUCKETS)
        log.info(
            "[%s] TIMING  steps=%d  wall=%.2fs  wall_agent=%.2fs  human_pause=%.2fs  %s",
            user_id, steps, wall, wall_agent, human_pause_total, parts,
        )

        # Per-step breakdown: diff consecutive snapshots taken at the top of
        # each step iteration. Step N's wall = timings[snap_N+1] - timings[snap_N].
        per_step: list[dict[str, float]] = []
        if snapshots:
            for i in range(len(snapshots) - 1):
                delta = {
                    k: round(snapshots[i + 1][k] - snapshots[i][k], 3)
                    for k in TIMING_BUCKETS
                }
                per_step.append(delta)
            # The final step may have in-flight increments not yet snapshotted
            # if the task ended mid-iteration (e.g. terminal task_complete).
            if len(snapshots) <= steps:
                delta = {
                    k: round(timings[k] - snapshots[-1][k], 3)
                    for k in TIMING_BUCKETS
                }
                per_step.append(delta)

        tok = tokens or {}
        return {
            "steps": steps,
            "wall_s": round(wall, 3),
            "wall_agent_s": round(wall_agent, 3),
            "human_pause_s": round(human_pause_total, 3),
            "components": {k: round(timings[k], 3) for k in TIMING_BUCKETS},
            "per_step": per_step,
            # Consumed by testing/runner.py, which pops these to price the run.
            "tokens_in": tok.get("in", 0),
            "tokens_out": tok.get("out", 0),
        }
