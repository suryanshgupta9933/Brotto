# Brotto

**Ask an AI to do a task in the browser you are already signed in to.**

It runs in your own Chrome, on your own tabs, with your own cookies. You bring the model key.

[![CI](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml/badge.svg)](https://github.com/suryanshgupta9933/brotto/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](clients/brotto-extension)
[![Python](https://img.shields.io/badge/python-3.12-3776AB.svg)](pyproject.toml)

<!--
  DEMO SLOT — 45-60s, real run, no staging: a logged-in site showing the agent
  reading a page, acting, and finishing. Drop the GIF at docs/brotto-demo.gif
  and uncomment the line above. It is the single highest-value asset missing.
-->

---

## The problem with browser agents

Almost every browser agent runs in **a cloud browser you have never logged into**. So it has to
re-authenticate, trips bot detection, and — because it was never given your session — it reads the
page as a **screenshot**.

That combination fails on exactly the tasks people actually want:

| | Cloud browser | Screenshot vision |
|---|---|---|
| Your inbox, your bank, your admin panel | Re-logs in, hits 2FA, often fails | — |
| Reading the page | A picture of text | Tokens burned per pixel |
| Which element is a button? | Inferred from pixels | Guessed at coordinates |
| A long run | Context fills with images | Context fills with images |

Brotto takes the other two decisions instead:

**It runs in your tab.** A Chrome extension attaches to the tab you name. Your cookies, your MFA,
your SSO — because it is your browser. There is nothing to log in to.

**It reads the accessibility tree, not pixels.** `Accessibility.getFullAXTree` returns roles, labels,
values and stable references — the same structure a screen reader already navigates by. No vision
model, no screenshot tokens, cheaper and faster, and it works on the accessibility information the web
already publishes.

The result is a different class of agent: one that can do the boring repetitive chore on a site behind
a login, which is the case screenshot-driven approaches fall over on three steps in.

---

## What it does

- **Runs in your session.** Attach to a tab, give it a task, watch it work, detach. It never asks you
  to log in to anything.
- **Fourteen actions, eleven of which touch the page.** `navigate`, `click`, `type_text`, `press_key`,
  `scroll`, `find_element`, `read_page_text`, and four `recall_*` actions for pulling back earlier
  pages, steps and conversation it has already navigated away from. The other three — `ask_human`,
  `task_complete`, `cannot_complete` — end the run.
- **Asks before the risky parts.** An approval card before it sends an email, takes a payment, deletes
  something, publishes, deploys, or changes a password — and before it acts on a site for the first
  time. There is no setting that turns this off.
- **Your blocklist is the only blocklist.** Blocked domains and the sensitive-action list are yours.
  There is no server-side floor and no operator override.
- **Eight model providers.** Anthropic, OpenAI, MiniMax, Gemini, OpenRouter, DeepSeek, Groq — or any
  OpenAI-compatible endpoint you run yourself. The catalogue is one file.
- **Knows your key is broken before it wastes a run.** Before a task starts, Brotto makes one real
  request to your provider and tells you if the key is expired or the balance is empty. A failed
  *check* is reported as such, never as a bad model.
- **Redacts what it reads.** Credentials, API keys, bearer tokens, card numbers and government
  identifiers are stripped from page text before it reaches the model provider — in code, on every
  task, with no setting to disable.
- **Keeps a full audit trail.** Every run writes a per-session record: each observation, prompt,
  action, approval and timing. That record is what makes a conversation resumable and inspectable
  rather than a black box.

---

## Quickstart

Two processes: the **orchestrator** (Python) holds the agent loop, and the **extension** (Chrome)
drives your browser. There is no model API key to configure on the server — you enter yours in the
extension, and it never touches the server's disk.

### 1. Run the orchestrator

```bash
git clone https://github.com/suryanshgupta9933/brotto.git
cd brotto

cp .env.example .env        # then set AGENT_SECRET to any long random string
docker compose up -d
```

Or from source:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
PYTHONPATH=services/brotto-orchestrator/src \
  .venv/bin/python -m brotto_orchestrator.cli --port 8000
```

It listens on `:8000`. Check it:

```bash
curl localhost:8000/health
```

> **Serving it to anyone but yourself?** The WebSocket the extension connects to has **no
> authentication** — see [Limitations](#limitations). Bind to loopback, or put a reverse proxy in
> front of it. `docker-compose.yml` already binds to `127.0.0.1` for this reason.

### 2. Install the extension

```bash
cd clients/brotto-extension
npm ci && npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select `clients/brotto-extension/dist`

### 3. Give it a task

Click the Brotto icon to open the side panel. Set the server address to `ws://localhost:8000`, open
**Settings → Model** to pick a provider and paste your key, then type what you want done.

> The extension is not yet on the Chrome Web Store, so it has to be loaded unpacked.

---

## How it works

```
   Chrome tab                     Orchestrator (Python)
  ┌────────────────┐             ┌──────────────────────────┐
  │  the page      │  AX tree    │  harness: observe →      │
  │  you are on    │ ──────────► │           plan → act     │
  │                │             │            │             │
  │  extension     │ ◄────────── │            ▼             │
  │  (background)  │  action     │  model provider (BYOK)   │
  └────────────────┘             └──────────────────────────┘
```

One step is: read the page's accessibility tree, filter it to what fits the context budget, build a
prompt from the tree plus the run's own history, ask the model for a decision, execute the actions,
write the audit record, repeat.

Two details that are not obvious and matter more than the rest:

- **The observation is the union of every frame's tree, not just the top one.** A `nodeId` is only
  unique within its own frame, so references are composite (`<frame>:<node>`), and cross-origin
  iframes are read in-process rather than by injecting anything into a foreign realm.
- **The model cannot write memory.** Every step's page is captured in code. The model can *recall*
  pages it has navigated away from; it cannot transcribe one into a note, which is a capability it
  will happily spend a thousand output tokens on.

The full reasoning, including what was tried and why it failed, is in
[`docs/architecture/`](docs/architecture/README.md).

---

## Safety and privacy

Read these before you point it at anything you care about. Both are written to be specific rather
than reassuring.

- **[PRIVACY.md](PRIVACY.md)** — what is stored where, in self-hosted and hosted modes, including
  which parts of your pages transit the server and which never touch its disk.
- **[SECURITY.md](SECURITY.md)** — the threat model, the known gaps, and how to report one.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to work on the repo.

The short version: the agent loop runs on the server and the browser runs on your machine, so page
content necessarily transits the server. Brotto's posture is **transit, never persist** — a run
leaves a 200-character digest of each page, not a copy of the page. Your model key is held in memory
for the duration of a task and is never written to disk.

---

## Limitations

This is a working system, not a finished product. These are the real ones:

- **The server has no authentication.** The WebSocket the extension uses is accepted without a token,
  and `AGENT_SECRET` is wired only onto the Playwright connector path, which is disabled by default.
  Anyone who can reach a Brotto server's address can drive the agent against that user's logged-in
  browser. Do not expose one to a network you do not control. This is the top open item.
- **There is no benchmark.** Nobody has measured Brotto's completion rate against anything, because
  nobody has built the harness. Any reliability number you see anywhere is a guess.
- **Perception is partial.** No shadow-DOM traversal beyond the geometry fallback, no canvas
  rendering, and an out-of-process iframe is invisible. The tree is capped at 12 frames, depth 4 and
  2000 nodes per frame.
- **Long tasks can outlive the service worker.** Chrome suspends MV3 workers after ~30s idle. The
  heartbeat covers active sessions; a genuinely long background task can still be killed.
- **The reconnect path and the offline-history fallback are unit-tested logic only** — not verified
  in a browser.
- **No Firefox.** `chrome.debugger` has no equivalent there.

---

## Providers

| Provider | Notes |
|---|---|
| Anthropic | Claude models; thinking is adaptive and always-on, so it is never overridden |
| OpenAI | Chat Completions, including the `gpt-5.6-{sol,terra,luna}` tier |
| MiniMax | M3 is the dev default — the fastest step time measured so far |
| Gemini | |
| OpenRouter | |
| DeepSeek | |
| Groq | |
| Custom | Any OpenAI-compatible endpoint, including a local vLLM box |

Context-window size is read from the catalogue and drives how much of the accessibility tree each
step gets, so a smaller model honestly gets a smaller view of the page. Cost comes from the same
catalogue rather than from the provider SDK, which reports nothing on Claude or MiniMax.

---

## Development

```bash
# Python — 630 tests, no network
cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/ -q

# Extension
cd clients/brotto-extension && npm run build && npx tsc --noEmit

# Extension JS suites — run from the REPO ROOT
node scripts/test-replay.test.js
```

CI runs the Python suite and the extension type-check and build on every push.

The `scripts/*.test.js` suites pull the real functions out of `sidepanel.js` and `background.ts` by
brace matching and evaluate them against a fake DOM, so they cannot drift from what ships. A dropped
field or a missing handler is an *absence*, and an absence reads clean in a diff — which is the whole
reason those suites exist.

---

## Architecture

```
services/brotto-orchestrator/   Python: agent loop, model adapter, policy engine
  src/brotto_orchestrator/
    main.py                     FastAPI app, WebSocket handlers
    agent/harness.py            the observe → plan → act loop
    agent/audit.py              the per-session audit document
    agent/prompt.py             the system prompt
    model/                      provider-agnostic model adapter + catalogue
    policy/                     the blocklist and sensitive-action gates
clients/brotto-extension/       Chrome MV3 side-panel extension
  src/observation/              the observation pipeline behind captureObservation()
docs/architecture/              why each subsystem is built the way it is
```

Start with [`agent-loop.md`](docs/architecture/agent-loop.md) and
[`conversation.md`](docs/architecture/conversation.md) — the two subsystems where the non-obvious
decisions live.

---

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
