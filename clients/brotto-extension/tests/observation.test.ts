import {
  ObservationSecurityError,
  captureObservation,
  type CaptureObservationOptions,
  type ScreenshotMaskInput,
  type TabIdentity,
} from "../src/canonical/observation";
import type { SemanticTarget } from "@brotto/brotto-action-schema";

const SAFE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7+XIAAAAASUVORK5CYII=";
const SAFE_PNG = `data:image/png;base64,${SAFE_PNG_BASE64}`;
const MASKED_PNG_BYTES = (() => {
  const png = bytesFromBase64(SAFE_PNG_BASE64);
  const marker = new TextEncoder().encode("masked-screenshot");
  const combined = new Uint8Array(png.length + marker.length);
  combined.set(png);
  combined.set(marker, png.length);
  return combined;
})();

const PAGE_SNAPSHOT = {
  url: "https://example.test/search?query=boots",
  title: "Products",
  viewport: {
    width: 1,
    height: 1,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
  },
  readyState: "complete",
  visibility: "visible",
  documentToken: "document-1",
  domScanComplete: true,
  sensitiveRegionOverflow: false,
  sensitiveRegions: [] as Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>,
  semanticTargets: [
    {
      tag: "button",
      role: "button",
      accessibleName: { source: "visible_text", text: "Buy boots" },
      label: "Buy boots",
      attributes: { "data-testid": "buy-boots" },
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    },
  ],
};

const ACTIVE_TAB: TabIdentity = { id: 42, windowId: 7, active: true };

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64FromBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function pngContainingSecret(): string {
  const png = bytesFromBase64(SAFE_PNG_BASE64);
  const secret = new TextEncoder().encode("super-secret-value");
  const combined = new Uint8Array(png.length + secret.length);
  combined.set(png);
  combined.set(secret, png.length);
  return `data:image/png;base64,${base64FromBytes(combined)}`;
}

function defaultOptions(
  snapshot = PAGE_SNAPSHOT,
  overrides: Partial<CaptureObservationOptions> = {},
): CaptureObservationOptions {
  return {
    captureVisibleTab: async () => SAFE_PNG,
    getTabIdentity: async () => ACTIVE_TAB,
    getZoom: async () => 1,
    maskScreenshot: async () => MASKED_PNG_BYTES,
    now: () => new Date("2026-08-03T12:34:56.000Z"),
    sendCdpCommand: async (_tabId, method) =>
      method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "main-frame" } } }
        : { result: { value: snapshot } },
    ...overrides,
  };
}

function captureFixture(marker: string) {
  const methods: string[] = [];
  const snapshot = {
    ...PAGE_SNAPSHOT,
    url: `https://example.test/search?q=boots&${marker}=super-secret-value#${marker}`,
    title: `${marker}: super-secret-value`,
    sensitiveRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    semanticTargets: [
      {
        ...PAGE_SNAPSHOT.semanticTargets[0],
        accessibleName: {
          source: "visible_text",
          text: `${marker}: super-secret-value`,
        },
        label: `${marker}: super-secret-value`,
        attributes: {
          "aria-label": `${marker}: super-secret-value`,
          "data-testid": `${marker}-super-secret-value`,
          [marker]: "super-secret-value",
          value: "super-secret-value",
          innerHTML: `<b>${marker}: super-secret-value</b>`,
        },
      },
    ],
  };

  return captureObservation(
    42,
    defaultOptions(snapshot, {
      sendCdpCommand: async (_tabId: number, method: string) => {
        methods.push(method);
        return method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "main-frame" } } }
          : { result: { value: snapshot } };
      },
    }),
  ).then((observation) => ({ observation, methods }));
}

describe("canonical browser observation capture", () => {
  it.each([
    "password",
    "cookie",
    "authorization",
    "localStorage",
    "sessionStorage",
  ])("never serializes %s data", async (marker) => {
    const { observation } = await captureFixture(marker);
    const encoded = JSON.stringify(observation);
    expect(encoded.toLowerCase()).not.toContain(marker.toLowerCase());
    expect(encoded).not.toContain("super-secret-value");
  });

  it("binds visible capture to the exact active tab and window", async () => {
    const identities: TabIdentity[] = [ACTIVE_TAB, ACTIVE_TAB, ACTIVE_TAB];
    const captureVisibleTab = jest.fn(async () => SAFE_PNG);

    await captureObservation(
      42,
      defaultOptions(PAGE_SNAPSHOT, {
        captureVisibleTab,
        getTabIdentity: async () => identities.shift() ?? ACTIVE_TAB,
      }),
    );

    expect(captureVisibleTab).toHaveBeenCalledWith(42, 7);
    expect(identities).toHaveLength(0);
  });

  it("rejects a non-active target before taking a screenshot", async () => {
    const captureVisibleTab = jest.fn(async () => SAFE_PNG);

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          captureVisibleTab,
          getTabIdentity: async () => ({ ...ACTIVE_TAB, active: false }),
        }),
      ),
    ).rejects.toBeInstanceOf(ObservationSecurityError);
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it("rejects when the active tab changes during visible capture", async () => {
    const identities: TabIdentity[] = [
      ACTIVE_TAB,
      ACTIVE_TAB,
      { id: 99, windowId: 7, active: true },
    ];

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          getTabIdentity: async () =>
            identities.shift() ?? { id: 99, windowId: 7, active: true },
        }),
      ),
    ).rejects.toThrow("active tab changed");
  });

  it("masks sensitive screenshot regions before hashing or returning bytes", async () => {
    const rawPng = pngContainingSecret();
    const maskScreenshot = jest.fn(
      async ({ pngBytes, sensitiveRegions }: ScreenshotMaskInput) => {
        expect(new TextDecoder().decode(pngBytes)).toContain(
          "super-secret-value",
        );
        expect(sensitiveRegions).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
        return bytesFromBase64(SAFE_PNG_BASE64);
      },
    );
    const snapshot = {
      ...PAGE_SNAPSHOT,
      sensitiveRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    };

    const observation = await captureObservation(
      42,
      defaultOptions(snapshot, {
        captureVisibleTab: async () => rawPng,
        maskScreenshot,
      }),
    );

    expect(maskScreenshot).toHaveBeenCalledTimes(1);
    expect(observation.screenshot.data).toBe(SAFE_PNG_BASE64);
    expect(observation.screenshot.data).not.toBe(rawPng.split(",")[1]);
    expect(
      new TextDecoder().decode(bytesFromBase64(observation.screenshot.data)),
    ).not.toContain("super-secret-value");
  });

  it("fails closed when a sensitive-region masker returns the raw PNG", async () => {
    const snapshot = {
      ...PAGE_SNAPSHOT,
      sensitiveRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
    };

    await expect(
      captureObservation(
        42,
        defaultOptions(snapshot, {
          maskScreenshot: async ({ pngBytes }: ScreenshotMaskInput) => pngBytes,
        }),
      ),
    ).rejects.toThrow("unchanged sensitive screenshot");
  });

  it("captures deterministic masked screenshot and page metadata", async () => {
    const options = defaultOptions();

    const first = await captureObservation(42, options);
    const second = await captureObservation(42, options);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      capturedAt: "2026-08-03T12:34:56.000Z",
      url: "https://example.test/search?query=boots",
      title: "Products",
      screenshot: {
        kind: "inline",
        encoding: "png",
        width: 1,
        height: 1,
      },
      viewport: {
        width: 1,
        height: 1,
        devicePixelRatio: 1,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
      },
      page: {
        lifecycle: "complete",
        visibility: "visible",
      },
    });
    expect(first.observationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.page.tabId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.page.frameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.screenshot.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.screenshot.data).not.toContain("data:image/png;base64,");
    expect(first.semanticTargets).toHaveLength(1);
    expect(first.semanticTargets[0]?.framePath).toEqual([]);
  });

  it("uses only the safe Runtime evaluation CDP boundary", async () => {
    const { methods } = await captureFixture("cookie");

    expect(methods).toEqual([
      "Page.getFrameTree",
      "Runtime.evaluate",
      "Page.getFrameTree",
      "Runtime.evaluate",
      "Accessibility.getFullAXTree",
    ]);
    expect(
      methods.some((method) => /cookie|storage|network/i.test(method)),
    ).toBe(false);
  });

  it("caps visible semantic targets before returning the observation", async () => {
    const semanticTargets = Array.from({ length: 205 }, (_, index) => ({
      ...PAGE_SNAPSHOT.semanticTargets[0],
      accessibleName: { source: "visible_text", text: `Choice ${index}` },
      label: `Choice ${index}`,
    }));
    const snapshot = { ...PAGE_SNAPSHOT, semanticTargets };

    const observation = await captureObservation(
      42,
      defaultOptions(snapshot, { maxSemanticTargets: 2 }),
    );

    expect(
      observation.semanticTargets.map(
        (target: SemanticTarget) => target.accessibleName?.text,
      ),
    ).toEqual(["Choice 0", "Choice 1"]);
  });

  it.each([
    { maxSemanticTargets: Number.NaN },
    { maxSemanticTargets: Number.POSITIVE_INFINITY },
    { maxSemanticTargets: 1.5 },
    { maxSemanticTargets: -1 },
    { maxDomElements: Number.NaN },
    { maxDomElements: 10.5 },
  ])("rejects invalid numeric capture options: %p", async (invalidOptions) => {
    await expect(
      captureObservation(42, defaultOptions(PAGE_SNAPSHOT, invalidOptions)),
    ).rejects.toBeInstanceOf(ObservationSecurityError);
  });

  it("rejects an oversized PNG before base64 decoding", async () => {
    const atobSpy = jest.spyOn(global, "atob");
    const oversized = `data:image/png;base64,${"A".repeat(10_000_001)}`;

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          captureVisibleTab: async () => oversized,
        }),
      ),
    ).rejects.toThrow("encoded byte limit");
    expect(atobSpy).not.toHaveBeenCalled();
    atobSpy.mockRestore();
  });

  it("rejects impossible PNG pixel dimensions before masking", async () => {
    const bytes = bytesFromBase64(SAFE_PNG_BASE64);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 100_000);
    view.setUint32(20, 100_000);
    const maskScreenshot = jest.fn(async ({ pngBytes }: ScreenshotMaskInput) =>
      Promise.resolve(pngBytes),
    );

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          captureVisibleTab: async () =>
            `data:image/png;base64,${base64FromBytes(bytes)}`,
          maskScreenshot,
        }),
      ),
    ).rejects.toThrow("pixel limit");
    expect(maskScreenshot).not.toHaveBeenCalled();
  });

  it("rejects screenshot dimensions inconsistent with viewport and DPR", async () => {
    await expect(
      captureObservation(
        42,
        defaultOptions({
          ...PAGE_SNAPSHOT,
          viewport: { ...PAGE_SNAPSHOT.viewport, width: 2 },
        }),
      ),
    ).rejects.toThrow("viewport dimensions");
  });

  it("rejects page or viewport drift across screenshot capture", async () => {
    const snapshots = [
      PAGE_SNAPSHOT,
      {
        ...PAGE_SNAPSHOT,
        viewport: { ...PAGE_SNAPSHOT.viewport, scrollY: 1 },
      },
    ];

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          sendCdpCommand: async (_tabId, method) =>
            method === "Page.getFrameTree"
              ? { frameTree: { frame: { id: "main-frame" } } }
              : { result: { value: snapshots.shift() } },
        }),
      ),
    ).rejects.toThrow("page changed during capture");
  });

  it("fails closed for a shadow-hosted child reported by CDP topology", async () => {
    const captureVisibleTab = jest.fn(async () => SAFE_PNG);

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          captureVisibleTab,
          sendCdpCommand: async (_tabId, method) =>
            method === "Page.getFrameTree"
              ? {
                  frameTree: {
                    frame: { id: "main-frame" },
                    childFrames: [
                      {
                        frame: {
                          id: "shadow-hosted-child",
                          parentId: "main-frame",
                        },
                      },
                    ],
                  },
                }
              : { result: { value: PAGE_SNAPSHOT } },
        }),
      ),
    ).rejects.toThrow("child frames");
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it("fails closed when CDP frame topology cannot be proven", async () => {
    const captureVisibleTab = jest.fn(async () => SAFE_PNG);

    await expect(
      captureObservation(
        42,
        defaultOptions(PAGE_SNAPSHOT, {
          captureVisibleTab,
          sendCdpCommand: async (_tabId, method) =>
            method === "Page.getFrameTree"
              ? { frameTree: null }
              : { result: { value: PAGE_SNAPSHOT } },
        }),
      ),
    ).rejects.toThrow("frame topology");
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it("fails closed when the bounded DOM scan is incomplete", async () => {
    await expect(
      captureObservation(
        42,
        defaultOptions({ ...PAGE_SNAPSHOT, domScanComplete: false }),
      ),
    ).rejects.toThrow("DOM scan limit");
  });

  it("includes accessibilityNodes when sendCdpCommand returns AXTree", async () => {
    const methods: string[] = [];
    const sendCdpCommand = jest.fn(
      async (_tabId: number, method: string) => {
        methods.push(method);
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: "main-frame" } } };
        }
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [
              {
                nodeId: "AXNode-1",
                role: { value: "button" },
                name: { value: "Submit" },
                properties: [{ name: "data-testid", value: { value: "submit-btn" } }],
                boundingBox: { x: 10, y: 20, width: 100, height: 40 },
              },
              {
                nodeId: "AXNode-2",
                role: { value: "StaticText" },
                name: { value: "Hello world" },
              },
            ],
          };
        }
        return { result: { value: PAGE_SNAPSHOT } };
      },
    );

    const obs = await captureObservation(
      42,
      defaultOptions(PAGE_SNAPSHOT, { sendCdpCommand }),
    );

    expect(methods).toContain("Accessibility.getFullAXTree");
    expect(obs.accessibilityNodes).toBeDefined();
    expect(obs.accessibilityNodes!.length).toBeGreaterThan(0);
    expect(obs.accessibilityNodes![0]).toMatchObject({
      role: "button",
      name: "Submit",
      attributes: expect.objectContaining({ "data-testid": "submit-btn" }),
    });
  });
});
