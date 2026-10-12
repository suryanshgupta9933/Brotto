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
import ipaddress
import json
import logging
import os
import re
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import aiohttp

log = logging.getLogger("brotto.jwt_auth")

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$")

#: PostgREST's own `eq.` value, quoted *in the grammar* and then encoded.
#: **Every filter value spliced into a query goes through this**, never the
#: raw string.
#:
#: `EMAIL_RE` above is not a filter-safety guard and cannot be one — its local
#: part is "anything but `@` and whitespace", which includes `,`, and in
#: PostgREST's syntax a comma separates values in a list. So a string this
#: regex accepts and the consumer's parser can disagree about where the
#: filter ends. The regex's job is "looks like an email"; this one's job is
#: "is safe to splice into a query language", and only the second one
#: closes it. Widening the regex's job — restricting the local part to
#: `A-Za-z0-9._%+-` — was considered and rejected: it would reject
#: `o'brien@example.com` and every other RFC 5322 `atext` address a stranger
#: can legitimately type on the waitlist form, and it would buy nothing once
#: the value is quoted.
#:
#: **The double quotes are load-bearing and `quote()` alone is not a guard.**
#: PostgREST URL-decodes a filter *before* it parses the filter grammar, so
#: percent-encoding alone changes the bytes on the wire without changing the
#: meaning: `a,b@example.com` arrives as `eq.a,b@example.com` and the comma is
#: still a list separator to the parser that reads it. `quote()` is still
#: there, but only for what survives *after* the grammar layer has decided
#: the value is one string — it keeps `@` and spaces from being reinterpreted
#: at the HTTP layer, not commas from being reinterpreted at the filter layer.
#: Inside the literal `"` closes it and `\` is the escape character, so a
#: value carrying either can terminate or reshape the literal — and
#: `quote()` percent-encodes both, which buys nothing, because the decode
#: above happens before the grammar layer ever sees either byte. The check
#: is therefore **deny-by-default on the characters the grammar reserves**,
#: not allow-by-default on the ones it does not: `EMAIL_RE`'s local part
#: (`[^@\s]{1,64}`) accepts a backslash, so the address is reachable. Both
#: are **rejected rather than escaped** — no escaping is defined here that
#: has been checked against PostgREST, and rejecting is the honest
#: alternative to guessing. It fails closed at all three call sites
#: (`_listed_for_beta` → `False`, `approve_at_exchange` → `False`,
#: `ensure_on_roster` → a refusal). Pinned by
#: `test_the_roster_filter_survives_a_postgrest_parser` and
#: `test_a_backslash_in_an_address_is_refused_rather_than_quoted`.
def _filter_value(value: str) -> str:
    if any(c in value for c in ('"', "\\")):
        raise ValueError("filter value contains a grammar-reserved character")
    return '"' + quote(value, safe="") + '"'

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
    """Sign an HS256 token. The relay's own access token.

    `exchange_login_code` is now the one production caller: after the emailed
    code has proved inbox control, the relay signs the token itself against
    `SUPABASE_JWT_SECRET`, which is the same secret `verify_jwt` checks. That
    is why nothing about the verifier changes — one key, one algorithm, and
    the only thing that moved is who mints.
    """
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


async def _supabase_call(
    method: str, path: str, *, json_body: dict, api_key: str, service: bool = False,
    prefer: str = "",
) -> tuple[int, str]:
    """One authenticated call to Supabase. Status and raw text.

    The text is returned unparsed so every caller decides what a body
    means; nothing here logs it, because these bodies hold email
    addresses and service-key material.

    `prefer` carries a `Prefer:` header — PostgREST's own request
    preferences. One caller needs it: the self-approval insert is
    `resolution=ignore-duplicates`, which is what makes it an insert and
    not an upsert.
    """
    url = f"{_supabase_url()}/{path.lstrip('/')}"
    headers = {"apikey": api_key, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
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
    method: str, query: str, body: dict | None = None, *, path: str = "rest/v1/profiles",
    prefer: str = "",
) -> tuple[int, str]:
    """A PostgREST call bound to the service role. The one seam tests stub.

    `path` is the whole relative path because the cap reservation is an
    RPC against the same table, not a REST verb on it, and the
    self-approval insert reads a different table — all three go through
    here so one stub in a test covers the whole control plane.
    """
    return _supabase_call(
        method, f"{path}{query}", json_body=body or {}, api_key=_service_key(),
        service=True, prefer=prefer,
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


# ---------------------------------------------------------------------------
# The sign-in code: ours, not Supabase's
# ---------------------------------------------------------------------------

#: Domain separation for the code digest. A prefix means a digest computed for
#: one purpose cannot be replayed as one for another under the same key.
_CODE_DIGEST_PREFIX = "brotto.sign-in-code:"

#: How long a mailed code stays useful. Supplied at mint and nowhere else —
#: `007` deliberately gives `expires_at` no default so the TTL cannot live in
#: two places that would disagree.
CODE_TTL_MINUTES = 10

#: The redemption budget, matched to `_SIGNIN_BUCKET_CAPACITY` in `main.py`.
#: Two limits that agree are one limit described twice; the interesting case
#: would be this one being *looser* than the route's.
SIGN_IN_MAX_ATTEMPTS = 5

#: Lifetime of the access token `exchange_login_code` signs. One hour, which
#: is what Supabase issued and what everything downstream already assumed.
TOKEN_TTL_SECONDS = 3600

#: The user agent is a browser identifying itself or it is not kept. The table
#: refuses anything past 512 (`sign_in_events_agent_bounded`); `clean_version`
#: in `failure_report` makes the same call and for the same reason — truncating
#: leaves 512 characters of it in the one column a human reads.
MAX_USER_AGENT_CHARS = 512


def hash_sign_in_code(code: str) -> str:
    """The keyed digest `sign_in_codes.code_hash` stores. 64 lowercase hex.

    **HMAC-SHA256 keyed on `SUPABASE_JWT_SECRET`, not a bare `sha256`.** The
    space is 10^6, so an unkeyed digest is a rainbow table of one line: a dump
    of the table would be a list of live codes whether or not the column is
    called "hash". This secret is already in the relay's environment and
    leaking it is already total compromise — it signs every JWT — so the
    digest adds no new failure mode and no new deployment variable.
    """
    key = jwt_secret().encode("utf-8")
    return hmac.new(key, (_CODE_DIGEST_PREFIX + code).encode("utf-8"), hashlib.sha256).hexdigest()


def mint_sign_in_code() -> str:
    """A six-digit code, zero-padded. `secrets`, not `random`."""
    return f"{secrets.randbelow(10**6):06d}"


async def request_login_code(email: str) -> None:
    """Mint, store and mail a 6-digit code — for an admitted address only.

    **The HTTP reply is byte-identical whether or not a code was minted, and
    that is the one property this route may not lose.** This used to consult
    nothing at all (Supabase minted for anyone), which kept the answer uniform
    by never asking the question. It now consults `beta_access`, because a
    code is the raw material for signing in and minting one for a stranger
    mails a live credential to an address nobody chose — but a *conditional
    reply* on this unauthenticated route is a directory of the beta, handed to
    anyone who can reach a public URL. So the roster decides what we **do**,
    never what we **say**: a listed address gets a code and a mail, a stranger
    gets the same `{"sent": true}` and an inbox that stays empty.

    Everything after the roster check is therefore swallowed rather than
    reported. A mint that fails is logged and returns, for the same reason a
    Supabase 429 used to be: a 502 here would be "you are on the list, and our
    database blinked" while a stranger got a 200. Raises `SupabaseUnavailable`
    only for "this relay has no control plane at all", which is a property of
    the deployment and says nothing about the address.

    Pinned by `test_the_reply_cannot_tell_a_member_from_a_stranger`.
    """
    addr = normalize_email(email)
    if not _supabase_url() or not _service_key() or not jwt_secret():
        raise SupabaseUnavailable("not configured")
    if not await _listed_for_beta(addr):
        # Miss and unreadable roster are both here, and both log differently
        # (see `_control_plane_failed`). Neither may change the reply.
        return
    code = mint_sign_in_code()
    expires = datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES)
    try:
        status, _ = await _profiles(
            "POST", "",
            {"email": addr, "code_hash": hash_sign_in_code(code),
             "expires_at": expires.isoformat(timespec="seconds")},
            path="rest/v1/sign_in_codes",
        )
        if status >= 400:
            log.warning("sign-in code insert answered %d", status)
            return
    except Exception as exc:  # TYPE only — a PostgREST body can echo the row
        log.warning("sign-in code insert failed: %s", type(exc).__name__)
        return
    from .sign_in_code_email import send_code

    await send_code(addr, code)


async def _ensure_auth_user(email: str) -> str:
    """The `auth.users` id this address signs in as. Creates it, with no mail.

    Supabase Auth still owns the account row — `profiles.id` is an FK into
    `auth.users` and the whole control plane depends on it — but the create
    goes through the service-role admin API with `email_confirm: true`, so
    **Supabase sends no mail, ever**. That is the other half of taking the
    code over: the branded template and its localhost link are gone because
    nothing on this path asks Supabase to write to anybody.

    Called at **exchange**, not at mint. A code row needs no account (pinned
    by `test_a_code_is_issued_to_an_address_that_need_not_have_an_account`),
    and creating at mint time would mint an auth account for someone who never
    redeemed — the thing this function exists to avoid doing to strangers.

    **If the user already exists, get their id rather than failing.** The
    create answers `422` for an address that is already registered and the
    body names no id, so the id comes from the admin list. `ponytail:` the
    list is paged at 200 a page and this walks up to five pages — fine for a
    beta of tens, and the upgrade is a table of our own mapping address to id
    the moment the roster is large enough to page past.
    """
    status, text = await _profiles(
        "POST", "",
        {"email": email, "email_confirm": True},
        path="auth/v1/admin/users",
    )
    if 200 <= status < 300:
        try:
            uid = json.loads(text).get("id")
        except Exception as exc:
            raise SupabaseUnavailable("unreadable user") from exc
        if isinstance(uid, str) and uid:
            return uid
        raise SupabaseUnavailable("no user id")
    if status >= 500:
        raise SupabaseUnavailable(f"admin users answered {status}")
    # 4xx: already there (or refused). Either way the create did not give us
    # an id, and a wrong code never reaches this line — so this is not a place
    # where a refusal can become an account-existence answer.
    for page in range(1, 6):
        status, text = await _profiles(
            "GET", f"?page={page}&per_page=200", path="auth/v1/admin/users",
        )
        if status >= 400:
            raise SupabaseUnavailable(f"admin users list answered {status}")
        try:
            users = json.loads(text).get("users") or []
        except Exception as exc:
            raise SupabaseUnavailable("unreadable user list") from exc
        for user in users:
            if isinstance(user, dict) and normalize_email(str(user.get("email") or "")) == email:
                uid = user.get("id")
                if isinstance(uid, str) and uid:
                    return uid
        if not isinstance(users, list) or len(users) < 200:
            break
    raise SupabaseUnavailable("no user id")


async def exchange_login_code(email: str, code: str) -> str:
    """Verify the emailed code. The relay's access token, or raise ValueError.

    Every failure is one opaque `ValueError("invalid or expired code")` — a
    wrong code, an expired one, one whose budget is spent and one with no row
    at all are the same sentence, because saying which half was wrong is the
    account-existence oracle `request-code` refuses to be. A control plane
    that cannot answer is `SupabaseUnavailable`, which is a different thing:
    it says nothing about the address and reporting it is the difference
    between "check your inbox" and "nothing is wrong, wait".
    """
    addr = normalize_email(email)
    if not _supabase_url() or not _service_key() or not jwt_secret():
        raise SupabaseUnavailable("not configured")
    # The attempt is charged inside `redeem_sign_in_code` before the digest is
    # judged — see `007`. A read-then-write here would be five guesses billed
    # as one.
    try:
        status, text = await _profiles(
            "POST", "",
            {"addr": addr, "supplied_hash": hash_sign_in_code(code.strip()),
             "max_attempts": SIGN_IN_MAX_ATTEMPTS},
            path="rest/v1/rpc/redeem_sign_in_code",
        )
    except SupabaseUnavailable:
        raise
    except Exception as exc:
        raise SupabaseUnavailable(type(exc).__name__) from exc
    if status >= 400 or text.strip() != "true":
        raise ValueError("invalid or expired code")
    uid = await _ensure_auth_user(addr)
    return make_jwt(
        {"sub": uid, "email": addr, "role": "authenticated",
         "exp": int(time.time()) + TOKEN_TTL_SECONDS},
        jwt_secret(),
    )


def _mask_peer(peer: str) -> str | None:
    """The peer, truncated to a **network**. `None` when there is no peer.

    `/24` on IPv4 and `/48` on IPv6 — a real allocation, and the finest
    granularity that still answers "is this somewhere new?". The table's
    CHECK pins the same two masks, so a half-masked value has nowhere to
    land. `None` rather than an empty string: an honest absence is not
    "somewhere".
    """
    try:
        ip = ipaddress.ip_address(peer.strip())
    except ValueError:
        return None
    bits = 24 if ip.version == 4 else 48
    return str(ipaddress.ip_network(f"{ip}/{bits}", strict=False))


async def record_sign_in_event(token: str, peer: str, user_agent: str) -> None:
    """One `sign_in_events` row. Never raises.

    Called as a **background task**, after the exchange has answered, so the
    endpoint never waits on this write and a control-plane failure cannot turn
    a successful sign-in into an error. A failed exchange never reaches it:
    one row per *successful* `POST /v1/auth/exchange`, and a wrong guess is
    not a sign-in.

    The owner is read off the verified token and never off the body — the body
    is caller-supplied, exactly as `failure_reports.owner` refuses to be.
    """
    claims = verify_jwt(token)
    if claims is None:
        return
    agent = user_agent.strip()
    if len(agent) > MAX_USER_AGENT_CHARS:
        agent = ""
    try:
        status, _ = await _profiles(
            "POST", "",
            {"owner": claims.sub, "ip": _mask_peer(peer), "user_agent": agent},
            path="rest/v1/sign_in_events",
        )
        if status >= 400:
            log.warning("sign-in event answered %d", status)
    except Exception as exc:  # TYPE only — a PostgREST body can echo the row
        log.warning("sign-in event not recorded: %s", type(exc).__name__)


#: The pre-loaded roster. One row per approved address, normalised on the way
#: in, so the lookup below is a string equality and not a normalisation that
#: could disagree between the two spellings of one person's inbox.
BETA_ACCESS_PATH = "rest/v1/beta_access"

#: PostgREST's own spelling of "insert if absent, leave the row alone if it is
#: already there". Without it an `on_conflict` POST is an **upsert**, and an
#: upsert on this path is a revocation erased from the record: a member the
#: operator deliberately withdrew signs back in and is silently reinstated,
#: with nothing anywhere saying so. See `approve_at_exchange`.
_IGNORE_DUPLICATES = "resolution=ignore-duplicates"


def _control_plane_failed(
    what: str, status: int | None = None, exc_type: str | None = None
) -> None:
    """Say loudly that an answer is about *our* database, not about the caller.

    Every consumer of these two lookups turns a control-plane failure into
    the same answer it gives a genuine miss — `False` at exchange, a refusal
    at task start — because that is the right direction to fail. The cost is
    that "no such row" and "the database cannot be read" are the same
    answer, and the interesting case is the second one: an operator who
    never applied the `beta_access.revoked_at` migration gets PostgREST
    `PGRST204` on that column, and **every approved member is refused while
    the log says they are not in the beta**. That is a deployment mistake
    presenting as a product decision, and it is invisible unless the log
    says which of the two it was.

    Status only, and `None` for a call that never came back. `exc_type` is
    the *type* of an exception and never its message, on the same rule: a
    PostgREST error body can echo the row, and the exception that carries it
    does too. Both are carried here so one event is one record — the caller
    no longer logs the type itself, and a transient outage logs the same
    single actionable line every time rather than a second vague one. That
    repetition is deliberate: under a sustained outage the line firing on
    every request *is* the signal. Pinned by
    `test_an_unreadable_roster_is_loud_where_a_genuine_miss_is_not`.
    """
    log.error(
        "%s did not answer%s%s — the roster could not be read, so every identity "
        "looks absent. Check the deployed migrations under supabase/migrations/ "
        "before reading any of these answers as a real refusal.",
        what,
        f" (status {status})" if status is not None else " at all",
        f" [raised {exc_type}]" if exc_type is not None else "",
    )


async def _listed_for_beta(email: str) -> bool:
    """Whether `beta_access` carries this normalised address, un-withdrawn.

    Never raises and never reports *why* — a miss and an unreachable
    control plane are both False here, because a caller who has already
    proved inbox control gets the same answer either way and the second
    wall (`authorize_task_start`) is what actually decides. **The log is
    where the distinction is kept**, because to the caller the two answers
    must be identical; see `_control_plane_failed`.

    **A row with `revoked_at` set is a refusal, not a hit.** That column
    is the durable withdrawal on the roster, and this is what stops a
    deleted auth account from cascading its `profiles` row — and with it
    the `profiles.revoked_at` that `authorize_task_start` reads — away,
    leaving the member free to re-admit themselves at the next exchange.
    A row deleted from `beta_access` reads False too, but only by
    accident of being absent; this is the case where the row is right
    there and the answer is still no.
    """
    try:
        status, text = await _profiles(
            "GET",
            f"?email=eq.{_filter_value(email)}&select=email,revoked_at",
            path=BETA_ACCESS_PATH,
        )
    except Exception as exc:
        _control_plane_failed("the beta_access lookup", exc_type=type(exc).__name__)
        return False
    if status >= 400:
        _control_plane_failed("the beta_access lookup", status)
        return False
    try:
        rows = json.loads(text)
    except Exception as exc:
        # A body that does not parse is not a roster answer either, and it
        # is the shape a proxy error page takes.
        _control_plane_failed(
            "the beta_access lookup (unparseable body)",
            exc_type=type(exc).__name__,
        )
        return False
    if not isinstance(rows, list) or not rows:
        return False
    row = rows[0] if isinstance(rows[0], dict) else {}
    return not row.get("revoked_at")


async def approve_at_exchange(token: str) -> bool:
    """Self-approve a just-signed-in identity if the roster lists it.

    Called once, from `POST /v1/auth/exchange`, with the access token
    Supabase just minted. **The email comes from the verified claims and
    never from the submitted body**: the body is caller-supplied and this
    is the one function that would act on it.

    **Insert-if-absent, never upsert.** `on_conflict=id` with
    `Prefer: resolution=ignore-duplicates` is an insert that declines to
    touch an existing row, so a member the operator revoked (`revoked_at`
    set) keeps that row, and the re-read below answers `False` for them.
    `revoked_at` is not in the insert body and is not written here by any
    path. The alternative — upserting `revoked_at: null` because the row
    "should" be active — reinstates a withdrawn member on their next
    sign-in and leaves no trace of it anywhere.

    `True` is a report, not the gate: `authorize_task_start` asks again at
    task start, so a wrong answer here costs one confusing UI state and
    not an unauthorised run. That is why every failure below answers
    False instead of raising — the credential is valid either way.
    """
    if not _supabase_url() or not _service_key():
        return False
    claims = verify_jwt(token)
    if claims is None:
        return False
    email = normalize_email(claims.email)
    # Also a plausibility check, not the injection guard — this string goes
    # into a PostgREST filter, and what keeps a comma (a filter separator) or
    # a paren out of it is `_filter_value` below. Pinned by
    # `test_the_roster_filter_survives_a_postgrest_parser`.
    if not EMAIL_RE.fullmatch(email):
        return False
    if not await _listed_for_beta(email):
        return False
    try:
        status, _ = await _profiles(
            "POST", "?on_conflict=id", {"id": claims.sub, "email": email},
            prefer=_IGNORE_DUPLICATES,
        )
        if status >= 400:
            log.warning("profile insert answered %d", status)
            return False
        # Read it back rather than trusting the insert: the row may have been
        # there already, and "there already" is the revoked case.
        status, text = await _profiles(
            "GET", f"?id=eq.{_filter_value(claims.sub)}&select=revoked_at"
        )
    except Exception as exc:
        log.warning("profile approval failed: %s", type(exc).__name__)
        return False
    if status >= 400:
        log.warning("profile re-read answered %d", status)
        return False
    try:
        rows = json.loads(text)
    except Exception:
        return False
    if not isinstance(rows, list) or not rows:
        return False
    row = rows[0] if isinstance(rows[0], dict) else {}
    return not row.get("revoked_at")


async def ensure_on_roster(claims: Claims) -> dict:
    """This identity has a `profiles` row and it is not revoked. Returns the row.

    **The one roster gate.** Existence and revocation, and nothing else —
    no cap, no counter, no reservation — so every route can ask the
    question task start asks without consuming a task slot it is not
    getting. Raises `AccountRefused`.

    Fails **closed** if Supabase cannot be reached. That is the right
    direction: this is the hosted relay, where the transcript of every
    task lands on our disk and the operator's model credits are spent, and
    "we could not check whether this person was revoked" is not a licence
    to serve them anyway. Self-host never reaches this function — it has
    no Supabase configured and authenticates with `AGENT_SECRET`.

    **Considered and rejected: a positive cache keyed on `sub`.** Re-reviewed
    after the four session routes (index, read, delete, erase-all) moved onto
    this same gate, so it is now on more paths than it was when this was first
    written. The conclusion does not change, and the added paths do not move
    the argument — they reinforce it.

    The volume is the easy half and is still small: **these routes are
    event-driven, not polled.** The panel renders history when the history
    button is opened and after a delete, and fetches an audit when a row is
    clicked (`renderHistory` → `historyEntries` → `GET /v1/sessions`;
    `replaySession` → `fetchAudit` → the audit route). There is no interval
    behind any of them, so the four routes add *a handful of round trips per
    history open and per replay*, by a handful of people — two orders of
    magnitude below the plan's ceiling.

    The load-bearing half is unchanged and is not about volume: **a cache is
    invisible to the attack it would defend against.** Only a *positively
    approved* identity is cacheable, and the caller who can force a round trip
    per request is a signed-up stranger — who is, by definition, never cached.
    Every one of their requests is a miss with or without it. Putting four more
    approved-only routes behind this function adds misses for people who were
    already allowed; it adds nothing for the one caller a cache would exist to
    stop.

    What it would actually buy is a withdrawn member's access, for up to one
    TTL. That is a revocation delay bought against an availability problem
    this scale does not have. If the round trip ever matters, the fix is rate
    limiting on the two credit-spending routes; for the same reason
    `SUPABASE_TIMEOUT_SECONDS` stays at 5s, since this fails closed and a
    shorter deadline only turns a slow control plane into refusals served to
    users who did nothing wrong.
    """
    if not _supabase_url() or not _service_key():
        raise AccountRefused(
            "control_plane_unavailable",
            "This relay has no Supabase configuration, so it cannot tell whether "
            "your access is still active.",
        )
    try:
        status, text = await _profiles(
            "GET", f"?id=eq.{_filter_value(claims.sub)}"
                   f"&select=revoked_at,week_start,tasks_this_week"
        )
        if status >= 400:
            # Refused above with a reason the user can be shown, and logged
            # here because that reason is what an operator will be told:
            # a missing column reads as "your access could not be
            # confirmed", which looks like our outage and is a migration
            # nobody applied.
            _control_plane_failed("the profiles lookup", status)
            raise AccountRefused("control_plane_unavailable", "Could not confirm your access.")
        rows = json.loads(text)
    except AccountRefused:
        raise
    except Exception as exc:
        log.error("profiles lookup raised %s", type(exc).__name__)
        _control_plane_failed("the profiles lookup")
        raise AccountRefused("control_plane_unavailable", "Could not confirm your access.") from exc

    if not isinstance(rows, list) or not rows:
        # A valid JWT with no row is somebody who signed in without being
        # invited, which is not a beta user. Sign-in creates the auth
        # account for anyone; the allowlist creates this row.
        raise AccountRefused(
            "not_invited",
            "This account is not part of the beta. Ask the operator for an invitation.",
        )
    row = rows[0] if isinstance(rows[0], dict) else {}
    if row.get("revoked_at"):
        raise AccountRefused("revoked", "This account's access has been withdrawn.")
    return row


async def authorize_task_start(claims: Claims) -> None:
    """Revocation and the weekly cap, checked once per task. Raises AccountRefused.

    `ensure_on_roster` is the membership half and it is shared with the
    HTTP routes below the socket; the cap and the reservation are not, and
    stay here where they are read exactly once per run.
    """
    row = await ensure_on_roster(claims)
    today = datetime.now(timezone.utc).date().isoformat()
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
    # (`reserve_task_slot`, supabase/migrations/001_profiles.sql). Comparing here and
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