import { ObservationV1Schema, AccessibilityNodeSchema } from '@fara-platform/fara-action-schema';

const VALID_HASH = 'a'.repeat(64);
const VALID_HASH_B = 'b'.repeat(64);

const node = {
  axNodeId: '1',
  role: 'button',
  name: 'Submit',
  axPath: [{ role: 'Document', index: 0 }, { role: 'button', index: 0, name: 'Submit' }],
  attributeHash: VALID_HASH,
  bounds: { x: 0, y: 0, width: 100, height: 30 },
};

const baseObs = {
  observationId: '00000000-0000-4000-8000-000000000001',
  capturedAt: '2026-08-06T00:00:00.000Z',
  url: 'https://example.test',
  title: 'Test page',
  page: { tabId: '11111111-1111-4111-8111-111111111111', frameId: '22222222-2222-4222-8222-222222222222', lifecycle: 'complete', visibility: 'visible' },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  screenshot: { kind: 'inline', encoding: 'base64', data: 'a', sha256: VALID_HASH, width: 1, height: 1 },
  semanticTargets: [],
};

describe('AX wire format contract', () => {
  it('AccessibilityNodeSchema parses canonical shape', () => {
    expect(() => AccessibilityNodeSchema.parse(node)).not.toThrow();
  });

  it('AccessibilityNodeSchema requires axPath', () => {
    const { axPath, ...withoutPath } = node;
    expect(() => AccessibilityNodeSchema.parse(withoutPath)).toThrow();
  });

  it('AccessibilityNodeSchema requires SHA256 attributeHash', () => {
    expect(() => AccessibilityNodeSchema.parse({ ...node, attributeHash: 'short' })).toThrow();
  });

  it('AccessibilityNodeSchema accepts node without optional fields', () => {
    const minimal = {
      axNodeId: '1',
      role: 'button',
      axPath: [],
      attributeHash: VALID_HASH,
    };
    expect(() => AccessibilityNodeSchema.parse(minimal)).not.toThrow();
  });

  it('ObservationV1Schema accepts accessibilityNodes array', () => {
    const obs = { ...baseObs, accessibilityNodes: [node] };
    expect(() => ObservationV1Schema.parse(obs)).not.toThrow();
  });

  it('ObservationV1Schema without accessibilityNodes still validates (backward compat)', () => {
    expect(() => ObservationV1Schema.parse(baseObs)).not.toThrow();
  });

  it('ObservationV1Schema rejects non-SHA256 hash in accessibilityNodes', () => {
    const obs = { ...baseObs, accessibilityNodes: [{ ...node, attributeHash: 'bad' }] };
    expect(() => ObservationV1Schema.parse(obs)).toThrow();
  });
});
