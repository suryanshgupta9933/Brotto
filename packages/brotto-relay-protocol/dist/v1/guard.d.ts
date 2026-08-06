import { type AgentEnvelopeV1 } from './envelope.js';
export type ProtocolGuardResult = {
    status: 'accepted';
    envelope: AgentEnvelopeV1;
} | {
    status: 'duplicate';
    messageId: string;
} | {
    status: 'rejected';
    code: 'INVALID_ENVELOPE' | 'MESSAGE_EXPIRED' | 'MESSAGE_TOO_LARGE' | 'RECIPIENT_MISMATCH' | 'SEQUENCE_REPLAY';
};
export interface ProtocolGuardOptions {
    now: () => number;
    maxBytes: number;
    expectedRecipientId: string;
}
/** Internal admission component. Use SecureAgentIngress for raw inbound wire data. */
export declare class ProtocolGuard {
    private readonly options;
    private readonly receivedMessageIds;
    private readonly lastSequences;
    constructor(options: ProtocolGuardOptions);
    accept(input: unknown): ProtocolGuardResult;
}
//# sourceMappingURL=guard.d.ts.map