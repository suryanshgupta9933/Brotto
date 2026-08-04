import { captureObservation } from "../src/canonical/observation";
import type { SemanticTarget } from "@fara-platform/fara-action-schema";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7+XIAAAAASUVORK5CYII=";

const PAGE_SNAPSHOT = {
  url: "https://example.test/search?query=boots",
  title: "Products",
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 2,
    scrollX: 12,
    scrollY: 34,
  },
  readyState: "complete",
  visibility: "visible",
  semanticTargets: [
    {
      tag: "button",
      role: "button",
      accessibleName: { source: "visible_text", text: "Buy boots" },
      label: "Buy boots",
      attributes: { "data-testid": "buy-boots" },
      boundingBox: { x: 20, y: 30, width: 100, height: 40 },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    },
  ],
};

function captureFixture(marker: string) {
  const methods: string[] = [];

  return captureObservation(42, {
    captureVisibleTab: async () => ONE_PIXEL_PNG,
    getZoom: async () => 1.25,
    now: () => new Date("2026-08-03T12:34:56.000Z"),
    sendCdpCommand: async (_tabId, method) => {
      methods.push(method);
      return {
        result: {
          value: {
            ...PAGE_SNAPSHOT,
            url: `https://example.test/search?query=boots&${marker}=super-secret-value#${marker}`,
            title: `${marker}: super-secret-value`,
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
          },
        },
      };
    },
  }).then((observation) => ({ observation, methods }));
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

  it("captures deterministic screenshot and page metadata", async () => {
    const options = {
      captureVisibleTab: async () => ONE_PIXEL_PNG,
      getZoom: async () => 1.25,
      now: () => new Date("2026-08-03T12:34:56.000Z"),
      sendCdpCommand: async () => ({ result: { value: PAGE_SNAPSHOT } }),
    };

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
        width: 1280,
        height: 720,
        devicePixelRatio: 2,
        zoom: 1.25,
        scrollX: 12,
        scrollY: 34,
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
  });

  it("uses only the safe Runtime evaluation CDP boundary", async () => {
    const { methods } = await captureFixture("cookie");

    expect(methods).toEqual(["Runtime.evaluate"]);
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

    const observation = await captureObservation(42, {
      captureVisibleTab: async () => ONE_PIXEL_PNG,
      getZoom: async () => 1,
      maxSemanticTargets: 2,
      now: () => new Date("2026-08-03T12:34:56.000Z"),
      sendCdpCommand: async () => ({
        result: { value: { ...PAGE_SNAPSHOT, semanticTargets } },
      }),
    });

    expect(
      observation.semanticTargets.map(
        (target: SemanticTarget) => target.accessibleName?.text,
      ),
    ).toEqual(["Choice 0", "Choice 1"]);
  });
});
