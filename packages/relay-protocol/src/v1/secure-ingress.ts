import {
  AgentEnvelopeV1Schema,
  canonicalEnvelopeBytes,
  type AgentEnvelopeV1,
  type EnvelopeSigner,
} from './envelope.js';
import { AgentFlowGuard } from './flow-guard.js';
import { ProtocolGuard, type ProtocolGuardResult } from './guard.js';
import type { AgentMessageV1 } from './messages.js';
import type { ObservationV1 } from '@fara-platform/fara-action-schema';

export interface SecureAgentIngressOptions {
  now: () => number;
  maxBytes: number;
  expectedRecipientId: string;
  verifier: EnvelopeSigner;
}

export type SecureAgentIngressResult =
  | { status: 'accepted'; envelope: AgentEnvelopeV1; message: AgentMessageV1 }
  | { status: 'duplicate'; messageId: string }
  | { status: 'rejected'; code: 'ACTION_FLOW_INVALID' | 'INVALID_ENVELOPE' | 'INVALID_WIRE' | 'MESSAGE_DIRECTION_INVALID' | 'MESSAGE_EXPIRED' | 'MESSAGE_TOO_LARGE' | 'RECIPIENT_MISMATCH' | 'SEQUENCE_REPLAY' | 'SIGNATURE_INVALID' | 'SIGNATURE_REQUIRED' };

/**
 * Mandatory secure ingress for raw application wire data.
 * It is the only public API that composes byte limits, authentication, replay
 * protection, and stateful action-flow validation before yielding a message.
 */
export class SecureAgentIngress {
  private readonly protocolGuard: ProtocolGuard;
  private readonly flowGuard = new AgentFlowGuard();

  constructor(private readonly options: SecureAgentIngressOptions) {
    this.protocolGuard = new ProtocolGuard(options);
  }

  async accept(rawWire: string | Uint8Array): Promise<SecureAgentIngressResult> {
    const rawBytes = typeof rawWire === 'string'
      ? new TextEncoder().encode(rawWire)
      : rawWire;
    if (rawBytes.byteLength > this.options.maxBytes) {
      return { status: 'rejected', code: 'MESSAGE_TOO_LARGE' };
    }

    let decoded: string;
    try {
      decoded = typeof rawWire === 'string'
        ? rawWire
        : new TextDecoder('utf-8', { fatal: true }).decode(rawWire);
    } catch {
      return { status: 'rejected', code: 'INVALID_WIRE' };
    }

    let parsedWire: unknown;
    try {
      parsedWire = JSON.parse(decoded);
    } catch {
      return { status: 'rejected', code: 'INVALID_WIRE' };
    }

    const parsedEnvelope = AgentEnvelopeV1Schema.safeParse(parsedWire);
    if (!parsedEnvelope.success) return { status: 'rejected', code: 'INVALID_ENVELOPE' };
    const envelope = parsedEnvelope.data;
    if (envelope.recipientId !== this.options.expectedRecipientId) {
      return { status: 'rejected', code: 'RECIPIENT_MISMATCH' };
    }
    if (envelope.signature === undefined) return { status: 'rejected', code: 'SIGNATURE_REQUIRED' };
    if (!await this.options.verifier.verify(canonicalEnvelopeBytes(envelope), envelope.signature)) {
      return { status: 'rejected', code: 'SIGNATURE_INVALID' };
    }

    const admitted = this.protocolGuard.accept(envelope);
    if (admitted.status !== 'accepted') return this.protocolResult(admitted);

    if (isServerOriginMessage(admitted.envelope.payload.type)) {
      return { status: 'rejected', code: 'MESSAGE_DIRECTION_INVALID' };
    }

    const flowed = this.flowGuard.accept(admitted.envelope);
    if (flowed.status !== 'accepted') return flowed;
    return { status: 'accepted', envelope: admitted.envelope, message: admitted.envelope.payload };
  }

  /** Register an already authenticated server emission as flow authority. */
  registerOutbound(envelope: AgentEnvelopeV1): ReturnType<AgentFlowGuard['accept']> {
    // Cancellation is intentionally bidirectional: the client can request it,
    // and the server must durably confirm the authoritative terminal state.
    if (!isServerOriginMessage(envelope.payload.type) && envelope.payload.type !== 'task.cancelled') {
      return { status: 'rejected', code: 'ACTION_FLOW_INVALID' };
    }
    return this.flowGuard.accept(envelope);
  }

  restoreObservation(sessionId: string, observation: ObservationV1): void {
    this.flowGuard.restoreObservation(sessionId, observation);
  }

  private protocolResult(result: Exclude<ProtocolGuardResult, { status: 'accepted'; envelope: AgentEnvelopeV1 }>): SecureAgentIngressResult {
    return result;
  }
}

function isServerOriginMessage(type: AgentMessageV1['type']): boolean {
  return type === 'session.accepted' || type === 'action.command' || type === 'approval.requested' ||
    type === 'task.completed' || type === 'task.failed' || type === 'reconcile.response' || type === 'protocol.error';
}
