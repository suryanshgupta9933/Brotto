/**
 * The stability gate.
 *
 * The old gate polled `document.readyState` until "complete", which fires with
 * the load event — on a SPA that is *before* the app renders anything. The
 * `auth-slowjs` fixture measures 5000ms for its control to appear and was
 * captured at ~400ms, so the model was handed a page with nothing on it.
 *
 * This is a mutation-quiet window instead: install a MutationObserver and
 * resolve once the page has been still for `quietMs`. Bounded at `deadlineMs`,
 * because a live dashboard never mutates out and a step that hangs is worse
 * than one that fires a little early.
 */

import * as dbg from "../debugger";

const QUIET_MS = 3_000;
const DEADLINE_MS = 10_000;

export interface StableOpts {
  quietMs?: number;
  deadlineMs?: number;
}

export interface Stability {
  /** The page was still for the whole quiet window. */
  waited: boolean;
  /** We gave up waiting — deadline, or no usable answer from the page. */
  timedOut: boolean;
  elapsedMs?: number;
  mutations?: number;
}

/**
 * The page-side half. Plain concatenation rather than a template literal: the
 * test extracts the functions below out of this file by brace matching, and
 * interpolated `${…}` in the middle of that text makes the match a lie.
 */
function observerExpression(quietMs: number, deadlineMs: number): string {
  const q = JSON.stringify(quietMs);
  const d = JSON.stringify(deadlineMs);
  return (
    "new Promise(function (resolve) {\n" +
    "  var t0 = Date.now();\n" +
    "  var last = t0;\n" +
    "  var count = 0;\n" +
    "  var done = false;\n" +
    "  var mo = new MutationObserver(function () { last = Date.now(); count++; });\n" +
    "  function finish(quiet) {\n" +
    "    if (done) return;\n" +
    "    done = true;\n" +
    "    clearInterval(poll);\n" +
    "    clearTimeout(hard);\n" +
    "    mo.disconnect();\n" +
    "    resolve({ quiet: quiet, elapsed: Date.now() - t0, mutations: count });\n" +
    "  }\n" +
    "  var hard = setTimeout(function () { finish(false); }, " + d + ");\n" +
    "  var poll = setInterval(function () {\n" +
    "    if (Date.now() - last >= " + q + ") finish(true);\n" +
    "  }, 50);\n" +
    "  mo.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });\n" +
    "})"
  );
}

/** `awaitPromise` is the whole ballgame — without it CDP hands back a Promise
 *  object and `result.value` is undefined. */
async function evalInPage(tabId: number, expression: string): Promise<any> {
  return await dbg.sendCommand(tabId, {
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  });
}

export async function waitForStable(
  tabId: number,
  opts?: StableOpts,
): Promise<Stability> {
  const quietMs = opts?.quietMs ?? QUIET_MS;
  const deadlineMs = opts?.deadlineMs ?? DEADLINE_MS;
  try {
    const r = await evalInPage(tabId, observerExpression(quietMs, deadlineMs));
    const v = r?.result?.value;
    // No value means the evaluate came back without resolving the promise —
    // treat it as "did not wait", which is all the caller can act on.
    return {
      waited: v?.quiet === true,
      timedOut: v?.quiet !== true,
      elapsedMs: v?.elapsed,
      mutations: v?.mutations,
    };
  } catch {
    // Tab mid-navigation: the execution context is destroyed and the evaluate
    // rejects. Capture whatever is there rather than hanging the step.
    return { waited: false, timedOut: false };
  }
}
