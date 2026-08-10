/**
 * Isolated test for Fix #5 part B: prompt section presence.
 *
 * The system prompt must contain the new sections (DOMAIN VERIFICATION,
 * SEARCH-FIRST, MEMORY DISCIPLINE) so the model knows the rules. Asserts
 * against the rendered prompt text exposed by the planner via the
 * openai-compatible-planner module's internals — tested by reading the
 * planner source string and verifying the section markers are present.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const plannerPath = join(__dirname, "../adapters/openai-compatible-planner.ts");
const plannerSource = readFileSync(plannerPath, "utf8");

describe("system prompt — Fix #5 part B sections present", () => {
  it("includes DOMAIN VERIFICATION section", () => {
    expect(plannerSource).toContain("DOMAIN VERIFICATION");
    expect(plannerSource).toContain("GOAL DOMAIN");
  });

  it("DOMAIN VERIFICATION does NOT hardcode specific sender names (generalizes to tomorrow's packages)", () => {
    // The SOCKENUP.IN example was a one-day trace — if we hardcode it in
    // the prompt, the model will trust any non-listed non-domain sender.
    // Verify the prompt now speaks in principles (any seller ≠ goal domain),
    // not in yesterday's specific sender list.
    const block = plannerSource.match(/DOMAIN VERIFICATION[\s\S]+?(?=SEARCH-FIRST)/);
    expect(block).not.toBeNull();
    if (block) {
      // Specific hardcoded names that would rot:
      expect(block[0]).not.toContain("SOCKENUP.IN");
      expect(block[0]).not.toContain("Vastrado");
      expect(block[0]).not.toContain("Bluedart");
      // Generic principle present:
      expect(block[0]).toMatch(/ANY other seller|any other seller|any sender/i);
    }
  });

  it("includes SEARCH-FIRST section", () => {
    expect(plannerSource).toContain("SEARCH-FIRST");
    expect(plannerSource).toContain("direct search URL");
    expect(plannerSource).toContain("inbox-row-selection failure mode");
  });

  it("includes MEMORY DISCIPLINE section", () => {
    expect(plannerSource).toContain("MEMORY DISCIPLINE");
    expect(plannerSource).toContain("always-crucial category");
    expect(plannerSource).toContain("page is the source of truth");
  });

  it("section order is DOMAIN → SEARCH → MEMORY (rules escalate from observation to action)", () => {
    const domainIdx = plannerSource.indexOf("DOMAIN VERIFICATION");
    const searchIdx = plannerSource.indexOf("SEARCH-FIRST");
    const memoryIdx = plannerSource.indexOf("MEMORY DISCIPLINE");
    expect(domainIdx).toBeGreaterThan(-1);
    expect(searchIdx).toBeGreaterThan(domainIdx);
    expect(memoryIdx).toBeGreaterThan(searchIdx);
  });

  it("DOMAIN VERIFICATION warns against opening non-domain-matching rows", () => {
    const block = plannerSource.match(/DOMAIN VERIFICATION[\s\S]+?(?=SEARCH-FIRST)/);
    expect(block).not.toBeNull();
    if (block) {
      expect(block[0]).toContain("Do NOT open an email");
      expect(block[0]).toContain("Skip rows whose sender doesn't match");
    }
  });

  it("includes ROW CONTAINER vs INNER LINK rule (Gmail/Outlook rows don't navigate)", () => {
    expect(plannerSource).toContain("ROW CONTAINER vs INNER LINK");
    const block = plannerSource.match(/ROW CONTAINER[\s\S]+?(?=DRILL INTO DEEPER|MEMORY DISCIPLINE)/);
    expect(block).not.toBeNull();
    if (block) {
      // Rule must teach: row containers have role=link but don't navigate,
      // so click the inner element (View order, Open, Track).
      expect(block[0]).toContain("row CONTAINER");
      expect(block[0]).toContain("does NOT navigate");
      expect(block[0]).toContain("View order");
      expect(block[0]).toMatch(/Open|Track/);
      // Heuristic for self-correction when click has no effect
      expect(block[0]).toMatch(/2 consecutive|page.*stay|URL change/);
    }
  });

  it("includes DRILL INTO DEEPER SOURCE OF TRUTH rule (general — applies beyond tracking)", () => {
    // General principle: list pages summarize, detail pages have the answer.
    // Should NOT name specific vendors (Amazon, Flipkart, courier names).
    expect(plannerSource).toContain("DRILL INTO DEEPER SOURCE OF TRUTH");
    const block = plannerSource.match(/DRILL INTO DEEPER SOURCE OF TRUTH[\s\S]+?(?=MEMORY DISCIPLINE)/);
    expect(block).not.toBeNull();
    if (block) {
      // General principles:
      expect(block[0]).toMatch(/SUMMAR(IES|Y)|summary/i);
      expect(block[0]).toContain("DETAIL page");
      expect(block[0]).toMatch(/drill in/i);
      // Anchor-list pointer (the existing ANCHORS block is the data source):
      expect(block[0]).toMatch(/ANCHORS|anchor/i);
      // Self-check before terminate:
      expect(block[0]).toMatch(/self-check|source of truth|SOURCE OF TRUTH/i);
      // Generic applicability — list of contexts where the rule applies:
      expect(block[0]).toContain("search results");
      expect(block[0]).toContain("GitHub");
      expect(block[0]).toContain("e-commerce");
      expect(block[0]).toContain("news");
      expect(block[0]).toContain("doc");
      // MUST NOT name a specific courier or vendor as the only example:
      expect(block[0]).not.toMatch(/^[\s\S]*Bluedart[\s\S]*$/m);
      expect(block[0]).not.toMatch(/^[\s\S]*Delhivery[\s\S]*$/m);
      expect(block[0]).not.toMatch(/^[\s\S]*FedEx[\s\S]*$/m);
      expect(block[0]).not.toMatch(/^[\s\S]*UPS[\s\S]*$/m);
      expect(block[0]).not.toMatch(/^[\s\S]*DHL[\s\S]*$/m);
    }
  });
});
