/**
 * Isolated test for the stagnation auto-terminate logic.
 *
 * When the harness detects page-identity stagnation AND memory has
 * goal-matching facts, it synthesizes a finalAnswer from the facts
 * and auto-terminates. Without this, the model keeps clicking the
 * same dead target (e.g. Gmail row container that doesn't navigate)
 * while the answer is already in memory, and the user gets an
 * abrupt STAGNATION error instead of an answer.
 */

import { goalMatchedFactsList, synthesizeFinalAnswer } from "../src/local-driver";

describe("goalMatchedFactsList", () => {
  it("returns facts whose key+value contains any goal keyword", () => {
    const facts = [
      { key: "amazon_latest_status", value: "Yogabar 26g High Protein delivered today in Ghaziabad" },
      { key: "order_id", value: "405-3881124-5123560" },
      { key: "uber_receipt", value: "Aug 9 ride" },
    ];
    const matched = goalMatchedFactsList(
      "go to gmail and check the status on my latest amazon package",
      facts,
    );
    // amazon + package keywords should match the amazon status fact.
    // order_id "405-..." doesn't contain amazon/package keywords, so excluded.
    // uber_receipt doesn't match.
    expect(matched.length).toBe(1);
    expect(matched[0].key).toBe("amazon_latest_status");
  });

  it("case-insensitive match against goal keywords", () => {
    const facts = [{ key: "result", value: "AMAZON package delivered" }];
    const matched = goalMatchedFactsList(
      "Check status of amazon package",
      facts,
    );
    expect(matched).toHaveLength(1);
  });

  it("returns empty when no fact contains a goal keyword", () => {
    const facts = [
      { key: "weather", value: "sunny" },
      { key: "random", value: "data" },
    ];
    const matched = goalMatchedFactsList("check amazon package", facts);
    expect(matched).toEqual([]);
  });

  it("returns empty for empty goal (no keywords)", () => {
    const matched = goalMatchedFactsList("", [{ key: "anything", value: "anything" }]);
    expect(matched).toEqual([]);
  });

  it("matches against the value even when key doesn't", () => {
    const facts = [{ key: "result", value: "Out for delivery today, Amazon package" }];
    const matched = goalMatchedFactsList("amazon package status", facts);
    expect(matched).toHaveLength(1);
  });
});

describe("synthesizeFinalAnswer", () => {
  it("joins facts as 'key: value; key: value'", () => {
    const out = synthesizeFinalAnswer([
      { key: "amazon_latest_status", value: "Yogabar delivered" },
      { key: "order_id", value: "405-3881124-5123560" },
    ]);
    expect(out).toBe("amazon_latest_status: Yogabar delivered; order_id: 405-3881124-5123560");
  });

  it("returns empty string for empty input", () => {
    expect(synthesizeFinalAnswer([])).toBe("");
  });

  it("handles single fact", () => {
    const out = synthesizeFinalAnswer([{ key: "status", value: "delivered" }]);
    expect(out).toBe("status: delivered");
  });
});

describe("integration: stagnation auto-terminate signal", () => {
  it("a memory with goal-matching facts would synthesize a valid finalAnswer", () => {
    // This is the actual scenario: model emitted click on a Gmail row
    // container (doesn't navigate), harness detects page-identity
    // stagnation, asks: "is there a goal-matching fact in memory?"
    // Yes → synthesize finalAnswer from it.
    const memory = [
      { key: "amazon_latest_status", value: "Yogabar 26g High Protein package delivered today, order # begins 405-" },
    ];
    const matched = goalMatchedFactsList(
      "go to gmail and check the status on my latest amazon package",
      memory,
    );
    expect(matched.length).toBeGreaterThan(0);
    const finalAnswer = synthesizeFinalAnswer(matched);
    expect(finalAnswer).toContain("Yogabar");
    expect(finalAnswer).toContain("delivered");
    expect(finalAnswer).toContain("405-");
  });
});
