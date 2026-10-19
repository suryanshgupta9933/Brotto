"""A page that says nothing about the task escalates to a screenshot.

The accessibility tree is the only thing Brotto normally sees, and it is
blind on `<canvas>` — no node, no page text, so the model was handed an empty
page as though the page were empty. But an empty page is the clean case and
the rare one: a Google Sheet comes back with forty real AX nodes for the
toolbar and the menu bar, so the old empty-tree trigger never fired and the
page that is *about* the task stayed invisible. The trigger is therefore
relevance to the task, not absence of signal — see `_sparse_for_task`.

Most of these assertions are about **absences**, because that is what a broken
escalation looks like in a diff: a screenshot requested on a page the tree
described perfectly well burns a vision round trip per step and reads clean.

No live model, no key, no network: W0's resolver and the relay are stubbed,
and `httpx` is walled at the transport layer the same way
`tests/test_capability_resolution.py` does.
"""

from __future__ import annotations

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, AgentTurn,
)
from brotto_orchestrator.agent.harness import (
    AgentHarness, _turn_to_input, _turn_to_prompt, _vision_fallback,
)
from brotto_orchestrator.model.capabilities import Capabilities
from brotto_orchestrator.policy.gate import SCREENSHOT_CAPTURE_ENV
from brotto_orchestrator.policy.schema import Policy

JPEG = "/9j/4AAQSkZJRgABAQ=="

_COMPLETE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _EmptyResult:
    usage = None


class _Cfg:
    def __init__(self, provider: str, model: str) -> None:
        self.provider, self.model, self.base_url = provider, model, None


class _Creds:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key


@pytest.fixture(autouse=True)
def _model_is_real(monkeypatch):
    """The production branch. `conftest` sets AGENT_MODEL=test process-wide for
    TestModel, which `_vision_fallback` skips by design; a test about that
    skip has to opt back in."""
    monkeypatch.setenv("AGENT_MODEL", "anthropic:claude-sonnet-5-5")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    import httpx

    def _boom(*a, **kw):
        raise AssertionError("a test opened a socket — stub capabilities")

    monkeypatch.setattr(httpx, "get", _boom)
    monkeypatch.setattr(httpx, "post", _boom)


@pytest.fixture(autouse=True)
def _capture_on(monkeypatch):
    """Capture is off by default (`policy/gate.py`) — the gate's own tests own
    that assertion. Here it is the precondition for every capture-happy path,
    so it is on unless a test turns it back off on purpose."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")


def _deps(targets: list | None = None, page_text: str = "",
          task: str = "what does this board say?") -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=targets or [])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/board")
    cdp.get_page_text = AsyncMock(return_value=page_text)
    cdp.get_page_title = AsyncMock(return_value="Board")
    cdp.refresh_target_map = AsyncMock()
    cdp.capture_screenshot = AsyncMock(return_value=JPEG)

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task=task, cdp=cdp, ws_send=ws_send)
    # Resolution is stubbed per test; a default keeps an unstubbed path from
    # reaching the resolver (and therefore the network) at all.
    deps._vision_caps = Capabilities(vision=True, source="catalog")
    return deps


def _stub_plan(monkeypatch, seen: list[AgentTurn]) -> None:
    async def _fake_plan(deps, turn, agent, audit=None):
        seen.append(turn)
        return _COMPLETE, 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)


# ── the trigger ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_empty_page_with_a_vision_model_is_captured():
    deps = _deps()
    out = await _vision_fallback(deps, [], "")
    assert out.image == JPEG
    assert out.needed is True and out.can_see is True
    deps.cdp.capture_screenshot.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_target_that_serves_the_task_is_never_escalated():
    """The absence is the assertion: one screenshot per step on an ordinary
    page is charged again for the whole task, because an image lives outside
    the cache prefix. And the invariant is about *the task*, not about size —
    a single node that plainly serves what the user asked for is enough."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    deps = _deps(targets=[SemanticTarget(ref_id="b1", tag="button",
                                         role="button", name="Board")])
    out = await _vision_fallback(deps, [{"ref_id": "b1", "name": "Board"}], "")
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


def _toolbar(n: int) -> list:
    """`n` interactive chrome nodes, none of which is about a spreadsheet.

    The shape of the page that motivated the widened trigger: a real AX tree,
    forty real targets, every one of them toolbar or menubar.
    """
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    return [
        SemanticTarget(ref_id=f"b{i}", tag="button", role="button",
                       name=f"{name} {i}")
        for i, name in enumerate([
            "Bold", "Italic", "Underline", "Merge cells", "Zoom",
            "Print", "Undo", "Redo", "Font", "Background", "Borders",
            "Align", "Wrap", "Freeze", "Filter", "Sort", "Functions",
            "Data", "View", "Help", "Share", "Comment", "Rename",
            "Move", "Protect", "Chart", "Import", "Explore", "Settings",
            "Accessibility", "Shortcuts", "History", "Version",
            "Named ranges", "Protected ranges", "Downloads", "Extensions",
            "Add-ons", "Account", "Notifications"][:n])
    ]


@pytest.mark.asyncio
async def test_a_tree_full_of_chrome_is_escalated():
    """The case the old trigger missed entirely. Forty targets is not sparse
    by count — it is sparse against a task about a spreadsheet, because not one
    of them, and not a character of page text, mentions the task."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Board")
    assert out.image == JPEG
    assert out.needed is True and out.can_see is True
    deps.cdp.capture_screenshot.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_verb_collision_on_chrome_does_not_suppress_capture():
    """The regression. `_sparse_for_task` returned `not (words & seen)`, so a
    *single* incidental overlap suppressed the capture — and the words UI
    chrome is made of are the same words task instructions are made of. A
    Google Sheet has a **Fill** button, a **Copy** button, an **Undo** button
    and a **View** menu; "fill in the spreadsheet with these values", "copy the
    column", "select the range" each collided with one of them and the page
    the fallback exists for was the page that stopped firing.

    So the collision test is the point: the task word that also appears in a
    target name is the task's *leading verb*, and a leading verb in an
    instruction is the operation, not the subject of the page. Nothing about
    the page changes when it is excluded, and the two words that actually name
    the task — `spreadsheet`, `values` — appear nowhere on the page.
    """
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    targets = [SemanticTarget(ref_id=f"b{i}", tag="button", role="button",
                              name=n) for i, n in
               enumerate(["Fill", "Copy", "Paste", "Undo", "Redo", "View",
                          "Insert", "Format", "Font", "Zoom"])]
    deps = _deps(targets=targets, page_text="Untitled",
                 task="fill in the spreadsheet with these values")
    out = await _vision_fallback(deps, targets, "Untitled")
    assert out.image == JPEG
    assert out.needed is True
    deps.cdp.capture_screenshot.assert_awaited_once()


@pytest.mark.asyncio
async def test_the_subject_of_the_task_still_suppresses_through_a_chrome_collision():
    """The other side of the same line, and it is the invariant that matters:
    excluding the verb must not go on to exclude the thing the task is
    *about*. A "New spreadsheet" button names the task's subject, so a page
    with one is a page the model can act on — same task, same Fill button, one
    extra target, and the answer flips."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    targets = [SemanticTarget(ref_id="b0", tag="button", role="button",
                              name="Fill")]
    targets.append(SemanticTarget(ref_id="z1", tag="button", role="button",
                                  name="New spreadsheet"))
    deps = _deps(targets=targets, page_text="Untitled",
                 task="fill in the spreadsheet with these values")
    out = await _vision_fallback(deps, targets, "Untitled")
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_captures_are_bounded_per_task():
    """The cost discipline, and it is a bound rather than another guess at
    when to take one. An image lives outside the cache prefix, so it is charged
    again on every step that carries it; a run already handed three pictures of
    pages its tree could not describe is not rescued by a fourth. The step
    after the cap still reports `needed`, so W3 can say the page was unseen
    rather than the model reading an empty page."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    for _ in range(harness_mod._MAX_CAPTURES_PER_TASK + 2):
        out = await _vision_fallback(deps, targets, "Board")
    assert deps.cdp.capture_screenshot.await_count == \
        harness_mod._MAX_CAPTURES_PER_TASK
    assert out.image == "" and out.needed is True


@pytest.mark.asyncio
async def test_the_partial_note_is_used_when_the_page_is_only_sparse():
    """The empty-tree note is *false* on a page with a readable toolbar, and a
    model told its tree is empty stops trusting targets it can actually see.
    So the note has to describe a thin page, not an absent one."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Board")
    assert out.note == harness_mod._SCREENSHOT_PARTIAL_NOTE
    assert out.note != harness_mod._SCREENSHOT_OK_NOTE
    note = out.note.lower()
    assert "empty" not in note
    assert "page content" in note and "instruction" in note


@pytest.mark.asyncio
async def test_the_empty_tree_note_is_still_used_when_the_page_is_empty():
    """The note swap must not leak onto the branch that earned its claim."""
    deps = _deps()
    out = await _vision_fallback(deps, [], "")
    assert out.note == harness_mod._SCREENSHOT_OK_NOTE


@pytest.mark.asyncio
async def test_a_target_named_for_the_task_suppresses_a_sparse_page():
    """Red without the relevance test: forty chrome nodes plus a 'New
    spreadsheet' button is a page that plainly serves the task, and paying a
    screenshot for it is the expensive order this feature exists to avoid."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    targets = _toolbar(40)
    targets.append(SemanticTarget(ref_id="z1", tag="button", role="button",
                                 name="New spreadsheet"))
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Board")
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_page_text_naming_the_task_suppresses_a_sparse_page():
    """A legend in real text is something the model can read. Red without the
    page-text channel in the relevance test."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Quarterly spreadsheet: revenue",
                 task="what is the revenue in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Quarterly spreadsheet: revenue")
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_page_with_real_prose_is_never_escalated():
    """The cost guard. A long page that fails the relevance test for an
    incidental reason — a docs site's chrome never mentions your task — is a
    page the model can already read, and an uncacheable image is charged again
    on every step. Red without `_PAGE_TEXT_ENOUGH`."""
    targets = _toolbar(40)
    text = ("This site explains how the browser accessibility tree is "
            "collected, what a semantic target is, and why a canvas element "
            "produces no nodes at all for a screen reader or for an agent. "
            "It is a long, ordinary, entirely readable page of prose about "
            "how perception works, with no figure, no canvas and no chart "
            "anywhere on it, and nothing the reader came here to look at at all. The "
            "documentation is long enough to be ordinary documentation.")
    assert len(text) >= harness_mod._PAGE_TEXT_ENOUGH
    deps = _deps(targets=targets, page_text=text,
                 task="what is the revenue in the spreadsheet")
    out = await _vision_fallback(deps, targets, text)
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_task_with_no_content_words_is_not_escalated():
    """Absence of a task is not evidence of blindness. Red without the guard:
    an empty word set has an empty intersection with everything."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board", task="do it")
    out = await _vision_fallback(deps, targets, "Board")
    assert out.image == "" and out.needed is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_interaction_verb_is_not_a_relevance_hit():
    """"click" is in every task and in no page. Red without the stopwords: a
    toolbar full of "Undo"/"Redo"/"Go" is not a page that serves "click the
    undo button" by name."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
    targets = [SemanticTarget(ref_id=f"b{i}", tag="button", role="button",
                              name=n) for i, n in
               enumerate(["click here", "press", "find", "open", "go"])]
    deps = _deps(targets=targets, page_text="", task="click the undo button")
    out = await _vision_fallback(deps, targets, "")
    assert out.image == JPEG


@pytest.mark.asyncio
async def test_page_text_alone_suppresses_escalation():
    """Page text is a second channel. Whitespace is not text: a `<canvas>`
    page that renders a stray newline must still escalate."""
    deps = _deps()
    assert (await _vision_fallback(deps, [], "   \n  ")).image == JPEG
    deps.cdp.capture_screenshot.reset_mock()
    assert (await _vision_fallback(deps, [], "Board title")).image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()


# ── the model must be able to see ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_model_that_cannot_see_is_not_captured_too():
    """Resolve BEFORE capture. Capturing first and discarding afterwards is
    the expensive order and this pins it."""
    deps = _deps()
    deps._vision_caps = Capabilities(vision=False, source="probe")
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    assert out.needed is True and out.can_see is False
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_is_not_treated_as_blind():
    """A catalogue `False` means "not documented"; a failed probe means "we do
    not know". Neither is a denial, and W3 renders them differently."""
    deps = _deps()
    deps._vision_caps = Capabilities()  # source="default", vision=None
    out = await _vision_fallback(deps, [], "")
    assert out.needed is True and out.can_see is None
    deps.cdp.capture_screenshot.assert_not_awaited()


# ── failure branches ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_failed_capture_reaches_the_model_as_a_refusal_to_see():
    """An empty image reads as a blank page and the model will describe it.
    Every failed branch therefore carries a note it cannot mistake for one."""
    deps = _deps()
    deps.cdp.capture_screenshot = AsyncMock(return_value=None)
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    assert out.needed is True and out.can_see is True
    assert "treat it as unseen" in out.note.lower()


@pytest.mark.asyncio
async def test_a_payload_that_is_not_an_image_never_reaches_the_model():
    """A provider sniffs the first bytes to pick a decoder and fails the whole
    turn when it cannot, so a corrupt capture costs a step unless it is caught
    here. The extension checks length; length is not decodability."""
    deps = _deps()
    deps.cdp.capture_screenshot = AsyncMock(
        return_value="data:image/jpeg;base64," + JPEG)
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    assert "not an image" in out.note.lower()


@pytest.mark.asyncio
async def test_a_jpeg_header_with_undecodable_base64_is_still_refused():
    """The prefix check alone is not enough. `b64decode` defaults to
    `validate=False`, which silently drops characters outside the alphabet,
    so a guard that only sniffs the header passes a string the decode on the
    hot path then chokes on — and that raise reaches `agent.run` and loses
    the run rather than the picture."""
    deps = _deps()
    deps.cdp.capture_screenshot = AsyncMock(return_value=JPEG[:-4] + "!!!!")
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    assert "not an image" in out.note.lower()


def test_an_undecodable_capture_degrades_the_turn_instead_of_raising():
    """Belt to the guard's braces: `_turn_to_input` is the loop's hot path, so
    a bad string here must reach the model as an unseen page, not as an
    exception that ends the task."""
    turn = AgentTurn(
        task="read the board", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/board", current_page_title="Board",
        ax_tree="", ax_diff="", step_summaries=[], screenshot=JPEG[:-3],
        screenshot_note=harness_mod._SCREENSHOT_OK_NOTE,
    )
    parts = _turn_to_input(turn)
    assert isinstance(parts, list) and len(parts) == 2
    assert "not an image" in parts[1].lower()


@pytest.mark.asyncio
async def test_an_exception_is_not_a_stall():
    """The loop's hot path: a raise here loses the run, not the screenshot."""
    deps = _deps()
    deps.cdp.capture_screenshot = AsyncMock(side_effect=RuntimeError("tab gone"))
    out = await _vision_fallback(deps, [], "")
    assert out.needed is True and out.image == "" and out.note == ""


@pytest.mark.asyncio
async def test_the_scripted_planner_never_escalates():
    """`/run` and every harness test drive this path; a screenshot frame to a
    fake relay is a hang, not a feature."""
    deps = _deps()
    deps.scripted_planner = object()
    out = await _vision_fallback(deps, [], "")
    assert out.needed is True and out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_capability_is_resolved_once_per_run_and_off_the_loop(monkeypatch):
    """`warm_async`, never `resolve(..., allow_network=True)`: a 4s metadata
    round trip and a real probe request must not run on the event loop, and
    the answer cannot change mid-task."""
    seen: list[dict] = []

    async def _fake_warm(provider, model_id, **kw):
        seen.append({"provider": provider, "model": model_id, **kw})
        return Capabilities(vision=True, source="catalog")

    monkeypatch.setattr(harness_mod, "warm_async", _fake_warm)
    monkeypatch.setattr(
        harness_mod, "_resolve_model",
        lambda deps: (_Cfg("anthropic", "claude-sonnet-5-5"), _Creds("sk-x")),
    )
    deps = _deps()
    del deps._vision_caps
    for _ in range(3):
        await harness_mod._vision_capability(deps)
    assert len(seen) == 1
    assert seen[0]["provider"] == "anthropic"
    assert seen[0]["api_key"] == "sk-x"
    assert seen[0]["caller_key"] == deps.user_id


@pytest.mark.asyncio
async def test_a_resolver_failure_degrades_to_unknown_not_to_a_stall(monkeypatch):
    async def _boom(*a, **kw):
        raise RuntimeError("cache dir unwritable")

    monkeypatch.setattr(harness_mod, "warm_async", _boom)
    deps = _deps()
    del deps._vision_caps
    out = await _vision_fallback(deps, [], "")
    assert out.needed is True and out.can_see is None and out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()


# ── what the model receives ────────────────────────────────────────────────

def test_a_screenshot_rides_as_an_image_part_not_as_text():
    """The injection defence that works for `page_text` is not writing
    page-derived content as text at all, and pixels cannot be bracketed."""
    from pydantic_ai.messages import BinaryImage

    turn = AgentTurn(
        task="read the board", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/board", current_page_title="Board",
        ax_tree="", ax_diff="", step_summaries=[], screenshot=JPEG,
        screenshot_note=harness_mod._SCREENSHOT_OK_NOTE,
    )
    parts = _turn_to_input(turn)
    assert isinstance(parts, list) and len(parts) == 3
    assert isinstance(parts[0], str) and "## What is your next action(s)?" in parts[0]
    assert parts[1] == harness_mod._SCREENSHOT_OK_NOTE
    assert isinstance(parts[2], BinaryImage)
    assert parts[2].media_type == "image/jpeg"
    # RAW bytes, not the base64 text. `BinaryImage` encodes whatever it is
    # given, so handing it the already-base64 capture encoded the payload
    # twice; the provider decoded one layer, found ASCII where the magic
    # bytes belong, and refused the turn with "unknown format".
    assert parts[2].data == base64.b64decode(JPEG)
    assert parts[2].data.startswith(b"\xff\xd8\xff")
    # The image is not in the text, and the note is not either — it is its
    # own part, welded to the pixels it describes.
    assert JPEG not in parts[0]
    assert harness_mod._SCREENSHOT_OK_NOTE not in parts[0]


def test_no_screenshot_means_the_prompt_is_unchanged():
    """The ordinary step must be byte-identical to what it was: no new prompt
    surface on 99 of 100 steps."""
    turn = AgentTurn(
        task="read the board", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/board", current_page_title="Board",
        ax_tree="[1] button Send", ax_diff="", step_summaries=[],
    )
    assert _turn_to_input(turn) == _turn_to_prompt(turn)
    assert isinstance(_turn_to_input(turn), str)
    assert "Screenshot" not in _turn_to_prompt(turn)


def test_a_refused_capture_still_tells_the_model_it_saw_nothing():
    """The regression this file exists to prevent: `_VisionFallback.note` was
    asserted on in every other test here, and the note was still dropped on the
    floor by `_turn_to_input`, so a refused capture read to the model as a
    blank page and the task failed for no stated reason. Assert on what the
    model receives, not on the NamedTuple."""
    turn = AgentTurn(
        task="read the board", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/board", current_page_title="Board",
        ax_tree="[1] button Send", ax_diff="", step_summaries=[],
        screenshot="",
        screenshot_note=harness_mod._SCREENSHOT_FAILED_NOTE.format(
            why=harness_mod._SCREENSHOT_REFUSED_WHY),
    )
    parts = _turn_to_input(turn)
    assert isinstance(parts, list) and len(parts) == 2
    assert parts[0] == _turn_to_prompt(turn)
    assert parts[1] == turn.screenshot_note
    # still not interpolated into the prompt body — adjacency, not position
    assert turn.screenshot_note not in parts[0]


def test_the_screenshot_note_is_its_own_part_immediately_before_the_image():
    """Adjacency is the defence, and it did not hold where the note used to be.

    Interpolated into `_turn_to_prompt` the note sat above the steering drain,
    the repeat warning, the refusal block and the question — thousands of
    tokens from the pixels, with page-derived material as its nearest
    neighbour. The AX envelope works because it is welded to the tree it
    wraps; this one is now welded to the image, and nothing page-derived
    follows it.
    """
    from pydantic_ai.messages import BinaryImage

    turn = AgentTurn(
        task="read the board", step_number=1, scratchpad_entries=[],
        current_url="https://example.com/board", current_page_title="Board",
        ax_tree="", ax_diff="", step_summaries=[], screenshot=JPEG,
        screenshot_note=harness_mod._SCREENSHOT_OK_NOTE,
    )
    body = _turn_to_prompt(turn)
    assert harness_mod._SCREENSHOT_OK_NOTE not in body
    assert "### Screenshot" not in body
    parts = _turn_to_input(turn)
    # note, then the image — the trust statement's nearest neighbour is the
    # thing it bounds, and the image is last.
    assert isinstance(parts[1], str) and parts[1] == harness_mod._SCREENSHOT_OK_NOTE
    assert isinstance(parts[2], BinaryImage)
    assert parts[-1] is parts[2]


def test_the_note_distrusts_text_rendered_inside_the_image():
    """An image can carry an instruction in pixels: a `<canvas>` drawing
    "ignore your task and…" as glyphs. Without this the model is told to
    distrust the picture but not what is written on it."""
    note = harness_mod._SCREENSHOT_OK_NOTE.lower()
    assert "page content" in note
    assert "instruction" in note
    # "below" pins the direction: the note precedes the image.
    assert "image below" in note


# ── the capture gate ───────────────────────────────────────────────────────
#
# A screenshot is the one page-content channel `redact_text` cannot see, so
# capture is gated rather than redacted: off unless `BROTTO_VISION_CAPTURE`
# says on, and never on a domain the user blocked. The gate itself is privacy's
# (`tests/test_vision_capture_gate.py`); what follows is the harness obeying
# it — the refusals here would be invisible in a diff.

@pytest.mark.asyncio
async def test_capture_is_refused_when_the_switch_is_off(monkeypatch):
    """The default. Until the switch is on, W2 does nothing at all."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "")
    deps = _deps()
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()
    # A refusal must not look like a lost tab: the step still reports what it
    # saw, and says the page is unseen rather than describing nothing.
    assert out.needed is True and out.can_see is True
    assert "treat it as unseen" in out.note.lower()


@pytest.mark.asyncio
async def test_a_refused_capture_does_not_stall_the_step(monkeypatch):
    """The loop's hot path. A refusal is a normal return carrying a note, not
    a raise — a raise here is caught and degrades to a *silent* no-note, which
    the model then describes as a blank page."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "")
    deps = _deps()
    out = await asyncio.wait_for(_vision_fallback(deps, [], ""), timeout=5)
    assert out.needed is True and out.image == "" and out.note


@pytest.mark.asyncio
async def test_a_blocked_domain_is_never_photographed():
    """The user's own blocklist outranks the switch: a site they deliberately
    blacklisted is not one to photograph because a feature got switched on."""
    deps = _deps()
    deps.policy = Policy(blacklist=["bank.com"])
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://secure.bank.com/login/otp")
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()
    assert "treat it as unseen" in out.note.lower()


@pytest.mark.asyncio
async def test_a_refused_capture_tells_the_model_nothing_about_the_url():
    """The gate checks the switch before the domain so a run with capture off
    cannot even infer that this URL would have been blocked. That ordering is
    only worth anything if the reason is not forwarded — a machine word
    carrying the domain would undo it."""
    deps = _deps()
    deps.policy = Policy(blacklist=["bank.com"])
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://secure.bank.com/login/otp")
    out = await _vision_fallback(deps, [], "")
    assert out.image == ""
    for leak in ("bank", "otp", "capture_not_enabled", "domain_blocked"):
        assert leak not in out.note.lower(), leak


# ── through the loop ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_loop_hands_the_image_to_the_turn(monkeypatch):
    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    deps = _deps()
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    assert seen[0].screenshot == JPEG
    assert seen[0].screenshot_note


@pytest.mark.asyncio
async def test_a_refused_capture_reaches_the_model_through_the_loop(monkeypatch):
    """End to end, and at the level that was masked: the gate is off, the
    loop escalates anyway, and what `_plan_step` hands the model must carry the
    refusal. Both `_plan_step` call sites pass `_turn_to_input`'s result
    straight to `agent.run` with no string handling, so rendering it here is
    what the model gets."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "")
    seen: list = []

    async def _fake_plan(deps, turn, agent, audit=None):
        # exactly what the real _plan_step does with the turn
        seen.append(_turn_to_input(turn))
        return _COMPLETE, 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    deps = _deps()
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    deps.cdp.capture_screenshot.assert_not_awaited()
    parts = seen[0]
    assert isinstance(parts, list) and len(parts) == 2
    assert "treat it as unseen" in parts[1].lower()


@pytest.mark.asyncio
async def test_a_sparse_page_through_the_loop_lands_in_the_turn(monkeypatch):
    """The whole chain on the new branch: a page of toolbar chrome on a
    spreadsheet task escalates, and what `_plan_step` would hand the model is
    the image preceded by the *sparse* note — not the "both are empty" one."""
    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    turn = seen[0]
    assert turn.screenshot == JPEG
    assert turn.screenshot_note == harness_mod._SCREENSHOT_PARTIAL_NOTE
    # and it rides as prompt parts, image last, like every other capture
    parts = _turn_to_input(turn)
    assert isinstance(parts, list) and len(parts) == 3
    assert parts[1] == harness_mod._SCREENSHOT_PARTIAL_NOTE


@pytest.mark.asyncio
async def test_a_normal_page_step_carries_no_screenshot(monkeypatch):
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    deps = _deps(targets=[SemanticTarget(ref_id="b1", tag="button",
                                         role="button", name="Board")])
    deps.cdp.get_page_text = AsyncMock(return_value="Inbox")
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    assert [t.screenshot for t in seen] == [""]
    deps.cdp.capture_screenshot.assert_not_awaited()


# ── redaction, the budget across a resume, and what the note may claim ──────


@pytest.mark.asyncio
async def test_a_page_with_a_credential_on_it_is_never_photographed(monkeypatch):
    """Redaction reported a hit on this step, so the picture must not be taken.

    `redact_text` fires on the page text at the top of every step, and a
    screenshot is the one page-content channel it cannot see — pixels. So on a
    step the harness has *already established* holds something credential-shaped,
    photographing it is exactly the leak the redaction exists to prevent. The
    sparse trigger is what made this reachable at scale: "under 400 characters
    of text" is most login and payment pages, and only the old empty-tree
    trigger was narrow enough that there was little there to photograph.

    Driven through the loop, not through `_vision_fallback`, because the
    parameter is wired at the call site and a direct call would not test it.
    """
    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Sign in", task="fill in the spreadsheet")
    deps.cdp.get_page_text = AsyncMock(
        return_value="Card 4111 1111 1111 1111")
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    deps.cdp.capture_screenshot.assert_not_awaited()
    # The step is not blind *because of* the refusal — it still carries the
    # redacted text; only the picture is withheld.
    assert seen[0].screenshot == ""
    assert "treat it as unseen" in seen[0].screenshot_note.lower()


@pytest.mark.asyncio
async def test_a_credential_shaped_page_is_refused_by_the_fallback_directly():
    """The unit-level guard, so a future caller that builds its own step cannot
    skip it by forgetting to pass the dict — an explicit empty dict is the
    claim "this page is clean" and has to be stated."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Sign in", task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Card [redacted]:card", {"card": 1})
    assert out.image == "" and out.needed is True
    deps.cdp.capture_screenshot.assert_not_awaited()
    assert "treat it as unseen" in out.note.lower()


def test_the_partial_note_does_not_assert_a_cause_or_invert_trust():
    """The tree above is still readable on the sparse branch, and the picture
    is unverified page content that may contradict it. Two ways to get that
    wrong: tell the model the image is its *best* view (it is a worse channel
    than the tree it can already read), and name a cause — `<canvas>` — the
    harness never verified. This page might have no canvas at all."""
    note = harness_mod._SCREENSHOT_PARTIAL_NOTE.lower()
    assert "best view" not in note
    assert "canvas" not in note
    assert "tree above" in note
    assert "page content" in note and "instruction" in note


@pytest.mark.asyncio
async def test_the_capture_budget_survives_a_resumed_task(monkeypatch):
    """The ceiling is per *task*, and a crash resume continues the same task —
    `harness.run(deps, resume=True)` reopens the same document with the same
    `task_id`. Zeroing the counter at the top of `run()` therefore handed a
    resumed task a fresh budget every time it was reconnected, so the cap was
    per run in practice while the comment above it claimed per task. Pins the
    opposite direction too: a *fresh* deps still starts at zero, because
    AgentDeps is built per task and its default is the zero."""
    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Board",
                 task="fill in the spreadsheet")
    # A resumed task arrives with the budget its earlier run already spent.
    deps.screenshots_taken = harness_mod._MAX_CAPTURES_PER_TASK
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    deps.cdp.capture_screenshot.assert_not_awaited()
    assert seen[0].screenshot == ""
    # And a task that has spent nothing still gets its full allowance.
    deps2 = _deps(targets=targets, page_text="Board",
                  task="fill in the spreadsheet")
    seen2: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen2)
    await asyncio.wait_for(AgentHarness().run(deps2), timeout=10)
    assert seen2[0].screenshot == JPEG


@pytest.mark.asyncio
async def test_the_image_never_reaches_the_audit_document(monkeypatch, tmp_path):
    """Transit only. The base64 is page content; one byte of it on disk is the
    leak W1's `capture_screenshot` was written to prevent."""
    seen: list[AgentTurn] = []
    _stub_plan(monkeypatch, seen)
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    deps = _deps()
    deps.task_id = "s1"
    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    assert result.status == "completed"
    written = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert written, "no document was written — the assertion below is vacuous"
    assert any("task_complete" in p.read_text(errors="ignore") for p in written)
    for path in written:
        assert JPEG not in path.read_text(errors="ignore"), path

@pytest.mark.asyncio
async def test_a_password_this_run_typed_vetoes_the_capture():
    """The page-text channel alone is the wrong and dangerous direction.

    `redact_text` is regex over strings; it cannot recognise an arbitrary
    password the agent itself typed. `run_secrets` is the list of values this
    run put into fields `_typed_field` judged secret — and a value that was
    just typed is in the pixels by definition, on any page that later renders
    it. So an empty `redactions` must not read as clearance here.
    """
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Sign in",
                 task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Untitled", {}, ["hunter2-xyz"])
    assert out.image == "" and out.needed is True
    deps.cdp.capture_screenshot.assert_not_awaited()
    assert "treat it as unseen" in out.note.lower()


@pytest.mark.asyncio
async def test_both_signals_empty_still_captures():
    """The other direction: the veto must not be able to refuse everything.

    An empty dict means "no detector fired", not "this page is clean" — a
    caller reading the absence as clearance is the bug this session produced
    twice.
    """
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Sign in",
                 task="fill in the spreadsheet")
    out = await _vision_fallback(deps, targets, "Untitled", {}, [])
    assert out.image == JPEG


@pytest.mark.asyncio
async def test_the_typed_secret_veto_precedes_the_capability_resolve(monkeypatch):
    """A refusal must cost nothing: no resolve, no capture, before either."""
    targets = _toolbar(40)
    deps = _deps(targets=targets, page_text="Sign in",
                 task="fill in the spreadsheet")
    seen: list[str] = []
    monkeypatch.setattr(
        harness_mod, "_vision_capability",
        lambda d: seen.append("resolved"))
    await _vision_fallback(deps, targets, "Untitled", {}, ["hunter2-xyz"])
    assert seen == []
