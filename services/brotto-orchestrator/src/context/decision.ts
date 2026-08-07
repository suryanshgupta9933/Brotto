/**
 * Harness decision contract and working memory.
 *
 * The model emits a NormalizedDecision per turn: either continue (one action),
 * complete (with final answer), or blocked (with reason). Working memory is
 * harness-owned — the model only proposes updates, the harness merges and
 * dedupes. This keeps memory and loop invariants out of the model's text.
 */

export interface MemoryUpdate {
  key: string;
  value: string;
  evidence: string;
}

export interface WorkingMemoryView {
  facts: MemoryUpdate[];
}

export interface StagnationSignal {
  kind: "repeated_action" | "repeated_observation";
  signature: string;
  count: number;
  message: string;
}

export type NormalizedDecision =
  | {
      kind: "continue";
      reasoning: string;
      memoryUpdates: MemoryUpdate[];
      action: { type: string; [k: string]: unknown };
    }
  | {
      kind: "blocked";
      reasoning: string;
      memoryUpdates: MemoryUpdate[];
      blockedReason: string;
    }
  | {
      kind: "complete";
      reasoning: string;
      memoryUpdates: MemoryUpdate[];
      finalAnswer: string;
    };

export class WorkingMemory {
  private facts = new Map<string, MemoryUpdate>();

  merge(updates: MemoryUpdate[]): void {
    for (const u of updates) {
      if (!u || typeof u.key !== "string") continue;
      const key = u.key.trim();
      const value = typeof u.value === "string" ? u.value.trim() : "";
      if (!key || !value) continue;
      const evidence = typeof u.evidence === "string" ? u.evidence.trim() : "";
      const existing = this.facts.get(key);
      // ponytail: first non-empty wins per key. Updates overwrite only if
      // the existing entry has no evidence — model got more specific.
      if (!existing || (!existing.evidence && evidence)) {
        this.facts.set(key, { key, value, evidence });
      }
    }
  }

  get size(): number {
    return this.facts.size;
  }

  toView(): WorkingMemoryView {
    return { facts: Array.from(this.facts.values()) };
  }
}

export function isMemoryUpdate(x: unknown): x is MemoryUpdate {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return typeof r.key === "string" && typeof r.value === "string";
}

export function validateMemoryUpdates(input: unknown): MemoryUpdate[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isMemoryUpdate);
}
