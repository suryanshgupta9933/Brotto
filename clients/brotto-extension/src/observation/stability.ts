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
 *
 * **The quiet window is unreachable on a page that animates, and that page is
 * the common one.** Gmail measured 41 mutations in 10,002ms — one every ~244ms
 * — so a 3s silent window is arithmetically impossible and every observation
 * paid the full deadline: 10.002s of an 11.19s observation, 47.7% of the wall
 * clock of a two-step run, every step, forever.
 *
 * A page that is *already mutating hard* a second in is not waiting for its
 * initial render — it is past it. A slow renderer is the opposite shape:
 * silent, then a change (`auth-slowjs` renders at 5000ms having produced
 * almost nothing at 1000ms). So mutation rate separates the two cases, and the
 * busy page short-circuits to the caller, which rescans and compares
 * fingerprints — the check that is *already* the arbiter on every unsettled
 * page today. The short path is a way of reaching that arbiter sooner, not a
 * second opinion from a different heuristic.
 *
 * Misclassifying toward "busy" is the safe direction and cannot corrupt
 * anything: the caller rescans, compares, and if the page was in fact still
 * moving it falls back to the full gate (`noEarly`) and scans once more.
 * Misclassifying toward "quiet" would be the dangerous one, and the sample
 * cannot do it — it only ever reports `waited: false`.
 */

import * as dbg from "../debugger";

const QUIET_MS = 3_000;
const DEADLINE_MS = 10_000;

/** How long to watch before judging the page busy. */
const BUSY_SAMPLE_MS = 1_000;
/** Mutations in that window that mean "already rendering, not about to". */
const BUSY_MUTATIONS = 3;

export interface StableOpts {
  quietMs?: number;
  deadlineMs?: number;
  /** Skip the busy short-circuit. The caller's fallback when the page was
   *  still moving after the rescans, and the mode that keeps a slow
   *  renderer's full window intact. */
  noEarly?: boolean;
}

export interface Stability {
  /** The page was still for the whole quiet window. */
  waited: boolean;
  /** We gave up waiting — deadline, or no usable answer from the page. */
  timedOut: boolean;
  /** The busy short-circuit fired. We stopped at `BUSY_SAMPLE_MS`, so the
   *  quiet window says nothing about this page either way. */
  early?: boolean;
  elapsedMs?: number;
  mutations?: number;
}

/**
 * The page-side half. Plain concatenation rather than a template literal: the
 * test extracts the functions below out of this file by brace matching, and
 * interpolated `${…}` in the middle of that text makes the match a lie.
 */
function observerExpression(
  quietMs: number,
  deadlineMs: number,
  earlyMs: number,
  busy: number,
): string {
  const q = JSON.stringify(quietMs);
  const d = JSON.stringify(deadlineMs);
  const e = JSON.stringify(earlyMs);
  const b = JSON.stringify(busy);
  return (
    "new Promise(function (resolve) {\n" +
    "  var t0 = Date.now();\n" +
    "  var last = t0;\n" +
    "  var count = 0;\n" +
    "  var done = false;\n" +
    "  var mo = new MutationObserver(function () { last = Date.now(); count++; });\n" +
    "  function finish(quiet, wasEarly) {\n" +
    "    if (done) return;\n" +
    "    done = true;\n" +
    "    clearInterval(poll);\n" +
    "    clearTimeout(hard);\n" +
    "    if (sample) clearTimeout(sample);\n" +
    "    mo.disconnect();\n" +
    "    resolve({quiet: quiet, early: wasEarly === true, elapsed: Date.now() - t0, mutations: count});\n" +
    "  }\n" +
    "  var hard = setTimeout(function () { finish(false, false); }, " + d + ");\n" +
    "  var sample = null;\n" +
    // 0 disables the sample, which is what `noEarly` asks for: the caller
    // re-waits on a page it has reason to believe is still rendering, and
    // that page gets the full quiet window a slow renderer needs.
    "  if (" + e + " > 0) sample = setTimeout(function () {\n" +
    "    if (count >= " + b + ") finish(false, true);\n" +
    "  }, " + e + ");\n" +
    "  var poll = setInterval(function () {\n" +
    "    if (Date.now() - last >= " + q + ") finish(true, false);\n" +
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

/**
 * Whether the accessibility tree is worth reading a second time.
 *
 * True whenever we cannot *prove* the page went still. The retry loop in
 * `captureObservation` is the only thing allowed to skip a rescan on this, and
 * it is deliberately not `!timedOut`: `waitForStable` returns `timedOut: false`
 * on a tab that navigated mid-observe, because there was no promise left to
 * resolve. That page has not gone still — nobody watched it — and skipping the
 * rescan there is how a half-rendered tree reaches the model.
 *
 * So the three cases are: quiet for the full window → false; ran to the
 * deadline still mutating → true; no answer at all → true.
 */
export function pageMayStillBeMoving(stability: Stability): boolean {
  return !(stability && stability.waited === true);
}

export async function waitForStable(
  tabId: number,
  opts?: StableOpts,
): Promise<Stability> {
  const quietMs = opts?.quietMs ?? QUIET_MS;
  const deadlineMs = opts?.deadlineMs ?? DEADLINE_MS;
  const earlyMs = opts?.noEarly ? 0 : BUSY_SAMPLE_MS;
  try {
    const r = await evalInPage(
      tabId, observerExpression(quietMs, deadlineMs, earlyMs, BUSY_MUTATIONS),
    );
    const v = r?.result?.value;
    // No value means the evaluate came back without resolving the promise —
    // treat it as "did not wait", which is all the caller can act on.
    return {
      waited: v?.quiet === true,
      timedOut: v?.quiet !== true,
      early: v?.early === true,
      elapsedMs: v?.elapsed,
      mutations: v?.mutations,
    };
  } catch {
    // Tab mid-navigation: the execution context is destroyed and the evaluate
    // rejects. Capture whatever is there rather than hanging the step.
    return { waited: false, timedOut: false };
  }
}
