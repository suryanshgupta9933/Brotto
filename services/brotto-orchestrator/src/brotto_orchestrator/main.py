"""FastAPI orchestrator: extension WebSocket + dev HTTP task runner."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager

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
from .session.auth import auth_enabled, validate_request
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

# The unauthenticated case is the one worth shouting about: /ws/ext is
# the only path a Chrome Web Store install uses, and anyone who can reach
# this port can drive the agent against the user's logged-in browser.
# On a loopback self-host that is the user, so it is a warning, not a
# refusal — putting this behind a reverse proxy is the moment it matters.
if auth_enabled():
    log.info("AGENT_SECRET is set — /ws/ext and the session endpoints require it")
elif os.environ.get("AGENT_SECRET"):
    log.warning("AGENT_AUTH_DISABLED=true — AGENT_SECRET is set but ignored")
else:
    log.warning(
        "AGENT_SECRET is unset: every caller is trusted. Fine on localhost; "
        "set it before exposing this server on a network."
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

# Retention is the user's setting, not ours: unset means keep everything,
# and a value of 0 disables the sweep rather than deleting the lot. The
# default is deliberately absent — a self-hoster who wants their history
# aged out has to say so.
RETENTION_DAYS_ENV = "BROTTO_RETENTION_DAYS"
RETENTION_SWEEP_SECONDS = 3600


def retention_days() -> float | None:
    """Configured retention in days, or None when the sweep is off."""
    raw = os.environ.get(RETENTION_DAYS_ENV, "").strip()
    if not raw:
        return None
    try:
        days = float(raw)
    except ValueError:
        log.warning("%s=%r is not a number — keeping every session", RETENTION_DAYS_ENV, raw)
        return None
    return days if days > 0 else None


def sweep_retention() -> int:
    """Age sessions out. Returns how many went."""
    from .agent.audit import prune_older_than

    days = retention_days()
    if days is None:
        return 0
    try:
        pruned = prune_older_than(days)
    except Exception as exc:  # a sweep must never take the server down
        log.warning("retention sweep failed: %s", type(exc).__name__)
        return 0
    if pruned:
        log.info("retention sweep  pruned=%d  older_than=%sd", pruned, days)
    return pruned


@asynccontextmanager
async def lifespan(_app: FastAPI):
    sweep_retention()
    stop = asyncio.Event()

    async def tick() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=RETENTION_SWEEP_SECONDS)
            except asyncio.TimeoutError:
                await asyncio.to_thread(sweep_retention)

    sweeper = asyncio.create_task(tick())
    try:
        yield
    finally:
        stop.set()
        sweeper.cancel()


app = FastAPI(title="Brotto Orchestrator", version="2.0.0", lifespan=lifespan)
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


def _authed(request: Request) -> bool:
    """HTTP flavour of the WebSocket check.

    A bad key answers 404 rather than 403: 403 confirms the route and
    the failure mode are worth probing, and this server holds the user's
    own transcripts.
    """
    return validate_request(
        request.headers.get("authorization"), request.query_params.get("token")
    )


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


def _inline_model(payload: object) -> ModelConfig | None:
    """The extension's `model_config` frame as a `ModelConfig`, or None.

    Three call sites read this shape (task_start, /v1/suggestions,
    /v1/model/check) and they were three separate literal parses. The
    consequence of that is the check answering `ok` for a config the run
    would refuse — which is the one thing a pre-flight check exists to
    prevent. One parser, so all three agree.

    An empty or absent provider is None, not a ModelConfig: the panel sends
    `{provider: ""}` until the user opens Settings, and naming a provider we
    don't know is a different failure from naming none at all.
    """
    if not isinstance(payload, dict):
        return None
    provider = str(payload.get("provider", "") or "")
    if not provider:
        return None
    try:
        return ModelConfig(
            provider=provider,
            model=str(payload.get("model", "")),
            context_window=int(payload.get("context_window") or 400_000),
            base_url=payload.get("base_url") or None,
        )
    except (ValueError, TypeError) as exc:
        log.warning("invalid model_config from extension: %s", exc)
        return None


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
                "user-policy saved  user_key=%s  blacklist=%s",
                user_key,
                payload.get("blacklist"),
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
# Unauthenticated like /health and /v1/policy — the payload is a model
# catalogue, no secrets and no per-caller state. This is what deletes two of the
# three hand-kept copies of the list (sidepanel.js, welcome.js); the extension
# caches it and keeps a small offline fallback.
@app.get("/v1/models")
async def get_models():
    from .model.catalog import PROVIDER_CATALOG
    return JSONResponse(content={
        "providers": [info.to_dict() for info in PROVIDER_CATALOG.values()],
    })


# Vendors that answer an exhausted balance with a 400 and a sentence rather
# than a 402 — MiniMax and OpenAI both do — so a status code alone throws away
# the only field that names the problem the user has to fix.
_CREDIT_HINTS = ("insufficient", "balance", "credit", "quota", "billing", "arrear", "payment")


def _classify_probe_failure(exc: BaseException) -> tuple[str, str]:
    """(kind, sentence) for a failed pre-flight probe.

    The `kind` is what the panel branches on; the sentence is what the user
    reads, and it is written for someone who does not know what a provider
    error is. Every branch names the fix.
    """
    from pydantic_ai.exceptions import ModelHTTPError

    if isinstance(exc, ModelHTTPError):
        status = exc.status_code
        body = str(getattr(exc, "body", "") or "").lower()
        if status in (401, 403):
            return (
                "auth_failed",
                "Your API key was rejected by the provider "
                f"(HTTP {status}). It is most likely expired, revoked, or "
                "pasted with a stray space — open Settings → Model and paste "
                "it again.",
            )
        if status == 402 or (status == 400 and any(h in body for h in _CREDIT_HINTS)):
            return (
                "no_credits",
                "The provider accepted your key but has no credit left for "
                "it. Top up the account, or switch to a different model in "
                "Settings → Model.",
            )
        if status == 429:
            return (
                "rate_limited",
                "The provider is rate-limiting this key (HTTP 429). Wait a "
                "moment, or switch models in Settings → Model.",
            )
        return ("error", f"The provider returned HTTP {status}: {body[:300] or 'no detail'}")
    # pydantic-ai wraps a transport failure in ModelAPIError and hangs the
    # real error off `__cause__` (`raise ModelAPIError(...) from e`). Every
    # provider SDK it ships sits on httpx, so TransportError covers refused
    # connections, DNS misses, TLS failures and timeouts in one test.
    import httpx

    seen: set[int] = set()
    node: BaseException | None = exc
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        if isinstance(node, httpx.TransportError | TimeoutError | OSError):
            return (
                "unreachable",
                "Brotto could not reach the provider. Check the base URL and "
                "that the machine running it is online.",
            )
        node = node.__cause__ or node.__context__
    return ("error", str(exc)[:400])


# ponytail: one request to the provider, before the user pays for a run.
#
# The panel calls this before it starts a task, so a missing model, a rejected
# key and an empty balance arrive as a sentence naming the fix — rather than
# as a run that fails 30 seconds in with the same information buried in a
# failure bubble.
#
# It resolves through the same three tiers as `task_start` and builds the model
# the same way, so "ok" means the run can start and not merely that some other
# code path reached a provider. What it cannot prove is that the provider
# accepted the request *shape* — that is what the run itself is for.
@app.post("/v1/model/check")
async def check_model(request: Request):
    from pydantic_ai.messages import ModelRequest, UserPromptPart
    from pydantic_ai.models import ModelRequestParameters

    body = await _json_body(request)
    client_host = request.client.host if request.client else "unknown"
    inline_config = _inline_model(body.get("model_config"))
    api_key = body.get("api_key")
    inline_creds = (
        UserCredentials(api_key=api_key, base_url=getattr(inline_config, "base_url", None))
        if api_key else None
    )

    try:
        cfg, creds = resolve_model_config(client_host, inline_config, inline_creds)
    except ValueError as exc:
        # ValueError never carries a key — the resolver names the env var, not
        # the secret. This is the "no model is set anywhere" case, which is
        # the one the panel turns into a prompt to open Settings.
        log.warning("model check: nothing resolved: %s", exc)
        return JSONResponse(content={"ok": False, "kind": "no_model", "error": str(exc)})

    factory = PROVIDER_REGISTRY.get(cfg.provider)
    if factory is None or not factory.validate_model_id(cfg.model):
        named = f"{cfg.provider}:{cfg.model}"
        return JSONResponse(content={
            "ok": False, "kind": "unknown_model",
            "error": f"{named} is not a model Brotto knows about. Pick one from "
                      "the list in Settings → Model.",
        })

    try:
        model = factory.build(cfg.model, creds)
        await model.request(
            [ModelRequest(parts=[UserPromptPart(content="ping")])],
            model_settings=factory.model_settings(cfg.model),
            model_request_parameters=ModelRequestParameters(),
        )
    except Exception as exc:
        kind, message = _classify_probe_failure(exc)
        log.warning("model check failed for %s/%s: %s (%s)",
                    cfg.provider, cfg.model, kind, type(exc).__name__)
        return JSONResponse(content={
            "ok": False, "kind": kind, "error": message,
            "model": f"{cfg.provider}:{cfg.model}",
        })

    log.info("model check ok for %s/%s", cfg.provider, cfg.model)
    return JSONResponse(content={
        "ok": True,
        "model": f"{cfg.provider}:{cfg.model}",
        "context_window": cfg.context_window,
    })


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
        "blacklist": effective.blacklist,
        "sensitive_actions": effective.sensitive_actions,
        "caller": caller,
    })


# ---------------------------------------------------------------------------
# Session creation — called by the extension before connecting WS
# ---------------------------------------------------------------------------

@app.post("/v1/sessions")
async def create_session(request: Request):
    # Mints a session and allocates registry state, so it is gated like
    # the reads — otherwise anyone reaching the port can fill the registry
    # up to its 256-entry prune without ever holding the secret.
    if not _authed(request):
        return _error(404, "not found")

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
async def list_session_audits(request: Request):
    """Index of every session on disk, newest first.

    Gated on AGENT_SECRET, which is what closes the enumeration: this
    returned every session's task title to any caller that could reach
    the port. On a self-host that caller is the user, but a self-hoster
    who puts Caddy in front of it is publishing their own task history.
    """
    from .agent.audit import list_sessions as _list

    if not _authed(request):
        return _error(404, "not found")
    return JSONResponse(content={"sessions": _list()})


@app.get("/v1/sessions/{session_id}/audit")
async def read_audit(session_id: str, request: Request):
    """The full nested document for one session.

    A damaged file returns 200 with `corrupt: true` rather than an
    error: the file exists to survive a crash, and failing to read it is
    exactly the case it has to survive.
    """
    from .agent.audit import read as _read

    if not _authed(request):
        return _error(404, "not found")
    doc = _read(session_id)
    if not doc.get("found"):
        return _error(404, "unknown session")
    return JSONResponse(content=doc)


@app.delete("/v1/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    """Erase one session. `audit.delete` takes every file it owns.

    Separate from delete-all and behind the same secret: this is the one
    route where a wrong id is the difference between "I erased it" and
    "I erased the wrong one".
    """
    from .agent.audit import delete as _delete

    if not _authed(request):
        return _error(404, "not found")
    return JSONResponse(content={"deleted": _delete(session_id)})


@app.delete("/v1/sessions")
async def delete_all_sessions(request: Request):
    """Erase every session on this server."""
    from .agent.audit import delete_all as _delete_all

    if not _authed(request):
        return _error(404, "not found")
    return JSONResponse(content={"deleted": _delete_all()})


# ponytail: separate HTTP endpoint for save-time notification. The
# WS-based `policy_acknowledged` only works while a task is in flight;
# this one logs even when the user clicks Save with no task running.
@app.post("/v1/policy_ack")
async def policy_ack(request: Request):
    body = await _json_body(request)
    settings = body.get("settings") or {}
    user_id = body.get("user_id") or request.client.host if request.client else "unknown"
    blacklist = settings.get("blacklist") or []
    # Mirror on the session registry so a later GET /v1/policy returns
    # this user's view (handles the "Save with no WS open" case from
    # the audit work earlier). Persist to disk too.
    #
    # The snapshot is the whole document — building it as
    # `{"mode": settings.get("mode"), ...}` while the field no longer
    # exists wrote a literal `None`, which then failed UserPolicy
    # validation on the next GET, was swallowed by the bare except
    # above, and silently served an empty blacklist. Add a key here
    # only if Policy actually declares it.
    #
    # `approved_domains` is carried across from disk rather than rebuilt:
    # the harness writes those grants when the user clicks Approve on a
    # site, and a Settings save is not a request to forget them. Writing
    # this snapshot wholesale would drop the list, and the next task on
    # that site would re-ask for an approval the user already gave.
    from .policy import persist as _user_policy_persist
    snapshot = {
        "blacklist": blacklist,
        "approved_domains": _user_policy_persist.load_granted_domains(user_id),
    }
    registry.set_user_policy(user_id, snapshot)
    _persist_user_policy(user_id, snapshot)
    log.warning(
        "[%s] POLICY: user saved settings  blacklist=%s",
        user_id, blacklist,
    )
    try:
        from .agent.audit import append_policy_event
        append_policy_event(
            f"client-{user_id}",
            step=None, kind="policy_acknowledged",
            domain=None, action=None,
            decision=f"blacklist={blacklist}",
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
    inline_config = _inline_model(body.get("model_config"))
    api_key = body.get("api_key")
    inline_creds = (
        UserCredentials(api_key=api_key, base_url=getattr(inline_config, "base_url", None))
        if api_key else None
    )

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

    The secret arrives as a WebSocket subprotocol: a browser cannot set
    headers on a WebSocket, and `?token=` would write the secret in plain
    text into the access log of this server and of any Caddy in front of
    it, permanently. Checked before accept, so an unauthenticated caller
    never gets a socket it can drive.
    """
    offered = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    if not validate_request(
        websocket.headers.get("authorization"),
        offered[1] if len(offered) > 1 else websocket.query_params.get("token"),
    ):
        log.warning("[%s] extension rejected — bad token", session_id)
        await websocket.close(code=4001)
        return

    # Select the protocol *name*, never the secret: this goes back in the
    # response headers, and echoing the credential would reintroduce the
    # leak in the one place the handshake is otherwise clean.
    await websocket.accept(subprotocol="brotto-v1" if offered else None)
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
        # An empty provider is the extension saying it has nothing chosen, not
        # naming a provider we don't know — the panel sends `{provider: ""}`
        # on every task until the user opens Settings. Refusing it closed the
        # socket before the resolver ever ran, so BROTTO_FORCE_ENV_MODEL and a
        # plain AGENT_MODEL both became unreachable: the run could not start
        # and the failure reached the user as "server unreachable" rather than
        # as the model choice it was. Fall through and let the resolver decide,
        # which is the only thing that knows about env and per-user configs.
        if provider_name and provider_name not in PROVIDER_REGISTRY:
            log.warning("[%s] unknown provider %r — refusing the task", session_id, provider_name)
            await ws_send({
                "type": "task_failed",
                "failure_reason": "model_not_found",
                "summary": f"Unknown provider: {provider_name}",
            })
            await websocket.close(code=4000)
            return
        parsed_model_cfg = _inline_model(model_cfg_payload)

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
    log.info("[%s] effective_policy  blacklist=%d",
             session_id, len(effective_policy.blacklist))

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
                    # What the observation cost, measured by the extension as it
                    # built it. `scans` is 1 on a page that went still and 1-3 on
                    # one that did not, and `fallback` is the per-node
                    # `DOM.getBoxModel` tail the bulk path could not reach. This
                    # was at debug while the numbers it reports were the whole
                    # point of measuring them, so a run could not tell whether
                    # the work landed.
                    m = incoming.get("metrics") or {}
                    st = m.get("stability") or {}
                    geo = m.get("geometry") or {}
                    log.info(
                        "[%s] ← observation  url=%s  ax_targets=%d"
                        "  scans=%s  bytes=%s"
                        "  geometry=%s/%s resolved (fallback=%s truncated=%s %s)"
                        "  stability=%s in %sms (%s mutations)",
                        session_id, incoming.get("url", "")[:80], n,
                        m.get("scans", "?"), m.get("bytes", "?"),
                        geo.get("resolved", "?"), geo.get("requested", "?"),
                        geo.get("fallback", "?"), geo.get("truncated", "?"),
                        geo.get("source", "?"),
                        "quiet" if st.get("waited") else
                            ("unsettled" if st.get("timedOut") else "unknown"),
                        st.get("elapsedMs", "?"), st.get("mutations", "?"),
                    )
                    await obs_queue.put(incoming)
                    # A capped or partly-failed frame walk is a partial
                    # picture, and "nothing exists" on a truncated page is a
                    # wrong answer the model cannot recover from. Say so out
                    # loud rather than shipping the half silently.
                    fr = incoming.get("frames") or {}
                    caps = [k for k in ("frameCapped", "depthCapped", "nodeCapped") if fr.get(k)]
                    if caps or fr.get("failed"):
                        # Which frame capped is the only thing that says whether
                        # the model lost something it needed: the main document
                        # going dark is a blind agent, an analytics embed going
                        # dark is nothing. A bare "capped=nodeCapped" every step
                        # reads as an error and answers nothing.
                        capped = fr.get("cappedFrames") or []
                        # `kept` is the number of controls that survived the
                        # cap, against `nodes` = the raw AX nodes in the tree.
                        # The cap is on raw nodes and most of them never become
                        # targets, so `nodes` alone cannot say whether the
                        # model lost anything.
                        where = ",".join(
                            f"{c.get('frameIndex')}:{c.get('nodes')}"
                            f"/{c.get('kept', '?')}kept"
                            f"{'x' if c.get('crossOrigin') else ''}"
                            f" {(c.get('url') or '')[:60]}"
                            for c in capped
                        ) or "-"
                        log.warning(
                            "[%s] observation truncated: %s/%s frames (%s cross-origin), "
                            "capped=%s at [%s] unreadable=%s",
                            session_id, fr.get("traversed", 0), fr.get("total", 0),
                            fr.get("crossOrigin", 0), ",".join(caps) or "none", where,
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
                        "blacklist": settings.get("blacklist") or [],
                    }
                    registry.set_user_policy(client_host, snapshot)
                    _persist_user_policy(client_host, snapshot)
                    log.warning(
                        "[%s] POLICY: user saved settings  blacklist=%s",
                        session_id,
                        settings.get("blacklist"),
                    )
                    try:
                        from .agent.audit import append_policy_event
                        append_policy_event(
                            session_id,
                            step=None, kind="policy_acknowledged",
                            domain=None, action=None,
                            decision=(
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
    token = websocket.headers.get("authorization", "")
    if not validate_request(token, websocket.query_params.get("token")):
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
                log.info("[%s] submit_task  task=%r  start_url=%s",
                         user_id, task_text[:80], start_url)
                log.info("[%s] effective_policy  blacklist=%d",
                         user_id, len(effective_policy.blacklist))

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
    log.info("/run  task=%r  start_url=%s", task[:80], start_url)

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
