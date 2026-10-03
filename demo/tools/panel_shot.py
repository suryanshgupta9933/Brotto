"""Render the real side panel in Chromium and capture it as PNGs for the demo
videos.

This is asset generation, not a test of Brotto. It loads the shipped
`sidepanel.html` — the same `sidepanel.js` the extension runs — behind a
`chrome` shim, then drives it through genuine protocol frames delivered to the
genuine `chrome.runtime.onMessage` listener. Nothing here re-implements the
panel: if a card looks wrong in the video, it is wrong in the product, because
there is no second copy to disagree.

    .venv/bin/python demo/tools/panel_shot.py

Writes `demo/public/shots/<name>.png` at 2x for the video to scale down.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
PANEL = REPO / "clients/brotto-extension/src/sidepanel.html"
OUT = Path(__file__).resolve().parents[1] / "public/shots"

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


def shoot(page, name: str) -> None:
    page.wait_for_timeout(700)  # let the working line's 700ms hold resolve
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print(f"  {name}.png")


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
            viewport={"width": 420, "height": 900},
            device_scale_factor=2,
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
        emit(page, {
            "type": "step_card",
            "index": 0,
            "iconKind": "navigate",
            "clientText": "Opened Google Flights",
            "detail": "flights.google.com/flights?f=0&tfs=…",
        })
        emit(page, {"type": "canonical_step", "kind": "observe"})
        shoot(page, "panel-plan")

        # 13 more steps, so the counter reads the 14 the history row claims.
        for i in range(1, 14):
            emit(page, {
                "type": "step_card",
                "index": i,
                "iconKind": "click" if i % 3 else "type_text",
                "clientText": [
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
                ][i - 1],
            })
        emit(page, {
            "type": "context_update",
            "context": {"tokens": 412_000, "window": 1_000_000, "pct": 41.2},
        })
        emit(page, {
            "type": "approval_request",
            "id": "a1",
            "reason": "Booking a flight spends your money, so Brotto stops and asks.",
            "action": {"type": "click", "url": "https://kayak.com/checkout"},
        })
        shoot(page, "panel-approval")

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
        shoot(page, "panel-done")

        page.evaluate("() => document.getElementById('historyBtn')?.click()")
        shoot(page, "panel-history")

        browser.close()

    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for e in errors[:10]:
            print("  " + e, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
