// ponytail: unit tests for the detection helpers in local-driver.ts. These
// are pure functions, so we exercise them directly without the runner.

import { detectLoop, detectStuckFailures, needsApproval } from "../src/local-driver";

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
  const obs = { url: "https://example.com/", bodyTextSnippet: "Sign up or login" };

  it("approves safe actions on benign pages", () => {
    expect(needsApproval({ type: "left_click" }, obs).needs).toBe(false);
    expect(needsApproval({ type: "insert_text", text: "hello" }, obs).needs).toBe(false);
  });

  it("requires approval when page mentions destructive keywords", () => {
    const evilPage = { url: "https://example.com/", bodyTextSnippet: "Delete account permanently" };
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
    const evilPage = { url: "https://example.com/", bodyTextSnippet: "Send money to friend" };
    const r = needsApproval({ type: "insert_text", text: "send money 100" }, evilPage);
    expect(r.needs).toBe(true);
  });

  it("does not require approval for insert_text if only the typed text contains keyword", () => {
    // ponytail: heuristic is conservative — only trigger when the page
    // context also matches. Prevents false positives on every form fill.
    const r = needsApproval({ type: "insert_text", text: "delete" }, obs);
    expect(r.needs).toBe(false);
  });
});
