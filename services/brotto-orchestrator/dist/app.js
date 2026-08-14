import Fastify from 'fastify';
import { AgentTransportHub, registerAgentWebSocket } from './transport/ws-server.js';
import { registerBrowserSessionBootstrap } from './transport/bootstrap.js';
export async function createOrchestratorApp(options) {
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
//# sourceMappingURL=app.js.map