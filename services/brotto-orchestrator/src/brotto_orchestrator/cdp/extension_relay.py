"""CDPRelay backed by a browser extension WebSocket instead of Playwright."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Callable, Awaitable

from ..dev.ax_tree_extractor import SemanticTarget
from .relay import SELECT_ALL_JS

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

# One budget for a whole observation read, skipping included. A page that
# navigates in a loop keeps the extension pushing `navigated` frames, and a
# per-read timeout restarts on every one of them — so the wait would have no
# ceiling at all, set by a page the model never chose to open.
_OBSERVATION_TIMEOUT = 30.0

# Observation frames that arrived unprompted. `webNavigation.onCommitted`
# pushes one the instant a navigation commits — before the new page has
# rendered — and reading it as a step's tree shows the model the page *before*
# the thing it just clicked opened. See `_get_observation`.
#
# An *absent* reason is not this list. An extension predating the `reason`
# field sends none, and skipping its frames would make every step request a
# fresh observation, get one, discard it, and request again forever. Only an
# extension that positively says "navigated" is trusted to mean it.
_UNSOLICITED = frozenset({"navigated"})

# ponytail: 2s ceiling on a best-effort lookup. A slower extension degrades to
# the accessible-name check (over-redact, not under-redact); raise it only if
# live runs show real timeouts.
_ATTRS_TIMEOUT = 2.0


class TabUnreachable(RuntimeError):
    """The extension could not read the tab — it lost the debugger, or there
    was no tab to read.

    Distinct from a grounding failure on purpose. A ref that does not resolve
    is the model being wrong about a page it could see; this is the page not
    being available at all, and handing the model a blank observation for it
    makes a broken instrument look like an empty website.
    """


def _unwrap_observation(obs: dict) -> dict:
    """The frame the extension sends when it *could not* read the page, rather
    than what it read. `main.py` puts this on the observation queue in place of
    an observation so the waiter wakes immediately; it is not a page, and the
    one consumer that would have treated it as one is what this guards."""
    if "__error__" in obs:
        raise TabUnreachable(str(obs["__error__"]))
    return obs


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
        self._pushed_obs: dict | None = None
        self._attrs: asyncio.Queue = asyncio.Queue()
        self._pending_attrs: set[str] = set()

    # ---------- Internal ----------

    async def _get_observation(self) -> dict:
        """Return a fresh observation for this step's page.

        A frame the server did not ask for is not a frame it may read as the
        page. `webNavigation.onCommitted` pushes one the moment a navigation
        commits — before the new page has rendered anything — and taking that
        as a step's tree handed the model the page *before* the popover it had
        just clicked opened. On session 7d567b66 that is four steps in which
        the agent clicked the same branch selector three times, was told
        `ok` each time, and never saw a single branch name: the accessibility
        tree was byte-identical at 151 targets and 3244 chars of page text
        across all four.

        So unsolicited frames are kept for what they are good for — the URL
        moved, which `_ensure_fresh_obs` and the login wait both read — and
        the step asks for a real one instead.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _OBSERVATION_TIMEOUT
        while True:
            if self._obs_queue.empty():
                log.debug("[%s] requesting observation", self._sid)
                await self._ws_send({"type": "observe"})
            else:
                log.debug("[%s] using queued observation", self._sid)
            try:
                raw = await asyncio.wait_for(
                    self._obs_queue.get(),
                    timeout=max(0.0, deadline - loop.time()),
                )
            except asyncio.TimeoutError:
                log.error("[%s] timed out waiting for observation", self._sid)
                raise
            # Unwrap before the reason check: an observation_error carries no
            # reason and must raise TabUnreachable rather than be skipped as
            # one more frame to wait behind.
            obs = _unwrap_observation(raw)
            if raw.get("reason") not in _UNSOLICITED:
                break
            log.debug("[%s] skipping unsolicited observation (%s)",
                      self._sid, raw.get("reason") or "untagged")
            self._pushed_obs = obs
        self._cached_obs = obs
        log.debug(
            "[%s] observation received  url=%s  ax=%d",
            self._sid, obs.get("url", "")[:80], len(obs.get("axTargets", [])),
        )
        return obs

    async def _send_action(self, action: dict) -> None:
        """Send action to extension; wait for the auto-sent post-action observation.

        Same rule as `_get_observation`: the frame answering *this* action is
        the one tagged `"action"`. A navigation push that lands mid-wait
        belongs to whatever the page did, not to this call.
        """
        log.debug("[%s] sending action %s", self._sid, action)
        await self._ws_send({"type": "action", "action": action})
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _OBSERVATION_TIMEOUT
        while True:
            try:
                raw = await asyncio.wait_for(
                    self._obs_queue.get(),
                    timeout=max(0.0, deadline - loop.time()),
                )
            except asyncio.TimeoutError:
                log.error("[%s] timed out waiting for post-action observation after %s", self._sid, action)
                raise
            obs = _unwrap_observation(raw)
            if raw.get("reason") in (None, "action"):
                break
            log.debug("[%s] skipping unsolicited observation (%s) while waiting "
                      "for the post-action frame", self._sid, raw.get("reason") or "untagged")
            self._pushed_obs = obs
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

    def _absorb(self, obs: dict | None, solicited: bool) -> None:
        """Take a frame the step did not ask for.

        A commit tells us the URL moved. It does not tell us the new page:
        this frame was captured before the navigation rendered, which is the
        reason the step refused it. Installing it whole reinstates that
        staleness through the other door — `_locate` resolves refs off
        `_cached_obs`, so a later `get_current_url` would quietly hand the
        step back the page it has already moved past.
        """
        if obs is None:
            return
        if solicited or self._cached_obs is None:
            self._cached_obs = obs
            return
        self._cached_obs = {**self._cached_obs,
                            "url": obs.get("url", ""),
                            "title": obs.get("title", "")}

    async def _ensure_fresh_obs(self) -> None:
        """Drain any pending observation pushed by the SW (webNavigation
        or tabs.onUpdated) into the cache. Does NOT request a new
        observation — that's _get_observation's job. Keeps get_current_url
        / get_page_title cheap while still reflecting state changes that
        arrived between agent steps.

        This is the *one* caller an unsolicited frame is good for: the URL
        moving is exactly what it reliably knows. `_get_observation` refuses
        them for a step's tree, so a skipped push lands in `_pushed_obs`
        instead of being dropped — and this reads it back out, for its URL
        alone.
        """
        if (self._cached_obs is not None and self._obs_queue.empty()
                and self._pushed_obs is None):
            return
        try:
            pushed = await asyncio.wait_for(self._obs_queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            pushed = None
        # Raw, deliberately: this path never unwrapped and does not start.
        # `_get_observation` is the one that raises TabUnreachable.
        self._absorb(pushed if pushed is not None else self._pushed_obs,
                     solicited=pushed is not None
                     and pushed.get("reason") not in _UNSOLICITED)
        self._pushed_obs = None

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
        # Select through the DOM, not a key chord. There is no cross-platform
        # keyboard shortcut for select-all — Meta on macOS, Ctrl everywhere
        # else — and this process cannot know which one the user's browser
        # wants, because it usually runs in a container on someone else's
        # machine. Sending Ctrl unconditionally meant "move to line start" on
        # a Mac, so the field kept its old text, `type_text` appended to it,
        # and the model's only remaining move was Backspace, one character per
        # step, for ten steps (session 7d567b66, field left holding
        # "Protect mainmainProteProtect mainProtect mainct ma").
        #
        # `HTMLInputElement.select()` is specified as "select the text in this
        # control" with no keyboard involved, so it is the same operation on
        # every OS. `Input.insertText` then replaces the selection, which is
        # the contract `type_text_to_ref` already relies on.
        await self._ws_send({"type": "evaluate", "expression": SELECT_ALL_JS})
        try:
            result = await asyncio.wait_for(self._eval_queue.get(), timeout=15)
        except asyncio.TimeoutError:
            log.error("[%s] timed out selecting all in %r", self._sid, ref)
            return f"Error executing: ref {ref!r} could not be cleared — no answer from the page"
        if result != "select-all":
            log.warning("[%s] select-all on %r returned %r", self._sid, ref, result)
            return (
                f"Error executing: ref {ref!r} could not be cleared — the page "
                f"said {result!r}. If it is not a text field, use click or "
                f"press_key instead."
            )
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
        # A letter is rejected bare but allowed modified. A bare letter would
        # type into the field, which is `type_text`'s job; a modified one is a
        # shortcut like select-all, and refusing those left the model unable to
        # express the one thing that fixes a field it had corrupted — it fell
        # back to End + Backspace, one character per step, for ten steps.
        # Mask before the guard, not after: only those four bits are modifiers,
        # anything above them is undefined in the extension's dispatch. Masked
        # afterwards, `press_key("a", 4096)` would satisfy the guard on the
        # truthy 4096 and then be dispatched as a bare "a" — which types into
        # the field, the one outcome the guard exists to prevent.
        modifiers &= 0xF
        # ASCII only: `str.isalnum()` is true for "é" and "क" too, and CDP
        # would happily dispatch a character the model had no reason to name.
        bare_letter = len(key) == 1 and key.isascii() and key.isalnum()
        if key not in _PRESSABLE_KEYS and not (bare_letter and modifiers):
            return (
                f"Error executing: press_key {key!r} is not a key this client can "
                f"dispatch, so nothing was pressed. Use one of "
                f"{', '.join(sorted(_PRESSABLE_KEYS))}, or a single letter with a "
                f"modifiers bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). To replace "
                f"a field's contents, just use type_text with the value you want."
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
