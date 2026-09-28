# Fixtures and baseline

`baseline.json` is the recorded outcome of `python scripts/run_benchmark.py --all`,
and `--check` compares a fresh run against it. A green `--check` is a *net*, not
a proof. Two things it cannot see:

- **A tighter character budget is invisible.** Setting `MAX_CHARS = 3000` in
  `agent/ax_filter.py` leaves the suite exiting 0.
- **The same-rank step rule is one-directional.** A harness that gets *slower*
  at the same failure class — more steps for the same outcome — is not flagged.

Because step counts are baked into `baseline.json`, **re-record it whenever
`testing/scripts.py` changes** (or any change moves a fixture's step count):

    python scripts/run_benchmark.py --all --out tests/fixtures/baseline.json
