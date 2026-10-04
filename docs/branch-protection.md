# Branch protection setup (one-time, repo admin)

Repo administration, not contributing. Kept out of `CONTRIBUTING.md` because it
is done once by whoever owns the repository, not by anyone opening a pull
request.

The CI workflow in `.github/workflows/ci.yml` provides a single required check
named **`CI`** (an aggregator job that fails if either `Orchestrator tests` or
`Extension build` fails). Branch protection must require it.

Configure once via **GitHub → Settings → Branches → Add rule**:

| Setting | Value |
|---|---|
| Branch name pattern | `main` |
| Require a pull request before merging | ✓ |
| Require approvals | ✓ (1 minimum) |
| Dismiss stale pull request approvals when new commits are pushed | ✓ |
| Require review from Code Owners | ✓ |
| Require status checks to pass before merging | ✓ |
| Status checks that must pass | `CI` |
| Require linear history | ✓ |
| Do not allow force pushes | ✓ |
| Do not allow deletions | ✓ |
| Do not allow bypass for repository administrators | ✓ (recommended) |

<details>
<summary>The same rule as a single CLI call</summary>

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/suryanshgupta9933/brotto/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismissal_restrictions": {},
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON
```

After this runs, `main` is merge-locked: PRs need green CI plus a CODEOWNERS
approval, and no one — admins included — can push directly.

</details>

## Adjusting CODEOWNERS

`.github/CODEOWNERS` points at `@suryanshgupta9933`. Before you rely on
auto-assignment, confirm that handle is still correct — a missing owner silently
turns it off rather than failing loudly.
