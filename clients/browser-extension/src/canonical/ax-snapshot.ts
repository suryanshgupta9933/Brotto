import type { AccessibilityNode, AXTuple } from "@fara-platform/fara-action-schema";
import type { CdpCommandSender } from "./observation";

export const MAX_AX_NODES = 2000;

interface RawAXNode {
  nodeId?: string;
  parentId?: string;
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

const KEY_ATTRS = ["id", "aria-label", "data-testid", "data-id", "name", "type"] as const;

function extractKeyAttrs(raw: RawAXNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEY_ATTRS) {
    const prop = raw.properties?.find((p) => p.name === k);
    const v = prop?.value?.value;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // ponytail: deterministic fallback for non-WebCrypto environments (Node test runtime).
  // Not cryptographic — adequate only for the hash collision-resistance guarantee that
  // StableRef.match relies on. Replace if running in an untrusted context.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

export async function collectAccessibilitySnapshot(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
): Promise<AccessibilityNode[]> {
  let raw: RawAXTree;
  try {
    raw = (await sendCdpCommand(tabId, "Accessibility.getFullAXTree", { perfMode: "deep" })) as RawAXTree;
  } catch (err) {
    console.warn("[ax-snapshot] Accessibility.getFullAXTree failed:", err);
    return [];
  }

  const rawNodes = raw.nodes ?? [];
  const byId = new Map<string, RawAXNode>();
  for (const n of rawNodes) if (n.nodeId) byId.set(n.nodeId, n);

  const axPathCache = new Map<string, AXTuple[]>();
  const axPathFor = (id: string): AXTuple[] => {
    const cached = axPathCache.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    if (!node?.role?.value) {
      axPathCache.set(id, []);
      return [];
    }
    const parentPath = node.parentId ? axPathFor(node.parentId) : [];
    const siblings = node.parentId
      ? rawNodes.filter((n) => n.parentId === node.parentId && n.role?.value === node.role?.value)
      : rawNodes.filter((n) => !n.parentId && n.role?.value === node.role?.value);
    const index = siblings.findIndex((s) => s.nodeId === id);
    const tuple: AXTuple = {
      role: node.role.value,
      index: Math.max(0, index),
      name: node.name?.value,
    };
    const path = [...parentPath, tuple];
    axPathCache.set(id, path);
    return path;
  };

  const nodes: AccessibilityNode[] = [];
  for (const rawNode of rawNodes) {
    if (!rawNode.nodeId || !rawNode.role?.value) continue;
    if (nodes.length >= MAX_AX_NODES) {
      console.warn(`[ax-snapshot] truncated at MAX_AX_NODES=${MAX_AX_NODES}; original=${rawNodes.length}`);
      break;
    }
    const role = rawNode.role.value;
    const name = rawNode.name?.value;
    const attrs = extractKeyAttrs(rawNode);
    const hashMaterial = `${role}|${name ?? ""}|${JSON.stringify(attrs)}`;
    const attributeHash = await sha256Hex(hashMaterial);
    const bb = rawNode.boundingBox;
    nodes.push({
      axNodeId: rawNode.nodeId,
      role,
      name,
      description: rawNode.description?.value,
      value: rawNode.value?.value != null ? String(rawNode.value.value) : undefined,
      attributes: Object.keys(attrs).length ? attrs : undefined,
      bounds:
        bb && typeof bb.x === "number" && typeof bb.y === "number"
          ? { x: bb.x, y: bb.y, width: bb.width ?? 0, height: bb.height ?? 0 }
          : undefined,
      axPath: axPathFor(rawNode.nodeId),
      attributeHash,
    });
  }
  return nodes;
}
