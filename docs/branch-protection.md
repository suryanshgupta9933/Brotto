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

**2. `code_coverage: 60` is enforced but nothing uploads coverage — and
uploading is not available on this plan.**

**Attempted 2026-10-10 and reverted.** The obvious fix is GitHub's built-in
path: `ci.yml` writes Cobertura and `actions/upload-code-coverage@v1` attaches
it to the commit. It was implemented, and `Orchestrator tests` failed with:

```
Coverage upload failed (HTTP 404): Not Found.
```

**The cause is a plan restriction, not a config error.** Code Quality is gated
behind GitHub Team or Enterprise Cloud. The rendered docs page buries this; the
source does not:

```bash
curl -sL https://raw.githubusercontent.com/github/docs/main/content/code-security/how-tos/maintain-quality-code/set-up-code-coverage.md
# product: '{% data reusables.gated-features.code-quality-availability %}'

curl -sL https://raw.githubusercontent.com/github/docs/main/data/reusables/gated-features/code-quality-availability.md
# {% ifversion fpt or ghec %}GitHub Team or GitHub Enterprise Cloud{% endif %}
```

So the repo has **no Code quality page in the sidebar at all**, and
`/code-quality/coverage` 404s because the endpoint does not exist for `free`.
Both symptoms are the same fact.

Three things this cost, recorded so it is not repeated:

- **The 404 does not read as a permissions problem,** which is where the first
  attempt went. `contents: read` + `code-quality: write` is genuinely
  sufficient — a maintainer confirms exactly that in
  [actions/upload-code-coverage#16](https://github.com/actions/upload-code-coverage/issues/16).
- **`fail-on-error: false` is not the fix.** It greens the step while no report
  reaches the commit, leaving `code_coverage` silently unevaluated — the gate
  looks present and is not.
- **There is no API to check or set it.** `PATCH /repos/{owner}/{repo}` with
  `security_and_analysis[code_quality][status]=enabled` returns `200` and drops
  the field; `/code-quality/coverage` 404s either way. A green response proves
  nothing here.

**What enforcement actually rests on** is `ci.yml`'s own
`--cov-fail-under=75`, which has been failing the build on a coverage drop the
whole time and does not touch this API. The upload bought *visibility* — a
`github-code-quality[bot]` PR comment with a per-file breakdown — not the gate.
Trading $4/mo for that is not worth it on this project.

**To restore it:** buy GitHub Team, enable Settings → Security → Code quality,
then re-add the step with the `--cov-report=xml:coverage.xml` flag and a
job-scoped `code-quality: write`. The fork guard GitHub's docs call for is
`if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`.

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

Enabling the missing status checks:

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