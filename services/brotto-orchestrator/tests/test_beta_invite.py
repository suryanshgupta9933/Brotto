"""The closed-beta invitation: the one mail that goes to somebody we chose.

Small on purpose. The things that can actually go wrong here are a *link*:
the reader cannot install Brotto without the store listing, and this file has
no other way to reach it. So the assertions are about that URL and about the
two renderings agreeing — a fix that updates the HTML and forgets the plain
text leaves half the readers on a page they cannot act from.
"""
from __future__ import annotations

import re

from brotto_orchestrator.session import beta_invite

# The listing's own id, and nothing else. `?authuser=0&hl=en` is what a
# browser address bar shows one particular signed-in viewer, so a link copied
# out of it is still this page for everybody else — but it carries a session
# parameter into a mail that gets forwarded, and it looks like a bug.
CANONICAL = "https://chromewebstore.google.com/detail/brotto/mahkomofcmohephggjlfgocopgfhkggb"


def test_the_listing_link_is_the_canonical_one():
    assert beta_invite.CWS_URL == CANONICAL
    assert "?" not in beta_invite.CWS_URL


def test_both_renderings_carry_the_listing():
    html, text = beta_invite.render()
    assert f'href="{CANONICAL}"' in html
    assert CANONICAL in text


def test_no_other_link_carries_a_query_string():
    """Every other mailto is exempt — `?subject=unsubscribe` is the point."""
    html, _ = beta_invite.render()
    for link in re.findall(r'href="(https?://[^"]+)"', html):
        assert link == CANONICAL or link.startswith("https://brotto.dev"), link