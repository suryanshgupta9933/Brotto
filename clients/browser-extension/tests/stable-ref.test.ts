import { StableRef } from "../src/canonical/stable-ref";
import type { AccessibilityNode } from "@fara-platform/fara-action-schema";

const VALID_HASH = "a".repeat(64);

const node: AccessibilityNode = {
  axNodeId: "1",
  role: "button",
  name: "Submit",
  axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Submit" }],
  attributeHash: VALID_HASH,
};

describe("StableRef", () => {
  it("hash is deterministic for identical input", () => {
    const a = StableRef.fromAXNode(node);
    const b = StableRef.fromAXNode(node);
    expect(a.equals(b)).toBe(true);
  });

  it("hash differs when role differs", () => {
    const a = StableRef.fromAXNode(node);
    const b = StableRef.fromAXNode({ ...node, role: "link" });
    expect(a.equals(b)).toBe(false);
  });

  it("hash differs when axPath differs", () => {
    const a = StableRef.fromAXNode(node);
    const b = StableRef.fromAXNode({ ...node, axPath: [{ role: "Document", index: 1 }] });
    expect(a.equals(b)).toBe(false);
  });

  it("toJSON round-trips axPath and attributeHash", () => {
    const ref = StableRef.fromAXNode(node);
    const json = ref.toJSON();
    expect(json.axPath).toEqual(node.axPath);
    expect(json.attributeHash).toBe(node.attributeHash);
  });

  it("exposes axPath, attributeHash, role, name", () => {
    const ref = StableRef.fromAXNode(node);
    expect(ref.role).toBe("button");
    expect(ref.name).toBe("Submit");
    expect(ref.axPath).toHaveLength(2);
    expect(ref.attributeHash).toBe(VALID_HASH);
  });

  it("treats missing name as empty string", () => {
    const ref = StableRef.fromAXNode({ ...node, name: undefined });
    expect(ref.name).toBe("");
  });
});
