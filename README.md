# Brotto

**An AI agent that works inside your own logged-in Chrome.** It reads the accessibility tree instead of
screenshots, and you bring your own model key.

<!--
  DEMO SLOT — highest-value asset in this repo, currently empty.
  45-60s, real run, no staging: a logged-in site (an inbox, a booking flow),
  showing the agent reading a page, acting, and finishing. Both browser-use and
  Skyvern lead with this, and Skyvern credits it for its #1 Hacker News launch.
-->

Most browser agents run in a cloud browser that you have never logged into, so they re-authenticate,
get caught by bot detection, and read the page as a screenshot. Brotto runs in **the tab you are
already signed in to**. Your cookies, your MFA, your SSO — because it is your browser.

That one architectural difference is what makes the hard case work: repetitive chores on sites behind a
login, where every screenshot-driven approach falls over three steps in.

## What it actually does

- **Reads the accessibility tree, not pixels.** The agent sees roles, labels and stable references
  (`Accessibility.getFullAXTree`) instead of an image. No vision model, no screenshot tokens, cheaper
  and faster, and it works on the accessibility information screen readers already rely on.
- **Runs in your session.** The extension attaches to a tab you name, does the work, and detaches. It
  does not ask you to log in to anything.
- **Bring your own key.** Claude, OpenAI or MiniMax. The key is held in memory in the extension and is
  never written to disk by Brotto. See [PRIVACY.md](PRIVACY.md) for exactly what goes where — including
  the part where the key is transmitted to the orchestrator, because the orchestrator is what calls your
  model provider.
- **Asks before the risky parts.** In secure mode you get an approval card before it sends an email,
  takes a payment, deletes something, publishes, or changes a password — and optionally before it acts
  on a site for the first time. The domain blocklist is yours alone; there is no server-side floor.
- **Writes down what it did.** Every run produces a per-session audit record — each observation, prompt,
  action, approval and timing — which is what makes a conversation resumable and inspectable rather than
  a black box.

## Try it

Two processes: the orchestrator (Python) and the extension (Chrome). The server needs **no API key** —
you enter yours in the extension.

**Orchestrator**

```bash
docker build -t brotto . && docker run -p 8000:8000 brotto
```

or from source:

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
PYTHONPATH=services/brotto-orchestrator/src \
  .venv/bin/python services/brotto-orchestrator/start_server.py
```

It listens on `:8000`. Check it with `curl localhost:8000/health`.

**Extension**

```bash
cd clients/brotto-extension
npm ci && npm run build
```

Load `dist/` through `chrome://extensions` → Developer mode → **Load unpacked**.

Then open the side panel, set the server URL to `ws://localhost:8000`, choose a provider, paste your
key, and give it a task.

## Honest limitations

This is a working system, not a finished product, and the following are real:

- **Perception is the known weak point.** No shadow-DOM traversal, no cross-origin iframe traversal, and
  no canvas or screenshot fallback. On a component-library page, a cross-origin embed, or a
  canvas-rendered one, the agent is partially blind. Work on this is in progress — see
  [`docs/superpowers/specs/2026-10-01-perception-hardening-design.md`](docs/superpowers/specs/2026-10-01-perception-hardening-design.md).
- **There is no benchmark yet.** Nobody has measured Brotto's completion rate against anything, because
  nobody has built the harness. Any reliability claim before that is a guess.
- **The action surface is small.** `navigate`, `click`, `type`, `scroll`, `press_key`. No native form
  fill, no dropdowns, no drag-and-drop, no file upload. Real apps need all of these.
- **No auth on the server.** Identity is your IP address. Do not expose a Brotto orchestrator to a
  network you do not control.
- **Long tasks can outlive the service worker.** Chrome suspends MV3 workers after ~30s idle. The
  heartbeat covers active sessions; a genuinely long background task can still be killed.
- **The reconnect path and the offline-history fallback are unit-tested logic only** — not verified in
  a browser.
- **No Firefox.** `chrome.debugger` has no equivalent there.

## Layout

```
services/brotto-orchestrator/   Python: agent loop, CDP relay, model adapter, policy engine
  src/brotto_orchestrator/
    main.py                     FastAPI app, WebSocket handlers
    agent/harness.py            the observe → plan → act loop
    agent/audit.py              the per-session audit document
    agent/prompt.py             the system prompt
    model/                      provider-agnostic model adapter
    policy/                     secure-mode gates
clients/brotto-extension/       Chrome MV3 side-panel extension
docs/architecture/              why each subsystem is built the way it is
docs/product/                   product strategy and decisions
docs/superpowers/               specs and plans
```

Start with [`docs/architecture/agent-loop.md`](docs/architecture/agent-loop.md) and
[`docs/architecture/conversation.md`](docs/architecture/conversation.md) — the two subsystems where the
non-obvious decisions live.

## Development

```bash
# Tests — 538 Python tests, no network
cd services/brotto-orchestrator
../../.venv/bin/python -m pytest tests/ -q

# Extension build and type check
cd clients/brotto-extension && npm run build && npx tsc --noEmit
```

CI runs both. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Business Source License 1.1 — free for personal, research, evaluation and
non-commercial internal use. It converts to Apache 2.0 on **2029-10-01**, which
is reproduced in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). Running a
hosted service on top of this repo needs a commercial license.

See [LICENSE](LICENSE) and [PRIVACY.md](PRIVACY.md).
