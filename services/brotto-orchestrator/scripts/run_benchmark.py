#!/usr/bin/env python
"""Run the authenticated fixture suite and report failure attribution.

The score is secondary. The output that matters is the per-Outcome tally,
because each Outcome maps onto one wave of the capability map — the tally is
what derives the next plan's priority order.

Requires the orchestrator already running on port 8000; the preflight below
refuses to measure a server that is not there rather than recording zeroes.

Usage:
    python scripts/run_benchmark.py --list
    python scripts/run_benchmark.py --all --out tests/fixtures/baseline.json
    python scripts/run_benchmark.py --all --check
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import pathlib
import socket
import urllib.request

from brotto_orchestrator.testing.fixtures import FIXTURES, IFRAME_PORT, MAIN_PORT, load_fixture
from brotto_orchestrator.testing.outcome import WAVE_BY_OUTCOME, Outcome
from brotto_orchestrator.testing.records import TaskRecord
from brotto_orchestrator.testing.runner import run_task
from brotto_orchestrator.testing.server import serve_fixtures, serve_iframe_origin

log = logging.getLogger("brotto.benchmark")

BASE_URL = "http://127.0.0.1:8000"
BASELINE = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "baseline.json"


def _require_server() -> None:
    """Fail loudly rather than measure a dead or foreign server.

    A stale process on 8000 answers with code that is no longer in the tree,
    and the resulting baseline is wrong in a way nothing downstream can see.
    A *stale but genuine* orchestrator still reports itself as brotto and is
    indistinguishable over the wire — check the port is clear before a run
    whose result you intend to commit.
    """
    host, port = "127.0.0.1", int(BASE_URL.rsplit(":", 1)[1])
    try:
        with socket.create_connection((host, port), timeout=2):
            pass
    except OSError as exc:
        raise SystemExit(
            f"nothing listening on {host}:{port} ({exc}).\n"
            "Start the orchestrator first:\n"
            "    cd services/brotto-orchestrator && "
            "../.venv/bin/python start_server.py"
        )
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as resp:
            body = json.load(resp)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"port {port} answered but /health failed: {exc!r}")
    if body.get("service") != "brotto-orchestrator":
        raise SystemExit(
            f"port {port} is not the brotto orchestrator: {body.get('service')!r}"
        )


def _tally(records: list[TaskRecord]) -> dict[str, int]:
    tally: dict[str, int] = {}
    for rec in records:
        tally[rec.outcome.value] = tally.get(rec.outcome.value, 0) + 1
    return tally


def _report(records: list[TaskRecord]) -> dict[str, int]:
    tally = _tally(records)
    for outcome, wave in WAVE_BY_OUTCOME.items():
        if tally.get(outcome.value):
            log.info("%-20s %2d  → wave %s", outcome.value, tally[outcome.value], wave)
    return tally


async def _run(names: list[str]) -> list[TaskRecord]:
    with serve_fixtures(MAIN_PORT), serve_iframe_origin(IFRAME_PORT):
        records = []
        for name in names:
            fx = load_fixture(name)
            records.append(await run_task(
                script_name=fx.name,
                fixture_name=fx.name,
                base_url=BASE_URL,
                start_url=f"http://127.0.0.1:{fx.port}{fx.path}",
            ))
            log.info("%-16s %s", name, records[-1].outcome.value)
    return records


def _check(records: list[TaskRecord], baseline_path: pathlib.Path = BASELINE) -> int:
    """Exit 1 on a regression. The rule is deliberately narrow.

    A fixture regresses when it *was* PASS and no longer is, when it is now
    BUDGET_EXHAUSTED or HARNESS_ERROR (the run stopped producing evidence),
    or when the same outcome class now fails earlier than it did.

    Every other transition — including every failure-class change — is
    movement, and movement is the point: closing a perception gap moves a
    fixture from PERCEPTION_FAILURE to ACTION_FAILURE, and a rank net told
    the next engineer to revert that. Known blind spots are in
    tests/fixtures/README.md.
    """
    if not baseline_path.is_file():
        log.error("no baseline at %s — record one before using --check", baseline_path)
        return 1
    baseline = {
        r["fixture"]: r
        for r in json.loads(baseline_path.read_text())["records"]
    }
    no_evidence = (Outcome.BUDGET_EXHAUSTED.value, Outcome.HARNESS_ERROR.value)
    regressions = 0
    for rec in records:
        was_row = baseline.get(rec.fixture)
        if was_row is None:
            log.warning("%-16s no baseline entry", rec.fixture)
            continue
        was = was_row["outcome"]
        now = rec.outcome.value
        was_steps = (was_row.get("timing") or {}).get("steps")
        now_steps = (rec.timing or {}).get("steps")
        if (was == Outcome.PASS.value and now != Outcome.PASS.value) or now in no_evidence:
            log.error("REGRESSION %-16s %s → %s", rec.fixture, was, now)
            regressions += 1
        elif (
            now == was
            and rec.outcome is not Outcome.PASS
            and was_steps is not None
            and now_steps is not None
            and now_steps < was_steps
        ):
            # Same severity, fewer steps: the failure moved earlier in the task
            # (e.g. the login button stopped resolving), which the outcome
            # class alone cannot see.
            log.error(
                "REGRESSION %-16s %s at step %s, was %s",
                rec.fixture, now, now_steps, was_steps,
            )
            regressions += 1
        else:
            log.info("movement    %-16s %s → %s", rec.fixture, was, now)
    return 1 if regressions else 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="list fixtures and exit")
    ap.add_argument("--fixture", action="append", default=[], help="run one fixture (repeatable)")
    ap.add_argument("--all", action="store_true", help="run every fixture")
    ap.add_argument("--check", action="store_true", help="fail on regression vs baseline.json")
    ap.add_argument("--out", help="write the run document here")
    args = ap.parse_args()

    if args.list:
        for f in FIXTURES:
            print(f"{f.name:<18} targets {f.targets_gap:<12} goal={f.target_name!r}")
        return 0

    names = [f.name for f in FIXTURES] if args.all else args.fixture
    if not names:
        ap.error("pass --list, --fixture NAME, or --all")

    _require_server()
    records = asyncio.run(_run(names))
    _report(records)
    document = {
        "records": [r.model_dump(mode="json") for r in records],
        "tally": _tally(records),
    }

    # Check before writing: --out then --check would otherwise write the run
    # into the baseline and then check the baseline against itself — exit 0
    # every time, by construction.
    exit_code = _check(records) if args.check else 0

    if args.out:
        out = pathlib.Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(document, indent=2) + "\n")
        log.info("wrote %s", out)
    else:
        print(json.dumps(document, indent=2))

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
