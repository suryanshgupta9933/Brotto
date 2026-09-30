"""CDPRelay: unified interface over playwright (dev) or WebSocket tunnel (extension)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from ..agent.ax_filter import PAGE_TEXT_MAX
from ..dev.ax_tree_extractor import SemanticTarget

log = logging.getLogger(__name__)


class CDPRelay:
    """Wraps a PlaywrightBrowser for dev mode.

    For extension mode, replace _browser with a WebSocket-based implementation
    that forwards CDP commands through the tunnel.
    """

    def __init__(self, browser: Any) -> None:
        # ponytail: duck-typed — works with PlaywrightBrowser or any compatible impl
        self._browser = browser

    async def navigate(self, url: str) -> None:
        await self._browser._handle_visit_url({"url": url})
        await asyncio.sleep(0.5)  # brief settle after navigation

    async def get_targets(self) -> list[SemanticTarget]:
        # Publish the map as a side effect. The harness observes with this
        # call and dispatches its next action against `target_map`, and
        # nothing else had filled it: refresh_target_map only runs *after* a
        # navigate/click/scroll, so the first action of every task failed with
        # "Target not found". observe() already does this; mirror it here.
        targets = await self._browser._extract_semantic_targets()
        self._browser.target_map = {t.ref_id: t for t in targets}
        return targets

    async def get_current_url(self) -> str:
        if self._browser.page:
            return self._browser.page.url
        return ""

    async def get_page_title(self) -> str:
        if self._browser.page:
            return await self._browser.page.title()
        return ""

    async def get_page_text(self) -> str:
        if not self._browser.page:
            return ""
        try:
            text = await self._browser.page.evaluate(
                f"((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ')"
                f".slice(0, {PAGE_TEXT_MAX})"
            )
            return str(text or "")
        except Exception as e:
            log.debug("get_page_text failed: %s", e)
            return ""

    # ponytail: `Error executing:` prefix is the contract — harness.py
    # derives `ok` from it, so an unresolvable ref must not read as success.

    async def click_ref(self, ref: str) -> str:
        target = self._browser.target_map.get(ref)
        if not target:
            return f"Error executing: ref {ref!r} is not in the current target map"
        result = await self._browser._handle_left_click({"type": "left_click", "target_id": ref})
        if not result.get("ok"):
            return f"Error executing: ref {ref!r} {result.get('error', 'failed')}"
        return "ok"

    async def focus_ref(self, ref: str) -> str:
        return await self.click_ref(ref)

    async def clear_ref(self, ref: str) -> str:
        focused = await self.focus_ref(ref)
        if focused.startswith("Error executing"):
            return focused
        if self._browser.page:
            await self._browser.page.keyboard.press("Control+A")
        return "ok"

    async def type_text_to_ref(self, ref: str, text: str) -> str:
        if ref not in self._browser.target_map:
            return f"Error executing: ref {ref!r} is not in the current target map"
        result = await self._browser._handle_insert_text(
            {"type": "insert_text", "target_id": ref, "text": text}
        )
        if not result.get("ok"):
            return f"Error executing: ref {ref!r} {result.get('error', 'failed')}"
        return "ok"

    async def press_key(self, key: str, modifiers: int = 0) -> str:
        """`modifiers` is CDP's bitmask; Playwright wants "Control+a"."""
        if not self._browser.page:
            return "no page"
        names = [
            name
            for bit, name in ((1, "Alt"), (2, "Control"), (4, "Meta"), (8, "Shift"))
            if modifiers & bit
        ]
        await self._browser.page.keyboard.press("+".join(names + [key]))
        return "ok"

    async def scroll(self, direction: str, amount: int = 300) -> None:
        await self._browser._handle_scroll({"type": "scroll", "direction": direction, "amount_px": amount})

    async def wait_for_network_idle(self, timeout: int = 8) -> None:
        if self._browser.page:
            try:
                await self._browser.page.wait_for_load_state("networkidle", timeout=timeout * 1000)
            except Exception:
                pass

    async def ping(self) -> bool:
        if not self._browser.page:
            return False
        try:
            await asyncio.wait_for(
                self._browser.page.evaluate("1"),
                timeout=5.0,
            )
            return True
        except Exception:
            return False

    async def read_page_text(self, selector: str = "body", max_chars: int = 3000) -> str:
        if not self._browser.page:
            return "(no page)"
        try:
            text = await self._browser.page.evaluate(
                f'(document.querySelector({repr(selector)}) || document.body).innerText.substring(0, {max_chars})'
            )
            return str(text or "")
        except Exception as e:
            return f"(error reading page text: {e})"

    async def refresh_target_map(self) -> None:
        """Re-extract AX targets and update browser's target_map."""
        targets = await self._browser._extract_semantic_targets()
        self._browser.target_map = {t.ref_id: t for t in targets}

    async def get_attributes(self, backend_node_id: int) -> dict[str, str]:
        """DOM attributes for one node, or {} on any failure.

        Same contract as the extension relay: this backs password redaction,
        and raising here would abort a type_text that was about to succeed.
        The caller falls back to the accessible-name check.
        """
        if not backend_node_id or not self._browser.page:
            return {}
        try:
            session = await self._browser.page.context.new_cdp_session(self._browser.page)
            resp = await session.send(
                "DOM.getAttributes", {"backendNodeId": int(backend_node_id)}
            )
        except Exception as e:
            log.debug("get_attributes failed: %s", e)
            return {}
        # CDP returns a flat [name, value, name, value, ...] list.
        flat = (resp or {}).get("attributes") or []
        return {str(flat[i]): str(flat[i + 1]) for i in range(0, len(flat) - 1, 2)}
