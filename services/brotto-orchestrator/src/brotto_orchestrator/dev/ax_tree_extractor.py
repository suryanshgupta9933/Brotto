"""CDP Accessibility Tree extractor for semantic target generation.

Extracts the full AX tree from the page via Chrome DevTools Protocol,
maps to interactive nodes, and generates semantic targets with stable refs.
This mirrors the TypeScript implementation's getAccessibilityTree() approach.
"""

from __future__ import annotations

import hashlib
from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class SemanticTarget:
    """A semantic target (interactive element) extracted from AX tree."""
    ref_id: str
    tag: str
    role: str
    name: str
    value: Optional[str] = None
    coordinates: dict[str, int] = None
    backend_node_id: Optional[int] = None
    parent_ref_id: Optional[str] = None
    # Destination for links. Rendered next to the name so the agent can read
    # the page's own link graph instead of guessing URL patterns.
    href: Optional[str] = None

    def __post_init__(self):
        if self.coordinates is None:
            self.coordinates = {}


class AXTreeExtractor:
    """Extracts semantic targets from Chrome accessibility tree via CDP."""

    # Interactive roles that should be targets for automation, plus the
    # containers that delimit a record. The structural roles are kept even
    # when nameless: they never render, but they are the parent a row's
    # fields resolve to, and without them every field in a list renders
    # flat at depth 0 with nothing marking where one record ends.
    INTERACTIVE_ROLES = {
        "button", "link", "menuitem", "tab", "textbox", "checkbox",
        "radio", "combobox", "listbox", "option", "slider", "searchbox",
        "spinbutton", "switch", "treeitem", "row", "cell", "gridcell",
        "listitem", "list", "rowgroup", "table",
    }

    @staticmethod
    def _should_include_node(ax_node: dict[str, Any]) -> bool:
        """Check if an AX node should be included as a target."""
        # Skip ignored nodes
        if ax_node.get("ignored", False):
            return False

        role = ax_node.get("role", {}).get("value", "").lower()
        name = ax_node.get("name", {}).get("value", "").strip() if ax_node.get("name") else ""

        # Include interactive roles or named clickable elements
        if role in AXTreeExtractor.INTERACTIVE_ROLES:
            return True

        # Include any visible element with a meaningful name
        if name and role in {"heading", "paragraph", "list", "image", "img"}:
            return True

        return False

    @staticmethod
    def _extract_name(ax_node: dict[str, Any]) -> str:
        """Extract readable name from AX node."""
        name_obj = ax_node.get("name", {})
        if isinstance(name_obj, dict):
            value = name_obj.get("value", "")
        else:
            value = str(name_obj)
        return value.strip()[:100]

    @staticmethod
    def _extract_value(ax_node: dict[str, Any]) -> Optional[str]:
        """Extract value from AX node (for inputs, selects, etc)."""
        value_obj = ax_node.get("value", {})
        if isinstance(value_obj, dict):
            return value_obj.get("value")
        return None

    @staticmethod
    def _get_role(ax_node: dict[str, Any]) -> str:
        """Extract role from AX node."""
        role_obj = ax_node.get("role", {})
        if isinstance(role_obj, dict):
            return role_obj.get("value", "unknown").lower()
        return str(role_obj).lower()

    @staticmethod
    def _extract_href(ax_node: dict[str, Any]) -> Optional[str]:
        """A link's destination lives in a CDP `url` property, not a
        top-level field. Returned verbatim — never synthesised — so the
        agent is reading the page's real link graph, not a guess."""
        for prop in ax_node.get("properties", []) or []:
            if prop.get("name") != "url":
                continue
            v = prop.get("value")
            return str(v.get("value")) if isinstance(v, dict) and v.get("value") else None
        return None

    @staticmethod
    async def extract_targets(
        cdp_session: Any,
        max_targets: int = 100,
    ) -> list[SemanticTarget]:
        """
        Extract semantic targets from page via CDP Accessibility API.

        Args:
            cdp_session: Playwright CDPSession from page.context.new_cdp_session()
            max_targets: Maximum number of targets to return

        Returns:
            List of SemanticTarget objects
        """
        targets: list[SemanticTarget] = []
        node_id_to_ref: dict[str, str] = {}
        # parentId for EVERY node, not just kept ones. A link's immediate
        # parent is usually a generic container that gets filtered out, so
        # resolving to the nearest *kept* ancestor is what makes the hierarchy
        # survive the filter at all.
        parent_of: dict[int, int] = {}

        try:
            # Enable accessibility domain
            await cdp_session.send("Accessibility.enable")

            # Get full AX tree
            response = await cdp_session.send("Accessibility.getFullAXTree")
            ax_nodes = response.get("nodes", [])

            # First pass: create refs for all nodes that should be targets
            for ax_node in ax_nodes:
                node_id = ax_node.get("nodeId")
                if node_id is None:
                    continue
                if ax_node.get("parentId") is not None:
                    parent_of[node_id] = ax_node["parentId"]
                if not AXTreeExtractor._should_include_node(ax_node):
                    continue

                # Generate stable ref_id based on node properties
                role = AXTreeExtractor._get_role(ax_node)
                name = AXTreeExtractor._extract_name(ax_node)
                hash_input = f"{role}:{name}:{node_id}"
                stable_hash = hashlib.md5(hash_input.encode()).hexdigest()[:8]
                ref_id = f"{role}_{stable_hash}"

                node_id_to_ref[node_id] = ref_id

            # Second pass: create SemanticTarget objects with proper coordinates
            for ax_node in ax_nodes:
                node_id = ax_node.get("nodeId")
                if node_id not in node_id_to_ref:
                    continue

                ref_id = node_id_to_ref[node_id]
                role = AXTreeExtractor._get_role(ax_node)
                name = AXTreeExtractor._extract_name(ax_node)
                value = AXTreeExtractor._extract_value(ax_node)
                backend_node_id = ax_node.get("backendDOMNodeId")

                # Get tag from properties
                tag = "unknown"
                for prop in ax_node.get("properties", []):
                    if prop.get("name") == "tag":
                        tag = str(prop.get("value", {}).get("value", "unknown")).lower()
                        break

                # Try to get coordinates from DOM via backend node ID
                coordinates: dict[str, int] = {}
                if backend_node_id:
                    try:
                        # Get bounding box for this DOM node
                        box_response = await cdp_session.send(
                            "DOM.getBoxModel",
                            {"backendNodeId": int(backend_node_id)},
                        )
                        if box_response and "model" in box_response:
                            model = box_response["model"]
                            # model.content is [x1, y1, x2, y2, ...]
                            content = model.get("content", [])
                            if len(content) >= 4:
                                x1, y1, x2, y2 = content[0], content[1], content[2], content[3]
                                coordinates = {
                                    "x": int((x1 + x2) / 2),
                                    "y": int((y1 + y2) / 2),
                                }
                    except Exception:
                        pass  # Fallback to no coordinates

                parent_ref_id = None
                parent_id = parent_of.get(node_id)
                seen: set = set()
                while parent_id is not None and parent_id not in node_id_to_ref:
                    if parent_id in seen:
                        break  # malformed tree — don't spin
                    seen.add(parent_id)
                    parent_id = parent_of.get(parent_id)
                if parent_id in node_id_to_ref:
                    parent_ref_id = node_id_to_ref[parent_id]

                target = SemanticTarget(
                    ref_id=ref_id,
                    tag=tag,
                    role=role,
                    name=name,
                    value=value,
                    coordinates=coordinates,
                    backend_node_id=backend_node_id,
                    parent_ref_id=parent_ref_id,
                    href=AXTreeExtractor._extract_href(ax_node),
                )
                targets.append(target)

                if len(targets) >= max_targets:
                    break

            await cdp_session.send("Accessibility.disable")

        except Exception as e:
            print(f"Warning: AX tree extraction failed: {e}")
            # Fallback to empty list - execute_action will handle missing targets

        return targets
