import { type AgentEnvelopeV1 } from './envelope.js';
export type AgentFlowGuardResult = {
    status: 'accepted';
    envelope: AgentEnvelopeV1;
} | {
    status: 'rejected';
    code: 'INVALID_ENVELOPE' | 'ACTION_FLOW_INVALID';
};
/** Internal stateful flow component. Use SecureAgentIngress for raw inbound wire data. */
export declare class AgentFlowGuard {
    private readonly observationsBySession;
    private readonly actionsBySession;
    private readonly approvalsBySession;
    accept(input: unknown): AgentFlowGuardResult;
    restoreObservation(sessionId: string, observation: unknown): void;
    private sessionMap;
}
//# sourceMappingURL=flow-guard.d.ts.map