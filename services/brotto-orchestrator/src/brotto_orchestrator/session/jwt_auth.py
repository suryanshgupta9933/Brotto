"""Hosted-relay credentials: a Supabase JWT verified here, and the
control-plane lookups that decide whether the person holding it may run.

Verification is local and stateless on purpose. The relay must not call
Supabase on every request — a network hop there would make the liveness
of the whole agent loop depend on a third party's uptime — and D9 puts
session state in the extension, not on this box, so an opaque token
resolved against a claims map would be exactly the server-side session
state D9 rules out. Supabase signs with HS256, so `hmac` plus a base64
decode is the whole verifier, against the project JWT secret.

The `profiles` lookups are the other half and they are deliberately NOT
here: revocation and the weekly task cap are read at task start, which
is the only moment a decision is made, so the request path stays
identical in shape to the self-hosted one.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import aiohttp

log = logging.getLogger("brotto.jwt_auth")

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$")

# The relay's own timeouts. Supabase answering slowly must not become a
# hung agent loop, and a control plane that cannot be reached is a
# refusal rather than a wait — see authorize_task_start.
SUPABASE_TIMEOUT_SECONDS = 5.0

# The beta cap. The decision doc starts a per-user week at 10 tasks; the
# env override exists because the rollout is batched and the first batch
# is not the last batch.
BETA_TASK_CAP_ENV = "BROTTO_BETA_TASK_CAP"
_DEFAULT_TASK_CAP = 10


@dataclass(frozen=True)
class Claims:
    """What a verified Supabase JWT is used for."""

    sub: str
    email: str


class AccountRefused(Exception):
    """A task this identity may not start, with the reason the panel shows.

    `reason` is a fixed set of machine words, never text from Supabase:
    this ends up in a user-facing frame.
    """

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


def jwt_secret() -> str:
    return os.getenv("SUPABASE_JWT_SECRET", "").strip()


def jwt_enabled() -> bool:
    """Whether this relay authenticates with Supabase JWTs."""
    return bool(jwt_secret())


def _b64(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def verify_jwt(token: str) -> Claims | None:
    """Verify an HS256 Supabase JWT locally. Claims, or None.

    None means "not a credential this relay accepts" and deliberately
    does not distinguish why: a bad signature, an expired token and a
    malformed header are the same answer to the caller.
    """
    secret = jwt_secret()
    if not secret or not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(_b64(header_b64))
    except Exception:
        return None
    # Algorithm confusion, before any comparison: a token naming `none`
    # — or naming RS256 and carrying a public key as HMAC material — must
    # never reach the compare_digest below. The secret decides which
    # algorithm is acceptable, not the token.
    if not isinstance(header, dict) or header.get("alg") != "HS256":
        return None
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{header_b64}.{payload_b64}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    try:
        signature = _b64(signature_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        claims = json.loads(_b64(payload_b64))
    except Exception:
        return None
    if not isinstance(claims, dict):
        return None
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or exp <= time.time():
        return None
    sub = str(claims.get("sub") or "").strip()
    if not sub:
        return None
    return Claims(sub=sub, email=str(claims.get("email") or ""))


def make_jwt(payload: dict, secret: str) -> str:
    """Sign a token. Test-only — nothing in the server issues one."""
    header = _seg({"alg": "HS256", "typ": "JWT"})
    body = _seg(payload)
    signing_input = f"{header}.{body}"
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(signature).decode('ascii').rstrip('=')}"


def _seg(obj: dict) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


# ---------------------------------------------------------------------------
# Supabase control plane — task start only, never the request path
# ---------------------------------------------------------------------------

class SupabaseUnavailable(Exception):
    """Supabase did not answer. Not the same as an answer of "no"."""


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


def _service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def _anon_key() -> str:
    return os.getenv("SUPABASE_ANON_KEY", "").strip()


async def _supabase_call(
    method: str, path: str, *, json_body: dict, api_key: str, service: bool = False
) -> tuple[int, str]:
    """One authenticated call to Supabase. Status and raw text.

    The text is returned unparsed so every caller decides what a body
    means; nothing here logs it, because these bodies hold email
    addresses and service-key material.
    """
    url = f"{_supabase_url()}/{path.lstrip('/')}"
    headers = {"apikey": api_key, "Content-Type": "application/json"}
    if service:
        headers["Authorization"] = f"Bearer {api_key}"
    timeout = aiohttp.ClientTimeout(total=SUPABASE_TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, url, json=json_body, headers=headers) as resp:
                return resp.status, await resp.text()
    except Exception as exc:
        raise SupabaseUnavailable(type(exc).__name__) from exc


def _profiles(
    method: str, query: str, body: dict | None = None, *, path: str = "rest/v1/profiles"
) -> tuple[int, str]:
    """A PostgREST call bound to the service role. The one seam tests stub.

    `path` is the whole relative path because the cap reservation is an
    RPC against the same table, not a REST verb on it — both go through
    here so one stub in a test covers the whole control plane.
    """
    return _supabase_call(
        method, f"{path}{query}", json_body=body or {}, api_key=_service_key(), service=True
    )


def _task_cap() -> int:
    raw = os.getenv(BETA_TASK_CAP_ENV, "").strip()
    if not raw:
        return _DEFAULT_TASK_CAP
    try:
        cap = int(raw)
    except ValueError:
        log.warning("%s=%r is not a number — using %d", BETA_TASK_CAP_ENV, raw, _DEFAULT_TASK_CAP)
        return _DEFAULT_TASK_CAP
    return cap if cap > 0 else _DEFAULT_TASK_CAP


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def request_login_code(email: str) -> None:
    """Ask Supabase to mail a 6-digit sign-in code.

    Raises SupabaseUnavailable only when the call did not complete. A
    Supabase *answer* is swallowed whatever it says, because "signups not
    allowed for otp" and "user not found" are exactly the two responses
    that turn this route into an account-existence oracle.
    """
    key = _anon_key()
    if not _supabase_url() or not key:
        raise SupabaseUnavailable("not configured")
    try:
        status, _ = await _supabase_call(
            "POST",
            "auth/v1/otp",
            json_body={"email": normalize_email(email), "create_user": False},
            api_key=key,
        )
    except SupabaseUnavailable:
        raise
    except Exception as exc:
        log.warning("sign-in code request failed: %s", type(exc).__name__)
        return
    if status >= 400:
        log.warning("sign-in code request answered %d", status)


async def exchange_login_code(email: str, code: str) -> str:
    """Verify the emailed code. The relay's access token, or raise ValueError.

    ValueError carries no Supabase text — the body names whether the
    address exists, what the code was worth, and how long the project has
    been rate limited.
    """
    key = _anon_key()
    if not _supabase_url() or not key:
        raise SupabaseUnavailable("not configured")
    status, text = await _supabase_call(
        "POST",
        "auth/v1/verify",
        json_body={
            "email": normalize_email(email),
            "token": code.strip(),
            "type": "email",
        },
        api_key=key,
    )
    if status >= 400:
        raise ValueError("invalid or expired code")
    try:
        token = json.loads(text).get("access_token")
    except Exception as exc:
        raise ValueError("invalid or expired code") from exc
    if not isinstance(token, str) or not token:
        raise ValueError("invalid or expired code")
    return token


async def authorize_task_start(claims: Claims) -> None:
    """Revocation and the weekly cap, checked once per task. Raises AccountRefused.

    Fails **closed** if Supabase cannot be reached. That is the right
    direction only here: this is the hosted relay, where the transcript
    of every task lands on our disk, and "we could not check whether this
    person was revoked" is not a licence to record one more. Self-host
    never reaches this function — it has no Supabase configured and
    authenticates with `AGENT_SECRET`.
    """
    if not _supabase_url() or not _service_key():
        raise AccountRefused(
            "control_plane_unavailable",
            "This relay has no Supabase configuration, so it cannot tell whether "
            "your access is still active.",
        )
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        status, text = await _profiles(
            "GET", f"?id=eq.{claims.sub}&select=revoked_at,week_start,tasks_this_week"
        )
        if status >= 400:
            raise AccountRefused("control_plane_unavailable", "Could not confirm your access.")
        rows = json.loads(text)
    except AccountRefused:
        raise
    except Exception as exc:
        log.warning("profile lookup failed: %s", type(exc).__name__)
        raise AccountRefused("control_plane_unavailable", "Could not confirm your access.") from exc

    if not isinstance(rows, list) or not rows:
        # Invitations are hand-issued: a valid JWT with no row is somebody
        # who signed in without being invited, which is not a beta user.
        raise AccountRefused(
            "not_invited",
            "This account is not part of the beta. Ask the operator for an invitation.",
        )
    row = rows[0] if isinstance(rows[0], dict) else {}
    if row.get("revoked_at"):
        raise AccountRefused("revoked", "This account's access has been withdrawn.")
    # The counter resets by comparing week_start to today on read. A cron
    # to reset a number ten people move a few hundred times is a cron that
    # quietly stops running.
    used = row.get("tasks_this_week") if row.get("week_start") == today else 0
    used = used if isinstance(used, int) and used > 0 else 0
    cap = _task_cap()
    if used >= cap:
        raise AccountRefused(
            "task_cap_reached",
            f"You have used this week's {cap} tasks. They reset on Monday.",
        )
    # The increment itself is one conditional statement in Postgres
    # (`reserve_task_slot`, migrations/001_profiles.sql). Comparing here and
    # PATCHing afterwards is a read-then-write race: two starts for one
    # account both read `used = 9`, both pass, both write 10, and one task
    # is granted past the cap. A `false` return means the row did not
    # match the predicate — someone else took the last slot, or the
    # account was revoked between the read above and here.
    try:
        status, text = await _profiles(
            "POST", "", {"uid": claims.sub, "cap": cap},
            path="rest/v1/rpc/reserve_task_slot",
        )
    except Exception as exc:
        log.warning("task reservation failed: %s", type(exc).__name__)
        raise AccountRefused("control_plane_unavailable", "Could not record this task.") from exc
    if status >= 400:
        raise AccountRefused("control_plane_unavailable", "Could not record this task.")
    if text.strip() != "true":
        raise AccountRefused(
            "task_cap_reached",
            f"You have used this week's {cap} tasks. They reset on Monday.",
        )