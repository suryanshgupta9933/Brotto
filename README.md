<div align="center">

# Brotto

**It asks before it does anything you can't undo — and you can see exactly what it did.**

Tell Brotto a task in plain English and it carries that out in the browser tab
you're already signed in to. Your inbox, your bank, your admin panel. Not a
cloud browser you've never logged into, and not a screenshot of a page it can't
read.

[![CI](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml/badge.svg)](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](clients/brotto-extension)

</div>


https://github.com/user-attachments/assets/1f6d0aca-5206-4e68-8f26-72d586323108


---

> **One step too many, and we know it.** The extension is on the Chrome Web
> Store, under review — one click to install as soon as it clears. The agent
> loop runs in a small container you start yourself, and that is the only thing
> standing between someone who does not write code and using Brotto.
> **Removing it is the top priority** — not a someday item. Everything else in
> this README works around that one step; see [Self-host](#self-host) for what
> it takes today.

---

## Why it can be trusted with a logged-in session

An agent holding your cookies can do a lot of damage in one wrong click. Three
things are built around that, and none of them can be switched off.

**It stops and asks before anything irreversible.** Before it sends an email,
takes a payment, deletes something, publishes, or changes a password — and
before it visits a domain for the first time. There is no setting that turns
this off, because an agent you can disable the safety on is an agent you cannot
leave running.

**It writes down what it did.** Every run produces a per-session record: each
observation, prompt, action, approval and timing, in a document on your disk.
That is what lets you read a run back afterwards, resume one that was
interrupted, or delete it outright. It is a record, not a chat transcript.

**It tells you why it couldn't act.** When a button is off-screen, covered by a
cookie banner, or disabled, Brotto says so on the line the model reads — and
records the reason *without a coordinate*, so it never retries the same wrong
click. The alternative is "element no longer available, the page probably
changed," which is not an explanation.

You can also set a ceiling on what a single task is allowed to spend, and Brotto
checks your model key is actually working before a run starts — so an expired
key costs you a sentence rather than a failed task.

---

## Why it's built this way

Two decisions, and everything else follows from them.

**It drives your tab, not a cloud browser.** Most browser agents run somewhere
you have never logged in. A cloud browser has no cookie jar, so every site
starts at the sign-in wall, which is why those products sell credential storage
as a feature — and it has no reputation, so the sites you actually care about
serve it a bot challenge. Brotto works in the session you already have. Your
cookies, your MFA, your SSO: simply there.

**It reads the accessibility tree, not pixels.** Roles, labels, values and stable
references — the structure a screen reader already navigates by. No vision
model, no image tokens. It can tell a button from a heading, and it doesn't
have to guess whether a rectangle is a button.

The agent loop runs in a small container on your machine and the extension is a
pure actuator — handed a target, asked for a box model. Chrome suspends
Manifest V3 service workers when they go idle, so a loop living inside the
extension inherits a lifetime nothing in your task controls. Keeping it in a
process you control means a long run survives, and means the record of it has
somewhere real to land.

---

## What it does

- **Works in your session.** Attach to a tab, give it a task, watch it work, detach. It never asks
  you to log in to anything.
- **Redacts what it reads.** Credentials, API keys, bearer tokens, card numbers and government
  identifiers are stripped from page text before it reaches the model provider — in code, on every
  task, with no setting to disable.
- **Your blocklist is the only blocklist.** Blocked domains and the sensitive-action list are yours.
  No server-side floor, no operator override.
- **Eight providers, bring your own key.** Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek,
  Groq, or any OpenAI-compatible endpoint you run yourself.
- **Resumes an interrupted run.** A stopped task is a state, not a lost conversation — pick it back
  up from the record.

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

**This step is on its way out.** It exists so the agent loop survives Chrome
suspending the extension mid-task, and so each run has a real place to write its
record. A one-command installer is next, and a hosted option after that, at which
point there is nothing left to run yourself. The steps below are the whole of it
until then.

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
- **The panel can outlive the service worker.** Chrome suspends MV3 workers after
  ~30s idle. The agent loop is on your server and survives this; the side panel
  and its badge do not necessarily.

---

## What's next

Ordered by what unblocks the most people, not by what is most interesting.

- **Remove the install step.** A one-command installer for the container, then a
  hosted option. Everything above is one step too many for anyone who doesn't
  write code, and that is the constraint on everything else here.
- **Google Docs and Sheets.** Canvas-rendered surfaces are the one place Brotto is
  blind. Worth checking separately — Docs renders a real DOM and may largely
  already work, while Sheets genuinely draws to canvas.
- **A published benchmark.** The harness runs, but against a scripted planner with
  no model in the loop, so it measures perception and actions and says nothing
  about judgement. Until it scores real runs, any reliability number in this space
  is a guess — including ours.
- **Routines.** Saved, reusable tasks — *every weekday, summarise these* — and
  re-running or resuming from the record.
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
