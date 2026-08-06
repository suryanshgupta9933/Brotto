import Fastify, { type FastifyInstance } from 'fastify';
import type { EnvelopeSigner } from '@brotto/relay-protocol';
import { AgentTransportHub, registerAgentWebSocket, type ConnectionEnvelopeSignerResolver, type TransportEngine } from './transport/ws-server.js';
import type { CommandSink, TerminalSink } from './engine/types.js';
import type { ConnectionTokenVerifier } from './transport/auth.js';
import type { ConnectionCredentialStore } from './transport/auth.js';
import type { SessionStore } from './engine/types.js';
import type { ConnectionLeaseStore } from './transport/ws-server.js';
import { registerBrowserSessionBootstrap, type BrowserSessionBootstrapOptions } from './transport/bootstrap.js';

export interface OrchestratorAppOptions {
  tokenVerifier: ConnectionTokenVerifier;
  envelopeVerifier?: EnvelopeSigner;
  envelopeSignerResolver?: ConnectionEnvelopeSignerResolver;
  createEngine(commandSink: CommandSink, terminalSink: TerminalSink): TransportEngine;
  store: SessionStore;
  leases: ConnectionLeaseStore;
  credentials: ConnectionCredentialStore;
  recipientId: string;
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
  bootstrap?: BrowserSessionBootstrapOptions;
}

export async function createOrchestratorApp(options: OrchestratorAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  if (options.envelopeVerifier === undefined && options.envelopeSignerResolver === undefined) {
    throw new TypeError('An envelope verifier or authenticated session signer resolver is required');
  }
  if (options.bootstrap !== undefined) {
    if (options.envelopeVerifier !== undefined) {
      throw new TypeError('Authenticated bootstrap composition cannot use a static envelope verifier');
    }
    if (options.envelopeSignerResolver !== options.bootstrap.sessions || options.credentials !== options.bootstrap.sessions) {
      throw new TypeError('Bootstrap session store must own both credential consumption and envelope signer resolution');
    }
  }
  const hub = new AgentTransportHub(options.store, options.envelopeVerifier, options.now);
  const engine = options.createEngine(hub, hub);
  app.get('/healthz', async () => ({ status: 'ok' }));
  if (options.bootstrap !== undefined) {
    await registerBrowserSessionBootstrap(app, {
      ...options.bootstrap,
      recipientId: options.recipientId,
      allowedOrigins: options.allowedOrigins,
      now: options.now,
    });
  }
  await registerAgentWebSocket(app, { ...options, engine, hub });
  return app;
}
