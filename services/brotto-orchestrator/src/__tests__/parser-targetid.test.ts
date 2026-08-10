/**
 * Isolated test for Fix #3: drop permissive endsWith in resolveTargetId.
 *
 * Before the fix, two targets sharing a hex suffix could be matched by
 * a partial ID, clicking the wrong element. After the fix, only exact
 * match on stableRef or targetId resolves.
 *
 * Note: parser throws a literal { code, error, toolCall } object (not
 * Error) when required fields are missing; the planner catches it. Tests
 * below catch the throw manually and assert on the structured code.
 */

import { ToolCallParser, ParseErrorCode } from '../parser';
import { ActionType } from '@brotto/brotto-action-schema';

const targets = [
  {
    targetId: '11111111-1111-1111-1111-111111111111',
    stableRef: '1658567f1658567f',
    boundingBox: { x: 100, y: 100, width: 200, height: 50 },
  },
  {
    targetId: '22222222-2222-2222-2222-222222222222',
    stableRef: 'abcdef123456789f',
    boundingBox: { x: 400, y: 400, width: 200, height: 50 },
  },
];

interface ThrownParseError {
  code: string;
  error: string;
  toolCall: { name: string; arguments: Record<string, unknown> };
}

function makeParser() {
  const p = new ToolCallParser();
  p.setViewportBounds({ width: 1920, height: 1080 });
  p.setCurrentObservationId(1);
  p.setLastSemanticTargets(targets);
  return p;
}

function tryParse(p: ToolCallParser, calls: Parameters<typeof p.parse>[0]):
  | { ok: true; action: { type: string; coordinates: { x: number; y: number } } }
  | { ok: false; thrown: ThrownParseError } {
  try {
    const result = p.parse(calls);
    if (result.errors.length > 0) return { ok: false, thrown: result.errors[0] as unknown as ThrownParseError };
    if (result.actions.length !== 1) throw new Error(`expected 1 action, got ${result.actions.length}`);
    return { ok: true, action: result.actions[0].action as { type: string; coordinates: { x: number; y: number } } };
  } catch (e) {
    const err = e as ThrownParseError;
    if (err && typeof err === 'object' && 'code' in err && 'error' in err) {
      return { ok: false, thrown: err };
    }
    throw e;
  }
}

describe('resolveTargetId — exact-match only (Fix #3)', () => {
  it('resolves by full stableRef', () => {
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '1658567f1658567f' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.type).toBe(ActionType.LEFT_CLICK);
      // Target 1 bbox center: x=100+200/2=200, y=100+50/2=125
      expect(r.action.coordinates.x).toBe(200);
      expect(r.action.coordinates.y).toBe(125);
    }
  });

  it('resolves by full targetId UUID', () => {
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '22222222-2222-2222-2222-222222222222' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Target 2 bbox center: x=400+200/2=500, y=400+50/2=425
      expect(r.action.coordinates.x).toBe(500);
      expect(r.action.coordinates.y).toBe(425);
    }
  });

  it('rejects partial suffix that would have collided pre-fix', () => {
    // '567f1658567f' is a suffix of stableRef[0]='1658567f1658567f'.
    // Pre-fix endsWith would resolve to target 1. Post-fix: no exact match.
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '567f1658567f' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either parser throws MISSING_REQUIRED_FIELD (when x/y missing) or
      // returns an errors[] entry. Both prove the partial ID was rejected.
      expect(r.thrown.code).toBe(ParseErrorCode.MISSING_REQUIRED_FIELD);
    }
  });

  it('rejects short suffix that would have matched the wrong element', () => {
    // '7f' is a suffix of stableRef[0]. Pre-fix would match target 1 by
    // first-iteration. Post-fix: rejected.
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '7f' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([ParseErrorCode.MISSING_REQUIRED_FIELD]).toContain(r.thrown.code);
    }
  });

  it('rejects short suffix that would have matched the other target', () => {
    // '789f' is a suffix of stableRef[1]. Pre-fix would match target 2.
    // Post-fix: rejected.
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '789f' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([ParseErrorCode.MISSING_REQUIRED_FIELD]).toContain(r.thrown.code);
    }
  });

  it('falls back to args.x / args.y when targetId does not match', () => {
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: {
          targetId: 'unknown_id',
          x: 50,
          y: 60,
          viewportWidth: 1920,
          viewportHeight: 1080,
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(50);
      expect(r.action.coordinates.y).toBe(60);
    }
  });

  it('returns the right target when stableRefs share NO suffix and only one matches exactly', () => {
    // Sanity: with exact-match, targetId '1658567f1658567f' resolves to target 1
    // even though target 2's bbox is at a totally different position — the
    // pre-fix endsWith code would have first-iterated target 1 only if its
    // stableRef ended with the partial; with a full stableRef we get target 1.
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: '1658567f1658567f' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.coordinates.y).toBe(125);
  });
});

describe('row container rejection (Gmail / Outlook lists)', () => {
  // A Gmail / Outlook row container: role=link, div tag, long name
  // (sender + subject + preview > 80 chars), no action verb. The
  // harness should REJECT the click and tell the model to pick an
  // inner element instead.
  const containerTargets = [
    {
      targetId: 'aaa-row-1',
      stableRef: 'aaa1111aaa1111aa',
      tag: 'div',
      role: 'link',
      accessibleName: {
        source: 'computed',
        text: 'Inbox Delivered: Your Amazon package has been delivered. - www.amazon.in. Hi Suryansh, Your package has been delivered! Please rate your delivery experience. Return or replace items in Your Orders.',
      },
      boundingBox: { x: 100, y: 100, width: 800, height: 60 },
    },
    {
      targetId: 'bbb-inner-view',
      stableRef: 'bbb2222bbb2222bb',
      tag: 'div',
      role: 'button',
      accessibleName: { source: 'computed', text: 'View order' },
      boundingBox: { x: 504, y: 100, width: 80, height: 24 },
    },
  ];

  function makeContainerParser() {
    const p = new ToolCallParser();
    p.setViewportBounds({ width: 1920, height: 1080 });
    p.setCurrentObservationId(1);
    p.setLastSemanticTargets(containerTargets as never);
    return p;
  }

  it('rejects click on row container with corrective pointing to inner element', () => {
    const r = tryParse(makeContainerParser(), [
      { name: 'left_click', arguments: { targetId: 'aaa-row-1' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Code is STALE_TARGET (reused — it's about target drift / wrong target).
      expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
      // Error must explain it's a container and direct to inner element.
      expect(r.thrown.error).toContain('row container');
      expect(r.thrown.error).toContain('View order');
      expect(r.thrown.error).toContain('aaa-row-1');
    }
  });

  it('rejects right_click on row container too', () => {
    const p = makeContainerParser();
    const r = tryParse(p, [
      { name: 'right_click', arguments: { targetId: 'aaa-row-1' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
      expect(r.thrown.error).toContain('row container');
    }
  });

  it('allows click on inner element (View order button)', () => {
    const r = tryParse(makeContainerParser(), [
      { name: 'left_click', arguments: { targetId: 'bbb-inner-view' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(544); // 504 + 80/2
      expect(r.action.coordinates.y).toBe(112); // 100 + 24/2
    }
  });

  it('allows click on container with action verb in name (e.g. View order text)', () => {
    // The heuristic skips containers whose name contains "View|Track|Open|..."
    // because those are actionable child links named with the verb.
    const target = {
      targetId: 'ccc-view-text',
      stableRef: 'ccc3333ccc3333cc',
      tag: 'div',
      role: 'link',
      accessibleName: { source: 'computed', text: 'View order details' },
      boundingBox: { x: 50, y: 50, width: 100, height: 30 },
    };
    const p = new ToolCallParser();
    p.setViewportBounds({ width: 1920, height: 1080 });
    p.setCurrentObservationId(1);
    p.setLastSemanticTargets([target] as never);
    const r = tryParse(p, [{ name: 'left_click', arguments: { targetId: 'ccc-view-text' } }]);
    expect(r.ok).toBe(true);
  });

  it('allows click on short-named link (e.g. subject text)', () => {
    // Subject lines are short, so they're not flagged as containers.
    const target = {
      targetId: 'ddd-subject',
      stableRef: 'ddd4444ddd4444dd',
      tag: 'a',
      role: 'link',
      accessibleName: { source: 'computed', text: 'Yogabar delivery' },
      boundingBox: { x: 200, y: 180, width: 400, height: 20 },
    };
    const p = new ToolCallParser();
    p.setViewportBounds({ width: 1920, height: 1080 });
    p.setCurrentObservationId(1);
    p.setLastSemanticTargets([target] as never);
    const r = tryParse(p, [{ name: 'left_click', arguments: { targetId: 'ddd-subject' } }]);
    expect(r.ok).toBe(true);
  });

  it('allows click when targetId has no matching semantic target (x/y fallback)', () => {
    // If targetId doesn't resolve, the parser falls back to x/y. The
    // container check only applies to resolved targets — an unknown
    // targetId with x/y supplied should still work.
    const r = tryParse(makeContainerParser(), [
      {
        name: 'left_click',
        arguments: {
          targetId: 'unknown',
          x: 100,
          y: 100,
          viewportWidth: 1920,
          viewportHeight: 1080,
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(100);
      expect(r.action.coordinates.y).toBe(100);
    }
  });
});
