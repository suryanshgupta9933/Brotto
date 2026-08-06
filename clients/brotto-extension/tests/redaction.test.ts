import {
  sanitizeBrowserText,
  sanitizeObservationUrl,
  sanitizeSemanticTarget,
} from "../src/canonical/redaction";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

describe("semantic target redaction", () => {
  it("retains only schema-safe grounding metadata", () => {
    const target = sanitizeSemanticTarget({
      targetId: TARGET_ID,
      tag: "INPUT",
      role: "searchbox",
      accessibleName: { source: "aria-label", text: "  Search products  " },
      label: "Search products",
      attributes: {
        "aria-label": "Search products",
        "aria-expanded": "false",
        "data-testid": "global-search",
        name: "query",
        type: "search",
        class: "private internal classes",
        value: "never collect this",
      },
      boundingBox: { x: 10, y: 20, width: 300, height: 40 },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    });

    expect(target).toEqual({
      targetId: TARGET_ID,
      tag: "input",
      role: "searchbox",
      accessibleName: { source: "aria-label", text: "Search products" },
      attributes: {
        "aria-label": "Search products",
        "aria-expanded": "false",
      },
      control: { kind: "input", inputType: "search" },
      boundingBox: { x: 10, y: 20, width: 300, height: 40 },
      visible: true,
      framePath: [],
      locatorCandidates: [
        {
          kind: "role_name",
          role: "searchbox",
          name: { source: "aria-label", text: "Search products" },
        },
        {
          kind: "label",
          label: { source: "visible_text", text: "Search products" },
        },
        { kind: "test_id", testId: "global-search" },
        {
          kind: "safe_attribute",
          attribute: "aria-label",
          value: "Search products",
        },
      ],
    });

    expect(JSON.stringify(target)).not.toContain("private internal classes");
    expect(JSON.stringify(target)).not.toContain("never collect this");
    expect(JSON.stringify(target)).not.toContain('"name":"query"');
  });

  it.each([
    "password",
    "cookie",
    "authorization",
    "localStorage",
    "sessionStorage",
  ])("drops semantic %s content and its adjacent secret", (marker) => {
    const target = sanitizeSemanticTarget({
      targetId: TARGET_ID,
      tag: "button",
      role: "button",
      accessibleName: {
        source: "visible_text",
        text: `${marker}: super-secret-value`,
      },
      label: `${marker}: super-secret-value`,
      attributes: {
        "aria-label": `${marker}: super-secret-value`,
        "data-testid": `${marker}-super-secret-value`,
        [marker]: "super-secret-value",
      },
      boundingBox: { x: 1, y: 2, width: 10, height: 10 },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    });

    const encoded = JSON.stringify(target);
    expect(encoded.toLowerCase()).not.toContain(marker.toLowerCase());
    expect(encoded).not.toContain("super-secret-value");
  });

  it("rejects hidden and password controls before serialization", () => {
    const base = {
      targetId: TARGET_ID,
      tag: "input",
      boundingBox: { x: 1, y: 2, width: 10, height: 10 },
      framePath: [],
      locatorCandidates: [],
    };

    expect(
      sanitizeSemanticTarget({
        ...base,
        visible: false,
        attributes: { type: "text" },
      }),
    ).toBeNull();
    expect(
      sanitizeSemanticTarget({
        ...base,
        visible: true,
        attributes: { type: "password" },
      }),
    ).toBeNull();
  });

  it("rejects visible elements that are not actionable", () => {
    expect(
      sanitizeSemanticTarget({
        targetId: TARGET_ID,
        tag: "div",
        role: "heading",
        accessibleName: { source: "visible_text", text: "Page title" },
        boundingBox: { x: 1, y: 2, width: 100, height: 20 },
        visible: true,
        framePath: [],
        locatorCandidates: [],
      }),
    ).toBeNull();
  });

  it("rejects an opaque path when any segment is invalid", () => {
    expect(
      sanitizeSemanticTarget({
        targetId: TARGET_ID,
        tag: "button",
        role: "button",
        boundingBox: { x: 1, y: 2, width: 100, height: 20 },
        visible: true,
        framePath: [
          "22222222-2222-4222-8222-222222222222",
          "main-frame-selector",
        ],
        locatorCandidates: [],
      }),
    ).toBeNull();
  });

  it("allowlists query keys and removes normalized credential parameters", () => {
    expect(
      sanitizeObservationUrl(
        "https://example.test/search?q=boots&access_token=a&api-key=b&AUTH=c&bearer=d&customer=e#secret",
      ),
    ).toBe("https://example.test/search?q=boots");
  });

  it.each([
    ["q", "api_key=super-secret-value"],
    ["query", "API-Key=super-secret-value"],
    ["q", "sk_live_1234567890abcdef"],
    ["query", "Bearer abc.def.ghi"],
    ["q", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"],
    ["query", "access_token=abc123"],
    ["q", "secret=abc123"],
  ])(
    "drops credential-shaped values from allowlisted %s: %s",
    (queryKey, secret) => {
      expect(
        sanitizeObservationUrl(
          `https://example.test/search?${queryKey}=${encodeURIComponent(secret)}&page=2`,
        ),
      ).toBe("https://example.test/search?page=2");
    },
  );

  it.each([
    "API-Key: super-secret-value",
    "sk_live_1234567890abcdef",
    "Bearer abc.def.ghi",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
    "access_token=abc123",
    "secret=abc123",
  ])("redacts credential-shaped browser titles: %s", (title) => {
    expect(sanitizeBrowserText(title)).toBe("[redacted]");
  });

  it("rejects overlong observation URLs", () => {
    expect(() =>
      sanitizeObservationUrl(`https://example.test/${"a".repeat(2048)}`),
    ).toThrow("maximum length");
  });

  it("caps strings and locator candidates to canonical limits", () => {
    const target = sanitizeSemanticTarget({
      targetId: TARGET_ID,
      tag: "x".repeat(100),
      role: "button",
      accessibleName: { source: "visible_text", text: "n".repeat(700) },
      label: "l".repeat(700),
      attributes: {
        "data-testid": "t".repeat(700),
        "aria-controls": "c".repeat(700),
      },
      boundingBox: { x: 1, y: 2, width: 10, height: 10 },
      visible: true,
      framePath: [],
      locatorCandidates: Array.from({ length: 20 }, (_, index) => ({
        kind: "test_id" as const,
        testId: `fixture-${index}`,
      })),
    });

    expect(target?.tag).toHaveLength(64);
    expect(target?.role).toBe("button");
    expect(target?.accessibleName?.text).toHaveLength(512);
    expect(target?.locatorCandidates).toHaveLength(10);
    expect(JSON.stringify(target?.locatorCandidates)).not.toContain(
      "t".repeat(513),
    );
  });
});
