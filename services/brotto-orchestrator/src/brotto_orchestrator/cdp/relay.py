"""CDPRelay: unified interface over playwright (dev) or WebSocket tunnel (extension)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from ..agent.ax_filter import PAGE_TEXT_MAX
from ..dev.ax_tree_extractor import SemanticTarget

log = logging.getLogger(__name__)

# The key names a `press_key` may carry. Closed set, shared by both relays
# and by the harness's redaction predicate, because a validator that says one
# thing and a consumer that does another is the exact failure
# `is_secret_field`'s docstring forbids: the extension enforced this list
# while the dev relay enforced nothing, and `_typed_field` used a length
# heuristic ("one character is a literal, longer is a name") that a two-
# character password slips straight through.
#
# A name Chrome cannot resolve is a no-op that still reports success, which
# is its own failure: a model that reaches for the wrong spelling then
# watches the field it is trying to clear refuse to clear. A recorded run
# sent `ControlOrMeta+a` three times -- a Playwright alias -- and got three
# rounds of "ok" with nothing pressed.
PRESSABLE_KEYS = frozenset({
    "Backspace", "Delete", "Enter", "Escape", "Space", "Tab",
    "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp",
    "End", "Home", "PageDown", "PageUp",
})


def is_pressable_key(key: str, modifiers: int = 0) -> bool:
    """May this relay dispatch it?

    A bare letter is rejected but a modified one is allowed: a bare letter
    types into the focused field, which is `type_text`'s job, while
    `Control+a` is a shortcut. `modifiers` must already be masked to the four
    CDP bits before this -- masking afterwards means `press_key("a", 4096)`
    satisfies the test on the truthy 4096 and then dispatches as a bare "a",
    which types into the field, the one outcome the guard exists to prevent.

    `str.isalnum()` is true for "é" and "क" too, so ASCII is checked
    explicitly: CDP would happily dispatch a character the model had no
    reason to name.
    """
    modifiers &= 0xF
    bare_letter = len(key) == 1 and key.isascii() and key.isalnum()
    return key in PRESSABLE_KEYS or bool(bare_letter and modifiers)

# Select-all, through the DOM's own selection API. Shared by both relays so
# dev and product clear a field the same way — a second copy of this string
# would drift, and it is the kind of text where drifting is invisible.
#
# There is no cross-platform key chord for select-all: Meta on macOS, Ctrl
# everywhere else. A relay that hardcoded Ctrl meant "move to line start" on a
# Mac, so the field kept its old text, `type_text` appended to it, and the
# model's only remaining move was Backspace — one character per step, for ten
# steps, on a field that ended up holding
# "Protect mainmainProteProtect mainProtect mainct ma" (session 7d567b66).
# Branching on `sys.platform` or sniffing `navigator.platform` fixes only the
# machine you tested on.
#
# `select()` is the spec's own "select the text in this control" and involves
# no keyboard, so it is the same operation on every OS. A contenteditable —
# Google Docs, a rich-text comment box — has no `.select()` and needs a Range.
# Returns a verb rather than nothing, so the caller can tell a cleared field
# from a click that hit something unselectable.
SELECT_ALL_JS = (
    "(function () {"
    "  var el = document.activeElement;"
    "  if (!el || el === document.body) return 'no-focus';"
    "  try {"
    "    if (typeof el.select === 'function') { el.select(); return 'select-all'; }"
    "    if (el.isContentEditable) {"
    "      var sel = document.getSelection();"
    "      var range = document.createRange();"
    "      range.selectNodeContents(el);"
    "      sel.removeAllRanges();"
    "      sel.addRange(range);"
    "      return 'select-all';"
    "    }"
    "  } catch (e) { return 'error: ' + (e && e.name); }"
    "  return 'not-a-text-field: ' + el.tagName;"
    "})()"
)

# A stable name for whatever is focused right now, for the `press_key` focus
# guard. Not a DOM object and not a node id — an id minted per evaluation would
# change every read, so the guard would fire on nothing; a backendNodeId would
# be stable but is not reachable from the one `Runtime.evaluate` both relays
# already have. `TAG#id` where the element has one, otherwise its ordinal
# among same-tag elements, which is unique in a document and does not move
# when focus does.
#
# **But the page chooses the id, and a duplicated one is two elements with one
# name.** The guard compares this string before and after the model thinks; a
# page that puts `id="q"` on both its search box and its delete button makes a
# focus move between them read as "focus did not move", and the keystroke is
# allowed through. Page-controlled identity defeating a page-controlled guard is
# the whole hole, so an id that is not unique among same-tag elements yields
# `""` — unknown, which `focus_id()` reports as None and the guard refuses on.
# Refusing costs one step; the mistake it prevents is an Enter sent to the user's
# email draft.
#
# The value is never sanitised further: it is compared and discarded, and it
# never reaches a log line as user content.
#
# Returns a plain string because the extension's `evaluate_result` stringifies
# whatever comes back; `"none"` (no activeElement) and `"body"` (focus on the
# body, i.e. nowhere) are distinct from `""`, which is what a failed, errored or
# ambiguous evaluate produces and which the guard reads as unknown.
FOCUS_ID_JS = (
    "(function () {"
    "  var a = document.activeElement;"
    "  if (!a) return 'none';"
    "  if (a === document.body) return 'body';"
    "  var t = a.tagName;"
    "  var all = document.getElementsByTagName(t);"
    "  var i;"
    "  if (a.id) {"
    "    var n = 0;"
    "    for (i = 0; i < all.length; i++) {"
    "      if (all[i].id === a.id) n++;"
    "    }"
    "    if (n === 1) return t + '#' + a.id;"
    "    return '';"
    "  }"
    "  for (i = 0; i < all.length; i++) {"
    "    if (all[i] === a) return t + '[' + i + ']';"
    "  }"
    "  return t;"
    "})()"
)


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

    async def capture_screenshot(self) -> str | None:
        """Base64 JPEG of the viewport, or None. Same contract as
        `ExtensionCDPRelay.capture_screenshot`: the vision fallback is a
        harness feature, not an extension feature, so the dev relay needs it
        too or `/run` goes blind on exactly the pages the fallback exists for."""
        if not self._browser.page:
            return None
        try:
            raw = await self._browser.page.screenshot(type="jpeg", quality=60)
            import base64
            return base64.b64encode(raw).decode("ascii")
        except Exception as e:
            log.debug("capture_screenshot failed: %s", e)
            return None

    async def get_page_delta(self, policy: Any = None, redactions=None,
                             run_secrets=None) -> dict | None:
        """Always None. The delta is computed in the extension's service worker
        from a captured frame; Playwright has no equivalent, and `None` is the
        honest answer for every observation. It exists so the harness can call
        one method without branching on the relay — and because `None` is also
        what the extension omits for, so the caller cannot distinguish "absent"
        from "unsupported", which is correct: neither is evidence.
        `redactions`/`run_secrets` are the extension relay's veto inputs and
        the harness passes them on every call; there are no pixels here, so
        there is nothing for them to veto."""
        return None

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
        if not self._browser.page:
            return "Error executing: no page is attached"
        # The same DOM expression the extension path uses, so dev and product
        # clear a field identically. There is no cross-platform key chord for
        # select-all — Meta on macOS, Ctrl elsewhere — and branching on
        # `sys.platform` would make the dev path correct only on the machine
        # it was written on. `select()` is the spec's own "select the text in
        # this control" and behaves the same on every OS.
        result = await self._browser.page.evaluate(SELECT_ALL_JS)
        if result != "select-all":
            return (
                f"Error executing: ref {ref!r} could not be cleared — the page "
                f"said {result!r}. If it is not a text field, use click or "
                f"press_key instead."
            )
        return "ok"

    # Dev twin of the extension relay's coordinate actions — same probe, same
    # `page.mouse` dispatch, so `/run` and the product path cannot disagree
    # about what "the topmost element at this point" means.

    async def probe_xy(self, x: int, y: int) -> dict:
        if not self._browser.page:
            return {}
        import json as _json
        expr = (
            'JSON.stringify({width: window.innerWidth, height: window.innerHeight,'
            f' tag: (document.elementFromPoint({int(x)}, {int(y)}) || {{}}).tagName || ""}})'
        )
        try:
            raw = await self._browser.page.evaluate(expr)
            data = _json.loads(str(raw))
            return data if isinstance(data, dict) else {}
        except Exception as e:  # noqa: BLE001 — best effort, {} means "refuse"
            log.debug("probe_xy failed: %s", e)
            return {}

    async def click_xy(self, x: int, y: int) -> str:
        if not self._browser.page:
            return "Error executing: no page is attached"
        await self._browser.page.mouse.click(int(x), int(y))
        return f"Clicked at ({x},{y})"

    async def focus_xy(self, x: int, y: int) -> str:
        return await self.click_xy(x, y)

    async def type_text_at_focus(self, text: str) -> str:
        if not self._browser.page:
            return "Error executing: no page is attached"
        # `insert_text`, not `type`: one input event for the whole string,
        # which is what a canvas editor wants and what per-character key
        # events do not reach.
        await self._browser.page.keyboard.insert_text(text)
        return f"Typed {len(text)} characters"

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
        if not is_pressable_key(key, modifiers):
            # The rejected value is not echoed: this string is the tool's
            # return value, which the harness writes to the audit document
            # and hands the model in the next step's history. Naming it would
            # write whatever was refused straight into both.
            return (
                "Error executing: that is not a key this client can dispatch, "
                f"so nothing was pressed. Use one of "
                f"{', '.join(sorted(PRESSABLE_KEYS))}, or a single letter with "
                f"a modifiers bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). To "
                "replace a field's contents, just use type_text with the value "
                "you want."
            )
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

    async def focus_id(self) -> str | None:
        """A stable name for the focused element, or None if unreadable.

        None is the honest answer and the guard treats it as unknown — see
        `FOCUS_ID_JS`. Never raises: this backs a refusal, and a relay that
        raised here would abort the step instead of the keystroke.
        """
        if not self._browser.page:
            return None
        try:
            value = await self._browser.page.evaluate(FOCUS_ID_JS)
        except Exception as exc:
            log.debug("focus_id failed: %s", exc)
            return None
        text = str(value or "")
        return text or None

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
