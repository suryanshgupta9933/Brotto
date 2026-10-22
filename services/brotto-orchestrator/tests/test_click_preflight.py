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
    """Records dispatches. `clicked` is the whole point of this file.

    `targets` is the tree the step's targets came from and `recheck` is what
    the tree looks like when the harness reads it again after the approval
    — the same list unless a test says otherwise, which is how a page that
    rewrites a link mid-approval is written down.
    """

    def __init__(self, post_url: str | None = None, targets=(), recheck=None):
        self.clicked: list[str] = []
        self.navigated: list[str] = []
        self.targets = list(targets)
        self.recheck = list(recheck) if recheck is not None else self.targets
        self._post_url = post_url

    async def click_ref(self, ref):
        self.clicked.append(ref)
        return f"clicked {ref}"

    async def navigate(self, url):
        self.navigated.append(url)

    async def get_current_url(self):
        return self._post_url

    async def get_targets(self):
        return list(self.recheck)

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


def _tree(href, ref: str = "t1", role: str = "link") -> list:
    """The one target list, handed to both `_execute_action` and the fake
    relay — they are the same tree in life."""
    return [_target(ref, href, role)]


def _deps(cdp, reply: str, policy=None):
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.policy import Policy

    sent: list[dict] = []

    async def ws_send(frame):
        sent.append(frame)

    deps = AgentDeps(user_id="u", task="x", cdp=cdp, ws_send=ws_send,
                     policy=Policy() if policy is None else policy)
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

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://shop.example/cart", targets=tree)
    deps, sent = _deps(cdp, "no")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
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

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, sent = _deps(cdp, "yes")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
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

    tree = _tree("https://shop.example/checkout")
    cdp = _FakeCDP(post_url="https://shop.example/checkout", targets=tree)
    deps, sent = _deps(cdp, "yes")
    audit = _FakeAudit()

    await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_an_already_visited_domain_is_not_re_prompted():
    """The user's approval outlives the one step that asked for it."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, sent = _deps(cdp, "no")
    deps.visited_domains.add("evil.example")
    audit = _FakeAudit()

    await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_a_subdomain_of_the_current_site_is_not_gated():
    """`mail.shop.example` is the same registered domain. A gate that
    fired here would train the user to approve the card reflexively."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree("https://mail.shop.example/inbox")
    cdp = _FakeCDP(post_url="https://mail.shop.example/inbox", targets=tree)
    deps, sent = _deps(cdp, "yes")

    await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert cdp.clicked == ["t1"]
    assert sent == []


async def test_a_ref_with_no_readable_href_falls_back_to_the_post_click_gate():
    """A JS `location.assign` button, or a ref that has left the tree, has
    no href to gate on. The pre-flight must resolve to nothing rather
    than invent a verdict — and the post-click check must still fire, so
    the worst case stays one step late instead of silent."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree(None, role="button")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, sent = _deps(cdp, "no")
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
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

    tree = _tree(None, role="button")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, sent = _deps(cdp, "no")

    await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert "would navigate" not in sent[0]["reasoning"]


async def test_a_blacklisted_destination_is_blocked_without_asking():
    """The blacklist is the user's own "never go here", and `navigate`
    reads it before dispatch. A ref click names its destination too, so
    asking there would have downgraded the one verb that *can* check in
    advance to a question."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.policy import Policy

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://shop.example/cart", targets=tree)
    # Even an approving user must not get the question asked.
    deps, sent = _deps(cdp, "yes", policy=Policy(blacklist=["evil.example"]))
    audit = _FakeAudit()

    outcome = await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
    )

    assert cdp.clicked == [], "a blacklisted href was dispatched"
    assert sent == [], "the user was asked about a site they blocked"
    assert "[BLOCKED]" in outcome
    assert deps.result is not None
    # A block is not a grant: the domain must not become pre-approved.
    assert "evil.example" not in deps.visited_domains
    assert any(p["kind"] == "click_blocked_pre" and p["decision"] == "block"
               for p in audit.policies), audit.policies


@pytest.mark.parametrize("href", [
    r"\\evil.example/steal",      # WHATWG resolves this to //evil.example/x
    "//evil.example/steal",       # protocol-relative: no scheme of its own
    "/checkout",                  # ordinary relative
    "javascript:fetch('/x')",     # no eTLD+1 to read
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "https://shop.example@evil.example/steal",   # userinfo reads left-to-right
])
async def test_an_untrusted_href_is_never_resolved_into_a_verdict(href):
    """None means "cannot read", never "same domain".

    Every one of these is a shape where a Python resolver disagrees with
    the browser: `\\evil.example/x` is a cross-origin navigation that
    `urljoin` keeps on this page, and the userinfo form reads as
    `shop.example` to a glance. Resolving them here would produce a
    same-domain verdict the browser would not honour — so they fall to
    the post-click gate, which reads what actually happened.
    """
    from brotto_orchestrator.agent.harness import _click_ref_href

    assert _click_ref_href(_click("t1"), _tree(href)) is None, href


async def test_a_backslash_href_dispatches_and_is_caught_after_the_fact():
    """The honest end state for an href the pre-flight cannot read: the
    click is not prevented (nothing said it was cross-domain), and the
    post-click gate is the line that catches it."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree(r"\\evil.example/steal")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, sent = _deps(cdp, "no")

    outcome = await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert cdp.clicked == ["t1"]
    assert len(sent) == 1
    assert "already happened" in sent[0]["reasoning"]
    assert "[BLOCKED]" in outcome


async def test_an_absolute_href_is_used_as_the_browser_resolved_it():
    """No `urljoin` on an href that CDP already resolved. A URL whose path
    looks like a relative one must not be re-based onto the current page."""
    from brotto_orchestrator.agent.harness import _click_ref_href

    href = "https://shop.example/a/../b?q=1"
    assert _click_ref_href(_click("t1"), _tree(href)) == href


async def test_a_href_that_changes_during_the_approval_is_not_clicked():
    """The TOCTOU. The href was read, the human spent seconds deciding,
    and the page rewrote the anchor. Approving `good.example` is not
    consent to be navigated to `evil.example` by it."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://shop.example/cart", targets=tree,
                   recheck=_tree("https://other.example/steal"))
    deps, sent = _deps(cdp, "yes")

    outcome = await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert cdp.clicked == [], "the click used a destination nobody approved"
    assert "Error executing" in outcome, outcome
    # Nothing was visited, so nothing was granted.
    assert "evil.example" not in deps.visited_domains


async def test_a_href_that_vanishes_during_the_approval_is_not_clicked():
    """The ref left the tree, or lost its href, while the human was
    reading. There is nothing left to compare the approval against, so
    it refuses rather than dispatching on a destination no longer read."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://shop.example/cart", targets=tree,
                   recheck=[])
    deps, _ = _deps(cdp, "yes")

    outcome = await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert cdp.clicked == []
    assert "Error executing" in outcome, outcome


async def test_a_href_that_survives_the_approval_unchanged_still_clicks():
    """The check must not refuse a page that simply did not move."""
    from brotto_orchestrator.agent.harness import _execute_action

    tree = _tree("https://evil.example/steal")
    cdp = _FakeCDP(post_url="https://evil.example/steal", targets=tree)
    deps, _ = _deps(cdp, "yes")

    await _execute_action(
        _click("t1"), deps, audit=_FakeAudit(), turn=0, targets=tree,
    )

    assert cdp.clicked == ["t1"]
    assert "evil.example" in deps.visited_domains


async def test_the_card_names_the_href_the_approval_is_checked_against():
    """The user is consenting to a destination, so the card says which —
    and the audit keeps the domain alone. The href is page-supplied and can
    carry a path, a query and a fragment that have no business on disk
    under `logs/sessions/`; `_ask_user`'s `frame_args` split is what keeps
    those two apart."""
    from brotto_orchestrator.agent.harness import _execute_action

    href = "https://evil.example/oauth/callback?code=secret-token"
    tree = _tree(href)
    cdp = _FakeCDP(post_url=href, targets=tree)
    deps, sent = _deps(cdp, "yes")
    audit = _FakeAudit()

    await _execute_action(
        _click("t1"), deps, audit=audit, turn=0, targets=tree,
    )

    assert sent[0]["args"]["to_url"] == href
    recorded = audit.prompts[0]["args"]
    assert "to_url" not in recorded
    assert "secret-token" not in str(recorded)
    assert recorded["to_domain"] == "evil.example"
