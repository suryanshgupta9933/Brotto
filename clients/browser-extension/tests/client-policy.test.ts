import { ClientPolicy, type ClientPolicyCommand, type ClientPolicyContext } from "../src/canonical/client-policy";

const IDS = {
  actionId: "11111111-1111-4111-8111-111111111111",
  stepId: "22222222-2222-4222-8222-222222222222",
  observationId: "33333333-3333-4333-8333-333333333333",
  policyDecisionId: "44444444-4444-4444-8444-444444444444",
  approvalId: "55555555-5555-4555-8555-555555555555",
};

function command(action: Record<string, unknown>, approved = false): ClientPolicyCommand {
  return {
    actionId: IDS.actionId,
    stepId: IDS.stepId,
    observationId: IDS.observationId,
    sequence: 1,
    action,
    policyContext: {
      policyDecisionId: IDS.policyDecisionId,
      policyVersion: "test-v1",
      approved,
      ...(approved ? { approvalId: IDS.approvalId } : {}),
    },
    dispatchedAt: "2026-08-03T10:00:01.000Z",
    expiresAt: "2026-08-03T10:01:01.000Z",
    idempotencyKey: "test-idempotency-key",
  } as unknown as ClientPolicyCommand;
}

function context(overrides: Record<string, unknown> = {}): ClientPolicyContext {
  return {
    tabId: 7,
    attachedTabIds: new Set([7]),
    approvedApprovalIds: new Set<string>(),
    observation: {
      observationId: IDS.observationId,
      url: "https://shop.example/products",
      semanticTargets: [],
    },
    ...overrides,
  } as unknown as ClientPolicyContext;
}

describe("ClientPolicy", () => {
  it.each(["file:///tmp/report", "chrome://settings", "chrome-extension://abc/options.html"])(
    "denies navigation to the disallowed URL %s",
    (url) => {
      const result = new ClientPolicy().evaluate(command({ type: "visit_url", url }), context());

      expect(result).toMatchObject({ decision: "denied", code: "NAVIGATION_SCHEME_DENIED" });
    },
  );

  it.each([
    "http://127.0.0.1/admin",
    "http://10.1.2.3/admin",
    "http://172.16.1.2/admin",
    "http://192.168.1.8/admin",
    "http://[::1]/admin",
    "http://metadata.google.internal/latest",
  ])("fails closed for private-network navigation to %s", (url) => {
    const result = new ClientPolicy().evaluate(command({ type: "visit_url", url }), context());

    expect(result).toMatchObject({ decision: "denied", code: "PRIVATE_NETWORK_DENIED" });
  });

  it("allows an explicitly configured private-network origin", () => {
    const policy = new ClientPolicy({ privateNetworkOrigins: ["http://127.0.0.1:8080"] });

    expect(policy.evaluate(
      command({ type: "visit_url", url: "http://127.0.0.1:8080/fixture" }),
      context(),
    )).toMatchObject({ decision: "allowed", code: "ALLOWED" });
  });

  it("denies actions on an already-open private-network page without explicit policy", () => {
    const result = new ClientPolicy().evaluate(
      command({ type: "scroll", deltaX: 0, deltaY: 100 }),
      context({ observation: { observationId: IDS.observationId, url: "http://192.168.1.20/admin", semanticTargets: [] } }),
    );

    expect(result).toMatchObject({ decision: "denied", code: "PRIVATE_NETWORK_DENIED" });
  });

  it("denies a public origin outside the configured allowlist", () => {
    const policy = new ClientPolicy({ allowedOrigins: ["https://allowed.example"] });

    expect(policy.evaluate(
      command({ type: "visit_url", url: "https://other.example/path" }),
      context(),
    )).toMatchObject({ decision: "denied", code: "NAVIGATION_ORIGIN_DENIED" });
  });

  it("denies commands for tabs that are not explicitly attached", () => {
    const result = new ClientPolicy().evaluate(
      command({ type: "scroll", deltaX: 0, deltaY: 200 }),
      context({ attachedTabIds: new Set<number>() }),
    );

    expect(result).toMatchObject({ decision: "denied", code: "TAB_NOT_ATTACHED" });
  });

  it("denies commands tied to a stale observation", () => {
    const result = new ClientPolicy().evaluate(
      command({ type: "scroll", deltaX: 0, deltaY: 200 }),
      context({ observation: { observationId: "66666666-6666-4666-8666-666666666666", url: "https://shop.example", semanticTargets: [] } }),
    );

    expect(result).toMatchObject({ decision: "denied", code: "STALE_OBSERVATION" });
  });

  it.each(["Buy now", "Place order", "Submit application"])(
    "requires approval for a high-impact target labelled %s",
    (label) => {
      const action = { type: "left_click", x: 20, y: 20, targetId: "77777777-7777-4777-8777-777777777777" };
      const result = new ClientPolicy().evaluate(command(action), context({
        observation: {
          observationId: IDS.observationId,
          url: "https://shop.example/checkout",
          semanticTargets: [{
            targetId: action.targetId,
            tag: "button",
            role: "button",
            accessibleName: { text: label, redacted: false },
            attributes: { type: "submit" },
            control: { kind: "button" },
            boundingBox: { x: 0, y: 0, width: 100, height: 50 },
            visible: true,
            framePath: [],
            locatorCandidates: [],
          }],
        },
      }));

      expect(result).toMatchObject({ decision: "requires_approval", code: "HIGH_IMPACT_APPROVAL_REQUIRED" });
    },
  );

  it("allows a high-impact action only with complete approval proof", () => {
    const action = { type: "left_click", x: 20, y: 20, targetId: "77777777-7777-4777-8777-777777777777" };
    const observation = {
      observationId: IDS.observationId,
      url: "https://shop.example/checkout",
      semanticTargets: [{
        targetId: action.targetId,
        tag: "button",
        role: "button",
        accessibleName: { text: "Place order", redacted: false },
        attributes: { type: "submit" },
        control: { kind: "button" },
        boundingBox: { x: 0, y: 0, width: 100, height: 50 },
        visible: true,
        framePath: [],
        locatorCandidates: [],
      }],
    };

    expect(new ClientPolicy().evaluate(command(action, true), context({
      observation,
      approvedApprovalIds: new Set([IDS.approvalId]),
    })))
      .toMatchObject({ decision: "allowed", code: "ALLOWED" });
  });

  it("denies a high-impact command whose approval ID is not locally recognized", () => {
    const action = { type: "left_click", x: 20, y: 20, targetId: "77777777-7777-4777-8777-777777777777" };
    const result = new ClientPolicy().evaluate(command(action, true), context({ observation: {
      observationId: IDS.observationId,
      url: "https://shop.example/checkout",
      semanticTargets: [{
        targetId: action.targetId,
        tag: "button",
        role: "button",
        accessibleName: { text: "Place order", redacted: false },
        control: { kind: "button" },
        boundingBox: { x: 0, y: 0, width: 100, height: 50 },
        visible: true,
        framePath: [],
        locatorCandidates: [],
      }],
    } }));

    expect(result).toMatchObject({ decision: "denied", code: "APPROVAL_PROOF_INVALID" });
  });

  it("does not let a benign target ID mask a high-impact coordinate hit", () => {
    const benignId = "77777777-7777-4777-8777-777777777777";
    const purchaseId = "88888888-8888-4888-8888-888888888888";
    const action = { type: "left_click", x: 220, y: 20, targetId: benignId };
    const target = (targetId: string, label: string, x: number) => ({
      targetId,
      tag: "button",
      role: "button",
      accessibleName: { text: label, redacted: false },
      control: { kind: "button" },
      boundingBox: { x, y: 0, width: 100, height: 50 },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    });

    const result = new ClientPolicy().evaluate(command(action), context({ observation: {
      observationId: IDS.observationId,
      url: "https://shop.example/checkout",
      semanticTargets: [target(benignId, "View details", 0), target(purchaseId, "Buy now", 200)],
    } }));

    expect(result).toMatchObject({ decision: "requires_approval", code: "HIGH_IMPACT_APPROVAL_REQUIRED" });
  });
});
