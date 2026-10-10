#!/usr/bin/env bash
# Run the exact CodeQL analysis `.github/workflows/codeql.yml` runs, locally.
#
# Why this exists: a pull-request check on this repo never surfaces SARIF
# findings. PR #12 merged green with thirteen alerts that appeared on `main`
# afterwards, and the check-run annotations for it carry only the runner
# notice. So "the PR is green" is not evidence a `# codeql[...]` token
# worked — the only CI run that ever reports these is the one on `main`,
# which arrives after the merge is already done.
#
# That is what cost three branches. This runs the same queries against the
# same config in about two minutes, before anything is pushed, and prints
# each alert's file:line so a token can be moved to the line immediately
# above its sink without a round trip.
#
#   ./scripts/codeql-local.sh                 # both languages
#   ./scripts/codeql-local.sh python          # one language
#
# Needs the CodeQL CLI: https://github.com/github/codeql-cli-binaries/releases
# Set CODEQL=/path/to/codeql if it is not at /tmp/codeql/codeql.
set -euo pipefail

CODEQL="${CODEQL:-/tmp/codeql/codeql}"
CONFIG=".github/codeql/codeql-config.yml"
DB_ROOT="$(mktemp -d)"
OUT="$(mktemp -d)"
trap 'rm -rf "$DB_ROOT"' EXIT

[ -x "$CODEQL" ] || { echo "no codeql CLI at $CODEQL — set CODEQL=" >&2; exit 1; }

LANGUAGES=("$@")
[ ${#LANGUAGES[@]} -eq 0 ] && LANGUAGES=(python javascript-typescript)

for lang in "${LANGUAGES[@]}"; do
  # `--command=true` is the build step. Both languages here are interpreted,
  # so there is nothing to build; build-mode in CI is `none` for the same
  # reason. The flag is still required by `database create`.
  "$CODEQL" database create "$DB_ROOT/$lang" \
    --language="$lang" --overwrite --command=/usr/bin/true >/dev/null
  "$CODEQL" database analyze "$DB_ROOT/$lang" \
    --format=sarif-latest --sarif-category="$lang" \
    --config-file="$CONFIG" \
    --output="$OUT/$lang.sarif" \
    "$lang" >/dev/null
  echo "--- $lang"
  python3 - "$OUT/$lang.sarif" <<'PY'
import json, sys
sarif = json.load(open(sys.argv[1]))
alerts = [a for r in sarif["runs"] for a in r["results"]]
for a in alerts:
    loc = a["locations"][0]["physicalLocation"]
    start = loc["region"].get("startLine")
    print(f'  {a["ruleId"]:<28} {loc["artifactLocation"]["uri"]}:{start}')
print(f'  {len(alerts)} alert(s)')
sys.exit(1 if alerts else 0)
PY
done