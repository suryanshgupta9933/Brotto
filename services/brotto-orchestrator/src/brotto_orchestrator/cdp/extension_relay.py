"""CDPRelay backed by a browser extension WebSocket instead of Playwright."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Callable, Awaitable

from ..dev.ax_tree_extractor import SemanticTarget
from ..policy.gate import screenshot_block_reason
from ..policy.schema import Policy
from .relay import SELECT_ALL_JS, PRESSABLE_KEYS, is_pressable_key

log = logging.getLogger("brotto.ext_relay")

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


_TILE_KEYS = ("x", "y", "w", "h", "pct")


def _clean_delta(raw) -> dict | None:
    """The observation's `delta`, or None. Shape-checked, not trusted.

    The frame is a browser extension's, and it reaches the model as text, so a
    tile carrying a string where a number belongs would be prompt content this
    method had no hand in. Anything not exactly the documented shape is dropped
    whole rather than partly repaired — a `changed` with no readable tiles is
    not evidence of anything.
    """
    if not isinstance(raw, dict):
        return None
    tiles = raw.get("tiles")
    if not isinstance(raw.get("changed"), bool) or not isinstance(tiles, list):
        return None
    clean: list[dict] = []
    for t in tiles:
        if not isinstance(t, dict) or not all(_is_number(t.get(k)) for k in _TILE_KEYS):
            return None
        clean.append({k: t[k] for k in _TILE_KEYS})
    return {"changed": raw["changed"], "tiles": clean}


class TabUnreachable(RuntimeError):
    """The extension could not read the tab — it lost the debugger, or there
    was no tab to read.

    Distinct from a grounding failure on purpose. A ref that does not resolve
    is the model being wrong about a page it could see; this is the page not
    being available at all, and handing the model a blank observation for it
    makes a broken instrument look like an empty website.
    """


def _is_number(value) -> bool:
    """JSON number, not bool and not a numeric string — the viewport bound is
    a security decision and `"1512" < 0` is not a comparison worth trusting."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


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
    - Server sends {type: "capture_screenshot"} → extension replies
      {type: "screenshot_result", data: "<base64 jpeg>"} or {..., error}. Resolved by
      capture_screenshot() via deliver_screenshot_result().
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
        self._obs_reusable: bool = False
        self._attrs: asyncio.Queue = asyncio.Queue()
        self._pending_attrs: set[str] = set()
        self._screenshot: asyncio.Queue = asyncio.Queue()

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

        One exception, and it is the reason most steps do not re-capture:
        `_send_action` has already blocked on a *solicited* post-action frame
        for this exact page. Recapturing the identical page cost a second
        ~10s round trip per step (a live Sheets run: 177s for 8 steps, model
        generation ~2s of each). So that frame is handed over once instead,
        under `_obs_reusable` — which is set only where a capture could not
        have been stale, and cleared by anything that learns the page moved.
        """
        if self._obs_reusable and self._pushed_obs is None and self._obs_queue.empty():
            # Nothing has been heard since the action answered. A frame in the
            # queue or a parked push means the page moved behind it, and the
            # frame is only good for its URL — the same thing this method
            # exists to refuse.
            self._obs_reusable = False
            log.debug("[%s] reusing the post-action observation  url=%s  ax=%d",
                      self._sid, (self._cached_obs or {}).get("url", "")[:80],
                      len((self._cached_obs or {}).get("axTargets", [])))
            return self._cached_obs  # type: ignore[return-value]
        self._obs_reusable = False
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
        # Reusable unless the page may have moved away from this frame: a
        # `navigate` will have a different URL by the time the next step looks,
        # and a push parked above says something already committed. Everything
        # else — a click that opened a modal, a scroll, a keystroke — is
        # answered *after* the page reacted, which is the tree the next step
        # wants and the only one it would get if it asked again.
        self._obs_reusable = action.get("type") != "navigate" and self._pushed_obs is None
        log.debug(
            "[%s] post-action observation  url=%s  ax=%d",
            self._sid, obs.get("url", "")[:80], len(obs.get("axTargets", [])),
        )

    def _locate(self, ref: str) -> tuple[dict | None, str]:
        """Resolve a ref to click coordinates. Returns (coords, reason);
        reason is "" on success.

        The two failure states are kept apart because only one is a grounding
        error. Absent from `axTargets` means the model named a ref this page
        does not have; present-but-unclickable means it named a real element this page
        will not act on. Collapsing them made a hallucination indistinguishable
        from a correct guess at something off-screen.

        Every refusal has to name what to do next, because the reason is the
        only thing the model gets. An error it cannot act on produces the same
        retry loop a silent success does, just with more steps spent on it.
        That is not hypothetical: on session a7328461 the Create button at the
        bottom of GitHub's new-branch-protection form was clicked ten times
        across four attempts, every click resolved to coordinates, every click
        was audited `ok: true`, and those coordinates were pointed past the
        bottom of the window. `scroll` was never once suggested.
        """
        if not self._cached_obs:
            return None, "cannot resolve: no observation captured yet"
        targets = self._cached_obs.get("axTargets", [])

        def at(t: dict) -> tuple[dict | None, str]:
            # Disabled first, of the three. It is a property of the element
            # itself and no amount of scrolling or dismissing changes it, so it
            # is the one answer that saves the step whatever else is true too.
            if t.get("disabled"):
                return None, (
                    "is disabled — the page will ignore a click until whatever "
                    "comes before it in the same form is filled in or checked. "
                    "Do that first; this control cannot be clicked yet."
                )
            blocked = t.get("blocked")
            if blocked == "occluded":
                return None, (
                    "is covered by another element — a click there would land on "
                    "whatever is on top of it. Close or dismiss that (a banner, "
                    "a cookie notice, an open menu), then click again."
                )
            if blocked == "off-screen":
                return None, (
                    "is off the visible page — scroll until you can see it, then "
                    "click it again"
                )
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
        # Anything absorbed here is news the post-action frame predates — a
        # commit means the URL moved, so the tree that frame carries is no
        # longer this page's.
        self._obs_reusable = False
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
        pass  # the extension has no target map to re-read; `_send_action`
        # already parked a post-action frame, and `_obs_reusable` is what
        # decides whether `get_targets()` may hand that one over again

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

    # ── coordinate actions ──────────────────────────────────────────────
    # A `<canvas>` has no AX node, so there is no ref to click and no
    # `type_text` without focus. `probe_xy` is the one live read that makes a
    # blind point safe to ask a human about: the viewport it bounds against
    # and the topmost element at that point, which is what proves nothing is
    # covering the canvas. One round trip, because a stale viewport read here
    # would make every bound below decoration.

    _PROBE_XY_JS = (
        'JSON.stringify({width: window.innerWidth, height: window.innerHeight,'
        ' tag: (document.elementFromPoint(%d, %d) || {}).tagName || ""})'
    )

    async def probe_xy(self, x: int, y: int) -> dict:
        """Live viewport and topmost tag at (x, y). {} on any failure."""
        import json as _json
        await self._ws_send(
            {"type": "evaluate", "expression": self._PROBE_XY_JS % (int(x), int(y))}
        )
        try:
            raw = await asyncio.wait_for(self._eval_queue.get(), timeout=15)
        except asyncio.TimeoutError:
            log.error("[%s] timed out probing (%d,%d)", self._sid, x, y)
            return {}
        try:
            data = _json.loads(str(raw))
        except (ValueError, TypeError):
            return {}
        if not isinstance(data, dict):
            return {}
        # `_eval_queue` is shared with `clear_ref`'s select-all and the page
        # text reader, so a concurrent evaluate can land its answer first and
        # this would read somebody else's. The viewport is a security decision
        # — the bound check in `_coordinate_action` is the only thing standing
        # between a model-chosen point and the page — so the answer must be
        # exactly this probe's payload: those three keys, nothing else, and
        # the two dimensions numeric. Anything else is refused, which makes
        # the caller refuse too, which is the correct failure for a bound it
        # cannot trust.
        if set(data) != {"width", "height", "tag"}:
            log.warning("[%s] probe (%d,%d) got a foreign payload %r",
                        self._sid, x, y, sorted(data))
            return {}
        if not (_is_number(data["width"]) and _is_number(data["height"])):
            return {}
        return data

    async def click_xy(self, x: int, y: int) -> str:
        # `click_xy`, not `click`. `click` (above) carries coordinates that
        # came out of BOX_WALK and were verified twice; these are a point the
        # model proposed and nothing vouched for. The extension branches on
        # the type to take its bounded/untrusted path, so sending `click` here
        # both launders an unverified point as verified and makes that branch
        # dead code.
        log.info("[%s] click_xy (%d,%d)", self._sid, x, y)
        await self._send_action({"type": "click_xy", "x": int(x), "y": int(y)})
        return f"Clicked at ({x},{y})"

    async def focus_xy(self, x: int, y: int) -> str:
        # `click_xy` on the wire, and it was always `click`: this is a full
        # press/release at a point the model proposed. The verb implies a
        # caret, the browser delivers a click — `background.ts` dispatches
        # `Input.dispatchMouseEvent` either way — so it takes the untrusted
        # branch, exactly like `click_xy` does.
        log.debug("[%s] focus_xy (%d,%d)", self._sid, x, y)
        await self._ws_send(
            {"type": "action", "action": {"type": "click_xy", "x": int(x),
                                          "y": int(y)}}
        )
        return f"Focused ({x},{y})"

    async def type_text_at_focus(self, text: str) -> str:
        """Insert into whatever holds focus. No ref, so no locate guard — the
        harness focused a point it had just probed and bounds-checked, and the
        extension dispatches this as `Input.insertText`, the call a canvas
        editor already expects."""
        log.info("[%s] type_text_at_focus len=%d", self._sid, len(text))
        await self._send_action({"type": "type", "text": text})
        return f"Typed {len(text)} characters"

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
        if not is_pressable_key(key, modifiers):
            # Not echoed: this string is the tool's return value, which the
            # harness writes to the audit document and hands the model in the
            # next step's history. Naming it would write whatever was refused
            # straight into both.
            return (
                "Error executing: that is not a key this client can dispatch, "
                f"so nothing was pressed. Use one of "
                f"{', '.join(sorted(PRESSABLE_KEYS))}, or a single letter with a "
                f"modifiers bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). To replace "
                f"a field's contents, just use type_text with the value you want."
            )
        log.info("[%s] press_key %r modifiers=%d", self._sid, key, modifiers)
        await self._send_action({"type": "key", "key": key, "modifiers": modifiers})
        return "ok"

    async def capture_screenshot(self) -> str | None:
        """A JPEG of the attached tab, base64, or None.

        The capture primitive for the vision fallback: the accessibility tree
        is blind on `<canvas>`, where there is no node and no page text.

        Transit only. The payload is page content, so it is returned to the
        caller and never logged, stored on the relay, or written to an audit
        document — `agent/audit.py` and its redaction are brotto-privacy's,
        not this file's. The 30s ceiling below is `_OBSERVATION_TIMEOUT`
        because the same JSON channel carries both, and a viewport JPEG at
        q60 is 270–700 KB of base64 against a few KB of tree.
        """
        await self._ws_send({"type": "capture_screenshot"})
        try:
            async with asyncio.timeout(_OBSERVATION_TIMEOUT):
                msg = await self._screenshot.get()
        except TimeoutError:
            log.warning("[%s] timed out waiting for screenshot_result", self._sid)
            return None
        error = str(msg.get("error", ""))
        if error:
            log.warning("[%s] screenshot capture failed: %s", self._sid, error)
            return None
        data = msg.get("data")
        return data if isinstance(data, str) and data else None

    async def get_page_delta(self, policy: Policy | None = None) -> dict | None:
        """`{"changed": bool, "tiles": [{x, y, w, h, pct}, …]}`, or None.

        The step's own evidence that the page moved. The accessibility tree is
        byte-identical across many consecutive steps on a canvas app, so the
        model otherwise has no way to tell an action that landed from one that
        did not. Read out of the cached observation — no round trip; it arrived
        with the frame `get_targets()` already took.

        **None is the common answer**, not the failure one: the extension omits
        `delta` on a tab's first observation, after a navigation, after a
        viewport resize and on a failed capture, and those are four of the most
        frequent moments in an ordinary run.

        **The gate is `screenshot_block_reason` and it is not weakened here.**
        A delta is derived from a viewport capture — the extension decodes the
        screenshot locally and diffs it — so it is page-derived data from the
        same pixels the screenshot channel is refused over, and it arrives
        through a different route. Letting it past while a capture of the same
        page is refused would be exactly the bypass the gate exists to prevent,
        so this asks the same question with the same answer, including the
        `BROTTO_VISION_CAPTURE` switch: with capture off there is no delta
        either. The extension does not know the policy and computes
        unconditionally; the server is the authority, deliberately.

        **D2: a tile is evidence, never a target.** Nothing here converts a
        tile into a point, and nothing may — `_coordinate_action` takes
        coordinates the model chose and that were probed and bounds-checked; a
        tile is a region that *changed*, not a claim about what is there now,
        since the page repaints after the diff. Re-pointing a coordinate action
        at a tile is the tempting optimisation and it breaks D2.
        """
        obs = self._cached_obs or {}
        url = obs.get("url")
        if screenshot_block_reason(url, policy):
            log.info("[%s] page delta withheld by the capture gate  url=%s",
                     self._sid, (url or "")[:80])
            return None
        delta = _clean_delta(obs.get("delta"))
        if delta is not None:
            log.debug("[%s] page delta  changed=%s tiles=%d",
                      self._sid, delta["changed"], len(delta["tiles"]))
        return delta

    async def deliver_screenshot_result(self, message: dict) -> None:
        """Sink for an inbound screenshot_result. Keep only the newest: an
        image is worth nothing twice, and an unbounded queue of 700 KB frames
        is a memory ceiling waiting for a misbehaving extension."""
        while not self._screenshot.empty():
            self._screenshot.get_nowait()
        self._screenshot.put_nowait(message)

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
            # Both absent on an extension that predates them, hence the
            # `get`-with-default rather than a subscript.
            disabled=bool(t.get("disabled", False)),
            blocked=t.get("blocked"),
        ))
    return result
