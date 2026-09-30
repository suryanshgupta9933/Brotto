"""FastAPI orchestrator: extension WebSocket + dev HTTP task runner."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid

from dotenv import load_dotenv

# Load .env FIRST — before the dev defaults below. It used to run after
# them, so os.environ.setdefault won the race and an AGENT_MODEL in .env
# was silently ignored in favour of the dev default.
load_dotenv()

# Token Plan compat: pydantic-ai's AnthropicProvider only reads
# ANTHROPIC_API_KEY; Token Plan users have ANTHROPIC_AUTH_TOKEN. Propagate
# unconditionally (idempotent — only fires if API_KEY is unset) so this
# works in any mode, not just dev.
if not os.getenv("ANTHROPIC_API_KEY") and os.getenv("ANTHROPIC_AUTH_TOKEN"):
    os.environ["ANTHROPIC_API_KEY"] = os.getenv("ANTHROPIC_AUTH_TOKEN")

# Dev-mode defaults: BROTTO_ENV=dev (default) pre-populates the env vars the
# harness reads at module-import time, so `python start_server.py` works
# without any further env config. Set BROTTO_ENV=prod to opt out — the
# server then uses whatever the operator configured (extension settings,
# .env, AGENT_MODEL, etc.) and raises "no model configuration" if
# nothing resolves.
if os.getenv("BROTTO_ENV", "dev") == "dev":
    # MiniMax-M3, not M3.1-Flash-Preview. The Flash model *requires*
    # thinking — it 400s on thinking.type="disabled" and reasons on every
    # step, which measured ~6.1s per call against ~1.5s here. The agent
    # loop is latency-bound (the user is watching a step counter), so
    # reasoning it does not need is pure UI cost.
    # Trade-off: M3 is pay-as-you-go and returns 402 for a Token Plan key
    # with no M3 credits. M3.1-Flash-Preview is the Token Plan model, so a
    # subscription-only user must set AGENT_MODEL in .env to get M3.1 back.
    # Provider is `minimax`, not `anthropic` — the minimax factory carries
    # the https://api.minimax.io/anthropic base URL. `anthropic:` here
    # would post a MiniMax model name to api.anthropic.com.
    os.environ.setdefault("AGENT_MODEL", "minimax:MiniMax-M3")
    os.environ.setdefault("CONTEXT_WINDOW_TOKENS", "1000000")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .agent.context import AgentDeps
from .agent.harness import AgentHarness, mark_cancelled
from .cdp.relay import CDPRelay
from .cdp.extension_relay import ExtensionCDPRelay
from .cdp.watchdog import CDPWatchdog
from .model.config import ModelConfig, UserCredentials
from .model.registry import PROVIDER_REGISTRY
from .model.resolver import resolve_model_config
from .model.store import save_user_config
from .session.auth import validate_token
from .session.observation_validator import validate_observation
from .session.registry import SessionRegistry
from .policy import Policy, UserPolicy

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_LOG_LEVEL = os.getenv("BROTTO_LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("brotto.main")

# ponytail: log the resolved auth env at startup, so misconfigured
# Token Plan keys are immediately visible in server logs. We only print
# length (never the value) to avoid leaking the key.
_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
_auth_token = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
log.info(
    "auth env at startup: ANTHROPIC_API_KEY=%s  ANTHROPIC_AUTH_TOKEN=%s  BROTTO_ENV=%s",
    ("set (len=%d)" % len(_api_key)) if _api_key else "<unset>",
    ("set (len=%d)" % len(_auth_token)) if _auth_token else "<unset>",
    os.environ.get("BROTTO_ENV", "<unset>"),
)

# ponytail: match the sidepanel's MAX_TASK_CHARS. Anything over this is
# logged as a warning (defense in depth) but NOT blocked — the sidepanel
# already shows a confirm() dialog, and the user is the final authority
# on what they want the agent to do.
MAX_TASK_CHARS = 1000

# Quiet noisy third-party loggers
for _noisy in ("httpx", "httpcore", "websockets", "uvicorn.access"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Brotto Orchestrator", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

registry = SessionRegistry()
harness = AgentHarness()

# ponytail: one SessionState per task, created and never removed, so a
# long-lived server grew without bound. Eviction is by insertion order
# over idle sessions, not a true LRU — nothing reads a session's recency,
# so the timestamp a real LRU needs would be written and never read.
# Ceiling: over the cap with every session running, nothing is evicted.
# Upgrade path: a `last_seen` field on SessionState written in
# get_or_create, then sort on it.
MAX_TRACKED_SESSIONS = 256


def _prune_sessions() -> int:
    """Drop the oldest idle sessions once over the cap. Returns the count.

    A session with a live agent is skipped: its `in_seq` tracker is what
    D9 reconnect dedup reads, and evicting it mid-task would quietly
    re-enable replay of an already-seen observation.
    """
    sessions = registry._sessions
    if len(sessions) <= MAX_TRACKED_SESSIONS:
        return 0
    dropped = 0
    for sid, state in list(sessions.items()):
        if len(sessions) <= MAX_TRACKED_SESSIONS:
            break
        if state.current_task and not state.current_task.done():
            continue
        del sessions[sid]
        dropped += 1
    if dropped:
        log.info("session eviction  dropped=%d  tracked=%d  cap=%d",
                 dropped, len(sessions), MAX_TRACKED_SESSIONS)
    return dropped


def _error(status: int, message: str, **extra) -> JSONResponse:
    """The one error shape.

    `error_id` is the correlation id: the same six characters go in the
    log line, in the panel's failure bubble and in the audit document, so
    a user reporting a failure hands over something an operator can grep.
    """
    from .agent.audit import new_error_id

    return JSONResponse(
        status_code=status,
        content={"error": message, "error_id": new_error_id(), **extra},
    )


class _BadRequest(Exception):
    """A body that arrived and cannot be used. Always a 400."""


async def _json_body(request: Request) -> dict:
    """Parse a JSON body, or raise _BadRequest naming the problem.

    Three endpoints called `await request.json()` unguarded, where a
    malformed body surfaced as an unhandled 500 and an HTML traceback
    page — indistinguishable from the server itself being broken.
    """
    try:
        body = await request.json()
    except Exception as exc:
        raise _BadRequest(f"malformed JSON body: {exc}") from exc
    if not isinstance(body, dict):
        raise _BadRequest("body must be a JSON object")
    return body


@app.exception_handler(_BadRequest)
async def _bad_request(_request: Request, exc: _BadRequest):
    return _error(400, str(exc))


@app.exception_handler(StarletteHTTPException)
async def _http_exc(_request: Request, exc: StarletteHTTPException):
    """Reroute FastAPI's own 404/405 through the same envelope.

    Left alone these answer `{"detail": "Not Found"}`, so a wrong URL
    produced a differently-shaped error from every other failure — the
    one case a caller debugging by hand hits first.
    """
    return _error(exc.status_code, str(exc.detail))


async def unhandled(_request: Request, exc: Exception):
    """JSON with a correlation id, instead of a traceback page."""
    from .agent.audit import new_error_id

    error_id = new_error_id()
    log.error("unhandled error_id=%s  %s", error_id, exc, exc_info=True)
    return JSONResponse(status_code=500, content={
        "error": "internal error", "error_id": error_id,
    })


# Two-arg call, not the decorator form: Starlette's add_exception_handler
# returns None, so decorating with it would replace the handler with None.
app.add_exception_handler(Exception, unhandled)


# ponytail: hydrate persisted user policies so the in-memory cache
# survives a server restart. Without this, GET /v1/policy right after
# boot would return floor-only even for returning users. Loaded once
# at startup; written to disk by `persist_user_policy()` below.
try:
    from .policy import persist as _user_policy_persist
    _loaded = registry.hydrate_user_policies(_user_policy_persist.load_all())
    _dir = _user_policy_persist.directory_path()
    log.info(
        "user-policy persistence: dir=%s  hydrated=%d",
        _dir.resolve(), _loaded,
    )
except Exception as exc:
    log.warning("user-policy hydrate failed (continuing without): %s", exc)

@app.get("/health")
async def health():
    log.debug("health check")
    from .agent.harness import _MODEL
    return {
        "status": "ok",
        "service": "brotto-orchestrator",
        "version": "2.0.0",
        "model": _MODEL,
    }


def _persist_user_policy(user_key: str, payload: dict | None) -> None:
    """Best-effort write of the user's last-known policy to disk.

    Calls `save_if_changed` so a no-op Save click (same content) does
    NOT bump the on-disk mtime — the sidepanel's "Last verified" badge
    stays accurate and we avoid needless disk IO. A WARNING is logged
    on disk failures; the in-memory cache still works for the current
    run, but the next restart will lose the change.
    """
    if payload is None:
        return
    try:
        from .policy import persist as _user_policy_persist
        wrote = _user_policy_persist.save_if_changed(user_key, payload)
        if wrote:
            log.info(
                "user-policy saved  user_key=%s  blacklist=%s  mode=%s",
                user_key,
                payload.get("blacklist"),
                payload.get("mode"),
            )
        # else: silent no-op save; this is the common case when the
        # user clicks Save without changing anything.
    except Exception as exc:
        log.warning("failed to persist user policy for %s: %s", user_key, exc)


# ponytail: sidepanel fetches this on init so the CONTEXT cell shows the
# right baseline (the server's current model's window) before any
# step_progress arrives. The frontend never computes the percentage —
# the harness emits a pre-computed `pct` on every step.
@app.get("/context")
async def context_limit():
    from .agent.harness import _MODEL, _CONTEXT_WINDOW_TOKENS
    return {"model": _MODEL, "window": _CONTEXT_WINDOW_TOKENS}


# ponytail: GET /v1/policy returns the policy the server will enforce for
# this caller — the last-known user policy, verbatim. The extension calls
# this on Settings open to fill the blacklist field with what the server
# actually holds, so a stale local cache cannot quietly diverge.
# Unauthenticated (same as /health) — payload only contains domain lists,
# not secrets; this is fine for the demo. Add auth before any production
# deployment.
@app.get("/v1/policy")
async def get_effective_policy(request: Request):
    from .policy import UserPolicy
    # Caller identity: prefer explicit query, fall back to client IP
    # (SessionRegistry tracks per-IP for the lifetime of the server).
    caller = request.query_params.get("user_id") or (
        request.client.host if request.client else "unknown"
    )
    user_payload = registry.get_user_policy_payload(caller)
    user_pol: UserPolicy | None = None
    if isinstance(user_payload, dict):
        try:
            user_pol = UserPolicy.model_validate(user_payload)
        except Exception:
            user_pol = None
    effective = user_pol or Policy()
    return JSONResponse(content={
        "mode": effective.mode,
        "blacklist": effective.blacklist,
        "sensitive_actions": effective.sensitive_actions,
        "caller": caller,
    })


# ---------------------------------------------------------------------------
# Session creation — called by the extension before connecting WS
# ---------------------------------------------------------------------------

@app.post("/v1/sessions")
async def create_session(request: Request):
    session_id = str(uuid.uuid4())
    registry.get_or_create(session_id)
    _prune_sessions()
    ws_url = f"ws://localhost:8000/ws/ext/{session_id}"
    log.info("session created  session_id=%s  ws_url=%s", session_id, ws_url)
    return JSONResponse(status_code=201, content={
        "session_id": session_id,
        "websocket_url": ws_url,
        "server_url": "http://localhost:8000",
    })


@app.get("/v1/sessions")
async def list_session_audits():
    """Index of every session on disk, newest first.

    Unauthenticated, like /health and /v1/policy — it summarises runs
    the caller already owns, on their own server. A future auth layer
    gates all of them together.
    """
    from .agent.audit import list_sessions as _list

    return JSONResponse(content={"sessions": _list()})


@app.get("/v1/sessions/{session_id}/audit")
async def read_audit(session_id: str):
    """The full nested document for one session.

    A damaged file returns 200 with `corrupt: true` rather than an
    error: the file exists to survive a crash, and failing to read it is
    exactly the case it has to survive.
    """
    from .agent.audit import read as _read

    doc = _read(session_id)
    if not doc.get("found"):
        return _error(404, "unknown session")
    return JSONResponse(content=doc)


# ponytail: separate HTTP endpoint for save-time notification. The
# WS-based `policy_acknowledged` only works while a task is in flight;
# this one logs even when the user clicks Save with no task running.
@app.post("/v1/policy_ack")
async def policy_ack(request: Request):
    body = await _json_body(request)
    settings = body.get("settings") or {}
    user_id = body.get("user_id") or request.client.host if request.client else "unknown"
    mode = settings.get("mode")
    blacklist = settings.get("blacklist") or []
    # Mirror on the session registry so a later GET /v1/policy returns
    # this user's view (handles the "Save with no WS open" case from
    # the audit work earlier). Persist to disk too.
    snapshot = {"mode": mode, "blacklist": blacklist}
    registry.set_user_policy(user_id, snapshot)
    _persist_user_policy(user_id, snapshot)
    log.warning(
        "[%s] POLICY: user saved settings  mode=%s  blacklist=%s",
        user_id, mode, blacklist,
    )
    try:
        from .agent.audit import append_policy_event
        append_policy_event(
            f"client-{user_id}",
            step=None, kind="policy_acknowledged",
            domain=None, action=None,
            decision=f"mode={mode}  blacklist={blacklist}",
        )
    except Exception as exc:
        log.warning("failed to persist policy_acknowledged: %s", exc)
    return JSONResponse(content={"ok": True})


# ponytail: HTTP, not the WS, for the same reason as /v1/policy_ack above —
# the socket only exists while a task is in flight, and the panel needs
# suggestions precisely when no task is running.
@app.post("/v1/suggestions")
async def suggestions(request: Request):
    """Task suggestions for the page the panel is looking at.

    `page_text` is the page's visible text, read on demand by the panel with
    `chrome.scripting.executeScript` — not a permanently injected content
    script, and never the debugger, which would raise Chrome's debugging
    banner for a feature the user only opened a panel to look at. It comes
    back empty on chrome:// pages and anywhere else that refuses a script;
    that is passed through as absence rather than filled in.
    """
    from .agent.suggest import generate

    body = await _json_body(request)
    url = str(body.get("url", "") or "").strip()
    if not url:
        return _error(400, "url is required")
    title = str(body.get("title", "") or "")
    page_text = str(body.get("page_text", "") or "")

    client_host = request.client.host if request.client else "unknown"
    inline_config = None
    cfg_payload = body.get("model_config")
    if isinstance(cfg_payload, dict) and cfg_payload.get("provider"):
        try:
            inline_config = ModelConfig(
                provider=str(cfg_payload["provider"]),
                model=str(cfg_payload.get("model", "")),
                context_window=int(cfg_payload.get("context_window") or 400_000),
            )
        except (ValueError, TypeError) as exc:
            log.warning("invalid model_config in /v1/suggestions: %s", exc)
    api_key = body.get("api_key")
    inline_creds = UserCredentials(api_key=api_key, base_url=None) if api_key else None

    try:
        cfg, creds = resolve_model_config(client_host, inline_config, inline_creds)
    except ValueError as exc:
        # ValueError never carries a key — the resolver's own message names
        # the env var, not the secret.
        log.warning("suggestions: no model config: %s", exc)
        return _error(502, str(exc))

    try:
        lines = await generate(url, title, cfg, creds, page_text=page_text)
    except Exception as exc:
        # 502 rather than 500 so the panel can tell "your server couldn't do
        # this" from "your request was malformed" and keep its fallback.
        log.warning("suggestions failed for %s: %s", url[:120], exc)
        return _error(502, str(exc))
    # context_used is what the panel needs to decide how long to keep the
    # result: a line derived from page text is page content, and storing one
    # in chrome.storage.local for a day is a leak the user never agreed to.
    return JSONResponse(content={"lines": lines, "context_used": bool(page_text)})


# ---------------------------------------------------------------------------
# Extension WebSocket — observe/act loop driven by the browser extension
# ---------------------------------------------------------------------------

@app.websocket("/ws/ext/{session_id}")
async def websocket_extension(websocket: WebSocket, session_id: str):
    """Extension relay WebSocket.

    Extension → server: task_start | observation | human_reply | ping
    Server → extension: observe | action | step_progress | ask_human | task_result | pong
    """
    await websocket.accept()
    log.info("[%s] extension connected", session_id)

    obs_queue: asyncio.Queue = asyncio.Queue()
    human_queue: asyncio.Queue = asyncio.Queue()
    # D9: the per-session tracker is held by the registry, so a
    # reconnect with the same session_id resumes dedup correctly.
    in_seq_tracker = registry.get_or_create_in_seq(session_id)
    legacy_warned = False

    async def ws_send(msg: dict) -> None:
        msg_type = msg.get("type", "?")
        try:
            payload = json.dumps(msg)
            await websocket.send_text(payload)
            if msg_type == "action":
                log.debug("[%s] → action  %s", session_id, json.dumps(msg.get("action", {}))[:120])
            elif msg_type == "observe":
                log.debug("[%s] → observe", session_id)
            else:
                log.debug("[%s] → %s  %s", session_id, msg_type, payload[:120])
        except Exception as exc:
            log.warning("[%s] ws_send failed  type=%s  err=%s", session_id, msg_type, exc)

    # Wait for task_start
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        msg = json.loads(raw)
        log.debug("[%s] ← %s", session_id, raw[:200])
        if msg.get("type") != "task_start":
            log.warning("[%s] expected task_start, got %s — closing", session_id, msg.get("type"))
            await websocket.close(code=4000)
            return
        task = msg.get("task", "").strip()
        if not task:
            log.warning("[%s] task_start with empty task — closing", session_id)
            await websocket.close(code=4000)
            return
        if len(task) > MAX_TASK_CHARS:
            # Defense in depth — the sidepanel already showed a confirm().
            # Server logs so the audit trail records the unusually-long
            # input. No block: the user's intent is the final word.
            log.warning(
                "[%s] task_start exceeds %d chars (%d) — prompt-injection risk",
                session_id, MAX_TASK_CHARS, len(task),
            )
        # A follow-up task and a crash resume arrive on the same frame and do
        # opposite things with the same document. The extension sets this, and
        # a frame without it is a follow-up: an extension that predates the
        # flag never reconnects with resume intent, so defaulting the other
        # way would let a new task silently restart an approved run.
        resume = bool(msg.get("resume", False))
        log.info("[%s] task_start  task=%r  resume=%s", session_id, task[:100],
                 resume)
    except asyncio.TimeoutError:
        log.warning("[%s] timed out waiting for task_start", session_id)
        await websocket.close(code=4000)
        return
    except Exception as exc:
        log.error("[%s] error receiving task_start: %s", session_id, exc)
        await websocket.close(code=4000)
        return

    # One agent per live session. This handler starts a harness per accepted
    # socket, so a second socket for a session whose agent is still running
    # would put two agents on one browser — two agents, one tab, each with
    # half the page and both able to click the thing the other is clicking.
    #
    # A task that is already unwinding does not count: the reconnect that
    # beats its own socket's teardown is the ordinary case, not an attack,
    # and refusing it would kill the one run that was recoverable.
    _state = registry.get_or_create(session_id)
    _live = _state.current_task
    if (_live is not None and not _live.done() and not _live.cancelling()):
        log.error(
            "[%s] task_start while an agent is already running — refused",
            session_id,
        )
        from .agent.audit import append_policy_event
        append_policy_event(
            session_id, step=None, kind="duplicate_task_start",
            domain=None, action=None,
            decision="refused: an agent is already driving this session",
        )
        await ws_send({
            "type": "task_failed",
            "status": "interrupted",
            "failure_reason": "duplicate_task_start",
            "summary": (
                "Refused: this session already has a running agent. "
                "Starting a second one would put two agents on one browser."
            ),
        })
        await ws_send({"type": "canonical_status", "status": "interrupted"})
        await websocket.close(code=4009)
        return

    eval_queue: asyncio.Queue = asyncio.Queue()
    relay = ExtensionCDPRelay(ws_send, obs_queue, eval_queue, session_id)

    # ponytail: key policy storage by CLIENT IP, not session_id. session_id
    # is fresh per /v1/sessions call, so anything stashed under it is dead
    # the moment the next task opens a new session. IP is the closest thing
    # to "user identity" we have without auth, and matches the key used
    # by /v1/policy GET and /v1/policy_ack — making the three callers
    # finally agree.
    client_host = websocket.client.host if websocket.client else "unknown"

    # Parse per-task model config (BYOK) from task_start. Additive — older
    # extension builds that don't send these still work via env-var fallback.
    model_cfg_payload = msg.get("model_config")
    api_key = msg.get("api_key")
    remember_key = bool(msg.get("remember_key", False))
    log.info(
        "[%s] task_start model: provider=%s has_key=%s key_len=%d",
        session_id,
        (model_cfg_payload or {}).get("provider") if isinstance(model_cfg_payload, dict) else None,
        bool(api_key),
        len(api_key) if api_key else 0,
    )

    parsed_model_cfg = None
    if isinstance(model_cfg_payload, dict):
        provider_name = model_cfg_payload.get("provider", "")
        if provider_name not in PROVIDER_REGISTRY:
            log.warning("[%s] unknown provider %r — closing", session_id, provider_name)
            await ws_send({
                "type": "task_failed",
                "failure_reason": "model_not_found",
                "summary": f"Unknown provider: {provider_name}",
            })
            await websocket.close(code=4000)
            return
        try:
            parsed_model_cfg = ModelConfig(
                provider=provider_name,
                model=str(model_cfg_payload.get("model", "")),
                context_window=int(model_cfg_payload.get("context_window") or 400_000),
            )
        except (ValueError, TypeError) as e:
            log.warning("[%s] invalid model_config in task_start: %s", session_id, e)
            parsed_model_cfg = None

        if remember_key and parsed_model_cfg is not None:
            try:
                save_user_config(client_host, parsed_model_cfg)
            except OSError as e:
                log.warning("[%s] failed to persist user config: %s", session_id, e)

    # Merge floor + user policy. Server floor wins on mode; lists union.
    user_policy_payload = msg.get("user_policy")
    user_policy: Policy | None = None
    if isinstance(user_policy_payload, dict):
        try:
            user_policy = UserPolicy.model_validate(user_policy_payload)
        except Exception as exc:
            log.warning("[%s] invalid user_policy, ignoring: %s", session_id, exc)
    # Stash under IP so `GET /v1/policy` returns this user's view even
    # if the sidepanel opens settings after the WS closes. Persist to
    # disk under hashed IP so the view survives a server restart.
    if isinstance(user_policy_payload, dict):
        registry.set_user_policy(client_host, user_policy_payload)
        _persist_user_policy(client_host, user_policy_payload)
    effective_policy = user_policy or Policy()
    log.info("[%s] effective_policy  mode=%s  blacklist=%d",
             session_id, effective_policy.mode,
             len(effective_policy.blacklist))

    deps = AgentDeps(
        user_id=session_id,
        task=task,
        task_id=session_id,
        cdp=relay,
        ws_send=ws_send,
        policy=effective_policy,
        human_input_queue=human_queue,
        model_config=parsed_model_cfg,
        api_key=api_key,
        client_ip=client_host,
    )

    agent_task = asyncio.create_task(harness.run(deps, resume=resume))
    # Publish it on the session state so _prune_sessions() can tell a
    # running session from an idle one and never evict the former.
    registry.get_or_create(session_id).current_task = agent_task
    log.info("[%s] agent task started", session_id)

    # ponytail: one-shot WS frame so the sidepanel knows the EFFECTIVE
    # policy the server is about to enforce (floor + user merged). Without
    # this the sidepanel has no way to render "X domains enforced by your
    # organisation" — it would only see its own saved list.
    try:
        await ws_send({
            "type": "policy_effective",
            "mode": effective_policy.mode,
            "blacklist": effective_policy.blacklist,
            "sensitive_actions": effective_policy.sensitive_actions,
        })
    except Exception as exc:
        log.warning("[%s] failed to send policy_effective: %s", session_id, exc)

    try:
        while not agent_task.done():
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                incoming = json.loads(raw)
                t = incoming.get("type")

                # D9 — validate observation sequence tracking before
                # enqueueing. Duplicates are dropped here so the agent
                # loop never sees them.
                decision = validate_observation(
                    incoming, in_seq_tracker, is_legacy_warned=legacy_warned,
                )
                if not decision.accept:
                    if decision.reason == "legacy_no_seq":
                        legacy_warned = True
                    else:
                        log.debug(
                            "[%s] dropped %s  seq=%s  reason=%s",
                            session_id, t, incoming.get("seq"), decision.reason,
                        )
                        continue

                if t == "observation":
                    n = len(incoming.get("axTargets", []))
                    log.debug(
                        "[%s] ← observation  url=%s  ax_targets=%d",
                        session_id, incoming.get("url", "")[:80], n,
                    )
                    await obs_queue.put(incoming)
                    # A capped or partly-failed frame walk is a partial
                    # picture, and "nothing exists" on a truncated page is a
                    # wrong answer the model cannot recover from. Say so out
                    # loud rather than shipping the half silently.
                    fr = incoming.get("frames") or {}
                    caps = [k for k in ("frameCapped", "depthCapped", "nodeCapped") if fr.get(k)]
                    if caps or fr.get("failed"):
                        log.warning(
                            "[%s] observation truncated: %s/%s frames (%s cross-origin), "
                            "capped=%s unreadable=%s",
                            session_id, fr.get("traversed", 0), fr.get("total", 0),
                            fr.get("crossOrigin", 0), ",".join(caps) or "none",
                            fr.get("failed") or "none",
                        )
                elif t == "observation_error":
                    log.warning("[%s] ← observation_error  err=%s", session_id, incoming.get("error"))
                    await obs_queue.put({"url": "", "title": "", "axTargets": []})
                elif t == "evaluate_result":
                    log.debug("[%s] ← evaluate_result  len=%d", session_id, len(incoming.get("value", "")))
                    await eval_queue.put(incoming.get("value", ""))
                elif t == "get_attributes_result":
                    # Answers a get_attributes from a type_text. Without
                    # this branch it sits undelivered and every password
                    # lookup times out after _ATTRS_TIMEOUT, so the
                    # redaction falls back to the accessible name alone.
                    await relay.deliver_attributes_result(incoming)
                elif t == "human_reply":
                    log.info("[%s] ← human_reply", session_id)
                    await human_queue.put(incoming.get("content", ""))
                elif t == "cancel":
                    # The user stopped the task. Nothing else here can tell a
                    # cancel from a dropped socket — the socket closes either
                    # way — and only one of the two may be resumed, so the
                    # client says which. Consumed by the harness's sealing
                    # callback; this frame is not an answer to anything.
                    log.warning("[%s] ← cancel (user stopped the task)",
                                session_id)
                    mark_cancelled(session_id)
                elif t == "steer":
                    # A distinct type, not human_reply. That one means "reply
                    # to a prompt that is currently outstanding" and its
                    # handler cannot tell whether one is — so a message sent
                    # mid-task would either be dropped or, worse, be consumed
                    # by the next approval as if the user had answered it.
                    content = str(incoming.get("content", "") or "").strip()
                    if not content:
                        log.info("[%s] ← steer (empty, ignored)", session_id)
                        continue
                    log.info("[%s] ← steer  len=%d", session_id, len(content))
                    deps.steering = content
                    await ws_send({"type": "steer_ack", "length": len(content)})
                elif t == "revoke":
                    # ponytail: user clicked Revoke on a prior approval within
                    # the post-approval window. Clear the first-time-seen
                    # cache so the next step re-prompts. With deny-aborts-task
                    # semantics, approved actions can't be "undone" — the task
                    # is over once an action runs. Revoke just resets what
                    # the next task would do.
                    log.warning(
                        "[%s] POLICY: user REVOKED prior approval — clearing seen_first_time",
                        session_id,
                    )
                    try:
                        deps.seen_first_time.clear()
                    except Exception as exc:
                        log.warning("[%s] revoke state-clear failed: %s", session_id, exc)
                    await ws_send({"type": "policy_revoked"})
                elif t == "ping":
                    await ws_send({"type": "pong"})
                elif t == "policy_acknowledged":
                    # Extension user clicked Save in sidepanel Settings.
                    # Log the full new payload so the server has a record
                    # independent of any task_start.
                    settings = incoming.get("settings") or {}
                    # Update the in-memory mirror so GET /v1/policy returns
                    # the just-saved view without waiting for the next
                    # task_start. Persist to disk too. Keyed by IP so it
                    # survives a session restart — see the ponytail note
                    # at the task_start handler above.
                    snapshot = {
                        "mode": settings.get("mode"),
                        "blacklist": settings.get("blacklist") or [],
                    }
                    registry.set_user_policy(client_host, snapshot)
                    _persist_user_policy(client_host, snapshot)
                    log.warning(
                        "[%s] POLICY: user saved settings  mode=%s  blacklist=%s",
                        session_id,
                        settings.get("mode"),
                        settings.get("blacklist"),
                    )
                    try:
                        from .agent.audit import append_policy_event
                        append_policy_event(
                            session_id,
                            step=None, kind="policy_acknowledged",
                            domain=None, action=None,
                            decision=(
                                f"mode={settings.get('mode')}  "
                                f"blacklist={settings.get('blacklist')}"
                            ),
                        )
                    except Exception as exc:
                        log.warning("[%s] failed to persist policy_acknowledged: %s", session_id, exc)
                else:
                    log.debug("[%s] ← unknown type=%s", session_id, t)
            except asyncio.TimeoutError:
                continue
            except json.JSONDecodeError as exc:
                log.warning("[%s] bad JSON from extension: %s", session_id, exc)
            except Exception as exc:
                # WebSocket close frames (1000/1001/1005) surface as ConnectionClosed
                if "ConnectionClosed" in type(exc).__name__ or "CloseCode" in str(exc):
                    log.info("[%s] websocket closed: %s", session_id, exc)
                else:
                    log.error("[%s] receive loop error: %s", session_id, exc)
                break
    except WebSocketDisconnect:
        log.info("[%s] extension disconnected mid-task", session_id)
        agent_task.cancel()
    finally:
        if not agent_task.done():
            agent_task.cancel()
        try:
            result = await agent_task
            log.info("[%s] task finished  status=%s  summary=%r", session_id, result.status, result.summary[:80])
            await ws_send({"type": "task_result", "result": result.model_dump()})
        except asyncio.CancelledError:
            log.info("[%s] agent task cancelled", session_id)
        except Exception as exc:
            log.error("[%s] agent task raised: %s", session_id, exc, exc_info=True)
            await ws_send({"type": "task_error", "error": str(exc)})
        log.info("[%s] session closed", session_id)


# ---------------------------------------------------------------------------
# Playwright WebSocket — for headless / desktop connector mode
# ---------------------------------------------------------------------------

@app.websocket("/ws/{user_id}")
async def websocket_agent(websocket: WebSocket, user_id: str):
    token = websocket.headers.get("authorization", "").replace("Bearer ", "")
    if not validate_token(token):
        log.warning("[%s] rejected — bad token", user_id)
        await websocket.close(code=4001)
        return

    await websocket.accept()
    log.info("[%s] playwright client connected", user_id)
    session = registry.get_or_create(user_id)
    human_input_queue: asyncio.Queue = asyncio.Queue()

    async def ws_send(msg: dict) -> None:
        try:
            await websocket.send_text(json.dumps(msg))
            log.debug("[%s] → %s", user_id, msg.get("type"))
        except Exception as exc:
            log.warning("[%s] ws_send failed: %s", user_id, exc)

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type")
            log.debug("[%s] ← %s", user_id, msg_type)

            if msg_type == "ping":
                await ws_send({"type": "pong"})

            elif msg_type == "submit_task":
                session.cancel_current_task()
                task_text = msg.get("task", "")
                start_url = msg.get("start_url", "about:blank")
                script_request = msg.get("script")
                user_policy_payload = msg.get("user_policy")
                user_policy: Policy | None = None
                if isinstance(user_policy_payload, dict):
                    try:
                        user_policy = UserPolicy.model_validate(user_policy_payload)
                    except Exception as exc:
                        log.warning("[%s] invalid user_policy, ignoring: %s", user_id, exc)
                effective_policy = user_policy or Policy()
                log.info("[%s] submit_task  task=%r  start_url=%s  effective_mode=%s",
                         user_id, task_text[:80], start_url, effective_policy.mode)
                log.info("[%s] effective_policy  mode=%s  blacklist=%d",
                         user_id, effective_policy.mode,
                         len(effective_policy.blacklist))

                async def _run_task(task: str, start_url: str) -> None:
                    from .dev.playwright_browser import PlaywrightBrowser
                    task_id = str(uuid.uuid4())
                    browser = PlaywrightBrowser()
                    try:
                        await browser.launch(headless=False, url=start_url or "about:blank")
                        cdp = CDPRelay(browser)
                        # Test/dev only. Honor `script` solely in dev so a production
                        # server can never be driven by a client-supplied decision
                        # sequence. Opt-out, not opt-in: a deploy that forgets to
                        # set BROTTO_ENV must get the prod behaviour.
                        scripted_planner = None
                        script_name = script_request
                        if script_name:
                            if os.getenv("BROTTO_ENV", "dev") != "dev":
                                log.warning("[%s] ignoring task_start script in prod  name=%s",
                                            user_id, script_name)
                            else:
                                from .testing.scripts import SCRIPT_NAMES, build_script
                                if script_name not in SCRIPT_NAMES:
                                    log.warning("[%s] unknown script %r — closing", user_id, script_name)
                                    await websocket.close(code=4000)
                                    return
                                scripted_planner = build_script(script_name)
                        deps = AgentDeps(
                            user_id=user_id,
                            task=task,
                            task_id=task_id,
                            cdp=cdp,
                            ws_send=ws_send,
                            human_input_queue=human_input_queue,
                            policy=effective_policy,
                            scripted_planner=scripted_planner,
                        )
                        watchdog = CDPWatchdog(cdp, on_dead=lambda: ws_send({"type": "cdp_dead"}))
                        await watchdog.start()
                        try:
                            result = await harness.run(deps)
                        finally:
                            watchdog.stop()
                        await ws_send({"type": "task_result", "result": result.model_dump()})
                    except asyncio.CancelledError:
                        await ws_send({"type": "task_cancelled"})
                    except Exception as exc:
                        log.error("[%s] task error: %s", user_id, exc, exc_info=True)
                        await ws_send({"type": "task_error", "error": str(exc)})
                    finally:
                        await browser.close()

                t = asyncio.create_task(_run_task(task_text, start_url))
                session.current_task = t

            elif msg_type == "human_reply":
                await human_input_queue.put(msg.get("content", ""))

            elif msg_type == "cancel_task":
                session.cancel_current_task()
                await ws_send({"type": "task_cancelled"})

    except WebSocketDisconnect:
        log.info("[%s] playwright client disconnected", user_id)
        registry.mark_disconnected(user_id)


# ---------------------------------------------------------------------------
# Dev HTTP — headless task runner
# ---------------------------------------------------------------------------

@app.post("/run")
async def run_task(request: Request):
    body = await _json_body(request)
    task = body.get("task", "")
    start_url = body.get("start_url", "about:blank")
    user_policy_payload = body.get("user_policy")
    user_policy: Policy | None = None
    if isinstance(user_policy_payload, dict):
        try:
            user_policy = UserPolicy.model_validate(user_policy_payload)
        except Exception as exc:
            log.warning("/run: invalid user_policy, ignoring: %s", exc)
    effective_policy = user_policy or Policy()
    log.info("/run  task=%r  start_url=%s  effective_mode=%s",
             task[:80], start_url, effective_policy.mode)

    if not task:
        return _error(400, "task required")

    from .dev.playwright_browser import PlaywrightBrowser
    browser = PlaywrightBrowser()

    async def ws_send(msg: dict) -> None:
        log.info("[run] → %s  %s", msg.get("type"), json.dumps(msg)[:200])

    try:
        await browser.launch(headless=True, url=start_url)
        cdp = CDPRelay(browser)
        task_id = str(uuid.uuid4())
        # Test/dev only, same guard as the websocket path: a production server
        # must never be driven by a client-supplied decision sequence.
        scripted_planner = None
        script_name = body.get("script")
        if script_name:
            if os.getenv("BROTTO_ENV", "dev") != "dev":
                log.warning("/run: ignoring script in prod  name=%s", script_name)
            else:
                from .testing.scripts import SCRIPT_NAMES, build_script
                if script_name not in SCRIPT_NAMES:
                    return _error(400, f"unknown script {script_name!r}")
                scripted_planner = build_script(script_name)
        deps = AgentDeps(
            user_id="http-dev",
            task=task,
            task_id=task_id,
            cdp=cdp,
            ws_send=ws_send,
            policy=effective_policy,
            scripted_planner=scripted_planner,
        )
        result = await harness.run(deps)
        return JSONResponse(content=result.model_dump())
    except Exception as exc:
        log.error("/run error: %s", exc, exc_info=True)
        return _error(500, str(exc))
    finally:
        await browser.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug")
