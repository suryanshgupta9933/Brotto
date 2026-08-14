/**
 * Cookie consent detector — info-level notification when banners are auto-dismissed.
 * The actual dismissal is handled by the executor (browser.ts); this detector
 * just surfaces the event so the prompt can mention it.
 */
import { correctiveMessages } from "../correction/templates.js";
export function detectCookieDismissed(dismissedCount) {
    if (dismissedCount === 0) {
        return { detector: "cookie-consent", severity: "info", message: null };
    }
    return {
        detector: "cookie-consent",
        severity: "info",
        message: correctiveMessages.cookieDismissed(dismissedCount),
    };
}
//# sourceMappingURL=cookie-consent.js.map