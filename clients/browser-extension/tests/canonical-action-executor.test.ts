import {
  CanonicalActionExecutor,
  type CanonicalExecutionCommand,
  type CdpSender,
} from "../src/canonical/action-executor";

function command(action: Record<string, unknown>): CanonicalExecutionCommand {
  return {
    actionId: "11111111-1111-4111-8111-111111111111",
    stepId: "22222222-2222-4222-8222-222222222222",
    observationId: "33333333-3333-4333-8333-333333333333",
    sequence: 1,
    action,
    policyContext: {
      policyDecisionId: "44444444-4444-4444-8444-444444444444",
      policyVersion: "test-v1",
      approved: false,
    },
    dispatchedAt: "2026-08-03T10:00:01.000Z",
    expiresAt: "2026-08-03T10:01:01.000Z",
    idempotencyKey: "test-idempotency-key",
  } as unknown as CanonicalExecutionCommand;
}

function setup() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const sender: CdpSender = async (_tabId, cdpCommand) => {
    calls.push(cdpCommand);
    if (cdpCommand.method === "Page.getNavigationHistory") {
      return { currentIndex: 2, entries: [{ id: 1, url: "https://example.test/a" }, { id: 2, url: "https://example.test/b" }, { id: 3, url: "https://example.test/c" }] };
    }
    return {};
  };
  const executor = new CanonicalActionExecutor({
    tabId: 7,
    send: sender,
    capture: {
      viewportWidth: 800,
      viewportHeight: 600,
      devicePixelRatio: 2,
      zoom: 1.25,
    },
  });
  return { calls, executor };
}

describe("CanonicalActionExecutor", () => {
  it("transforms captured coordinates through DPR and zoom before clicking", async () => {
    const { calls, executor } = setup();

    expect(await executor.execute(command({ type: "left_click", x: 500, y: 250 }))).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 200, y: 100 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 200, y: 100, button: "left", clickCount: 1 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 200, y: 100, button: "left", clickCount: 1 } },
    ]);
  });

  it("rejects coordinates outside the captured viewport", async () => {
    const { calls, executor } = setup();

    expect(await executor.execute(command({ type: "mouse_move", x: 2001, y: 50 })))
      .toMatchObject({ ok: false, error: { code: "COORDINATE_OUT_OF_BOUNDS", retryable: true } });
    expect(calls).toHaveLength(0);
  });

  it("uses Input.insertText without reflecting entered text in the result", async () => {
    const { calls, executor } = setup();

    const result = await executor.execute(command({ type: "insert_text", text: "not-returned" }));

    expect(result).toEqual({ ok: true, effect: { kind: "text_inserted", characterCount: 12 } });
    expect(calls).toEqual([{ method: "Input.insertText", params: { text: "not-returned" } }]);
  });

  it("converts key modifiers to the CDP modifier bitmask", async () => {
    const { calls, executor } = setup();

    await executor.execute(command({ type: "key", key: "Enter", modifiers: { ctrl: true, shift: true, alt: true, meta: true } }));

    expect(calls).toEqual([
      { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "Enter", modifiers: 15 } },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "Enter", modifiers: 15 } },
    ]);
  });

  it("does not reflect typed key content in its execution result", async () => {
    const { executor } = setup();

    const result = await executor.execute(command({ type: "key", key: "s" }));

    expect(JSON.stringify(result)).not.toContain('"s"');
  });

  it("dispatches a drag using transformed endpoints", async () => {
    const { calls, executor } = setup();

    await executor.execute(command({ type: "drag", startX: 250, startY: 250, endX: 750, endY: 500 }));

    expect(calls).toEqual([
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 100, y: 100 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 100, y: 100, button: "left", clickCount: 1 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: 300, y: 200, button: "left", buttons: 1 } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: 300, y: 200, button: "left", clickCount: 1 } },
    ]);
  });

  it("passes the requested wheel deltas instead of treating them as coordinates", async () => {
    const { calls, executor } = setup();

    await executor.execute(command({ type: "scroll", deltaX: -17, deltaY: 423 }));

    expect(calls).toEqual([{ method: "Input.dispatchMouseEvent", params: {
      type: "mouseWheel", x: 400, y: 300, deltaX: -17, deltaY: 423,
    } }]);
  });

  it("uses navigation history and Page.navigate for history_back", async () => {
    const { calls, executor } = setup();

    await executor.execute(command({ type: "history_back", steps: 2 }));

    expect(calls).toEqual([
      { method: "Page.getNavigationHistory" },
      { method: "Page.navigate", params: { url: "https://example.test/a" } },
    ]);
  });

  it("rejects navigation URLs containing embedded credentials", async () => {
    const { calls, executor } = setup();

    expect(await executor.execute(command({ type: "visit_url", url: "https://alice:secret@example.test/" })))
      .toMatchObject({ ok: false, error: { code: "INVALID_NAVIGATION_URL", retryable: false } });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ type: "left_click", x: 10 }, "MISSING_ACTION_PARAMETER"],
    [{ type: "visit_url" }, "MISSING_ACTION_PARAMETER"],
    [{ type: "run_javascript", source: "document.cookie" }, "UNKNOWN_ACTION"],
  ])("returns a typed failure for invalid action %#", async (action, code) => {
    const { calls, executor } = setup();

    expect(await executor.execute(command(action))).toMatchObject({ ok: false, error: { code, retryable: false } });
    expect(calls).toHaveLength(0);
  });
});
