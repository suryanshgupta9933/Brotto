import {
  createCanonicalExecutionPipeline,
  type ObservationAuthority,
} from "../src/canonical/action-executor";
import {
  InMemoryApprovalStore,
  actionAuthorizationDigest,
  type ApprovalGrant,
  type DnsResolver,
} from "../src/canonical/execution-pipeline";
import type { PageSettler } from "../src/canonical/page-settler";

const IDS = {
  actionId: "11111111-1111-4111-8111-111111111111",
  stepId: "22222222-2222-4222-8222-222222222222",
  observationId: "33333333-3333-4333-8333-333333333333",
  policyDecisionId: "44444444-4444-4444-8444-444444444444",
  approvalId: "55555555-5555-4555-8555-555555555555",
  targetId: "66666666-6666-4666-8666-666666666666",
};

function command(action: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    actionId: IDS.actionId,
    stepId: IDS.stepId,
    observationId: IDS.observationId,
    sequence: 1,
    action,
    policyContext: {
      policyDecisionId: IDS.policyDecisionId,
      policyVersion: "test-v1",
      approved: false,
    },
    dispatchedAt: "2026-08-03T10:00:01.000Z",
    expiresAt: "2026-08-03T10:01:01.000Z",
    idempotencyKey: "idempotency-1",
    ...overrides,
  };
}

function target(label = "Details") {
  return {
    targetId: IDS.targetId,
    tag: "button",
    role: "button",
    accessibleName: { source: "visible_text", text: label },
    control: { kind: "non_input" },
    boundingBox: { x: 90, y: 90, width: 40, height: 40 },
    visible: true,
    framePath: [],
    locatorCandidates: [],
  };
}

function setup(options: {
  resolver?: DnsResolver;
  approvals?: InMemoryApprovalStore;
  observationTargets?: ReturnType<typeof target>[];
  now?: number | (() => number);
  trustedHostname?: boolean;
  authority?: ObservationAuthority;
} = {}) {
  const fixedNow = typeof options.now === "number" ? options.now : Date.parse("2026-08-03T10:00:02.000Z");
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const settle = jest.fn(async (execute: () => Promise<unknown>, signal?: AbortSignal) => {
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
    await execute();
    return {
      status: "settled",
      navigation: false,
      targetCreated: false,
      pageState: { url: "https://example.test/", lifecycle: "complete" },
    };
  });
  const observation = {
    observationId: IDS.observationId,
    url: "https://example.test/",
    semanticTargets: options.observationTargets ?? [target()],
  } as never;
  const pipeline = createCanonicalExecutionPipeline({
    tabId: 7,
    observationAuthority: options.authority ?? { verify: async () => ({
      observation,
      capture: { viewportWidth: 800, viewportHeight: 600, devicePixelRatio: 2, zoom: 1.25 },
      mainFrameId: "main",
    }) },
    resolver: options.resolver ?? { resolve: async () => ["93.184.216.34"] },
    trustedHostnamePolicy: { isTrusted: (hostname) => options.trustedHostname ?? (hostname === "example.test" || hostname.endsWith(".example")) },
    approvals: options.approvals ?? new InMemoryApprovalStore(),
    createSettler: () => ({ settle } as unknown as PageSettler),
    send: async (_tabId, cdp) => { calls.push(cdp); return {}; },
    now: typeof options.now === "function" ? options.now : () => fixedNow,
  });
  return { calls, pipeline, settle };
}

describe("CanonicalExecutionPipeline", () => {
  it("schema-validates malformed commands before any physical action", async () => {
    const { calls, pipeline, settle } = setup();

    await expect(pipeline.execute({ action: { type: "run_javascript" } })).resolves.toMatchObject({
      status: "denied", code: "COMMAND_SCHEMA_INVALID",
    });
    expect(calls).toHaveLength(0);
    expect(settle).not.toHaveBeenCalled();
  });

  it("fails closed when trusted observation authority rejects attachment or freshness", async () => {
    const authority: ObservationAuthority = { verify: async () => { throw new Error("stale secret detail"); } };
    const { calls, pipeline } = setup({ authority });

    await expect(pipeline.execute(command({ type: "scroll", deltaX: 0, deltaY: 50 })))
      .resolves.toMatchObject({ status: "denied", code: "OBSERVATION_AUTHORITY_DENIED" });
    expect(calls).toHaveLength(0);
  });

  it("fails closed for hostname navigation without exact administrator trust", async () => {
    const { calls, pipeline } = setup({ trustedHostname: false });

    await expect(pipeline.execute(command({ type: "visit_url", url: "https://untrusted.example/path" })))
      .resolves.toMatchObject({ status: "denied", code: "HOSTNAME_NOT_TRUSTED" });
    expect(calls).toHaveLength(0);
  });

  it("allows a literal public IP without hostname trust", async () => {
    const { pipeline } = setup({ trustedHostname: false });

    await expect(pipeline.execute(command({ type: "visit_url", url: "https://93.184.216.34/path" })))
      .resolves.toMatchObject({ status: "succeeded" });
  });

  it("bounds a resolver that ignores AbortSignal", async () => {
    jest.useFakeTimers();
    const { pipeline } = setup({
      trustedHostname: true,
      resolver: { resolve: () => new Promise(() => {}) },
    });
    const result = pipeline.execute(command({ type: "visit_url", url: "https://trusted.example/" }));
    await jest.advanceTimersByTimeAsync(1_001);

    await expect(result).resolves.toMatchObject({ status: "denied", code: "DNS_RESOLUTION_FAILED" });
    jest.useRealTimers();
  });

  it("cancels immediately when a resolver ignores AbortSignal", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const { pipeline } = setup({ resolver: { resolve: () => new Promise(() => {}) } });
    const result = pipeline.execute(command({ type: "scroll", deltaX: 0, deltaY: 50 }), controller.signal);
    controller.abort();
    await Promise.resolve();

    await expect(result).resolves.toMatchObject({ status: "cancelled", code: "ACTION_CANCELLED" });
    jest.useRealTimers();
  });

  it("executes a duplicate idempotency key physically once and returns the cached result", async () => {
    const { calls, pipeline, settle } = setup();
    const input = command({ type: "scroll", deltaX: 0, deltaY: 50 });

    const [first, duplicate] = await Promise.all([pipeline.execute(input), pipeline.execute(input)]);

    expect(first).toEqual(duplicate);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("denies conflicting commands that reuse an idempotency key", async () => {
    const { calls, pipeline } = setup();
    await pipeline.execute(command({ type: "scroll", deltaX: 0, deltaY: 50 }));

    await expect(pipeline.execute(command({ type: "scroll", deltaX: 0, deltaY: 500 })))
      .resolves.toMatchObject({ status: "denied", code: "IDEMPOTENCY_CONFLICT" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an expired command before policy or execution", async () => {
    const { calls, pipeline } = setup();
    const input = command({ type: "scroll", deltaX: 0, deltaY: 50 }, { expiresAt: "2026-08-03T10:00:01.500Z" });

    await expect(pipeline.execute(input)).resolves.toMatchObject({ status: "denied", code: "COMMAND_EXPIRED" });
    expect(calls).toHaveLength(0);
  });

  it("denies credential-bearing navigation before execution", async () => {
    const { calls, pipeline } = setup();

    await expect(pipeline.execute(command({ type: "visit_url", url: "https://alice:secret@example.test/" })))
      .resolves.toMatchObject({ status: "denied", code: "NAVIGATION_CREDENTIALS_DENIED" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [["10.0.0.1"], "PRIVATE_NETWORK_DENIED"],
    [[], "DNS_RESOLUTION_FAILED"],
  ])("fails closed when DNS resolution returns %p", async (addresses, code) => {
    const resolver: DnsResolver = { resolve: async () => addresses };
    const { calls, pipeline } = setup({ resolver });
    const input = command({ type: "visit_url", url: "https://public-name.example/path" });

    await expect(pipeline.execute(input)).resolves.toMatchObject({ status: "denied", code });
    expect(calls).toHaveLength(0);
  });

  it("detects DNS rebinding between authorization and navigation", async () => {
    let attempt = 0;
    const resolver: DnsResolver = {
      resolve: async (hostname) => hostname === "rebind.example" && ++attempt > 1
        ? ["127.0.0.1"]
        : ["93.184.216.34"],
    };
    const { calls, pipeline } = setup({ resolver });

    await expect(pipeline.execute(command({ type: "visit_url", url: "https://rebind.example/" })))
      .resolves.toMatchObject({ status: "denied", code: "DNS_REBINDING_DETECTED" });
    expect(calls).toHaveLength(0);
  });

  it("requires approval proof bound to the full command and consumes it once", async () => {
    const approvals = new InMemoryApprovalStore();
    const highImpact = command(
      { type: "left_click", x: 250, y: 250, targetId: IDS.targetId },
      { policyContext: { policyDecisionId: IDS.policyDecisionId, policyVersion: "test-v1", approved: true, approvalId: IDS.approvalId } },
    );
    const mismatched: ApprovalGrant = {
      approvalId: IDS.approvalId,
      actionId: IDS.actionId,
      policyDecisionId: IDS.policyDecisionId,
      observationId: IDS.observationId,
      actionDigest: "wrong-digest",
      idempotencyKey: "idempotency-1",
      expiresAt: "2026-08-03T10:01:00.000Z",
      commandExpiresAt: "2026-08-03T10:01:01.000Z",
    };
    approvals.register(mismatched);
    const { calls, pipeline } = setup({ approvals, observationTargets: [target("Buy now")] });

    await expect(pipeline.execute(highImpact)).resolves.toMatchObject({ status: "denied", code: "APPROVAL_PROOF_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("binds a valid approval to every command field and consumes it once", async () => {
    const approvals = new InMemoryApprovalStore();
    const input = command(
      { type: "left_click", x: 250, y: 250, targetId: IDS.targetId },
      { policyContext: { policyDecisionId: IDS.policyDecisionId, policyVersion: "test-v1", approved: true, approvalId: IDS.approvalId } },
    );
    const digest = await actionAuthorizationDigest(input as never);
    const grant: ApprovalGrant = {
      approvalId: IDS.approvalId, actionId: IDS.actionId, policyDecisionId: IDS.policyDecisionId,
      observationId: IDS.observationId, actionDigest: digest, idempotencyKey: "idempotency-1",
      expiresAt: "2026-08-03T10:01:00.000Z",
      commandExpiresAt: "2026-08-03T10:01:01.000Z",
    };
    approvals.register(grant);
    expect(approvals.consume(input as never, digest, Date.parse("2026-08-03T10:00:02.000Z"))).toBe(true);
    expect(approvals.consume(input as never, digest, Date.parse("2026-08-03T10:00:02.000Z"))).toBe(false);
  });

  it("rechecks approval expiry immediately before physical execution", async () => {
    const approvals = new InMemoryApprovalStore();
    const input = command(
      { type: "left_click", x: 250, y: 250, targetId: IDS.targetId },
      { policyContext: { policyDecisionId: IDS.policyDecisionId, policyVersion: "test-v1", approved: true, approvalId: IDS.approvalId } },
    );
    approvals.register({
      approvalId: IDS.approvalId, actionId: IDS.actionId, policyDecisionId: IDS.policyDecisionId,
      observationId: IDS.observationId, actionDigest: await actionAuthorizationDigest(input as never),
      idempotencyKey: "idempotency-1", expiresAt: "2026-08-03T10:00:03.000Z",
      commandExpiresAt: "2026-08-03T10:01:01.000Z",
    });
    let clockReads = 0;
    const now = () => Date.parse(clockReads++ < 2 ? "2026-08-03T10:00:02.000Z" : "2026-08-03T10:00:04.000Z");
    const { calls, pipeline } = setup({ approvals, observationTargets: [target("Buy now")], now });

    await expect(pipeline.execute(input)).resolves.toMatchObject({ status: "denied", code: "APPROVAL_PROOF_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("uses transformed screenshot coordinates to identify a purchase target", async () => {
    const { calls, pipeline } = setup({ observationTargets: [target("Buy now")] });

    await expect(pipeline.execute(command({ type: "left_click", x: 250, y: 250 })))
      .resolves.toMatchObject({ status: "approval_required", code: "HIGH_IMPACT_APPROVAL_REQUIRED" });
    expect(calls).toHaveLength(0);
  });

  it("checks transformed action coordinates against the declared semantic target", async () => {
    const { calls, pipeline } = setup();
    const input = command({ type: "left_click", x: 750, y: 500, targetId: IDS.targetId });

    await expect(pipeline.execute(input)).resolves.toMatchObject({ status: "denied", code: "TARGET_COORDINATE_MISMATCH" });
    expect(calls).toHaveLength(0);
  });

  it("honors an already-aborted signal before execution", async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, pipeline } = setup();

    await expect(pipeline.execute(command({ type: "scroll", deltaX: 0, deltaY: 50 }), controller.signal))
      .resolves.toMatchObject({ status: "cancelled", code: "ACTION_CANCELLED" });
    expect(calls).toHaveLength(0);
  });
});
