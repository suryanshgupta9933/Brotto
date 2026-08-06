import { collectAccessibilitySnapshot, MAX_AX_NODES } from "../src/canonical/ax-snapshot";
import type { CdpCommandSender } from "../src/canonical/observation";

describe("collectAccessibilitySnapshot", () => {
  it("returns empty array on CDP error", async () => {
    const failing: CdpCommandSender = async () => { throw new Error("cdp fail"); };
    const nodes = await collectAccessibilitySnapshot(1, failing);
    expect(nodes).toEqual([]);
  });

  it("returns empty array when CDP returns no nodes", async () => {
    const empty: CdpCommandSender = async () => ({ nodes: [] });
    const nodes = await collectAccessibilitySnapshot(1, empty);
    expect(nodes).toEqual([]);
  });

  it("flattens single node with computed axPath and hash", async () => {
    const send: CdpCommandSender = async (_t, method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [{ nodeId: "1", role: { value: "button" }, name: { value: "Submit" } }],
        };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, send);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe("button");
    expect(nodes[0].name).toBe("Submit");
    expect(nodes[0].axPath).toEqual([{ role: "button", index: 0, name: "Submit" }]);
    expect(nodes[0].attributeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("walks parent chain to compute axPath for nested nodes", async () => {
    const send: CdpCommandSender = async (_t, method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            { nodeId: "1", role: { value: "Document" } },
            { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "OK" } },
          ],
        };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, send);
    expect(nodes).toHaveLength(2);
    const button = nodes.find((n) => n.role === "button")!;
    expect(button.axPath).toEqual([
      { role: "Document", index: 0 },
      { role: "button", index: 0, name: "OK" },
    ]);
  });

  it("skips nodes with missing role", async () => {
    const send: CdpCommandSender = async (_t, method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [{ nodeId: "1" }, { nodeId: "2", role: { value: "link" } }],
        };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, send);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].role).toBe("link");
  });

  it("truncates beyond MAX_AX_NODES", async () => {
    const send: CdpCommandSender = async (_t, method) => {
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: Array.from({ length: MAX_AX_NODES + 50 }, (_, i) => ({
            nodeId: String(i),
            role: { value: "button" },
            name: { value: `b${i}` },
          })),
        };
      }
      return undefined;
    };
    const nodes = await collectAccessibilitySnapshot(1, send);
    expect(nodes.length).toBe(MAX_AX_NODES);
  });

  it("hash is deterministic for identical input", async () => {
    const send: CdpCommandSender = async () => ({
      nodes: [{ nodeId: "1", role: { value: "button" }, name: { value: "OK" } }],
    });
    const a = await collectAccessibilitySnapshot(1, send);
    const b = await collectAccessibilitySnapshot(1, send);
    expect(a[0].attributeHash).toBe(b[0].attributeHash);
  });
});
