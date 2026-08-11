// ponytail: unit tests for the detection helpers in local-driver.ts. These
// are pure functions, so we exercise them directly without the runner.

import { detectLoop, detectPageStagnation, detectStagnation, detectStuckFailures, looksLikeAuthChallenge, looksLikeLoginPage, looksLikeSignInLink, needsApproval, isRowContainerRetry, extractDateToken, renderObservationForPlanner, viewportsMatch } from "../src/local-driver";
import type { ObservationV1, SemanticTarget } from "@brotto/brotto-action-schema";

describe("detectLoop", () => {
  it("returns false when history is shorter than threshold", () => {
    const history = [
      { action: "click", result: "ok" },
      { action: "click", result: "ok" },
    ];
    expect(detectLoop(history, 3).loop).toBe(false);
  });

  it("returns true when last N actions are identical", () => {
    const history = [
      { action: "click", result: "ok" },
      { action: "click", result: "ok" },
      { action: "click", result: "ok" },
    ];
    const result = detectLoop(history, 3);
    expect(result.loop).toBe(true);
    expect(result.action).toBe("click");
  });

  it("returns false when last N actions vary", () => {
    const history = [
      { action: "click", result: "ok" },
      { action: "type", result: "ok" },
      { action: "click", result: "ok" },
    ];
    expect(detectLoop(history, 3).loop).toBe(false);
  });

  it("respects custom threshold", () => {
    const history = [
      { action: "x", result: "ok" },
      { action: "x", result: "ok" },
      { action: "x", result: "ok" },
      { action: "x", result: "ok" },
    ];
    expect(detectLoop(history, 4).loop).toBe(true);
    expect(detectLoop(history, 5).loop).toBe(false);
  });
});

describe("detectPageStagnation", () => {
  // ponytail: regression for the GitHub "find repo with most stars" run
  // where the model clicked (44, 76) four times in a row on the same
  // page without navigating. The pageIdentity fingerprint stays stable
  // across re-renders; 3 consecutive identical fingerprints = stuck.
  it("returns null with fewer than 3 entries", () => {
    expect(detectPageStagnation([])).toBeNull();
    expect(detectPageStagnation(["abc"])).toBeNull();
    expect(detectPageStagnation(["abc", "abc"])).toBeNull();
  });

  it("returns null when the last 3 pageIdentities are different", () => {
    expect(detectPageStagnation(["abc", "def", "ghi"])).toBeNull();
  });

  it("fires when the last 3 pageIdentities match", () => {
    const r = detectPageStagnation(["x", "y", "x", "x", "x"]);
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("repeated_observation");
    expect(r?.signature).toBe("x");
  });

  it("skips empty pageIdentity entries (uncomputable)", () => {
    expect(detectPageStagnation(["", "", ""])).toBeNull();
    expect(detectPageStagnation(["x", "", "x"])).toBeNull();
  });
});

describe("detectStagnation (regression for action + obs-sig signals)", () => {
  it("still fires on repeated actions even when page identity changes", () => {
    // Click(44, 76) x3, then click(44, 76) again after page changed —
    // the action repetition is the secondary signal.
    const actionSigs = ["click:44,76", "click:44,76", "click:44,76", "click:44,76"];
    const obsSigs = ["a|b|1", "a|b|2", "a|b|3", "a|b|4"];
    const r = detectStagnation(actionSigs, obsSigs);
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("repeated_action");
  });
});

describe("detectStuckFailures", () => {
  it("returns false when fewer than threshold failures", () => {
    const failures = [
      { action: "click", error: "x", ts: 1 },
      { action: "click", error: "x", ts: 2 },
    ];
    expect(detectStuckFailures(failures, 3).stuck).toBe(false);
  });

  it("returns true when last N failures are the same action", () => {
    const failures = [
      { action: "click", error: "first", ts: 1 },
      { action: "click", error: "second", ts: 2 },
      { action: "click", error: "third", ts: 3 },
    ];
    const result = detectStuckFailures(failures, 3);
    expect(result.stuck).toBe(true);
    expect(result.action).toBe("click");
    expect(result.error).toBe("first");
  });

  it("returns false when failures vary", () => {
    const failures = [
      { action: "click", error: "x", ts: 1 },
      { action: "type", error: "y", ts: 2 },
      { action: "click", error: "z", ts: 3 },
    ];
    expect(detectStuckFailures(failures, 3).stuck).toBe(false);
  });
});

describe("needsApproval", () => {
  const obs = { url: "https://example.com/", accessibilityNodes: [{ name: "Sign up" }, { name: "or login" }] };

  it("approves safe actions on benign pages", () => {
    expect(needsApproval({ type: "left_click" }, obs).needs).toBe(false);
    expect(needsApproval({ type: "insert_text", text: "hello" }, obs).needs).toBe(false);
  });

  it("requires approval when page mentions destructive keywords", () => {
    const evilPage = { url: "https://example.com/", accessibilityNodes: [{ name: "Delete account permanently" }] };
    const r = needsApproval({ type: "left_click" }, evilPage);
    expect(r.needs).toBe(true);
    expect(r.reason).toContain("delete");
  });

  it("requires approval when navigating to payment URLs", () => {
    const r = needsApproval({ type: "visit_url", url: "https://stripe.com/checkout/123" }, obs);
    expect(r.needs).toBe(true);
    expect(r.reason).toContain("stripe.com");
  });

  it("requires approval for insert_text when both text and page contain destructive keyword", () => {
    const evilPage = { url: "https://example.com/", accessibilityNodes: [{ name: "Send money to friend" }] };
    const r = needsApproval({ type: "insert_text", text: "send money 100" }, evilPage);
    expect(r.needs).toBe(true);
  });

  it("does not require approval for insert_text if only the typed text contains keyword", () => {
    // ponytail: heuristic is conservative — only trigger when the page
    // context also matches. Prevents false positives on every form fill.
    const r = needsApproval({ type: "insert_text", text: "delete" }, obs);
    expect(r.needs).toBe(false);
  });

  it("handles missing accessibilityNodes gracefully", () => {
    expect(needsApproval({ type: "left_click" }, { url: "https://example.com/" }).needs).toBe(false);
  });
});

describe("looksLikeLoginPage", () => {
  function obs(elements: Array<{ tag: string; control: { kind: string; type?: string }; visible: boolean }>, url = "https://x.com/login") {
    return { url, semanticTargets: elements };
  }

  it("returns false when no password input", () => {
    const r = looksLikeLoginPage(obs([
      { tag: "input", control: { kind: "input", type: "text" }, visible: true },
    ]) as never);
    expect(r.login).toBe(false);
  });

  it("returns true when password input and submit button present", () => {
    const r = looksLikeLoginPage(obs([
      { tag: "input", control: { kind: "input", type: "password" }, visible: true },
      { tag: "input", control: { kind: "input", type: "submit" }, visible: true },
    ]) as never);
    expect(r.login).toBe(true);
    expect(r.domain).toBe("x.com");
  });

  it("ignores password input when not visible", () => {
    const r = looksLikeLoginPage(obs([
      { tag: "input", control: { kind: "input", type: "password" }, visible: false },
      { tag: "button", control: { kind: "button" }, visible: true },
    ]) as never);
    expect(r.login).toBe(false);
  });
});

describe("looksLikeAuthChallenge", () => {
  it("matches login-style paths", () => {
    const r = looksLikeAuthChallenge({ url: "https://github.com/login?return_to=/", title: "Sign in" } as never);
    expect(r.auth).toBe(true);
    expect(r.domain).toBe("github.com");
  });

  it("matches 2FA / verify / consent", () => {
    const cases = [
      "https://x.com/account/login/verify",
      "https://x.com/two-factor",
      "https://x.com/oauth/authorize?client_id=abc",
      "https://x.com/consent",
    ];
    for (const url of cases) {
      const r = looksLikeAuthChallenge({ url, title: "" } as never);
      expect(r.auth).toBe(true);
    }
  });

  it("matches login-style titles", () => {
    const r = looksLikeAuthChallenge({ url: "https://x.com/", title: "Verify you are human" } as never);
    expect(r.auth).toBe(true);
  });

  it("returns false on a normal landing page", () => {
    const r = looksLikeAuthChallenge({ url: "https://github.com/", title: "GitHub: Let's build from here" } as never);
    expect(r.auth).toBe(false);
  });
});

describe("looksLikeSignInLink", () => {
  it("detects a visible Sign in anchor on a logged-out page", () => {
    const r = looksLikeSignInLink({
      url: "https://github.com/",
      semanticTargets: [
        { tag: "a", accessibleName: { text: "Sign in" }, visible: true, control: { kind: "link" } as never, targetId: "abc" as never, stableRef: "abc" },
      ],
    } as never);
    expect(r.link).toBe(true);
    expect(r.label.toLowerCase()).toBe("sign in");
    expect(r.targetId).toBe("abc");
  });

  it("returns false when no sign-in / log-in / continue text", () => {
    const r = looksLikeSignInLink({
      url: "https://github.com/",
      semanticTargets: [
        { tag: "a", accessibleName: { text: "Pricing" }, visible: true, control: { kind: "link" } as never, targetId: "abc" as never, stableRef: "abc" },
      ],
    } as never);
    expect(r.link).toBe(false);
  });
});

describe("extractDateToken", () => {
  // ponytail: regression for the "agent opened an older Amazon email"
  // failure. Gmail embeds the row date inline in the accessibleName; without
  // the model seeing that token, it picks whichever row Gmail happens to
  // surface first (search default = 'Most relevant', NOT date).
  it.each([
    ["Gmail month-day with year", "Amazon - Order shipped, Aug 5, 2025, 4:32 PM", "Aug 5, 2025"],
    ["Gmail month-day with time", "Amazon - Order shipped, Aug 5, 4:32 PM", "Aug 5"],
    ["Outlook day-month-year", "Amazon - Order delivered 5 Aug 2025 16:32", "5 Aug 2025"],
    ["Outlook day-month no year", "Amazon - Order delivered 5 Aug", "5 Aug"],
    ["Today", "Amazon - Order delivered Today", "Today"],
    ["Yesterday", "Amazon - Order delivered Yesterday", "Yesterday"],
  ])("parses %s", (_label, input, contains) => {
    const got = extractDateToken(input);
    expect(got).not.toBeNull();
    expect(got!.toLowerCase()).toContain(contains.toLowerCase());
  });

  it("returns null when no date token is present", () => {
    expect(extractDateToken("Amazon - Order delivered")).toBeNull();
    expect(extractDateToken("")).toBeNull();
  });
});

describe("isRowContainerRetry", () => {
  // ponytail: regression for the Gmail search results click pattern where
  // the planner clicks (481, 340) then (396, 340) — same row, different x,
  // both [Unchanged]. Helper returns true so the harness rejects the
  // second click instead of dispatching it and burning another [Unchanged]
  // turn.
  it("returns true for two clicks in the same row band", () => {
    expect(isRowContainerRetry({ x: 481, y: 340 }, { x: 396, y: 340 })).toBe(true);
  });

  it("returns true for clicks at slightly different y within the band", () => {
    expect(isRowContainerRetry({ x: 481, y: 340 }, { x: 500, y: 360 })).toBe(true);
  });

  it("returns false when the next click is on a different row (y delta > 25)", () => {
    expect(isRowContainerRetry({ x: 481, y: 340 }, { x: 396, y: 420 })).toBe(false);
  });

  it("returns false when the next click is way off in x (outside row span)", () => {
    expect(isRowContainerRetry({ x: 481, y: 340 }, { x: 1000, y: 340 })).toBe(false);
  });

  it("returns false when there is no previous unchanged click", () => {
    expect(isRowContainerRetry(null, { x: 481, y: 340 })).toBe(false);
  });
});

describe("looksLikeAuthChallenge — Google OAuth round-trip", () => {
  // ponytail: regression test for the GitHub "Sign in with Google" run.
  // The user's tab bounces between github.com/login →
  // accounts.google.com/o/oauth2/v2/auth?... → github.com/login/oauth/...
  // The detector must flag the Google auth URL as a challenge so the
  // loop pauses for the user; and once the loop has paused for github.com,
  // the per-domain cooldown (in runLocalLoop) prevents re-pausing on
  // the github.com post-callback URL.
  it("flags accounts.google.com OAuth URLs", () => {
    const r = looksLikeAuthChallenge({
      url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=https%3A%2F%2Fgithub.com%2Flogin%2Foauth%2Fauthorize&scope=email",
      title: "Sign in",
    } as never);
    expect(r.auth).toBe(true);
    expect(r.domain).toBe("accounts.google.com");
  });

  it("flags github.com/login as a challenge", () => {
    const r = looksLikeAuthChallenge({
      url: "https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2F",
      title: "Sign in to GitHub",
    } as never);
    expect(r.auth).toBe(true);
    expect(r.domain).toBe("github.com");
  });

  it("flags the github.com post-callback URL as a challenge (cooldown prevents re-pause)", () => {
    // The post-callback URL is /login/oauth/authorize?code=...&state=...
    // — it matches AUTH_PATH_RE on /login. The detector DOES flag it,
    // but the per-domain cooldown in runLocalLoop prevents the loop
    // from pausing twice on the same domain. The detector's job is to
    // catch the URL pattern; the cooldown handles deduplication.
    const r = looksLikeAuthChallenge({
      url: "https://github.com/login/oauth/authorize?code=abc123&state=xyz",
      title: "GitHub",
    } as never);
    expect(r.auth).toBe(true);
  });

  it("does NOT flag the github.com dashboard (logged-in) URL", () => {
    // After the callback, the user is redirected to github.com/ — this
    // path does NOT match the regex, so the detector correctly does
    // not pause. Combined with the per-domain cooldown, this means the
    // loop only pauses once across the entire Google OAuth round-trip.
    const r = looksLikeAuthChallenge({
      url: "https://github.com/",
      title: "GitHub",
    } as never);
    expect(r.auth).toBe(false);
  });
});

describe("renderObservationForPlanner — INBOX ROWS block on email URLs", () => {
  function obs(url: string, rows: Array<{ id: string; name: string; cx: number; cy: number; }>): ObservationV1 {
    return {
      url,
      title: "Search results - Gmail",
      semanticTargets: rows.map((r) => ({
        targetId: r.id,
        stableRef: r.id,
        tag: "div",
        role: "link",
        accessibleName: { text: r.name },
        attributes: {},
        control: { kind: "link" },
        boundingBox: { x: r.cx - 50, y: r.cy - 20, width: 100, height: 40 },
        visible: true,
        framePath: [],
        locatorCandidates: [],
      })) as unknown as SemanticTarget[],
      // minimal valid ObservationV1 — fields the renderer doesn't touch are stubbed.
      observationId: "obs-1" as never,
      capturedAt: new Date().toISOString(),
      page: { tabId: "0".repeat(36) as never, frameId: "0".repeat(36) as never, lifecycle: "complete", visibility: "visible" },
      bodyText: "",
    } as unknown as ObservationV1;
  }

  it("renders an INBOX ROWS block on Gmail URLs", () => {
    const o = obs("https://mail.google.com/mail/u/0/#search/from:amazon", [
      { id: "row-1", name: "Amazon - Shipped, Aug 8, 2025, 4:32 PM", cx: 480, cy: 200 },
      { id: "row-2", name: "Amazon - Delivered, Aug 5, 2025, 4:32 PM", cx: 480, cy: 260 },
    ]);
    const out = renderObservationForPlanner(o, [], undefined, [], { index: 1, totalBudget: 60_000, elapsedMs: 0, budgetMs: 60_000, pageIdentity: "" }, "", [], "x");
    expect(out).toContain("INBOX ROWS");
    expect(out).toContain('sender="Amazon"');
    expect(out).toContain('date="Aug 8, 2025, 4:32 PM"');
  });

  it("sorts rows newest-first when dates parse", () => {
    const o = obs("https://mail.google.com/mail/u/0/", [
      { id: "row-old", name: "Amazon - Old, Aug 1, 2025, 4:32 PM", cx: 480, cy: 300 },
      { id: "row-new", name: "Amazon - New, Aug 8, 2025, 4:32 PM", cx: 480, cy: 200 },
    ]);
    const out = renderObservationForPlanner(o, [], undefined, [], { index: 1, totalBudget: 60_000, elapsedMs: 0, budgetMs: 60_000, pageIdentity: "" }, "", [], "x");
    const newIdx = out.indexOf("row-new");
    const oldIdx = out.indexOf("row-old");
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(oldIdx); // newest appears first in the table
  });

  it("does NOT render INBOX ROWS on non-email URLs", () => {
    const o = obs("https://example.com/", [
      { id: "x-1", name: "Foo - bar", cx: 100, cy: 100 },
    ]);
    const out = renderObservationForPlanner(o, [], undefined, [], { index: 1, totalBudget: 60_000, elapsedMs: 0, budgetMs: 60_000, pageIdentity: "" }, "", [], "x");
    expect(out).not.toContain("INBOX ROWS");
  });
});

describe("viewportsMatch — click-pre-dispatch viewport-stability guard", () => {
  // ponytail: pure comparator used by executeAction before dispatching clicks.
  // If the page's current viewport diverges from the captured one (window
  // resize, browser zoom, devtools toggle), the frozen bboxes would land on
  // the wrong element. Tolerance covers DPR rounding (~1-2 px drift) but
  // rejects meaningful viewport changes.
  const vp = (width: number, height: number, devicePixelRatio: number) => ({ width, height, devicePixelRatio });

  it("matches identical viewports", () => {
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1920, 1080, 1))).toBe(true);
  });

  it("tolerates ≤4px drift on both axes", () => {
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1924, 1083, 1))).toBe(true);
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1916, 1077, 1))).toBe(true);
  });

  it("rejects width resize beyond tolerance", () => {
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1280, 1080, 1))).toBe(false);
  });

  it("rejects height resize beyond tolerance", () => {
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1920, 720, 1))).toBe(false);
  });

  it("rejects DPR change (HiDPI toggle)", () => {
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1920, 1080, 2))).toBe(false);
  });

  it("rejects browser zoom change (DPR fraction)", () => {
    // ponytail: Chrome zoom (1.0 / 1.25 / 1.5) shows up as a fractional DPR
    // change. Our 0.01 threshold catches any of these.
    expect(viewportsMatch(vp(1920, 1080, 1), vp(1920, 1080, 1.25))).toBe(false);
    expect(viewportsMatch(vp(1920, 1080, 1.25), vp(1920, 1080, 1))).toBe(false);
  });

  it("tolerates tiny DPR drift below the 0.01 threshold", () => {
    expect(viewportsMatch(vp(1920, 1080, 1.0), vp(1920, 1080, 1.005))).toBe(true);
  });
});
