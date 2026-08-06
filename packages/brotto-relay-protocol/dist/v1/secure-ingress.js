import { AgentEnvelopeV1Schema, canonicalEnvelopeBytes, } from './envelope.js';
import { AgentFlowGuard } from './flow-guard.js';
import { ProtocolGuard } from './guard.js';
/**
 * Mandatory secure ingress for raw application wire data.
 * It is the only public API that composes byte limits, authentication, replay
 * protection, and stateful action-flow validation before yielding a message.
 */
export class SecureAgentIngress {
    options;
    protocolGuard;
    flowGuard = new AgentFlowGuard();
    constructor(options) {
        this.options = options;
        this.protocolGuard = new ProtocolGuard(options);
    }
    async accept(rawWire) {
        const rawBytes = typeof rawWire === 'string'
            ? new TextEncoder().encode(rawWire)
            : rawWire;
        if (rawBytes.byteLength > this.options.maxBytes) {
            return { status: 'rejected', code: 'MESSAGE_TOO_LARGE' };
        }
        let decoded;
        try {
            decoded = typeof rawWire === 'string'
                ? rawWire
                : new TextDecoder('utf-8', { fatal: true }).decode(rawWire);
        }
        catch {
            return { status: 'rejected', code: 'INVALID_WIRE' };
        }
        let parsedWire;
        try {
            parsedWire = JSON.parse(decoded);
        }
        catch {
            return { status: 'rejected', code: 'INVALID_WIRE' };
        }
        const parsedEnvelope = AgentEnvelopeV1Schema.safeParse(parsedWire);
        if (!parsedEnvelope.success)
            return { status: 'rejected', code: 'INVALID_ENVELOPE' };
        const envelope = parsedEnvelope.data;
        if (envelope.recipientId !== this.options.expectedRecipientId) {
            return { status: 'rejected', code: 'RECIPIENT_MISMATCH' };
        }
        if (envelope.signature === undefined)
            return { status: 'rejected', code: 'SIGNATURE_REQUIRED' };
        if (!await this.options.verifier.verify(canonicalEnvelopeBytes(envelope), envelope.signature)) {
            return { status: 'rejected', code: 'SIGNATURE_INVALID' };
        }
        const admitted = this.protocolGuard.accept(envelope);
        if (admitted.status !== 'accepted')
            return this.protocolResult(admitted);
        if (isServerOriginMessage(admitted.envelope.payload.type)) {
            return { status: 'rejected', code: 'MESSAGE_DIRECTION_INVALID' };
        }
        const flowed = this.flowGuard.accept(admitted.envelope);
        if (flowed.status !== 'accepted')
            return flowed;
        return { status: 'accepted', envelope: admitted.envelope, message: admitted.envelope.payload };
    }
    /** Register an already authenticated server emission as flow authority. */
    registerOutbound(envelope) {
        // Cancellation is intentionally bidirectional: the client can request it,
        // and the server must durably confirm the authoritative terminal state.
        if (!isServerOriginMessage(envelope.payload.type) && envelope.payload.type !== 'task.cancelled') {
            return { status: 'rejected', code: 'ACTION_FLOW_INVALID' };
        }
        return this.flowGuard.accept(envelope);
    }
    restoreObservation(sessionId, observation) {
        this.flowGuard.restoreObservation(sessionId, observation);
    }
    protocolResult(result) {
        return result;
    }
}
function isServerOriginMessage(type) {
    return type === 'session.accepted' || type === 'action.command' || type === 'approval.requested' ||
        type === 'task.completed' || type === 'task.failed' || type === 'reconcile.response' || type === 'protocol.error';
}
//# sourceMappingURL=secure-ingress.js.map