import { type FastifyInstance } from 'fastify';
import type { EnvelopeSigner } from '@brotto/relay-protocol';
import { type ConnectionEnvelopeSignerResolver, type TransportEngine } from './transport/ws-server.js';
import type { CommandSink, TerminalSink } from './engine/types.js';
import type { ConnectionTokenVerifier } from './transport/auth.js';
import type { ConnectionCredentialStore } from './transport/auth.js';
import type { SessionStore } from './engine/types.js';
import type { ConnectionLeaseStore } from './transport/ws-server.js';
import { type BrowserSessionBootstrapOptions } from './transport/bootstrap.js';
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
export declare function createOrchestratorApp(options: OrchestratorAppOptions): Promise<FastifyInstance>;
//# sourceMappingURL=app.d.ts.map