/**
 * Isolated test for demo-server's extractSemanticTargetsFromContext fallback.
 *
 * When the request body has empty semanticTargets (e.g. demo-server run with
 * orchestrator's Playwright snapshot that doesn't emit semanticTargets), the
 * demo-server parses the rendered context for [id] <tag> ... click=(x, y)
 * lines and synthesizes a semanticTargets list. This unblocks the parser's
 * resolveTargetId when targetId is provided but no targets exist upstream.
 *
 * The extracted bbox is degenerate (width=0, height=0) — the click=(x, y)
 * gives us only the center. resolveTargetId returns bbox center = (x, y) so
 * the click lands where the context said it would.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolCallParser } from "../parser";

// ponytail: re-implement the extractor here for an isolated unit test.
// (Can't easily import from scripts/demo-server.ts because it pulls in
// Fastify + inference-registry which is too heavy for a unit test.)
function extractSemanticTargetsFromContext(ctx: string): Array<{
  targetId: string;
  stableRef?: string;
  accessibleName?: { text?: string };
  role?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}> {
  if (!ctx) return [];
  const out: Array<{
    targetId: string;
    stableRef?: string;
    accessibleName?: { text?: string };
    role?: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  }> = [];
  const lines = ctx.split("\n");
  for (const line of lines) {
    const idMatch = line.match(/\[([0-9a-z]{6,32})\]/);
    const tagMatch = line.match(/<([a-z]+)>/);
    const clickMatch = line.match(/click=\((\d+),\s*(\d+)\)\s*$/);
    if (!idMatch || !tagMatch || !clickMatch) continue;
    const after = line.slice(tagMatch.index! + tagMatch[0].length, clickMatch.index);
    const allQuoted = [...after.matchAll(/"([^"]+)"/g)];
    const nameMatch = allQuoted.length > 0 ? allQuoted[allQuoted.length - 1] : null;
    const roleMatch = after.match(/role=(?:"([^"]+)"|([a-z]+))/);
    const x = parseInt(clickMatch[1], 10);
    const y = parseInt(clickMatch[2], 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const id = idMatch[1];
    out.push({
      targetId: id,
      stableRef: id,
      accessibleName: nameMatch ? { text: nameMatch[1] } : undefined,
      role: roleMatch?.[1] ?? roleMatch?.[2] ?? (tagMatch[1] === "a" ? "link" : tagMatch[1] === "button" ? "button" : tagMatch[1] === "input" ? "textbox" : undefined),
      boundingBox: { x, y, width: 0, height: 0 },
    });
  }
  return out;
}

describe("extractSemanticTargetsFromContext (demo-server fallback)", () => {
  it("extracts a simple <a> element", () => {
    const ctx = `[5983667059836670] <a> "Gmail help center" click=(435, 906)`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      targetId: "5983667059836670",
      stableRef: "5983667059836670",
      accessibleName: { text: "Gmail help center" },
      role: "link",
      boundingBox: { x: 435, y: 906, width: 0, height: 0 },
    });
  });

  it("extracts <button> elements with role inferred from tag", () => {
    const ctx = `[1234567812345678] <button> "Compose" click=(80, 70)`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets[0].role).toBe("button");
    expect(targets[0].accessibleName?.text).toBe("Compose");
  });

  it("extracts elements with role= attribute after the tag", () => {
    const ctx = `[ab12cd34ab12cd34] <div> role="link" "Amazon delivery email" click=(473, 180)`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets).toHaveLength(1);
    expect(targets[0].role).toBe("link");
    // Last quoted value is the name, not "link" from role="link".
    expect(targets[0].accessibleName?.text).toBe("Amazon delivery email");
  });

  it("extracts <input> elements with placeholder and inferred role=textbox", () => {
    const ctx = `[9988776655443322] <input> placeholder="Search mail" click=(460, 70)`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets[0].role).toBe("textbox");
    // The extractor picks the LAST quoted value, so placeholder is treated
    // as a name. Acceptable — the harness uses these IDs to route clicks;
    // the name is just for planner logs.
    expect(targets[0].accessibleName?.text).toBe("Search mail");
  });

  it("extracts multiple elements from a multi-line context", () => {
    const ctx = `=== INTERACTIVE ELEMENTS (In Viewport) ===
  [aaa1aaa1aaa1aaa1] <a> "Compose" click=(80, 70)
  [bbb2bbb2bbb2bbb2] <button> "Search" click=(460, 70)
  [ccc3ccc3ccc3ccc3] <div> role="link" "SOCKENUP.IN - Shipping update" click=(473, 180)
=== END ===`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.targetId)).toEqual([
      "aaa1aaa1aaa1aaa1",
      "bbb2bbb2bbb2bbb2",
      "ccc3ccc3ccc3ccc3",
    ]);
    expect(targets[2].accessibleName?.text).toBe("SOCKENUP.IN - Shipping update");
  });

  it("returns empty array for empty input", () => {
    expect(extractSemanticTargetsFromContext("")).toEqual([]);
  });

  it("skips lines that don't have click=", () => {
    const ctx = `URL: https://example.com
Some prose line
[aaa1aaa1aaa1aaa1] <a> "clickable" click=(100, 200)
Title: My Page`;
    const targets = extractSemanticTargetsFromContext(ctx);
    expect(targets).toHaveLength(1);
    expect(targets[0].targetId).toBe("aaa1aaa1aaa1aaa1");
  });
});

describe("extractSemanticTargetsFromContext + parser integration", () => {
  it("targetId-only click resolves to bbox center when semanticTargets extracted from context", () => {
    const ctx = `[abc1abc1abc1abc1] <div> role="link" "Amazon delivery email" click=(473, 180)`;
    const targets = extractSemanticTargetsFromContext(ctx);
    const parser = new ToolCallParser();
    parser.setViewportBounds({ width: 1920, height: 1080 });
    parser.setCurrentObservationId(1);
    parser.setLastSemanticTargets(targets);
    const result = parser.parse([
      { name: "left_click", arguments: { targetId: "abc1abc1abc1abc1" } },
    ]);
    expect(result.errors).toHaveLength(0);
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0].action as { coordinates: { x: number; y: number } };
    expect(action.coordinates.x).toBe(473);
    expect(action.coordinates.y).toBe(180);
  });
});
