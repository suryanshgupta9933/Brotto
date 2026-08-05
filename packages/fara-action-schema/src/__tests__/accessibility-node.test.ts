import { AccessibilityNodeSchema, ObservationV1Schema } from '../v1/observation';

describe('AccessibilityNodeSchema', () => {
  it('parses a minimal node', () => {
    const node = AccessibilityNodeSchema.parse({
      axNodeId: '1',
      role: 'button',
      axPath: [{ role: 'Document', index: 0 }],
      attributeHash: 'abc123',
    });
    expect(node.role).toBe('button');
  });

  it('rejects missing axPath', () => {
    expect(() => AccessibilityNodeSchema.parse({ axNodeId: '1', role: 'button', attributeHash: 'x' }))
      .toThrow();
  });
});

describe('ObservationV1Schema with accessibilityNodes', () => {
  const baseObs = {
    observationId: '00000000-0000-4000-8000-000000000001',
    capturedAt: '2026-08-06T00:00:00.000Z',
    url: 'https://example.test',
    title: 't',
    page: { tabId: '11111111-1111-4111-8111-111111111111', frameId: '22222222-2222-4222-8222-222222222222', lifecycle: 'complete', visibility: 'visible' },
    viewport: { width: 1, height: 1, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    screenshot: { kind: 'inline', encoding: 'base64', data: 'a', sha256: 'a'.repeat(64), width: 1, height: 1 },
    semanticTargets: [],
  };

  it('parses without accessibilityNodes (backward compat)', () => {
    expect(() => ObservationV1Schema.parse(baseObs)).not.toThrow();
  });

  it('parses with accessibilityNodes', () => {
    const obs = { ...baseObs, accessibilityNodes: [{ axNodeId: '1', role: 'button', axPath: [], attributeHash: 'x' }] };
    expect(() => ObservationV1Schema.parse(obs)).not.toThrow();
  });
});
