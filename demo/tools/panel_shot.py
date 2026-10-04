"""Render the real side panel in Chromium and capture it as PNGs for the demo
videos.

This is asset generation, not a test of Brotto. It loads the shipped
`sidepanel.html` — the same `sidepanel.js` the extension runs — behind a
`chrome` shim, then drives it through genuine protocol frames delivered to the
genuine `chrome.runtime.onMessage` listener. Nothing here re-implements the
panel: if a card looks wrong in the video, it is wrong in the product, because
there is no second copy to disagree.

    .venv/bin/python demo/tools/panel_shot.py

Writes two things:

* `demo/public/shots/<name>.png` — one still per beat, at 2x.
* `demo/public/seq/*.png` — the run itself, captured state by state, plus a
  generated `demo/src/seq.ts` naming them in order and how long each holds.

The sequence is the difference between a screenshot and a demo. One still of the
panel is a picture of a thing that does nothing; the same panel captured as a
sequence has its steps arriving, its counter counting and its approval card
sliding up — which is the whole product in a dozen frames.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
PANEL = REPO / "clients/brotto-extension/src/sidepanel.html"
DEMO = Path(__file__).resolve().parents[1]
OUT = DEMO / "public/shots"
SEQ = DEMO / "public/seq"
SEQ_TS = DEMO / "src/seq.ts"

# Seeded before the panel's first read so hydration finds what a returning user
# would have: a saved server, a model, and a history that is not empty.
SEED: dict = {
    "settings": {
        "serverUrl": "http://127.0.0.1:8000",
        "agentSecret": "",
        "notifications": True,
        "secureMode": True,
        "notifyResults": True,
        "notifyBlocking": True,
    },
    "modelConfig": {"provider": "anthropic", "model": "claude-sonnet-5-5", "baseUrl": ""},
    "deviceId": "1b1f0c2a-6d3e-4a51-9f0b-7c2d5e8a4b13",
    "sessions": [
        {"task": "Find the cheapest direct flight to Lisbon in November", "status": "completed", "steps": 14, "elapsed": "6m 12s", "startedAt": 1767225600000, "session_id": "a1b2c3d4-0001", "task_count": 1},
        {"task": "Summarise the unread thread from Priya", "status": "completed", "steps": 6, "elapsed": "1m 48s", "startedAt": 1767140000000, "session_id": "a1b2c3d4-0002", "task_count": 2},
        {"task": "Book the cheapest flight it found", "status": "failed", "steps": 3, "elapsed": "0m 51s", "startedAt": 1767050000000, "session_id": "a1b2c3d4-0003", "task_count": 1},
        {"task": "What did the last reply say about the invoice?", "status": "completed", "steps": 2, "elapsed": "0m 31s", "startedAt": 1766960000000, "session_id": "a1b2c3d4-0004", "task_count": 1},
    ],
}

SHIM = """
(seed) => {
  const store = { ...seed };
  const listeners = [];

  const area = (bag) => ({
    get: async (k) => {
      if (k == null) return { ...bag };
      if (typeof k === 'string') return k in bag ? { [k]: bag[k] } : {};
      const keys = Array.isArray(k) ? k : Object.keys(k);
      const out = {};
      for (const key of keys) if (key in bag) out[key] = bag[key];
      return out;
    },
    set: async (o) => Object.assign(bag, o),
    remove: async (k) => { for (const key of (Array.isArray(k) ? k : [k])) delete bag[key]; },
    clear: async () => { for (const key of Object.keys(bag)) delete bag[key]; },
  });

  const noop = () => {};
  const api = {
    scripting: { executeScript: async () => [] },
    notifications: { create: noop },
  };

  window.chrome = {
    runtime: {
      id: 'panel-shot',
      lastError: undefined,
      getURL: (p) => p,
      getManifest: () => ({ version: '0.0.0' }),
      sendMessage: (msg, cb) => cb && cb(undefined),
      connect: () => ({
        name: 'brotto-sidepanel',
        postMessage: noop,
        disconnect: noop,
        onMessage: { addListener: noop, removeListener: noop },
        onDisconnect: { addListener: noop, removeListener: noop },
      }),
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener: noop },
      onConnect: { addListener: noop },
      ...api,
    },
    storage: { local: area(store), session: area({}), onChanged: { addListener: noop } },
    sidePanel: { setOptions: async () => {}, open: async () => {} },
    debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/', title: 'Example' }], create: async () => ({}), sendMessage: noop },
    ...api,
  };

  // The panel's own listener is what a real relay frame reaches. Dispatching
  // through it means the shot exercises `handleEvent`, not a copy of it.
  window.__emit = (frame) => { for (const fn of listeners) fn(frame, { id: 'panel-shot' }, () => {}); };
  window.__listeners = () => listeners.length;
}
"""


def emit(page, frame: dict) -> None:
    page.evaluate("(f) => window.__emit(f)", frame)


def scroll_top(page) -> None:
    """Pin the message list to the top.

    The panel follows the run — every append sets `scrollTop = scrollHeight` — so
    by step 14 the status bar (steps / active / context) has scrolled out of the
    viewport entirely. That is correct behaviour and wrong for a video: those
    three numbers are the part that visibly counts. Scrolling back before each
    capture keeps them on screen for the whole run.

    The approval frame does scroll to the card instead, because that is the one
    state whose *content* matters more than its chrome.
    """
    page.evaluate("() => { const m = document.getElementById('messages'); if (m) m.scrollTop = 0; }")


VIEW_W, VIEW_H = 420, 540
# The page is captured at 2x, so the PNGs carry twice the pixels the panel
# occupies on screen. Spots are recorded in that pixel space rather than in CSS
# px because the composition draws the panel 1:1 — an 840x1080 panel image in an
# 840x1080 slot stays razor sharp, and the panel's own 11px body text lands at
# 11px on the 1920px frame instead of the 5px it shrank to when the panel was
# displayed at its 420px CSS width. The two spaces agreeing is the whole point;
# mixing them puts every callout at half the offset it should be.
#
# The window is 540 CSS px of a panel that is ~1080 tall, not the whole thing.
# A 420x1080 strip is one ninth of a 16:9 frame; showing it large enough to
# read means showing *part* of it, and the part worth showing is the top: the
# status bar that counts the run, the card that is making the claim, and the
# composer underneath it. Anything lower is reached by scrolling the panel
# before the capture, which is what `reveal` does.
DPR = 2


def spot(page, into: dict, name: str, selector: str) -> None:
    """Record where a callout should point, in the PNG's own pixel space.

    Measured rather than eyeballed. A hand-placed rectangle drifts the moment
    the panel's padding changes, and it drifts *silently* — the box still draws,
    it just frames the wrong thing. This is the last element matching the
    selector, because cards are appended and the video wants the newest one.
    """
    rect = page.evaluate(
        """(sel) => {
            const els = document.querySelectorAll(sel);
            const el = els[els.length - 1];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height };
        }""",
        selector,
    )
    if rect is None:
        return
    top = max(0.0, rect["y"])
    bottom = min(float(VIEW_H), rect["y"] + rect["h"])
    if bottom - top < 8:
        return  # scrolled out of the viewport; there is nothing to point at
    into[name] = {
        "x": round(max(0.0, rect["x"]) * DPR, 1),
        "y": round(top * DPR, 1),
        "w": round(rect["w"] * DPR, 1),
        "h": round((bottom - top) * DPR, 1),
    }


# The roles the agent actually keeps. Mirrors `KEEP_ROLES` in
# `agent/ax_filter.py` — the same list, because the video is claiming to show
# what the model is shown, and a capture with a different filter would be
# showing something else.
KEEP_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox", "checkbox",
    "radio", "menuitem", "tab", "listitem", "heading", "dialog", "alert",
    "form", "main", "nav", "option", "switch", "slider", "spinbutton",
    "gridcell", "row", "rowgroup", "table", "list",
}
STRIP_ROLES = {"generic", "none", "presentation", "separator"}


def ax_tree(page, limit: int = 60) -> list[dict]:
    """The accessibility tree of the panel, as the model would be shown it.

    Read over CDP with the same call the extension makes (`getFullAXTree`),
    because a different reader would give a different tree and the whole point
    of the cut is that this is the real one. Lines are formatted exactly as
    `agent/ax_filter.py` formats them — `[ref] role "name"`, two spaces per
    level — so a viewer who has read the source recognises it.

    Each line also carries the box of the element it names, in the same 2x
    pixel space as `SPOTS`. A ref the model addresses and a rect the video
    highlights have to be the same node, and resolving that here is cheaper than
    trusting a selector to keep pointing at the right one.
    """
    cdp = page.context.new_cdp_session(page)
    cdp.send("Accessibility.enable")
    nodes = cdp.send("Accessibility.getFullAXTree").get("nodes", [])
    by_id = {n["nodeId"]: n for n in nodes}
    found: list[dict] = []

    def box(node: dict) -> dict | None:
        backend = node.get("backendDOMNodeId")
        if backend is None:
            return None
        try:
            quad = cdp.send("DOM.getBoxModel", {"backendNodeId": backend})["model"]["content"]
        except Exception:
            return None
        xs, ys = quad[0::2], quad[1::2]
        x, y, w, h = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
        if w < 4 or h < 4:
            return None
        top = max(0.0, y)
        bottom = min(float(VIEW_H), y + h)
        if bottom - top < 8:
            return None  # scrolled out of the frame; nothing to point at
        return {
            "x": round(x * DPR, 1), "y": round(top * DPR, 1),
            "w": round(w * DPR, 1), "h": round((bottom - top) * DPR, 1),
        }

    def walk(node_id, depth: int) -> None:
        n = by_id.get(node_id)
        if n is None or len(found) >= limit:
            return
        role = (n.get("role") or {}).get("value", "").lower()
        name = (n.get("name") or {}).get("value", "")
        if role in KEEP_ROLES and role not in STRIP_ROLES and (name or role):
            line = f'[0:{n["nodeId"]}] {role}'
            if name:
                line += f' "{name[:60]}"'
            found.append({
                "line": "  " * depth + line,
                "ref": f'[0:{n["nodeId"]}]',
                "name": name[:60],
                "box": box(n),
            })
            depth += 1
        for child in n.get("childIds", []) or []:
            walk(child, depth)

    for root in nodes:
        if "parentId" not in root:
            walk(root["nodeId"], 0)
            if len(found) >= limit:
                break
    return found


def shoot(page, name: str) -> None:
    page.wait_for_timeout(700)  # let the working line's 700ms hold resolve
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"  {name}.png")


class Run:
    """The run, recorded as the video plays it.

    `hold` is how many frames the video shows that state for. It is written by
    hand rather than sampled at a constant rate because the real run is not
    evenly paced — steps land in bursts, and the approval takes a beat to arrive
    because the panel animates it in. A uniform sample flattens exactly the part
    a viewer needs to notice.
    """

    def __init__(self, page):
        self.page = page
        self.frames: list[dict] = []
        self.spots: dict[str, dict] = {}
        self.ax: list[dict] = []

    def mark(self, name: str, selector: str) -> None:
        spot(self.page, self.spots, name, selector)

    def read_tree(self) -> None:
        """Read the panel's accessibility tree while the plan is on screen.

        The panel is a real DOM, so the tree a CDP reader gives it is the same
        shape the model gets for a real page — which is the point of capturing
        it here rather than writing the lines by hand. A hand-written tree would
        be a drawing of the product; this one is the product.
        """
        self.ax = ax_tree(self.page)
        print(f"  ax tree: {len(self.ax)} lines")

    def capture(self, label: str, hold: int, follow: bool = False, reveal: str | None = None) -> None:
        if reveal:
            self.page.evaluate(
                "(sel) => { const els = document.querySelectorAll(sel);"
                " const el = els[els.length - 1]; if (el) el.scrollIntoView({ block: 'start' }); }",
                reveal,
            )
        elif not follow:
            scroll_top(self.page)
        self.page.wait_for_timeout(500)
        SEQ.mkdir(parents=True, exist_ok=True)
        name = f"{len(self.frames):02d}-{label}.png"
        self.page.screenshot(path=str(SEQ / name))
        self.frames.append({"src": f"seq/{name}", "hold": hold})
        print(f"  seq/{name}  ({hold}f)")

    def write_module(self) -> None:
        """Emit the ordering as a TS module rather than a JSON sidecar.

        The video must not hold a second copy of the order — that is a list
        hand-kept in sync with a list written here, which is precisely how the
        three model catalogues drifted. One writer, one artefact.
        """
        rows = "\n".join(f'  {{ src: "{f["src"]}", hold: {f["hold"]} }},' for f in self.frames)
        marks = "\n".join(
            f'  {name}: {{ x: {s["x"]}, y: {s["y"]}, w: {s["w"]}, h: {s["h"]} }},'
            for name, s in self.spots.items()
        )
        lines = "\n".join(
            f"  {{ line: {l}, ref: {r}, name: {n}, box: "
            + (f'{{ x: {b["x"]}, y: {b["y"]}, w: {b["w"]}, h: {b["h"]} }}' if b else "null")
            + " },"
            for l, r, n, b in (
                (json.dumps(a["line"]), json.dumps(a["ref"]), json.dumps(a["name"]), a["box"])
                for a in self.ax
            )
        )
        SEQ_TS.write_text(
            "// GENERATED by demo/tools/panel_shot.py — do not edit.\n"
            "//\n"
            "// The run, in order, as the video plays it. `hold` is how many frames\n"
            "// that state is on screen. `SPOTS` is where each callout points, measured\n"
            "// off the live DOM rather than eyeballed. Regenerate with:\n"
            "//\n"
            "//     .venv/bin/python demo/tools/panel_shot.py\n"
            "\n"
            "export type RunFrame = { src: string; hold: number };\n"
            "export type Spot = { x: number; y: number; w: number; h: number };\n"
            "\n"
            "export const RUN: RunFrame[] = [\n"
            f"{rows}\n"
            "];\n"
            "\n"
            "export const SPOTS: Record<string, Spot> = {\n"
            f"{marks}\n"
            "};\n"
            "\n"
            "// The panel's own accessibility tree, read over CDP while the plan was\n"
            "// on screen, formatted the way `agent/ax_filter.py` formats it for the\n"
            "// model. `box` is the element that line names, in the same pixel space\n"
            "// as SPOTS, so Draft2 can light a ref up on the panel it addresses.\n"
            "export type AxNode = { line: string; ref: string; name: string; box: Spot | null };\n"
            "export const AX_TREE: AxNode[] = [\n"
            f"{lines}\n"
            "];\n"
            "\n"
            f"export const RUN_FRAMES = {sum(f['hold'] for f in self.frames)};\n"
        )
        print(f"  wrote {SEQ_TS.relative_to(REPO)}  ({len(self.frames)} frames, "
              f"{sum(f['hold'] for f in self.frames)} frames of run, "
              f"{len(self.spots)} callout spots, {len(self.ax)} tree lines)")


# The panel probes the server on open. A `file://` origin gets a CORS failure
# back, which is the same failure a stopped server produces, so every shot
# would carry the "server unreachable" toast. Answering the probes is enough:
# `state.serverReachable` is set from the policy call's body.
ROUTES = {
    "/health": {"status": "ok"},
    "/v1/models": {"providers": []},
    "/v1/policy": {"blacklist": [], "visited_domains": []},
    # Server-shaped: the panel prefers this list over its own local array, so an
    # empty one renders an empty history no matter what was seeded.
    "/v1/sessions": {
        "sessions": [
            {
                "title": s["task"],
                "status": {"completed": "done", "failed": "error"}.get(s["status"], "done"),
                "steps": s["steps"],
                "started_at": s["startedAt"],
                "session_id": s["session_id"],
                "task_count": s["task_count"],
            }
            for s in SEED["sessions"]
        ]
    },
    "/v1/suggestions": {"suggestions": []},
}


def route_server(route) -> None:
    for suffix, body in ROUTES.items():
        if route.request.url.endswith(suffix):
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
            return
    route.fulfill(status=404, content_type="application/json", body="{}")


def main() -> int:
    if not PANEL.exists():
        print(f"no panel at {PANEL}", file=sys.stderr)
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": VIEW_W, "height": VIEW_H},
            device_scale_factor=DPR,
        )
        page.route("**/v1/**", route_server)
        page.route("**/health", route_server)

        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)

        # `add_init_script` takes one string, so the seed rides in as a literal
        # rather than as a second argument. The shim runs before any panel script.
        page.add_init_script(f"window.__SEED = {json.dumps(SEED)};\n(" + SHIM + ")(window.__SEED);")
        page.goto(PANEL.as_uri())
        page.wait_for_function("document.fonts.status === 'loaded' || document.fonts.ready")
        page.wait_for_timeout(600)

        n = page.evaluate("window.__listeners()")
        print(f"onMessage listeners registered: {n}")
        if not n:
            print("no listener — the panel did not wire up; every shot below would be blank", file=sys.stderr)
            return 1

        shoot(page, "panel-idle")
        run = Run(page)

        # A run in flight. Every frame below is one the relay really sends, and
        # every number the status bar shows is the panel's own arithmetic on it:
        # `startedAt` seeds its clock, `index` counts its steps, `context.pct`
        # is what it renders for CONTEXT. Nothing is written into the DOM here.
        started = int(time.time() * 1000) - 372_000  # 6m 12s ago, as a 14-step run takes
        emit(page, {
            "type": "task_started",
            "task": "Find me the cheapest direct flight to Lisbon in November",
            "startedAt": started,
            "sessionId": "a1b2c3d4-0001",
        })
        emit(page, {
            "type": "plan",
            "title": "Search flights to Lisbon",
            "sites": ["flights.google.com", "kayak.com"],
            "steps": [
                {"index": 1, "text": "Open flight search and set Lisbon (LIS)"},
                {"index": 2, "text": "Set dates to November 2026"},
                {"index": 3, "text": "Filter to **direct only**"},
                {"index": 4, "text": "Sort by cheapest, and read the first three results"},
            ],
        })
        # The plan is the first thing a viewer should read, so it gets the
        # longest hold of the opening states.
        run.capture("plan", 18)
        run.mark("plan", ".plan-card")
        run.mark("composer", "#inputArea")
        run.read_tree()

        STEPS = [
            "Read the November fare calendar",
            "Set departure 4 Nov, return 18 Nov",
            "Toggled “direct only”",
            "Sorted by cheapest",
            "Opened the cheapest result",
            "Compared the three lowest fares",
            "Checked the layover filter",
            "Read the fare rules",
            "Confirmed baggage is included",
            "Checked departure times",
            "Re-sorted including taxes",
            "Opened the return leg",
            "Confirmed both legs are direct",
        ]
        # Sampled, not every step: fourteen captures of a card list is fourteen
        # near-identical frames, and the video only needs the count to move.
        SAMPLE_AT = {3: 9, 5: 8, 8: 8, 11: 7}

        emit(page, {
            "type": "step_card",
            "index": 0,
            "iconKind": "navigate",
            "clientText": "Opened Google Flights",
            "detail": "flights.google.com/flights?f=0&tfs=…",
        })
        emit(page, {"type": "canonical_step", "kind": "observe"})
        shoot(page, "panel-plan")
        run.capture("opened", 13)

        # 13 more steps, so the counter reads the 14 the history row claims.
        for i in range(1, 14):
            emit(page, {
                "type": "step_card",
                "index": i,
                "iconKind": "click" if i % 3 else "type_text",
                "clientText": STEPS[i - 1],
            })
            if i in SAMPLE_AT:
                run.capture(f"step{i}", SAMPLE_AT[i])
        emit(page, {
            "type": "context_update",
            "context": {"tokens": 412_000, "window": 1_000_000, "pct": 41.2},
        })
        run.capture("working", 11)

        emit(page, {
            "type": "approval_request",
            "id": "a1",
            "reason": "Booking a flight spends your money, so Brotto stops and asks.",
            "action": {"type": "click", "url": "https://kayak.com/checkout"},
        })
        shoot(page, "panel-approval")
        # Longest hold in the run. The card animates in, and this is the state
        # the whole "asks" beat is about — cutting away from it early loses it.
        run.mark("approval", ".approval-card")
        run.capture("asks", 24, follow=True)

        emit(page, {"type": "approval_resolved", "id": "a1", "approved": True})
        emit(page, {
            "type": "canonical_terminal",
            "message": {
                "type": "task.completed",
                "summary": "Three direct flights. The cheapest is $412 return, 31% under the cheapest via a hub.",
                "finalAnswer": (
                    "**Cheapest direct flight to Lisbon — November 2026**\n\n"
                    "1. **TAP Air Portugal** — $412 return\n"
                    "   Direct, 4 Nov, 7h 05m\n"
                    "2. **United** — $468 return\n"
                    "   Direct, 6 Nov, 7h 20m\n"
                    "3. **Air France** — $505 return\n"
                    "   Direct, 9 Nov, 7h 15m\n\n"
                    "All three land at LIS on an evening arrival. The $412 fare is 31% below the "
                    "cheapest one-stop option, and includes checked baggage on both legs."
                ),
            },
        })
        run.mark("answer", ".final-answer")
        shoot(page, "panel-done")
        # Scrolling to the very bottom tucks the answer behind the composer, and
        # scrolling to the top buries it under fourteen step cards. The answer is
        # the whole point of this state, so it gets the frame.
        run.capture("done", 28, reveal=".final-answer")
        run.mark("answer", ".final-answer")

        page.evaluate("() => document.getElementById('historyBtn')?.click()")
        page.wait_for_timeout(700)
        run.mark("deleteAll", "#historyDeleteAll")
        shoot(page, "panel-history")

        run.write_module()
        browser.close()

    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for e in errors[:10]:
            print("  " + e, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
