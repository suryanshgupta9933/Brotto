"""The cross-domain click gate must ask BEFORE the click, not after.

`test_harness_policy.py` covers `_should_prompt_cross_domain_click`, the
pure decision. That is exactly why the ordering defect read as handled:
the predicate is right, and the predicate was never the thing that was
wrong. These tests drive `_execute_action` itself, with a fake CDP that
records every `click_ref`, so the assertion is about dispatch — the only
thing "before" and "after" actually differ on.

A click that carries a cross-domain href is asking to leave the user's
logged-in session for another organisation. Once dispatched it may have
carried a form POST, an OAuth code or a `?token=` with it, and denying
afterwards cannot un-navigate the tab. So: denied ⇒ `click_ref` was
never called.
"""

from __future__ import annotations

import asyncio

import pytest

pytestmark = pytest.mark.asyncio


class _FakeCDP:
    """Records dispatches. `clicked` is the whole point of this file."""

    def __init__(self, post_url: str | None = None):
        self.clicked: list[str] = []
        self.navigated: list[str] = []
        self._post_url = post_url

    async def click_ref(self, ref):
        self.clicked.append(ref)
        return f"clicked {ref}"

    async def navigate(self, url):
        self.navigated.append(url)

    async def get_current_url(self):
        return self._post_url

    async def refresh_target_map(self):
        pass

    async def wait_for_network_idle(self):
        pass


class _FakeAudit:
    def __init__(self):
        self.policies: list[dict] = []
        self.prompts: list[dict] = []

    def record_policy(self, *, step, kind, domain=None, action=None,
                      decision=None, user_decision=None):
        self.policies.append({"step": step, "kind": kind, "domain": domain,
                              "action": action, "decision": decision,
                              "user_decision": user_decision})

    def record_prompt(self, turn, *, kind, action, args, domain, reason):
        self.prompts.append({"kind": kind, "args": args, "domain": domain,
                             "reason": reason})
        return "p1"

    def resolve_prompt(self, pid, *, decision, response, wait_ms):
        pass


def _target(ref: str, href: str | None, role: str = "link"):
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    return SemanticTarget(ref_id=ref, tag="a", role=role, name=ref,
                          coordinates={}, href=href)


def _deps(cdp, reply: str):
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import Policy

    sent: list[dict] = []

    async def ws_send(frame):
        sent.append(frame)

    deps = AgentDeps(user_id="u", task="x", cdp=cdp, ws_send=ws_send,
                     policy=Policy())
    deps.human_input_queue.put_nowait(reply)
    deps.step_url = "https://shop.example/cart"
    deps.visited_domains.add("shop.example")
    return deps, sent


def _click(ref: str):
    from brotto_orchestrator.agent.context import ActionCall
    return ActionCall(action="click", action_args={"ref": ref})


async def test_a_denied_cross_domain_click_is_never_dispatched():
    """THE regression. The href says `evil.example`; the user says no;
    `click_ref` must not have been called at all."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://shop.example/cart")
    deps, sent = _deps(cdp, "no")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0,
        targets=[_target("t1", "https://evil.example/steal")],
    )

    assert cdp.clicked == [], "the click was dispatched after a deny"
    assert "[BLOCKED]" in outcome
    assert deps.result is not None
    assert deps.result.failure_reason == "user_denied"
    # The card the user was shown names the domain the href pointed at.
    assert [f["type"] for f in sent] == ["approval_required"]
    assert sent[0]["args"]["to_domain"] == "evil.example"


async def test_an_approved_cross_domain_click_dispatches_and_caches_the_domain():
    """Approve → the click happens, and the approval lands in
    `visited_domains` so the post-click check (which sees the same
    domain) does not ask a second time about the same hop."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://evil.example/steal")
    deps, sent = _deps(cdp, "yes")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0,
        targets=[_target("t1", "https://evil.example/steal")],
    )

    assert cdp.clicked == ["t1"]
    assert outcome == "clicked t1"
    assert "evil.example" in deps.visited_domains
    # One prompt, not two: the post-click gate reads the same set.
    assert len(sent) == 1
    assert "evil.example" not in [p["domain"] for p in audit.policies
                                  if p["user_decision"] == "denied"]


async def test_a_same_domain_click_is_never_gated():
    """An ordinary click on the page the user is already on asks nothing.
    `shop.example` is in `visited_domains`, so both the pre-flight and
    the post-click predicate return False."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://shop.example/checkout")
    deps, sent = _deps(cdp, "yes")
    audit = _FakeAudit()

    await _execute_action(
        _click("t1"), deps, audit=audit, turn=0,
        targets=[_target("t1", "https://shop.example/checkout")],
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_an_already_visited_domain_is_not_re_prompted():
    """The user's approval outlives the one step that asked for it."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://evil.example/steal")
    deps, sent = _deps(cdp, "no")
    deps.visited_domains.add("evil.example")
    audit = _FakeAudit()

    await _execute_action(
        _click("t1"), deps, audit=audit, turn=0,
        targets=[_target("t1", "https://evil.example/steal")],
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_a_subdomain_of_the_current_site_is_not_gated():
    """`mail.shop.example` is the same registered domain. A gate that
    fired here would train the user to approve the card reflexively."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://mail.shop.example/inbox")
    deps, sent = _deps(cdp, "yes")

    await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0,
        targets=[_target("t1", "https://mail.shop.example/inbox")],
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_a_ref_with_no_readable_href_falls_back_to_the_post_click_gate():
    """A JS `location.assign` button, or a ref that has left the tree, has
    no href to gate on. The pre-flight must resolve to nothing rather
    than invent a verdict — and the post-click check must still fire, so
    the worst case stays one step late instead of silent."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://evil.example/steal")
    deps, sent = _deps(cdp, "no")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0,
        targets=[_target("t1", None, role="button")],
    )

    # Dispatched, because nothing said otherwise — and then caught, one
    # step late, with the user told it already happened.
    assert cdp.clicked == ["t1"]
    assert len(sent) == 1
    assert "already happened" in sent[0]["reasoning"]
    assert "[BLOCKED]" in outcome


async def test_the_post_click_prompt_is_phrased_in_the_past_tense():
    """Two prompts that both predict cannot both be accurate. The one
    that runs after the click must read as a report."""
    from brotto_orchestrator.agent.harness import _execute_action

    cdp = _FakeCDP(post_url="https://evil.example/steal")
    deps, sent = _deps(cdp, "no")

    await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0,
        targets=[_target("t1", None, role="button")],
    )

    assert "would navigate" not in sent[0]["reasoning"]
