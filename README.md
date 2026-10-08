<div align="center">

# Brotto

**Ask an AI to do a task in the browser you're already signed in to.**

It runs in your own Chrome, on your own tabs, with your own cookies.
You bring the model key. There is no Brotto account, and no Brotto server —
you run the orchestrator yourself.

[![CI](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml/badge.svg)](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](clients/brotto-extension)

</div>


https://github.com/user-attachments/assets/1f6d0aca-5206-4e68-8f26-72d586323108


---

## Why your own browser

Most browser agents run in **a cloud browser you have never logged into**, so they re-authenticate,
they trip bot detection, and they read the page as a **screenshot**. That falls over on exactly the
tasks worth automating — your inbox, your bank, your admin panel — and screenshot vision burns
context per pixel while still guessing that a rectangle is a button.

Brotto takes the opposite two bets. **It drives your tab**, so your cookies, MFA and SSO are simply
there. And **it reads the accessibility tree, not pixels** — roles, labels, values and stable
references, the structure a screen reader already navigates by. No vision model, no image tokens.

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
<td width="33%"><img src="docs/images/panel-idle.webp" alt="The Brotto panel, idle, with suggestions" width="100%"><br><sub><b>Idle.</b> The panel offers what the page in front of you could be asked to do.</sub></td>
<td width="33%"><img src="docs/images/panel-session-history.webp" alt="The session history list" width="100%"><br><sub><b>History.</b> Every run, on your own disk, yours to delete.</sub></td>
<td width="33%"><img src="docs/images/panel-settings.webp" alt="Brotto's settings: bring your own model key, and the sites it refuses" width="100%"><br><sub><b>Yours.</b> Your model key, your server, and the list of sites Brotto refuses outright.</sub></td>
</tr>
</table>
</div>

---

## One run, start to finish

One task, four moments: Brotto adding a branch protection ruleset to this
repository. Every shot below is the real extension, in a real browser, on a
public repo — nothing staged, nothing mocked.

**1 · You ask for it in a sentence.**
There is no form and no workflow to learn. The panel is a chat box, and
whatever you can describe is the whole interface.

<img src="docs/images/run-1-the-prompt.webp" alt="Brotto's panel with the task typed out: go to GitHub, find the Brotto repository, add a branch protection ruleset to main, and open a pull request for it" width="100%">

**2 · It asks before it leaves.**
GitHub is the first domain this run touches, so it stops and waits. A domain
you approve is remembered for good — consent is for the site, not for the one
verb — and a page Brotto has never seen cannot be pre-approved by anything but
you.

<img src="docs/images/run-2-before-it-navigates.webp" alt="Brotto's panel showing a first-navigation approval card for github.com, with ALLOW and DENY buttons" width="100%">

**3 · It stops again when the page offers a choice.**
GitHub has two ways to add branch protection, and picking wrong means clicking
back through settings. Rather than guess, it hands you the question and waits.
This is the same card you would get for a sign-in it cannot pass.

<img src="docs/images/run-3-it-asks-when-unsure.webp" alt="Brotto's panel stopping to clarify that the repository has two ways to add branch protection, with Skip and Say options" width="100%">

**4 · The run finishes, and the whole thing is on your disk.**
The panel reports what it did and what it would do next. Nothing is sent here:
the ruleset was written on github.com by your own session, and the transcript
lands in `logs/sessions/` beside the rest of your files.

<img src="docs/images/run-4-the-ruleset-it-wrote.webp" alt="Brotto reporting DONE: it created a classic branch protection ruleset on the main branch of the Brotto repository, with targets, enforcement status, required checks and force-push settings" width="100%">

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

## Where your data goes

- **The browser runs on your machine.** The agent loop runs on a server *you* run, so page
  observations transit it — that is inherent to the design. What you choose is that there is no
  operator between the agent and your documents, because there is no operator.
- **Page text is redacted before it leaves**, and a run leaves a 200-character digest of each page
  on disk rather than a copy of the page. The text you type and the model's own prose about the
  page do persist in the audit record — [Privacy](PRIVACY.md) says so plainly.
- **Your model key is never written to disk**, by Brotto, anywhere.
- **Deletion is yours.** Every session has a delete button with a confirmation, and
  `DELETE /v1/sessions` takes the lot.

**The long versions are separate documents, and putting detail there is the
right call rather than a sign this README is hiding something:**

- [Privacy](PRIVACY.md) — what is stored, what transits, what reaches disk, and
  what an idle-page suggestion reads
- [Security](SECURITY.md) — disclosure address, threat model, and what is
  explicitly out of scope
- [Contributing](CONTRIBUTING.md) — how to run the tests and what a commit looks
  like here


## Honest limitations

This is a working system, not a finished product.

- **Chrome only.** `chrome.debugger` has no Firefox equivalent.
- **Perception is partial.** No shadow-DOM traversal beyond a geometry fallback, nothing rendered
  into a canvas, and an out-of-process iframe is invisible.
- **No published benchmark yet.** The harness runs, but against a scripted planner — it measures
  perception and actions with no model in the loop. Until it scores real runs, any reliability number
  you see anywhere is a guess, including ours.
- **Long tasks can outlive the service worker.** Chrome suspends MV3 workers after ~30s idle.

---

## What's next

- **Chrome Web Store listing.** The manifest and welcome page are in shape and the build rasterises
  the icon at every size the store asks for. What is missing is a review-ready package — a bumped
  version, store-sized screenshots, a category — and then the review clock, which is a week or two
  with these permissions. The gate is the review, not the build.
- **The `action_args` schema.** The agent's actions take a bare object, so the output tool's JSON
  schema tells the model nothing about any action's argument names. Every argument is a guess from the
  prompt prose, and the guesses are inconsistent. Typing it as a union is a real fix, not a patch.
- **A second look at idle-page suggestions.** Now that page suggestions are off by default and say
  so, the open question is whether the sentences are any good — three earlier prompt revisions looked
  fine in a diff and were only caught by reading what the model actually wrote.

[ROADMAP.md](ROADMAP.md) is the full version: what is being built, what is deliberately not, and
why.

---

## Pro (planned, not released)

**There is no Pro to buy today.** Nothing in this section is available, and the free build you get
from this repository is the whole product as it stands. It is written down so the direction is
visible, not so you can go looking for a button. Brotto stays Apache 2.0 and open — Pro is what
gets built on top of it.

**Planned, and not built:**

- **Multi-tab parallelism.** Brotto works one tab at a time today. Pro is several tasks running at
  once across tabs.
- **A speed pack.** Fewer seconds per step on the same model — larger observation budgets, prompt
  caching that actually engages, and cheaper models routed well. It pays for itself out of your
  own token bill, so it costs you nothing extra to have.
- **Routines.** Save a task as a named recipe and run it again later. Local to your machine; syncing
  a routine to a second device is a separate thing that needs an operator, and there is no operator.
- **Per-run cost, and a ceiling on what one task may spend.** Steps priced from the catalogue after
  every call, and a limit that ends a run at a step boundary once it crosses — after the step is
  recorded, before its actions fire, with both amounts named in the summary.

Two things this will never be, whatever it becomes: **Brotto does not keep your documents**, on any
tier, and **Brotto does not mark up your tokens** — there is no margin, no credit balance and
nothing to top up. Your key, your money, and the free version's position is that we do not look at
it.

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
