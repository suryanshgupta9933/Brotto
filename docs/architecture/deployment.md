# Deployment

How to run the orchestrator yourself, and what the container deliberately
does not contain.

## The one idea that makes the image small

Brotto's product path is the **Chrome extension driving the user's own
browser** over the DevTools Protocol. The server holds the agent loop and
reasons about what the browser reports. The server never launches a browser.

Playwright is therefore a **test-only** dependency: it lives in
`requirements-dev.txt` and the `dev` dependency-group in `pyproject.toml`,
and is not installed by the `Dockerfile`. The previous image ran
`playwright install chromium --with-deps`, which added a browser and its OS
dependencies to an image that is a documented self-host quickstart
(`README.md`, "Try it"). Dropping it is most of the size difference.

The runtime dependency list is 7 pure-Python packages.

## Sizing a VM

The memory ceiling is one in-flight model call streaming out of the
process. It is not a Chromium per tab, because there is no Chromium. A
2-vCPU / 2–4 GB VM is comfortable for a handful of concurrent users; below
1 GB works for one or two. Cost at that size is a few euros a month on any
common provider.

Under bring-your-own-key the operator pays orchestration CPU and never
model tokens — the model bill belongs to the person using the extension.
That is what keeps a small VM viable.

## Running it

```bash
export AGENT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
docker compose up -d
```

Or straight from the image:

```bash
docker build -t brotto .
docker run -p 127.0.0.1:8000:8000 -e AGENT_SECRET="$AGENT_SECRET" brotto
```

State lives on a named volume at `/data`. Both directories must be on it or
session history and security policy are lost on every restart:

| Variable | Default | Holds |
|---|---|---|
| `BROTTO_SESSIONS_DIR` | `logs/sessions` | Per-session audit documents, page-text sidecars, scratchpads |
| `BROTTO_USER_POLICY_DIR` | `logs/user_policies` | The user's secure-mode policy |

## `BROTTO_ENV=prod` is a cost control

`BROTTO_ENV` defaults to `dev`, and dev pre-seeds
`AGENT_MODEL=minimax:MiniMax-M3` and propagates `ANTHROPIC_AUTH_TOKEN` into
`ANTHROPIC_API_KEY`. A user who connects without pasting a key therefore
resolves a working model **on the operator's key** and spends the operator's
credits. It does not error; it looks like a successful run.

The `Dockerfile` and `docker-compose.yml` both set it. The same reasoning is
why no model key is ever baked into the image: image layers are recoverable
even after a later layer is deleted, so a key in a layer is a published key.

Note there are two `.env` files and they are not interchangeable — the
deployment one beside `docker-compose.yml` holds only `AGENT_SECRET`;
`services/brotto-orchestrator/.env` is the development one and contains a
model key. `.dockerignore` excludes both from the build context.

## Reverse proxy and TLS

The extension needs a `wss://` URL. The compose file binds
`127.0.0.1:8000` on purpose: until `AGENT_SECRET` is validated on the
WebSocket, binding to `0.0.0.0` publishes an unauthenticated endpoint that
can drive an agent against a logged-in browser. Put Caddy or nginx in front
for TLS, and only then widen the bind.

## What still needs doing before this is publicly reachable

Recorded here rather than as a task list because each is a launch gate, not
a deployment step:

- `validate_token` is not yet wired into `/ws/ext/{session_id}`, and
  `AGENT_SECRET` currently defaults to the literal string `"dev-secret"`
  with `AGENT_AUTH_DISABLED` defaulting to `true`. That is worse than no
  auth, because it looks configured.
- `GET /v1/sessions` returns every session's task title to any caller and
  its docstring asserts it only summarises the caller's own runs.
- `POST /run` is unauthenticated and launches a headless browser; it should
  be refused outside dev.
- There is no retention. `_prune_sessions` evicts in-memory state only and
  never touches disk, so `logs/sessions/` grows without bound.
