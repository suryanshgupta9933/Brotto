/**
 * Isolated test for Fix #1: bbox fidelity check in parser path.
 *
 * Mirrors verifyTargetFidelity from the extension's canonical pipeline.
 * When the model supplies BOTH targetId AND x/y, the model's x/y must
 * fall inside the resolved bbox. Otherwise the targetId is stale or the
 * model miscomputed — reject with STALE_TARGET so the planner forces a
 * re-snapshot.
 */

import { ToolCallParser, ParseErrorCode } from '../parser';
import { ActionType } from '@brotto/brotto-action-schema';

const targets = [
  {
    targetId: 'aaaa-target',
    stableRef: 'aaaa1111aaaa1111',
    boundingBox: { x: 100, y: 100, width: 200, height: 50 },
    visible: true,
  },
  {
    targetId: 'bbbb-target',
    stableRef: 'bbbb2222bbbb2222',
    boundingBox: { x: 500, y: 500, width: 100, height: 30 },
    visible: true,
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

describe('bbox fidelity (Fix #1)', () => {
  it('accepts targetId + matching x/y inside bbox', () => {
    // Target aaaa bbox is (100,100,200,50) → center (200, 125). (180,120) is inside.
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { targetId: 'aaaa-target', x: 180, y: 120, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(200); // bbox center, not model's 180
      expect(r.action.coordinates.y).toBe(125);
    }
  });

  it('rejects targetId + x/y that fall OUTSIDE bbox (stale target)', () => {
    // Target aaaa bbox is (100,100,200,50) → x must be 100..300, y 100..150.
    // Model passes (700, 700) which is inside bbbb bbox but not aaaa.
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { targetId: 'aaaa-target', x: 700, y: 700, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
      // Error message should mention the bbox and the model's coords so the
      // corrective tells the model exactly what went wrong.
      expect(r.thrown.error).toContain('aaaa-target');
      expect(r.thrown.error).toContain('(700, 700)');
    }
  });

  it('rejects x slightly outside bbox left edge', () => {
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { targetId: 'aaaa-target', x: 99, y: 120, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
  });

  it('rejects x slightly outside bbox right edge', () => {
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { targetId: 'aaaa-target', x: 301, y: 120, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
  });

  it('allows targetId alone without x/y (bbox center is always inside)', () => {
    const r = tryParse(makeParser(), [
      { name: 'left_click', arguments: { targetId: 'aaaa-target' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(200);
      expect(r.action.coordinates.y).toBe(125);
    }
  });

  it('allows x/y alone without targetId (canvas / fallback path)', () => {
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { x: 50, y: 60, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(50);
      expect(r.action.coordinates.y).toBe(60);
    }
  });

  it('rejects stale targetId when model passes matching coords from a NEW bbox', () => {
    // The actual fidelity scenario: model has stale targetId from previous
    // snapshot but fresh coords from a re-rendered page that now shows the
    // element at different position.
    const r = tryParse(makeParser(), [
      {
        name: 'left_click',
        arguments: { targetId: 'aaaa-target', x: 550, y: 520, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
  });

  it('applies to right_click and double_click too', () => {
    for (const name of ['right_click', 'double_click']) {
      const r = tryParse(makeParser(), [
        {
          name,
          arguments: { targetId: 'bbbb-target', x: 999, y: 999, viewportWidth: 1920, viewportHeight: 1080 },
        },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.thrown.code).toBe(ParseErrorCode.STALE_TARGET);
    }
  });
});
