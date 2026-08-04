import {
  PageSettler,
  type PageEvent,
  type PageEventSource,
  type SettlementClock,
} from "../src/canonical/page-settler";

class FakeClock implements SettlementClock {
  private current = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  now(): number { return this.current; }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.current + delayMs, callback });
    return id;
  }

  clearTimeout(id: unknown): void { this.tasks.delete(id as number); }

  advanceBy(delayMs: number): void {
    const target = this.current + delayMs;
    while (true) {
      const ready = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!ready) break;
      this.current = ready[1].at;
      this.tasks.delete(ready[0]);
      ready[1].callback();
    }
    this.current = target;
  }
}

class FakeEvents implements PageEventSource {
  handler?: (event: PageEvent) => void;
  subscribed = false;

  subscribe(_tabId: number, handler: (event: PageEvent) => void): () => void {
    this.subscribed = true;
    this.handler = handler;
    return () => { this.handler = undefined; };
  }

  emit(method: string, params?: Record<string, unknown>): void {
    this.handler?.({ method, params });
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function setup() {
  const clock = new FakeClock();
  const events = new FakeEvents();
  const pageState = jest.fn(async () => ({ url: "https://example.test/next", lifecycle: "complete" as const }));
  const settler = new PageSettler({
    tabId: 7,
    events,
    clock,
    getPageState: pageState,
    stabilityMs: 100,
    timeoutMs: 1_000,
  });
  return { clock, events, pageState, settler };
}

describe("PageSettler", () => {
  it("subscribes before preparing event domains and executing the action", async () => {
    const order: string[] = [];
    const clock = new FakeClock();
    const events: PageEventSource = {
      subscribe: () => {
        order.push("subscribe");
        return () => {};
      },
    };
    const settler = new PageSettler({
      tabId: 7,
      events,
      clock,
      prepareEvents: async () => { order.push("prepare"); },
      getPageState: async () => ({ url: "https://example.test", lifecycle: "complete" }),
      stabilityMs: 100,
    });
    const settlement = settler.settle(async () => { order.push("execute"); });

    expect(order).toEqual(["subscribe", "prepare"]);
    await flush();
    expect(order).toEqual(["subscribe", "prepare", "execute"]);
    clock.advanceBy(100);
    await settlement;
  });

  it("never executes after an immediate debugger detach during subscription", async () => {
    let unsubscribed = false;
    const events: PageEventSource = {
      subscribe: (_tabId, handler) => {
        handler({ method: "Debugger.detached" });
        return () => { unsubscribed = true; };
      },
    };
    const execute = jest.fn(async () => {});
    const settler = new PageSettler({
      tabId: 7,
      events,
      clock: new FakeClock(),
      getPageState: async () => ({ url: "https://example.test", lifecycle: "complete" }),
    });

    await expect(settler.settle(execute)).resolves.toMatchObject({ status: "detached" });
    expect(execute).not.toHaveBeenCalled();
    expect(unsubscribed).toBe(true);
  });

  it("subscribes before executing and waits for load plus DOM stability", async () => {
    const { clock, events, settler } = setup();
    const settlement = settler.settle(async () => {
      expect(events.subscribed).toBe(true);
      events.emit("Page.frameStartedLoading", { frameId: "main" });
      events.emit("DOM.documentUpdated");
      events.emit("Page.lifecycleEvent", { frameId: "main", name: "load" });
    });
    await flush();

    clock.advanceBy(99);
    await flush();
    let resolved = false;
    settlement.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);

    clock.advanceBy(1);
    await expect(settlement).resolves.toMatchObject({
      status: "settled",
      navigation: true,
      pageState: { url: "https://example.test/next", lifecycle: "complete" },
    });
  });

  it("resets the stability window when the DOM changes after load", async () => {
    const { clock, events, settler } = setup();
    const settlement = settler.settle(async () => {
      events.emit("Page.frameStartedLoading");
      events.emit("Page.loadEventFired");
    });
    await flush();

    clock.advanceBy(75);
    events.emit("DOM.documentUpdated");
    clock.advanceBy(25);
    await flush();
    let resolved = false;
    settlement.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);

    clock.advanceBy(75);
    await expect(settlement).resolves.toMatchObject({ status: "settled" });
  });

  it("captures dialog and target events without collecting their payload data", async () => {
    const { clock, events, settler } = setup();
    const settlement = settler.settle(async () => {
      events.emit("Page.javascriptDialogOpening", { type: "prompt", message: "do not retain" });
      events.emit("Target.targetCreated", { targetInfo: { targetId: "secret", url: "https://popup.example" } });
    });
    await flush();

    clock.advanceBy(100);
    await expect(settlement).resolves.toMatchObject({
      status: "settled",
      dialog: { present: true, kind: "prompt" },
      targetCreated: true,
    });
    expect(JSON.stringify(await settlement)).not.toContain("do not retain");
    expect(JSON.stringify(await settlement)).not.toContain("secret");
  });

  it("fails immediately and closed when the debugger detaches", async () => {
    const { events, settler } = setup();
    const settlement = settler.settle(async () => {
      events.emit("Debugger.detached");
    });

    await expect(settlement).resolves.toMatchObject({ status: "detached", code: "DEBUGGER_DETACHED" });
  });

  it("returns a typed timeout with the current sanitized page state", async () => {
    const { clock, events, settler } = setup();
    const settlement = settler.settle(async () => {
      events.emit("Page.frameStartedLoading");
    });
    await flush();

    clock.advanceBy(1_000);
    await expect(settlement).resolves.toEqual({
      status: "timeout",
      code: "SETTLEMENT_TIMEOUT",
      navigation: true,
      targetCreated: false,
      pageState: { url: "https://example.test/next", lifecycle: "complete" },
    });
  });

  it("sanitizes credential-bearing current page state before returning it", async () => {
    const clock = new FakeClock();
    const events = new FakeEvents();
    const settler = new PageSettler({
      tabId: 7,
      events,
      clock,
      getPageState: async () => ({
        url: "https://alice:secret@example.test/account?token=raw-value&view=summary#private",
        lifecycle: "complete",
        title: "Account token details",
      }),
      stabilityMs: 100,
      timeoutMs: 1_000,
    });
    const settlement = settler.settle(async () => {});
    await flush();

    clock.advanceBy(100);

    await expect(settlement).resolves.toMatchObject({ pageState: {
      url: "https://example.test/account",
      lifecycle: "complete",
      title: "[redacted]",
    } });
  });

  it("resolves deterministically when page-state capture never returns", async () => {
    const clock = new FakeClock();
    const settler = new PageSettler({
      tabId: 7,
      events: new FakeEvents(),
      clock,
      getPageState: () => new Promise(() => {}),
      initialPageState: { url: "https://previous.example/private?token=secret", lifecycle: "interactive" },
      stabilityMs: 100,
      timeoutMs: 1_000,
    });
    const settlement = settler.settle(async () => {});
    await flush();
    clock.advanceBy(100);

    await expect(settlement).resolves.toMatchObject({
      status: "settled",
      pageState: { url: "https://previous.example/private", lifecycle: "interactive" },
    });
  });

  it("ignores subframe navigation and load events", async () => {
    const clock = new FakeClock();
    const events = new FakeEvents();
    const settler = new PageSettler({
      tabId: 7, events, clock, mainFrameId: "main",
      getPageState: async () => ({ url: "https://example.test", lifecycle: "complete" }),
      stabilityMs: 100,
    });
    const settlement = settler.settle(async () => {
      events.emit("Page.frameStartedLoading", { frameId: "child" });
      events.emit("Page.lifecycleEvent", { frameId: "child", name: "load" });
    });
    await flush();
    clock.advanceBy(100);

    await expect(settlement).resolves.toMatchObject({ status: "settled", navigation: false });
  });

  it("cancels settlement through AbortSignal without executing later work", async () => {
    const controller = new AbortController();
    const execute = jest.fn(async () => new Promise(() => {}));
    const settler = new PageSettler({
      tabId: 7, events: new FakeEvents(), clock: new FakeClock(),
      getPageState: async () => ({ url: "https://example.test", lifecycle: "complete" }),
    });
    const settlement = settler.settle(execute, controller.signal);
    await flush();
    controller.abort();

    await expect(settlement).resolves.toMatchObject({ status: "cancelled", code: "ACTION_CANCELLED" });
  });
});
