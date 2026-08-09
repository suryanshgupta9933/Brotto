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
});
