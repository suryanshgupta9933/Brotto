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

// ponytail: domain-agnostic validator for model-emitted memoryUpdates.
// Mirrors fact-extractor's always-crucial + goal-keyword filter. Stops the
// model from poisoning memory with facts from an unrelated domain — e.g.
// committing SOCKENUP.IN shipping updates under an "Amazon package" goal.
//
// Rule: accept if EITHER (a) key matches always-crucial category, OR (b)
// the claim (key/value/evidence) contains a goal keyword AND value does not
// contradict the goal domain (no domain in value that is absent from goal
// keywords). Otherwise reject with a reason the planner turns into a
// corrective.
const ALWAYS_CRUCIAL_RE = /^(tracking_id|order_id|amount_|status|event_date|delivered_date|sender|number)/;
const DOMAIN_RE = /\b[a-z0-9-]+\.(in|com|org|co|io|net|ai|dev|app)\b/g;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "have",
  "are", "was", "were", "but", "not", "you", "all", "any", "can", "had",
  "her", "his", "how", "man", "new", "now", "old", "see", "two", "way",
  "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use",
  "into", "over", "after", "them", "than", "then", "what", "when", "where",
  "which", "while", "would", "could", "should", "about", "their", "there",
  "these", "those", "through", "before", "because",
]);

export function extractGoalKeywords(goal: string): string[] {
  if (!goal) return [];
  const words = goal.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

export interface MemoryValidationResult {
  accepted: MemoryUpdate[];
  rejected: Array<{ update: MemoryUpdate; reason: string }>;
}

export function validateMemoryUpdatesForGoal(
  input: unknown,
  goal: string,
): MemoryValidationResult {
  const accepted: MemoryUpdate[] = [];
  const rejected: Array<{ update: MemoryUpdate; reason: string }> = [];
  if (!Array.isArray(input)) return { accepted, rejected };
  const keywords = extractGoalKeywords(goal);
  const keywordIncludes = (s: string) => keywords.length === 0 || keywords.some((kw) => s.includes(kw));
  for (const item of input) {
    if (!isMemoryUpdate(item)) continue;
    const key = item.key ?? "";
    const valueLc = (item.value ?? "").toLowerCase();
    const evidenceLc = (item.evidence ?? "").toLowerCase();
    // ponytail: contradiction check — if the value contains a domain name
    // (e.g. "sockenup.in") and that domain is NOT referenced by any goal
    // keyword (e.g. "amazon"), reject. This catches SOCKENUP.IN facts
    // sneaking through because the evidence happened to mention "gmail".
    const valueDomains = valueLc.match(DOMAIN_RE) ?? [];
    const valueContradictsGoal =
      valueDomains.length > 0 && !valueDomains.some((d) => keywordIncludes(d));
    const valueHasKeyword = keywordIncludes(valueLc);
    const evidenceHasKeyword = keywordIncludes(evidenceLc);
    const keyHasKeyword = keywordIncludes(key);
    const isAlwaysCrucial = ALWAYS_CRUCIAL_RE.test(key);
    const claimMatchesGoal = (valueHasKeyword || evidenceHasKeyword || keyHasKeyword) && !valueContradictsGoal;
    if (isAlwaysCrucial || claimMatchesGoal) {
      accepted.push(item);
    } else {
      const why = valueContradictsGoal
        ? `value references a domain [${valueDomains.join(", ")}] that isn't in the goal domain [${keywords.join(", ")}]`
        : `value/evidence/key doesn't reference any goal keyword [${keywords.join(", ")}] and key isn't in an always-crucial category`;
      rejected.push({
        update: item,
        reason: `Memory update key="${key}" value="${(item.value ?? "").slice(0, 60)}" rejected: ${why}. Drop this update or rewrite the evidence to cite a source that matches the goal domain.`,
      });
    }
  }
  return { accepted, rejected };
}
