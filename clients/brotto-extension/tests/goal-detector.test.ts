import { extractGoalKeywords, detectGoalMatch } from "../src/goal-detector";

describe("extractGoalKeywords", () => {
  it("returns keywords in source order, dedup, with stopwords removed", () => {
    const kws = extractGoalKeywords("go to gmail and check status for my latest amazon package");
    // ponytail: "check" and "latest" are kept (3+ chars, not stopwords). They
    // may not be the most useful for matching but the order is preserved.
    expect(kws).toEqual(["gmail", "check", "status", "latest", "amazon", "package"]);
  });

  it("drops 1-2 char words but keeps 3+", () => {
    const kws = extractGoalKeywords("find a star on GitHub");
    // ponytail: "a" dropped (stopword), "on" dropped (stopword), "star" + "GitHub" kept
    expect(kws).toEqual(["star", "github"]);
  });

  it("caps at 12 keywords", () => {
    const long = Array.from({ length: 20 }, (_, i) => `keyword${i}`).join(" ");
    const kws = extractGoalKeywords(long);
    expect(kws.length).toBeLessThanOrEqual(12);
  });

  it("returns empty for empty/null input", () => {
    expect(extractGoalKeywords("")).toEqual([]);
    expect(extractGoalKeywords("the and or")).toEqual([]);
  });
});

describe("detectGoalMatch", () => {
  const trackPage = {
    url: "https://www.amazon.in/progress-tracker/package",
    title: "Track Package",
    pagePurpose: "Subtotal",
    bodyText: "H1: Delivered 6 August\nH1: Shipping Address\nH4: Tracking ID: 371470111139\nH1: Subtotal ₹649.00",
  };

  it("fires when ≥2 keywords + structured facts present", () => {
    const r = detectGoalMatch(
      "find my amazon package",
      trackPage,
    );
    expect(r.matched).toBe(true);
    expect(r.matchedKeywords).toEqual(expect.arrayContaining(["amazon", "package"]));
    expect(r.hasStructuredFacts).toBe(true);
    expect(r.banner).toContain("GOAL MATCH DETECTED");
    expect(r.banner).toContain("371470111139");
  });

  it("does NOT fire when only 1 keyword matches", () => {
    const r = detectGoalMatch("just amazon", trackPage);
    expect(r.matched).toBe(false);
    expect(r.banner).toBe("");
  });

  it("does NOT fire when keywords match but no structured facts", () => {
    const r = detectGoalMatch(
      "check status of latest amazon package",
      {
        ...trackPage,
        bodyText: "Welcome to amazon. We have packages and status pages. Browse our products.",
      },
    );
    expect(r.matched).toBe(false);
    expect(r.hasStructuredFacts).toBe(false);
  });

  it("detects tracking IDs and status keywords as structured facts", () => {
    expect(detectGoalMatch("amazon package", { ...trackPage, bodyText: "Tracking ID: 371470111139" }).hasStructuredFacts).toBe(true);
    expect(detectGoalMatch("amazon package", { ...trackPage, bodyText: "Out for delivery today" }).hasStructuredFacts).toBe(true);
    expect(detectGoalMatch("amazon package", { ...trackPage, bodyText: "shipment-tracking@amazon.in" }).hasStructuredFacts).toBe(true);
  });

  it("detects status keywords as structured facts", () => {
    expect(detectGoalMatch("amazon", { ...trackPage, bodyText: "Out for delivery today" }).hasStructuredFacts).toBe(true);
  });

  it("returns empty banner when goal has no keywords", () => {
    const r = detectGoalMatch("", trackPage);
    expect(r.matched).toBe(false);
    expect(r.banner).toBe("");
  });
});
