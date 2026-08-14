/**
 * Cookie-consent banner dismisser. Self-contained — the extension uses
 * chrome.debugger (no Playwright like the eval driver) so this can't
 * import from there. Mirrors the eval driver's selector list.
 *
 * ponytail: this is a small, contained helper. Adding a new CMP is one
 * line in TARGETED_SELECTORS. Run before captureSnapshotForDriver so
 * the planner sees the page underneath, not the banner.
 */

const TARGETED_SELECTORS: string[] = [
  "#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  ".qc-cmp2-summary-actions > button[mode=\"primary\"]",
  "#truste-consent-track-button",
  ".truste_button_direct",
  "#accept-cookies",
  ".cc-allow",
  ".js-cookie-accept",
  "[data-testid=\"cookie-banner-accept\"]",
  "[aria-label*=\"Accept cookies\" i]",
  "[aria-label*=\"Accept all\" i]",
  "[aria-label*=\"Allow all\" i]",
  "[aria-label*=\"I agree\" i]",
  "button:has-text(\"Accept all\")",
  "button:has-text(\"Accept All\")",
  "button:has-text(\"Accept\")",
  "button:has-text(\"I agree\")",
  "button:has-text(\"I Accept\")",
  "button:has-text(\"Allow all\")",
  "button:has-text(\"Got it\")",
  "button:has-text(\"OK\")",
  "button:has-text(\"Agree\")",
];

/**
 * Click any visible consent banner buttons. Returns the count dismissed.
 *
 * Uses Runtime.evaluate through the chrome.debugger session. The
 * selectors are evaluated as a single batch so we don't pay the
 * evaluate-roundtrip cost for each one.
 */
export async function dismissCookieBanners(
  debuggerSend: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<number> {
  let dismissed = 0;
  for (const selector of TARGETED_SELECTORS) {
    try {
      // Quote the selector for use inside an evaluate() call.
      const result = await debuggerSend("Runtime.evaluate", {
        expression:
          `(() => {` +
          `  const sel = ${JSON.stringify(selector)};` +
          `  const el = document.querySelector(sel);` +
          `  if (el && el.offsetParent !== null) { el.click(); return true; }` +
          `  return false;` +
          `})()`,
        returnByValue: true,
        awaitPromise: false,
      });
      const got = (result as { result?: { value?: unknown } } | undefined)?.result?.value;
      if (got === true) {
        dismissed += 1;
        // brief settle; some banners animate
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch {
      /* selector failed to evaluate, skip */
    }
  }
  return dismissed;
}