import type { MessageId, SessionId } from '@fara-platform/fara-action-schema';
import type { CanonicalSession, SessionStore, StoredOutcome } from './types.js';
import { SessionEngineError } from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertSerializable(value: CanonicalSession): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`Canonical session must be serializable: ${String(error)}`);
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, CanonicalSession>();
  private readonly processed = new Map<string, StoredOutcome>();

  async load(sessionId: SessionId): Promise<CanonicalSession | null> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : clone(session);
  }

  async compareAndSwap(session: CanonicalSession, expectedRevision: number): Promise<void> {
    assertSerializable(session);
    const current = this.sessions.get(session.sessionId);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision || session.revision !== expectedRevision + 1) {
      throw new SessionEngineError(
        'STORE_CONFLICT',
        `Expected revision ${expectedRevision}, found ${currentRevision}`,
      );
    }

    const stored = clone(session);
    this.sessions.set(session.sessionId, stored);
    for (const [messageId, outcome] of Object.entries(stored.processedMessages)) {
      this.processed.set(messageId, clone(outcome));
    }
  }

  async getProcessed(messageId: MessageId): Promise<StoredOutcome | null> {
    const outcome = this.processed.get(messageId);
    return outcome === undefined ? null : clone(outcome);
  }
}
