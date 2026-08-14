import type { AccessibilityNode } from "@brotto/brotto-action-schema";
import { StableRef } from "./stable-ref";

export type MatchStrategy = "exact" | "role-name" | "miss";

export interface MatchResult {
  confidence: number;
  node: AccessibilityNode | null;
  strategy: MatchStrategy;
}

export const MATCH_CONFIDENCE_THRESHOLD = 0.8;

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

// ponytail: removed "fuzzy-bounds" step — bounds aren't in StableRef identity,
// and attributeHash already includes name, so any element whose bounds drift
// also has a different hash and fails exact match. Re-add when StableRef
// stores lastSeenBounds and the algorithm compares current bounds against
// the reference's stored bounds.
export function matchStableRef(
  ref: StableRef,
  snapshot: AccessibilityNode[],
): MatchResult {
  // 1. exact: full identity match via StableRef.equals (hash + axPath + role + name)
  for (const node of snapshot) {
    if (StableRef.fromAXNode(node).equals(ref)) {
      return { confidence: 1.0, node, strategy: "exact" };
    }
  }

  // 2. role-name: same role + nearest name (Levenshtein)
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
