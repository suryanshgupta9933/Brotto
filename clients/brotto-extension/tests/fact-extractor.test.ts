import { extractFacts } from "../src/fact-extractor";

describe("extractFacts", () => {
  const trackPage = {
    url: "https://www.amazon.in/progress-tracker/package",
    title: "Track Package",
    pagePurpose: "Subtotal",
    bodyText: "H1: Delivered 6 August\nH4: Tracking ID: 371470111139\nH1: Subtotal ₹649.00\nH1: 2 orders in this package\nshipment-tracking@amazon.in",
  };

  it("extracts tracking ID", () => {
    const facts = extractFacts(trackPage, ["amazon", "package"]);
    const tracking = facts.find((f) => f.key === "tracking_id");
    expect(tracking).toBeDefined();
    expect(tracking?.value).toBe("371470111139");
  });

  it("extracts money amount with currency key", () => {
    const facts = extractFacts(trackPage, ["amazon", "package"]);
    const amount = facts.find((f) => f.key.startsWith("amount_₹"));
    expect(amount).toBeDefined();
    expect(amount?.value).toContain("649");
  });

  it("extracts delivered date", () => {
    const facts = extractFacts(trackPage, ["amazon", "package"]);
    const date = facts.find((f) => f.key === "delivered_date");
    expect(date).toBeDefined();
    expect(date?.value).toContain("Delivered");
    expect(date?.value).toContain("6 August");
  });

  it("extracts sender address", () => {
    const facts = extractFacts(trackPage, ["amazon", "package"]);
    const sender = facts.find((f) => f.key === "sender");
    expect(sender).toBeDefined();
    expect(sender?.value).toContain("shipment-tracking@amazon.in");
  });

  it("extracts status with surrounding context", () => {
    const facts = extractFacts(trackPage, ["amazon", "package"]);
    const status = facts.find((f) => f.key === "status");
    expect(status).toBeDefined();
    expect(status?.value.toLowerCase()).toContain("delivered");
  });

  it("extracts order ID with explicit keyword", () => {
    const facts = extractFacts(
      { ...trackPage, bodyText: "Your order #SU515440 has shipped." },
      ["amazon", "package"],
    );
    const orderId = facts.find((f) => f.key === "order_id");
    expect(orderId).toBeDefined();
    expect(orderId?.value).toContain("SU515440");
  });

  it("extracts URL path facts", () => {
    const facts = extractFacts(trackPage, []);
    const path = facts.find((f) => f.key.startsWith("path_"));
    expect(path).toBeDefined();
  });

  it("always keeps crucial categories regardless of goal match", () => {
    // ponytail: even with empty goalKeywords, IDs/money/dates/sender should pass through.
    const facts = extractFacts(trackPage, []);
    expect(facts.some((f) => f.key === "tracking_id")).toBe(true);
    expect(facts.some((f) => f.key.startsWith("amount_"))).toBe(true);
    expect(facts.some((f) => f.key === "delivered_date")).toBe(true);
    expect(facts.some((f) => f.key === "sender")).toBe(true);
  });

  it("filters out goal-irrelevant noise", () => {
    const noisy = {
      ...trackPage,
      bodyText: trackPage.bodyText + "\nLorem ipsum dolor sit amet, consectetur adipiscing.",
    };
    const facts = extractFacts(noisy, ["amazon", "package"]);
    expect(facts.find((f) => f.key.includes("lorem"))).toBeUndefined();
  });

  it("returns empty array for blank body", () => {
    expect(extractFacts({ url: "x", title: "t", bodyText: "" }, ["amazon"])).toEqual([]);
  });
});
