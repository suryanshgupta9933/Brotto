"""CDPRelay backed by a browser extension WebSocket instead of Playwright."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Callable, Awaitable

from ..dev.ax_tree_extractor import SemanticTarget

log = logging.getLogger("brotto.ext_relay")

# The keys the extension carries a CDP key code for. Anything outside this set
# is rejected rather than forwarded: a key name Chrome cannot resolve is a
# no-op that still reports success, and a model that reaches for the wrong
# spelling then watches the field it is trying to clear refuse to clear. A
# recorded run sent `ControlOrMeta+a` three times — it is a Playwright alias —
# and got three rounds of "Pressed ControlOrMeta+a: ok" with nothing pressed.
_PRESSABLE_KEYS = frozenset({
    "Backspace", "Delete", "Enter", "Escape", "Space", "Tab",
    "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp",
    "End", "Home", "PageDown", "PageUp",
})

# ponytail: 2s ceiling on a best-effort lookup. A slower extension degrades to
# the accessible-name check (over-redact, not under-redact); raise it only if
# live runs show real timeouts.
_ATTRS_TIMEOUT = 2.0


class ExtensionCDPRelay:
    """Implements the CDPRelay interface; delegates CDP to the browser extension over WebSocket.

    Protocol:
    - Server sends {type: "observe"} → extension replies {type: "observation", url, title, axTargets}
    - Server sends {type: "action", action: {...}} → extension executes, then auto-sends observation
    - We consume the auto-sent observation so the next get_targets() skips the round-trip.
    - Server sends {type: "get_attributes", backend_node_id, ref} → extension replies
      {type: "get_attributes_result", ref, attributes: {name: value}}. Correlated by `ref`
      and resolved by the caller via deliver_attributes_result().
    """

    def __init__(
        self,
        ws_send: Callable[[dict], Awaitable[None]],
        obs_queue: asyncio.Queue,
        eval_queue: asyncio.Queue | None = None,
        session_id: str = "?",
    ) -> None:
        self._ws_send = ws_send
        self._obs_queue = obs_queue
        self._eval_queue: asyncio.Queue = eval_queue or asyncio.Queue()
        self._sid = session_id
        self._cached_obs: dict | None = None
        self._attrs: asyncio.Queue = asyncio.Queue()
        self._pending_attrs: set[str] = set()

    # ---------- Internal ----------

    async def _get_observation(self) -> dict:
        """Return fresh observation; request one from extension if queue is empty."""
        if self._obs_queue.empty():
            log.debug("[%s] requesting observation", self._sid)
            await self._ws_send({"type": "observe"})
        else:
            log.debug("[%s] using queued observation", self._sid)
        try:
            obs = await asyncio.wait_for(self._obs_queue.get(), timeout=30)
        except asyncio.TimeoutError:
            log.error("[%s] timed out waiting for observation", self._sid)
            raise
        self._cached_obs = obs
        log.debug(
            "[%s] observation received  url=%s  ax=%d",
            self._sid, obs.get("url", "")[:80], len(obs.get("axTargets", [])),
        )
        return obs

    async def _send_action(self, action: dict) -> None:
        """Send action to extension; wait for the auto-sent post-action observation."""
        log.debug("[%s] sending action %s", self._sid, action)
        await self._ws_send({"type": "action", "action": action})
        try:
            obs = await asyncio.wait_for(self._obs_queue.get(), timeout=30)
        except asyncio.TimeoutError:
            log.error("[%s] timed out waiting for post-action observation after %s", self._sid, action)
            raise
        self._cached_obs = obs
        log.debug(
            "[%s] post-action observation  url=%s  ax=%d",
            self._sid, obs.get("url", "")[:80], len(obs.get("axTargets", [])),
        )

    def _locate(self, ref: str) -> tuple[dict | None, str]:
        """Resolve a ref to click coordinates. Returns (coords, reason);
        reason is "" on success.

        The two failure states are kept apart because only one is a grounding
        error. Absent from `axTargets` means the model named a ref this page
        does not have; present-but-no-box means it named a real element that is
        off-screen. Collapsing them made a hallucination indistinguishable from
        a correct guess at something scrolled out of view.
        """
        if not self._cached_obs:
            return None, "cannot resolve: no observation captured yet"
        targets = self._cached_obs.get("axTargets", [])

        def at(t: dict) -> tuple[dict | None, str]:
            if "x" in t and "y" in t:
                return {"x": t["x"], "y": t["y"]}, ""
            return None, "is off-screen (no box model in the last observation)"

        for t in targets:
            if str(t.get("ref")) == str(ref):
                return at(t)

        # The model drops the frame prefix: the tree renders `[0:149099]` and
        # the action carries `ref: 149099`. On a live Gmail run that happened on
        # 4 of 4 steps, so every click failed and every step was spent
        # re-deciding an unchanged page. The prompt was already fixed — the
        # bare-number anti-examples that taught this are gone and the test
        # pinning that still passes — so this is a format the model cannot be
        # relied on to reproduce, not a prompt defect to re-fix.
        hits = [t for t in targets if str(t.get("ref", "")).endswith(":" + str(ref))]
        if len(hits) == 1:
            return at(hits[0])
        if len(hits) > 1:
            # A nodeId is unique only within its frame, so the bare form can
            # name a real element twice. Guessing would click the wrong one and
            # record ok=True — the failure the split above exists to keep out.
            real = ", ".join(sorted(str(t.get("ref")) for t in hits))
            return None, f"is ambiguous — node {ref} appears in several frames ({real}); use the full ref"
        return None, "is not in the current AX tree"

    # ---------- CDPRelay interface ----------

    async def ping(self) -> bool:
        log.debug("[%s] ping → ok", self._sid)
        return True

    async def get_targets(self) -> list[SemanticTarget]:
        obs = await self._get_observation()
        targets = _to_semantic(obs.get("axTargets", []))
        log.info("[%s] get_targets → %d targets", self._sid, len(targets))
        return targets

    async def _ensure_fresh_obs(self) -> None:
        """Drain any pending observation pushed by the SW (webNavigation
        or tabs.onUpdated) into the cache. Does NOT request a new
        observation — that's _get_observation's job. Keeps get_current_url
        / get_page_title cheap while still reflecting state changes that
        arrived between agent steps."""
        if self._cached_obs is not None and self._obs_queue.empty():
            return
        try:
            self._cached_obs = await asyncio.wait_for(self._obs_queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            pass

    async def get_current_url(self) -> str:
        await self._ensure_fresh_obs()
        url = (self._cached_obs or {}).get("url", "")
        log.debug("[%s] get_current_url → %s", self._sid, url)
        return url

    async def get_page_title(self) -> str:
        await self._ensure_fresh_obs()
        title = (self._cached_obs or {}).get("title", "")
        log.debug("[%s] get_page_title → %r", self._sid, title)
        return title

    async def get_page_text(self) -> str:
        """innerText, captured by the service worker alongside url/title.
        Free here — it's already in the cached observation."""
        await self._ensure_fresh_obs()
        return (self._cached_obs or {}).get("pageText", "") or ""

    async def navigate(self, url: str) -> None:
        log.info("[%s] navigate → %s", self._sid, url)
        await self._send_action({"type": "navigate", "url": url})

    async def wait_for_network_idle(self) -> None:
        pass  # extension adds its own delay after navigate

    async def refresh_target_map(self) -> None:
        pass  # next get_targets() will re-observe

    # ponytail: every ref-taking method below reports an unresolvable ref
    # with this prefix, because harness.py derives `ok` from
    # `not outcome.startswith("Error executing")`. A friendly sentence here
    # is written to the audit as a successful action.

    async def click_ref(self, ref: str) -> str:
        coords, why = self._locate(ref)
        if not coords:
            log.warning("[%s] click_ref %r — %s", self._sid, ref, why)
            return f"Error executing: ref {ref!r} {why}"
        log.info("[%s] click_ref %r at (%d,%d)", self._sid, ref, coords["x"], coords["y"])
        await self._send_action({"type": "click", **coords})
        return f"Clicked [{ref}]"

    async def focus_ref(self, ref: str) -> str:
        coords, why = self._locate(ref)
        if not coords:
            log.warning("[%s] focus_ref %r — %s", self._sid, ref, why)
            return f"Error executing: ref {ref!r} {why}"
        log.debug("[%s] focus_ref %r", self._sid, ref)
        await self._ws_send({"type": "action", "action": {"type": "click", **coords}})
        return f"Focused [{ref}]"

    async def clear_ref(self, ref: str) -> str:
        coords, why = self._locate(ref)
        if not coords:
            log.warning("[%s] clear_ref %r — %s", self._sid, ref, why)
            return f"Error executing: ref {ref!r} {why}"
        log.debug("[%s] clear_ref %r — click + select-all", self._sid, ref)
        await self._ws_send({"type": "action", "action": {"type": "click", **coords}})
        await self._ws_send({"type": "action", "action": {"type": "key", "key": "a", "modifiers": 2}})
        return f"Cleared [{ref}]"

    async def type_text_to_ref(self, ref: str, text: str) -> str:
        # Types into whatever holds focus, so an unresolvable ref means the
        # text lands in some *other* field. Guard before dispatching.
        coords, why = self._locate(ref)
        if not coords:
            log.warning("[%s] type_text_to_ref %r — %s", self._sid, ref, why)
            return f"Error executing: ref {ref!r} {why}"
        log.info("[%s] type_text_to_ref %r  len=%d", self._sid, ref, len(text))
        await self._send_action({"type": "type", "text": text})
        return f"Typed into [{ref}]"

    async def press_key(self, key: str, modifiers: int = 0) -> str:
        if key not in _PRESSABLE_KEYS:
            return (
                f"Error executing: press_key {key!r} is not a key this client can "
                f"dispatch, so nothing was pressed. Use one of "
                f"{', '.join(sorted(_PRESSABLE_KEYS))} — optionally with a "
                f"modifiers bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8), e.g. "
                f'{{"key": "a", "modifiers": 4}} to select all.'
            )
        log.info("[%s] press_key %r modifiers=%d", self._sid, key, modifiers)
        await self._send_action({"type": "key", "key": key, "modifiers": modifiers})
        return "ok"

    async def read_page_text(
        self,
        selector: str = "body",
        max_chars: int = 2000,
        around: str | None = None,
    ) -> str:
        """Read visible text from a page section.

        - selector: CSS selector (default "body")
        - max_chars: cap on returned chars (default 2000)
        - around: optional keyword; the read is centered on the first
          case-insensitive match. Falls back to top of body if no match.
        """
        # json.dumps produces a correctly-escaped JS string literal for
        # backslashes, quotes, newlines, and control chars. Embedding the
        # escaped form directly into the JS source avoids any string-breakout
        # for adversarial inputs (e.g. a selector containing `"` or `;`).
        import json as _json
        sel_js = _json.dumps(selector)
        if around:
            around_js = _json.dumps(around)
            half = max_chars // 2
            expr = f"""(() => {{
              const t = (document.querySelector({sel_js}) || document.body).innerText;
              const i = t.toLowerCase().indexOf({around_js}.toLowerCase());
              if (i < 0) return t.substring(0, {max_chars});
              const start = Math.max(0, i - {half});
              return t.substring(start, start + {max_chars});
            }})()"""
        else:
            expr = f'(document.querySelector({sel_js}) || document.body).innerText.substring(0, {max_chars})'
        log.info(
            "[%s] read_page_text  selector=%r  around=%r  max_chars=%d",
            self._sid, selector, around, max_chars,
        )
        await self._ws_send({"type": "evaluate", "expression": expr})
        try:
            text = await asyncio.wait_for(self._eval_queue.get(), timeout=15)
        except asyncio.TimeoutError:
            log.error("[%s] timed out waiting for evaluate_result", self._sid)
            return "(timeout reading page text)"
        log.debug("[%s] read_page_text → %d chars", self._sid, len(text))
        return text

    async def scroll(self, direction: str, amount_px: int) -> None:
        delta = amount_px if direction == "down" else -amount_px
        log.info("[%s] scroll  direction=%s  delta=%d", self._sid, direction, delta)
        await self._send_action({"type": "scroll", "deltaY": delta})

    async def get_attributes(self, backend_node_id: int) -> dict[str, str]:
        """DOM attributes for one node, or {} on any failure.

        Best-effort by design: this backs password redaction, and a relay
        that raised here would abort a type_text that was about to succeed.
        The caller falls back to the accessible-name check. Resolved lazily,
        once per typed action — never per target per step, which the loop's
        latency cannot afford.
        """
        if not backend_node_id:
            return {}
        ref = f"attrs-{uuid.uuid4().hex[:8]}"
        self._pending_attrs.add(ref)
        try:
            await self._ws_send({"type": "get_attributes",
                                 "backend_node_id": backend_node_id, "ref": ref})
            async with asyncio.timeout(_ATTRS_TIMEOUT):
                while True:
                    msg = await self._attrs.get()
                    if str(msg.get("ref", "")) != ref:
                        continue  # late or foreign result — not ours to answer
                    attrs = msg.get("attributes")
                    return attrs if isinstance(attrs, dict) else {}
        except Exception as exc:
            log.debug("[%s] get_attributes failed: %s", self._sid, exc)
            return {}
        finally:
            self._pending_attrs.discard(ref)

    async def deliver_attributes_result(self, message: dict) -> None:
        """Sink for an inbound get_attributes_result. Unmatched refs are
        dropped rather than queued, so a stale reply can't satisfy a later
        lookup or grow the queue on a session with nothing pending."""
        ref = str(message.get("ref", ""))
        if ref in self._pending_attrs:
            self._attrs.put_nowait(message)


def _to_semantic(ax_targets: list[dict]) -> list[SemanticTarget]:
    result = []
    for t in ax_targets:
        coords: dict[str, int] = {}
        if "x" in t and "y" in t:
            coords = {"x": t["x"], "y": t["y"]}
        result.append(SemanticTarget(
            ref_id=str(t.get("ref", "")),
            tag=t.get("role", ""),
            role=t.get("role", ""),
            name=t.get("name", ""),
            value=t.get("value"),
            coordinates=coords,
            # The extension sends the raw CDP parentId; refs are node ids, so
            # this is the same field the extractor fills with a ref hash.
            parent_ref_id=str(t["parent"]) if t.get("parent") is not None else None,
            href=t.get("href"),
            # Password detection needs the DOM node, and the AX node is the
            # only place its id is available. Carrying it costs one int on a
            # target that is already being sent.
            backend_node_id=t.get("backendNodeId"),
            # The extension's `aria-hidden` supplement. The site hid this from
            # the accessibility tree, so it is rendered `[hidden]` and never
            # pre-approved under secure mode.
            hidden=bool(t.get("hidden", False)),
        ))
    return result
