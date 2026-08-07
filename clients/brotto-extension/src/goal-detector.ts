// ponytail: goal-page detector. Extracts keywords from the user's goal,
// matches them against the current observation, and emits a hard "you have
// likely found the answer" banner the model can't ignore. Lives in the
// harness (not the system prompt) so it works regardless of model strength.

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can",
  "could", "do", "does", "find", "for", "from", "go", "have", "has", "how",
  "i", "if", "in", "is", "it", "its", "let", "look", "make", "may", "me",
  "my", "no", "not", "of", "on", "open", "or", "please", "show", "so",
  "some", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "us", "very", "was", "we", "what",
  "when", "where", "which", "while", "who", "why", "will", "with",
  "would", "you", "your",
  // ponytail: keep "status", "latest", "current", "update", "info" as
  // keywords — they're the actual subject of the user's goal.
]);

// ponytail: status keywords that strongly indicate an answer page on
// e-commerce / logistics / shipping sites. Used by detectGoalMatch to
// gate the banner — we only fire when there's actual data to extract.
const STATUS_KEYWORDS = [
  "delivered", "out for delivery", "shipped", "in transit",
  "arriving", "dispatched", "cancelled", "returned", "tracking id",
  "estimated delivery", "order placed", "order confirmed",
];

export function extractGoalKeywords(goal: string): string[] {
  if (!goal) return [];
  const tokens = goal.toLowerCase().match(/[a-z0-9][a-z0-9._-]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (STOPWORDS.has(tok)) continue;
    if (tok.length < 3 && !/^\d+$/.test(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= 12) break;
  }
  return out;
}

export interface GoalMatchObservation {
  url: string;
  title: string;
  pagePurpose?: string;
  bodyText: string;
}

export interface GoalMatchResult {
  matched: boolean;
  matchedKeywords: string[];
  hasStructuredFacts: boolean;
  visibleFacts: string[];
  banner: string;
}

const TRACKING_ID_RE = /\b[A-Z0-9]{3,}[-]?[A-Z0-9]{3,}[-]?[A-Z0-9]{3,}\b/g;
const ORDER_ID_RE = /#\s*[A-Z0-9][-A-Z0-9]{5,}/g;
const LONG_DIGIT_RE = /\b\d{6,}\b/g;
const SENDER_RE = /[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function hasStructuredFact(text: string): boolean {
  const checks = [
    TRACKING_ID_RE.test(text),
    ORDER_ID_RE.test(text),
    LONG_DIGIT_RE.test(text),
    SENDER_RE.test(text),
    STATUS_KEYWORDS.some((kw) => text.toLowerCase().includes(kw)),
  ];
  TRACKING_ID_RE.lastIndex = 0;
  ORDER_ID_RE.lastIndex = 0;
  LONG_DIGIT_RE.lastIndex = 0;
  return checks.some(Boolean);
}

function collectVisibleFacts(text: string): string[] {
  const facts: string[] = [];
  const lc = text.toLowerCase();
  for (const kw of STATUS_KEYWORDS) {
    const idx = lc.indexOf(kw);
    if (idx >= 0) {
      // ponytail: pull the surrounding ~40 chars so the banner carries the
      // concrete phrase ("Delivered 6 August") not just the keyword.
      const start = Math.max(0, idx - 12);
      const end = Math.min(text.length, idx + kw.length + 28);
      facts.push(text.slice(start, end).trim());
    }
  }
  const tracking = text.match(/(?:tracking\s*id|Tracking\s*ID)\s*:?\s*[A-Z0-9-]{6,}/i)?.[0];
  if (tracking) facts.push(tracking);
  const orderId = text.match(/#\s*[A-Z0-9][-A-Z0-9]{5,}/)?.[0];
  if (orderId) facts.push(orderId);
  const digits = text.match(/\b\d{6,}\b/g) ?? [];
  for (const d of digits.slice(0, 3)) facts.push(d);
  // ponytail: dedup while preserving order.
  return Array.from(new Set(facts)).slice(0, 8);
}

export function detectGoalMatch(goal: string, obs: GoalMatchObservation): GoalMatchResult {
  const keywords = extractGoalKeywords(goal);
  if (keywords.length === 0) {
    return { matched: false, matchedKeywords: [], hasStructuredFacts: false, visibleFacts: [], banner: "" };
  }
  const haystack = [
    obs.url,
    obs.title,
    obs.pagePurpose ?? "",
    obs.bodyText,
  ].join("\n").toLowerCase();
  const matchedKeywords = keywords.filter((k) => haystack.includes(k));
  const hasStructuredFacts = hasStructuredFact([obs.title, obs.pagePurpose ?? "", obs.bodyText].join("\n"));
  const visibleFacts = collectVisibleFacts([obs.title, obs.bodyText].join("\n"));
  // ponytail: require ≥2 keyword hits AND a structured fact — both gates
  // prevent false positives on pages that just mention goal words in nav.
  const matched = matchedKeywords.length >= 2 && hasStructuredFacts;
  if (!matched) {
    return { matched, matchedKeywords, hasStructuredFacts, visibleFacts, banner: "" };
  }
  const factStr = visibleFacts.length > 0 ? visibleFacts.join("; ") : "(none extracted)";
  const banner = [
    "=== GOAL MATCH DETECTED ===",
    `The current page contains keywords from your goal: ${matchedKeywords.join(", ")}.`,
    `Concrete facts visible: ${factStr}.`,
    "If the visible facts are ONLY in subject lines / list items (not in a body or page text), CLICK the relevant item to OPEN it before terminating — list-item text is often a teaser, not the actual answer.",
    "You have likely found the answer. CALL terminate(finalAnswer=<the facts>) NOW.",
    "Do NOT navigate further. The page you are on IS the answer.",
    "=== END GOAL MATCH ===",
  ].join("\n");
  return { matched, matchedKeywords, hasStructuredFacts, visibleFacts, banner };
}
