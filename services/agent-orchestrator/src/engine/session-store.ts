import type { MessageId, SessionId } from '@fara-platform/fara-action-schema';
import type { CanonicalSession, SessionStore, StoredOutcome } from './types.js';
import { SessionEngineError } from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertJsonValue(value: unknown, path = '$', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`Canonical session must contain only JSON values: cycle at ${path}`);
  }
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.keys(value).length !== value.length
    ) {
      throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`Canonical session must contain only JSON values: ${path}[${index}]`);
      }
      assertJsonValue(value[index], `${path}[${index}]`, nextAncestors);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  if (
    Object.prototype.toString.call(value) !== '[object Object]' ||
    (prototype !== null && prototype.constructor?.name !== 'Object')
  ) {
    throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable) {
      throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
    }
  }
  for (const [key, nested] of Object.entries(value)) {
    assertJsonValue(nested, `${path}.${key}`, nextAncestors);
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
    await this.transition(session, expectedRevision);
  }

  async transition(
    session: CanonicalSession,
    expectedRevision: number,
    outcome?: StoredOutcome,
  ): Promise<void> {
    assertJsonValue(session);
    if (outcome !== undefined) {
      assertJsonValue(outcome);
      if (
        outcome.sessionId !== session.sessionId ||
        outcome.revision !== session.revision ||
        outcome.state !== session.state
      ) {
        throw new TypeError('Atomic outcome must match the canonical session revision');
      }
    }
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
    if (outcome !== undefined) this.processed.set(outcome.messageId, clone(outcome));
  }

  async getProcessed(messageId: MessageId): Promise<StoredOutcome | null> {
    const outcome = this.processed.get(messageId);
    return outcome === undefined ? null : clone(outcome);
  }
}
