/**
 * Isolated test for parser click-action error messages.
 *
 * The parser's previous logic called numberArg(args.x) before reaching
 * the more specific "targetId not found" error, so the model saw the
 * generic "Missing or invalid required field: x" instead of a useful
 * corrective. After fix: when targetId is provided but doesn't resolve
 * AND x/y is missing, return a specific "targetId not in INTERACTIVE
 * ELEMENTS" error so the model retries with x/y or a fresh targetId.
 */

import { ToolCallParser, ParseErrorCode } from '../parser';
import { ActionType } from '@brotto/brotto-action-schema';

function makeParser(targets: ReadonlyArray<{
  targetId: string;
  stableRef?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}> = []) {
  const p = new ToolCallParser();
  p.setViewportBounds({ width: 1920, height: 1080 });
  p.setCurrentObservationId(1);
  p.setLastSemanticTargets(targets);
  return p;
}

interface ThrownParseError {
  code: string;
  error: string;
  toolCall: { name: string; arguments: Record<string, unknown> };
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

describe("click action error messages", () => {
  it("targetId provided, doesn't resolve, no x/y → specific 'targetId not in INTERACTIVE ELEMENTS' error", () => {
    const r = tryParse(makeParser([]), [
      { name: 'left_click', arguments: { targetId: 'cf4ee68dcf4ee68d' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.thrown.code).toBe(ParseErrorCode.MISSING_REQUIRED_FIELD);
      // The message must tell the model what to do next: pass x/y or pick
      // a different targetId. Generic "missing field: x" is the bug.
      expect(r.thrown.error).toContain("cf4ee68dcf4ee68d");
      expect(r.thrown.error).toContain("INTERACTIVE ELEMENTS");
      expect(r.thrown.error).toContain("x/y coordinates");
      expect(r.thrown.error).not.toMatch(/missing or invalid required field: x/i);
    }
  });

  it("targetId provided, doesn't resolve, no x/y → error for right_click too", () => {
    const r = tryParse(makeParser([]), [
      { name: 'right_click', arguments: { targetId: 'abc12345abc12345' } },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.thrown.code).toBe(ParseErrorCode.MISSING_REQUIRED_FIELD);
  });

  it("no targetId, no x/y → 'requires either targetId OR x/y' error", () => {
    const r = tryParse(makeParser([]), [
      { name: 'left_click', arguments: {} },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.thrown.code).toBe(ParseErrorCode.MISSING_REQUIRED_FIELD);
      expect(r.thrown.error).toContain("requires either targetId");
    }
  });

  it("targetId provided, doesn't resolve, x/y provided → falls back to x/y (no error)", () => {
    const r = tryParse(makeParser([]), [
      {
        name: 'left_click',
        arguments: { targetId: 'unknown_id', x: 100, y: 200, viewportWidth: 1920, viewportHeight: 1080 },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(100);
      expect(r.action.coordinates.y).toBe(200);
    }
  });

  it("targetId resolves, no x/y → uses bbox center (no error)", () => {
    const r = tryParse(makeParser([
      {
        targetId: 'good-id',
        stableRef: 'goodref',
        boundingBox: { x: 100, y: 100, width: 200, height: 50 },
      },
    ]), [
      { name: 'left_click', arguments: { targetId: 'good-id' } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.coordinates.x).toBe(200); // bbox center
      expect(r.action.coordinates.y).toBe(125);
    }
  });
});
