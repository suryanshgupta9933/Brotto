/**
 * Isolated test for Fix #2: memoryUpdates domain validation.
 *
 * Goal: "go to gmail and check the status on my latest amazon package"
 * Goal keywords: gmail, check, status, latest, amazon, package
 *
 * Reject: facts whose value doesn't match a goal keyword AND aren't in
 * always-crucial categories. Catches the SOCKENUP.IN poisoning case.
 */

import {
  validateMemoryUpdatesForGoal,
  extractGoalKeywords,
  type MemoryUpdate,
} from '../context/decision';

const GOAL = 'go to gmail and check the status on my latest amazon package';

describe('extractGoalKeywords', () => {
  it('extracts keywords ≥3 chars, lowercased, deduped, stopwords removed', () => {
    const k = extractGoalKeywords(GOAL);
    expect(k).toContain('gmail');
    expect(k).toContain('amazon');
    expect(k).toContain('package');
    expect(k).toContain('status');
    expect(k).not.toContain('the');
    expect(k).not.toContain('to');
    expect(k).not.toContain('go');
    expect(k).not.toContain('my');
    // Dedup: 'amazon' and 'package' appear once each
    expect(k.filter((x) => x === 'amazon')).toHaveLength(1);
  });

  it('returns empty array for empty goal', () => {
    expect(extractGoalKeywords('')).toEqual([]);
  });
});

describe('validateMemoryUpdatesForGoal (Fix #2)', () => {
  it('rejects SOCKENUP.IN candidate_order under Amazon goal (the bug)', () => {
    const updates: MemoryUpdate[] = [
      {
        key: 'candidate_order',
        value: 'SOCKENUP.IN order #SU515440',
        evidence: 'Gmail inbox shipping update row',
      },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].update.key).toBe('candidate_order');
    expect(r.rejected[0].reason).toContain('amazon');
  });

  it('accepts Amazon order_id (always-crucial)', () => {
    const updates: MemoryUpdate[] = [
      { key: 'order_id', value: '405-3881124-5123560', evidence: 'Gmail delivery email body' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('accepts Amazon tracking_id (always-crucial)', () => {
    const updates: MemoryUpdate[] = [
      { key: 'tracking_id', value: 'TBA123456789', evidence: 'Amazon order detail page' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('accepts facts whose value mentions "package" (goal keyword)', () => {
    const updates: MemoryUpdate[] = [
      {
        key: 'package_status',
        value: 'Yogabar 26g High Protein package',
        evidence: 'Gmail search result',
      },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('accepts facts whose evidence mentions a goal domain keyword', () => {
    const updates: MemoryUpdate[] = [
      {
        key: 'latest_item',
        value: 'Noise Buds',
        evidence: 'Amazon.in order details page',
      },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
  });

  it('accepts facts with status key (always-crucial)', () => {
    const updates: MemoryUpdate[] = [
      { key: 'status', value: 'Delivered', evidence: 'Some row' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
  });

  it('accepts facts with sender key (always-crucial)', () => {
    const updates: MemoryUpdate[] = [
      { key: 'sender', value: 'order-update@amazon.in', evidence: 'Gmail' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toHaveLength(1);
  });

  it('handles mixed batch: accepts valid, rejects poisoned', () => {
    const updates: MemoryUpdate[] = [
      { key: 'order_id', value: '405-3881124-5123560', evidence: 'Amazon' },
      { key: 'candidate_order', value: 'SOCKENUP.IN order #SU515440', evidence: 'Gmail row' },
      { key: 'uber_receipt', value: 'Aug 9 ride', evidence: 'uber receipt' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    // order_id is always-crucial → accepted
    expect(r.accepted.some((a) => a.key === 'order_id')).toBe(true);
    // candidate_order (SOCKENUP.IN contradicts goal domain) → REJECTED
    expect(r.rejected.some((rj) => rj.update.key === 'candidate_order')).toBe(true);
    // uber_receipt (no domain match, no keyword match) → REJECTED
    expect(r.rejected.some((rj) => rj.update.key === 'uber_receipt')).toBe(true);
  });

  it('drops malformed entries silently (shape check unchanged)', () => {
    const updates = [
      { not: 'memory update' },
      null,
      { key: 123 }, // wrong type
    ] as unknown as MemoryUpdate[];
    const r = validateMemoryUpdatesForGoal(updates, GOAL);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual([]); // shape-failed entries aren't rejected with reason, just dropped
  });

  it('returns empty when input is not an array', () => {
    const r = validateMemoryUpdatesForGoal('not an array', GOAL);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('with empty goal accepts everything (no goal keywords to fail)', () => {
    const updates: MemoryUpdate[] = [
      { key: 'random', value: 'anything', evidence: 'who knows' },
    ];
    const r = validateMemoryUpdatesForGoal(updates, '');
    // Empty keywords → matchesGoal is true (the `keywords.length === 0` short-circuit).
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });
});
