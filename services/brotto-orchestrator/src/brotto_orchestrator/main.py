"""FastAPI orchestrator: extension WebSocket + dev HTTP task runner."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
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
def _is_prod() -> bool:
    """Whether this process opted out of the dev defaults.

    Unset means *dev*, not prod. The comment this replaces claimed the
    opposite — that a deploy forgetting BROTTO_ENV would get the safe
    behaviour — and the code has always done the reverse, on this and on the
    two `script` guards. Prod is what the Dockerfile's `ENV` and compose's
    `environment:` both set, redundantly, and that redundancy is the launch
    gate rather than this default. A bare `brotto` on a box is a development
    server: no secret required, `/run` open, dev model defaults. It is
    documented as one and binds nothing a self-hoster would expose.
    """
    return os.getenv("BROTTO_ENV", "dev") != "dev"


if not _is_prod():
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

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTasks
from starlette.exceptions import HTTPException as StarletteHTTPException

from .agent.context import AgentDeps
from .agent.harness import AgentHarness, mark_cancelled
from .agent.redact import redact_text
from .cdp.relay import CDPRelay
from .cdp.extension_relay import ExtensionCDPRelay
from .cdp.watchdog import CDPWatchdog
from .model.config import ModelConfig, UserCredentials
from .model.registry import PROVIDER_REGISTRY
from .model.resolver import resolve_model_config
from .model.store import save_user_config
from .session.auth import (
    AuthResult,
    auth_enabled,
    auth_mode,
    authenticate,
    is_placeholder,
    validate_request,
)
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
# The one startup refusal, and it runs first so nothing above it can report a
# placeholder secret as healthy. An unset secret is only a warning because a
# developer on loopback has none and needs none — but a secret that is a known
# placeholder is not that case. It is a credential published in this repository,
# and it gates a relay that can drive the operator's logged-in browser. Warning
# would repeat the failure that produced it: the value was enforced, so it
# looked secure.
if os.environ.get("AGENT_SECRET") and is_placeholder(os.environ["AGENT_SECRET"]):
    raise SystemExit(
        "AGENT_SECRET is the placeholder from .env.example, which is published "
        "in this repository. Refusing to start.\n"
        "Generate a real one:\n"
        "  python3 -c 'import secrets;print(secrets.token_urlsafe(32))'"
    )

if auth_mode() == "jwt":
    log.info("SUPABASE_JWT_SECRET is set — /ws/ext and the session endpoints require a Supabase session token")
elif auth_enabled():
    log.info("AGENT_SECRET is set — /ws/ext and the session endpoints require it")
elif os.environ.get("AGENT_SECRET"):
    log.warning("AGENT_AUTH_DISABLED=true — AGENT_SECRET is set but ignored")
else:
    log.warning(
        "AGENT_SECRET is unset: every caller is trusted, so anyone who can "
        "reach this port can drive the agent against your logged-in browser. "
        "Fine on localhost. Before exposing this server, set AGENT_SECRET in "
        "the .env beside docker-compose.yml and paste the same value into "
        "Brotto's Settings — a wrong one is refused as a 404, which reads "
        "like a missing route if the panel has nothing better to say. "
        "This is a warning rather than a refusal only because a loopback "
        "bind is the case it describes; `brotto --host` refuses a "
        "non-loopback bind with no credential, which is where the refusal "
        "lives — the server is handed the port, not the address it binds."
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

# The hosted relay's default. A self-hoster's disk is their own data and
# nothing expires until they ask; ours is an ephemeral dyno where every
# beta transcript would otherwise persist for the life of the filesystem
# with nobody deciding that. An explicit setting always wins, including 0.
HOSTED_RETENTION_DAYS = 30.0


def retention_days() -> float | None:
    """Configured retention in days, or None when the sweep is off."""
    raw = os.environ.get(RETENTION_DAYS_ENV, "").strip()
    if not raw:
        return HOSTED_RETENTION_DAYS if auth_mode() == "jwt" else None
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


def _restore_ownership() -> int:
    """Put the persisted owners back in the registry. Returns how many.

    Named rather than inlined in `lifespan` so the test that simulates a dyno
    restart drives the same line the process does, instead of a copy of it.
    """
    from .agent.audit import load_owners

    return registry.hydrate_owners(load_owners())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Ownership before anything can answer about it. A restarted dyno comes
    # back with an empty registry, and every route below decides by consulting
    # it — so a hydrate that did not happen here would make "is this yours"
    # answer no for everybody, and make erase-all report a clean sweep it did
    # not perform.
    try:
        restored = _restore_ownership()
        if restored:
            log.info("ownership restored from disk  sessions=%d", restored)
    except Exception as exc:
        # Fail *closed* and say so: an unhydrated registry cannot hand one
        # beta user another's transcript, it can only tell a beta user their
        # own session is gone. That is the right way round for this failure.
        log.error("ownership hydrate failed (%s) — every session reads as unowned",
                  type(exc).__name__)
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

#: The one path that belongs to another application, and so to another CORS
#: layer. Read as a constant by the carve-out below and by the mount at the
#: bottom of this file — the two have to name the same string.
_WAITLIST_PATH = "/v1/waitlist"


class _OwnAppCORSMiddleware(CORSMiddleware):
    """This app's CORS, minus the path that has an application of its own.

    Starlette has no per-route CORS, and its middleware wraps the whole
    application — so the parent's layer answers the waitlist's **preflight**
    before the request ever reaches the sub-app below, and answers it with a
    400 because the marketing origins are (correctly) not in the parent's
    allowlist. The form then never submits, in every browser, for a reason
    that reads like a server fault.

    So this one path skips the parent's layer entirely and is handed straight
    to the sub-application, which adds the headers its own allowlist says.
    Everything else is unchanged, and the marketing origins still reach
    nothing but the waitlist.
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket") and scope.get("path") == _WAITLIST_PATH:
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(
    _OwnAppCORSMiddleware,
    # The only legitimate browser clients here are the extension, whose origin
    # is chrome-extension://<id> with a Chrome id ([a-p]{32}), and loopback,
    # for the dev panel. Reflecting any origin — "*" with allow_credentials
    # makes Starlette echo the caller's Origin — let any page the operator
    # happened to visit read their transcripts off a secret-less install, and
    # the "compose binds 127.0.0.1" mitigation does not apply: a browser
    # reaches loopback fine.
    #
    # **The marketing origins are deliberately not in here.** They were, for
    # one route, and the effect was that `brotto.dev` could read
    # `GET /v1/sessions`, `GET /v1/sessions/{id}/audit` and `DELETE /v1/sessions`
    # on *every* install — including an open-mode self-host, where the token
    # check passes for everyone. CORS middleware is per-application, so the
    # waitlist gets its own sub-app at the bottom of this file with its own,
    # much smaller allowlist, and this one names only what can already
    # authenticate — except on that one path, which skips this layer entirely
    # (`_OwnAppCORSMiddleware`). Credentials stay off throughout: every other
    # call authenticates with the AGENT_SECRET header or a JWT, not a cookie.
    allow_origin_regex=(
        r"^(chrome-extension://[a-p]{32}"
        r"|https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$"
    ),
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


def _auth(request: Request) -> AuthResult:
    """The one HTTP credential check, with the identity it resolved to."""
    return authenticate(
        request.headers.get("authorization"), request.query_params.get("token")
    )


async def _approved(request: Request) -> tuple[AuthResult, JSONResponse | None]:
    """Roster membership, not just a valid signature. Auth result and any refusal.

    A signature check answers "is this a credential this relay accepts",
    which in jwt mode is now a much weaker question than it looks: the
    sign-in route creates the auth account for anyone who asks, so *every
    person who signs up* holds a token that verifies. A signature proves
    an account exists. It does not prove a place in the beta, and the six
    routes that checked only this — two of which spend the operator's
    model credits — were serving anyone who signed up.

    **The split with the sign-in path is deliberate and is the point.**
    Minting a token is left open on purpose, because it is what lets the
    panel offer somebody the waitlist instead of a bare failure; *using*
    the product is not on the other side of that door. So the two open
    sign-in routes are the only unauthenticated surface a stranger
    reaches, and **every route that authenticates asks this** — the
    session index, read, delete and erase-all among them.

    Ownership scoping still applies on top of it: the gate says *this
    account may use the relay*, and `registry.owns` says *this session is
    one of theirs*. Two questions, neither answers the other.

    It used to be exempted on the four session routes, on the reasoning
    that an unapproved account owns nothing so the roster gate has no
    answer to change. That holds for `not_invited` and is **false for
    `revoked`**: a withdrawn member ran tasks before the withdrawal, so
    it still owns them, `owns()` is fail-closed only for ids it has never
    seen, and the exemption meant a revoked account could read its own
    transcript and erase its own sessions indefinitely. Revocation that
    leaves the transcript readable is not revocation.

    **One gate, one name, no exemptions to reason about.** The recurring
    failure here is a route picking a different gate than its neighbour
    looks like it should, and every pair of same-behaviour-different-name
    helpers is an invitation to the next one. `_auth` is the only weaker
    check, and it exists solely as this function's own first step.

    Fails closed, exactly as `authorize_task_start` does — an unreachable
    control plane is a refusal, not a licence to serve. Self-host never
    consults it: a `Claims` object only exists when a JWT authenticated,
    and `AGENT_SECRET` has always meant "this is the operator".

    A bad key answers **404 rather than 403**: 403 confirms the route and
    the failure mode are worth probing, and this server holds the user's
    own transcripts. A 403 is reserved for a credential that is *real*
    and the account behind it that is not on the roster — that answer is
    about an account, not about a probe.
    """
    from .session.jwt_auth import AccountRefused, Claims, ensure_on_roster

    auth = _auth(request)
    if not auth.ok:
        return auth, _error(404, "not found")
    if isinstance(auth.claims, Claims):
        try:
            await ensure_on_roster(auth.claims)
        except AccountRefused as exc:
            # The message is our own — `AccountRefused.detail` never
            # carries text from Supabase.
            return auth, _error(403, exc.detail)
    return auth, None


def _owner(claims: object) -> str | None:
    """The principal a verified credential acts as, or None on self-host.

    None is not "anonymous" — it is *one shared identity*, which is what
    `AGENT_SECRET` has always been. Every ownership check below treats
    None as "everything is yours", so open and secret modes keep the exact
    behaviour they had before identities existed.
    """
    return getattr(claims, "sub", None) if claims is not None else None


# Exactly what `crypto.randomUUID()` produces. Not a version check — the
# property that matters is that the value is 36 characters of one safe
# alphabet, so nothing downstream has to escape it, and that it is 122 bits
# of entropy, so it cannot be guessed.
_UUID = re.compile(r"\A[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z")

# Host and X-Forwarded-Proto are caller-supplied, and both end up in a URL the
# extension will dial — and in a log line. Same discipline as _UUID: an allowlist
# of one safe alphabet, so nothing downstream has to escape them. Colons are in
# the set because Starlette builds an IPv6 netloc *unbracketed* ("::1:8000"), and
# cli.py already treats ::1 as loopback — a stricter alphabet 400s every IPv6
# self-host. What the filter actually exists to keep out is CR, LF, space and
# slash, none of which any branch can match.
_HOST = re.compile(r"\A(?:[A-Za-z0-9.\-]{1,253}|\[?[0-9A-Fa-f:.]+\]?)(:\d{1,5})?\Z")

# AccountRefused reasons, restated as the wire codes the panel looks up.
# `AccountRefused` already restricts `reason` to these four, so this map is
# total in practice and exists so a Supabase-side change cannot put free text
# into `failure_reason`. The sentence belongs in `summary`; see
# scripts/test-failure-reasons.test.js.
_REFUSAL_REASON = {
    "not_invited": "not_invited",
    "revoked": "revoked",
    "task_cap_reached": "task_cap_reached",
    "control_plane_unavailable": "control_plane_unavailable",
}


def _caller_key(transport, explicit: object = None) -> str:
    """The key the user's blocklist and remembered model are stored under.

    A client-supplied id wins over the peer address. The address was the
    only identity available and it is not one: the same browser gets a new
    key the moment it joins a different network, and a server in a
    container sees the docker gateway rather than the machine that dialled
    it. Both cases silently reset an approved-sites list the user believed
    was remembered. The extension generates one uuid per install and sends
    it as `device_id`; an extension that predates it falls back to the
    address, which is where this behaviour has always been.

    **The format is enforced, not merely documented.** This value arrives in
    an unauthenticated request body and is used as a log field, as an
    interpolated key in an audit document, and as a filename — so an
    arbitrary string is a log-injection and audit-forging primitive on four
    routes. The peer address never was: it comes off the socket. Anything
    that is not a uuid is not an identity claim worth honouring, so it
    falls back to the address.
    """
    if isinstance(explicit, str) and _UUID.match(explicit):
        return explicit
    client = getattr(transport, "client", None)
    return client.host if client else "unknown"


def _error(status: int, message: str, **extra) -> JSONResponse:
    """The one error shape.

    `error_id` is the correlation id: the same six characters go in the
    log line, in the panel's failure bubble and in the audit document, so
    a user reporting a failure hands over something an operator can grep.
    """
    from .agent.audit import new_error_id

    return JSONResponse(
        status_code=status,
        # Reviewed and kept. This is the one envelope every route answers
        # through, and the message in it is written by the route's own
        # handler for the caller that already holds AGENT_SECRET. What must
        # never appear is a credential, and that is pinned by a test rather
        # than by reading these strings —
        # test_model_check_endpoint.py asserts a key is absent from the body.
        # The one flow that was not written by a handler, the provider
        # probe's raw exception, was fixed rather than suppressed. The rule is
        # switched off for this file in `.github/workflows/codeql.yml`.
        content={"error": message, "error_id": new_error_id(), **extra},
    )


class _BadRequest(Exception):
    """A body that arrived and cannot be used. Always a 400."""


async def _task_failed(send, code: str, summary: str, claims, status: str | None = None) -> None:
    """The one place a task the relay refuses becomes a frame — and a report.

    Three sites built this frame by hand (a duplicate start, an unknown
    provider, and the four account refusals), which is exactly the shape a
    guard gets missed in: each one would have had to remember to report as
    well as to refuse, and the answer a future refusal gives is always
    "yes, that one too". `code` is a `failure_reason` literal, so
    `scripts/test-failure-reasons.test.js` keeps it translatable and
    `session/failure_report.py` keeps it reportable.

    Key order is reproduced exactly as each caller had it; the audit
    document's `model → prompts → actions` rule is about documents, but
    there is no reason to churn the wire either.
    """
    from .session.failure_report import note_failure

    note_failure(code, "task_refused", claims)
    frame: dict = {"type": "task_failed"}
    if status:
        frame["status"] = status
    frame["failure_reason"] = code
    frame["summary"] = summary
    await send(frame)


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
        # Which credential UI the panel should render. Unauthenticated by
        # design, and this field is the only thing about it that is: it
        # names a mode, not a secret, and it is the reason this route
        # stays reachable without a credential at all.
        "auth_mode": auth_mode(),
    }


_HOSTNAME = re.compile(r"\A[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\Z")


def _string_list(value: object, field: str) -> list[str]:
    """A caller-supplied list of strings, or a refusal.

    **Fail-closed**, because the caller is deciding what must never be
    clickable. An absent field is the normal case (the sidepanel omits
    `approved_domains` from a policy Save) and yields `[]`. A field that
    is *present but malformed* raises instead of coercing to `[]`, because
    coercing writes an empty document over a populated one — the user's
    blocklist disappears because of a bad payload, which is strictly
    worse than the write not happening. The caller's blanket `except`
    turns the raise into "leave the stored document alone".

    A bare string is a list of one, not a list of characters.
    """
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        raise ValueError(f"{field} is not a list of strings: {type(value).__name__}")
    out = []
    for v in value:
        if not isinstance(v, str) or not v:
            raise ValueError(f"{field} holds a non-string entry")
        out.append(v)
    return out


def _granted_domains(value: object) -> list[str]:
    """The caller's grants, filtered to things that could be a host.

    The opposite policy to `_string_list`, and deliberately: a grant is
    a *permission*, so a junk entry is worthless rather than dangerous to
    keep, and raising here would let one corrupt grant discard the
    user's whole blocklist write. Dropping the entry costs the user
    nothing; keeping it would put a string that never matches an eTLD+1
    into the first-navigation gate forever.

    Lowercased because `etld1()` always returns lowercase — two records
    for one site is a grant that looks revocable and is not.
    """
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        return []
    out = set()
    for v in value:
        if isinstance(v, str) and _HOSTNAME.match(v):
            out.add(v.lower())
    return sorted(out)


def _persist_user_policy(user_key: str, payload: dict | None) -> None:
    """Best-effort write of the user's last-known policy to disk.

    Calls `save_if_changed` so a no-op Save click (same content) does
    NOT bump the on-disk mtime — the sidepanel's "Last verified" badge
    stays accurate and we avoid needless disk IO. A WARNING is logged
    on disk failures; the in-memory cache still works for the current
    run, but the next restart will lose the change.

    `approved_domains` is a **union** of what the client sent and what is on
    disk, never either one alone. `save_if_changed` writes the document
    wholesale and the sidepanel's `user_policy` carries only the blacklist, so
    keying off the payload alone erased the grant the user made last run and
    re-asked about the same site every task. Keying off disk alone is not
    enough either: that file is server-local, so on an ephemeral-FS host it
    empties on every restart. The client keeps its own copy in
    `chrome.storage.local` and ships it on each `task_start`, which makes the
    two complementary — neither store can lose what the other still holds.

    The union is monotone with no revoke path, so the file only ever grows.
    That is a real gap and it is a **feature**, not a fix: see
    `revoke_domain` in `docs/product/decisions/2026-10-10-hosted-beta-accounts-and-the-secret.md`.
    """
    if payload is None:
        return
    try:
        from .policy import persist as _user_policy_persist
        merged = dict(payload)
        merged["approved_domains"] = sorted(
            set(_user_policy_persist.load_granted_domains(user_key))
            | set(_granted_domains(merged.pop("approved_domains", None)))
        )
        # Both lines must complete before `save_if_changed`, which rewrites
        # the document wholesale — so the blacklist raising here costs the
        # grant write too, and leaves the stored document exactly as it was.
        merged["blacklist"] = _string_list(merged.get("blacklist"), "blacklist")
        wrote = _user_policy_persist.save_if_changed(user_key, merged)
        if wrote:
            # Counts, not the lists themselves — the domains are the user's
            # browsing, and this log is the one place a self-hoster's
            # rotated log files will hand them to whoever reads them.
            log.info(
                "user-policy saved  user_key=%s  blacklist=%d  granted=%d",
                user_key,
                len(merged["blacklist"]),
                len(merged["approved_domains"]),
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
# Behind AGENT_SECRET — payload only contains domain lists,
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
# A rejected key is not always a 401. Google's own error reference answers
# 400 INVALID_ARGUMENT / "API key not valid. Please pass a valid API key." —
# so a Gemini user with a bad key landed in the generic branch and read a
# raw body instead of being told to paste it again. Checked before the credit
# hints because both arrive as 400 and a rejected key is the more specific
# of the two diagnoses.
_AUTH_HINTS = (
    "api key not valid", "invalid api key", "api_key_invalid", "unauthorized",
    "invalid authentication credentials", "authenticationcredentials",
    "permission denied", "invalid api-key",
)


def _one_line(text: str) -> str:
    """`text` with every control character replaced by a space.

    CWE-117. A provider body is attacker-supplied whenever the self-hoster
    typed their own `base_url`, and a newline in it would forge a log line —
    the reader sees an entry the application never wrote. `str.isprintable`
    covers CR, LF, TAB, escape codes and the C1 range in one call.
    """
    return "".join(ch if ch.isprintable() else " " for ch in text)


# How much of a provider's error body reaches the log. One log line, one
# screenful; an operator diagnosing a misbehaving gateway needs the head of the
# response, not the rest of it.
PROBE_BODY_LOG_CHARS = 500


def _classify_probe_failure(
    exc: BaseException, secrets: tuple[str, ...] = ()
) -> tuple[str, str]:
    """(kind, sentence) for a failed pre-flight probe.

    The `kind` is what the panel branches on; the sentence is what the user
    reads, and it is written for someone who does not know what a provider
    error is. Every branch names the fix. Kinds: no_model, unknown_model,
    auth_failed, no_credits, rate_limited, provider_error, unreachable, error.

    **Every returned sentence is one this file wrote.** No branch forwards
    provider text, `str(exc)`, or anything else the far end chose. Not because
    most branches happen to be safe — because the panel persists the sentence
    to `chrome.storage.local`, so anything returned here is written to the
    user's disk and stays there. Provider text goes to the log — redacted and
    flattened to one line first, since the log keeps it indefinitely and is
    read by whoever can read the file; a kind goes to the client, and a kind
    is the only part a client can act on.
    """
    from pydantic_ai.exceptions import ModelHTTPError

    if isinstance(exc, ModelHTTPError):
        status = exc.status_code
        body = str(getattr(exc, "body", "") or "").lower()
        if status in (401, 403) or (
            status == 400 and any(h in body for h in _AUTH_HINTS)
        ):
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
        if status >= 500:
            # The provider is having a bad day, not the user's key. It reached
            # the model, got past auth, and failed. Distinguished from `error`
            # by *meaning*, not by what it may forward — nothing below
            # forwards anything.
            return (
                "provider_error",
                "The provider is having trouble (HTTP "
                f"{status}) — this is not your key. Try again shortly, or "
                "switch models in Settings → Model.",
            )
        # **No branch in this function returns provider text.** It used to:
        # this one returned `body[:300]`, and the panel persists whatever it
        # gets into `chrome.storage.local` to survive a close — so up to 300
        # characters of a third party's HTTP response landed on the user's
        # disk indefinitely, against "transit, never persist". A provider body
        # is where a gateway echoes the URL it dialled, a fragment of the key,
        # and whatever else the far end felt like saying.
        #
        # The body is not lost: it goes to the log, where an operator can read
        # it and nobody else can. The only thing a client can *act* on is a
        # kind, and every kind here is one this file wrote.
        #
        # **Redacted on the way in.** Moving a body out of the response and
        # into a log file is not by itself a fix: the file keeps the text
        # indefinitely, and the body is whatever answered — on a self-hosted
        # install with a user-supplied `base_url` that host is not necessarily
        # a model provider at all. So `redact_text` runs first and only the
        # per-kind *counts* are logged beside it; `_one_line` then flattens
        # control characters so a newline in the body cannot forge a log line.
        # Both are applied to the body, not to the sentence below: the
        # sentence is fixed text written here, and there is nothing in it to
        # redact or to inject.
        #
        # `warning`, not `debug`: an operator debugging a misbehaving provider
        # needs the body, and production is where that debugging happens. It
        # is safe at warning *because* of the two transforms above.
        # Bound derived from what is emitted, not chosen: `_one_line` only ever
        # shrinks text, so a credential past the emitted window cannot reach the
        # log, and one straddling the edge needs at most one window of slack to
        # be caught whole. Two windows is that. A rounder number would be
        # scanning regexes over input no reader ever sees.
        raw_body = str(getattr(exc, "body", "") or "")[: 2 * PROBE_BODY_LOG_CHARS]
        # Literal before pattern. `redact_text` matches credential *shapes*, so
        # it misses a key in a form it does not know, and a provider echoing
        # the caller's own key back is not hypothetical. The exact secret is
        # in hand, so it is replaced by equality first — exact beats clever.
        for secret in secrets:
            if secret:
                raw_body = raw_body.replace(secret, "[redacted]")
        safe_body, withheld = redact_text(raw_body)
        log.warning(
            "model check: provider HTTP %s, body: %s%s",
            status,
            _one_line(safe_body)[:PROBE_BODY_LOG_CHARS] or "(empty)",
            f"  [withheld: {withheld}]" if withheld else "",
        )
        return (
            "error",
            f"The provider rejected the request (HTTP {status}). The model id "
            "in Settings → Model is the usual cause — check it against the "
            "provider's list, or try a different model. The server log has the "
            "response, with anything key-shaped withheld.",
        )
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
    # The type, not str(exc). Every other branch above returns a sentence
    # this function wrote; this one had nothing, and a provider SDK's message
    # is exactly where the base URL, the resolved hostname and sometimes a
    # fragment of the key end up. The caller logs the full text either way.
    return ("error", f"The provider call failed ({type(exc).__name__}). "
                     "The server log has the detail.")


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

    _, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    body = await _json_body(request)
    client_host = _caller_key(request, body.get("device_id"))
    inline_config = _inline_model(body.get("model_config"))
    api_key = body.get("api_key")
    inline_creds = (
        UserCredentials(api_key=api_key, base_url=getattr(inline_config, "base_url", None))
        if api_key else None
    )

    try:
        cfg, creds = resolve_model_config(client_host, inline_config, inline_creds)
    except ValueError as exc:
        # "No model is set anywhere" — the case the panel turns into a prompt
        # to open Settings. The text goes to the log, not into the response:
        # `sidepanel.js` ignores this field for `no_model` and renders its own
        # copy, so `str(exc)` reached a caller with no use for it while naming
        # the server's environment variables. Fixed rather than suppressed.
        log.warning("model check: nothing resolved: %s", exc)
        return JSONResponse(content={
            "ok": False,
            "kind": "no_model",
            "error": "No model is configured.",
        })

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
        kind, message = _classify_probe_failure(
            exc, (creds.api_key,) if creds else ()
        )
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
    _, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    # Caller identity: prefer the install id the extension sends, fall back
    # to the peer address (SessionRegistry tracks per-key for the lifetime of
    # the server).
    caller = _caller_key(request, request.query_params.get("user_id"))
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
# Sign-in — the hosted relay's credential exchange
# ---------------------------------------------------------------------------
#
# Open by definition: these two routes are how a credential comes into
# existence, so gating them on one is a closed door. They reach exactly
# Supabase and nothing else, take no session id, and return no transcript.
# On a self-host relay they exist and do nothing useful — the extension
# renders the AGENT_SECRET field it has always rendered, because
# /health answers auth_mode: "open" or "secret".
#
# Open is not unlimited. Unauthenticated, these are a way to drive
# outbound email to arbitrary third-party addresses through our Resend
# account and to hammer Supabase's verify endpoint, so both are metered.
#
# **The limiter cannot become the account-existence oracle the route went
# to such lengths not to be.** It keys on what the *caller* sent — the
# peer address and the address they typed — and never consults anything
# that knows whether an address is registered, so a throttled address and
# a registered one are throttled for the same reason and after the same
# number of attempts. The answer is a fixed 429 with a fixed body; there
# is no branch anywhere below that consults the beta roster.

_SIGNIN_BUCKET_CAPACITY = 5.0
_SIGNIN_REFILL_PER_SECOND = 5.0 / 600.0  # five attempts, refilled over ten minutes
# The socket peer's own bucket, sized for what it actually holds. Behind
# Heroku `request.client.host` is a router address shared by the whole beta,
# so a five-token bucket here is five sign-ins per ten minutes *for everyone*
# — which is why the peer used to be the forwarded hop instead.
#
# This is the key that **cannot be forged**, which makes it the only one that
# can bound a caller who controls everything else they send: on the waitlist
# the caller picks the address and sets the header, so both of the other two
# keys are the thing being varied rather than a backstop. It is generous
# because it is shared and interactive traffic through it is rare.
#
# ponytail: ceiling — a caller behind one router address gets 20 writes per
# ten minutes no matter what they vary, and can therefore still starve other
# beta users sharing that address for as long as they keep it drained. There
# is no honest way around that without something the caller has to solve:
# upgrade path is a bot check in front of the route (an edge challenge, or a
# proof the header cannot forge), not a bigger bucket.
_SHARED_PEER_CAPACITY = 20.0
# ponytail: keys are caller-supplied, so the map is swept rather than
# trusted to be small. Ceiling: a caller who keeps one attempt alive per
# distinct address pins that many entries until they lapse. Upgrade path:
# swap the dict for an LRU if that shows up in memory.
_SIGNIN_BUCKETS: dict[str, tuple[float, float]] = {}
_SIGNIN_SWEEP_AT = 0.0


def _signin_allowed(peer: str, email: str, forwarded: str = "",
                    *, prefix: str = "") -> bool:
    """Token bucket for the sign-in routes: per socket peer, per hop, per address.

    All three keys are charged from the same state, so neither a rotated
    address nor a rotated header gets around the peer key, and the peer key
    is the one they cannot rotate — it comes off the socket.

    `forwarded` is charged at the tight capacity because it is what a
    behind-the-proxy caller is metered on; it is also what an attacker
    controls, so it is deliberately *not* the bound.

    `prefix` is a key **namespace**, not a capacity: the waitlist reuses this
    limiter because a second bucket would be a second door, and gets its own
    keys because sharing the peer bucket let an anonymous visitor drain the
    sign-in routes' allowance for every beta user behind the same router
    address.
    """
    global _SIGNIN_SWEEP_AT
    now = time.monotonic()
    if now >= _SIGNIN_SWEEP_AT:
        _SIGNIN_SWEEP_AT = now + 60.0
        for key in [k for k, (_, ts) in _SIGNIN_BUCKETS.items() if now - ts > 600.0]:
            del _SIGNIN_BUCKETS[key]
    keys = [(f"{prefix}peer:{peer}", _SHARED_PEER_CAPACITY),
            (f"{prefix}email:{email}", _SIGNIN_BUCKET_CAPACITY)]
    if forwarded:
        keys.append((f"{prefix}hop:{forwarded}", _SIGNIN_BUCKET_CAPACITY))
    allowed = True
    for key, capacity in keys:
        tokens, seen = _SIGNIN_BUCKETS.get(key, (capacity, now))
        tokens = min(capacity, tokens + (now - seen) * _SIGNIN_REFILL_PER_SECOND)
        allowed = allowed and tokens >= 1.0
        _SIGNIN_BUCKETS[key] = (tokens - 1.0, now)
    return allowed


def _signin_peer(request: Request) -> str:
    """Who to meter this sign-in attempt against — the socket, not the header.

    This used to be the forwarded first hop, because behind a proxy
    `client.host` is the proxy for everybody and the limit would then be five
    sign-ins per ten minutes for the whole beta. But the header is set by the
    caller: rotating it gave a fresh bucket on every request, so the half that
    was supposed to stop bulk writes was the half being varied. `X-Forwarded-
    For` is only meaningful behind a proxy that **overwrites** it, and
    assuming otherwise is what made the limit decorative.

    So the socket peer is the key — unforgeable, and therefore the only one
    that bounds a caller — sized for being shared (`_SHARED_PEER_CAPACITY`),
    and the forwarded hop is charged alongside it at the tight capacity. NAT
    collapse and header forgery pull in opposite directions and one bucket
    cannot serve both; charging both means the unforgeable half is always
    present, and the honest cost is written down beside it.
    """
    return _caller_key(request)


def _forwarded_hop(request: Request) -> str:
    """The forwarded first hop, or "" when the caller sent none.

    Read as a first-class key rather than as a substitute for the peer: it is
    caller-supplied, so it is a bucket an attacker can rotate, and it is kept
    because behind a proxy it is the closest thing to a per-caller address
    there is. A value with no safe alphabet is dropped rather than truncated —
    it becomes a bucket key, and a bucket key does not need to be a filename
    but does need to be bounded.
    """
    hop = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return hop if _HOST.match(hop) else ""


@app.post("/v1/auth/request-code")
async def request_login_code(request: Request):
    """Mail a 6-digit sign-in code.

    The answer is the same for an address that has an account, one that
    does not, and one on the beta roster: this route consults nothing
    that knows who is in the beta and swallows Supabase's answer rather
    than relaying it. A relay that told the caller which addresses exist
    is a directory of the beta.

    Signups are **on**, because there is otherwise no way for a brand-new
    person to obtain a credential at all — `profiles.id` is an FK into
    `auth.users`, so no row can be seeded for an address with no auth
    account. That is exactly why the value may not become conditional on
    the roster: it is the one branch on this route that would hand an
    unauthenticated caller a membership oracle. Approval happens at
    `exchange`, where the emailed code has already proved inbox control.
    """
    from .session.jwt_auth import (
        EMAIL_RE,
        SupabaseUnavailable,
        normalize_email,
        request_login_code as _send,
    )

    body = await _json_body(request)
    email = str(body.get("email", "") or "")
    # `fullmatch`, not `match`: the pattern is anchored with `^…$`, and `$`
    # also matches immediately before a trailing newline — so an address
    # ending in `\n` passes a `match` that a `fullmatch` rejects.
    if not EMAIL_RE.fullmatch(email):
        raise _BadRequest("email is required")
    if not _signin_allowed(_signin_peer(request), normalize_email(email),
                            _forwarded_hop(request)):
        return _error(429, "too many attempts — wait a few minutes and try again")
    try:
        await _send(email)
    except SupabaseUnavailable as exc:
        # The call did not complete, which says nothing about the address
        # — so it is safe to report, and reporting it is the difference
        # between "check your inbox" and "nothing is wrong, wait".
        log.warning("sign-in code request unavailable: %s", str(exc)[:40])
        return _error(502, "could not reach the sign-in service")
    return JSONResponse(content={"sent": True})


@app.post("/v1/auth/exchange")
async def exchange_login_code(request: Request):
    """Trade the emailed code for a relay access token, and say whether
    this identity is on the beta roster.

    Supabase's body names whether the address exists, what the code was
    worth and how long the project has been rate limited; none of it
    crosses back. The caller learns that its code did not work, which is
    all the panel can act on.

    **Reporting `approved` here is not the account-existence oracle
    `request-code` is not allowed to become**, and the difference is the
    gate: by the time this runs the caller has read a code out of an
    inbox it controls, which `request-code` cannot verify. `approved` is
    also only a report — `authorize_task_start` asks the same question
    again at task start, so this is a UI state and not the decision.
    """
    from .session.jwt_auth import (
        EMAIL_RE,
        SupabaseUnavailable,
        approve_at_exchange,
        exchange_login_code as _exchange,
        normalize_email,
    )

    body = await _json_body(request)
    email = str(body.get("email", "") or "")
    code = str(body.get("code", "") or "").strip()
    if not EMAIL_RE.fullmatch(email) or not code:
        raise _BadRequest("email and code are required")
    if not _signin_allowed(_signin_peer(request), normalize_email(email),
                            _forwarded_hop(request)):
        return _error(429, "too many attempts — wait a few minutes and try again")
    try:
        token = await _exchange(email, code)
    except SupabaseUnavailable:
        return _error(502, "could not reach the sign-in service")
    except ValueError:
        return _error(400, "invalid or expired code")
    # Never raises: a control plane that cannot answer this still leaves the
    # caller signed in, and the second wall decides at task start.
    approved = await approve_at_exchange(token)
    return JSONResponse(content={"access_token": token, "approved": approved})


# ---------------------------------------------------------------------------
# Session creation — called by the extension before connecting WS
# ---------------------------------------------------------------------------

@app.post("/v1/sessions")
async def create_session(request: Request):
    # Mints a session and allocates registry state, so it is gated like
    # the reads — otherwise anyone reaching the port can fill the registry
    # up to its 256-entry prune without ever holding the secret.
    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal

    session_id = str(uuid.uuid4())
    # Validate before the registry write: a rejected host must not consume one
    # of the 256 slots.
    host = request.url.netloc
    if not _HOST.match(host):
        raise HTTPException(status_code=400, detail="unroutable host header")
    scheme = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    if scheme not in ("http", "https"):
        scheme = "http"
    registry.get_or_create(session_id)
    # The one write to the owner field, in memory and on disk. On the hosted
    # relay this is what makes a session id mean "this person's transcript"
    # instead of "some transcript"; on self-host it stores None, changes
    # nothing and writes no sidecar.
    #
    # The disk half is not a cache of the registry — it is the only copy that
    # outlives this process. Without it, `DELETE /v1/sessions` answers
    # `{"deleted": 0}` after every dyno restart while every transcript is
    # still there, which is the erasure promise stated and not kept.
    registry.set_owner(session_id, _owner(auth.claims))
    from .agent import audit as _audit

    _audit.record_owner(session_id, _owner(auth.claims))
    _prune_sessions()
    # Advertise the address the caller actually reached us on, not a fixed
    # one: the extension dials `websocket_url` verbatim when it starts with
    # "ws", so a hardcoded localhost hands a remote client a socket pointed at
    # its own machine and the run dies silently on connect. Behind a TLS
    # terminator the socket scheme has to be wss or the handshake fails.
    log.info("session created  session_id=%s", session_id)
    return JSONResponse(status_code=201, content={
        "session_id": session_id,
        "websocket_url": f"{'wss' if scheme == 'https' else 'ws'}://{host}/ws/ext/{session_id}",
        "server_url": f"{scheme}://{host}",
    })


@app.get("/v1/sessions")
async def list_session_audits(request: Request):
    """Index of sessions, newest first.

    Gated on AGENT_SECRET, which is what closed the enumeration: this
    returned every session's task title to any caller that could reach
    the port. On a self-host that caller is the user, but a self-hoster
    who puts Caddy in front of it is publishing their own task history.

    On the hosted relay the index is filtered to the caller's own
    sessions. A valid token is not enough: with ten accounts behind one
    relay, the index *is* the directory of whose browsing this is.
    """
    from .agent.audit import list_sessions as _list

    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    sessions = _list()
    owner = _owner(auth.claims)
    if owner is not None:
        sessions = [s for s in sessions if registry.owns(s.get("session_id", ""), owner)]
    return JSONResponse(content={"sessions": sessions})


@app.get("/v1/sessions/{session_id}/audit")
async def read_audit(session_id: str, request: Request):
    """The full nested document for one session.

    A damaged file returns 200 with `corrupt: true` rather than an
    error: the file exists to survive a crash, and failing to read it is
    exactly the case it has to survive.
    """
    from .agent.audit import read as _read

    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    # Another account's session is a session that does not exist, not one
    # that is forbidden: a 403 confirms the id is real, and confirming
    # that is the whole of what the id is worth. Same rule as the bad-key
    # 404, one layer in.
    if not registry.owns(session_id, _owner(auth.claims)):
        return _error(404, "unknown session")
    doc = _read(session_id)
    if not doc.get("found"):
        return _error(404, "unknown session")
    # This route returns the user's own audit document, which is the whole
    # point of it. `_read` is where a read failure used to be stringified —
    # `str(OSError)` is the server's absolute path — and that was fixed at
    # the source. What reaches here now is either the parsed document or a
    # message `audit.read` wrote itself, never a raw exception. The rule is
    # switched off for this file in `.github/workflows/codeql.yml`.
    return JSONResponse(content=doc)


@app.delete("/v1/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    """Erase one session. `audit.delete` takes every file it owns.

    Separate from delete-all and behind the same secret: this is the one
    route where a wrong id is the difference between "I erased it" and
    "I erased the wrong one". On the hosted relay "the wrong one" means
    another beta user's, so the owner is checked first and a mismatch
    answers exactly what a nonexistent id answers.
    """
    from .agent.audit import delete as _delete

    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    if not registry.owns(session_id, _owner(auth.claims)):
        return _error(404, "unknown session")
    left: list[str] = []
    deleted = _delete(session_id, leftover=left)
    if left:
        # The erasure did not finish, so the registry keeps claiming the
        # session: dropping the owner here would make this account unable to
        # reach the file that survived, permanently, and the next scoped
        # erase-all would report nothing left to do.
        log.error(
            "session %s: %d file(s) could not be erased, ownership retained: %s",
            session_id, len(left), ",".join(left),
        )
    else:
        registry.forget_owner(session_id)
    return JSONResponse(content={"deleted": deleted, "residue": len(left)})


@app.delete("/v1/sessions")
async def delete_all_sessions(request: Request):
    """Erase every session on this server.

    On the hosted relay that means every session *this account* opened.
    The sweep is scoped rather than merely counted, because the residue
    pass globs `*<ext>` across the directory — unscoped it would unlink
    another user's scratchpad while the count described something else.
    """
    from .agent.audit import delete_all as _delete_all

    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    owner = _owner(auth.claims)
    if owner is None:
        deleted, residue = _delete_all()
    else:
        # Snapshot the ids before the sweep: `delete_all` is what removes the
        # files, and the ownership entries have to follow so a second
        # "erase all" does not count the same erased session again.
        mine = registry.owned_sessions(owner)
        deleted, residue = _delete_all(only=mine)
        if not residue:
            # Only a sweep that finished gives up ownership. Files that
            # stayed put are still on disk and still only reachable by id,
            # so dropping the entries would strand them and the next
            # erase-all would answer `{"deleted": 0}` — the untruthful
            # erasure this scoping exists to prevent.
            for sid in mine:
                registry.forget_owner(sid)
    # `residue` travels back because a file that could not be unlinked is
    # still on disk, and the panel is the only thing that can tell the user
    # their deletion did not finish. Answering `deleted: n` regardless would
    # claim an erasure that did not happen.
    return JSONResponse(content={"deleted": deleted, "residue": residue})


# ponytail: separate HTTP endpoint for save-time notification. The
# WS-based `policy_acknowledged` only works while a task is in flight;
# this one logs even when the user clicks Save with no task running.
@app.post("/v1/policy_ack")
async def policy_ack(request: Request):
    _, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    body = await _json_body(request)
    settings = body.get("settings") or {}
    user_id = _caller_key(request, body.get("user_id"))
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
    # Count, not the list: the blocked domains are the user's browsing, and
    # this line plus the audit decision below are the two places a
    # self-hoster's rotated log files hand them to whoever reads them.
    log.warning(
        "[%s] POLICY: user saved settings  blacklist=%d",
        user_id, len(blacklist if isinstance(blacklist, list) else []),
    )
    try:
        from .agent.audit import append_policy_event
        append_policy_event(
            f"client-{user_id}",
            step=None, kind="policy_acknowledged",
            domain=None, action=None,
            decision=f"blacklist_count={len(blacklist if isinstance(blacklist, list) else [])}",
        )
    except Exception as exc:
        log.warning("failed to persist policy_acknowledged: %s", exc)
    return JSONResponse(content={"ok": True})


# ---------------------------------------------------------------------------
# Failure reports — the runs that did not happen
# ---------------------------------------------------------------------------
#
# **This route does not exist on a self-hosted install.** Not "does nothing":
# 404s, so a self-hoster's box holds no report table, no report route and no
# knowledge that the feature exists. Self-host is the product; its users get
# a silent build. Gate is `auth_mode() == "jwt"` and nothing else — a
# self-hoster holding a copy of the cloud env must not switch it on by
# accident either.
#
# HTTP on the same origin as every other extension call, so CORS is
# unchanged: `allow_origin_regex` above already permits exactly
# `chrome-extension://<id>` and refuses everything else, and reporting
# inherits that rather than widening it.
#
# The client reaches this route **on a connection that already succeeded**,
# which is the whole design: a relay that is down cannot receive a report
# about being down. So the extension queues codes locally and flushes them
# on the next `ws.onopen`, which is also the moment its credential is known
# to have been accepted — so a refusal is reported once the user signs in
# again, which is when the report is worth having.
@app.post("/v1/reports")
async def create_reports(request: Request):
    from .session import failure_report as fr

    auth, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    if not fr.reporting_enabled():
        return _error(404, "not found")
    owner = auth.claims.sub if auth.claims is not None else None
    if not owner:
        # jwt mode authenticated by something else. Nothing here can name
        # whose run this was, so there is nothing to write.
        return _error(404, "not found")
    if not fr.report_allowed(owner):
        # 429, not 404: the caller is authenticated and the route exists, and
        # saying so is what stops a client-side retry from turning one bad
        # install into a row per reconnect for a day.
        return _error(429, "too many reports — they will resume shortly")
    try:
        body = await _json_body(request)
    except _BadRequest as exc:
        return _error(400, str(exc))
    rows, offered = fr.build_client_rows(body, owner, fr.relay_version())
    # The answer carries a count, never a code. Echoing codes back would make
    # this a "which codes does the relay accept" oracle; `offered` vs `kept`
    # is what an operator actually needs when a build reports something the
    # relay has not heard of.
    fr.spawn(fr.record(rows))
    if offered != len(rows):
        log.info("failure reports  kept=%d offered=%d  (unknown codes dropped)", len(rows), offered)
    return JSONResponse(content={"accepted": len(rows)})


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

    _, refusal = await _approved(request)
    if refusal is not None:
        return refusal
    body = await _json_body(request)
    url = str(body.get("url", "") or "").strip()
    if not url:
        return _error(400, "url is required")
    title = str(body.get("title", "") or "")
    page_text = str(body.get("page_text", "") or "")

    client_host = _caller_key(request, body.get("device_id"))
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
        result = await generate(url, title, cfg, creds, page_text=page_text)
    except Exception as exc:
        # 502 rather than 500 so the panel can tell "your server couldn't do
        # this" from "your request was malformed" and keep its fallback.
        log.warning("suggestions failed for %s: %s", url[:120], exc)
        return _error(502, str(exc))
    # context_used is what the panel needs to decide how long to keep the
    # result: a line derived from page text is page content, and storing one
    # in chrome.storage.local for a day is a leak the user never agreed to.
    # It comes from `generate`, which is what actually put the text in the
    # prompt — not from whether the request carried a `page_text` field.
    return JSONResponse(content={"lines": result.lines, "context_used": result.context_used})


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
    # The url path, so it is caller-controlled before a word is logged.
    # `device_id` got this treatment for the same reason and on the same
    # frame; without it this id is a log-forging primitive on every log line
    # below and the stem of the document written under logs/sessions/.
    # Session ids are minted as uuid4 by POST /v1/sessions, so nothing else
    # is a legitimate one.
    if not _UUID.match(session_id):
        log.warning("extension rejected — session id is not a uuid")
        await websocket.close(code=4004)
        return

    offered = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
    # The subprotocol spelling resolves as the *header* transport, because
    # it is the credential that arrived on the handshake; `?token=` is the
    # query spelling and jwt mode refuses that one (see `authenticate`).
    auth = authenticate(
        websocket.headers.get("authorization") or (offered[1] if len(offered) > 1 else None),
        websocket.query_params.get("token"),
    )
    if not auth.ok:
        # 4003 is "a credential was required and none arrived", and it is
        # a separate code only because the hosted relay made the two cases
        # indistinguishable: an extension old enough to predate the token
        # sends nothing (its own 120-character cap silently drops a JWT),
        # which used to close 4001 — byte-identical to "wrong secret", so
        # a beta user could not tell "sign in again" from "your token is
        # stale". Self-host has one credential and keeps one answer.
        log.warning(
            "[%s] extension rejected — %s token", session_id,
            "no" if auth.verdict == "missing" else "bad",
        )
        await websocket.close(code=4003 if auth.verdict == "missing" else 4001)
        return

    # Ownership, before accept and with the same close code as an id that
    # was never a session. A valid token for *another* beta account is not a
    # credential failure — it authenticated perfectly — so it must not get
    # the credential answers either, or the difference between 4001/4003
    # and 4004 tells an attacker which session ids are real. 4004 is
    # already "this is not a session you can drive".
    if not registry.owns(session_id, _owner(auth.claims)):
        log.warning("[%s] extension rejected — not the owner of this session", session_id)
        await websocket.close(code=4004)
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
        # Log the shape, not the frame. `raw[:200]` looked safe and was not:
        # api_key is appended last in `background.ts`, but on a short task with
        # an empty user_policy it lands around character 138, well inside the
        # window. The startup log's length-only convention is undone by this
        # line, so the key is removed before anything is written.
        _logged = {k: v for k, v in msg.items() if k != "api_key"}
        _logged["api_key"] = "<redacted>" if "api_key" in msg else None
        log.debug("[%s] ← %s", session_id, json.dumps(_logged)[:200])
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
        await _task_failed(
            ws_send,
            "duplicate_task_start",
            "Refused: this session already has a running agent. "
            "Starting a second one would put two agents on one browser.",
            auth.claims,
            status="interrupted",
        )
        await ws_send({"type": "canonical_status", "status": "interrupted"})
        await websocket.close(code=4009)
        return

    # Revocation and the weekly task cap, here and only here. The JWT says
    # who you are and nothing about whether you are still welcome, so this
    # is the one place the control plane is asked — a task start is the
    # only moment a decision is made, and putting it on the request path
    # would make every step of every run depend on Supabase's uptime.
    # Self-host has no claims here and never reaches this block.
    if auth.claims is not None:
        from .session.jwt_auth import AccountRefused, authorize_task_start

        try:
            await authorize_task_start(auth.claims)
        except AccountRefused as exc:
            log.warning(
                "[%s] task_start refused  reason=%s", session_id, exc.reason,
            )
            await _task_failed(
                ws_send,
                _REFUSAL_REASON.get(exc.reason, "control_plane_unavailable"),
                exc.detail,
                auth.claims,
                status="refused",
            )
            await ws_send({"type": "canonical_status", "status": "interrupted"})
            await websocket.close(code=4005)
            return

    eval_queue: asyncio.Queue = asyncio.Queue()
    relay = ExtensionCDPRelay(ws_send, obs_queue, eval_queue, session_id)

    # ponytail: not session_id — that is fresh per /v1/sessions call, so
    # anything stashed under it is dead the moment the next task opens a
    # new session. The key is the install's `device_id`, and it matches the
    # one /v1/policy and /v1/policy_ack use — making the four callers agree.
    client_host = _caller_key(websocket, msg.get("device_id"))

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
            await _task_failed(
                ws_send,
                "model_not_found",
                f"Unknown provider: {provider_name}",
                auth.claims,
            )
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
                    # Wake the waiter, but do not pretend this is a page. It
                    # used to be a blank observation, which the harness built
                    # a step from and handed to the model as though the site
                    # had rendered nothing — so a debugger Chrome had ended
                    # under us read as a web page with no controls on it. The
                    # relay raises on this key; see `_unwrap_observation`.
                    await obs_queue.put({"__error__": incoming.get("error") or "observation failed"})
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
                    # ponytail: user clicked "Clear approval" within the
                    # post-approval window. Clears the first-time-seen cache so
                    # the next step re-prompts. With deny-aborts-task semantics
                    # an approved action can't be undone — the task is over
                    # once it runs.
                    #
                    # It does NOT un-approve a *domain*. Approving one does
                    # three things: seen_first_time.add, visited_domains.add,
                    # and grant_domain to the policy file. Clearing the first
                    # leaves the other two, and the domain gate short-circuits
                    # on visited_domains before consulting seen_first_time — so
                    # for a domain approval this frame is a no-op, and the disk
                    # grant outlives it regardless. Real revocation is a
                    # separate feature (the frame needs the domain, and
                    # persist needs a revoke_domain); do not imply the button
                    # does more than it does.
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
                    # Record that it happened, independent of any
                    # task_start — as a count, not the domains themselves.
                    settings = incoming.get("settings") or {}
                    blacklist = settings.get("blacklist")
                    n_blacklist = len(blacklist if isinstance(blacklist, list) else [])
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
                        "[%s] POLICY: user saved settings  blacklist=%d",
                        session_id,
                        n_blacklist,
                    )
                    try:
                        from .agent.audit import append_policy_event
                        append_policy_event(
                            session_id,
                            step=None, kind="policy_acknowledged",
                            domain=None, action=None,
                            decision=f"blacklist_count={n_blacklist}",
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
            # Only the CODE crosses into the report, never `summary`: the
            # summary is the agent's own prose about what it tried, and the
            # agent's prose can quote the page.
            reason = result.failure_reason
            if reason:
                from .session.failure_report import note_failure

                note_failure(reason, "task_result", auth.claims)
            await ws_send({"type": "task_result", "result": result.model_dump()})
        except asyncio.CancelledError:
            log.info("[%s] agent task cancelled", session_id)
        except Exception as exc:
            log.error("[%s] agent task raised: %s", session_id, exc, exc_info=True)
            from .session.failure_report import note_failure

            # `internal`, not `str(exc)`: the exception text is free prose
            # and can quote a URL or a field from the page. The code is what
            # the ledger stores; the detail stays in this log line, which is
            # ours and expires with the dyno.
            note_failure("internal", "task_error", auth.claims)
            await ws_send({"type": "task_error", "error": str(exc)})
        log.info("[%s] session closed", session_id)


# ---------------------------------------------------------------------------
# Playwright WebSocket — for headless / desktop connector mode
# ---------------------------------------------------------------------------

@app.websocket("/ws/{user_id}")
async def websocket_agent(websocket: WebSocket, user_id: str):
    # Same two guards `/ws/ext` and every session route already have, and for
    # the same reasons. `user_id` was logged unvalidated *before* the token
    # check, so anyone who could reach this port could forge log lines — the
    # identical primitive that was closed on `device_id` and `session_id`.
    if not _UUID.match(user_id):
        await websocket.close(code=4004)
        return

    # `/run` refuses in prod because it launches a browser on a caller-supplied
    # task. This route launches one too, headless=False at `submit_task`, so
    # the refusal was one-sided: the capability was refused over HTTP and
    # served over WebSocket.
    if _is_prod():
        log.warning("/ws/%s: refused  BROTTO_ENV=prod", user_id)
        await websocket.close(code=4004)
        return

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
                            if _is_prod():
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
    # Refused outright in prod, not merely authenticated. Nothing in the
    # shipped product calls this: the extension drives the agent over
    # /ws/ext, in the user's own logged-in browser. This launches a headless
    # Chromium on a caller-supplied task and URL, so on a reachable port it
    # is a browser the operator did not ask for, driven by whoever found it.
    if _is_prod():
        log.warning("/run: refused  BROTTO_ENV=prod")
        return _error(404, "not found")

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
            if _is_prod():
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


# ---------------------------------------------------------------------------
# The waitlist form — its own application, and its own CORS
# ---------------------------------------------------------------------------
#
# **The only route here that answers a caller holding no credential, and the
# first thing this project stores about someone who is not an account.** It is
# 404 unless `waitlist_enabled()`, which is `auth_mode() == "jwt"` — so a
# self-hosted box does not have this feature at all rather than having it
# quietly switched on by a leftover `SUPABASE_URL`.
#
# Unauthenticated by definition: a visitor on a marketing page has no key and
# cannot be issued one, so gating it would be a closed door in front of the
# only caller it has. That makes it a way to write to our table and nothing
# else, which is why the three things below are load-bearing rather than
# careful:
#
#   * the **meter**, so an open form is not a bulk-write button;
#   * the **narrow row** (`waitlist.build_row` — an email, a bounded display
#     name, and the operator's batch), so nothing a browser can send — a
#     referrer, a user agent, a URL, a free-text note — has somewhere to land;
#   * the **same answer either way**, so it cannot be asked who is on the list.
#
# **It is its own `FastAPI()` because CORS middleware is per-application.**
# There is no per-route CORS in Starlette, so the only way to let one page's
# origin reach one route is to put that route on an application that has its
# own middleware — and the alternative, which shipped first, was adding the
# marketing hosts to the allowlist above, which is an allowlist entry that
# reaches *every* route including the transcript reads. An allowlist entry is
# not a grant of access to one route; only an application is.
#
# Two spellings of one site, listed rather than pattern-matched — a `.*`
# would be the reflection this whole thing exists to refuse. Only `POST`, and
# only `Content-Type`, because only those two are what a form submit needs.
#
# **The mount is at `/v1`, not at `/v1/waitlist`, and it is here at the end of
# the file for both reasons.** `app.mount("/v1/waitlist", …)` compiles to
# `^/v1/waitlist/(?P<path>.*)$`, which `POST /v1/waitlist` does not match —
# it would fall through to `redirect_slashes` and answer 307, and the
# marketing form is already written against the exact URL. And Starlette
# matches routes in registration order, so a mount declared above
# `/v1/sessions` would swallow it: a `Mount("/v1")` placed last sees only
# what no other route claimed, which for `/v1/sessions` is nothing.
waitlist_app = FastAPI()
waitlist_app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https://(brotto\.dev|suryanshgupta9933\.github\.io)$",
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@waitlist_app.exception_handler(StarletteHTTPException)
async def _waitlist_http_exc(_request: Request, exc: StarletteHTTPException):
    """The same envelope as every other 404 on this server.

    The sub-app answers its own routing failures, and `app.mount("/v1", …)`
    means it answers for `/v1/…` too — so without this, a wrong URL under
    `/v1` came back as `{"detail": "Not Found"}` while every other failure on
    the server used `_error`. One error shape, and this is the part of it that
    a mount can quietly undo.
    """
    return _error(exc.status_code, str(exc.detail))


@waitlist_app.post("/waitlist")
async def join_waitlist(request: Request, background: BackgroundTasks):
    """Take one email address and, optionally, the name to address the invite
    to. The reply does not say whether it was new."""
    from .session import waitlist as wl
    from .session.jwt_auth import EMAIL_RE, normalize_email

    if not wl.waitlist_enabled():
        return _error(404, "not found")
    # Caught rather than allowed to propagate: the `_BadRequest` handler is
    # registered on `app` and this route is dispatched by the mounted
    # sub-application, so a raise here comes back as a 500 — on a route whose
    # every other error path is a 400. Same pattern as `create_reports`.
    #
    # Deliberately *after* the meter below's sibling, the email validation:
    # charging a token for a typo teaches a visitor the site rejects them
    # (pinned by `test_a_malformed_address_does_not_spend_a_token`). A body
    # that will not parse is not a typo, and unmetered JSON parsing of a
    # capped-size body is not the thing the meter exists to bound.
    try:
        body = await _json_body(request)
    except _BadRequest as exc:
        return _error(400, str(exc))
    # Normalise before validating: a pasted address with a trailing space is
    # the same person as one without, and EMAIL_RE has no reason to know that.
    email = normalize_email(str(body.get("email", "") or ""))
    if not EMAIL_RE.fullmatch(email):
        # 400, and it says nothing about the address: a malformed address was
        # never written anywhere, so there is no membership to reveal.
        # Explicit rather than a raised `_BadRequest`, because the exception
        # handler for that is registered on `app` and this route is dispatched
        # by the mounted sub-application below.
        return _error(400, "a valid email address is required")
    # The sign-in limiter, reused rather than duplicated — with **its own key
    # namespace**. The two routes key on the same socket peer, and that peer
    # half is what the anti-spam argument rests on; sharing the *bucket* meant
    # an anonymous visitor who drained the waitlist's twenty writes also
    # locked every beta user behind the same router address out of asking for
    # a login code, which is a denial of service on the one route a paying
    # user needs. Same limiter, same capacities, same "consults nothing about
    # the beta roster" property — a separate set of keys.
    #
    # The address half is namespaced by the same `prefix`, because this is an
    # *open* form: sharing that would mean a stranger submitting somebody
    # else's address five times blocks that person from asking for their own
    # sign-in code for ten minutes.
    if not _signin_allowed(_signin_peer(request), email,
                            _forwarded_hop(request), prefix="waitlist:"):
        return _error(429, "too many attempts — wait a few minutes and try again")
    # The one field the visitor typed that is not an address, so the operator
    # can address the invite they are about to send. Bounded at
    # `NAME_MAX_CHARS` inside `build_row`, stripped here, and absent from the
    # answer either way — a signup is `{"ok": true}` whatever the body said.
    name = str(body.get("name", "") or "").strip()
    signup = await wl.add(email, name)
    if not signup.ok:
        # Fixed text. The address is not in it, and neither is a PostgREST
        # body — a PostgREST error quotes the row.
        return _error(502, "could not record that address — try again later")
    # The confirmation goes to a **first** signup only, and it is handed to a
    # background task rather than awaited. Both halves are the same guard: if
    # this call waited on Resend, a duplicate would answer in 10ms and a new
    # address in the time it takes to fetch a blog index — a membership oracle
    # with a stopwatch attached. Starlette sends this response first and runs
    # the task after it, so the answer the visitor sees cannot depend on the
    # send, on Resend existing, or on the fetch.
    if signup is wl.Signup.CREATED:
        from .session.waitlist_email import send_confirmation

        background.add_task(send_confirmation, email)
    return JSONResponse(content={"ok": True})


app.mount("/v1", waitlist_app)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="debug")
