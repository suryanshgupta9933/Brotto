import { createCanonicalExecutionPipeline, verifyDeclaredTarget } from "../src/canonical/action-executor";
import { InMemoryApprovalStore } from "../src/canonical/execution-pipeline";
import type { PageSettler } from "../src/canonical/page-settler";
import { StableRef } from "../src/canonical/stable-ref";
import type { AccessibilityNode } from "@fara-platform/fara-action-schema";

function command(action: Record<string, unknown>) {
  return {
    actionId: "11111111-1111-4111-8111-111111111111",
    stepId: "22222222-2222-4222-8222-222222222222",
    observationId: "33333333-3333-4333-8333-333333333333",
    sequence: 1,
    action,
    policyContext: { policyDecisionId: "44444444-4444-4444-8444-444444444444", policyVersion: "v1", approved: false },
    dispatchedAt: "2026-08-03T10:00:01.000Z",
    expiresAt: "2026-08-03T10:01:01.000Z",
    idempotencyKey: `key-${action.type}`,
  };
}

function setup() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const pipeline = createCanonicalExecutionPipeline({
    tabId: 7,
    observationAuthority: { verify: async () => ({
      observation: { observationId: "33333333-3333-4333-8333-333333333333", url: "https://example.test/", semanticTargets: [] } as never,
      capture: { viewportWidth: 800, viewportHeight: 600, devicePixelRatio: 2, zoom: 1.25 },
      mainFrameId: "main",
    }) },
    resolver: { resolve: async () => ["93.184.216.34"] },
    trustedHostnamePolicy: { isTrusted: () => true },
    approvals: new InMemoryApprovalStore(),
    createSettler: () => ({ settle: async (execute: () => Promise<unknown>) => {
      await execute();
      return { status: "settled", navigation: false, targetCreated: false, pageState: { url: "https://example.test/", lifecycle: "complete" } };
    } } as unknown as PageSettler),
    send: async (_tabId, cdp) => { calls.push(cdp); return {}; },
    now: () => Date.parse("2026-08-03T10:00:02.000Z"),
  });
  return { calls, pipeline };
}

const VALID_HASH = "a".repeat(64);

function makeAccessNode(overrides: Partial<AccessibilityNode> = {}): AccessibilityNode {
  return {
    axNodeId: "node-1",
    role: "button",
    name: "Buy",
    axPath: [{ role: "Document", index: 0 }, { role: "button", index: 0, name: "Buy" }],
    attributeHash: VALID_HASH,
    ...overrides,
  };
}

describe("canonical action execution through the production pipeline", () => {
  it("transforms DPR/zoom coordinates and dispatches a controlled click", async () => {
    const { calls, pipeline } = setup();
    await expect(pipeline.execute(command({ type: "left_click", x: 500, y: 250 }))).resolves.toMatchObject({ status: "succeeded" });
    expect(calls).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 200, y: 100 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 200, y: 100, button: "left", clickCount: 1 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 200, y: 100, button: "left", clickCount: 1 } },
    ]);
  });

  it("passes requested wheel deltas as deltas", async () => {
    const { calls, pipeline } = setup();
    await pipeline.execute(command({ type: "scroll", deltaX: -17, deltaY: 423 }));
    expect(calls[0]).toEqual({ method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: 400, y: 300, deltaX: -17, deltaY: 423 } });
  });

  it("uses Input.insertText and does not reflect entered content", async () => {
    const { calls, pipeline } = setup();
    const result = await pipeline.execute(command({ type: "insert_text", text: "not-returned" }));
    expect(calls).toEqual([{ method: "Input.insertText", params: { text: "not-returned" } }]);
    expect(JSON.stringify(result)).not.toContain("not-returned");
  });
});

describe("verifyDeclaredTarget with StableRef", () => {
  const capture = { viewportWidth: 800, viewportHeight: 600, devicePixelRatio: 2, zoom: 1.25 };

  it("accepts when matchStableRef returns confidence >= 0.8", async () => {
    const axNode = makeAccessNode();
    const stableRef = StableRef.fromAXNode(axNode);
    const action = { type: "left_click", x: 100, y: 50, ref: stableRef } as any;
    const observation = { semanticTargets: [], accessibilityNodes: [axNode] };
    const result = verifyDeclaredTarget(action, observation, capture as any);
    expect(result).toBeUndefined(); // undefined = verified, proceed
  });

  it("falls through to coordinate check when accessibilityNodes absent", async () => {
    // When accessibilityNodes is absent, ref-match is skipped and coord check applies
    // The action has ref but no axNodes to match against, so it falls through
    const action = { type: "left_click", x: 100, y: 50, targetId: "missing" } as any;
    const observation = { semanticTargets: [], accessibilityNodes: undefined };
    // Should not throw; falls through to coord check which returns TARGET_NOT_FOUND
    const result = verifyDeclaredTarget(action, observation, capture as any);
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
  });
});
