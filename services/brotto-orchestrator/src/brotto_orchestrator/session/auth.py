from __future__ import annotations

import hmac
import os
from typing import NamedTuple

from . import jwt_auth

# Every placeholder value `.env.example` has ever shipped. An earlier one was
# `replace-me-with-secrets-token-urlsafe-32` — a *working* secret, because
# `_secret()` returned whatever was set. Every deployment that copied the file
# without editing it was running with a credential published in this repository,
# guarding a relay that can drive a logged-in browser. Unlike the old
# `"dev-secret"` default, which was ignored, this one was enforced, so it looked
# secure.
_PLACEHOLDER_SECRETS = {
    "replace-me-with-secrets-token-urlsafe-32",
}


def _secret() -> str:
    return os.getenv("AGENT_SECRET", "").strip()


def is_placeholder(value: str) -> bool:
    """Whether a set secret is one `.env.example` has shipped.

    That file now ships empty and compose's `${AGENT_SECRET:?}` fires instead.
    This is the backstop for the paths compose does not cover: `python main.py`,
    and a `.env` copied before the change.
    """
    return value.strip() in _PLACEHOLDER_SECRETS


def auth_enabled() -> bool:
    """Whether a request must present AGENT_SECRET.

    Read at call time, not import time: main.py calls load_dotenv() and
    several tests set the env after import, and a cached module constant
    silently ignores both.

    No secret means auth is *impossible*, not that it was declined — a
    developer on loopback has none and needs none. But a self-hoster who
    sets AGENT_SECRET now has it enforced, which is the case that used to
    do nothing at all: AGENT_AUTH_DISABLED defaulted to "true", so the
    secret docker-compose tells you to set was read by nobody.
    """
    if _secret():
        return os.getenv("AGENT_AUTH_DISABLED", "false").lower() != "true"
    return False


def auth_mode() -> str:
    """Which credential this relay demands: "open", "secret" or "jwt".

    Read at call time for the same reason `auth_enabled` is: load_dotenv()
    runs at import of main.py and tests set the env after it.

    `SUPABASE_JWT_SECRET` wins when both are set. A hosted relay that
    kept accepting `AGENT_SECRET` would hand every beta user a shared
    secret, which is the model this mode exists to replace — and it would
    do so quietly, because both variables being set looks like a config
    mistake rather than a downgrade.
    """
    if jwt_auth.jwt_enabled():
        return "jwt"
    if auth_enabled():
        return "secret"
    return "open"


class AuthResult(NamedTuple):
    """One credential check, with the three answers that are not the same.

    `missing` exists because "a credential was required and none arrived"
    and "a credential arrived and was wrong" are indistinguishable to a
    user holding an extension too old to send one — the old build's
    120-character cap means it sends nothing at all, and both cases used
    to close 4001 byte-identically.
    """

    verdict: str  # "ok" | "missing" | "bad"
    claims: jwt_auth.Claims | None = None

    @property
    def ok(self) -> bool:
        return self.verdict == "ok"


def authenticate(authorization: str | None, query_token: str | None = None) -> AuthResult:
    """The one credential check, for every transport.

    A browser cannot set headers on a WebSocket, so the extension relay
    passes the credential as a WebSocket subprotocol. `?token=` is
    accepted as a fallback for curl and the protocol tests. Both
    spellings resolve here rather than at each call site, so adding a
    route cannot pick the wrong one — and adding a *credential* cannot
    leave one of the call sites checking only the old one.
    """
    token = (authorization or "").replace("Bearer ", "", 1).strip()
    token = token or (query_token or "").strip()
    if auth_mode() == "jwt":
        if not token:
            return AuthResult("missing")
        claims = jwt_auth.verify_jwt(token)
        return AuthResult("ok", claims) if claims else AuthResult("bad")
    if validate_token(token):
        return AuthResult("ok")
    # Self-host gets no distinction: one credential has always answered
    # one way, and a beta-only close code must not change what a
    # self-hoster sees.
    return AuthResult("bad")


def validate_token(token: str) -> bool:
    if not auth_enabled():
        return True
    return hmac.compare_digest(token, _secret())


def validate_request(authorization: str | None, query_token: str | None = None) -> bool:
    """Validate from either transport. See `authenticate`."""
    return authenticate(authorization, query_token).ok
