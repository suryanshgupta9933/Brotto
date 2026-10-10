# Branch protection setup (one-time, repo admin)

Repo administration, not contributing. Kept out of `CONTRIBUTING.md` because it
is done once by whoever owns the repository, not by anyone opening a pull
request.

**This repo uses a ruleset, not legacy branch protection.** The two are different
mechanisms and their API endpoints are not interchangeable. Read
[Query the right endpoint](#query-the-right-endpoint) before concluding anything
about whether `main` is protected.

## What is actually configured

One ruleset: **"Protect main"**, id `24720045`, target `branch`, created
2026-10-08. Its condition is `~DEFAULT_BRANCH`, so it follows the default branch
rather than hardcoding `main`.

**`enforcement: active`.** Re-check rather than trusting this file:

```bash
gh api repos/suryanshgupta9933/brotto/rulesets/24720045 \
  --jq '{enforcement, rules: [.rules[].type]}'
```

| Rule | Parameter | What it blocks |
|---|---|---|
| `deletion` | — | deleting the branch |
| `non_fast_forward` | — | force pushes, i.e. every history rewrite |
| `code_scanning` | CodeQL, `alerts_threshold: errors`, `security_alerts_threshold: high_or_higher` | merging with an open high-severity CodeQL alert |
| `code_coverage` | `minimum_coverage: 60`, `max_coverage_drop: null` | see [the coverage gap](#the-two-gaps) |
| `pull_request` | see below | direct pushes to `main` |

The `pull_request` rule allows `merge`, `squash` and `rebase`, and sets:

| Parameter | Value | Note |
|---|---|---|
| `required_approving_review_count` | `0` | **a PR can merge with nobody approving it** |
| `require_code_owner_review` | `false` | `.github/CODEOWNERS` is **not** enforced |
| `dismiss_stale_reviews_on_push` | `false` | an approval survives new pushes |
| `require_last_push_approval` | `false` | the author may approve their own PR |
| `required_review_thread_resolution` | `false` | open threads do not block a merge |
| `require_extra_approval_for_unattributed_changes` | `true` | **not** an AI-attribution rule — it means commits whose author GitHub cannot verify need an extra approval |

## The gaps

**1. There is no `required_status_checks` rule.** The workflow `CI` has three
jobs and no aggregator, so a required check named `CI` would never report. A PR
can currently merge with red CI. The real job names are `Orchestrator tests`,
`Extension build` and `Docker image build`.

**2. ~~`code_coverage: 60` is enforced but nothing uploads coverage.~~
Fixed 2026-10-10.** `ci.yml`'s `Orchestrator tests` job now writes a Cobertura
report and uploads it with `actions/upload-code-coverage@v1`, under a job-scoped
`code-quality: write`. That is GitHub's built-in Code Quality path — no Codecov,
no Coveralls, no token, no third party. It stays inside the existing job on
purpose: GitHub wants the status check associated with a coverage upload to be a
required check, and that job already has to be green.

Two things GitHub's docs call out that are easy to miss:

- **Do not upload coverage from a fork.** The step is guarded with
  `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.
  Without it, a fork's PR can post a report against this repo.
- **Checking out the PR head** (`ref: ${{ github.event.pull_request.head.sha || github.sha }}`)
  makes coverage line numbers map onto the diff. Left as plain `checkout` for
  now — it is a reporting nicety, not a gate, and changing the checkout for the
  whole job is a bigger diff than the fix warrants.

### A local coverage number is not the CI number

`ci.yml`'s comment says 77%. **Running the same command on macOS can print 62%**
and still be correct code. macOS filesystems are case-insensitive, so
`/Users/apple/work/...` and `/Users/apple/Work/...` are the same directory to the
shell but two different strings to `coverage.py` — every file gets measured
twice and the percentage roughly halves. Reproduce CI's number by passing
`PYTHONPATH` with the same casing as the real path:

```bash
rm -f .coverage
PYTHONPATH=/Users/apple/Work/code/brotto/services/brotto-orchestrator/src \
  .venv/bin/python -m pytest services/brotto-orchestrator/tests -q \
  --cov=brotto_orchestrator --cov-fail-under=75
```

Enabling the missing status checks, now that coverage is being uploaded:

```bash
gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/suryanshgupta9933/brotto/rulesets/24720045 \
  --input - <<'JSON'
{
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "enforcement": "active",
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Orchestrator tests" },
          { "context": "Extension build" },
          { "context": "Docker image build" }
        ]
      }
    },
    { "type": "code_scanning",
      "parameters": {
        "code_scanning_tools": [
          { "tool": "CodeQL", "alerts_threshold": "errors",
            "security_alerts_threshold": "high_or_higher" }
        ]
      }
    },
    { "type": "code_coverage",
      "parameters": { "minimum_coverage": 60, "max_coverage_drop": null } },
    { "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["squash", "merge", "rebase"],
        "required_reviewers": []
      }
    }
  ]
}
JSON
```

That PUT replaces the whole ruleset, which is why every rule you want to keep is
repeated above — a partial update is not supported.

## Query the right endpoint

```bash
# the ruleset — the source of truth
gh api repos/suryanshgupta9933/brotto/rulesets

# legacy branch protection — 404 on this repo, and that is EXPECTED
gh api repos/suryanshgupta9933/brotto/branches/main/protection
```

The legacy endpoint returns:

```json
{"message": "Branch not protected", "status": "404"}
```

**That 404 does not mean `main` is unprotected.** The legacy endpoint has no
concept of a ruleset, so it reports nothing. Reading it as "protection is off"
is how a correctly-protected repo gets mistaken for a broken one — an earlier
version of this file made exactly that mistake, which is why it also named a
required check that does not exist.

## CODEOWNERS

`.github/CODEOWNERS` points at `@suryanshgupta9933` for the whole repo.
`require_code_owner_review` is currently `false`, so this file has **no effect**
today; it starts auto-assigning only when that rule is on. A missing or renamed
owner turns review off silently rather than failing loudly, so confirm the
handle when you enable it.