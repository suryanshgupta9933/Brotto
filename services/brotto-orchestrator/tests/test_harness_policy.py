"""Unit tests for the enterprise-redesign policy changes.

Pure-function tests, no I/O, no event loops, no LLM mocks. Each test
runs in <50ms. Integration coverage is in
`scripts/smoke_policy.py` (run separately, slower).

Covers:
- `_HUMAN_PAUSE_BUCKETS` set membership
- `_log_timings()` math: wall_agent = wall - human_pause
- `_make_user_denied_result()` / `_make_policy_blocked_result()` shapes
- GateDecision enum regression (no APPROVE member)
- `Policy` schema dropped whitelist/block_blacklisted cleanly
- `AgentDeps` no longer has `approved_domains`
"""

from __future__ import annotations

import pytest


# ── Schema regression ───────────────────────────────────────────────────────


def test_policy_schema_no_whitelist_field():
    """Whitelist was removed in the enterprise redesign. Pydantic's default
    is permissive (drops unknown fields) so old policy.json files still
    load — but the type itself must not declare `whitelist`."""
    from brotto_orchestrator.policy.schema import Policy
    assert "whitelist" not in Policy.model_fields


def test_policy_schema_no_block_blacklisted_field():
    from brotto_orchestrator.policy.schema import Policy
    assert "block_blacklisted" not in Policy.model_fields


def test_policy_schema_is_just_the_three_content_fields():
    from brotto_orchestrator.policy.schema import Policy
    assert set(Policy.model_fields) == {
        "blacklist", "sensitive_actions", "approved_domains",
    }


def test_policy_defaults():
    from brotto_orchestrator.policy.schema import Policy
    p = Policy()
    assert p.blacklist == []
    assert p.approved_domains == []
    assert p.sensitive_actions


def test_policy_user_policy_inherits():
    from brotto_orchestrator.policy.schema import Policy, UserPolicy
    # UserPolicy must remain a (sub)type of Policy so user_policy payloads
    # from the extension parse through the same shape.
    assert issubclass(UserPolicy, Policy)


# ── GateDecision regression ──────────────────────────────────────────────────


def test_gate_decision_has_no_approve():
    """APPROVE was removed — blacklist matches always block,
    and the old whitelist-approve path is gone. Regression guard against
    accidentally re-adding it."""
    from brotto_orchestrator.policy.gate import GateDecision
    assert not hasattr(GateDecision, "APPROVE")
    # And the surviving members are the only ones.
    assert {m.name for m in GateDecision} == {"ALLOW", "BLOCK", "N_A"}


# ── Timing math ─────────────────────────────────────────────────────────────


def test_human_pause_buckets_match_known_set():
    """Regression guard against silently adding a new human-pause site
    without including it in the wall-exclusion set."""
    from brotto_orchestrator.agent.harness import _HUMAN_PAUSE_BUCKETS, TIMING_BUCKETS
    # Every human-pause bucket must be declared in TIMING_BUCKETS (else
    # timers[...] += ... would KeyError at runtime).
    assert _HUMAN_PAUSE_BUCKETS.issubset(set(TIMING_BUCKETS))
    # And the set is non-empty — if you add a new prompt site, add it here.
    assert _HUMAN_PAUSE_BUCKETS == frozenset({"login_pause", "approval_pause"})


def test_log_timings_math():
    """Pure-function test of `_log_timings()`: wall_agent = wall - human_pause."""
    from brotto_orchestrator.agent.harness import (
        _HUMAN_PAUSE_BUCKETS, TIMING_BUCKETS, AgentHarness,
    )

    timings = {b: 0.0 for b in TIMING_BUCKETS}
    timings["observe"] = 0.5
    timings["model_plan"] = 1.5
    timings["execute"] = 0.5
    timings["login_pause"] = 1.2
    timings["approval_pause"] = 0.5
    wall = 4.2

    out = AgentHarness._log_timings("u", timings, steps=2, wall=wall)

    expected_human = sum(timings[b] for b in _HUMAN_PAUSE_BUCKETS)
    assert out["human_pause_s"] == round(expected_human, 3)
    assert out["wall_s"] == round(wall, 3)
    assert out["wall_agent_s"] == round(wall - expected_human, 3)
    # Invariant: wall_agent + human_pause ≈ wall.
    assert abs(out["wall_s"] - (out["wall_agent_s"] + out["human_pause_s"])) < 0.01


def test_log_timings_no_human_pause():
    """When no approvals happened, wall_agent == wall (all the time was
    agent work)."""
    from brotto_orchestrator.agent.harness import TIMING_BUCKETS, AgentHarness

    timings = {b: 0.0 for b in TIMING_BUCKETS}
    timings["observe"] = 0.3
    timings["model_plan"] = 1.0
    timings["execute"] = 0.2
    wall = 1.5

    out = AgentHarness._log_timings("u", timings, steps=1, wall=wall)

    assert out["human_pause_s"] == 0.0
    assert out["wall_agent_s"] == round(wall, 3)


def test_log_timings_human_pause_exceeds_wall_clamped_to_zero():
    """If the buckets somehow sum to more than wall (shouldn't happen but
    defensive), wall_agent is clamped at 0 — never negative."""
    from brotto_orchestrator.agent.harness import TIMING_BUCKETS, AgentHarness

    timings = {b: 0.0 for b in TIMING_BUCKETS}
    timings["login_pause"] = 5.0  # ridiculous
    wall = 1.0  # but wall is short

    out = AgentHarness._log_timings("u", timings, steps=1, wall=wall)

    assert out["wall_agent_s"] == 0.0  # max(0, wall - human_pause)
    assert out["human_pause_s"] == 5.0


# ── Abort-result helpers ────────────────────────────────────────────────────


def test_make_user_denied_result_shape():
    """The helper used by all 3 deny paths (critical, first-time-seen,
    domain-policy) — kept uniform so callers can't drift."""
    from brotto_orchestrator.agent.harness import _make_user_denied_result
    r = _make_user_denied_result(step=3, domain="evil.com", kind="critical action click")
    assert r.status == "failed"
    assert r.failure_reason == "user_denied"
    assert "evil.com" in r.summary
    assert "critical action click" in r.summary
    assert r.steps_taken == 4  # step + 1


def test_make_policy_blocked_result_shape():
    from brotto_orchestrator.agent.harness import _make_policy_blocked_result
    r = _make_policy_blocked_result(step=2, domain="bad.com")
    assert r.status == "failed"
    assert r.failure_reason == "policy_blocked"
    assert "bad.com" in r.summary
    assert r.steps_taken == 3


def test_user_denied_result_no_domain():
    """Critical-action denials don't have a domain; the summary should
    still be human-readable without one."""
    from brotto_orchestrator.agent.harness import _make_user_denied_result
    r = _make_user_denied_result(step=0, domain=None, kind="critical action")
    # Domain-suffix is only added when domain is non-None.
    assert r.summary == "User denied critical action approval"
    assert "critical action" in r.summary


# ── AgentDeps regression ────────────────────────────────────────────────────


def test_agent_deps_no_approved_domains():
    """approved_domains was only there to skip re-prompts on whitelisted
    domains. With deny-aborts-task semantics, that cache is gone — every
    approval is a deliberate user choice per task."""
    from brotto_orchestrator.agent.context import AgentDeps
    assert "approved_domains" not in AgentDeps.__dataclass_fields__


def test_agent_deeps_has_seen_first_time():
    """seen_first_time survives — it's the cache that prevents
    first-time-seen from re-firing on every step."""
    from brotto_orchestrator.agent.context import AgentDeps
    assert "seen_first_time" in AgentDeps.__dataclass_fields__


def test_agent_deps_has_policy_field():
    from brotto_orchestrator.agent.context import AgentDeps
    assert "policy" in AgentDeps.__dataclass_fields__


# ── Reason templates ────────────────────────────────────────────────────────


def test_first_time_seen_reason_format():
    """The reasoning string is what shows up in the sidepanel card.
    Format it once here; any break is caught immediately.

    It names the site and nothing else. It used to interpolate the action,
    which was the model's own `description` — so a click whose description
    was the page title rendered as "the agent wants to District by Zomato —
    Best Go Karting in Gurgaon (2026)", which is a page, not an action. A
    domain-scoped approval does not need a per-action label at all."""
    from brotto_orchestrator.agent.harness import _REASON_FIRST_TIME
    msg = _REASON_FIRST_TIME.format(domain="bank.com")
    assert "bank.com" in msg
    assert "?" in msg  # asks the user
    # Says the grant is standing, so "approve once" is legible up front.
    assert "later ones" in msg


# ── Bug A regression: first-time-seen guard ────────────────────────────────


class _FakeRunLog:
    """Minimal stand-in for AuditTrail — records record_policy calls."""
    def __init__(self):
        self.calls: list[dict] = []

    def record_policy(self, *, step, kind, domain=None, action=None,
                      decision=None, user_decision=None) -> None:
        self.calls.append({
            "step": step, "kind": kind, "domain": domain,
            "action": action, "decision": decision,
            "user_decision": user_decision,
        })


def test_first_time_seen_guard_blocks_on_blacklisted_url():
    """Defense-in-depth: when current_url is on the blacklist, the
    first-time-seen helper must short-circuit instead of letting the
    prompt fire."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.agent.harness import _guard_first_time_seen_blacklist
    from brotto_orchestrator.policy import Policy

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None,
        policy=Policy(blacklist=["evil.com"]),
    )
    log = _FakeRunLog()

    blocked = _guard_first_time_seen_blacklist(
        deps, current_url="https://evil.com/x", audit=log,
        step=3, action="click",
    )

    assert blocked is True
    assert deps.result is not None
    assert deps.result.failure_reason == "policy_blocked"
    assert deps.result.summary == "Blocked by policy: evil.com"
    # The audit row gets written for the compliance trail.
    assert len(log.calls) == 1
    assert log.calls[0]["kind"] == "domain_blocked"
    assert log.calls[0]["domain"] == "evil.com"
    assert log.calls[0]["decision"] == "block"


def test_first_time_seen_guard_passes_on_clean_url():
    """When the URL is NOT on the blacklist, the guard returns False
    and lets the normal first-time-seen logic proceed."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.agent.harness import _guard_first_time_seen_blacklist
    from brotto_orchestrator.policy import Policy

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None,
        policy=Policy(blacklist=["evil.com"]),
    )
    log = _FakeRunLog()

    blocked = _guard_first_time_seen_blacklist(
        deps, current_url="https://safe.com/x", audit=log,
        step=0, action="click",
    )

    assert blocked is False
    assert deps.result is None
    assert log.calls == []


def test_first_time_seen_guard_passes_through_without_a_policy():
    """AgentDeps.policy is None in ~20 test files, so a task with no policy
    configured is a real state, not a defensive one. The guard must fall
    through rather than raise on the unguarded `policy.blacklist`."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.agent.harness import _guard_first_time_seen_blacklist

    deps = AgentDeps(user_id="u", task="x", cdp=None, ws_send=None, policy=None)
    log = _FakeRunLog()

    blocked = _guard_first_time_seen_blacklist(
        deps, current_url="https://evil.com/x", audit=log,
        step=0, action="click",
    )

    assert blocked is False
    assert deps.result is None


# ── 2.1 stricter prompt ────────────────────────────────────────────────────


def test_the_policy_preamble_is_present_always():
    """There is no mode to switch off, so a configured policy must put the
    preamble in every prompt — the model has to know what is forbidden
    before it proposes an action, not after the gate blocks it."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.agent.prompt import policy_preamble
    from brotto_orchestrator.policy import Policy

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None,
        policy=Policy(blacklist=["evil.com", "banned.io"]),
    )
    turn = _prompt_with_deps(deps)
    assert "## BROTTO POLICY" in turn
    # The preamble interpolates the policy's actual blacklist so the LLM
    # knows what's forbidden without having to discover it.
    assert policy_preamble(deps.policy) in turn
    assert "evil.com" in turn
    assert "banned.io" in turn
    # And the standard SYSTEM_PROMPT bits still appear (we prepend, not replace).
    assert "## What is your next action(s)?" in turn


def test_the_data_boundary_reaches_the_model():
    """Redaction is a code boundary (agent/redact.py), so the prompt cannot
    enforce it. What the prompt can do is stop the model from trying to
    reconstruct a `[redacted]` value or asking the user for one."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import Policy

    turn = _prompt_with_deps(AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, policy=Policy(),
    ))
    assert "### Data you will not see" in turn
    assert "[redacted]" in turn



def _prompt_with_deps(deps):
    """Build the prompt with the same shape the harness uses, so we can
    assert on the result. Mirrors `_turn_to_prompt` but accepts a deps
    so each test can supply its own policy."""
    from brotto_orchestrator.agent.context import AgentTurn, AgentDeps
    from brotto_orchestrator.agent.harness import _turn_to_prompt

    # Build a minimal AgentTurn — values irrelevant to the preamble check.
    turn = AgentTurn(
        task="x", step_number=0, scratchpad_notes="", scratchpad_entries=[],
        current_url="https://example.com", current_page_title="t",
        ax_tree="", ax_diff="", step_summaries=[],
    )
    # `_turn_to_prompt(turn)` doesn't take deps today — the policy preamble
    # wiring needs to read from somewhere. The harness will pass deps
    # through; for the unit test we monkey-patch the helper to consult
    # the deps global below.
    from brotto_orchestrator.agent import harness as h
    h._TEST_DEPS = deps
    try:
        return _turn_to_prompt(turn)
    finally:
        h._TEST_DEPS = None


# ── 2.2 sensitive-action schema + guardrail ────────────────────────────────


def test_policy_schema_has_sensitive_actions_field():
    """New field: curated list of irreversible action patterns that
    always require approval."""
    from brotto_orchestrator.policy.schema import Policy
    assert "sensitive_actions" in Policy.model_fields


def test_policy_sensitive_actions_default_nonempty():
    from brotto_orchestrator.policy.schema import Policy
    p = Policy()
    assert isinstance(p.sensitive_actions, list)
    assert len(p.sensitive_actions) >= 3  # at least a sane default


def test_check_sensitive_action_matches_the_name():
    from brotto_orchestrator.agent.guardrails import check_sensitive_action
    from brotto_orchestrator.policy import Policy
    p = Policy(sensitive_actions=["payment", "delete_record"])
    assert check_sensitive_action("payment", {"ref": "x"}, p) is True
    assert check_sensitive_action("delete_record", {"ref": "y"}, p) is True


def test_check_sensitive_action_non_matching_action():
    from brotto_orchestrator.agent.guardrails import check_sensitive_action
    from brotto_orchestrator.policy import Policy
    p = Policy(sensitive_actions=["payment"])
    assert check_sensitive_action("click", {"ref": "x"}, p) is False


def test_check_sensitive_action_matches_args_keyword():
    """Some sensitive patterns show up in action_args, not the action name
    (e.g. a click with `description="delete_record"`)."""
    from brotto_orchestrator.agent.guardrails import check_sensitive_action
    from brotto_orchestrator.policy import Policy
    p = Policy(sensitive_actions=["payment", "delete_record"])
    # Substring match — admin's `delete_record` pattern hits the
    # `description="delete_record ..."` arg.
    assert check_sensitive_action(
        "click",
        {"ref": "btn1", "description": "delete_record permanently"},
        p,
    ) is True
    # And the absence case — a benign description doesn't trigger.
    assert check_sensitive_action(
        "click",
        {"ref": "btn1", "description": "open menu"},
        p,
    ) is False


def test_check_sensitive_action_empty_list_returns_false():
    from brotto_orchestrator.agent.guardrails import check_sensitive_action
    from brotto_orchestrator.policy import Policy
    p = Policy(sensitive_actions=[])
    assert check_sensitive_action("payment", {}, p) is False


# ── 2.3 visited_domains on AgentDeps ───────────────────────────────────────


def test_agent_deps_has_visited_domains():
    from brotto_orchestrator.agent.context import AgentDeps
    assert "visited_domains" in AgentDeps.__dataclass_fields__


# ── regression: terminal actions must not trigger approval prompts ─────────


def test_first_time_seen_skips_terminal_actions():
    """Regression for the bug where the agent emitting cannot_complete
    prompted the user to approve the failure."""
    from brotto_orchestrator.agent.harness import (
        _NEVER_APPROVE, _TERMINAL_ACTIONS, _INTERNAL_ACTIONS, _QUESTION_ACTIONS,
    )
    # Every terminal / internal / question action is in the deny set.
    for a in _TERMINAL_ACTIONS | _INTERNAL_ACTIONS | _QUESTION_ACTIONS:
        assert a in _NEVER_APPROVE, f"{a} not in _NEVER_APPROVE"
    # And conversely, every UI-action IS NOT in _NEVER_APPROVE — otherwise
    # a real action would be silently skipped.
    for a in ("navigate", "click", "type_text", "scroll", "read_page_text"):
        assert a not in _NEVER_APPROVE, f"{a} wrongly in _NEVER_APPROVE"


def test_check_sensitive_action_skips_internal_actions():
    """The sensitive-action regex shouldn't match on a memory recall whose
    model-written id happens to mention 'payment'."""
    from brotto_orchestrator.agent.guardrails import check_sensitive_action
    from brotto_orchestrator.policy import Policy
    p = Policy(sensitive_actions=["payment"])
    assert check_sensitive_action(
        "recall_memory",
        {"entry_id": "the page showing a payment flow"},
        p,
    ) is False
    # And the action name itself is matched (the bug case: action called
    # 'payment' regardless of args).
    assert check_sensitive_action("payment", {}, p) is True


# ── the aria-hidden supplement is never pre-approved ────────────────────────
#
# Surfacing a control the site marked `aria-hidden` is a disclosure change: it
# puts a deliberately-hidden control in front of an agent that will click it.
# The first-time-seen prompt is the last thing between the model and the user
# on that control, so it has to actually fire.


def _hidden_target(ref="0:-1", role="button", name="Delete account"):
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    return SemanticTarget(
        ref_id=ref, tag=role, role=role, name=name, hidden=True,
    )


def _click(ref, description="a button on the page"):
    from brotto_orchestrator.agent.context import ActionCall
    return ActionCall(
        action="click", action_args={"ref": ref, "description": description},
    )


# ── Standing grants survive the process ────────────────────────────────────


@pytest.mark.asyncio
async def test_a_granted_domain_is_written_to_the_user_policy_file(tmp_path, monkeypatch):
    """The whole point of the grant is that it outlives the run. Without a
    file, `_seed_granted_domains` finds nothing on the next task and the user
    is asked about the same site again — so this asserts the write, not just
    the in-memory set."""
    from brotto_orchestrator.agent.harness import _persist_domain_grant
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    await _persist_domain_grant(deps, "bank.com")

    assert pol.load_granted_domains("10.0.0.9") == ["bank.com"]


@pytest.mark.asyncio
async def test_a_grant_does_not_clobber_the_blacklist(tmp_path, monkeypatch):
    """The grant and the blacklist are two fields of ONE file, written by two
    different code paths — the harness on Approve, the panel on Save. A grant
    written as a whole-payload save would silently empty the user's blocklist,
    and the file it lands in is hashed from an IP, so the damage is invisible
    in review."""
    from brotto_orchestrator.agent.harness import _persist_domain_grant
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    pol.save_if_changed("10.0.0.9", {"blacklist": ["bad.example"]})

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    await _persist_domain_grant(deps, "bank.com")

    on_disk = pol.load("10.0.0.9")
    assert on_disk["blacklist"] == ["bad.example"]
    assert on_disk["approved_domains"] == ["bank.com"]


def test_a_restarted_server_loads_the_grant_into_visited_domains(tmp_path, monkeypatch):
    """A brand-new `AgentDeps` — a new task, or a new process — with an
    empty `visited_domains`, must come up already holding the grant. This is
    the case the user reported: approving a site and being asked about it
    again on the next task."""
    from brotto_orchestrator.agent.harness import _seed_granted_domains
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    pol.grant_domain("10.0.0.9", "google.com")

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    assert deps.visited_domains == set()
    _seed_granted_domains(deps)
    assert "google.com" in deps.visited_domains


def test_seeding_grants_keeps_what_the_resume_path_already_found(tmp_path, monkeypatch):
    """Union, never assignment. The resume path populates `visited_domains`
    from the audit before this runs; a grant on disk has to add to that, or a
    resumed run would lose the navigation approvals it just restored."""
    from brotto_orchestrator.agent.harness import _seed_granted_domains
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    pol.grant_domain("10.0.0.9", "google.com")

    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    deps.visited_domains.add("mail.example")
    _seed_granted_domains(deps)
    assert deps.visited_domains == {"mail.example", "google.com"}


def test_a_user_with_no_policy_file_is_asked_as_normal(tmp_path, monkeypatch):
    """The failure direction has to be "ask", not "assume". A brand-new user,
    a never-written file, and a corrupt one all have to leave the gate armed."""
    from brotto_orchestrator.agent.harness import _seed_granted_domains
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    _seed_granted_domains(deps)
    assert deps.visited_domains == set()

    (tmp_path / pol._key_to_filename("10.0.0.9")).write_text("{not json")
    _seed_granted_domains(deps)
    assert deps.visited_domains == set()


@pytest.mark.asyncio
async def test_a_hidden_control_never_becomes_a_standing_grant(tmp_path, monkeypatch):
    """Only the loop's bare-domain path calls `grant_domain`. A hidden target
    is approved per-run, so a grant written from it would launder a
    page-injected control into a permanent permission."""
    from brotto_orchestrator.agent.harness import _first_time_key, _persist_domain_grant
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    deps = AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None, client_ip="10.0.0.9",
    )
    hidden_key = _first_time_key("shop.example", _click("0:-1"), [_hidden_target()])
    assert hidden_key != "shop.example"

    # The loop's approve branch is guarded by nothing but the key shape, so
    # pin that the key is what stops it: a domain-keyed call would persist.
    if hidden_key == "shop.example":
        await _persist_domain_grant(deps, hidden_key)
    assert pol.load_granted_domains("10.0.0.9") == []


def test_a_hidden_destructive_control_is_not_pre_approved():
    """Review Focus #3. The user approved this domain — twenty steps ago, or
    on a run last week. The site then put a "Delete account" button where
    assistive technology cannot see it. That button must not inherit the
    standing grant — which is the whole reason the supplement is safe to
    ship at all."""
    from brotto_orchestrator.agent.harness import _first_time_key
    from brotto_orchestrator.policy import Policy
    from brotto_orchestrator.policy.gate import check_first_time_seen

    policy = Policy()
    domain = "shop.example"
    targets = [_hidden_target()]
    call = _click("0:-1")

    # The site is on a standing grant: approved for ordinary controls.
    seen = {domain}

    key = _first_time_key(domain, call, targets)
    assert key == f"{domain}:hidden", "a hidden control reused a live approval"
    # …and `check_first_time_seen` is what decides whether to prompt, so the
    # question is not "is the key different" but "does this still prompt".
    assert check_first_time_seen(key, seen, policy) is True, (
        "a hidden destructive control was treated as pre-approved"
    )


def test_an_ordinary_control_still_reuses_its_domain_approval():
    """The other half: the rule narrows to supplemented targets only. A normal
    click on an already-approved domain must not start prompting again, or
    every run on a real site would ask the user a dozen times a task."""
    from brotto_orchestrator.agent.harness import _first_time_key
    from brotto_orchestrator.policy.gate import check_first_time_seen
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    from brotto_orchestrator.policy import Policy

    visible = SemanticTarget(
        ref_id="0:7", tag="button", role="button", name="Save draft",
    )
    key = _first_time_key("shop.example", _click("0:7"), [visible])
    assert key == "shop.example"
    assert check_first_time_seen(key, {"shop.example"}, Policy()) is False


def test_a_standing_grant_does_not_cover_a_hidden_control():
    """The shortcut in the approval loop skips a domain the user has already
    granted — but only for the ordinary key. This is that condition, pinned
    separately from the key function: the two are read in different files, and
    a grant that leaked onto `domain:hidden` would let a page-injected
    "Delete account" through on a site approved weeks earlier."""
    from brotto_orchestrator.agent.harness import _first_time_key

    domain = "shop.example"
    hidden_key = _first_time_key(domain, _click("0:-1"), [_hidden_target()])
    granted = {domain}

    # The loop's own condition: skip only when the key IS the bare domain.
    assert (hidden_key == domain and domain in granted) is False, (
        "a hidden control would ride the standing grant"
    )


def test_a_hidden_control_prompts_only_once():
    """One extra prompt, not one per step. The key is added to the seen set
    after the user answers, so a run that clicks a hidden control on every
    step asks once — the same contract every other first-time action has."""
    from brotto_orchestrator.agent.harness import _first_time_key
    from brotto_orchestrator.policy.gate import check_first_time_seen
    from brotto_orchestrator.policy import Policy

    policy = Policy()
    seen = set()
    call = _click("0:-1")
    targets = [_hidden_target()]
    assert check_first_time_seen(_first_time_key("shop.example", call, targets), seen, policy) is True
    seen.add(_first_time_key("shop.example", call, targets))
    assert check_first_time_seen(_first_time_key("shop.example", call, targets), seen, policy) is False


def test_an_unresolvable_ref_is_treated_as_ordinary():
    """`getattr` rather than a hard attribute read, and a missing target falls
    back to the plain key. A ref the observation no longer carries must not
    crash the approval gate — and must not silently get the stronger rule
    either, because a hidden control we cannot identify is one we cannot
    describe to the user in the prompt."""
    from brotto_orchestrator.agent.harness import _first_time_key
    key = _first_time_key("shop.example", _click("9:9"), [])
    assert key == "shop.example"



# ── click cross-domain approval (Change 3) ──────────────────────────────────


def _mk_deps():
    """Minimal AgentDeps for testing the pure cross-domain helper. The
    helper only reads `policy` and `visited_domains`, so we leave
    everything else default."""
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import Policy
    return AgentDeps(
        user_id="u", task="x", cdp=None, ws_send=None,
        policy=Policy(),
    )



def test_should_prompt_cross_domain_click_same_etld_no_prompt():
    """google.com → www.google.com are the same eTLD+1, no prompt."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    needs, target = _should_prompt_cross_domain_click(
        "https://google.com/", "https://www.google.com/search?q=x", deps,
    )
    assert needs is False


def test_should_prompt_cross_domain_click_new_domain_prompts():
    """google.com → apple.com (different eTLD+1), apple not yet visited → prompt.
    Note: mail.google.com and google.com share google.com as eTLD+1, so
    that pair does NOT cross — same registered domain."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    needs, target = _should_prompt_cross_domain_click(
        "https://google.com/search", "https://apple.com/iphone", deps,
    )
    assert needs is True
    assert target == "apple.com"


def test_should_prompt_cross_domain_click_mail_google_same_etld_no_prompt():
    """Regression: mail.google.com is NOT a different eTLD+1 from
    google.com (subdomain of the same registered domain). Clicking
    from google.com search to mail.google.com inbox must NOT prompt."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    needs, target = _should_prompt_cross_domain_click(
        "https://google.com/search", "https://mail.google.com/inbox", deps,
    )
    assert needs is False


def test_should_prompt_cross_domain_click_already_visited_no_prompt():
    """If we've already approved apple.com earlier in this task
    (via navigate or click), returning there doesn't re-prompt."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    deps.visited_domains.add("apple.com")
    needs, target = _should_prompt_cross_domain_click(
        "https://google.com/search", "https://apple.com/iphone", deps,
    )
    assert needs is False


def test_should_prompt_cross_domain_click_no_pre_url_no_prompt():
    """Defensive: if we don't know where we started (step_url was
    never set), don't fabricate a prompt. Limit prompt fire to cases
    where we can actually compare."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    needs, target = _should_prompt_cross_domain_click(
        None, "https://mail.google.com/", deps,
    )
    assert needs is False


def test_should_prompt_cross_domain_click_unparseable_urls_no_prompt():
    """Garbage URLs fall back to safe-default (no prompt) rather than
    raising or fabricating one. Better to under-prompt than crash the
    harness on a weird URL."""
    from brotto_orchestrator.agent.harness import _should_prompt_cross_domain_click
    deps = _mk_deps()
    needs, target = _should_prompt_cross_domain_click(
        "not a url", "also not a url", deps,
    )
    assert needs is False


def test_looks_like_blacklist_hit_helper():
    """Light heuristic used to decide whether a `cannot_complete` is a
    policy preflight."""
    from brotto_orchestrator.agent.harness import _looks_like_blacklist_hit
    # Substring match in either direction.
    assert _looks_like_blacklist_hit("mail.google.com", "Gmail (mail.google.com) is blocked")
    assert _looks_like_blacklist_hit("evil.com", "Bad domain: evil.com is forbidden")
    # URL artefacts in the pattern are stripped before matching.
    assert _looks_like_blacklist_hit("https://mail.google.com/", "Gmail (mail.google.com) is blocked")
    # Case-insensitive.
    assert _looks_like_blacklist_hit("mail.google.com", "MAIL.GOOGLE.COM is bad")
    # No match when neither contains the other.
    assert not _looks_like_blacklist_hit("evil.com", "Could not reach server")
    # Defensive: empty inputs.
    assert not _looks_like_blacklist_hit("", "evil.com mentioned")
    assert not _looks_like_blacklist_hit("evil.com", "")


# ── persistence: user policy survives restart ─────────────────────────────


def test_persist_save_and_load(tmp_path, monkeypatch):
    """Round-trip a user policy through the disk store."""
    monkeypatch.setenv("BROTTO_USER_POLICY_DIR", str(tmp_path))
    # Reset module-level path cache by re-importing fresh.
    import importlib
    from brotto_orchestrator.policy import persist
    importlib.reload(persist)
    persist.save("user-A", {"blacklist": ["evil.com"]})
    persist.save("user-B", {"blacklist": []})
    # load by key
    a = persist.load("user-A")
    assert a is not None
    assert a["blacklist"] == ["evil.com"]
    # Bookkeeping fields are added by save_if_changed.
    assert "_saved_at" in a
    assert "_content_sha256" in a
    assert persist.load("user-NONEXISTENT") is None
    # load_all returns both.
    all_loaded = persist.load_all()
    assert len(all_loaded) == 2


def test_persist_atomic_no_partial_on_corruption(tmp_path, monkeypatch):
    """A corrupt JSON file doesn't bring the loader down — it just
    skips that file. Operators can inspect manually post-mortem."""
    monkeypatch.setenv("BROTTO_USER_POLICY_DIR", str(tmp_path))
    import importlib
    from brotto_orchestrator.policy import persist
    importlib.reload(persist)
    persist.save("user-X", {})
    files = list(tmp_path.glob("*.json"))
    assert len(files) == 1
    files[0].write_text("{not json")
    assert persist.load_all() == {}
    assert persist.load("user-X") is None


def test_persist_save_if_changed_skips_no_op(tmp_path, monkeypatch):
    """The user's actual ask: re-saving identical content must NOT
    re-touch the file. Otherwise the sidepanel's 'Last verified' clock
    resets on every click and we do useless disk IO."""
    monkeypatch.setenv("BROTTO_USER_POLICY_DIR", str(tmp_path))
    import importlib
    import time
    from brotto_orchestrator.policy import persist
    importlib.reload(persist)

    payload = {"blacklist": ["foo.com"]}
    # First save writes.
    assert persist.save_if_changed("user-Y", payload) is True
    mtime_before = (tmp_path / persist._key_to_filename("user-Y")).stat().st_mtime_ns
    # Same content — no write.
    time.sleep(0.05)  # ensure mtime would change if a write happened
    assert persist.save_if_changed("user-Y", payload) is False
    mtime_after = (tmp_path / persist._key_to_filename("user-Y")).stat().st_mtime_ns
    assert mtime_before == mtime_after, "no-op save touched the file"
    # A real change writes.
    assert persist.save_if_changed(
        "user-Y", {"blacklist": ["foo.com", "bar.com"]},
    ) is True
    # Re-save the same content again — no write.
    assert persist.save_if_changed(
        "user-Y", {"blacklist": ["foo.com", "bar.com"]},
    ) is False
    # Different key with same payload — IS a write (separate file).
    assert persist.save_if_changed(
        "user-Z", {"blacklist": ["foo.com"]},
    ) is True


def test_persist_load_strips_bookkeeping(tmp_path, monkeypatch):
    """Reload returns the raw JSON including bookkeeping fields, but
    the hash comparison excludes them so a save with the same visible
    payload still skips."""
    monkeypatch.setenv("BROTTO_USER_POLICY_DIR", str(tmp_path))
    import importlib
    from brotto_orchestrator.policy import persist
    importlib.reload(persist)
    payload = {"blacklist": ["a.com"]}
    persist.save_if_changed("user-K", payload)
    # Hash with bookkeeping fields stripped.
    hash_first = persist._payload_hash(
        persist.load("user-K") and {k: v for k, v in persist.load("user-K").items() if not k.startswith("_")}
    )
    # Re-save same payload — must NOT write.
    assert persist.save_if_changed("user-K", payload) is False
    # Bookkeeping fields on disk (timestamp etc.) don't change the hash.
    loaded = persist.load("user-K")
    visible = {k: v for k, v in loaded.items() if not k.startswith("_")}
    assert persist._payload_hash(visible) == hash_first



def test_a_task_start_policy_write_cannot_erase_grants(monkeypatch, tmp_path):
    """Every run used to wipe the domain approvals from the last one.

    `_persist_user_policy` writes the document wholesale via
    `save_if_changed`, and the two WebSocket callers pass `{blacklist}`
    only — the sidepanel's `userPolicy` carries nothing else. So the grant
    made on run N was gone before run N+1 seeded `visited_domains`, and
    the user was asked to approve the same site on every single task.
    `/v1/policy_ack` had worked around this at its call site; the other
    two had not.

    The payload here is shaped like the one `task_start` builds, which is
    what makes the regression legible: if a future caller widens that
    payload's fields, this still asserts the grant survived.
    """
    from brotto_orchestrator.main import _persist_user_policy
    from brotto_orchestrator.policy import persist

    monkeypatch.setattr(persist, "_DIR", tmp_path)

    _persist_user_policy("device-a", {"blacklist": ["blocked.example"]})
    persist.grant_domain("device-a", "bank.example")

    # A later task_start: the sidepanel's policy view, which knows only
    # about the blacklist.
    _persist_user_policy("device-a", {"blacklist": ["blocked.example"]})

    assert persist.load_granted_domains("device-a") == ["bank.example"]


# ── The page the task started on is not a site to ask about ─────────────────


class _FakeCDP:
    """Only the one call the seeder makes."""

    def __init__(self, url: str):
        self.url = url

    async def get_current_url(self) -> str:
        return self.url


async def _seed_starting(url: str):
    from brotto_orchestrator.agent.harness import _seed_starting_domain
    from brotto_orchestrator.agent.context import AgentDeps

    deps = AgentDeps(user_id="u", task="x", cdp=_FakeCDP(url),
                     ws_send=None, client_ip="10.0.0.9")
    await _seed_starting_domain(deps)
    return deps


@pytest.mark.asyncio
async def test_the_page_the_task_started_on_is_not_re_asked():
    """The user wrote the task while looking at this page, so approving it was
    the prompt with only one answer — and it fired before Brotto had done
    anything at all. The eTLD+1 is what gets seeded, not the whole URL."""
    deps = await _seed_starting("https://mail.google.com/mail/u/0/#inbox")
    assert deps.visited_domains == {"google.com"}


@pytest.mark.asyncio
async def test_a_different_site_still_asks_after_starting_elsewhere():
    """The other half of the same fix, and the half that matters for safety:
    seeding the starting page grants *that* site, not the run."""
    deps = await _seed_starting("https://mail.google.com/mail/u/0/#inbox")
    assert "github.com" not in deps.visited_domains


@pytest.mark.asyncio
async def test_an_unreadable_tab_does_not_abort_the_task():
    """A tab Brotto cannot read is a failed run elsewhere, not a reason to
    refuse to start. The seeder swallows it and every gate simply re-asks."""
    from brotto_orchestrator.agent.harness import _seed_starting_domain
    from brotto_orchestrator.agent.context import AgentDeps

    class _NoDebugger:
        async def get_current_url(self):
            raise RuntimeError("no debugger attached")

    deps = AgentDeps(user_id="u", task="x", cdp=_NoDebugger(),
                     ws_send=None, client_ip="10.0.0.9")
    await _seed_starting_domain(deps)
    assert deps.visited_domains == set()


# ---------------------------------------------------------------------------
# Grants must survive a host whose filesystem does not
# ---------------------------------------------------------------------------

def test_client_grants_survive_a_wiped_policy_file(tmp_path, monkeypatch):
    """The policy file is server-local, and a dyno restart empties it. The
    client keeps its own copy in chrome.storage.local and ships it on every
    task_start, so the two stores have to union — keying off either one alone
    silently re-asks the user about a site they already approved."""
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    # Ephemeral host: the disk starts empty on every boot.
    assert pol.load_granted_domains("dev-1") == []

    main._persist_user_policy("dev-1", {
        "blacklist": ["bad.example"],
        "approved_domains": ["bank.com"],
    })

    assert pol.load_granted_domains("dev-1") == ["bank.com"]
    assert pol.load("dev-1")["blacklist"] == ["bad.example"]


def test_a_client_save_does_not_drop_a_grant_only_disk_knows(tmp_path, monkeypatch):
    """The mirror image: the client has not shipped the grant yet (it was made
    this run, and the frame has not landed), but the file has it. Dropping it
    here is the same bug from the other side."""
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    pol.grant_domain("dev-1", "bank.com")

    # The sidepanel ships only the blacklist.
    main._persist_user_policy("dev-1", {"blacklist": []})

    assert pol.load_granted_domains("dev-1") == ["bank.com"]


def test_a_malformed_blacklist_leaves_the_stored_one_alone(tmp_path, monkeypatch):
    """Fail-closed on the field that must never be lost.

    The obvious coercion here is `_string_list` returning `[]` for junk,
    and then `save_if_changed` writes the empty list over a populated
    document. The user's blocklist disappears because of a bad payload —
    strictly worse than the write not happening, and it is silent.

    So a *present but malformed* blacklist raises into the caller's blanket
    `except`, which leaves the stored document byte-for-byte.
    """
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)
    main._persist_user_policy("dev-1", {"blacklist": ["bad.example"]})

    for junk in ("bad.example", {"a": 1}, 7, ["ok.example", 42]):
        main._persist_user_policy("dev-1", {"blacklist": junk})

        assert pol.load("dev-1")["blacklist"] == ["bad.example"], junk


def test_an_absent_blacklist_is_not_malformed(tmp_path, monkeypatch):
    """The other half: absence is the normal case, not junk.

    `_persist_user_policy` used to be handed payloads that omit the
    blacklist entirely. If "absent" raised like "malformed" does, every
    one of those callers would stop persisting grants.
    """
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)

    main._persist_user_policy("dev-1", {"blacklist": ["bad.example"]})
    main._persist_user_policy("dev-1", {"approved_domains": ["bank.com"]})

    assert pol.load("dev-1")["blacklist"] == []


def test_a_junk_grant_cannot_enter_the_navigation_gate(tmp_path, monkeypatch):
    """The union has the opposite policy to the blacklist, on purpose.

    A grant is a *permission*: a value that could never match an eTLD+1
    is worthless, so it is dropped. A blacklist entry that got dropped is
    a lost protection, so the whole write is refused instead. Neither
    case may raise — raising on the grant would discard the user's real
    blocklist over one corrupt entry.
    """
    from brotto_orchestrator import main
    from brotto_orchestrator.policy import persist as pol

    monkeypatch.setattr(pol, "_DIR", tmp_path)

    main._persist_user_policy("dev-1", {
        "blacklist": ["bad.example"],
        "approved_domains": ["Bank.COM", "ok.example", "not a host", "*.evil.com", 42],
    })

    # Lowercased — `etld1()` always returns lowercase, so a case differential
    # is two records for one site that look separately revocable.
    assert pol.load_granted_domains("dev-1") == ["bank.com", "ok.example"]
    assert pol.load("dev-1")["blacklist"] == ["bad.example"]
