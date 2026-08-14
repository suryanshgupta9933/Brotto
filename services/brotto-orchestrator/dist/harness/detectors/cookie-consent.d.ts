/**
 * Cookie consent detector — info-level notification when banners are auto-dismissed.
 * The actual dismissal is handled by the executor (browser.ts); this detector
 * just surfaces the event so the prompt can mention it.
 */
import type { DetectResult } from "../types.js";
export declare function detectCookieDismissed(dismissedCount: number): DetectResult;
//# sourceMappingURL=cookie-consent.d.ts.map