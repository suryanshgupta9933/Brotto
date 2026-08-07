// ponytail: domain-agnostic fact extractor. Replaces the github-only
// autoExtractWorkingMemory so memory grows with structured findings on
// any page (Gmail, Amazon tracker, GitHub, etc.). Returns MemoryUpdate[]
// the harness merges into WorkingMemory every turn — model-emitted
// memoryUpdates are merged separately and dedup by key.

export interface MemoryUpdate {
  key: string;
  value: string;
  evidence: string;
}

export interface ExtractorObservation {
  url: string;
  title: string;
  pagePurpose?: string;
  bodyText: string;
  semanticTargets?: Array<{
    accessibleName?: { text?: string };
    attributes?: { href?: string };
  }>;
}

const MONEY_RE = /(?:[\$£€₹]\s?[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|Rs\.?|dollars?|euros?|pounds?))/gi;
const TRACKING_KEYWORD_RE = /\b(?:order\s*(?:#|number|id)|tracking\s*(?:id|number)|Tracking\s*ID|tracking)[:\s#]*([A-Z0-9][-A-Z0-9]{5,})/gi;
const LONG_DIGIT_RE = /\b\d{6,}\b/g;
const SENDER_RE = /([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;
const MONTH_DAY_RE = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December))\b/gi;
const DELIVERED_DATE_RE = /\bDelivered\s+(\d{1,2}\s+\w+)/gi;
const STATUS_WORDS = ["delivered", "out for delivery", "shipped", "in transit", "arriving", "dispatched", "cancelled", "returned"];

function uniqueKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) {
    taken.add(key);
    return key;
  }
  let i = 2;
  while (taken.has(`${key}_${i}`)) i += 1;
  const k = `${key}_${i}`;
  taken.add(k);
  return k;
}

function factMatchesGoal(fact: { key: string; value: string }, goalKeywords: string[]): boolean {
  if (goalKeywords.length === 0) return true;
  const lc = (fact.key + " " + fact.value).toLowerCase();
  return goalKeywords.some((kw) => lc.includes(kw));
}

export function extractFacts(obs: ExtractorObservation, goalKeywords: string[]): MemoryUpdate[] {
  const evidence = `${obs.title || "(untitled)"} (${obs.url})`;
  const corpus = [obs.title, obs.pagePurpose ?? "", obs.bodyText].join("\n");
  const out: MemoryUpdate[] = [];
  const taken = new Set<string>();

  // ponytail: tracking IDs (Amazon, FedEx, DHL, etc.). Always crucial —
  // keep regardless of goal match.
  let m: RegExpExecArray | null;
  MONEY_RE.lastIndex = 0;
  TRACKING_KEYWORD_RE.lastIndex = 0;
  while ((m = TRACKING_KEYWORD_RE.exec(corpus)) !== null) {
    const id = m[1];
    const kind = m[0].toLowerCase().includes("tracking") ? "tracking_id" : "order_id";
    const key = uniqueKey(kind, taken);
    out.push({ key, value: id, evidence });
    if (out.length >= 30) break;
  }

  // ponytail: standalone long digits (tracking IDs without the keyword).
  LONG_DIGIT_RE.lastIndex = 0;
  const standaloneDigits = corpus.match(LONG_DIGIT_RE) ?? [];
  for (const d of standaloneDigits.slice(0, 4)) {
    const key = uniqueKey("number", taken);
    out.push({ key, value: d, evidence });
    if (out.length >= 30) break;
  }

  // ponytail: money amounts.
  MONEY_RE.lastIndex = 0;
  const money = corpus.match(MONEY_RE) ?? [];
  for (const m0 of money.slice(0, 4)) {
    const cur = m0[0];
    const key = uniqueKey(`amount_${cur}`, taken);
    out.push({ key, value: m0, evidence });
    if (out.length >= 30) break;
  }

  // ponytail: status keywords + their surrounding context.
  const lc = corpus.toLowerCase();
  for (const w of STATUS_WORDS) {
    const idx = lc.indexOf(w);
    if (idx >= 0) {
      const start = Math.max(0, idx - 8);
      const end = Math.min(corpus.length, idx + w.length + 24);
      const snippet = corpus.slice(start, end).trim();
      const key = uniqueKey("status", taken);
      out.push({ key, value: snippet, evidence });
      if (out.length >= 30) break;
    }
  }

  // ponytail: dates — both generic and delivered-specific.
  MONTH_DAY_RE.lastIndex = 0;
  const dates = corpus.match(MONTH_DAY_RE) ?? [];
  for (const d of dates.slice(0, 3)) {
    const key = uniqueKey("event_date", taken);
    out.push({ key, value: d.trim(), evidence });
  }
  DELIVERED_DATE_RE.lastIndex = 0;
  const delivered = corpus.match(DELIVERED_DATE_RE) ?? [];
  for (const d of delivered.slice(0, 2)) {
    const key = uniqueKey("delivered_date", taken);
    out.push({ key, value: d.trim(), evidence });
  }

  // ponytail: sender addresses (always crucial — they're identity signals).
  SENDER_RE.lastIndex = 0;
  const senders = corpus.match(SENDER_RE) ?? [];
  const senderDomains = new Set<string>();
  for (const s of senders.slice(0, 6)) {
    const domain = s.split("@")[1] ?? "";
    if (!domain || senderDomains.has(domain)) continue;
    senderDomains.add(domain);
    const key = uniqueKey("sender", taken);
    out.push({ key, value: s.trim(), evidence });
    if (out.length >= 30) break;
  }

  // ponytail: URL path facts. /orders/123 → key=path_orders value=123.
  try {
    const u = new URL(obs.url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2) {
      const last = segs[segs.length - 1] ?? "";
      const prev = segs[segs.length - 2] ?? "";
      if (last.length >= 4 && /[a-z0-9]/i.test(last)) {
        const key = uniqueKey(`path_${prev}`, taken);
        out.push({ key, value: last, evidence });
      }
    }
  } catch { /* invalid URL */ }

  // ponytail: keep facts that match goal keywords OR come from always-crucial
  // categories (IDs, money, dates, senders, status). Drops pure noise.
  return out.filter((f) => {
    const alwaysCrucial = /^(tracking_id|order_id|amount_|status|event_date|delivered_date|sender|number)/.test(f.key);
    return alwaysCrucial || factMatchesGoal(f, goalKeywords);
  });
}
