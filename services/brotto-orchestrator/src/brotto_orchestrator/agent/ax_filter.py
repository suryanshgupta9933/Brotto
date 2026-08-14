from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..dev.ax_tree_extractor import SemanticTarget

KEEP_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox",
    "checkbox", "radio", "menuitem", "tab", "listitem",
    "heading", "dialog", "alert", "form", "main", "nav",
    "option", "switch", "slider", "spinbutton", "gridcell",
}

STRIP_ROLES = {"generic", "none", "presentation", "separator"}

MAX_CHARS = 6000


def filter_ax_targets(
    targets: list["SemanticTarget"],
    viewport_coords: tuple[int, int, int, int] | None = None,
) -> str:
    """Filter SemanticTargets to a token-capped AX tree string.

    viewport_coords: (x, y, width, height) bounding box — elements outside are marked off-screen.
    """
    # Suppress list-selection checkboxes when a link with the same name exists.
    # These are bulk-select controls (Gmail, Notion, etc.) — the link opens the item.
    link_names = {t.name.lower() for t in targets if t.role.lower() == "link" and t.name}
    shadow_checkboxes = {
        t.ref_id for t in targets
        if t.role.lower() == "checkbox" and t.name and t.name.lower() in link_names
    }

    lines: list[str] = []
    offscreen: list[str] = []

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

        if viewport_coords and t.coordinates:
            vx, vy, vw, vh = viewport_coords
            cx, cy = t.coordinates.get("x", 0), t.coordinates.get("y", 0)
            in_viewport = vx <= cx <= vx + vw and vy <= cy <= vy + vh
            if not in_viewport:
                offscreen.append(f"[off-screen] {line}")
                continue

        lines.append(line)

    result = "\n".join(lines)
    remaining = MAX_CHARS - len(result)
    if remaining > 0 and offscreen:
        off_block = "\n".join(offscreen)[:remaining - 1]
        result = result + "\n" + off_block

    if len(result) >= MAX_CHARS:
        result = result[:MAX_CHARS] + "\n[tree truncated — scroll to reveal more]"

    return result
