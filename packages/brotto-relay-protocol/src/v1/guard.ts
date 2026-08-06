import { AgentEnvelopeV1Schema, type AgentEnvelopeV1 } from './envelope.js';

export type ProtocolGuardResult =
  | { status: 'accepted'; envelope: AgentEnvelopeV1 }
  | { status: 'duplicate'; messageId: string }
  | { status: 'rejected'; code: 'INVALID_ENVELOPE' | 'MESSAGE_EXPIRED' | 'MESSAGE_TOO_LARGE' | 'RECIPIENT_MISMATCH' | 'SEQUENCE_REPLAY' };

export interface ProtocolGuardOptions {
  now: () => number;
  maxBytes: number;
  expectedRecipientId: string;
}

/** Internal admission component. Use SecureAgentIngress for raw inbound wire data. */
export class ProtocolGuard {
  private readonly receivedMessageIds = new Set<string>();
  private readonly lastSequences = new Map<string, number>();

  constructor(private readonly options: ProtocolGuardOptions) {
    if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive finite number');
    }
  }

  accept(input: unknown): ProtocolGuardResult {
    if (isRecord(input) && input.recipientId !== this.options.expectedRecipientId) {
      return { status: 'rejected', code: 'RECIPIENT_MISMATCH' };
    }
    const parsed = AgentEnvelopeV1Schema.safeParse(input);
    if (!parsed.success) return { status: 'rejected', code: 'INVALID_ENVELOPE' };

    const envelope = parsed.data;
    if (envelope.expiresAt <= this.options.now()) return { status: 'rejected', code: 'MESSAGE_EXPIRED' };
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > this.options.maxBytes) {
      return { status: 'rejected', code: 'MESSAGE_TOO_LARGE' };
    }
    if (this.receivedMessageIds.has(envelope.messageId)) {
      return { status: 'duplicate', messageId: envelope.messageId };
    }
    const lastSequence = this.lastSequences.get(envelope.sessionId);
    if (lastSequence !== undefined && envelope.sequence <= lastSequence) {
      return { status: 'rejected', code: 'SEQUENCE_REPLAY' };
    }

    this.receivedMessageIds.add(envelope.messageId);
    this.lastSequences.set(envelope.sessionId, envelope.sequence);
    return { status: 'accepted', envelope };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
