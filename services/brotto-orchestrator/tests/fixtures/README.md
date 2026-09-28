# Fixtures and baseline

`baseline.json` is the recorded outcome of `python scripts/run_benchmark.py --all`,
and `--check` compares a fresh run against it. A green `--check` is a *net*, not
a proof. Three things it cannot see:

- **A tighter character budget is invisible.** Setting `MAX_CHARS = 3000` in
  `agent/ax_filter.py` leaves the suite exiting 0.
- **The same-rank step rule is one-directional.** A harness that gets *slower*
  at the same failure class — more steps for the same outcome — is not flagged.
- **A stale server measures stale code.** `--check` POSTs to a running orchestrator;
  if the process predates your `src/` edits, the run measures code that is no longer
  in the tree and exits 0 regardless. Restart the server before any run whose result
  you intend to trust.

Because step counts are baked into `baseline.json`, **re-record it whenever
`testing/scripts.py` changes** (or any change moves a fixture's step count):

    python scripts/run_benchmark.py --all --out tests/fixtures/baseline.json

Do not record a baseline while the suite is returning `BUDGET_EXHAUSTED` or
`HARNESS_ERROR` — those count as regressions, so every later run stays red.
