<div align="center">

# Brotto

**Ask an AI to do a task in the browser you're already signed in to.**

It runs in your own Chrome, on your own tabs, with your own cookies.
You bring the model key. There is no Brotto account, and no Brotto server —
you run the orchestrator yourself.

[![CI](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml/badge.svg)](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](clients/brotto-extension)

<img src="docs/images/panel-task-completion.webp" width="380" alt="Brotto finishing a task in Gmail">

</div>

<!--
  Video: drop the rendered demo at docs/images/brotto-demo.mp4, then replace this
  block with the <video> tag below. The render is `demo/README.md` — four cuts,
  one per claim, all off the same real panel.

  <video src="docs/images/brotto-demo.mp4" width="720" autoplay loop muted playsinline></video>
-->

**A 25-second demo is rendering.** In the meantime: the panel screenshot above
is the real extension on a real Gmail tab, not a mock-up.

---

## Why your own browser

Most browser agents run in **a cloud browser you have never logged into**. So they have to
re-authenticate, they trip bot detection, and — never having been given your session — they read
the page as a **screenshot**.

That combination falls over on exactly the tasks worth automating: your inbox, your bank, your
admin panel. And screenshot vision burns context per pixel while still having to guess that a
rectangle is a button.

Brotto takes the opposite two bets.

**It drives your tab.** A Chrome extension attaches to the tab you name. Your cookies, your MFA,
your SSO — because it is your browser. There is nothing to log in to.

**It reads the accessibility tree, not pixels.** Roles, labels, values and stable references — the
same structure a screen reader already navigates by. No vision model, no image tokens, cheaper and
faster, and it works on the information the web already publishes.

---

## What it does

- **Works in your session.** Attach to a tab, give it a task, watch it work, detach. It never asks
  you to log in to anything.
- **Asks before the risky parts.** An approval card before it sends an email, takes a payment,
  deletes something, publishes, or changes a password — and before it acts on a site for the first
  time. There is no setting that turns this off.
- **Your blocklist is the only blocklist.** Blocked domains and the sensitive-action list are yours.
  No server-side floor, no operator override.
- **Redacts what it reads.** Credentials, API keys, bearer tokens, card numbers and government
  identifiers are stripped from page text before it reaches the model provider — in code, on every
  task, with no setting to disable.
- **Eight providers, bring your own key.** Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek,
  Groq, or any OpenAI-compatible endpoint you run yourself.
- **Knows your key is broken before it wastes a run.** One real request to your provider before a
  task starts, so an expired key is a sentence rather than a failed run.
- **Keeps a full audit trail.** Every run writes a per-session record — each observation, prompt,
  action, approval and timing. It is what makes a conversation resumable and inspectable rather
  than a black box.

---

## Screens

<div align="center">
<table>
<tr>
<td width="33%"><img src="docs/images/panel-idle.webp" alt="The Brotto panel, idle, with suggestions"><br><sub><b>Idle.</b> The panel offers what the page in front of you could be asked to do.</sub></td>
<td width="33%"><img src="docs/images/panel-task-completion.webp" alt="Brotto summarising a Gmail inbox tab"><br><sub><b>Working.</b> A real run over a real inbox, with a plan and the result.</sub></td>
<td width="33%"><img src="docs/images/panel-session-history.webp" alt="The session history list"><br><sub><b>History.</b> Every run, on your own disk, yours to delete.</sub></td>
</tr>
</table>
</div>

---

## Why not the alternatives

**Browser Use, Skyvern, Nanobrowser** — all three run in a cloud browser you
have never logged into. That is the whole difference. A cloud browser has no
cookie jar, so every site starts at the sign-in wall, which is why they sell
credential storage as a feature. It has no reputation, so the sites you actually
care about serve it a bot challenge. And on the reading side, most of them
started from screenshots and added the accessibility tree afterwards — the
parts that are hard to retrofit.

**Claude in Chrome / Operator / ChatGPT Agent** — genuinely good, and the right
first thing to try. What Brotto is for is the case where the answer has to run
against *your* accounts with *your* key, stay on your disk, and be yours to
delete, rather than being a product someone else runs. The blocklist is the
tell: Brotto has no server-side policy floor, because there is no server.

**Playwright / Puppeteer scripts** — better, if the task is fixed. Brotto is
for the task you can describe in a sentence and cannot script, which is the
majority of what anyone actually wants automated.

---

## Self-host

Brotto is one container and one Chrome extension. The container holds the agent loop; it never
launches a browser.

```bash
git clone https://github.com/suryanshgupta9933/brotto.git
cd brotto

cp .env.example .env      # set AGENT_SECRET to any long random string
docker compose up -d
```

That is a ~510 MB image with **no browser in it**, listening on `:8000` — most of the weight is the
model provider SDKs, not Chromium. Everything it keeps (session history, your blocklist, your
remembered model) lands in one Docker volume on your disk. It is your data, not a cache.

Then build and load the extension:

```bash
cd clients/brotto-extension
npm ci && npm run build
```

In Chrome: open `chrome://extensions`, turn on **Developer mode**, and **Load unpacked** →
`clients/brotto-extension/dist`.

Open the Brotto side panel, set the server address to `http://127.0.0.1:8000`, and paste
`AGENT_SECRET` into **Settings → Connection**. Then pick a provider and paste your key under
**Settings → Model**. The key is held in memory for the run and never written to disk.

<details>
<summary>Running it from source instead</summary>

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
PYTHONPATH=services/brotto-orchestrator/src \
  .venv/bin/python -m brotto_orchestrator.cli --port 8000
```

Playwright is a test-only dependency and is not needed to run the server.

</details>

**Serving it to anyone but yourself?** Put Caddy or nginx in front for TLS — the extension needs a
`wss://` URL. `docker-compose.yml` binds to `127.0.0.1` for exactly this reason, and the secret is
required before you widen it. `docs/architecture/deployment.md` covers sizing, TLS, retention and
migrating from `python main.py`.

---

## Where your data goes

- **The browser runs on your machine.** The agent loop runs on a server *you* run, so page
  observations transit it — that is inherent to the design. What you choose is that there is no
  operator between the agent and your documents, because there is no operator.
- **Page text is redacted before it leaves**, and a run leaves a 200-character digest of each page
  on disk rather than a copy of the page. The text you type and the model's own prose about the
  page do persist in the audit record — [Privacy](#privacy) says so plainly.
- **Your model key is never written to disk**, by Brotto, anywhere.
- **Deletion is yours.** Every session has a delete button with a confirmation, and
  `DELETE /v1/sessions` takes the lot.

The rest of this section is the long version: [Privacy](#privacy), [Security](#security) and
[Contributing](#contributing).

### Privacy

**Effective date:** 2026-10-03

Brotto has a single purpose:

> **Let you ask an AI to perform tasks in your own logged-in browser.**

Everything below describes what that purpose requires and nothing more. This
policy explains what Brotto does with data.

Brotto has one deployment. **You run the orchestrator.** It is open-source
software you install on your own machine or your own server, and the extension
talks to whatever address you type into its settings. There is no
Brotto-operated service, we run no servers, and "the server" below means the
machine you chose to run it on.

That is the whole privacy story, and it is worth being precise about it:
whoever operates the machine the orchestrator runs on can read the pages the
agent reads. There is no operator between the agent and your documents in this
product, because there is no operator at all. It is a property of the
deployment, not a promise from us.

If you would rather not trust anyone with that — including yourself in six
months — do not have an agent work on pages you would not paste into a chat
window.

#### Summary

Brotto is built so that we collect as little as possible. There is no
analytics, no telemetry, no advertising, no tracking across sites, and we do not
sell or share data with anyone for marketing. We do not operate the server, so we
do not receive your data. The data that moves during a task is the data the task
inherently requires: what the page looks like to a computer, and the model
provider you chose.

**The extension makes no outbound requests of its own.** Its interface fonts are
bundled with it, so opening the side panel contacts nothing. The only network
traffic the extension starts is to the server address you configured, and from
there to the model provider you configured.

**Your model API key is never written to disk by Brotto.** It is held in memory
and used to call your model provider.

#### What the extension stores on your device

| Data | Where | Lifetime |
|---|---|---|
| Model configuration (provider, model name, context window) | `chrome.storage.local` | Until you clear it |
| **Your model API key** | `chrome.storage.session` | **Memory only.** Cleared when the browser closes. Never written to disk by the extension. |
| **Your server secret** (`AGENT_SECRET`) | `chrome.storage.local` | Until you clear it. It authorizes reading every transcript on your server, so treat it like a password. |
| An install id — a random identifier generated once, with no relationship to you, your machine, or your network | `chrome.storage.local` | Until you clear it |
| Your policy (blocked domains, sensitive-action list) | `chrome.storage.local` | Until you clear it |
| Session ID for the conversation | `chrome.storage.session` | Until the browser closes |
| The address of the server you are connected to | `chrome.storage.local` | Kept until you change it |
| The last page URL the agent saw | `chrome.storage.session` | Cleared when the browser closes |
| A running transcript of the current task — your messages, the cards Brotto is showing you | `chrome.storage.session` | Cleared when the browser closes |

Because the key lives in `chrome.storage.session`, it is not written to disk by
Chrome and is gone when the browser exits. You will be asked for it again next
session.

The server address and the last page URL are the two rows worth a second look:
both name a page you were on, and the server address names the machine that ran
your agent.

#### What leaves your device during a task

When you start a task, the extension sends to the orchestrator:

1. **Your model API key and model configuration.** The orchestrator needs the key
   to call your model provider. It holds it in memory for the duration of the
   task.
2. **The page you are looking at**, as the machine sees it: the page URL, the
   page title, the accessibility tree of interactive elements (role, accessible
   name, value, and a stable reference for each), and visible page text when the
   task calls for it.

**Page text is redacted before it is sent.** Before any page text reaches the
model, the orchestrator removes credentials, API keys, bearer tokens, payment
card numbers and government identifiers, replacing each with `[redacted]`. This
happens in code, on your machine, on every task, with no setting to turn it off —
and on the suggestions path too, which reads a page with no task running and is
the easiest place for this to be forgotten. It is pattern matching, not a
guarantee: it will miss an unfamiliar identifier format, and it will occasionally
redact an innocuous number that happens to pass a checksum. The agent is told
the redaction already happened and is instructed not to try to reconstruct a
redacted value.

The orchestrator then sends **the page observations to the model provider you
selected**. Brotto ships with Anthropic, OpenAI, MiniMax, Gemini, OpenRouter,
DeepSeek and Groq, and can be pointed at a compatible endpoint of your own.
This is the core of what a browser agent does: the model has to see the page in
order to act on it. Which provider receives it is entirely your choice, and that
choice determines which company's privacy policy governs that data. If you point
Brotto at your own endpoint, that data goes to your own machine and no model
company sees it at all.

**None of this reaches us.** The orchestrator is software on your machine, so
both the key and the page observations go from your browser to your machine and
on to your model provider. The observations do not stop at the model call,
though: the server saves the URL, the page title, and a short digest of each
page to a file on its own disk, and that file is still there after the task ends.
The next section says exactly what is in it.

#### What the orchestrator writes to disk

| File | Contents |
|---|---|
| `logs/sessions/<session_id>.json` | The audit record of your conversation: your messages, the page URL and title at each step, the prompts, the actions taken, approvals, timing, and errors. It also holds the text you **typed** into a field, and the model's own written reasoning about what it saw. For the page itself it keeps counts and a summary of what changed — not the whole tree. |
| `logs/sessions/<session_id>.scratchpad.txt` | The agent's working memory: a short digest of each captured page and its URL. |
| `logs/user_models/<install-id>.json` | Your model configuration: provider, model name, context window, and the address of your provider's API if you set a custom one. **Not your key.** If that address is on your own network, it is written to disk in the clear. |
| `logs/user_policies/<hash>.json` | Your blocked-domains list; the sites you have approved Brotto to work on; and when you last saved it. |

**The page itself is never written to disk — but the record of it is not empty.**
Each step's page is recorded as a 200-character digest, so a run over an
authenticated session leaves a record of *what* was visited and not copies of
*what was on it*. Two things about that step survive on disk in full: **the
text you typed** (only fields that look like credential fields are masked), and
**the model's own prose about the page**, which is its paraphrase rather than a
copy. A run over your mail or your documents therefore leaves readable traces of
both. A run resumed later recalls those digests rather than whole pages — that
is the trade for keeping your pages off the filesystem, and it is not
configurable.

Values typed into a field the orchestrator identifies as a secret — anything
with `type="password"`, or a field whose name reads like a credential, a token,
or a code — are **redacted before the record is written**, so a password you type
is not stored in the audit file.

That redaction applies to what the agent *types*, and the page text that reaches
the model provider is redacted separately. What is kept on disk is narrower than
either: a 200-character digest of each page. A page that displays a token, an
account number, or an email address may still put a fragment of it in that
digest. If that matters for a site you use, the safest thing is to not have the
agent work on that site.

The files are named after the install that created them, so that separate users
on one server do not share settings. That name is the random install id the
extension generated on your machine — not your name, not your IP address, and
not your network. The model-configuration file is named with the install id in
plain text; the policy file is named with a scrambled version of it. It is not
used for advertising or analytics — the machine holding them is yours, and
nothing is sent anywhere with it.

**The approved-sites list is a record of where you have let Brotto work.** When
you approve a site in an approval card, its domain is added to your policy file
and stays there until you clear it, so you are not asked about that site again.
That means the server holds a list of the domains you have given an agent access
to. Nothing else about those sites is kept — no URLs, no page content, no dates
of use — and the list is yours to remove: delete the policy file, or the approved
list inside it, and every site goes back to asking. Blocking a domain is separate
from approving it, and blocking one always wins.

One caveat worth knowing rather than guessing at: the server also accepts an
identifier a client can supply in place of that install id, and it will use that
instead. The Brotto extension supplies its own install id, so that is what is
used. A client that sends something else — or nothing at all — falls back to the
connection's address. It is mentioned here because it is a real property of the
software, not because you should expect to meet it.

#### Suggestions on an idle page (optional)

If you leave the side panel open on a page with no task running, Brotto can read
that page's **visible text**, URL, and title and send them to suggest something
you might want to do. That request goes to the orchestrator and on to your model
provider, so the same page text leaves your machine here as it would during a
task. No action is taken on the page, and no file is written for it — the
suggestion is held in the panel's memory, which is discarded when the browser
closes.

This reads a page you are looking at without a task in flight. **It is off
unless you turn it on**, and we are calling it out here rather than relying on
you noticing a change. If you would rather it did not exist, do not enable it.

Two things narrow what it will read. Pages whose address looks like a login,
checkout, payment or account settings screen are skipped before the read, and a
page carrying a password, card or one-time-code field is skipped even when its
address looks ordinary. The panel shows a **"Reading page"** badge for exactly as
long as a read is in progress, so the read is visible while it happens.

Suggestions made from a page you read are labelled **"Read from the text of this
page."** underneath, and suggestions Brotto made from a page's address and title
alone are not. The label is part of the suggestion, so it comes back with it
after you reopen the panel.

#### Third parties

The only third party that receives your page data is **the model provider you
selected**. Brotto does not share data with analytics providers, advertising
networks, data brokers, or social platforms.

The model providers we support — Anthropic, OpenAI, MiniMax, Gemini, OpenRouter,
DeepSeek and Groq — each have their own privacy policy and terms governing what
they receive and how long they keep it. Those terms are between you and them,
and we do not control them. Your orchestrator is also a party to this data, in
the sense that it holds the page observations in memory while it waits for the
model to answer.

#### Retention and deletion

Nothing expires on a timer unless you ask it to. **Deletion is entirely yours**,
and it is immediate:

- **Session records** — the audit file and the scratchpad, described above — are
  written to disk and stay there until you remove them. Nothing expires on a
  schedule unless you ask for it: the server has a `BROTTO_RETENTION_DAYS` setting
  that will age sessions out, and it is **off by default**.
  - **In the panel:** each conversation in **Session history** has a delete
    button, and there is a **Delete all** above the list. Both ask you to confirm
    first — the question names the conversation by its own first message, or
    names how many are about to go. There is no undo.
  - **On the server:** `curl -X DELETE -H "Authorization: Bearer $AGENT_SECRET" \
    http://localhost:8000/v1/sessions/<id>` removes one; `DELETE /v1/sessions`
    removes every one. The files live in `logs/sessions/`, so removing them by
    hand works exactly the same way.
- **Local extension data** is removed by clearing the extension's storage, or by
  uninstalling it.
- **Deleting sessions does not delete your settings.** `DELETE /v1/sessions` and
  the panel's **Delete all** cover the session records only. Your blocked-domains
  list and your **approved-sites list** (`logs/user_policies/`) and your model
  configuration (`logs/user_models/`) are separate files, keyed by your install
  id, and survive. If you want the approved-sites list gone — which is the one
  that records which domains you have let an agent work on — delete that file by
  hand, or clear the approved list inside the panel's policy screen.
- **Your API key** is not retained by Brotto anywhere. It is held in the
  orchestrator's memory for the duration of a task and not written to disk.

#### Children

Brotto is not directed at children under 13.

#### Changes to this policy

Material changes will be noted in the repository's commit history and dated at
the top of this section.

#### Contact

Questions about this policy: open an issue in the repository.

### Security

#### Reporting a vulnerability

Email the maintainer, or open a **private** security advisory on the repository
("Security" → "Report a vulnerability"). Please do not open a public issue for
an unfixed vulnerability.

Include: what you did, what you expected, what happened, the affected version,
and your Chrome version if the issue involves the extension. A proof of concept
helps a great deal.

You can expect an acknowledgement within 72 hours and a substantive reply within
seven days. If a fix is warranted we will agree a disclosure date with you, and
credit you in the release notes unless you would rather we did not.

#### Threat model

Brotto is unusual in a way that changes what "safe" means, so it is worth being
explicit.

**Brotto is not a sandbox.** The agent operates with the full authority of the
session you run it in. A malicious page, a prompt injection in page content, or
a bug in Brotto can all cause actions to be taken as you. Treat a Brotto run
the way you would treat handing your logged-in browser to a contractor.

What Brotto does provide:

- **Secure mode gates** — approval cards before a configurable list of sensitive
  actions (send email, payment, delete, publish, change password, revoke access,
  and similar), before the first action on a given domain, and on patterns marked
  critical.
- **Your domain blocklist, and only yours.** There is no server-side floor
  policy, by design.
- **Prompt-injection defence** — the system prompt establishes a trust hierarchy
  (system > user task > page content) and instructs the model to treat page
  content as data.
- **Secret redaction** — values typed into fields identified as credentials are
  redacted before the audit record is written.
- **No remote code execution.** The extension never `eval`s, never fetches a
  script, and dispatches only a fixed set of typed actions. See
  [`clients/brotto-extension/README.md`](clients/brotto-extension/README.md#what-this-extension-does-not-do).

What Brotto does **not** provide, and you should not assume:

- **Authentication is on only if you set a secret.** The orchestrator requires
  `AGENT_SECRET` on every route the extension calls, including the WebSocket.
  With no secret set it logs a warning and serves **open** — anyone who can
  reach it can drive a browser. Do not expose an unconfigured server to a
  network you do not control.
- No isolation between concurrent users. Identity is a random per-install id the
  extension generates on your machine. It is not a real user account, and it is
  not a credential.
- No protection against a hostile page. Secure mode reduces the blast radius; it
  does not eliminate it.

The extension communicates with the orchestrator over WebSocket, and with your
model provider over that provider's HTTPS API. It requests `chrome.debugger` to
read the accessibility tree and dispatch input, and `<all_urls>` host access so
it can work on the site you name; both are exercised only during a task you
started.

**The endpoints are authenticated, and the bind address is the other half of
that.** The server requires an `AGENT_SECRET` you set yourself, and the
extension sends it as a WebSocket subprotocol rather than in the URL — a
`?token=` would write your secret in plain text into the access log of your
server and of any proxy in front of it. With the secret unset, every caller is
treated as trusted and the server says so in its startup log, so if you expose
the port to a network, set the secret first. The default `docker compose` binds
to `127.0.0.1` for exactly this reason.

One endpoint is deliberately left open, and it is not a session one: `POST /run`
launches a headless browser with no authentication. Do not put it on a public
interface. `/health` is also unauthenticated because the container's own
healthcheck needs it; it reports that the service is up and which model is
resolved, and nothing else.

No system is perfect. A browser agent operating with your session has the same
access you do, and a compromise of the extension or the server would have the
same effect. Do not use it on accounts where that risk is unacceptable.

#### Out of scope

- Model behaviour (the agent making a poor decision is not a Brotto
  vulnerability, though a *disclosure bypass* — an action taken without a
  required approval — is)
- Denial of service by a page or a model
- Findings that require an attacker to already control your machine or your
  orchestrator
- Missing hardening with no demonstrated impact

### Contributing

#### Workflow

1. Branch off `main`.
2. Push commits to your branch.
3. Open a PR targeting `main`.
4. Wait for the **`CI`** check (aggregator of orchestrator tests + extension
   build) to go green.
5. Wait for a reviewer assigned by `.github/CODEOWNERS` to approve.
6. Squash-merge once both are green.

Direct pushes to `main` are blocked by branch protection — see below.

#### Local checks before pushing

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

#### Commit conventions

- No AI-tool trailers in commit messages. That means no `Co-Authored-By: …` from
  any AI assistant, no "Generated with [tool]" footers, no body text naming an AI
  assistant, vendor, or `noreply@…` address. Commit authors appear as humans
  only.
- If a template or tool auto-injects such a trailer, strip it before
  `git commit` runs. Applies to every commit on every branch in this repo,
  including past history.
- `git filter-repo` has been used historically to clean up slips.

#### Repository hygiene — model neutrality

The agent layer is model-agnostic (D6); the public source must match.

- No file in this repository may name a specific AI model identifier — not in
  source, tests, CI, docs, examples, READMEs, or decision records.
- Source defaults come from env (`AGENT_MODEL`); never hardcode a specific model
  id as a fallback. Raise on missing env rather than naming one.
- Tests must not pass model-id literal strings; parametrize from a fixture or
  assert against the env value.
- CI matrices source model lists from secrets or workflow-level env, not the
  committed YAML.
- Documentation, competitive analysis, and benchmark READMEs may discuss models
  in general terms ("frontier vs mid-tier latency", "the default agent model")
  but must not name specific ids.
- Applies retroactively: when a leak is found in existing code or docs, flag it
  and scrub it; don't leave it because it pre-dates the rule.
- To rotate or add models, change env / secrets — not source.

#### Branch protection setup (one-time, repo admin)

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

#### Adjusting CODEOWNERS

`.github/CODEOWNERS` points at `@suryanshgupta9933`. Before you rely on
auto-assignment, confirm that handle is still correct — a missing owner silently
turns it off rather than failing loudly.

---

## Honest limitations

This is a working system, not a finished product.

- **Chrome only.** `chrome.debugger` has no Firefox equivalent.
- **Perception is partial.** No shadow-DOM traversal beyond a geometry fallback, nothing rendered
  into a canvas, and an out-of-process iframe is invisible.
- **No published benchmark yet.** The harness is being built — see [In progress](#in-progress). Until
  it reports, any reliability number you see anywhere is a guess, including ours.
- **Long tasks can outlive the service worker.** Chrome suspends MV3 workers after ~30s idle.

---

## In progress

- **A benchmark harness** — a fixed task set, a scoring rule that tells a *refusal* apart from a
  *failure to decide*, and unattended runs scored from the audit record each run already writes
  (outcome, step count, failure reason, cost, latency). This is what turns "it works" into a number
  you can hold it to.

---

## What's next

- **Chrome Web Store listing.** The extension is loadable unpacked and the manifest and welcome page
  are in shape; what is missing is a review-ready package — icons at the required sizes, screenshots,
  and a category. The review is the gate, not the build.
- **The `action_args` schema.** The agent's actions take a bare object, so the output tool's JSON
  schema tells the model nothing about any action's argument names. Every argument is a guess from the
  prompt prose, and the guesses are inconsistent. Typing it as a union is a real fix, not a patch.
- **A second look at idle-page suggestions.** Now that page suggestions are off by default and say
  so, the open question is whether the sentences are any good — three earlier prompt revisions looked
  fine in a diff and were only caught by reading what the model actually wrote.

[ROADMAP.md](ROADMAP.md) is the full version: what is being built, what is deliberately not, and
why.

---

## Pro

The features below are paid, and the free build you get from this repository has the code for them
and no way in — one flag, `BROTTO_PRO`, decides all of it at once.

- **Per-run cost, priced for the model you actually ran on.** Steps are priced from the catalogue
  after every call, and the total lands in the audit record next to the run it belongs to. A run
  whose model has no published rate shows nothing rather than a confident wrong number.
- **A ceiling on what one task may spend.** `BROTTO_MAX_TASK_COST_USD=0.50` ends a run at a step
  boundary once it crosses, after the step is recorded and before its actions fire, and names both
  amounts in the summary.

For everyone else, your key is your money and Brotto does not look at it. That is the free version's
position, not an omission from it.

---

## How it works, if you want the detail

A Chrome extension attaches to your tab and streams the page's accessibility tree over a WebSocket
to a Python agent loop, which asks a model for a decision and executes it. The loop is stateless per
step; the audit record and a per-session scratchpad *are* the memory, which is what makes a run
resumable rather than guessable.

[`docs/architecture/`](docs/architecture/README.md) is the real documentation — one file per
subsystem, each carrying the reasoning behind the design and what was tried before it.
[`agent-loop.md`](docs/architecture/agent-loop.md) and
[`conversation.md`](docs/architecture/conversation.md) are the two worth starting with.

---

<div align="center">

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

</div>
