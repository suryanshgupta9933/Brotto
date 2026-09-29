from __future__ import annotations

import hashlib
from collections import Counter

from .context import StepSummary


def page_fingerprint(ax_tree: str, page_text: str) -> str:
    """Cheap identity for "the page looks the same as last step".

    Hashes the rendered state, not the address bar. A search flow — focus
    the box, type the query, submit — holds one URL across three genuinely
    different pages, and a URL-only rule reads that as three steps of
    nothing happening. The accessibility tree carries the input's value, so
    the fingerprint moves on a keystroke.

    Hashed rather than stored: the raw tree is tens of thousands of
    characters and only equality is ever asked of it.
    """
    return hashlib.blake2b(
        f"{ax_tree}\x00{page_text}".encode("utf-8", "replace"),
        digest_size=8,
    ).hexdigest()


def check_stagnation(
    summaries: list[StepSummary],
    window: int = 3,
) -> tuple[bool, str]:
    if len(summaries) < window:
        return False, ""

    recent = summaries[-window:]
    urls = [s.url for s in recent]

    # Stuck on the same page. The URL alone is not enough — see
    # page_fingerprint — so a step is only counted as stuck when the page
    # behind it is also unchanged.
    if len(set(urls)) == 1 and len({s.state for s in recent if s.state}) <= 1:
        return True, f"Stuck on {urls[0]} for {window} consecutive steps with no change to the page"

    # Repeating the same action
    actions = [s.action_taken for s in recent]
    most_common, count = Counter(actions).most_common(1)[0]
    if count >= window:
        return True, f"Repeated same action {window} times: '{most_common}'"

    # Consecutive find_element failures (2+ in the window)
    failed_finds = [
        s for s in recent
        if "find_element" in s.action_taken and "not found" in s.outcome.lower()
    ]
    if len(failed_finds) >= window - 1:
        return True, f"find_element failed {len(failed_finds)} consecutive times — element does not exist in AX tree"

    # URL-hopping with zero extraction (visited many pages, got nothing)
    if len(summaries) >= 5:
        window5 = summaries[-5:]
        extracted_any = any(s.extracted for s in window5)
        unique_urls = len(set(s.url for s in window5))
        if unique_urls >= 4 and not extracted_any:
            return True, f"Navigated to {unique_urls} different URLs in 5 steps with nothing extracted"

    return False, ""
