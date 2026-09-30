from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..dev.ax_tree_extractor import SemanticTarget

KEEP_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox",
    "checkbox", "radio", "menuitem", "tab", "listitem",
    "heading", "dialog", "alert", "form", "main", "nav",
    "option", "switch", "slider", "spinbutton", "gridcell",
    # Record containers. Nameless ones never reach the output (see the
    # name/value guard below) but they are what a row's fields indent under,
    # and they must match the extractor's kept set or depth comes out 0.
    "row", "rowgroup", "table", "list",
}

STRIP_ROLES = {"generic", "none", "presentation", "separator"}

# Character budget for the rendered tree. Derived from the model's context
# window by the caller (see `budget_for_window`) — a flat 6000 next to a 1M
# window truncated a real GitHub list page at 6041 chars and cost the agent a
# scroll step to see the rest. FLOOR keeps a small-window model bounded.
MAX_CHARS = 6000
BUDGET_FLOOR = 8000
BUDGET_CEIL = 60000
WINDOW_DIVISOR = 20

# innerText cap. This is the only source for values the AX tree omits
# (a repo's star count, a price, a counter), so it earns its place in every
# observation. Must match PAGE_TEXT_MAX in the extension's background.ts.
PAGE_TEXT_MAX = 20000

# Indent steps. Deeper nesting flattens anyway once the extra levels are
# generic containers the model never sees.
MAX_DEPTH = 4

# Steps over which the tree budget decays to LATE_BUDGET_FRACTION. See
# budget_for_window for why the tree gets less useful as a task ages.
BUDGET_DECAY_STEPS = 15
LATE_BUDGET_FRACTION = 0.3

ROW_Y_THRESHOLD = 30  # px — elements within this y-band are considered "same row"


def budget_for_window(window: int | None, step: int = 0) -> int:
    """How many chars of AX tree a model with this context window gets.

    Scales rather than hardcodes: the tree is one section of a prompt that
    also carries history and memory, so a twentieth of the window leaves
    room and still bounds a runaway page.
    """
    if not window:
        return MAX_CHARS
    budget = max(BUDGET_FLOOR, min(BUDGET_CEIL, window // WINDOW_DIVISOR))
    if step > 0:
        # The tree is worth most at step 0, where the model has to survey a
        # page to decide what to try at all. By step 15 it is executing a
        # plan it already holds in the step summaries, and most of the tree
        # is pages it has already rejected. Decaying the budget is the only
        # lever that touches this: the tree is uncacheable every step, so
        # every char saved here is a char the provider does not re-read on
        # every remaining action of the task.
        #
        # The floor is the model's window budget, not MAX_CHARS — a late step
        # that needs to re-find something still gets a real tree, and
        # filter_ax_targets reports what it dropped so the miss is visible
        # rather than silent.
        span = min(1.0, step / BUDGET_DECAY_STEPS)
        keep = 1.0 - (1.0 - LATE_BUDGET_FRACTION) * span
        budget = max(BUDGET_FLOOR, int(budget * keep))
    return budget


def _depths(targets: list["SemanticTarget"]) -> dict[str, int]:
    """Depth of each target among its *kept* ancestors.

    The flat list loses the parent chain, so on a list page a repo's star
    count lands N lines away from its name and the model has to guess which
    record it belongs to — that guessing is the wandering. Generic
    containers between them never reach the model, so they don't count.
    """
    parent = {t.ref_id: t.parent_ref_id for t in targets if t.parent_ref_id}
    depth: dict[str, int] = {}
    for t in targets:
        n, seen, cur = 0, {t.ref_id}, t.parent_ref_id
        while cur and cur not in seen and n < MAX_DEPTH:
            seen.add(cur)
            n += 1
            cur = parent.get(cur)
        depth[t.ref_id] = n
    return depth


def _group_by_row(targets: list["SemanticTarget"]) -> dict[int, list["SemanticTarget"]]:
    """Bucket targets into horizontal bands by y-coordinate.

    Elements with similar y-coordinates (within ROW_Y_THRESHOLD) are grouped together.
    Returns a dict mapping canonical y-coordinate to list of targets in that row.
    """
    rows: dict[int, list["SemanticTarget"]] = {}
    for t in targets:
        if not t.coordinates:
            continue
        cy = t.coordinates.get("y", 0)
        # Find existing band within threshold
        matched = False
        for band_y in sorted(rows.keys()):
            if abs(cy - band_y) <= ROW_Y_THRESHOLD:
                rows[band_y].append(t)
                matched = True
                break
        if not matched:
            rows[cy] = [t]
    return rows


def _compute_annotations(targets: list["SemanticTarget"]) -> dict[str, str]:
    """Compute action annotations for elements in list/table rows.

    Strategy: mark all checkboxes in list contexts as [☐ select-only].
    In lists/tables with links/buttons, checkboxes are bulk-select controls, not openers.
    """
    annotations: dict[str, str] = {}

    # Detect list context: multiple rows or list-like roles
    has_list_items = any(t.role.lower() in ("listitem", "option", "gridcell", "row") for t in targets)
    has_links_or_buttons = any(t.role.lower() in ("link", "button") for t in targets)
    is_list_context = has_list_items or (has_links_or_buttons and len(targets) > 3)

    if is_list_context:
        # In list context, mark ALL checkboxes as select-only
        for t in targets:
            if t.role.lower() == "checkbox":
                annotations[t.ref_id] = "[☐ select-only]"
            elif t.role.lower() in ("link", "button") and t.name:
                annotations[t.ref_id] = "[→ open]"
    else:
        # In non-list contexts, use spatial grouping
        rows = _group_by_row(targets)
        for row_members in rows.values():
            checkboxes = [t for t in row_members if t.role.lower() == "checkbox"]
            openers = [t for t in row_members
                       if t.role.lower() in ("link", "button", "listitem", "gridcell")]
            if checkboxes and openers:
                for t in openers:
                    annotations[t.ref_id] = "[→ open]"
                for t in checkboxes:
                    annotations[t.ref_id] = "[☐ select-only]"

    return annotations


def filter_ax_targets(
    targets: list["SemanticTarget"],
    viewport_coords: tuple[int, int, int, int] | None = None,
    max_chars: int = MAX_CHARS,
) -> str:
    """Filter SemanticTargets to a token-capped AX tree string.

    viewport_coords: (x, y, width, height) bounding box — elements outside are marked off-screen.

    Elements are annotated to clarify their action:
    - [→ open] — primary action for this row (click to open/select the item)
    - [☐ select-only] — bulk-selection control (never opens the item)

    Over budget, whole lines are dropped rather than sliced, so what survives
    is still a coherent tree instead of one that ends mid-element.
    """
    # Compute spatial annotations (marks primary actions and selection controls)
    annotations = _compute_annotations(targets)
    depth = _depths(targets)

    # Fallback suppression for elements without coordinates (extension path).
    # Keep the name-match heuristic as a secondary guard.
    has_list_rows = any(t.role.lower() in ("listitem", "option", "gridcell", "row") for t in targets)
    link_names = {t.name.lower() for t in targets if t.role.lower() == "link" and t.name}
    shadow_checkboxes = {
        t.ref_id for t in targets
        if t.role.lower() == "checkbox"
        and not t.coordinates  # only suppress if no y-coordinate available
        and t.name and t.name.lower() in link_names
        and has_list_rows
    }

    lines: list[str] = []
    offscreen: list[str] = []
    dropped = 0

    for t in targets:
        if t.ref_id in shadow_checkboxes:
            continue
        role = t.role.lower()
        if role in STRIP_ROLES:
            continue
        if not t.name and not t.value:
            continue  # unactionable — no text to describe or click target
        if role not in KEEP_ROLES:
            continue

        line = f"[{t.ref_id}] {role}"
        if t.name:
            line += f' "{t.name[:80]}"'
        if t.value:
            line += f' value="{str(t.value)[:80]}"'
        if t.href:
            line += f"  {t.href[:160]}"
        # Append action annotation if computed
        ann = annotations.get(t.ref_id)
        if ann:
            line += f"  {ann}"

        pad = "  " * depth.get(t.ref_id, 0)
        if pad:
            line = pad + line

        # Off-screen elements are appended after the visible tree, so a long
        # page's tail spends budget last.
        if viewport_coords and t.coordinates:
            vx, vy, vw, vh = viewport_coords
            cx, cy = t.coordinates.get("x", 0), t.coordinates.get("y", 0)
            if not (vx <= cx <= vx + vw and vy <= cy <= vy + vh):
                offscreen.append(f"[off-screen] {line}")
                continue

        lines.append(line)

    # Visible tree first, then off-screen. Drop whole lines: slicing mid-line
    # used to end the tree on a half-rendered element.
    ordered = lines + offscreen
    kept: list[str] = []
    used = 0
    for line in ordered:
        if kept and used + len(line) + 1 > max_chars:
            dropped += 1
            continue
        kept.append(line)
        used += len(line) + 1

    result = "\n".join(kept)
    if dropped:
        result += (
            f"\n[{dropped} more element(s) not shown — scroll, or read_page_text "
            f"for this page's content]"
        )
    return result
