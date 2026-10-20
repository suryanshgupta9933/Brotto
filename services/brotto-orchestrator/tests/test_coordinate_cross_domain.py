"""What a coordinate click can and cannot be gated on.

`test_click_preflight.py` proves a ref `click` never reaches the browser
when its href says cross-domain and the user says no. **That assertion
cannot be written for `click_xy` / `focus_xy` / `type_xy`**, and the reason
is the whole point of this file.

`_coordinate_action` dispatches only when `elementFromPoint(x, y)` is a
`CANVAS` (harness.py:2168). A canvas has no href, no `link` role and no
destination attribute — whatever leaves the page leaves through a JS
handler on the pixel, and nothing readable exists before the press. There
is no `boundedPoint`-style resolution that helps either: it runs inside the
extension's `click_xy` handler, at dispatch, and returns `{x, y}` or null.

So these tests pin the half that *is* achievable today — the post-dispatch
check the click branch already runs as its fallback for an unreadable
href — and they say so in the assertions rather than implying a
pre-flight exists.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import _EXEC_FAILURE, _coordinate_action
from brotto_orchestrator.policy.gate import SCREENSHOT_CAPTURE_ENV
from brotto_orchestrator.policy.schema import Policy

PRE_URL = "https://example.com/sheet"


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setenv("BROTTO_COORDINATE_CLICK", "1")
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")


def _deps(cdp, policy=None, replies=("approve",)):
    deps = AgentDeps(user_id="u", task="t", cdp=cdp,
                     ws_send=AsyncMock(), policy=Policy() if policy is None
                     else policy)
    for r in replies:
        deps.human_input_queue.put_nowait(r)
    deps.step_url = PRE_URL
    deps.visited_domains.add("example.com")
    return deps


def _cdp(post_url: str | None = None):
    """Every coordinate click dispatches; `post_url` is where it lands.

    Two reads happen before the dispatch (pre-approval, and the re-check
    after the human answers — a page that moved during the approval wait is
    already refused there). Only the third is the landing.
    """
    cdp = MagicMock()
    cdp.probe_xy = AsyncMock(return_value={"width": 800, "height": 600,
                                           "tag": "CANVAS"})
    reads = {"n": 0}

    async def get_current_url():
        reads["n"] += 1
        return post_url if (post_url and reads["n"] > 2) else PRE_URL

    cdp.get_current_url = AsyncMock(side_effect=get_current_url)
    cdp.click_xy = AsyncMock(return_value="Clicked at (40,60)")
    cdp.focus_xy = AsyncMock(return_value="Focused (40,60)")
    cdp.type_text_at_focus = AsyncMock(return_value="Typed 2 characters")
    cdp.refresh_target_map = AsyncMock()
    cdp.capture_screenshot = AsyncMock(return_value="/9j/fake")
    return cdp


def _click(action="click_xy", args=None):
    return ActionCall(action=action, action_args=args or {"x": 40, "y": 60,
                                                          "label": "cell C4"})


async def _run(cdp, deps, audit, call=None):
    return await _coordinate_action(call or _click(), deps, audit=audit,
                                    turn=0)


@pytest.mark.asyncio
async def test_a_cross_origin_landing_is_reported_and_a_deny_aborts():
    """The post-dispatch half, and the only half available: the click has
    happened, so this prompts, records and aborts — it does not prevent."""
    cdp = _cdp(post_url="https://evil.example/steal")
    deps = _deps(cdp, replies=("approve", "no"))
    audit = MagicMock()

    out = await _run(cdp, deps, audit)

    # It dispatched — stated here so nobody reads this file as a pre-flight.
    cdp.click_xy.assert_awaited_once()
    assert "[BLOCKED]" in out, out
    assert "evil.example" in out
    assert deps.result is not None
    assert deps.result.failure_reason == "user_denied"
    kinds = [c.kwargs.get("kind") for c in audit.record_policy.call_args_list]
    assert "click_cross_domain" in kinds


@pytest.mark.asyncio
async def test_the_cross_domain_card_names_the_destination_domain():
    """Same `kind` and `record_policy` shape as the ref-click gate, so the
    audit reads the hop and the panel shows the identity — one prompt per
    domain per task, not one per click."""
    cdp = _cdp(post_url="https://evil.example/steal")
    deps = _deps(cdp, replies=("approve", "approve"))
    audit = MagicMock()

    out = await _run(cdp, deps, audit)

    assert "[BLOCKED]" not in out, out
    assert "evil.example" in deps.visited_domains
    frames = [c.args[0] for c in deps.ws_send.await_args_list
              if c.args and c.args[0].get("type") == "approval_required"]
    assert frames[-1]["args"]["target_domain"] == "evil.example"


@pytest.mark.asyncio
async def test_an_already_approved_domain_is_not_asked_about_twice():
    cdp = _cdp(post_url="https://seen.example/x")
    deps = _deps(cdp, replies=("approve",))
    deps.visited_domains.add("seen.example")
    audit = MagicMock()

    out = await _run(cdp, deps, audit)

    assert "[BLOCKED]" not in out, out
    prompts = [c for c in audit.record_policy.call_args_list
               if c.kwargs.get("kind") == "click_cross_domain"]
    assert prompts == []


@pytest.mark.asyncio
async def test_a_blacklisted_landing_aborts_the_task_in_the_same_step():
    """The one thing the post-dispatch check *can* prevent: the run carrying
    on against a page the user blocks. Before this existed, a coordinate click
    had no policy read on where it landed at all."""
    cdp = _cdp(post_url="https://blocked.example/steal")
    deps = _deps(cdp, policy=Policy(blacklist=["blocked.example"]),
                 replies=("approve",))
    audit = MagicMock()

    out = await _run(cdp, deps, audit)

    assert "[BLOCKED]" in out, out
    assert deps.result is not None
    assert deps.result.failure_reason != "user_denied"


@pytest.mark.asyncio
async def test_a_same_domain_click_never_reaches_this_check():
    """The common case pays one extra URL read and nothing else — the point
    of the guard is not to make every canvas click an event."""
    cdp = _cdp()
    deps = _deps(cdp)
    audit = MagicMock()

    out = await _run(cdp, deps, audit)

    assert _EXEC_FAILURE not in out, out
    prompts = [c for c in audit.record_policy.call_args_list
               if c.kwargs.get("kind") == "click_cross_domain"]
    assert prompts == []


@pytest.mark.asyncio
async def test_focus_and_type_are_gated_the_same_way():
    """All three verbs press the mouse, so all three land on the same gate."""
    for action, args, dispatch in (
        ("focus_xy", {"x": 40, "y": 60, "label": "cell C4"}, "focus_xy"),
        ("type_xy", {"x": 40, "y": 60, "label": "cell C4", "text": "hi"},
         "focus_xy"),
    ):
        cdp = _cdp(post_url="https://evil.example/steal")
        deps = _deps(cdp, replies=("approve", "no"))
        audit = MagicMock()
        out = await _run(cdp, deps, audit, _click(action, args))
        getattr(cdp, dispatch).assert_awaited_once()
        assert "[BLOCKED]" in out, (action, out)
        assert deps.result.failure_reason == "user_denied"


@pytest.mark.asyncio
async def test_the_approval_card_says_the_destination_is_unreadable():
    """The honest card. The user is being asked to approve a blind pixel
    click; without this clause the post-dispatch prompt reads as a veto that
    still has time to stop something."""
    cdp = _cdp()
    deps = _deps(cdp)
    audit = MagicMock()
    await _run(cdp, deps, audit)
    frame = [c.args[0] for c in deps.ws_send.await_args_list
             if c.args and c.args[0].get("type") == "approval_required"][0]
    assert "another site" in frame["reasoning"], frame["reasoning"]


@pytest.mark.asyncio
async def test_the_card_caveat_never_reaches_the_audit_document():
    """`logs/sessions/` is the user's data: prose the card carries is page-
    derived context, and `_ask_user` splits card-only text for exactly this."""
    cdp = _cdp()
    deps = _deps(cdp)
    audit = MagicMock()
    await _run(cdp, deps, audit)
    reason = audit.record_prompt.call_args.kwargs["reason"]
    assert "another site" not in reason
