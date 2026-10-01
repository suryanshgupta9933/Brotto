#!/usr/bin/env python
"""What an observation costs, per CDP call, and what concurrency would buy.

0A made the model stop being blind and the observation round trip was never
measured when it got more expensive. The numbers that exist today are one
per-phase split from the audit — observe 70.53s, model_plan 82.97s — which
says the round trip is expensive and nothing about *why*.

So this measures it. For each page it replays the exact call sequence
``captureObservation`` runs, in the same order, timing every call. The
in-page JavaScript — ``BOX_WALK`` and ``HIDDEN_PROBE`` — is extracted from the
TypeScript source rather than copied, because a copy is a second thing to keep
correct and this probe exists to report on the real thing.

The interesting output is not the totals; it is the **projection**. Every
sequential loop in the pipeline is timed call-by-call, so serial cost is
``n * per_call`` and the cost at concurrency C is ``ceil(n / C) * per_call``.
That is arithmetic on measured per-call latency, not a guess, and it is what
decides Task 2's constant and whether Task 1's ``fallback`` counter is
reporting a real problem or a theoretical one.

Pages are synthetic by default, because frame count is the variable that
matters and a real page will not give you 1, 2, and 6 frames on demand.
``--url`` takes a real page too.

Usage::

    python scripts/probe_observation_perf.py
    python scripts/probe_observation_perf.py --url https://example.com
    python scripts/probe_observation_perf.py --out /tmp/perf.json
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import json
import math
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

REPO = pathlib.Path(__file__).resolve().parents[3]
OBS = REPO / "clients" / "brotto-extension" / "src" / "observation"

# Mirrors of the caps in surfaces.ts, so this probe reproduces what the
# extension does rather than what it would be nice to do.
MAX_FRAMES = 12
MAX_FRAME_DEPTH = 4
MAX_NODES_PER_FRAME = 2000
MAX_GEOMETRY_ENTRIES = 2000
MAX_DEPTH = 4


# ---------------------------------------------------------------- TS extract


def _read(name: str) -> str:
    return (OBS / name).read_text()


def _backticked(src: str, const: str) -> str:
    """The body of `const NAME = ` ... `;` — a template literal in the source."""
    m = re.search(r"const " + const + r" = `(.+?)`;", src, re.S)
    if not m:
        raise SystemExit(f"could not extract {const} from the TypeScript source")
    return m.group(1)


def _number_const(src: str, name: str) -> int:
    """`export const MAX_EVAL_BYTES = 512 * 1024;` — integer arithmetic only.

    Parsed rather than eval'd: the capture is our own source, but a probe
    nobody should have to audit is not worth the eval to save six lines.
    """
    m = re.search(r"export const " + name + r" = ([\w_ *]+);", src)
    if not m:
        raise SystemExit(f"could not extract {name}")
    tree = ast.parse(m.group(1), mode="eval")

    def fold(node):
        if isinstance(node, ast.Expression):
            return fold(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            return fold(node.left) * fold(node.right)
        raise SystemExit(f"{name} is not a plain integer expression")

    return fold(tree)


def box_walk() -> str:
    return _backticked(_read("geometry.ts"), "BOX_WALK")


def hidden_probe() -> str:
    src = _read("supplement.ts")
    body = _backticked(src, "HIDDEN_PROBE")
    return (
        body.replace("${MAX_EVAL_BYTES}", str(_number_const(src, "MAX_EVAL_BYTES")))
        .replace("${MAX_HIDDEN_NODES}", str(_number_const(src, "MAX_HIDDEN_NODES")))
    )


# The page-side half of waitForStable, from stability.ts. Its `return` is a
# concatenation of string literals with two interpolations, so walk the pieces
# in order rather than trying to eval the expression — the measured floor has
# to be the real floor, and this is the only way to get it without a TS runtime.
_STAB_PIECE = re.compile(r'"((?:[^"\\]|\\.)*)"|\+\s*([A-Za-z_]\w*)\s*\+')


def stability_expression(quiet_ms: int, deadline_ms: int) -> str:
    src = _read("stability.ts")
    m = re.search(r"  return \(\n(.*?)\n  \);", src, re.S)
    if not m:
        raise SystemExit("could not extract observerExpression from stability.ts")
    values = {"q": json.dumps(quiet_ms), "d": json.dumps(deadline_ms)}
    out = []
    for piece in _STAB_PIECE.finditer(m.group(1)):
        literal, ident = piece.group(1), piece.group(2)
        if literal is not None:
            # A JS string literal; every escape in this file is also a valid
            # JSON one, so json.loads is the interpreter and a malformed
            # capture fails loudly instead of silently.
            out.append(json.loads(f'"{literal}"'))
        elif ident in values:
            out.append(values[ident])
        else:
            raise SystemExit(f"unexpected identifier {ident!r} in observerExpression")
    if not out:
        raise SystemExit("observerExpression extracted as empty")
    return "".join(out)


# ------------------------------------------------------------------- timing


class Timed:
    """A CDP session that records how long every call took, by method."""

    def __init__(self, cdp):
        self.cdp = cdp
        self.samples: dict[str, list[float]] = {}

    async def send(self, method: str, params: dict | None = None) -> dict:
        t0 = time.perf_counter()
        out = await self.cdp.send(method, params or {})
        dt = (time.perf_counter() - t0) * 1000
        self.samples.setdefault(method, []).append(dt)
        return out

    def take(self, method: str) -> list[float]:
        return self.samples.pop(method, [])

    def total(self) -> float:
        return sum(sum(v) for v in self.samples.values())


def origin_of(url: str) -> str:
    m = re.match(r"([a-z]+://[^/]+)", url)
    return m.group(1) if m else ""


# ------------------------------------------------------- the measured pass


async def measure(page, cdp, label: str) -> dict:
    t = Timed(cdp)
    box_js = box_walk()
    hidden_js = hidden_probe()

    # 1. the stability gate — the floor every observation pays. Deliberately
    # NOT recorded in `t`: it is one call, so it cannot be pooled, and leaving
    # it in would average a 3000ms wait in with millisecond evaluates and make
    # the projection below meaningless.
    t0 = time.perf_counter()
    try:
        st = await cdp.send("Runtime.evaluate", {
            "expression": stability_expression(3000, 10000),
            "awaitPromise": True, "returnByValue": True,
        })
        stability = st.get("result", {}).get("value") or {}
    except Exception as exc:  # navigation raced us
        stability = {"error": str(exc)}
    stability_ms = (time.perf_counter() - t0) * 1000

    # 2. page text, url, title
    await t.send("Runtime.evaluate", {
        "expression": "({u:location.href,t:document.title,"
                      "x:((document.body&&document.body.innerText)||'')"
                      ".replace(/\\s+/g,' ').slice(0,20000)})",
        "returnByValue": True,
    })

    # 3. the frame scan
    await t.send("Accessibility.enable")
    tree = await t.send("Page.getFrameTree")
    top = (tree.get("frameTree") or {}).get("frame") or {}
    top_origin = origin_of(top.get("url", ""))

    # Breadth-first over frame-tree nodes, the same walk selectFrames does.
    queue = [{"node": tree.get("frameTree"), "depth": 0}]
    surfaces = []
    i = 0
    while i < len(queue):
        entry = queue[i]
        i += 1
        for child in (entry["node"] or {}).get("childFrames") or []:
            queue.append({"node": child, "depth": entry["depth"] + 1})
        frame = (entry["node"] or {}).get("frame") or {}
        if not frame.get("id"):
            continue
        if entry["depth"] >= MAX_FRAME_DEPTH or len(surfaces) >= MAX_FRAMES:
            continue
        url = frame.get("url", "")
        surfaces.append({
            "frameId": frame["id"],
            "depth": entry["depth"],
            "url": url,
            "crossOrigin": bool(top_origin) and origin_of(url) != top_origin,
        })

    ax_nodes_per_frame = []
    for surface in surfaces:
        r = await t.send("Accessibility.getFullAXTree", {"frameId": surface["frameId"]})
        nodes = r.get("nodes") or []
        ax_nodes_per_frame.append(len(nodes))
        surface["axNodes"] = nodes[:MAX_NODES_PER_FRAME]
        surface["rawAxNodes"] = len(nodes)

    # 4. geometry, bulk then the sequential fallback
    ids, seen = [], set()
    for surface in surfaces:
        for node in surface["axNodes"]:
            bid = node.get("backendDOMNodeId")
            if isinstance(bid, int) and bid not in seen:
                seen.add(bid)
                ids.append(bid)
    bulk = ids[:MAX_GEOMETRY_ENTRIES]
    overflow = ids[MAX_GEOMETRY_ENTRIES:]

    joined: dict[int, list[int]] = {}
    if bulk:
        doc = await t.send("DOM.getDocument", {"depth": -1, "pierce": True})
        root = doc.get("root") or {}
        # The same element-children-only arithmetic reachablePaths uses.
        stack = [{"node": root, "path": []}]
        wanted = set(bulk)
        while stack:
            item = stack.pop()
            kids = item["node"].get("children")
            if not kids:
                continue
            idx = 0
            for kid in kids:
                if not kid or kid.get("nodeType") != 1:
                    continue
                path = item["path"] + [idx]
                idx += 1
                bid = kid.get("backendNodeId")
                if isinstance(bid, int) and bid in wanted:
                    joined[bid] = path
                stack.append({"node": kid, "path": path})
        if joined:
            res = await t.send("DOM.resolveNode", {"backendNodeId": root["backendNodeId"]})
            oid = (res.get("object") or {}).get("objectId")
            if oid:
                ordered = [b for b in bulk if b in joined]
                await t.send("Runtime.callFunctionOn", {
                    "objectId": oid,
                    "functionDeclaration": box_js,
                    "arguments": [{"value": [joined[b] for b in ordered]}],
                    "returnByValue": True,
                })

    # The fallback loop, run in full — this is the cost we are measuring.
    for bid in overflow:
        try:
            await t.send("DOM.getBoxModel", {"backendNodeId": bid})
        except Exception:
            pass

    # 5. the aria-hidden supplement, main frame only, and it hit-tests serially
    hit_tests = 0
    main = next((s for s in surfaces if s["depth"] == 0 and not s["crossOrigin"]), None)
    if main:
        probe = await t.send("Runtime.evaluate", {
            "expression": hidden_js, "returnByValue": True,
        })
        items = (probe.get("result", {}).get("value") or {}).get("items") or []
        for item in items:
            try:
                await t.send("DOM.getNodeForLocation", {"x": item["x"], "y": item["y"]})
                hit_tests += 1
            except Exception:
                pass

    await t.send("Accessibility.disable")

    samples = {k: v for k, v in t.samples.items()}
    return {
        "label": label,
        "url": top.get("url", ""),
        "frames": len(surfaces),
        "crossOrigin": sum(1 for s in surfaces if s["crossOrigin"]),
        "axNodesPerFrame": ax_nodes_per_frame,
        "axNodesTotal": sum(ax_nodes_per_frame),
        "geometryRequested": len(ids),
        "geometryBulk": len(bulk),
        "geometryFallback": len(overflow),
        "hitTests": hit_tests,
        "stabilityMs": round(stability_ms, 1),
        "stability": stability,
        "serialMs": {k: [round(x, 1) for x in v] for k, v in sorted(samples.items())},
        "serialTotalMs": round(t.total(), 1),
    }


def project(row: dict, concurrency: int) -> dict:
    """Serial cost against the same calls at a given concurrency."""
    serial = row["serialTotalMs"]
    pooled = 0.0
    for _method, times in row["serialMs"].items():
        per = sum(times) / len(times)
        pooled += math.ceil(len(times) / concurrency) * per
    return {
        "serialMs": serial,
        "pooledMs": round(pooled, 1),
        "savedMs": round(serial - pooled, 1),
        "speedup": round(serial / pooled, 2) if pooled else 1.0,
    }


# ---------------------------------------------------------------- synthetic


# Dense enough that several frames together pass MAX_GEOMETRY_ENTRIES, which
# is the case the sequential fallback exists for. A sparse page measures the
# stability floor and nothing else.
NODES_PER_FRAME = 400

FRAME_PAGE = (
    "<!doctype html><meta charset=utf-8><title>frame</title>"
    "<style>button{display:block;margin:2px;height:16px;font-size:9px}</style>"
    + "".join(f"<button>control {i}</button>" for i in range(NODES_PER_FRAME))
)

MAIN_HEAD = (
    "<!doctype html><meta charset=utf-8><title>main</title>"
    "<style>iframe{width:120px;height:200px;border:1px solid #ccc}</style>"
    "<button>main control</button>"
)

# Same-origin embeds, deliberately. A cross-origin embed in a headed Chromium
# is put in its own renderer process (site isolation), and an OOPIF is a
# separate CDP *target* — it does not appear in the main frame's
# `Page.getFrameTree` at all, so the frame scan would measure zero embeds and
# the numbers would be fiction. The supported case is same-process frames, so
# that is what gets built. The OOPIF case is a known open item, not this
# probe's business.
ORIGIN = "https://main.test"


def main_page(frame_count: int) -> str:
    return MAIN_HEAD + "".join(
        f'<iframe src="{ORIGIN}/frame/{i}"></iframe>' for i in range(frame_count)
    )


async def build(page, frame_count: int) -> None:
    # Routes persist across builds, so the next build's handler would have to
    # win the match against this one's. Clear them rather than depend on which
    # order the resolver tries.
    await page.unroute_all()
    await page.route(f"{ORIGIN}/frame/**", lambda r: r.fulfill(
        status=200, content_type="text/html; charset=utf-8", body=FRAME_PAGE,
    ))
    await page.route(f"{ORIGIN}/", lambda r: r.fulfill(
        status=200, content_type="text/html; charset=utf-8",
        body=main_page(frame_count),
    ))
    await page.goto(f"{ORIGIN}/", wait_until="load")
    await page.wait_for_timeout(1500)


# --------------------------------------------------------------------- main


async def run(urls: list[str], synthetic: list[int], repeats: int, concurrency: int) -> list[dict]:
    from playwright.async_api import async_playwright

    rows = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        ctx = await browser.new_context()
        page = await ctx.new_page()
        cdp = await ctx.new_cdp_session(page)

        for n in synthetic:
            await build(page, n)
            best = None
            for _ in range(repeats):
                row = await measure(page, cdp, f"synthetic {n} embed(s) + main")
                if best is None or row["serialTotalMs"] < best["serialTotalMs"]:
                    best = row
            best["projection"] = project(best, concurrency)
            rows.append(best)

        for url in urls:
            try:
                await page.goto(url, wait_until="load", timeout=45000)
            except Exception as exc:
                rows.append({"label": url, "error": str(exc)})
                continue
            await page.wait_for_timeout(2000)
            row = await measure(page, cdp, url)
            row["projection"] = project(row, concurrency)
            rows.append(row)

        await browser.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", action="append", default=[],
                    help="a real page to measure (repeatable)")
    ap.add_argument("--frames", type=int, nargs="*", default=[0, 2, 5],
                    help="synthetic cross-origin frame counts to build")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--out")
    args = ap.parse_args()

    rows = asyncio.run(run(args.url, args.frames, args.repeats, args.concurrency))

    print(f"\n{'page':<28} {'frames':>6} {'axNodes':>8} {'fallbk':>7} "
          f"{'hits':>5} {'stab':>6} {'cdp':>7} {'@pool':>7} {'x':>6}")
    print("-" * 90)
    for r in rows:
        if "error" in r:
            print(f"{r['label']:<28} ERROR {r['error'][:40]}")
            continue
        p = r["projection"]
        cdp = r["serialTotalMs"]
        print(f"{r['label']:<28} {r['frames']:>6} {r['axNodesTotal']:>8} "
              f"{r['geometryFallback']:>7} {r['hitTests']:>5} "
              f"{r['stabilityMs']:>5.0f}m {cdp:>6.0f}m "
              f"{p['pooledMs']:>6.0f}m {p['speedup']:>5.1f}x")

    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(rows, indent=2))
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
