import type { CanonicalSession, StoredOutcome } from '../engine/types.js';
import { InMemorySessionStore } from '../engine/session-store.js';

const sessionId = '20000000-0000-4000-8000-000000000001';
const taskId = '20000000-0000-4000-8000-000000000002';
const messageId = '20000000-0000-4000-8000-000000000003';

function session(revision: number, outcome?: StoredOutcome): CanonicalSession {
  return {
    sessionId,
    taskId,
    goal: 'Test CAS',
    completionCriteria: [],
    state: 'OBSERVING',
    revision,
    nextSequence: 0,
    eventSequence: 0,
    startedAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    lastObservation: null,
    activeInferenceId: null,
    activeAction: null,
    pendingPolicy: null,
    pendingApproval: null,
    recentResults: [],
    processedMessages: outcome === undefined ? {} : { [messageId]: outcome },
    completedActions: {},
    actionSignatures: [],
    observationSignatures: [],
    consecutiveActionFailures: 0,
    consecutiveNoVerifiedEffect: 0,
    inferenceRepairAttempts: 0,
    stepCount: 0,
    terminalReason: null,
  } as CanonicalSession;
}

describe('InMemorySessionStore', () => {
  it('is available to canonical engine tests', () => {
    expect(new InMemorySessionStore()).toBeDefined();
  });

  it('rejects stale compare-and-swap revisions without overwriting state', async () => {
    const store = new InMemorySessionStore();
    await store.compareAndSwap(session(1), 0);

    await expect(store.compareAndSwap(session(2), 0)).rejects.toMatchObject({
      code: 'STORE_CONFLICT',
    });

    expect((await store.load(sessionId as never))?.revision).toBe(1);
  });

  it('atomically indexes a processed-message outcome with the session revision', async () => {
    const store = new InMemorySessionStore();
    const outcome: StoredOutcome = {
      kind: 'accepted',
      sessionId,
      messageId,
      revision: 1,
      state: 'OBSERVING',
      pendingActionIds: [],
    } as StoredOutcome;

    await store.transition(session(1, outcome), 0, outcome);

    expect(await store.getProcessed(messageId as never)).toEqual(outcome);
  });

  it('rejects an atomic outcome that does not describe the same session revision', async () => {
    const store = new InMemorySessionStore();
    const outcome = {
      kind: 'accepted',
      sessionId,
      messageId,
      revision: 2,
      state: 'OBSERVING',
      pendingActionIds: [],
    } as StoredOutcome;

    await expect(store.transition(session(1), 0, outcome)).rejects.toThrow(
      'Atomic outcome must match the canonical session revision',
    );
    expect(await store.load(sessionId as never)).toBeNull();
  });

  it('returns isolated serializable snapshots', async () => {
    const store = new InMemorySessionStore();
    const original = session(1);
    await store.compareAndSwap(original, 0);
    original.goal = 'Mutated outside store';
    const loaded = await store.load(sessionId as never);
    loaded!.goal = 'Mutated loaded copy';

    expect((await store.load(sessionId as never))?.goal).toBe('Test CAS');
    expect(JSON.parse(JSON.stringify(await store.load(sessionId as never)))).toEqual(
      await store.load(sessionId as never),
    );
  });

  it.each([
    ['undefined', undefined],
    ['function', () => 'not JSON'],
    ['symbol', Symbol('not JSON')],
    ['non-finite number', Number.NaN],
  ])('rejects %s anywhere in canonical session state', async (_label, invalidValue) => {
    const store = new InMemorySessionStore();
    const invalid = session(1) as unknown as Record<string, unknown>;
    invalid.invalid = invalidValue;

    await expect(store.compareAndSwap(invalid as unknown as CanonicalSession, 0)).rejects.toThrow(
      'Canonical session must contain only JSON values',
    );
    expect(await store.load(sessionId as never)).toBeNull();
  });
});
