// ponytail: pure rendering types — no Playwright dep. Shared between the
// production run() loop (server.ts) and the demo scripts.

export interface ElementState {
  id: string;
  tag: string;
  role: string;
  name: string;
  value: string;
  type?: string;
  placeholder?: string;
  focused: boolean;
  disabled: boolean;
  visible: boolean;
  cx: number;
  cy: number;
  href?: string;
  checked?: boolean;
}

export interface ElementState {
  id: string;
  tag: string;
  role: string;
  name: string;
  value: string;
  type?: string;
  placeholder?: string;
  focused: boolean;
  disabled: boolean;
  visible: boolean;
  cx: number;
  cy: number;
  href?: string;
  checked?: boolean;
}

// ponytail: replay-ready clickables inventory. Mirrors PageLinkSchema in
// packages/brotto-action-schema/src/v1/observation.ts so the orchestrator's
// Playwright path produces the same observation shape as the extension.
export interface PageLinkState {
  text: string;
  href: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
  attributeHash: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface PageButtonState {
  text: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
  attributeHash: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementState[];
  focusedId: string | null;
  bodyTextSnippet: string;
  // ponytail: optional screenshot (base64 PNG). Only populated when DEMO_VISION=1.
  // Default OFF — DOM + body text is enough for most tasks and skips the cost.
  screenshot?: string;
  // ponytail: replay-ready fields (slice E). pageIdentity is the most
  // reliable "did the click land?" signal — stable across re-renders.
  // pagePurpose / links / buttons are what the future workflow recorder
  // needs to serialize steps without re-scraping.
  pageIdentity?: string;
  pagePurpose?: string;
  links?: PageLinkState[];
  buttons?: PageButtonState[];
}

export interface HistoryEntry {
  action: string;
  result: string;
}

// ponytail: extended history shape carrying internal memory (observation,
// verdict, next-step prediction) the model uses to reason across steps.
// The UI never sees these — only the planner. The legacy HistoryEntry stays
// the default for callers that don't track memory yet; this is the v1 shape
// the orchestrator loop should migrate to.
export interface HistoryEntryV1 extends HistoryEntry {
  reasoning: string;
  observation: string;
  verdict: string;
  nextActionPrediction: string;
}

// ponytail: structured working memory rendered in every planner prompt. Model
// proposes updates; the harness owns merging + dedup. Always shown above the
// page snapshot so the model can't miss findings it already recorded.
export interface MemoryFact {
  key: string;
  value: string;
  evidence: string;
}

export interface WorkingMemoryView {
  facts: MemoryFact[];
}
