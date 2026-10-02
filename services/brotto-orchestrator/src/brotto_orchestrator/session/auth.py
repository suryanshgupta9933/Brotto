from __future__ import annotations

import hmac
import os


def _secret() -> str:
    return os.getenv("AGENT_SECRET", "").strip()


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


def validate_token(token: str) -> bool:
    if not auth_enabled():
        return True
    return hmac.compare_digest(token, _secret())


def validate_request(authorization: str | None, query_token: str | None = None) -> bool:
    """Validate from either transport.

    A browser cannot set headers on a WebSocket, so the extension relay
    passes the secret as `?token=`. Both spellings resolve here rather
    than at each call site, so adding a route cannot pick the wrong one.
    """
    token = (authorization or "").replace("Bearer ", "", 1).strip()
    return validate_token(token or (query_token or "").strip())
