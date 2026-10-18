"""A click at a point nobody verified by ref, gated on a human.

`click_xy` is the only verb in the harness that acts on coordinates the
accessibility tree never vouched for. Its whole safety story is a short list
of refusals, so the tests are mostly about the *absences*: an arm that does
not fire reads clean in a diff and is a wrong click on someone's spreadsheet.

Two of them are not optional:

- **Every failure path returns a string containing `_EXEC_FAILURE`.** `ok` is
  derived by membership at the recording site, so a refusal written as a
  friendly sentence is written to disk as a successful click. That is the bug
  this file exists to keep fixed.
- **The screenshot reaches the WebSocket frame and not the audit document.**
  A JPEG of a page is page content; it is transit only. The assertion is on
  the bytes of the document on disk, because asserting on the frame proves
  only that the frame was built.

No model, no key, no network, no browser: the relay and the audit document
are the real ones where the real one matters (the document is a real
`AuditTrail` on a tmp dir) and mocks where it does not.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.audit import AuditTrail
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import _EXEC_FAILURE, _execute_action

# Read through the module so this file *collects* against the pre-change
# harness: a collection error proves the feature is absent, but it proves
# nothing about any individual refusal, and each of those is the point.
COORDINATE_CLICK_ENV = getattr(harness_mod, "COORDINATE_CLICK_ENV",
                                "BROTTO_COORDINATE_CLICK")
from brotto_orchestrator.policy.gate import SCREENSHOT_CAPTURE_ENV
from brotto_orchestrator.policy.schema import Policy

JPEG = "/9j/4AAQSkZJRgABAQ==END-OF-JPEG"
CANVAS = {"width": 1512, "height": 982, "tag": "CANVAS"}
URL = "https://docs.google.com/spreadsheets/d/abc"


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    """The precondition for everything below. The gate's own off-state is
    asserted once, in `test_the_opt_in_is_off_by_default`."""
    monkeypatch.setenv(COORDINATE_CLICK_ENV, "1")
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")


def _deps(*, probe=None, url=URL, image=JPEG, policy=None,
          reply="approve") -> tuple[AgentDeps, list, asyncio.Queue]:
    probe = CANVAS if probe is None else probe
    cdp = MagicMock()
    cdp.probe_xy = AsyncMock(return_value=probe)
    cdp.get_current_url = AsyncMock(return_value=url)
    cdp.capture_screenshot = AsyncMock(return_value=image)
    cdp.click_xy = AsyncMock(return_value="Clicked at (412,288)")
    cdp.focus_xy = AsyncMock(return_value="Focused (412,288)")
    cdp.type_text_at_focus = AsyncMock(return_value="Typed 2 characters")
    cdp.refresh_target_map = AsyncMock()
    frames: list[dict] = []

    async def ws_send(msg: dict) -> None:
        frames.append(msg)

    queue: asyncio.Queue = asyncio.Queue()
    queue.put_nowait(reply)
    deps = AgentDeps(user_id="t", task="put 42 in cell C4", cdp=cdp,
                     ws_send=ws_send, human_input_queue=queue,
                     policy=Policy() if policy is None else policy)
    return deps, frames, queue


def _click(**args) -> ActionCall:
    base = {"x": 412, "y": 288, "label": "the cell C4"}
    base.update(args)
    return ActionCall(action="click_xy", action_args=base)


@pytest.fixture
def trail(tmp_path):
    t = AuditTrail("sess", dir=tmp_path)
    t.begin_task("put 42 in cell C4")
    return t


async def _run(call, deps, trail):
    return await _execute_action(call, deps, audit=trail, turn=1)


# ── the refusals ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_opt_in_is_off_by_default(monkeypatch, trail):
    monkeypatch.delenv(COORDINATE_CLICK_ENV, raising=False)
    deps, frames, _ = _deps()
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    assert COORDINATE_CLICK_ENV in out  # and says how to turn it on
    deps.cdp.click_xy.assert_not_awaited()
    assert frames == []


@pytest.mark.asyncio
async def test_an_unparseable_opt_in_means_off(monkeypatch, trail):
    """Same posture as `AGENT_SECRET` and `capture_enabled`: a stray value in
    a .env is a refusal, never a default-on capability class."""
    monkeypatch.setenv(COORDINATE_CLICK_ENV, "sure, why not")
    deps, _, _ = _deps()
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("label", [None, "", "   "])
async def test_a_missing_label_refuses_instead_of_prompting(trail, label):
    """The only check that resists a model confidently clicking at nothing —
    and the human sees nothing but the label, so a blank one is a blind click
    with an empty card."""
    deps, frames, _ = _deps()
    out = await _run(_click(label=label), deps, trail)
    assert _EXEC_FAILURE in out and "label" in out
    assert frames == [], "it prompted for a click the user cannot read"
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [(412.5, 288), ("412", 288), (None, 288),
                                 (True, 288), (412, [288])])
async def test_coordinates_that_are_not_integers_refuse(trail, bad):
    deps, _, _ = _deps()
    out = await _run(_click(x=bad[0], y=bad[1]), deps, trail)
    assert _EXEC_FAILURE in out
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("x,y", [(-1, 10), (10, -1), (1512, 10), (10, 982),
                                 (99999, 99999)])
async def test_coordinates_outside_the_live_viewport_refuse(trail, x, y):
    """Bound against the viewport read *now*. From the observation it would be
    decoration: a page that resized since the step would pass a check made of
    a number that no longer describes it."""
    deps, _, _ = _deps()
    out = await _run(_click(x=x, y=y), deps, trail)
    assert _EXEC_FAILURE in out and "viewport" in out
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_bounds_use_the_live_viewport_not_a_stale_one(trail):
    deps, _, _ = _deps()
    await _run(_click(), deps, trail)
    deps.cdp.probe_xy.assert_awaited_once_with(412, 288)


@pytest.mark.asyncio
@pytest.mark.parametrize("tag", ["DIV", "BUTTON", ""])
async def test_a_point_covered_by_something_is_refused(trail, tag):
    """The occlusion test, and it is load-bearing. A modal over a spreadsheet
    is not hypothetical — branch-protection session `a7328461` recorded ten
    `ok: true` clicks on a Create button a cookie banner's neighbour was
    covering. This verb acts on a point no ref vouched for, so without the
    check it is a net safety loss against ref `click`."""
    deps, frames, _ = _deps(probe={"width": 1512, "height": 982, "tag": tag})
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out and "on top" in out
    assert frames == [], "it asked a human to approve an invisible click"
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_screenshot_blocked_domain_refuses_without_prompting(trail):
    """We may not photograph the domain, so the user cannot see the click they
    are being asked to approve. Asking anyway is worse than not asking."""
    deps, frames, _ = _deps(url="https://blocked.test/sheet")
    deps.policy = Policy(blocked_domains=["blocked.test"])
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    assert frames == []
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_throwing_policy_check_refuses(trail):
    """The check itself raising must not fall through to the prompt."""
    class _Explosive:
        sensitive_actions = []

        @property
        def blocked_domains(self):
            raise RuntimeError("policy store is down")

    deps, frames, _ = _deps()
    deps.policy = _Explosive()
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    assert frames == []
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_capture_that_comes_back_empty_is_refused(trail):
    """The stale-screenshot case. A frame replayed from the previous
    observation shows the crosshair against a layout that has since moved, so
    there is no such thing as a fallback to an older image: no fresh capture,
    no approval."""
    deps, frames, _ = _deps(image=None)
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    assert frames == []
    deps.cdp.click_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_relay_that_raises_refuses_rather_than_crashing(trail):
    deps, frames, _ = _deps()
    deps.cdp.probe_xy = AsyncMock(side_effect=RuntimeError("tab gone"))
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    assert frames == []


@pytest.mark.asyncio
async def test_a_declined_click_is_recorded_as_a_failure(trail):
    deps, frames, _ = _deps(reply="no")
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE in out
    deps.cdp.click_xy.assert_not_awaited()
    assert len(frames) == 1 and frames[0]["type"] == "approval_required"


@pytest.mark.asyncio
async def test_every_refusal_says_error_executing(trail):
    """The one invariant the whole file is measuring. `ok` is derived by
    `_EXEC_FAILURE not in outcome`, so a refusal with any other wording is
    written to the audit document as a successful action — which is how a
    wrong click becomes an unmeasurable one."""
    cases = [
        _click(label=""), _click(x=-5), _click(x=1512), _click(x="412"),
        _click(probe=None) if False else _click(),
    ]
    probes = [CANVAS, CANVAS, CANVAS, CANVAS, {}]
    for call, probe in zip(cases, probes):
        deps, _, _ = _deps(probe=probe)
        assert _EXEC_FAILURE in await _run(call, deps, trail), call
    for policy in (Policy(sensitive_actions=["payment"]), None):
        deps, _, _ = _deps(probe={}, policy=policy)
        assert _EXEC_FAILURE in await _run(_click(), deps, trail)
    deps, _, _ = _deps(image=None)
    assert _EXEC_FAILURE in await _run(_click(), deps, trail)


# ── the approved path ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_approved_click_dispatches_and_refreshes(trail):
    deps, frames, _ = _deps()
    out = await _run(_click(), deps, trail)
    assert _EXEC_FAILURE not in out
    deps.cdp.click_xy.assert_awaited_once_with(412, 288)
    deps.cdp.refresh_target_map.assert_awaited_once()


@pytest.mark.asyncio
async def test_the_frame_carries_the_screenshot_viewport_and_url(trail):
    deps, frames, _ = _deps()
    await _run(_click(), deps, trail)
    frame = frames[0]
    assert frame["type"] == "approval_required"
    assert frame["action"] == "click_xy"
    assert frame["args"] == {"x": 412, "y": 288, "label": "the cell C4"}
    assert frame["screenshot"] == JPEG
    assert frame["viewport"] == {"width": 1512, "height": 982}
    assert frame["url"] == URL


@pytest.mark.asyncio
async def test_the_screenshot_never_reaches_the_audit_document(trail, tmp_path):
    """The regression test that matters, and it asserts on the bytes on disk
    rather than on the frame: the frame is transit, the document is the user's
    page, and asserting on the frame would pass for a build that leaked into
    both."""
    deps, _, _ = _deps()
    await _run(_click(), deps, trail)
    for path in tmp_path.glob("*.json"):
        text = path.read_text()
        assert JPEG not in text, f"{path.name} holds the screenshot"
        assert '"screenshot"' not in text
        # The document does record that the click was approved — the audit
        # keeps the coordinates and the label, which is not page content.
        doc = json.loads(text)
        assert "screenshot" not in json.dumps(doc)
    prompts = trail.read()["prompts"] if hasattr(trail, "read") else None
    if prompts is not None:
        assert "screenshot" not in json.dumps(prompts)


@pytest.mark.asyncio
async def test_the_click_is_never_skipped_for_an_already_visited_domain(trail):
    """`deps.visited_domains` says the user let us *visit* this site. It says
    nothing about clicking an invisible point inside it, so there is no cache
    and no skip path — a second click on a visited domain still asks."""
    deps, frames, _ = _deps()
    deps.visited_domains.add("docs.google.com")
    await _run(_click(), deps, trail)
    deps.human_input_queue.put_nowait("approve")
    await _run(_click(x=500, y=500), deps, trail)
    assert len(frames) == 2


@pytest.mark.asyncio
async def test_one_click_is_one_click(trail):
    """No verify-and-repeat: a blind click is not retried, because a second
    one would be a second blind click."""
    deps, _, _ = _deps()
    await _run(_click(), deps, trail)
    assert deps.cdp.click_xy.await_count == 1


# ── focus_xy ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_focus_needs_no_approval_and_does_not_capture(trail):
    deps, frames, _ = _deps()
    out = await _execute_action(
        ActionCall(action="focus_xy",
                   action_args={"x": 412, "y": 288, "label": "the cell C4"}),
        deps, audit=trail, turn=1)
    assert _EXEC_FAILURE not in out
    assert frames == [], "focusing a caret should not cost the user a card"
    deps.cdp.focus_xy.assert_awaited_once_with(412, 288)
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_focus_is_gated_on_the_opt_in_and_the_occlusion_test(
        monkeypatch, trail):
    monkeypatch.delenv(COORDINATE_CLICK_ENV, raising=False)
    deps, _, _ = _deps()
    focus = ActionCall(action="focus_xy",
                       action_args={"x": 1, "y": 1, "label": "cell A1"})
    assert _EXEC_FAILURE in await _execute_action(focus, deps, audit=trail,
                                                  turn=1)
    monkeypatch.setenv(COORDINATE_CLICK_ENV, "1")
    deps, _, _ = _deps(probe={"width": 800, "height": 600, "tag": "DIV"})
    assert _EXEC_FAILURE in await _execute_action(focus, deps, audit=trail,
                                                  turn=1)
    deps.cdp.focus_xy.assert_not_awaited()


@pytest.mark.asyncio
async def test_focus_out_of_bounds_refuses(trail):
    deps, _, _ = _deps()
    out = await _execute_action(
        ActionCall(action="focus_xy",
                   action_args={"x": 1512, "y": 10, "label": "cell"}),
        deps, audit=trail, turn=1)
    assert _EXEC_FAILURE in out and "viewport" in out


# ── type_xy ────────────────────────────────────────────────────────────────

def _type(text: str = "42", **args) -> ActionCall:
    base = {"x": 412, "y": 288, "label": "the cell C4", "text": text}
    base.update(args)
    return ActionCall(action="type_xy", action_args=base)


@pytest.mark.asyncio
async def test_type_focuses_then_inserts_at_the_point(trail):
    """One action, one verified point. The alternative — `focus_xy` now and a
    coordinate-free type later — is exactly the "types into whatever was last
    focused" shape `type_text_to_ref` refuses to do, so the two are one call."""
    deps, frames, _ = _deps()
    out = await _execute_action(_type(), deps, audit=trail, turn=1)
    assert _EXEC_FAILURE not in out, out
    deps.cdp.focus_xy.assert_awaited_once_with(412, 288)
    deps.cdp.type_text_at_focus.assert_awaited_once_with("42")
    deps.cdp.refresh_target_map.assert_awaited_once()


@pytest.mark.asyncio
async def test_type_needs_no_approval(trail):
    """Accepted deliberately: a card per cell would make the feature
    unusable, and typing into the cell the user just saw approved is not
    destructive in itself."""
    deps, frames, _ = _deps()
    await _execute_action(_type(), deps, audit=trail, turn=1)
    assert frames == []
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("probe,label", [
    ({"width": 1512, "height": 982, "tag": "DIV"}, "the cell C4"),
    ({"width": 1512, "height": 982, "tag": "CANVAS"}, ""),
])
async def test_type_inherits_focus_s_guard_ordering(trail, probe, label):
    """Same body, same order: opt-in, label, coordinates, live viewport,
    then the occlusion check. A type that skipped the occlusion check would
    write into a dialog nobody approved."""
    deps, _, _ = _deps(probe=probe)
    out = await _execute_action(_type(label=label), deps, audit=trail, turn=1)
    assert _EXEC_FAILURE in out, out
    deps.cdp.focus_xy.assert_not_awaited()
    deps.cdp.type_text_at_focus.assert_not_awaited()


@pytest.mark.asyncio
async def test_type_is_masked_on_disk_like_type_text(trail, tmp_path):
    """`_typed_field` is what decides a value is character-entered, and
    `type_xy` is one. Without it the text reaches the audit document as
    plaintext; with it, and with no ref to resolve to a password field, the
    fail-closed answer masks the value."""
    call = _type()
    assert harness_mod._typed_field(call) == "text"
    args, trace = harness_mod._scrubbed(call, True)
    assert args["text"] == harness_mod.REDACTED
    assert args["text_chars"] == 2
    assert "42" not in trace, trace


@pytest.mark.asyncio
async def test_a_failed_focus_types_nothing(trail):
    deps, _, _ = _deps()
    deps.cdp.focus_xy = AsyncMock(return_value="Error executing: tab gone")
    out = await _execute_action(_type(), deps, audit=trail, turn=1)
    assert _EXEC_FAILURE in out
    deps.cdp.type_text_at_focus.assert_not_awaited()
