"""The dev (`/run`) action path must actually dispatch an action.

Two independent defects made every action on the Playwright path fail:

1. `CDPRelay.get_targets()` returned the freshly extracted AX targets but
   never published them to `browser.target_map`, and `refresh_target_map()`
   only runs *after* a navigate/click/scroll — so the first action of any
   task died on "Target not found".
2. `_handle_left_click` / `_handle_insert_text` preferred
   `[data-backend-node-id="N"]`, which is not a DOM attribute (it belongs to
   Playwright's aria snapshot). That branch always burned its timeout. The
   extractor already resolves a node's box via `DOM.getBoxModel`, and the
   coordinate path below works.

Both are only reachable on the Playwright dev relay; the extension path uses
`ExtensionCDPRelay` and its own action dispatch, so these assertions pin the
dev path without touching production.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.cdp.relay import CDPRelay
from brotto_orchestrator.dev.playwright_browser import PlaywrightBrowser
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


def _target(ref: str = "button_abc12345") -> SemanticTarget:
    return SemanticTarget(
        ref_id=ref, tag="button", role="button", name="Sign in",
        coordinates={"x": 449, "y": 82}, backend_node_id=15,
    )


@pytest.mark.asyncio
async def test_get_targets_publishes_the_map_actions_read_from():
    """Observing must leave `target_map` populated — the harness observes and
    then dispatches, with no refresh in between."""
    browser = MagicMock()
    browser._extract_semantic_targets = AsyncMock(return_value=[_target()])
    relay = CDPRelay(browser)

    returned = await relay.get_targets()

    assert [t.ref_id for t in returned] == ["button_abc12345"]
    assert browser.target_map == {"button_abc12345": returned[0]}


@pytest.mark.asyncio
async def test_click_ref_dispatches_by_coordinates():
    """A target with a box must be clicked at its centre, not through the
    non-existent `[data-backend-node-id]` selector."""
    pb = PlaywrightBrowser()
    target = _target()
    pb.target_map = {target.ref_id: target}
    pb.page = MagicMock()
    pb.page.mouse = MagicMock()
    pb.page.mouse.click = AsyncMock()

    out = await pb._handle_left_click({"target_id": target.ref_id})
    assert out["ok"] is True
    pb.page.mouse.click.assert_awaited_once_with(449, 82)


@pytest.mark.asyncio
async def test_click_ref_reports_a_target_with_no_geometry():
    """No box and no usable selector is an error, not a silent no-op."""
    pb = PlaywrightBrowser()
    target = SemanticTarget(
        ref_id="button_dead", tag="button", role="button", name="Ghost",
        coordinates={}, backend_node_id=15,
    )
    pb.target_map = {target.ref_id: target}
    pb.page = MagicMock()
    pb.page.mouse = MagicMock()
    pb.page.mouse.click = AsyncMock()

    out = await pb._handle_left_click({"target_id": target.ref_id})
    assert out["ok"] is False
    pb.page.mouse.click.assert_not_awaited()


@pytest.mark.asyncio
async def test_insert_text_clicks_then_types_into_the_box():
    """`page.fill` needs a locator, and there is no backend-node-id selector
    to build one from — a focused element is the route to the text."""
    pb = PlaywrightBrowser()
    target = SemanticTarget(
        ref_id="textbox_abc12345", tag="input", role="textbox", name="Email",
        coordinates={"x": 122, "y": 82}, backend_node_id=10,
    )
    pb.target_map = {target.ref_id: target}
    pb.page = MagicMock()
    pb.page.mouse = MagicMock()
    pb.page.mouse.click = AsyncMock()
    pb.page.keyboard = MagicMock()
    pb.page.keyboard.type = AsyncMock()

    out = await pb._handle_insert_text(
        {"target_id": target.ref_id, "text": "dev@example.com"}
    )
    assert out["ok"] is True
    pb.page.mouse.click.assert_awaited_once_with(122, 82)
    pb.page.keyboard.type.assert_awaited_once_with("dev@example.com")
