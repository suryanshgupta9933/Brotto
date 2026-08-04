import Fastify, { type FastifyInstance } from 'fastify';
import type { EnvelopeSigner } from '@fara-platform/relay-protocol';
import { AgentTransportHub, registerAgentWebSocket, type TransportEngine } from './transport/ws-server.js';
import type { CommandSink } from './engine/types.js';
import type { ConnectionTokenVerifier } from './transport/auth.js';
import type { ConnectionCredentialStore } from './transport/auth.js';
import type { SessionStore } from './engine/types.js';
import type { ConnectionLeaseStore } from './transport/ws-server.js';

export interface OrchestratorAppOptions {
  tokenVerifier: ConnectionTokenVerifier;
  envelopeVerifier: EnvelopeSigner;
  createEngine(commandSink: CommandSink): TransportEngine;
  store: SessionStore;
  leases: ConnectionLeaseStore;
  credentials: ConnectionCredentialStore;
  recipientId: string;
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
}

export async function createOrchestratorApp(options: OrchestratorAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  const hub = new AgentTransportHub(options.store, options.envelopeVerifier, options.now);
  const engine = options.createEngine(hub);
  app.get('/healthz', async () => ({ status: 'ok' }));
  await registerAgentWebSocket(app, { ...options, engine, hub });
  return app;
}
