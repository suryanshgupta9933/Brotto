import type { MessageId, SessionId } from '@brotto/brotto-action-schema';
import type { CanonicalSession, SessionEngineEvent, SessionStore, StoredOutcome } from './types.js';
export declare class InMemorySessionStore implements SessionStore {
    private readonly sessions;
    private readonly processed;
    private readonly connectionFences;
    private readonly clientSequences;
    private readonly inbound;
    claimConnectionFence(sessionId: SessionId, fence: number): Promise<boolean>;
    admitInbound(input: {
        sessionId: SessionId;
        messageId: MessageId;
        sequence: number;
        event: SessionEngineEvent;
    }): Promise<'accepted' | 'resume' | 'completed' | 'duplicate' | 'gap'>;
    loadInbound(messageId: MessageId): Promise<SessionEngineEvent | null>;
    load(sessionId: SessionId): Promise<CanonicalSession | null>;
    compareAndSwap(session: CanonicalSession, expectedRevision: number, expectedConnectionFence?: number): Promise<void>;
    transition(session: CanonicalSession, expectedRevision: number, outcome?: StoredOutcome, expectedConnectionFence?: number): Promise<void>;
    getProcessed(messageId: MessageId): Promise<StoredOutcome | null>;
}
//# sourceMappingURL=session-store.d.ts.map