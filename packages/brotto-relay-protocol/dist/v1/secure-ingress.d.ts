import { type AgentEnvelopeV1, type EnvelopeSigner } from './envelope.js';
import { AgentFlowGuard } from './flow-guard.js';
import type { AgentMessageV1 } from './messages.js';
import type { ObservationV1 } from '@brotto/brotto-action-schema';
export interface SecureAgentIngressOptions {
    now: () => number;
    maxBytes: number;
    expectedRecipientId: string;
    verifier: EnvelopeSigner;
}
export type SecureAgentIngressResult = {
    status: 'accepted';
    envelope: AgentEnvelopeV1;
    message: AgentMessageV1;
} | {
    status: 'duplicate';
    messageId: string;
} | {
    status: 'rejected';
    code: 'ACTION_FLOW_INVALID' | 'INVALID_ENVELOPE' | 'INVALID_WIRE' | 'MESSAGE_DIRECTION_INVALID' | 'MESSAGE_EXPIRED' | 'MESSAGE_TOO_LARGE' | 'RECIPIENT_MISMATCH' | 'SEQUENCE_REPLAY' | 'SIGNATURE_INVALID' | 'SIGNATURE_REQUIRED';
};
/**
 * Mandatory secure ingress for raw application wire data.
 * It is the only public API that composes byte limits, authentication, replay
 * protection, and stateful action-flow validation before yielding a message.
 */
export declare class SecureAgentIngress {
    private readonly options;
    private readonly protocolGuard;
    private readonly flowGuard;
    constructor(options: SecureAgentIngressOptions);
    accept(rawWire: string | Uint8Array): Promise<SecureAgentIngressResult>;
    /** Register an already authenticated server emission as flow authority. */
    registerOutbound(envelope: AgentEnvelopeV1): ReturnType<AgentFlowGuard['accept']>;
    restoreObservation(sessionId: string, observation: ObservationV1): void;
    private protocolResult;
}
//# sourceMappingURL=secure-ingress.d.ts.map