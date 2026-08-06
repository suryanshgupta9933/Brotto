import { z } from 'zod';
import {
  assertNoForbiddenBrowserData,
  MessageIdSchema,
  SequenceSchema,
  SessionIdSchema,
} from '@brotto/brotto-action-schema';
import { AgentMessageV1Schema, type AgentMessageV1 } from './messages.js';

const UuidSchema = z.string().uuid();
const ExpirySchema = z.number().int().nonnegative();

export const AgentEnvelopeV1Schema = z.object({
  protocolVersion: z.literal('1.0'),
  messageId: MessageIdSchema,
  sessionId: SessionIdSchema,
  correlationId: UuidSchema,
  causationId: UuidSchema,
  recipientId: UuidSchema,
  tenantId: z.string().min(1).max(256).optional(),
  deviceId: z.string().min(1).max(256).optional(),
  sequence: SequenceSchema,
  createdAt: z.string().datetime(),
  expiresAt: ExpirySchema,
  payload: AgentMessageV1Schema,
  signature: z.string().min(1).max(16_384).optional(),
}).strict().superRefine((envelope, context) => {
  if (envelope.expiresAt <= Date.parse(envelope.createdAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiresAt must be after createdAt' });
  }
  try {
    assertNoForbiddenBrowserData(envelope);
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Forbidden browser data' });
  }
});

export type AgentEnvelopeV1 = z.infer<typeof AgentEnvelopeV1Schema>;
export interface EnvelopeSigner {
  sign(canonicalBytes: Uint8Array): Promise<string>;
  verify(canonicalBytes: Uint8Array, signature: string): Promise<boolean>;
}

export interface CreateEnvelopeInput {
  messageId: string;
  sessionId: string;
  correlationId: string;
  causationId: string;
  recipientId: string;
  tenantId?: string;
  deviceId?: string;
  sequence: number;
  createdAt: string;
  expiresAt: number;
  payload: AgentMessageV1;
}

export function createEnvelope(input: CreateEnvelopeInput): AgentEnvelopeV1 {
  return AgentEnvelopeV1Schema.parse({ protocolVersion: '1.0', ...input });
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError('Canonical JSON only supports JSON values');
}

/** UTF-8 bytes for deterministic signing. The signature itself is not signed. */
export function canonicalEnvelopeBytes(envelope: AgentEnvelopeV1): Uint8Array {
  const { signature: _signature, ...unsignedEnvelope } = AgentEnvelopeV1Schema.parse(envelope);
  return new TextEncoder().encode(canonicalJson(unsignedEnvelope));
}

export async function signEnvelope(envelope: AgentEnvelopeV1, signer: EnvelopeSigner): Promise<AgentEnvelopeV1> {
  const parsed = AgentEnvelopeV1Schema.parse(envelope);
  const signature = await signer.sign(canonicalEnvelopeBytes(parsed));
  return AgentEnvelopeV1Schema.parse({ ...parsed, signature });
}

export async function verifyEnvelopeSignature(envelope: AgentEnvelopeV1, signer: EnvelopeSigner): Promise<boolean> {
  const parsed = AgentEnvelopeV1Schema.parse(envelope);
  return parsed.signature === undefined ? false : signer.verify(canonicalEnvelopeBytes(parsed), parsed.signature);
}
