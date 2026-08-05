import { matchStableRef } from "../src/canonical/ref-matcher";
import { StableRef } from "../src/canonical/stable-ref";
import type { AccessibilityNode } from "@fara-platform/fara-action-schema";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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

  it("exact match ignores bounds drift", () => {
    const refNode = makeNode({});
    const ref = StableRef.fromAXNode(refNode);
    const drifted = makeNode({ axNodeId: "2", bounds: { x: 100, y: 100, width: 50, height: 20 } });
    const result = matchStableRef(ref, [drifted]);
    expect(result.strategy).toBe("exact");
    expect(result.node).toBe(drifted);
  });

  it("role-name match for typo in label", () => {
    const refNode = makeNode({ name: "Submit", attributeHash: HASH_A });
    const ref = StableRef.fromAXNode(refNode);
    const snapshot = [makeNode({ name: "Sumbit", attributeHash: HASH_B, axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Sumbit" }] })];
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe("role-name");
  });

  it("role-name rejects too-distant renames", () => {
    const refNode = makeNode({ name: "Submit", attributeHash: HASH_A });
    const ref = StableRef.fromAXNode(refNode);
    const snapshot = [makeNode({ name: "Completely Different", attributeHash: HASH_B, axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Completely Different" }] })];
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe("miss");
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

  it("role-name returns miss when ref has no name", () => {
    const refNode = makeNode({ name: undefined });
    const ref = StableRef.fromAXNode(refNode);
    const snapshot = [makeNode({ name: "Submit" })];
    const result = matchStableRef(ref, snapshot);
    expect(result.strategy).toBe("miss");
  });
});
