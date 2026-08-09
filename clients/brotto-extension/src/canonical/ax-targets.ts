/**
 * CDP Accessibility.getFullAXTree → SemanticTarget[] + per-row groupings.
 *
 * The DOM walker (actionableSelector + TreeWalker) produces flat lists of
 * every interactive child of every container. For Gmail / Outlook / GitHub
 * issue lists this means each row emits 5-10 elements (checkbox, star,
 * sender, subject, preview, date, attachment, action button, row container)
 * and the model can't tell which element forms a single row, which one
 * navigates, or which is the most recent.
 *
 * The CDP AX tree replaces this with:
 * - stable nodeIds (survive DOM mutations; the walker hashes are fragile)
 * - implicit roles computed by Chrome (button, link, listitem, row, etc.)
 * - parent/child structure (listitem → link, etc.)
 * - implicit shadow DOM + iframe traversal
 * - per-element properties (selected, expanded, level, valuetext)
 *
 * This module produces both:
 * 1. SemanticTarget[] — same shape as the DOM-walker output, so downstream
 *    resolveTargetId / verifyTargetFidelity keep working unchanged.
 * 2. Row groups — list/listitem → {link, staticText} children, with a
 *    navigable-flag per child so the renderer can mark the row's actual
 *    navigation target.
 *
 * The DOM walker stays as a fallback when CDP is unavailable.
 */

import type { CdpCommandSender } from "./observation";
import { opaqueUuid } from "./observation";
import { sanitizeSemanticTarget, computeStableRef } from "./redaction";

const MAX_AX_TARGETS = 200;

// Roles that actually navigate when clicked. Containers (listitem,
// row, group, generic) are NOT navigable even when they have role=link
// or are inside a focusable ancestor.
const NAVIGABLE_ROLES = new Set([
  "link",
  "button",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "option",
  "textbox",
  "searchbox",
  "slider",
  "spinbutton",
  "treeitem",
]);

const TEXT_ROLES = new Set([
  "statictext",
  "text",
  "heading",
  "label",
  "caption",
]);

const GROUP_ROLES = new Set([
  "list",
  "listitem",
  "row",
  "rowgroup",
  "grid",
  "gridrow",
  "gridcell",
  "table",
  "tabpanel",
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "navigation",
  "main",
  "region",
]);

interface RawAXNode {
  nodeId?: string;
  parentId?: string | null;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  value?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  childIds?: string[];
  boundingBox?: { x?: number; y?: number; width?: number; height?: number };
}

interface RawAXTree {
  nodes?: RawAXNode[];
}

interface AxProp {
  name: string;
  value: unknown;
}

function axProps(node: RawAXNode): AxProp[] {
  return (node.properties ?? []).map((p) => ({
    name: p.name,
    value: p.value?.value,
  }));
}

function axProp(node: RawAXNode, name: string): unknown {
  return axProps(node).find((p) => p.name === name)?.value;
}

function isNavigable(node: RawAXNode): boolean {
  const role = node.role?.value ?? "";
  return NAVIGABLE_ROLES.has(role);
}

function isText(node: RawAXNode): boolean {
  const role = node.role?.value ?? "";
  return TEXT_ROLES.has(role);
}

function isGroup(node: RawAXNode): boolean {
  const role = node.role?.value ?? "";
  return GROUP_ROLES.has(role);
}

function deriveTag(role: string): string {
  switch (role) {
    case "button":
      return "button";
    case "link":
      return "a";
    case "textbox":
    case "searchbox":
    case "combobox":
    case "spinbutton":
    case "slider":
      return "input";
    case "checkbox":
    case "radio":
    case "switch":
      return "input";
    case "listbox":
      return "select";
    case "option":
      return "option";
    case "heading":
      return "h2";
    case "img":
      return "img";
    case "navigation":
      return "nav";
    case "main":
      return "main";
    case "list":
    case "listitem":
      return "div";
    default:
      return "div";
  }
}

function deriveControlKind(role: string): "input" | "non_input" {
  if (role === "textbox" || role === "searchbox" || role === "combobox") return "input";
  if (role === "checkbox" || role === "radio" || role === "switch") return "input";
  if (role === "spinbutton" || role === "slider") return "input";
  return "non_input";
}

function deriveInputType(role: string): string {
  switch (role) {
    case "searchbox":
      return "search";
    case "combobox":
      return "text";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "spinbutton":
      return "number";
    case "slider":
      return "range";
    default:
      return "text";
  }
}

function deriveAttributes(node: RawAXNode): Record<string, string> | undefined {
  const SAFE = ["id", "aria-label", "name", "type", "role", "placeholder", "title", "data-testid"];
  const out: Record<string, string> = {};
  for (const attr of SAFE) {
    const v = axProp(node, attr);
    if (typeof v === "string" && v.length > 0 && v.length <= 200) out[attr] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function collectSemanticTargetsFromAXTree(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
): Promise<
  Array<{
    targetId: string;
    stableRef?: string;
    tag: string;
    role?: string;
    accessibleName?: { source: string; text: string };
    attributes?: Record<string, string>;
    control: { kind: "input"; inputType: string } | { kind: "non_input" };
    boundingBox: { x: number; y: number; width: number; height: number };
    visible: boolean;
    framePath: string[];
    shadowPath?: string[];
    locatorCandidates: never[];
  }>
> {
  let raw: RawAXTree;
  try {
    raw = (await sendCdpCommand(tabId, "Accessibility.getFullAXTree", { perfMode: "deep" })) as RawAXTree;
  } catch (err) {
    console.warn("[ax-targets] Accessibility.getFullAXTree failed:", err);
    return [];
  }
  return axNodesToSemanticTargets(raw.nodes ?? []);
}

export async function axNodesToSemanticTargets(
  rawNodes: RawAXNode[],
): Promise<
  Array<{
    targetId: string;
    stableRef?: string;
    tag: string;
    role?: string;
    accessibleName?: { source: string; text: string };
    attributes?: Record<string, string>;
    control: { kind: "input"; inputType: string } | { kind: "non_input" };
    boundingBox: { x: number; y: number; width: number; height: number };
    visible: boolean;
    framePath: string[];
    shadowPath?: string[];
    locatorCandidates: never[];
  }>
> {
  const out: Array<{
    targetId: string;
    stableRef?: string;
    tag: string;
    role?: string;
    accessibleName?: { source: string; text: string };
    attributes?: Record<string, string>;
    control: { kind: "input"; inputType: string } | { kind: "non_input" };
    boundingBox: { x: number; y: number; width: number; height: number };
    visible: boolean;
    framePath: string[];
    shadowPath?: string[];
    locatorCandidates: never[];
  }> = [];

  for (const node of rawNodes) {
    if (out.length >= MAX_AX_TARGETS) break;
    if (!node.nodeId || !node.role?.value) continue;
    if (node.ignored) continue;
    const role = node.role.value;
    if (!isNavigable(node) && !isGroup(node) && !isText(node)) continue;
    const bb = node.boundingBox;
    if (!bb || typeof bb.x !== "number" || typeof bb.y !== "number") continue;
    const width = typeof bb.width === "number" ? bb.width : 0;
    const height = typeof bb.height === "number" ? bb.height : 0;
    const tag = deriveTag(role);
    const controlKind = deriveControlKind(role);
    const control = controlKind === "input"
      ? ({ kind: "input" as const, inputType: deriveInputType(role) as "text" | "search" | "email" | "tel" | "url" | "number" | "date" | "checkbox" | "radio" })
      : ({ kind: "non_input" as const });
    const accessibleName = node.name?.value
      ? { source: "computed", text: node.name.value }
      : undefined;
    const attributes = deriveAttributes(node);
    const stableRef = await computeStableRef({
      tag,
      role,
      accessibleName: node.name?.value,
      attributes: {
        "data-testid": attributes?.["data-testid"],
        name: attributes?.name,
        "aria-label": attributes?.["aria-label"],
        type: attributes?.type,
      },
    });
    const targetId = await opaqueUuid(`ax:${node.nodeId}:${stableRef}`);
    out.push({
      targetId,
      stableRef,
      tag,
      role,
      accessibleName,
      attributes,
      control,
      boundingBox: { x: bb.x, y: bb.y, width, height },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    });
  }
  return out;
}

export interface RowNodeView {
  nodeId: string;
  role: string;
  name: string;
  bbox: { x: number; y: number; width: number; height: number };
  navigable: boolean;
  isContainer: boolean;
  stableRef?: string;
}

export interface RowGroupView {
  parentNodeId: string;
  parentRole: string;
  parentName: string;
  navigableChildCount: number;
  children: RowNodeView[];
}

export function axNodesToRowGroups(rawNodes: RawAXNode[]): RowGroupView[] {
  const byId = new Map<string, RawAXNode>();
  for (const n of rawNodes) if (n.nodeId) byId.set(n.nodeId, n);

  const groups: RawAXNode[] = [];
  for (const n of rawNodes) {
    if (!n.role?.value) continue;
    if (isGroup(n)) groups.push(n);
  }

  const out: RowGroupView[] = [];
  for (const g of groups) {
    if (!g.nodeId) continue;
    const children: RowNodeView[] = [];
    let navCount = 0;
    for (const childId of g.childIds ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      if (!child.role?.value) continue;
      const childRole = child.role.value;
      const bb = child.boundingBox;
      if (!bb || typeof bb.x !== "number" || typeof bb.y !== "number") continue;
      const nav = isNavigable(child);
      const container = isGroup(child);
      if (nav) navCount++;
      children.push({
        nodeId: child.nodeId ?? "",
        role: childRole,
        name: child.name?.value ?? "",
        bbox: {
          x: bb.x,
          y: bb.y,
          width: typeof bb.width === "number" ? bb.width : 0,
          height: typeof bb.height === "number" ? bb.height : 0,
        },
        navigable: nav,
        isContainer: container,
      });
    }
    out.push({
      parentNodeId: g.nodeId,
      parentRole: g.role?.value ?? "",
      parentName: g.name?.value ?? "",
      navigableChildCount: navCount,
      children,
    });
  }
  return out;
}
