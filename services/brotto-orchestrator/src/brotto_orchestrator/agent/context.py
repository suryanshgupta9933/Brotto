from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel


class StepSummary(BaseModel):
    step: int
    url: str
    action_taken: str
    outcome: str
    extracted: str | None = None


class MemoryEntry(BaseModel):
    """One captured chunk of page text, recorded automatically.

    Lives in Scratchpad.entries. The agent sees the manifest in every step
    (a small digest per entry) and recalls the full body via the
    recall_memory action. The body is the raw text returned by the CDP;
    the digest is the first ~200 chars — small enough to fit many entries
    in the prompt without bloating it.
    """
    id: str
    step: int
    selector: str
    around: str | None
    digest: str
    body: str
    was_truncated: bool
    # Which page it came from. Three pages captured in one run are
    # otherwise indistinguishable in the manifest, and "go back to *that*
    # page" is the whole point of keeping them.
    url: str = ""


DIGEST_LEN = 200


class Scratchpad(BaseModel):
    """Long-term memory. Two parts:

    - entries: page text, captured automatically by code — every step's
      page, plus every read_page_text result. The agent sees the digest
      (small) in every step's prompt; the full body is loaded on demand
      via recall_memory.
    - notes: agent-synthesized free-form text. The agent writes high-level
      findings, decisions, sub-question answers. This is the "narrative" the
      agent curates on top of the raw reads.

    `entries` is uncapped by design — the manifest is small and the bodies
    are loaded on demand, so growth costs almost nothing. `notes` is NOT:
    it is echoed in full in every step's prompt, so it is the one part that
    compounds, and it is capped.
    """
    entries: list[MemoryEntry] = field(default_factory=list)
    # Read-only legacy. Sidecars written before memory became a code-written
    # page cache carry a `# NOTES` section, and the loader still parses it, but
    # nothing writes notes any more — see the class docstring.
    notes: str = ""

    def next_id(self) -> str:
        """One numbering scheme for both entry kinds. They were numbered
        independently at their two call sites, so a page capture landing
        between two reads could reuse an id and silently overwrite one."""
        return f"r{len(self.entries) + 1}"

    def capture_page(self, url: str, step: int, text: str) -> "Scratchpad":
        """Record the page the agent is currently looking at.

        Done in code on every step, not asked for. `page_text` already
        ships in the prompt, so the model had no reason to ever call
        `read_page_text`, and so nothing was captured: three Gmail runs
        recorded entries=0 and the model transcribed the page into
        `notes` instead. That transcription is ~1,300 output tokens, and
        output tokens are the latency (25,087 in / 191 out = 4.3s;
        25,085 in / 3,612 out = 41.3s, same prompt).

        It is also what makes memory work at all. Before this, the page
        text was live-only and the AX tree is ref-scoped, so navigating
        away destroyed both and the only way to keep a finding was to
        write it down.

        This is now the *only* way memory is written. The model has no
        write action, because it used every one it had to transcribe the
        page it was already looking at: 25 `append_scratchpad` calls
        across every recorded run, ~17,000 chars of them a copy of the
        page text in the prompt, and the six runs with the largest
        `tokens_out` are exactly the six whose final note was
        transcript-shaped.
        """
        body = (text or "").strip()
        if not body:
            return self
        digest = body[:DIGEST_LEN] + ("…" if len(body) > DIGEST_LEN else "")
        return self.with_entry(MemoryEntry(
            id=self.next_id(), step=step, selector="page", around=None,
            digest=digest, body=body, was_truncated=False, url=url,
        ))

    def with_entry(self, entry: MemoryEntry) -> "Scratchpad":
        return Scratchpad(
            entries=self.entries + [entry],
            notes=self.notes,
        )

    def lookup(self, entry_id: str) -> MemoryEntry | None:
        for e in self.entries:
            if e.id == entry_id:
                return e
        return None


class AgentTurn(BaseModel):
    task: str
    step_number: int
    scratchpad_entries: list[MemoryEntry]
    current_url: str
    current_page_title: str
    ax_tree: str
    ax_diff: str
    step_summaries: list[StepSummary]
    # innerText of the current page. Ships every step rather than waiting for
    # a read_page_text call: the accessibility tree routinely omits the values
    # a question is actually about (a star count, a price, a total).
    page_text: str = ""
    # A mid-task correction from the user, drained out of AgentDeps into the
    # next turn. Empty on every step that has not received one.
    steering: str = ""


class ActionCall(BaseModel):
    """One action in a multi-action decision. The agent may emit several of
    these per step (e.g. click + press_key)."""
    action: Literal[
        "navigate", "click", "type_text", "press_key", "scroll",
        "find_element", "read_page_text",
        "read_scratchpad", "recall_memory",
        "recall_conversation", "recall_steps",
        "task_complete", "cannot_complete", "ask_human",
    ]
    action_args: dict


class AgentDecision(BaseModel):
    reasoning: str
    thought: str
    # Not required. MiniMax-M3 measures ~1 run in 3 that returns
    # `final_result` with reasoning and thought and no `actions` key at
    # all; while this was required, pydantic-ai rejected the call before
    # any validator ran and sent a raw pydantic error back as the retry
    # prompt, which the model then repeated verbatim until the run died.
    # Defaulting it lets harness._require_actions re-ask with a message
    # that says what to emit instead.
    actions: list[ActionCall] = field(default_factory=list)


class ScriptTargetUnresolved(LookupError):
    """A scripted action arg could not be resolved in the current AX tree.

    Subclasses LookupError so existing `except LookupError` callers keep
    working, but the harness catches this name specifically: a bare
    LookupError from the model path (e.g. PROVIDER_REGISTRY[cfg.provider]
    raising KeyError on a bad provider) is a production misconfiguration and
    must not be reported as a scripted-perception failure.

    Lives here, not in testing/, because the production harness raises and
    catches it — see AgentDeps.scripted_planner's comment.
    """


class TaskResult(BaseModel):
    # `suspended` is the one status that is not a conclusion. The run stopped
    # at something only the user can clear (a sign-in wall they walked away
    # from), and the document stays resumable — deliberately NOT in the
    # harness's `_TERMINAL_DOC_STATUSES`, so `_resume_state` will take it.
    # Every other value seals the run for good.
    status: Literal["completed", "failed", "awaiting_human", "stagnated",
                    "suspended"]
    summary: str
    extracted_data: dict | None = None
    steps_taken: int = 0
    failure_reason: str | None = None
    tried: list[str] = field(default_factory=list)
    timing: dict | None = None  # per-component seconds + wall clock, set by harness
    # What the run cost, priced from the catalog by the harness. `None` means
    # "not priced" — an unknown model, a vendor with no published rate, or a
    # run that never reached a billable call — and is deliberately not `$0.00`.
    # A budget cap reads this, and a cap that cannot see a missing number would
    # spend exactly what it was set to bound.
    cost_usd: float | None = None
    # ponytail: set by the harness to the URL observed at the start of the
    # final step, so a benchmark record can tell "navigated then failed"
    # apart from "never left the start page". Approximation: pre-step, not
    # post-action — upgrade to a post-action read if a task that ends with a
    # click ever matters. Optional so existing callers/tests don't change.
    final_url: str = ""


@dataclass
class AgentDeps:
    user_id: str
    task: str
    cdp: object  # CDPRelay
    ws_send: object  # async callable: (dict) -> None
    task_id: str = ""  # set by harness for run logging
    # Which `tasks[]` entry this run writes. -1 before the first
    # `begin_task`, which is what a refusal path leaves behind.
    task_index: int = -1
    # The whole transcript, carried on deps so `_turn_to_prompt` can window
    # it. Read through the existing `_CURRENT_DEPS` global for the same
    # reason the secure-mode preamble is.
    conversation: list = field(default_factory=list)
    # Per-task model selection (BYOK / extension-driven; see model/registry.py)
    model_config: object = None  # ModelConfig | None — typed loosely to avoid cycle
    api_key: str | None = None
    client_ip: str = "127.0.0.1"
    human_input_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    # Mid-task steering, written by the WS receive loop while the agent task is
    # running. A plain slot, not a queue, on purpose: every approval site does
    # a bare `await deps.human_input_queue.get()` and branches on the string,
    # so a steering message landing there would be read as a *deny* — and one
    # arriving while an approval card is up would be consumed as the answer to
    # it. A queue is also unsellable, since steering has to be readable
    # without the harness ever blocking on it. Last write wins, which is the
    # behaviour you want: "actually, Wednesday" supersedes "Tuesday".
    steering: str = ""
    # Carried into the next turn, then cleared. Separate from `steering` so the
    # drain below the loop is a swap rather than a read.
    pending_steering: str = ""
    scratchpad: Scratchpad = field(default_factory=Scratchpad)
    step_summaries: list[StepSummary] = field(default_factory=list)
    step_number: int = 0
    result: TaskResult | None = None
    # URL observed at the top of the current step, before its actions run.
    # Read by the click cross-domain gate and stamped onto TaskResult.
    # final_url as "where the task ended up" — see TaskResult.final_url.
    step_url: str = ""
    # Context window of the model actually in use, read at observation time to
    # size the AX tree budget. Set before the loop by `_resolve_model`, not by
    # `_plan_step`: the budget is read at the TOP of a step and _plan_step runs
    # at the bottom of it, so a window set there is one step behind the tree it
    # sizes.
    context_window: int | None = None
    prev_targets: list = field(default_factory=list)  # AX targets from previous step for diffing
    policy: object = None  # Policy (services/brotto_orchestrator/policy/schema.Policy). Lazy import.
    # Test/dev only: a brotto_orchestrator.testing.ScriptedPlanner that
    # replaces agent.run() so perception and action work can be exercised
    # with no model, no key, and no network. Typed loosely to keep the
    # production package free of a dependency on testing/.
    scripted_planner: object = None
    # (etld1, action_type) tuples seen this session — used to gate the
    # first-time-seen prompt so it fires once per pair. Added on both
    # approve AND deny: on deny, the task is aborted anyway, but if a
    # retry path ever reuses this set we don't want to re-prompt
    # indefinitely on a persistent prompt-injection attempt.
    seen_first_time: set = field(default_factory=set)
    # eTLD+1 domains the user has explicitly approved navigating to this
    # task. In secure mode, the first navigation to any new domain
    # surfaces a "first navigation" approval; approve → add to set,
    # subsequent navigations to the same domain don't re-prompt.
    visited_domains: set = field(default_factory=set)
