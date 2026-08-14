export type AgentMessageV1 = Record<string, any>;
export type ExtensionMessageV1 = Record<string, any>;
export type SessionMetadata = Record<string, any>;
export type AgentEnvelopeV1 = Record<string, any>;
export type ActionCommandMessageSchema = Record<string, any>;
export type EnvelopeSigner = Record<string, any>;

export const AgentMessageV1Schema = {};
export const ExtensionMessageV1Schema = {};
export const SessionMetadataSchema = {};
export const AgentEnvelopeV1Schema = {};
export const ActionCommandMessageSchema = {};

export function canonicalEnvelopeBytes(data: any): Uint8Array {
  return new Uint8Array();
}

export function createEnvelope(data: any): AgentEnvelopeV1 {
  return {};
}

export function signEnvelope(envelope: any, signer: any): any {
  return envelope;
}
