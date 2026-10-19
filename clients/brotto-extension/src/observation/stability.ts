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
 * A page that is *already mutating* is not waiting for its initial render — it
 * is past it. A slow renderer is the opposite shape: silent, then a change
 * (`auth-slowjs` renders at 5000ms having produced almost nothing at 1000ms).
 * So mutation rate separates the two cases, and the busy page short-circuits
 * to the caller, which rescans and compares fingerprints — the check that is
 * *already* the arbiter on every unsettled page today. The short path is a way
 * of reaching that arbiter sooner, not a second opinion from a different
 * heuristic.
 *
 * Misclassifying toward "busy" is the safe direction and cannot corrupt
 * anything: the caller rescans, compares, and if the page was in fact still
 * moving it falls back to the full gate (`noEarly`) and scans once more.
 * Misclassifying toward "quiet" would be the dangerous one, and the rate exit
 * cannot do it — it only ever reports `waited: false`.
 */

import * as dbg from "../debugger";

const QUIET_MS = 3_000;
const DEADLINE_MS = 10_000;

/**
 * Mutations needed before a rate reading means anything.
 *
 * The old rule was "3 mutations in a 1000ms window" — an absolute pair that
 * only ever described one page. Gmail mutated every ~244ms and tripped it;
 * Google Sheets mutated 3–6 times per 10,002ms (a gap of 1.7–3.3s) and tripped
 * *neither* half of the gate: too slow to be dense, too fast to fall silent
 * for 3s. 10 of 14 observations in one real Sheets run hit the full 10 002ms
 * deadline, and the tree came back from an arbitrary mid-repaint instant —
 * which is what "the agent stumbles" is made of.
 *
 * So the thresholds are relative now. One test does both jobs: if the mean gap
 * between mutations is *shorter than the quiet window*, a silent window is
 * arithmetically unreachable and waiting for it only ever ends at the deadline.
 * Gmail (244ms) and Sheets (1.7–3.3s) are the same fact about the world at
 * different frequencies, and both are handed straight to the fingerprint
 * rescan in `captureObservation`, which is the only check that can tell a page
 * still rendering from a page merely repainting.
 */
const RATE_SAMPLES = 3;

export interface StableOpts {
  quietMs?: number;
  deadlineMs?: number;
  /** Skip the rate exit. The caller's fallback when the page was
   *  still moving after the rescans, and the mode that keeps a slow
   *  renderer's full window intact. */
  noEarly?: boolean;
}

export interface Stability {
  /** The page was still for the whole quiet window. */
  waited: boolean;
  /** We gave up waiting — deadline, or no usable answer from the page. */
  timedOut: boolean;
  /** The rate short-circuit fired. We stopped before the quiet window could,
   *  so the quiet window says nothing about this page either way. */
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
  early: number,
  samples: number,
): string {
  const q = JSON.stringify(quietMs);
  const d = JSON.stringify(deadlineMs);
  const e = JSON.stringify(early);
  const n = JSON.stringify(samples);
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
    "    mo.disconnect();\n" +
    "    resolve({quiet: quiet, early: wasEarly === true, elapsed: Date.now() - t0, mutations: count});\n" +
    "  }\n" +
    "  var hard = setTimeout(function () { finish(false, false); }, " + d + ");\n" +
    // `early` 0 disables the rate exit, which is what `noEarly` asks for: the
    // caller re-waits on a page it has reason to believe is still rendering,
    // and that page gets the full quiet window a slow renderer needs.
    "  var poll = setInterval(function () {\n" +
    "    var now = Date.now();\n" +
    "    if (now - last >= " + q + ") { finish(true, false); return; }\n" +
    // Fewer than `samples` mutations is not a rate, it is an anecdote. A page
    // that has barely moved — `auth-slowjs`, whose control appears at 5000ms —
    // never forms one, so it keeps waiting and reaches the deadline.
    "    if (" + e + " === 0 || count < " + n + ") return;\n" +
    // Mean gap since t0. Shorter than the quiet window means a silent window
    // cannot happen, so waiting for one only ends at the deadline — and on
    // Sheets (gap ~1.7-3.3s against a 3s window) that was every step.
    "    if ((now - t0) / count < " + q + ") finish(false, true);\n" +
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
  try {
    const r = await evalInPage(
      tabId, observerExpression(quietMs, deadlineMs, opts?.noEarly ? 0 : 1, RATE_SAMPLES),
    );
    const v = r?.result?.value;
    // Untyped, like every other extracted body: the test evals this as plain
    // JavaScript and `: Stability` is a syntax error there.
    const stability = {
      waited: v?.quiet === true,
      timedOut: v?.quiet !== true,
      early: v?.early === true,
      elapsedMs: v?.elapsed,
      mutations: v?.mutations,
    };
    // A deadline hit used to be invisible: the gate returned, the model got a
    // tree from an arbitrary instant, and the audit blamed the model. One line
    // is enough to make the next slow page findable by name.
    if (stability.timedOut && !stability.early && stability.elapsedMs !== undefined) {
      console.warn(
        `[brotto] stability deadline hit after ${stability.elapsedMs}ms ` +
        `with ${stability.mutations ?? 0} mutation(s)`,
      );
    }
    return stability;
  } catch {
    // Tab mid-navigation: the execution context is destroyed and the evaluate
    // rejects. Capture whatever is there rather than hanging the step.
    return { waited: false, timedOut: false };
  }
}
