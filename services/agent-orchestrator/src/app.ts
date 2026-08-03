import Fastify, { type FastifyInstance } from 'fastify';
import type { EnvelopeSigner } from '@fara-platform/relay-protocol';
import { registerAgentWebSocket, type TransportEngine } from './transport/ws-server.js';
import type { ConnectionTokenVerifier } from './transport/auth.js';

export interface OrchestratorAppOptions {
  tokenVerifier: ConnectionTokenVerifier;
  envelopeVerifier: EnvelopeSigner;
  engine: TransportEngine;
  recipientId: string;
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
}

export async function createOrchestratorApp(options: OrchestratorAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  app.get('/healthz', async () => ({ status: 'ok' }));
  await registerAgentWebSocket(app, options);
  return app;
}
