"""A step's page must be a frame the server asked for.

`webNavigation.onCommitted` pushes an observation the instant a navigation
commits — before the new page has rendered. `_get_observation` used to take
whatever was on the queue, solicited or not, so that push could become a
step's accessibility tree: the model would be shown the page *before* the
popover it had just clicked opened, and told `Clicked [0:37563]: ok`.

Measured on session 7d567b66, and it is the whole story of the failed run.
Steps 10 through 13 all show `ax_targets: 151`, `page_text_chars: 3244` —
byte-identical — while the agent clicked the branch selector three times and
never saw one branch. The per-step observe timings alternate 3.0s and 0.001s,
and the 1ms ones are exactly the steps that got a free pushed frame.

The extension now tags each frame with why it was sent. These tests pin the
two rules that matter and the one that would otherwise hang forever.
"""

import asyncio

import pytest

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay, TabUnreachable


def _relay() -> tuple[ExtensionCDPRelay, asyncio.Queue]:
    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    q: asyncio.Queue = asyncio.Queue()
    return ExtensionCDPRelay(ws_send, q, asyncio.Queue(), "t"), q


def _obs(reason: str | None, url: str, n: int) -> dict:
    frame = {
        "url": url,
        "axTargets": [{"ref": f"0:{i}", "role": "option", "name": f"b{i}",
                       "x": i, "y": i} for i in range(n)],
    }
    if reason is not None:
        frame["reason"] = reason
    return frame


@pytest.mark.asyncio
async def test_a_navigation_push_is_not_the_step_page():
    """The push is kept — the URL moved, which is real information — but it is
    not handed to the step as the tree it reasons over."""
    relay, q = _relay()

    async def answer() -> None:
        # The push lands first, as it did on the live run.
        await q.put(_obs("navigated", "https://app.example.com/old", 2))
        await q.put(_obs("observe", "https://app.example.com/new", 7))

    task = asyncio.create_task(answer())
    targets = await relay.get_targets()
    await task

    assert len(targets) == 7, "the step was shown the pre-render push"
    assert relay._cached_obs["url"].endswith("/new")


@pytest.mark.asyncio
async def test_the_skipped_push_is_still_available_as_the_url():
    """Dropping it would lose the one thing it reliably knows."""
    relay, q = _relay()

    async def answer() -> None:
        await q.put(_obs("navigated", "https://app.example.com/pushed", 2))
        await q.put(_obs("observe", "https://app.example.com/steps", 3))

    task = asyncio.create_task(answer())
    await relay.get_targets()
    relay._obs_queue.put_nowait(_obs("observe", "https://app.example.com/step", 1))
    await task

    await relay._ensure_fresh_obs()
    # The later frame wins — it is the newer one — but nothing is stranded.
    assert relay._cached_obs["url"].endswith("/step")


@pytest.mark.asyncio
async def test_an_older_extension_that_sends_no_reason_still_works():
    """The one that would otherwise hang.

    An extension predating the `reason` field tags nothing. Skipping untagged
    frames would make every step request an observation, discard it as
    unsolicited, and request again — forever, with no timeout to stop it,
    because the extension keeps answering.
    """
    relay, q = _relay()

    async def answer() -> None:
        await q.put(_obs(None, "https://app.example.com/legacy", 4))

    task = asyncio.create_task(answer())
    targets = await asyncio.wait_for(relay.get_targets(), timeout=5)
    await task

    assert len(targets) == 4


@pytest.mark.asyncio
async def test_an_observation_error_is_not_skipped_as_an_unsolicited_frame():
    """It carries no reason, so a reason check that ran first would swallow it
    and the step would hang instead of reporting a lost tab. Unwrap before
    checking."""
    relay, q = _relay()

    async def answer() -> None:
        await q.put({"__error__": "debugger detached"})

    task = asyncio.create_task(answer())
    with pytest.raises(TabUnreachable):
        await asyncio.wait_for(relay.get_targets(), timeout=5)
    await task


@pytest.mark.asyncio
async def test_a_navigation_push_during_an_action_does_not_answer_it():
    """`_send_action` waits for the frame its own action produced. A push that
    lands mid-wait belongs to the page, not to the call."""
    relay, q = _relay()

    async def answer() -> None:
        await q.put(_obs("navigated", "https://app.example.com/mid", 2))
        await q.put(_obs("action", "https://app.example.com/after", 6))

    task = asyncio.create_task(answer())
    await asyncio.wait_for(relay._send_action({"type": "click", "x": 1, "y": 1}), timeout=5)
    await task

    assert len(relay._cached_obs["axTargets"]) == 6