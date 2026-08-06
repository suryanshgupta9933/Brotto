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

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementState[];
  focusedId: string | null;
  bodyTextSnippet: string;
  // ponytail: optional screenshot (base64 PNG). Only populated when DEMO_VISION=1.
  // Default OFF — DOM + body text is enough for most tasks and skips the cost.
  screenshot?: string;
}

export interface HistoryEntry {
  action: string;
  result: string;
}
