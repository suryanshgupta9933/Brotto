from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..dev.ax_tree_extractor import SemanticTarget

MAX_DIFF_CHARS = 800

# A scroll can bring a screenful of targets into view at once. Listing every
# one of them buries the content change the step was actually after, so
# visibility moves get their own budget and the rest are counted.
MAX_VISIBILITY_LINES = 6


def _visibility_note(before: str | None, after: str | None) -> str:
    """How a target's clickability changed, in the words the prompt uses.

    `blocked` is `"off-screen"` / `"occluded"` / `None`, and ax_filter renders
    those as `[off-screen]` / `[covered]` — same vocabulary, so the model
    reads the diff and the tree as one thing.
    """
    labels = {"off-screen": "off-screen", "occluded": "covered by another element"}
    was = labels.get(before, "visible")
    now = labels.get(after, "visible")
    return f"was {was}, now {now}"


def compute_ax_diff(
    prev: list["SemanticTarget"],
    curr: list["SemanticTarget"],
    max_chars: int = MAX_DIFF_CHARS,
) -> str:
    if not prev:
        return ""

    prev_map = {t.ref_id: t for t in prev}
    curr_map = {t.ref_id: t for t in curr}

    added = [t for ref, t in curr_map.items() if ref not in prev_map and (t.name or t.value)]
    removed = [t for ref, t in prev_map.items() if ref not in curr_map and (t.name or t.value)]
    modified = [
        (prev_map[ref], curr_map[ref])
        for ref in prev_map
        if ref in curr_map and (
            prev_map[ref].name != curr_map[ref].name
            or str(prev_map[ref].value) != str(curr_map[ref].value)
        )
        and (curr_map[ref].name or curr_map[ref].value)
    ]

    # A scroll changes no name and no value — it moves elements across the
    # viewport edge, which lands in `blocked`. Without this, every scroll-only
    # step reported "(no changes detected)" and the model, told its scroll did
    # nothing, scrolled again: six consecutive scroll steps in one recorded run.
    # A target whose text also changed is already on a `~` line, so it is not
    # repeated here.
    changed_refs = {new.ref_id for _, new in modified}
    visibility = [
        (prev_map[ref], curr_map[ref])
        for ref in prev_map
        if ref in curr_map
        and ref not in changed_refs
        and prev_map[ref].blocked != curr_map[ref].blocked
        and (curr_map[ref].name or curr_map[ref].value)
    ]

    if not added and not removed and not modified and not visibility:
        return "(no changes detected)"

    lines: list[str] = []
    for t in added:
        lines.append(f"  + [{t.ref_id}] {t.role} \"{t.name or t.value}\"")
    for t in removed:
        lines.append(f"  - [{t.ref_id}] {t.role} \"{t.name or t.value}\"")
    for old, new in modified:
        old_text = old.name or str(old.value)
        new_text = new.name or str(new.value)
        lines.append(f"  ~ [{new.ref_id}] {new.role} \"{old_text}\" → \"{new_text}\"")

    vis_hidden = 0
    for old, new in visibility[:MAX_VISIBILITY_LINES]:
        label = new.name or str(new.value)
        note = _visibility_note(old.blocked, new.blocked)
        lines.append(f"  v [{new.ref_id}] {new.role} \"{label}\" — {note}")
    if len(visibility) > MAX_VISIBILITY_LINES:
        vis_hidden = len(visibility) - MAX_VISIBILITY_LINES
        lines.append(
            f"  v … and {vis_hidden} more target(s) that changed visibility"
        )

    # A navigation swaps the whole page, so "first 10" hid nearly all of it
    # and sliced the tenth entry mid-word. Drop whole lines, count the rest.
    kept: list[str] = []
    used = 0
    for line in lines:
        if used + len(line) + 1 > max_chars:
            continue
        kept.append(line)
        used += len(line) + 1

    result = "\n".join(kept)
    hidden = len(lines) - len(kept)
    if hidden:
        result += f"\n  [{hidden} more change(s) not listed — see the AX tree below]"
    return result
