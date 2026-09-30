#!/usr/bin/env python
"""Which perception gaps are real, and which are ours.

The capability map justifies six 0A gaps. Five have a fixture that fails. The
sixth — shadow DOM — had no fixture at all, and was justified by a grep of our
own source finding no ``shadowRoot`` identifier. That grep proves our code
contains no such string; it says nothing about Chrome, which traverses open
shadow roots on its own. So the map's headline 0A finding may be a category
error, and the same is true of the CDP details every fix would otherwise have
to assert from memory.

This measures instead. For each fixture's target it records four routes, in
the order the observation pipeline tries them:

===========================  ==================================================
``in_ax_tree``               top-frame ``Accessibility.getFullAXTree``
``in_ax_tree_all_frames``    the same, per frame from ``Page.getFrameTree``
``in_pierced_dom``           a DOM walk that recurses into open shadow roots
``in_rendered_output``       reaches the model at all — read from ``baseline.json``
===========================  ==================================================

and derives a verdict, which is the entire point of the artifact:

``OK``              the top frame already gives it to us
``GAP_TIMING``      Chrome has it, but we observed before the page drew it
``GAP_RENDER``      we get it from Chrome and then drop it when rendering
``GAP_FRAMES``      it is in a frame we never traverse
``GAP_ARIA``        Chrome omits it from the AX tree but the DOM has it
``GAP_UNREACHABLE`` it is not in the DOM at all — pixels, not nodes

``in_rendered_output`` is read, not re-measured: ``baseline.json`` already
records whether the target survived the whole pipeline, and re-running the
benchmark here would be a second measurement of the same fact. A fixture with
no record (``auth-shadow`` postdates the baseline) gets ``null``, which the
verdict reads as "no evidence" rather than as a pass.

A committed answer beats a confident grep. Run it, read the JSON, and only then
decide what to build.

Usage::

    python scripts/probe_perception.py --list
    python scripts/probe_perception.py --all --out tests/fixtures/perception-probe.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from brotto_orchestrator.testing.fixtures import (  # noqa: E402
    FIXTURES,
    IFRAME_PORT,
    MAIN_PORT,
    FixtureDef,
    load_fixture,
)
from brotto_orchestrator.testing.scripts import _OBSTACLES  # noqa: E402
from brotto_orchestrator.testing.server import (  # noqa: E402
    serve_fixtures,
    serve_iframe_origin,
)

# The slow-js fixture renders 5s after sign-in on purpose. A probe that gave up
# sooner would record a false negative and "confirm" a gap that is really just
# the gate working — which is exactly the failure mode this script exists to
# avoid, one level up.
RENDER_WAIT_MS = 12_000
POLL_MS = 250

# A target that takes longer than this to appear is a *timing* failure, not a
# rendering one: the AX tree has it, our filter had no chance to drop it,
# because we looked before the page had drawn it.
LATE_RENDER_MS = 500

# Runs inside the page. Recurses into open shadow roots, which is the whole
# point: a plain querySelectorAll stops at the host element and reports a
# shadow-DOM page as empty.
#
# script/style are skipped, and that is load-bearing rather than tidy. Each
# fixture carries its own render logic — including the target's own name — in
# an inline <script>, so textContent matches it on a page that has drawn
# nothing. An earlier innerHTML poll "found" auth-slowjs's target in the script
# that was about to render it, and the probe went on to record a gap that did
# not exist.
_DOM_WALK = """
() => {
  const out = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') continue;
      const text = (el.textContent || '').trim();
      const label = el.getAttribute('aria-label') || '';
      if (text || label) {
        out.push({tag, text: text.slice(0, 120), label});
      }
    }
  };
  walk(document);
  return out;
}
"""

_LOGIN = """
() => {
  const u = document.getElementById('u');
  const p = document.getElementById('p');
  if (u) u.value = 'dev@example.com';
  if (p) p.value = 'hunter2';
  document.getElementById('login').requestSubmit();
}
"""


def _ax_names(nodes: list[dict], target: str) -> bool:
    for n in nodes:
        name = ((n.get("name") or {}).get("value") or "").strip()
        if name == target:
            return True
    return False


def _in_dom(dom: list[dict], target: str) -> bool:
    return any(d["label"].strip() == target or target in d["text"] for d in dom)


def _walk_frames(node: dict) -> list[str]:
    """Frame ids from a Page.getFrameTree node.

    The node wraps the frame: it is ``{"frame": {...}, "childFrames": [...]}``,
    not the frame itself, so a node read as a frame has no "id" and KeyErrors
    on the first line.
    """
    out = [(node.get("frame") or {}).get("id", "")]
    for child in node.get("childFrames") or []:
        out.extend(_walk_frames(child))
    return [f for f in out if f]


def _verdict(row: dict) -> str:
    """First stage of the pipeline that should have produced the target.

    Order mirrors `captureObservation` → `filter_ax_targets`: the top frame,
    then other frames, then the DOM supplement, then nothing. The two AX
    branches split on *when* the target appeared, because "Chrome has it and
    we still did not send it" has two entirely different causes — we dropped it
    on the floor, or we looked before it existed — and they need different fixes.
    """
    if row["in_ax_tree"] or row["in_ax_tree_all_frames"]:
        if row["in_rendered_output"] is not False:
            return "OK"
        late = (row["render_delay_ms"] or 0) > LATE_RENDER_MS
        if row["in_ax_tree_all_frames"] and not row["in_ax_tree"]:
            return "GAP_FRAMES"
        return "GAP_TIMING" if late else "GAP_RENDER"
    if row["in_pierced_dom"]:
        return "GAP_ARIA"
    return "GAP_UNREACHABLE"


def _obstacle_names(fx_name: str) -> list[str]:
    """Accessible names of the clicks `scripts.py` needs to reach the target.

    Read from the benchmark's own script rather than restated here: a fixture
    whose obstacle changes would otherwise leave the probe observing a page
    state no one reaches, and every verdict off it wrong in the same
    confident direction.
    """
    return [
        action.action_args["ref"].__name__
        for step in _OBSTACLES.get(fx_name, [])
        for action in step.actions
        if callable(action.action_args.get("ref"))
    ]


_CLICK_BY_NAME = """
(name) => {
  const el = [...document.querySelectorAll('button,[role=tab],a')]
    .find((e) => (e.innerText || '').trim() === name);
  if (el) el.click();
  return !!el;
}
"""


def _rendered_output() -> dict[str, bool]:
    """fixture → did its target reach the model, per the recorded baseline."""
    path = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "baseline.json"
    if not path.exists():
        return {}
    records = json.loads(path.read_text()).get("records") or []
    return {r["fixture"]: r["outcome"] == "PASS" for r in records}


async def _await_target(page, target: str) -> tuple[int | None, list[dict]]:
    """Wait for the target to enter the DOM; return how long it took, and the walk.

    One walk serves both the "did it render" question and the "is it in the DOM
    at all" question, so the two can never disagree. null means it never
    appeared within RENDER_WAIT_MS — which for auth-iframe and auth-canvas is
    correct rather than broken, since their targets are not in this document by
    construction.

    Bounded, and the bound is generous on purpose — see RENDER_WAIT_MS.
    """
    waited = 0
    while True:
        dom = await page.evaluate(_DOM_WALK)
        if _in_dom(dom, target):
            return waited, dom
        if waited >= RENDER_WAIT_MS:
            return None, dom
        await asyncio.sleep(POLL_MS / 1000)
        waited += POLL_MS


async def probe_one(ctx, fx: FixtureDef, rendered: dict[str, bool]) -> dict:
    page = await ctx.new_page()
    try:
        await page.goto(f"http://127.0.0.1:{fx.port}{fx.path}")
        await page.evaluate(_LOGIN)
        cleared: list[str] = []
        for name in _obstacle_names(fx.name):
            if await page.evaluate(_CLICK_BY_NAME, name):
                cleared.append(name)
        delay_ms, dom = await _await_target(page, fx.target_name)

        cdp = await ctx.new_cdp_session(page)

        top = await cdp.send("Accessibility.getFullAXTree")
        in_top = _ax_names(top.get("nodes") or [], fx.target_name)

        tree = await cdp.send("Page.getFrameTree")
        frame_ids = _walk_frames(tree["frameTree"])
        in_any_frame = in_top
        frame_errors: list[str] = []
        for fid in frame_ids:
            try:
                nodes = (await cdp.send(
                    "Accessibility.getFullAXTree", {"frameId": fid}
                )).get("nodes") or []
                if _ax_names(nodes, fx.target_name):
                    in_any_frame = True
            except Exception as exc:  # a frame we cannot reach is a result
                frame_errors.append(f"{fid}: {type(exc).__name__}")

        row = {
            "fixture": fx.name,
            "targets_gap": fx.targets_gap,
            "target_name": fx.target_name,
            "render_delay_ms": delay_ms,
            "obstacles_cleared": cleared,
            "frames": len(frame_ids),
            "frame_errors": frame_errors,
            "in_ax_tree": in_top,
            "in_ax_tree_all_frames": in_any_frame,
            "in_pierced_dom": _in_dom(dom, fx.target_name),
            "in_rendered_output": rendered.get(fx.name),
        }
        row["verdict"] = _verdict(row)
        return row
    finally:
        await page.close()


async def run(names: list[str] | None) -> list[dict]:
    from playwright.async_api import async_playwright

    rows: list[dict] = []
    rendered = _rendered_output()
    with serve_fixtures(MAIN_PORT), serve_iframe_origin(IFRAME_PORT):
        async with async_playwright() as pw:
            # headless=False because these fixtures are checked against a real
            # accessibility tree, and a headless build's is not the one users
            # will run against.
            browser = await pw.chromium.launch(headless=False)
            ctx = await browser.new_context()
            try:
                for fx in FIXTURES:
                    if names and fx.name not in names:
                        continue
                    rows.append(await probe_one(ctx, fx, rendered))
            finally:
                await ctx.close()
                await browser.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixture", action="append", dest="fixtures",
                    help="probe one fixture (repeatable)")
    ap.add_argument("--all", action="store_true", help="probe every fixture")
    ap.add_argument("--list", action="store_true", help="list fixtures and exit")
    ap.add_argument("--out", type=pathlib.Path, help="write JSON here")
    args = ap.parse_args()

    if args.list:
        for fx in FIXTURES:
            print(f"{fx.name:20} {fx.targets_gap:14} {fx.target_name}")
        return 0
    if not args.fixtures and not args.all:
        ap.error("pass --all or --fixture NAME")

    rows = asyncio.run(run(args.fixtures))

    width = max((len(r["fixture"]) for r in rows), default=10)
    mark = {True: "yes", False: "-", None: "?"}
    print(f"{'fixture':<{width}}  {'ax':4} {'frames':7} {'dom':4} {'sent':5} {'wait':6}  verdict")
    for r in rows:
        delay = r["render_delay_ms"]
        print(f"{r['fixture']:<{width}}  "
              f"{mark[r['in_ax_tree']]:4} "
              f"{mark[r['in_ax_tree_all_frames']]:7} "
              f"{mark[r['in_pierced_dom']]:4} "
              f"{mark[r['in_rendered_output']]:5} "
              f"{('-' if delay is None else str(delay) + 'ms'):6}  {r['verdict']}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"rows": rows}, indent=2) + "\n")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
