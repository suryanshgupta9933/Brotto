import {
  ActionResultV1Schema,
  assertNoForbiddenBrowserData,
  ForbiddenBrowserDataError,
  ObservationV1Schema,
} from '../v1';

const validObservation = {
  observationId: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-08-03T10:00:00.000Z',
  url: 'https://example.com',
  title: 'Example',
  screenshot: {
    kind: 'artifact',
    artifactId: '77777777-7777-4777-8777-777777777777',
    sha256: 'b'.repeat(64),
    width: 1280,
    height: 720,
    encoding: 'png',
  },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  page: {
    tabId: '22222222-2222-4222-8222-222222222222',
    frameId: '33333333-3333-4333-8333-333333333333',
    lifecycle: 'complete',
    visibility: 'visible',
  },
  semanticTargets: [],
};

const validResult = {
  actionId: '55555555-5555-4555-8555-555555555555',
  stepId: '66666666-6666-4666-8666-666666666666',
  observationId: validObservation.observationId,
  sequence: 2,
  status: 'succeeded',
  startedAt: '2026-08-03T10:00:01.000Z',
  completedAt: '2026-08-03T10:00:02.000Z',
  durationMs: 1000,
  postObservation: validObservation,
};

describe('v1 forbidden browser-data defense', () => {
  it('rejects forbidden browser state and unknown keys', () => {
    expect(() => ObservationV1Schema.parse({ ...validObservation, cookies: [] })).toThrow();
    expect(() => ObservationV1Schema.parse({ ...validObservation, localStorage: {} })).toThrow();
    expect(() => ActionResultV1Schema.parse({ ...validResult, authorization: 'Bearer secret' })).toThrow();
  });

  it('rejects forbidden keys nested in arrays after punctuation and case normalization', () => {
    expect(() => assertNoForbiddenBrowserData({
      safe: [{ 'Proxy Authorization': 'secret' }],
    })).toThrow(ForbiddenBrowserDataError);
  });

  it('rejects password-field attributes and sensitive locator content', () => {
    const sensitiveTarget = {
      targetId: '44444444-4444-4444-8444-444444444444',
      tag: 'input',
      role: 'textbox',
      attributes: { type: 'password', value: 'secret' },
      boundingBox: { x: 12, y: 24, width: 80, height: 32 },
      visible: true,
      framePath: [],
      locatorCandidates: ['input[type="password"][value="secret"]'],
    };

    expect(() => ObservationV1Schema.parse({
      ...validObservation,
      semanticTargets: [sensitiveTarget],
    })).toThrow();

    expect(() => ObservationV1Schema.parse({
      ...validObservation,
      semanticTargets: [{
        ...sensitiveTarget,
        attributes: { 'aria-label': 'Sign in' },
        locatorCandidates: ['input[data-token="secret"]'],
      }],
    })).toThrow();
  });

  it('accepts sanitized serialized data', () => {
    expect(() => assertNoForbiddenBrowserData(validResult)).not.toThrow();
  });
});
