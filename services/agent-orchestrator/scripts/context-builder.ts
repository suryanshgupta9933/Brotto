import type { Page } from "playwright";
import { SNAPSHOT_FN_SRC } from "../src/context/render.js";
import type { PageSnapshot } from "../src/context/types.js";

// ponytail: thin Playwright wrapper. Pure rendering lives in src/context/ so the
// production run() loop can import it without dragging Playwright into runtime.
// Re-export from src/context/ for back-compat with demo-browser.ts.

export type { ElementState, PageSnapshot, HistoryEntry } from "../src/context/types.js";
export {
  describeAction,
  describeDiff,
  diffSnapshots,
  renderHistory,
  renderSnapshot,
  renderContext,
  looksLikeLoginPage,
} from "../src/context/render.js";

const VISION_ENABLED = process.env.DEMO_VISION === "1";

export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  // ponytail: capture DOM and screenshot in parallel. Browser-use's production
  // arch does this — both signals are useful, both arrive at the same instant.
  const domPromise = page.evaluate(SNAPSHOT_FN_SRC);
  const shotPromise = VISION_ENABLED
    ? page.screenshot({ type: "png", fullPage: false }).then((b) => b.toString("base64")).catch(() => undefined)
    : Promise.resolve(undefined);
  const [domResult, screenshot] = await Promise.all([domPromise, shotPromise]);
  if (!domResult) throw new Error("snapshotPage: evaluate returned undefined");
  const snap = domResult as Omit<PageSnapshot, "screenshot">;
  return screenshot !== undefined ? { ...snap, screenshot } : snap;
}
