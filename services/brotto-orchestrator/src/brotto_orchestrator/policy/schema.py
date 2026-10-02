"""Policy schema.

One document, set by the user in the panel and sent per task. There is no
server-side floor to merge into it — see the package docstring.

Both fields are always on. There is no mode: `mode` gated every gate in
`gate.py`, so "normal" meant a blacklist that did not block and a
sensitive action that asked nothing — a permissive default wearing the
name of a downgrade from "secure". The one document is now the only
document.

# ponytail: whitelist, block_blacklisted and mode were all removed.
# "allow only these sites" is impractical to maintain (nobody can
# enumerate every safe site), and the mode flag existed only to switch
# the gates off. pydantic ignores unknown keys, so a policy file written
# by an older build still parses — including one that carries a `mode`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Policy(BaseModel):
    """A policy document. Used for both the floor and the effective policy."""

    blacklist: list[str] = Field(default_factory=list)
    # eTLD+1 sites the user has said yes to, kept between tasks and across a
    # server restart. Without it the first-time-seen gate re-asks about a site
    # the user approved an hour ago, which is how one page turned into five
    # identical prompts. Written by the harness on approval, never by the
    # panel — the user grants it by clicking Approve, not by editing settings.
    # An `aria-hidden` target never lands here: those keep a per-run key, so a
    # hidden "Delete account" cannot inherit a grant made days earlier.
    approved_domains: list[str] = Field(default_factory=list)
    # ponytail: curated list of irreversible action patterns (action name
    # OR substring of action_args) that always require approval.
    # Complements the regex-based CRITICAL_PATTERNS by giving the user a
    # declarative list they can edit. Default covers the common
    # destructive / external-impact cases.
    sensitive_actions: list[str] = Field(
        default_factory=lambda: [
            "submit_form", "delete_record", "payment", "transfer",
            "change_password", "revoke_access", "publish", "deploy",
            "send_email", "external_post", "approve", "reject",
        ]
    )


# ponytail: UserPolicy is currently identical to Policy — kept as a
# separate type so the extension payload can evolve independently of the
# server's schema (e.g. extension-only toggles).
class UserPolicy(Policy):
    pass
