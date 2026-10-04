# Contributing

## Workflow

1. Branch off `main`.
2. Push commits to your branch.
3. Open a PR targeting `main`.
4. Wait for the **`CI`** check (aggregator of orchestrator tests + extension build) to go green.
5. Wait for a reviewer assigned by `.github/CODEOWNERS` to approve.
6. Squash-merge once both are green.

Direct pushes to `main` are blocked by branch protection — see below.

## Local checks before pushing

Run the same checks CI runs locally:

```bash
# Orchestrator tests (Python 3.12 + uv)
uv sync --group dev
uv run pytest services/brotto-orchestrator/tests -v

# Extension build (Node 20 + npm)
cd clients/brotto-extension
npm ci
npm run build          # esbuild bundle
npx tsc --noEmit       # type check (CI runs both)
```

A green run here usually matches a green CI run.

## Commit conventions

- No AI-tool trailers in commit messages. That means no `Co-Authored-By: …` from any AI assistant, no "Generated with [tool]" footers, no body text naming an AI assistant, vendor, or `noreply@…` address. Commit authors appear as humans only.
- If a template or tool auto-injects such a trailer, strip it before `git commit` runs. Applies to every commit on every branch in this repo, including past history.
- `git filter-repo` has been used historically to clean up slips.

## Repository hygiene — model neutrality

The agent layer is model-agnostic (D6); the public source must match.

- No file in this repository may name a specific AI model identifier — not in source, tests, CI, docs, examples, READMEs, or decision records.
- Source defaults come from env (`AGENT_MODEL`); never hardcode a specific model id as a fallback. Raise on missing env rather than naming one.
- Tests must not pass model-id literal strings; parametrize from a fixture or assert against the env value.
- CI matrices source model lists from secrets or workflow-level env, not the committed YAML.
- Documentation, competitive analysis, and benchmark READMEs may discuss models in general terms ("frontier vs mid-tier latency", "the default agent model") but must not name specific ids.
- Applies retroactively: when a leak is found in existing code or docs, flag it and scrub it; don't leave it because it pre-dates the rule.
- To rotate or add models, change env / secrets — not source.

## Branch protection

Set up once by whoever owns the repository, so it lives outside this guide:
[`docs/branch-protection.md`](docs/branch-protection.md).
