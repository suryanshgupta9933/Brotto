import type { AccessibilityNode, BoundingBox } from "@fara-platform/fara-action-schema";
import { StableRef } from "./stable-ref";

export type MatchStrategy = "exact" | "fuzzy-bounds" | "role-name" | "miss";

export interface MatchResult {
  confidence: number;
  node: AccessibilityNode | null;
  strategy: MatchStrategy;
}

export const DEFAULT_BOUNDS_TOLERANCE_PX = 10;
export const MATCH_CONFIDENCE_THRESHOLD = 0.8;

function boundsDelta(a: BoundingBox | undefined, b: BoundingBox | undefined): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export interface MatchOptions {
  boundsTolerance?: number;
}

export function matchStableRef(
  ref: StableRef,
  snapshot: AccessibilityNode[],
  options: MatchOptions = {},
): MatchResult {
  const tolerance = options.boundsTolerance ?? DEFAULT_BOUNDS_TOLERANCE_PX;

  // 1. exact: same hash + axPath via StableRef.equals
  for (const node of snapshot) {
    if (StableRef.fromAXNode(node).equals(ref)) {
      return { confidence: 1.0, node, strategy: "exact" };
    }
  }

  // 2. fuzzy-bounds: locate reference node via axPath (role+name+index chain) in snapshot,
  // then find another node with same hash+role but drifted bounds
  const refNode = snapshot.find((n) => {
    if (n.attributeHash !== ref.attributeHash) return false;
    if (n.role !== ref.role) return false;
    // match by axPath chain (role+index at each level, ignoring name for robustness)
    if (n.axPath.length !== ref.axPath.length) return false;
    for (let i = 0; i < n.axPath.length; i++) {
      if (n.axPath[i].role !== ref.axPath[i].role) return false;
      if (n.axPath[i].index !== ref.axPath[i].index) return false;
    }
    return true;
  });
  if (refNode) {
    for (const node of snapshot) {
      if (node === refNode) continue; // skip self
      if (node.attributeHash !== ref.attributeHash || node.role !== ref.role) continue;
      const delta = boundsDelta(refNode.bounds, node.bounds);
      if (delta <= tolerance) {
        return { confidence: 0.9, node, strategy: "fuzzy-bounds" };
      }
    }
  }

  // 3. role-name: same role + nearest name (Levenshtein)
  const sameRole = snapshot.filter((n) => n.role === ref.role && n.name);
  if (sameRole.length && ref.name) {
    let best: AccessibilityNode | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of sameRole) {
      const d = levenshtein(ref.name, node.name ?? "");
      if (d < bestDist) { bestDist = d; best = node; }
    }
    if (best && bestDist <= Math.max(2, Math.floor(ref.name.length / 3))) {
      return { confidence: 0.7, node: best, strategy: "role-name" };
    }
  }

  return { confidence: 0, node: null, strategy: "miss" };
}
