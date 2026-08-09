/**
 * Isolated tests for the AX-tree row renderer.
 *
 * The DOM walker flattens 5-10 elements per Gmail row (checkbox, star,
 * sender, subject, preview, date, attachments, action button, row
 * container). The model can't tell which element forms a single row
 * or which one actually navigates. The AX-tree renderer exposes the
 * parent/child structure (list → listitem → link/statictext) with a
 * navigable flag per child.
 */

import type { PageSnapshot } from "../context/types";
import { renderSnapshot, renderAxRows, type AxRowGroup } from "../context/render";

const axRow = (overrides: Partial<AxRowGroup> = {}): AxRowGroup => ({
  parentNodeId: "row-1",
  parentRole: "listitem",
  parentName: "",
  navigableChildCount: 0,
  children: [],
  ...overrides,
});

const child = (overrides: Partial<AxRowGroup["children"][number]> = {}): AxRowGroup["children"][number] => ({
  nodeId: "n-1",
  role: "statictext",
  name: "",
  bbox: { x: 0, y: 0, width: 0, height: 0 },
  navigable: false,
  isContainer: false,
  stableRef: undefined,
  ...overrides,
});

const snapshotWithAxRows = (rows: AxRowGroup[]): PageSnapshot => ({
  url: "https://mail.google.com/mail/u/0/",
  title: "Inbox",
  elements: [],
  focusedId: null,
  bodyTextSnippet: "fake body",
  axRows: rows,
});

describe("renderAxRows", () => {
  it("returns empty string for empty input", () => {
    expect(renderAxRows([])).toBe("");
  });

  it("skips groups with no children (chrome nodes)", () => {
    expect(renderAxRows([axRow({ parentNodeId: "empty-1" })])).toBe("");
  });

  it("renders a row with one navigable child and marks it [nav]", () => {
    const out = renderAxRows([
      axRow({
        parentNodeId: "row-1",
        parentRole: "listitem",
        children: [
          child({ nodeId: "view-order", role: "link", name: "View order", navigable: true, bbox: { x: 504, y: 180, width: 80, height: 24 } }),
        ],
        navigableChildCount: 1,
      }),
    ]);
    expect(out).toContain("AX ROWS");
    expect(out).toContain("LISTITEM");
    expect(out).toContain("[row-1]");
    expect(out).toContain("1 navigable child");
    expect(out).toContain("link");
    expect(out).toContain('"View order"');
    expect(out).toContain("[nav]");
  });

  it("renders container row with 0 navigable children as 'CONTAINER — don't click'", () => {
    const out = renderAxRows([
      axRow({
        parentNodeId: "row-1",
        parentRole: "row",
        children: [
          child({ nodeId: "subject-link", role: "link", name: "View order", navigable: false, isContainer: false }),
        ],
        navigableChildCount: 0,
      }),
    ]);
    expect(out).toContain("0 navigable children");
    expect(out).toContain("CONTAINER");
  });

  it("renders multiple rows", () => {
    const out = renderAxRows([
      axRow({ parentNodeId: "row-1", parentName: "Amazon delivery", navigableChildCount: 1, children: [child({ role: "link", name: "View order", navigable: true })] }),
      axRow({ parentNodeId: "row-2", parentName: "Uber receipt", navigableChildCount: 0, children: [child({ role: "link", name: "Open", navigable: false })] }),
      axRow({ parentNodeId: "row-3", parentName: "GitHub alert", navigableChildCount: 2, children: [child({ role: "button", name: "View repo", navigable: true }), child({ role: "button", name: "Unsubscribe", navigable: true })] }),
    ]);
    expect(out).toContain("Row 1");
    expect(out).toContain("Row 2");
    expect(out).toContain("Row 3");
    expect(out).toContain('"Amazon delivery"');
    expect(out).toContain('"Uber receipt"');
    expect(out).toContain('"GitHub alert"');
    expect(out).toContain("2 navigable children");
  });
});

describe("renderSnapshot integration with axRows", () => {
  it("renders AX ROWS block when snapshot has axRows", () => {
    const out = renderSnapshot(snapshotWithAxRows([
      axRow({
        parentNodeId: "r1",
        parentRole: "listitem",
        children: [child({ nodeId: "view-order", role: "link", name: "View order", navigable: true })],
        navigableChildCount: 1,
      }),
    ]), null);
    expect(out).toContain("AX ROWS");
    expect(out).toContain("LISTITEM");
  });

  it("does NOT render AX ROWS when snapshot has empty axRows", () => {
    const out = renderSnapshot(snapshotWithAxRows([]), null);
    expect(out).not.toContain("AX ROWS");
  });

  it("does NOT render AX ROWS when snapshot has no axRows field (orchestrator path)", () => {
    const snap: PageSnapshot = {
      url: "https://example.com",
      title: "Example",
      elements: [],
      focusedId: null,
      bodyTextSnippet: "test",
    };
    const out = renderSnapshot(snap, null);
    expect(out).not.toContain("AX ROWS");
  });
});

describe("axTargets integration smoke", () => {
  it("synthetic Gmail row produces both navigable SemanticTarget and [nav] row child", async () => {
    const { axNodesToSemanticTargets, axNodesToRowGroups } = await import("../../../../clients/brotto-extension/src/canonical/ax-targets");
    const nodes = [
      { nodeId: "row-1", role: { value: "listitem" }, name: { value: "Amazon delivery" }, childIds: ["link-1", "text-1"], boundingBox: { x: 100, y: 180, width: 800, height: 60 } },
      { nodeId: "link-1", parentId: "row-1", role: { value: "link" }, name: { value: "View order" }, boundingBox: { x: 504, y: 180, width: 80, height: 24 } },
      { nodeId: "text-1", parentId: "row-1", role: { value: "statictext" }, name: { value: "Delivered today" }, boundingBox: { x: 200, y: 180, width: 200, height: 20 } },
    ];
    const targets = await axNodesToSemanticTargets(nodes as never);
    const groups = axNodesToRowGroups(nodes as never);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const link = targets.find((t) => t.role === "link");
    expect(link).toBeDefined();
    expect(link?.stableRef).toMatch(/^[a-f0-9]{16}$/);
    expect(link?.accessibleName?.text).toBe("View order");
    expect(link?.boundingBox).toEqual({ x: 504, y: 180, width: 80, height: 24 });

    expect(groups).toHaveLength(1);
    expect(groups[0].parentRole).toBe("listitem");
    expect(groups[0].children).toHaveLength(2);
    const linkChild = groups[0].children.find((c) => c.role === "link");
    expect(linkChild?.navigable).toBe(true);
    const textChild = groups[0].children.find((c) => c.role === "statictext");
    expect(textChild?.navigable).toBe(false);
  });
});
