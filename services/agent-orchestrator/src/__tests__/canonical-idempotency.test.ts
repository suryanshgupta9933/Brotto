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
    startedAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    lastObservation: null,
    activeInferenceId: null,
    activeAction: null,
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

    await store.compareAndSwap(session(1, outcome), 0);

    expect(await store.getProcessed(messageId as never)).toEqual(outcome);
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
});
