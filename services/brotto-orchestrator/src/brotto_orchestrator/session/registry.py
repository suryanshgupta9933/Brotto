from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from .sequence_tracker import SequenceTracker


@dataclass
class SessionState:
    user_id: str
    connected: bool = True
    current_task: asyncio.Task | None = None
    in_seq: SequenceTracker = field(default_factory=SequenceTracker)
    # ponytail: last user_policy the user submitted (via task_start or
    # policy_acknowledged). Used by `GET /v1/policy` to return the merged
    # view the user is actually subject to, not just their local cache.
    # Stored as a raw dict; we re-validate with UserPolicy when reading.
    last_user_policy: dict | None = None
    # The Supabase `sub` that minted this session, on the hosted relay.
    # None on every self-host: `AGENT_SECRET` is one shared identity by
    # design, so a self-hoster has no principals to tell apart and must
    # not be handed the illusion of them. See `SessionRegistry.owns`.
    owner: str | None = None

    def cancel_current_task(self) -> None:
        if self.current_task and not self.current_task.done():
            self.current_task.cancel()


class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._owners: dict[str, str | None] = {}

    def get_or_create(self, user_id: str) -> SessionState:
        if user_id not in self._sessions:
            self._sessions[user_id] = SessionState(user_id=user_id)
        return self._sessions[user_id]

    def get_or_create_in_seq(self, user_id: str) -> SequenceTracker:
        """Return the per-session inbound sequence tracker.

        The tracker is created lazily on first use and persists across
        reconnect attempts for the same session_id. This is what makes
        a reconnection re-attempt safe: the extension can replay
        buffered observations and the server will dedupe them by seq.
        """
        return self.get_or_create(user_id).in_seq

    def set_user_policy(self, user_id: str, payload: dict | None) -> None:
        """Stash the most-recent user_policy for this session. None clears."""
        session = self.get_or_create(user_id)
        session.last_user_policy = payload

    def get_user_policy_payload(self, user_id: str) -> dict | None:
        session = self._sessions.get(user_id)
        if session is None:
            return None
        return session.last_user_policy

    def hydrate_user_policies(self, payload_by_key: dict) -> int:
        """Seed the in-memory cache from a persisted dump (e.g. JSON
        files written by `policy.persist`). Returns the count loaded so
        callers can log it on startup.

        ponytail: keys in the dump are the same opaque identifiers the
        sidepanel uses in its `user_id` query param. If the format
        diverges, this is the place to remap.
        """
        loaded = 0
        for key, payload in payload_by_key.items():
            self.set_user_policy(key, payload)
            loaded += 1
        return loaded

    def mark_disconnected(self, user_id: str) -> None:
        if session := self._sessions.get(user_id):
            session.connected = False
            session.cancel_current_task()

    # ── ownership, hosted relay only ───────────────────────────────────
    #
    # A session id was enough to name somebody's transcript while there
    # was one operator per server. There are ten accounts now, so "is
    # this token valid" stopped being the question: it is "is this token
    # the owner of this session". The owner is recorded here at mint time
    # and nothing else writes it.
    #
    # **A session with no recorded owner belongs to nobody.** Fail-closed
    # on purpose: a stale id, a registry that never saw the mint, an
    # eviction — each of those reads 404 rather than handing one beta
    # user another's inbox, which is the whole finding.

    # Ownership lives in its own map, **not** in `_sessions`.
    #
    # It is not a refactor: `_sessions` is evictable (`_prune_sessions`, cap
    # `MAX_TRACKED_SESSIONS`) and everything else in a `SessionState` is
    # per-run runtime — a sequence tracker, a task handle, a cached policy.
    # Ownership is not. Putting it there meant that at the cap, eviction
    # dropped entries, `owned_sessions()` shrank, and `DELETE /v1/sessions`
    # scoped by `only=` reported `{"deleted": 0, "residue": 0}` with every
    # transcript still on disk — the untruthful erasure the `.owner` sidecar
    # work existed to close, reopened at a scale threshold where no restart
    # is involved and nothing looks wrong.
    #
    # ponytail: unbounded for the life of the process, one str per session
    # ever minted. That is the same set `hydrate_owners` already loads in
    # full at boot, so it is a property of the design rather than a new
    # leak; the eviction cap exists for the state that *is* per-run.
    _owners: dict[str, str | None]

    def set_owner(self, session_id: str, owner: str | None) -> None:
        self._owners[session_id] = owner
        self.get_or_create(session_id).owner = owner

    def hydrate_owners(self, owners: dict[str, str]) -> int:
        """Restore ownership from disk at startup. Returns how many landed.

        The registry is in-memory, so a dyno restart used to empty it and
        with it every ownership answer: `owned_sessions()` returned nothing,
        so `DELETE /v1/sessions` reported `{"deleted": 0, "residue": 0}` with
        every transcript still on disk. Hydrating from the `.owner` sidecars
        the mint path writes is what makes that answer true after a restart
        rather than only in the process that happened to serve the run.
        """
        for session_id, owner in owners.items():
            self.set_owner(session_id, owner)
        return len(owners)

    def forget_owner(self, session_id: str) -> None:
        """Drop a session's ownership. Called when its files are erased.

        Not a memory optimisation: an erased session left in `_owners` would
        be reported as the caller's own by a scoped `erase all`, so the
        count would describe a file that is no longer there.
        """
        self._owners.pop(session_id, None)

    def owns(self, session_id: str, owner: str | None) -> bool:
        """Whether `owner` is the identity this session was minted for.

        `owner is None` means "self-host or open mode": one credential,
        one person, and every route behaves exactly as it did before
        identities existed.
        """
        if owner is None:
            return True
        # Not `.get(...) is None`: a session explicitly recorded as owned by
        # nobody is not owned by the caller. Fail-closed either way.
        return owner == self._owners.get(session_id)

    def owned_sessions(self, owner: str | None) -> list[str]:
        if owner is None:
            return sorted(self._sessions)
        return sorted(s for s, o in self._owners.items() if o == owner)
