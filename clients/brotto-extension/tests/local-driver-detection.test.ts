// ponytail: unit tests for the detection helpers in local-driver.ts. These
// are pure functions, so we exercise them directly without the runner.

import { detectLoop, detectStuckFailures, looksLikeAuthChallenge, looksLikeLoginPage, looksLikeSignInLink, needsApproval } from "../src/local-driver";

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
