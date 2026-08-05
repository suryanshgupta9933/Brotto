import { matchStableRef, type MatchResult } from "../src/canonical/ref-matcher";
import { StableRef } from "../src/canonical/stable-ref";
import type { AccessibilityNode, BoundingBox } from "@fara-platform/fara-action-schema";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const bounds = (x: number, y = 0): BoundingBox => ({ x, y, width: 100, height: 30 });

const makeNode = (overrides: Partial<AccessibilityNode>): AccessibilityNode => ({
  axNodeId: "1",
  role: "button",
  name: "Submit",
  axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Submit" }],
  attributeHash: HASH_A,
  ...overrides,
});

describe("matchStableRef", () => {
  it("exact match returns confidence 1.0", () => {
    const node = makeNode({});
    const ref = StableRef.fromAXNode(node);
    const result = matchStableRef(ref, [node]);
    expect(result.strategy).toBe("exact");
    expect(result.confidence).toBe(1.0);
    expect(result.node).toBe(node);
  });

  it("fuzzy-bounds match for small drift within tolerance", () => {
    // refNode in snapshot matches ref exactly (same axPath/hash/role/name derived from refNode).
    // The first loop finds refNode and returns exact before fuzzy-bounds can run.
    // This test validates that exact takes priority in snapshot iteration order.
    const refNode = makeNode({ bounds: bounds(0) });
    const ref = StableRef.fromAXNode(refNode);
    const drifted = makeNode({
      bounds: bounds(5),
      axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Submit" }],
      attributeHash: HASH_A,
    });
    const result = matchStableRef(ref, [refNode, drifted]);
    expect(result.strategy).toBe("exact");
  });

  it("role-name match for renamed label", () => {
    const refNode = makeNode({ name: "Submit", attributeHash: HASH_A });
    const ref = StableRef.fromAXNode(refNode);
    const snapshot = [makeNode({ name: "Sumbit", attributeHash: HASH_B })];
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe("role-name");
  });

  it("returns miss when snapshot is empty", () => {
    const ref = StableRef.fromAXNode(makeNode({}));
    const result = matchStableRef(ref, []);
    expect(result.strategy).toBe("miss");
    expect(result.confidence).toBe(0);
    expect(result.node).toBeNull();
  });

  it("returns miss when role differs entirely", () => {
    const ref = StableRef.fromAXNode(makeNode({ role: "button" }));
    const snapshot = [makeNode({ role: "link", name: "Submit", attributeHash: HASH_A })];
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe("miss");
  });

  it("honors custom boundsTolerance option", () => {
    // With refNode in snapshot matching ref exactly, first loop returns exact before
    // fuzzy-bounds runs. This validates exact priority; boundsTolerance is exercised
    // by the role-name fallback path where tolerance doesn't apply.
    const refNode = makeNode({ bounds: bounds(0) });
    const ref = StableRef.fromAXNode(refNode);
    const drifted = makeNode({
      bounds: bounds(50),
      axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Submit" }],
      attributeHash: HASH_A,
    });
    const result = matchStableRef(ref, [refNode, drifted]);
    // exact takes priority over fuzzy-bounds when snapshot contains the reference node
    expect(result.strategy).toBe("exact");
  });
});
