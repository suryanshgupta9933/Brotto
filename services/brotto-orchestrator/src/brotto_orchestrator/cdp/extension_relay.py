"""CDPRelay backed by a browser extension WebSocket instead of Playwright."""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from contextlib import contextmanager
from typing import Callable, Awaitable, Iterator

from ..dev.ax_tree_extractor import SemanticTarget
from ..policy.gate import screenshot_block_reason
from ..policy.schema import Policy
from .relay import (
    FOCUS_ID_JS,
    PRESSABLE_KEYS,
    is_pressable_key,
    parse_focus_id,
)

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

# The extension's refusal reasons are a closed set it already writes
# (`observation/pointer.ts`), and this is a *shape* check rather than an
# enumeration so a reason added there does not need a deploy here. What it does
# need is a ceiling: this string is handed to the model in the next step's
# history and written to the audit document, so anything longer or freeform from
# a browser extension is prompt content nobody wrote. `different-element:<tag>`
# is the only one with a variable tail, hence the second group.
_ACTION_REASON_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}(:[a-z0-9-]{1,24})?$")


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
    - The extension sends {type: "action_result", ok, reason} before that observation
      when the dispatch-time hit test refused the action. Optional for one minor:
      its absence is "dispatched", which is what an older extension means.
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
        self._action_result: dict | None = None

    # ---------- Actions ----------

    async def deliver_action_result(self, message: dict) -> None:
        """The extension's answer to the action it was last handed.

        `brotto-extension` verifies at the instant of the press that the
        viewport point still holds the element the ref resolved to, and refuses
        when it does not. Until this frame existed the server learned that only
        by noticing the page had not changed, and `click_ref` returned
        `Clicked [7]` regardless — so a refused click was audited `ok: true` and
        the model was told it had acted on a world state that never existed.

        **A plain slot, not a queue, and no id.** One action is in flight at a
        time and the frame is written before the post-action observation on the
        same ordered WebSocket, so by the time `_send_action` wakes the answer
        is already here. A frame with no readable `ok` is dropped rather than
        guessed at: `ok` absent is an extension we do not understand, and an
        action refused on a misread frame is worse than one reported as sent.
        """
        if not isinstance(message, dict) or not isinstance(message.get("ok"), bool):
            return
        if message["ok"]:
            # `ok: true` with a reason is still `ok: true` — `canvas-editor-exempt`
            # is a success *granted by an exemption* (a canvas cell whose editor
            # lies inside it), and the extension logs it for exactly that reason.
            # Reading it as a refusal would refuse the shape `type_at` exists for;
            # dropping it silently loses the only server-side trace that the
            # identity binding was waived. Neither happens: it is logged, and the
            # verdict stays a success.
            note = str(message.get("reason") or "")
            if note and _ACTION_REASON_RE.match(note):
                log.info("[%s] action succeeded by exemption (%s)", self._sid, note)
            self._action_result = None
            return
        reason = str(message.get("reason") or "")
        if not _ACTION_REASON_RE.match(reason):
            log.warning("[%s] action_result with unusable reason %r — reporting "
                        "the refusal without it", self._sid, reason[:80])
            reason = "refused"
        self._action_result = {"ok": False, "reason": reason}

    def _take_action_result(self) -> dict | None:
        """Read and clear. Once — a refusal that outlived its action would fail
        the next one, which was never gated."""
        result, self._action_result = self._action_result, None
        return result

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

    async def _send_action(self, action: dict) -> dict | None:
        """Send action to extension; wait for the auto-sent post-action observation.

        Same rule as `_get_observation`: the frame answering *this* action is
        the one tagged `"action"`. A navigation push that lands mid-wait
        belongs to whatever the page did, not to this call.

        Returns the extension's own verdict — `None` when it sent no
        `action_result`, which is an extension older than the frame and is
        exactly today's behaviour. See `deliver_action_result`.
        """
        # Cleared first, so a frame belonging to an action whose waiter died
        # mid-wait cannot be read as this one's answer.
        self._action_result = None
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
        return self._take_action_result()

    @staticmethod
    def _refusal(what: str, result: dict | None) -> str | None:
        """What the model is told when the extension refused the dispatch.

        The harness derives `ok` from the `Error executing` prefix, so this is
        where the audit stops saying the click happened. It has to say what to
        do next for the same reason every `_locate` refusal does: the reason is
        the only thing the model gets, and a refusal it cannot act on produces
        the retry loop a silent success produces, with more steps spent on it.
        """
        if result is None:
            return None
        return (
            f"Error executing: {what} was not dispatched — the browser refused "
            f"it at the moment of the press ({result['reason']}), which means "
            f"the page is not what the observation showed. Re-read the page and "
            f"act on what is there now; clicking the same coordinates again "
            f"will be refused the same way."
        )

    def _locate(self, ref: str, *, need_backend_id: bool = False) -> tuple[dict | None, str]:
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

        **`need_backend_id` closes the case at the source.** Every ref that can
        produce an x/y can still produce it with no `backendNodeId`, and the
        extension's `bindFocus` then has nothing to bind a destructive clear to
        and refuses with `focus-unidentified` — the same case, refused a round
        trip later and only after a press was dispatched. Refusing here costs no
        press and no clear. The extension refusing it independently is the point:
        two walls, no dependency between them.
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
            if need_backend_id and t.get("backendNodeId") is None:
                return None, (
                    "has a position but no element identity behind it — the last "
                    "observation did not record which node this was, so the press "
                    "and the clear after it cannot be checked against the page. "
                    "Re-read the page, then type into a ref the fresh tree names."
                )
            if "x" in t and "y" in t:
                # `backendNodeId` rides the action so the extension can ask, at
                # the instant of the press, whether this point still holds the
                # element the model was shown. Without it the extension has only
                # the coordinate, and a coordinate from a previous layout is
                # indistinguishable from a good one — `Input.dispatchMouseEvent`
                # returns `{}` for a click on `<body>`. Every clickable target
                # carries an id (AX targets from `targetsForFrame`, supplemented
                # ones from `supplement.ts`), and every ref-taking method below
                # spreads these coords, so `type_text_into_ref` is covered by
                # the same check.
                return {"x": t["x"], "y": t["y"],
                        "backendNodeId": t.get("backendNodeId")}, ""
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

    async def get_canvas_covered(self) -> float | None:
        """Viewport fraction covered by the largest topmost `<canvas>`.

        `None` when the frame carries no such value — an extension build from
        before the field shipped, or a frame that never sent it. The harness
        reads `None` as *unknown*, never as "not a canvas", so this is the old
        behaviour exactly rather than a silent downgrade to 0.0.
        """
        await self._ensure_fresh_obs()
        raw = (self._cached_obs or {}).get("canvasCovered")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None
        return min(1.0, max(0.0, float(raw)))

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
        refused = self._refusal(f"clicking ref {ref!r}",
                                 await self._send_action({"type": "click", **coords}))
        return refused or f"Clicked [{ref}]"

    async def focus_id(self) -> str | None:
        """A stable name for the focused element, or None if unreadable.

        One `evaluate` round trip, on the same channel `read_page_text` uses — no
        new request type and no extension change. None is the honest answer
        and the `press_key` guard treats it as unknown; see `FOCUS_ID_JS`.

        **Isolated world, and why it is not optional here.** `FOCUS_ID_JS` reads
        `document.activeElement` and `getElementsByTagName`, and in the main
        world the page owns the globals that resolve them — so a hostile page
        can report a focus that is not there, which is this check silencing
        itself. `bindFocus` still refuses independently, so that was a
        hardening rather than a wall; `isolatedWorld` closes it for one field.
        The DOM is shared, so the element is the same object either way.

        **A world that cannot be created must refuse, and it does.** The
        extension answers `{value: "", error: …}` when `Page.createIsolatedWorld`
        fails rather than falling back to the main world, and `main.py` puts
        only `value` on `_eval_queue`, so this receives `""`. `""` is not in
        `FOCUS_ID_RE`, so `parse_focus_id` returns `None`, and every caller
        reads `None` as *unknown* and refuses. That is the safe direction and it
        is now pinned by `test_focus_id_isolated_world.test`.

        `""` is deliberately *not* the same thing as the answers `"none"` and
        `"body"`, and the distinction is a refusal either way: those two are the
        page saying nothing holds focus, `""` is this not being able to ask. A
        page that breaks world creation is not a page with an empty field, and
        the refusal string is identical because the model has nothing to act on
        either way — but the *cause* is logged differently, so a run that keeps
        refusing is diagnosable rather than mysterious.

        `_eval_queue` is shared with `read_page_text` and is
        **not** request-correlated, so a reply from either of those can land
        here. What `parse_focus_id` guarantees is exactly this: a reply from
        another producer that is not itself well-shaped — a JSON blob, prose,
        an id with a newline or an escape in it — reads as unknown and every
        caller refuses. **A shape check is not correlation**: a foreign reply
        that happens to be a well-formed `TAG#id` (a cached attribute read,
        say) is indistinguishable from a real focus answer. Closing that needs
        a per-request ref on the `evaluate` frame, filtered in `main.py` the
        way `deliver_attributes_result` already is — a two-sided frame change,
        not built here. The harness runs one action at a time, which makes the
        window rare — not impossible, and never safe to rely on.
        """
        await self._ws_send({"type": "evaluate", "expression": FOCUS_ID_JS,
                             "isolatedWorld": True})
        try:
            value = await asyncio.wait_for(self._eval_queue.get(), timeout=15)
        except asyncio.TimeoutError:
            log.warning("[%s] timed out reading the focused element", self._sid)
            return None
        if str(value or "") == "":
            # Not "nothing is focused" — `"none"` and `"body"` say that. This
            # is the extension failing to answer: no tab, or (isolated world)
            # a world it could not create. Logged apart from an answer so a
            # run stuck on this refusal can be told apart from a run stuck on
            # a page that genuinely holds no focus.
            log.warning("[%s] focus read returned nothing — the extension "
                        "could not evaluate, so focus is unknown", self._sid)
        return parse_focus_id(value)

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
        # Isolated world, and unlike `read_page_text` below this one is a
        # decision rather than a readout. `window.innerWidth`/`innerHeight` are
        # page-writable globals in the main world, so a page that inflates them
        # makes every coordinate pass the bound check in `_coordinate_action` —
        # the only thing between a model-chosen point and a press — and
        # `document.elementFromPoint`'s `tag` is what refuses a covered canvas.
        # The DOM is shared, so `elementFromPoint` answers on the same
        # elements; only the globals it resolves through are the extension's.
        await self._ws_send(
            {"type": "evaluate", "expression": self._PROBE_XY_JS % (int(x), int(y)),
             "isolatedWorld": True}
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
        # `_eval_queue` is shared with the page text reader, so a concurrent
        # evaluate can land its answer first and
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
        refused = self._refusal(f"clicking ({x},{y})",
                                 await self._send_action({"type": "click_xy", "x": int(x), "y": int(y)}))
        return refused or f"Clicked at ({x},{y})"

    async def focus_xy(self, x: int, y: int) -> str:
        # `click_xy` on the wire, and it was always `click`: this is a full
        # press/release at a point the model proposed. The verb implies a
        # caret, the browser delivers a click — `background.ts` dispatches
        # `Input.dispatchMouseEvent` either way — so it takes the untrusted
        # branch, exactly like `click_xy` does.
        log.debug("[%s] focus_xy (%d,%d)", self._sid, x, y)
        refused = self._refusal(
            f"focusing ({x},{y})",
            await self._send_action({"type": "click_xy", "x": int(x), "y": int(y)}),
        )
        return refused or f"Focused ({x},{y})"

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
        # A ref that exists is not a place text lands: the dispatch below
        # carries no coordinates, so the text goes to `document.activeElement`
        # and these coords are only an existence check. On a freshly
        # navigated page nothing holds focus — `activeElement` is `body`, which
        # discards `Input.insertText` — and the run still reports success.
        # Session 445fc36d typed "Name"/"Age" into a new Google Sheet whose
        # body had focus, read "Typed into [0:10050]", and completed on an
        # empty sheet. Same condition the `press_key` guard already refuses
        # on, one action over, and this reuses that read rather than adding a
        # second focus primitive.
        focus = await self.focus_id()
        if focus is None or focus in ("body", "none"):
            log.warning("[%s] type_text_to_ref %r — focus is %r", self._sid, ref, focus)
            return (
                f"Error executing: ref {ref!r} resolved, but nothing on the "
                f"page holds focus, so nothing was typed. Click the element "
                f"you meant to type into first, then type again."
            )
        # `focus` ends here. Its id half is `document.activeElement.id` — text
        # the page chose — and both a log line and the returned outcome cross a
        # boundary this module does not own: a log sink is a parser input, and
        # the outcome goes to the audit document, which is ours. Whether the
        # id is named or not is the caller's own knowledge; what this can
        # honestly report is that focus was held, which is what it checked.
        log.info(
            "[%s] type_text_to_ref %r  len=%d focus=%s", self._sid, ref, len(text),
            "named",
        )
        await self._send_action({"type": "type", "text": text})
        # Says what was done, not what was meant: the ref resolved against a
        # different tree than the one that now has focus, so naming the ref
        # here asserts a destination this method never checked. And the
        # focused element is not named either — see above; the outcome is the
        # model's history and the audit document, and a page-chosen string in
        # either is page content in a file we own.
        return f"Typed {len(text)} characters into the focused element"

    @contextmanager
    def _phase(self, name: str) -> Iterator[None]:
        """Log how long one phase of a multi-trip action took.

        Not decoration. `type_text` measured 19.9s against a ~3.6s per-action
        floor, and no `type_text` in any recorded run exceeds 5.2s, so the gap
        has never been attributed to anything on disk. Per-phase timing is how
        the next run says *which* trip the seconds are in — and whether
        collapsing the trips actually landed.

        Two phases now. `clear_verify` is gone because there is no server-side
        clear to verify: it happens inside the `type_at` action, so it is
        inside `type_at`'s duration rather than reported as its own zero.

        `finally`, so a phase that raised still reports: a refusal that costs
        twenty seconds is the one worth seeing.
        """
        started = time.monotonic()
        try:
            yield
        finally:
            log.info("[%s] type_text phase=%s duration_ms=%d", self._sid, name,
                     int((time.monotonic() - started) * 1000))

    async def type_text_into_ref(self, ref: str, text: str, clear: bool = True) -> str:
        """One `type_at` action: the press, the clear and the text, one frame.

        `type_text` was three relay calls — `focus_ref`, `clear_ref`,
        `type_text_to_ref` — and **each of the first two dispatched
        `{"type": "click", …}` with the same coordinates and the same
        `backendNodeId`**, resolved by the same `_locate` against the same
        cached observation. The second click was byte-identical to the first; it
        was there because each method had to be independently complete, not
        because the page needed it. Every trip also blocks on
        `_OBSERVATION_TIMEOUT` for a post-action frame the extension sends
        unprompted, so three calls meant three of the extension's full
        observation cycles — a quiet window, an accessibility-tree walk and a
        screenshot — for what is one keystroke.

        **The clear used to be a key chord and now is a DOM operation.** It was
        `Control+a` sent as a `key` frame with a `modifiers` bitmask, which put
        an OS question on the wire — that chord is "move to line start" on
        macOS — and a server-side `SELECT_ALL_JS` was the other option, but it
        would act on the `activeElement` of *before* the press, which may be a
        different field than the one the model named. The extension resolves it
        in the right place instead: `type_at` presses at the coordinates
        (running `verifyTarget`'s `DOM.resolveNode` binding, unchanged) and then
        calls `select()` on the element that press focused. So this frame sends
        `clear` and no `modifiers`, and a clear that fails refuses rather than
        typing.

        **The focus check is kept, and it runs before the frame.** The
        extension's own `bindFocus` answers *identity* — the engine-named
        focused node is the pressed node — and that question did not exist
        before. This answers a different one: **intent**, and *shape*.
        `bindFocus` runs after the press, and the press is what creates focus, so
        a press that landed on the wrong focusable node satisfies it perfectly;
        only a read taken *before* the dispatch can say whether the page was in a
        state where the model could have meant this field at all. That is what
        `None`/`none`/`body` refuse — session 445fc36d typed into a sheet whose
        `activeElement` was `body` and reported success, and a press on a blank
        sheet body would then satisfy `bindFocus` and clear whatever a previous
        step left focused. The contract is unchanged for the model: click the
        field first, then `type_text` into it.

        **What it costs, stated plainly.** `focus_id` now asks for the
        isolated world (see `focus_id`), so the page no longer owns the globals
        its getter resolves through — that exposure is closed. It was never the
        wall, though: `bindFocus` is, because it names the node from the engine.
        Both stay, and they fail independently, which is why both are here.
        A world that cannot be created is an *error* answer, not a focus
        state, and it refuses exactly like an unreadable one — see `focus_id`.
        `_eval_queue` is shared and uncorrelated (see `parse_focus_id`), so this
        parses for shape and nothing more and an unreadable answer refuses, as it
        always did.

        Every outcome is the relay's own verdict. Nothing here synthesises a
        destination: the ref is not named in the success string and neither is
        the focused element, for the reasons `type_text_to_ref` already gives.
        """
        coords, why = self._locate(ref, need_backend_id=True)
        if not coords:
            log.warning("[%s] type_text_into_ref %r — %s", self._sid, ref, why)
            return f"Error executing: ref {ref!r} {why}"

        with self._phase("focus"):
            focus = await self.focus_id()
        if focus is None or focus in ("body", "none"):
            log.warning("[%s] type_text_into_ref %r — focus is %r", self._sid, ref,
                        "unknown" if focus is None else "nothing")
            return (
                f"Error executing: ref {ref!r} resolved, but nothing on the "
                f"page holds focus, so nothing was typed. Click the element "
                f"you meant to type into first, then type again."
            )

        # `focus` ends here. Its id half is `document.activeElement.id` — text
        # the page chose — and it reaches neither a log line nor the returned
        # outcome: a log sink is a parser input, and the outcome is both the
        # model's history and the audit document, which are ours.
        log.info("[%s] type_text_into_ref %r  len=%d focus=%s", self._sid, ref,
                 len(text), "named")
        with self._phase("type_at"):
            refused = self._refusal(
                f"typing into ref {ref!r}",
                await self._send_action(
                    {"type": "type_at", **coords, "text": text, "clear": bool(clear)}
                ),
            )
        if refused:
            return refused
        # Says what was done, not what was meant: the ref resolved against a
        # different tree than the one that now has focus, so naming it here
        # asserts a destination this method never checked. The focused element
        # goes unnamed for the same reason `type_text_to_ref` leaves it so —
        # its id is text the page chose.
        return f"Typed {len(text)} characters into the focused element"

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

    async def capture_screenshot(self, css_resolution: bool = False) -> str | None:
        """A JPEG of the attached tab, base64, or None.

        The capture primitive for the vision fallback: the accessibility tree
        is blind on `<canvas>`, where there is no node and no page text.

        `css_resolution` asks the extension for a CSS-pixel image rather than
        the device-pixel one it takes by default. An optional key on a frame
        that already exists, not a new frame type, and off by default so both
        a caller that does not care and an extension that predates the key
        keep today's behaviour.

        Transit only. The payload is page content, so it is returned to the
        caller and never logged, stored on the relay, or written to an audit
        document — `agent/audit.py` and its redaction are brotto-privacy's,
        not this file's. The 30s ceiling below is `_OBSERVATION_TIMEOUT`
        because the same JSON channel carries both, and a viewport JPEG at
        q60 is 270–700 KB of base64 against a few KB of tree.
        """
        frame: dict = {"type": "capture_screenshot"}
        if css_resolution:
            frame["css_resolution"] = True
        await self._ws_send(frame)
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

    async def get_page_delta(self, policy: Policy | None = None,
                             redactions=None, run_secrets=None) -> dict | None:
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
        A delta is computed from a viewport capture — the extension decodes the
        screenshot locally and diffs it — so it is page-derived data from the
        same pixels the screenshot channel is refused over, and it arrives
        through a different route. So this asks the same question with the same
        answer, including the `BROTTO_VISION_CAPTURE` switch: with capture off
        there is no delta either. The extension does not know the policy and
        computes unconditionally; the server is the authority, deliberately.

        **A typed secret does not withhold the delta, because a delta is not a
        picture.** `redactions` and `run_secrets` are the harness's knowledge
        that this page holds something credential-shaped; a *picture* of it
        cannot be redacted, so `_capture_page` refuses — and that refusal
        stands. But what this method returns is not a picture: the whole wire
        shape is `{"changed": bool, "tiles": [{x, y, w, h, pct}]}` — geometry
        and a mean-luminance-difference percentage. A tile's rectangle says
        *where* on the page something changed; `pct` is a scalar. Neither can
        carry the typed value, and nothing that reaches the model through this
        method is derived from the value itself.

        **The shape check is the guarantee, and it is the argument the old
        veto was reaching for.** `_clean_delta` drops anything that is not
        exactly that shape — whole, not partly repaired — so a future change
        that put a string or a pixel in a tile would be refused at the door
        rather than quietly widening what the delta carries. The old docstring
        wanted the veto to hold "while the returned value happens to stay just
        tile rectangles and a boolean"; the shape check is what makes that
        true without a second gate. So the gate that is about *pixels* — the
        screenshot — is the one that must hold, and the delta is not a picture
        of anything.

        **Why the veto was a real cost, not a nicety.** Withholding the delta
        makes `deps.canvas_changed` `None`, and `None` is the honest unknown
        that the stagnation detector cannot fire on: the detector was
        structurally unable to stop a canvas run, on the one channel that
        could have told it the page had not moved. `redactions` and
        `run_secrets` are accepted here so the harness can call one method
        without branching on the relay; they are deliberately **not**
        consulted.

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
        # Main world on purpose, unlike `focus_id` and `probe_xy` above. This
        # read has no decision in it: what comes back *is* page content, and
        # page content is page-controlled whatever world evaluates it, so an
        # isolated world would protect the page's text from the page and buy
        # nothing. It reads `document.body.innerText` — a DOM property, shared
        # across worlds and unshadowable either way — and its only caller is the
        # prompt. Not a blanket rule; this caller has a reason to be the one
        # that does not take the flag.
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
