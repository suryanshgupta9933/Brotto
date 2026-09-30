"""Policy: user domain blacklist + secure mode gate.

The blacklist is whatever the user set in the panel, full stop. There is no
operator-set floor: a server-side list could only ever *add* sites the user
cannot remove, and on a self-hosted install it was a file nobody ships —
`policy.json` was absent in practice, so the whole floor path (load, merge,
a locked read-only block in the panel) cost real code and rendered nothing.
The harness consults the policy at three checkpoints.

No new deps; stdlib only. See module docstrings for upgrade paths.
"""

from .domains import MULTI_PART_SUFFIXES, domain_matches, etld1
from .gate import GateDecision, check_domain_policy, check_first_time_seen
from .schema import Policy, UserPolicy

__all__ = [
    "GateDecision",
    "MULTI_PART_SUFFIXES",
    "Policy",
    "UserPolicy",
    "check_domain_policy",
    "check_first_time_seen",
    "domain_matches",
    "etld1",
]
