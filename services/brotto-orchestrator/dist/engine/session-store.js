import { SessionEngineError } from './types.js';
function clone(value) {
    return structuredClone(value);
}
function assertJsonValue(value, path = '$', ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (typeof value !== 'object') {
        throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
    }
    if (ancestors.has(value)) {
        throw new TypeError(`Canonical session must contain only JSON values: cycle at ${path}`);
    }
    const nextAncestors = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
        for (const key of Reflect.ownKeys(value)) {
            if (key === 'length')
                continue;
            const index = typeof key === 'string' ? Number(key) : Number.NaN;
            if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
                throw new TypeError(`Canonical session must contain only JSON values: ${path}`);
            }
        }
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
                throw new TypeError(`Canonical session must contain only JSON values: ${path}[${index}]`);
            }
            assertJsonValue(value[index], `${path}[${index}]`, nextAncestors);
        }
        return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (Object.prototype.toString.call(value) !== '[object Object]' ||
        (prototype !== null && prototype.constructor?.name !== 'Object')) {
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
export class InMemorySessionStore {
    sessions = new Map();
    processed = new Map();
    connectionFences = new Map();
    clientSequences = new Map();
    inbound = new Map();
    async claimConnectionFence(sessionId, fence) {
        const current = this.connectionFences.get(sessionId) ?? 0;
        if (fence < current)
            return false;
        this.connectionFences.set(sessionId, fence);
        return true;
    }
    async admitInbound(input) {
        const existing = this.inbound.get(input.messageId);
        if (existing !== undefined)
            return existing.sessionId === input.sessionId && existing.sequence === input.sequence ? 'resume' : 'duplicate';
        if (this.processed.has(input.messageId))
            return 'completed';
        const sessionId = input.sessionId;
        const sequence = input.sequence;
        const current = this.clientSequences.get(sessionId);
        if (current === undefined) {
            this.clientSequences.set(sessionId, sequence);
            this.inbound.set(input.messageId, { sessionId, sequence, event: clone(input.event) });
            return 'accepted';
        }
        if (sequence <= current)
            return 'duplicate';
        if (sequence !== current + 1)
            return 'gap';
        this.clientSequences.set(sessionId, sequence);
        this.inbound.set(input.messageId, { sessionId, sequence, event: clone(input.event) });
        return 'accepted';
    }
    async loadInbound(messageId) {
        const stored = this.inbound.get(messageId);
        return stored === undefined ? null : clone(stored.event);
    }
    async load(sessionId) {
        const session = this.sessions.get(sessionId);
        return session === undefined ? null : clone(session);
    }
    async compareAndSwap(session, expectedRevision, expectedConnectionFence) {
        await this.transition(session, expectedRevision, undefined, expectedConnectionFence);
    }
    async transition(session, expectedRevision, outcome, expectedConnectionFence) {
        if (expectedConnectionFence !== undefined && this.connectionFences.get(session.sessionId) !== expectedConnectionFence) {
            throw new SessionEngineError('STALE_CONNECTION_FENCE', 'Connection fence changed before durable transition');
        }
        assertJsonValue(session);
        if (outcome !== undefined) {
            assertJsonValue(outcome);
            if (outcome.sessionId !== session.sessionId ||
                outcome.revision !== session.revision ||
                outcome.state !== session.state) {
                throw new TypeError('Atomic outcome must match the canonical session revision');
            }
        }
        const current = this.sessions.get(session.sessionId);
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== expectedRevision || session.revision !== expectedRevision + 1) {
            throw new SessionEngineError('STORE_CONFLICT', `Expected revision ${expectedRevision}, found ${currentRevision}`);
        }
        const stored = clone(session);
        this.sessions.set(session.sessionId, stored);
        for (const [messageId, outcome] of Object.entries(stored.processedMessages)) {
            this.processed.set(messageId, clone(outcome));
        }
        if (outcome !== undefined)
            this.processed.set(outcome.messageId, clone(outcome));
        if (outcome !== undefined)
            this.inbound.delete(outcome.messageId);
    }
    async getProcessed(messageId) {
        const outcome = this.processed.get(messageId);
        return outcome === undefined ? null : clone(outcome);
    }
}
//# sourceMappingURL=session-store.js.map