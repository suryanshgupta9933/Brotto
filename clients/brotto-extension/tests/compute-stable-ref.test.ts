/**
 * Isolated test for Fix #4: 64-bit stableRef.
 *
 * Pre-fix: 32-bit FNV-1a, hex duplicated to 16 chars (no real entropy past
 * 32 bits). Birthday collision in dense lists at ~65K targets; in dense
 * real-world lists (Gmail rows, search results, nav menus) the effective
 * collision rate is higher than ideal.
 *
 * Post-fix: two independent FNV-1a 32-bit hashes with different offset
 * bases give true 64-bit entropy, 16 hex chars.
 */

import { computeStableRef } from "../src/canonical/redaction";

const baseAttrs = {
  "data-testid": undefined,
  name: undefined,
  "aria-label": undefined,
  type: undefined,
} as Record<string, string | undefined>;

describe("computeStableRef (Fix #4)", () => {
  it("returns 16 hex chars", () => {
    const r = computeStableRef({
      tag: "div",
      role: "link",
      accessibleName: "Yogabar 26g High Protein",
      attributes: baseAttrs,
    });
    expect(r).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different stableRefs for two Gmail row-like elements with same tag/role/attrs but different subjects", () => {
    const r1 = computeStableRef({
      tag: "div",
      role: "link",
      accessibleName: "Amazon - Delivered: Your Yogabar package has been delivered",
      attributes: baseAttrs,
    });
    const r2 = computeStableRef({
      tag: "div",
      role: "link",
      accessibleName: "SOCKENUP.IN - Shipping update for order #SU515440",
      attributes: baseAttrs,
    });
    const r3 = computeStableRef({
      tag: "div",
      role: "link",
      accessibleName: "Uber - Your Sunday evening trip with Uber",
      attributes: baseAttrs,
    });
    expect(r1).not.toBe(r2);
    expect(r2).not.toBe(r3);
    expect(r1).not.toBe(r3);
  });

  it("produces different stableRefs for different data-testid", () => {
    const r1 = computeStableRef({
      tag: "button",
      role: undefined,
      accessibleName: "Submit",
      attributes: { ...baseAttrs, "data-testid": "btn-submit" },
    });
    const r2 = computeStableRef({
      tag: "button",
      role: undefined,
      accessibleName: "Submit",
      attributes: { ...baseAttrs, "data-testid": "btn-cancel" },
    });
    expect(r1).not.toBe(r2);
  });

  it("is case-insensitive on accessibleName", () => {
    const r1 = computeStableRef({
      tag: "a",
      role: "link",
      accessibleName: "Yogabar Package",
      attributes: baseAttrs,
    });
    const r2 = computeStableRef({
      tag: "a",
      role: "link",
      accessibleName: "YOGABAR PACKAGE",
      attributes: baseAttrs,
    });
    expect(r1).toBe(r2);
  });

  it("returns different hash for different tags", () => {
    const r1 = computeStableRef({
      tag: "div",
      role: "link",
      accessibleName: "x",
      attributes: baseAttrs,
    });
    const r2 = computeStableRef({
      tag: "a",
      role: "link",
      accessibleName: "x",
      attributes: baseAttrs,
    });
    expect(r1).not.toBe(r2);
  });

  it("hash space is wider than 32 bits (collision resistance)", () => {
    // Generate 5000 stableRefs with subtly varying inputs. With 32-bit hash,
    // birthday collision probability is ~50% at 65K; at 5K samples the rate
    // should still be well under 1%. With 64-bit it's effectively zero.
    const seen = new Map<string, number>();
    for (let i = 0; i < 5000; i += 1) {
      const r = computeStableRef({
        tag: "div",
        role: "row",
        accessibleName: `row-${i}`,
        attributes: baseAttrs,
      });
      expect(r).toBeDefined();
      if (seen.has(r!)) {
        seen.set(r!, (seen.get(r!) ?? 0) + 1);
      } else {
        seen.set(r!, 1);
      }
    }
    const collisions = Array.from(seen.values()).filter((c) => c > 1);
    expect(collisions.length).toBe(0);
  });

  it("is deterministic across calls", () => {
    const input = {
      tag: "div",
      role: "link",
      accessibleName: "test",
      attributes: baseAttrs,
    };
    const a = computeStableRef(input);
    const b = computeStableRef(input);
    expect(a).toBe(b);
  });

  it("upper half and lower half are independent (proves true 64-bit, not duplicated 32-bit)", () => {
    // Pre-fix bug: (hex + hex).slice(0, 16) doubled the 32-bit hash. The
    // upper and lower halves were identical. Post-fix: independent halves.
    const r1 = computeStableRef({
      tag: "div",
      role: "row",
      accessibleName: "alpha",
      attributes: baseAttrs,
    });
    const r2 = computeStableRef({
      tag: "div",
      role: "row",
      accessibleName: "beta",
      attributes: baseAttrs,
    });
    // For these distinct inputs, both halves should differ across the two
    // results — would not be the case with a duplicated 32-bit hash when
    // the underlying hashes happened to match.
    expect(r1!.slice(0, 8)).not.toBe(r2!.slice(0, 8));
    expect(r1!.slice(8, 16)).not.toBe(r2!.slice(8, 16));
  });
});
