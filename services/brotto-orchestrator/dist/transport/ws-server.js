import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import { SecureAgentIngress, createEnvelope, signEnvelope, } from '@brotto/relay-protocol';
import { ConnectionAuthError, createConnectionAuthenticator } from './auth.js';
export class TransportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TransportError';
    }
}
/** Test/dev adapter. Production deployments inject a durable Redis/SQL implementation. */
export class InMemoryConnectionLeaseBackend {
    leases = new Map();
    fenceCounters = new Map();
    gate = Promise.resolve();
}
export class InMemoryConnectionLeaseStore {
    backend;
    constructor(backend = new InMemoryConnectionLeaseBackend()) {
        this.backend = backend;
    }
    exclusive(work) {
        const result = this.backend.gate.then(work);
        this.backend.gate = result.then(() => undefined, () => undefined);
        return result;
    }
    acquire(claims, connectionId, expiresAt, now, claimFence) {
        return this.exclusive(async () => {
            const current = this.backend.leases.get(claims.sessionId);
            if (current !== undefined && current.expiresAt <= now)
                this.backend.leases.delete(claims.sessionId);
            const fence = Math.max(this.backend.fenceCounters.get(claims.sessionId) ?? 0, current?.fence ?? 0) + 1;
            if (claimFence !== undefined && !await claimFence(claims.sessionId, fence))
                throw new TransportError('LEASE_FENCED', 'Session fence rejected lease takeover');
            this.backend.fenceCounters.set(claims.sessionId, fence);
            const token = { sessionId: claims.sessionId, connectionId, fence, expiresAt };
            this.backend.leases.set(claims.sessionId, token);
            return { ...token };
        });
    }
    isOwner(sessionId, token, now = Date.now()) {
        return this.exclusive(() => {
            const current = this.backend.leases.get(sessionId);
            return current?.connectionId === token.connectionId && current.fence === token.fence && current.expiresAt > now;
        });
    }
    release(token) {
        return this.exclusive(() => {
            const current = this.backend.leases.get(token.sessionId);
            if (current?.connectionId === token.connectionId && current.fence === token.fence)
                this.backend.leases.delete(token.sessionId);
        });
    }
    renew(token, expiresAt, now) {
        return this.exclusive(() => {
            const current = this.backend.leases.get(token.sessionId);
            if (current?.connectionId !== token.connectionId || current.fence !== token.fence || current.expiresAt <= now)
                return null;
            const renewed = { ...token, expiresAt };
            this.backend.leases.set(token.sessionId, renewed);
            return { ...renewed };
        });
    }
    async runIfOwner(token, now, work) {
        await this.exclusive(() => {
            const current = this.backend.leases.get(token.sessionId);
            if (current?.connectionId !== token.connectionId || current.fence !== token.fence || current.expiresAt <= now) {
                throw new TransportError('LEASE_FENCED', 'Connection lease is stale or expired');
            }
        });
        return work();
    }
}
export class OrderedOutboundQueue {
    options;
    pending = [];
    pendingBytes = 0;
    pumping = false;
    drainWaiters = [];
    constructor(options) {
        this.options = options;
    }
    enqueue(value) {
        const bytes = Buffer.byteLength(value);
        if (bytes > this.options.maxBytes || this.pendingBytes + bytes > this.options.maxBytes) {
            return Promise.reject(new TransportError('BACKPRESSURE', 'Outbound queue is full'));
        }
        this.pendingBytes += bytes;
        const promise = new Promise((resolve, reject) => this.pending.push({ value, bytes, resolve, reject }));
        void this.pump();
        return promise;
    }
    drained() {
        if (!this.pumping && this.pending.length === 0)
            return Promise.resolve();
        return new Promise((resolve) => this.drainWaiters.push(resolve));
    }
    async pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        while (this.pending.length > 0) {
            const item = this.pending[0];
            try {
                await this.options.send(item.value);
                item.resolve();
            }
            catch (error) {
                item.reject(error);
            }
            this.pending.shift();
            this.pendingBytes -= item.bytes;
        }
        this.pumping = false;
        for (const resolve of this.drainWaiters.splice(0))
            resolve();
    }
}
export class TransportSession {
    options;
    ingress;
    rate;
    now;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.ingress = new SecureAgentIngress({ now: this.now, maxBytes: options.maxWireBytes ?? 2_000_000, expectedRecipientId: options.recipientId, verifier: options.verifier });
        this.rate = { startedAt: this.now(), messages: 0, bytes: 0 };
    }
    registerOutbound(envelope) {
        if (envelope.sessionId !== this.options.claims.sessionId || envelope.tenantId !== this.options.claims.tenantId || envelope.deviceId !== this.options.claims.deviceId) {
            throw new TransportError('CLAIM_MISMATCH', 'Outbound envelope does not match connection claims');
        }
        const result = this.ingress.registerOutbound(envelope);
        if (result.status === 'rejected')
            throw new TransportError(result.code, 'Outbound flow registration failed');
    }
    async receive(raw, connectionFence) {
        this.charge(raw);
        const admitted = await this.ingress.accept(raw);
        if (admitted.status === 'duplicate')
            return { kind: 'duplicate' };
        if (admitted.status === 'rejected')
            throw new TransportError(admitted.code, `Protocol message rejected: ${admitted.code}`);
        const envelope = admitted.envelope;
        if (envelope.sessionId !== this.options.claims.sessionId || envelope.tenantId !== this.options.claims.tenantId || envelope.deviceId !== this.options.claims.deviceId) {
            throw new TransportError('CLAIM_MISMATCH', 'Envelope binding does not match connection claims');
        }
        if (admitted.message.type === 'heartbeat')
            return { kind: 'heartbeat' };
        if (admitted.message.type === 'reconcile.request' && admitted.message.lastSentClientSequence !== envelope.sequence) {
            throw new TransportError('CLIENT_SEQUENCE_MISMATCH', 'Reconnect client sequence does not match signed envelope');
        }
        let event = toEngineEvent(envelope.messageId, envelope.sessionId, envelope.correlationId, envelope.createdAt, admitted.message, connectionFence, envelope.sequence);
        if (event === null)
            throw new TransportError('MESSAGE_DIRECTION_INVALID', 'Server-originated message received from client');
        if (connectionFence !== undefined) {
            const admission = await this.options.store?.admitInbound?.({ sessionId: envelope.sessionId, messageId: envelope.messageId, sequence: envelope.sequence, event });
            if (admission === undefined)
                throw new TransportError('SEQUENCE_STORE_REQUIRED', 'Durable inbound store is required');
            if (admission === 'duplicate')
                throw new TransportError('SEQUENCE_REPLAY', 'Client sequence was already accepted');
            if (admission === 'gap')
                throw new TransportError('CLIENT_SEQUENCE_GAP', 'Client sequence contains a gap');
            if (admission === 'completed') {
                const completed = await this.options.store?.getProcessed(envelope.messageId);
                if (completed === undefined || completed === null)
                    throw new TransportError('OUTCOME_READ_FAILED', 'Completed inbound outcome cannot be loaded');
                return { kind: 'outcome', outcome: completed };
            }
            const durableEvent = await this.options.store?.loadInbound?.(envelope.messageId);
            if (durableEvent === undefined || durableEvent === null)
                throw new TransportError('INBOX_READ_FAILED', 'Durably admitted event cannot be loaded');
            event = { ...durableEvent, connectionFence };
        }
        const outcome = await this.options.engine.handle(event);
        if (admitted.message.type !== 'reconcile.request' || this.options.store === undefined)
            return { kind: 'outcome', outcome };
        return { kind: 'outcome', outcome, responseWire: await this.reconcileWire(envelope, outcome) };
    }
    async reconcileWire(request, outcome) {
        const session = await this.options.store.load(request.sessionId);
        if (session === null)
            throw new TransportError('SESSION_NOT_FOUND', 'Session disappeared during reconciliation');
        const requested = request.payload.type === 'reconcile.request' ? request.payload.pendingActionIds : [];
        const stored = requested.map((id) => session.completedActions[id]?.result).find((value) => value !== undefined);
        const command = session.activeAction === null ? undefined : commandMessage(session);
        const response = createEnvelope({
            messageId: randomUUID(), sessionId: request.sessionId, correlationId: request.messageId, causationId: request.messageId,
            recipientId: this.options.claims.deviceId, tenantId: this.options.claims.tenantId, deviceId: this.options.claims.deviceId,
            sequence: session.nextSequence, createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + 30_000,
            payload: { type: 'reconcile.response', nextSequence: session.nextSequence, pendingActionIds: outcome.pendingActionIds,
                requiresFreshObservation: outcome.requiresFreshObservation ?? false, authoritativeState: session.state,
                ...(command === undefined ? {} : { command }), ...(stored === undefined ? {} : { storedResult: stored }),
                respondedAt: new Date(this.now()).toISOString() },
        });
        if (command !== undefined) {
            if (session.lastObservation === null)
                throw new TransportError('ACTION_FLOW_INVALID', 'Stored command has no source observation');
            this.ingress.restoreObservation(session.sessionId, session.lastObservation);
            this.registerOutbound(responseWithCommandFlow(response, command));
        }
        return JSON.stringify(await signEnvelope(response, this.options.verifier));
    }
    charge(raw) {
        const now = this.now();
        if (now - this.rate.startedAt >= 60_000)
            this.rate = { startedAt: now, messages: 0, bytes: 0 };
        this.rate.messages += 1;
        this.rate.bytes += typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
        if (this.rate.messages > (this.options.maxMessagesPerMinute ?? 120) || this.rate.bytes > (this.options.maxBytesPerMinute ?? 20_000_000))
            throw new TransportError('RATE_LIMITED', 'Connection message rate exceeded');
    }
}
function responseWithCommandFlow(response, command) {
    return { ...response, payload: command };
}
function commandMessage(session) {
    const active = session.activeAction;
    return active === null ? undefined : { type: 'action.command', proposal: active.proposal, policyDecision: active.policyDecision, command: active.command };
}
export class AgentTransportHub {
    store;
    defaultSigner;
    now;
    connections = new Map();
    constructor(store, defaultSigner, now = Date.now) {
        this.store = store;
        this.defaultSigner = defaultSigner;
        this.now = now;
    }
    attach(connection) {
        this.connections.set(connection.claims.sessionId, connection);
        return () => { if (this.connections.get(connection.claims.sessionId) === connection)
            this.connections.delete(connection.claims.sessionId); };
    }
    async send(command) {
        const session = await this.store.loadByAction?.(command.actionId) ?? await this.findSession(command);
        if (session === null || session.activeAction === null)
            throw new TransportError('SESSION_NOT_FOUND', 'No active session for command');
        const connection = this.connections.get(session.sessionId);
        if (connection === undefined)
            throw new TransportError('CLIENT_DISCONNECTED', 'Client is not connected');
        const payload = commandMessage(session);
        const envelope = createEnvelope({ messageId: randomUUID(), sessionId: session.sessionId, correlationId: command.actionId, causationId: command.observationId,
            recipientId: connection.claims.deviceId, tenantId: connection.claims.tenantId, deviceId: connection.claims.deviceId,
            sequence: command.sequence, createdAt: new Date(this.now()).toISOString(), expiresAt: Date.parse(command.expiresAt), payload });
        connection.session.registerOutbound(envelope);
        const signer = connection.signer ?? this.defaultSigner;
        if (signer === undefined)
            throw new TransportError('SIGNER_UNAVAILABLE', 'No authenticated session envelope signer is configured');
        await connection.queue.enqueue(JSON.stringify(await signEnvelope(envelope, signer)));
    }
    async sendTerminal(notification) {
        const connection = this.connections.get(notification.sessionId);
        if (connection === undefined)
            throw new TransportError('CLIENT_DISCONNECTED', 'Client is not connected');
        const envelope = createEnvelope({
            messageId: notification.messageId,
            sessionId: notification.sessionId,
            correlationId: notification.correlationId,
            causationId: notification.correlationId,
            recipientId: connection.claims.deviceId,
            tenantId: connection.claims.tenantId,
            deviceId: connection.claims.deviceId,
            sequence: notification.sequence,
            createdAt: notification.createdAt,
            expiresAt: notification.expiresAt,
            payload: notification.payload,
        });
        connection.session.registerOutbound(envelope);
        const signer = connection.signer ?? this.defaultSigner;
        if (signer === undefined)
            throw new TransportError('SIGNER_UNAVAILABLE', 'No authenticated session envelope signer is configured');
        await connection.queue.enqueue(JSON.stringify(await signEnvelope(envelope, signer)));
    }
    async findSession(command) {
        for (const sessionId of this.connections.keys()) {
            const session = await this.store.load(sessionId);
            if (session?.activeAction?.actionId === command.actionId)
                return session;
        }
        return null;
    }
}
function toEngineEvent(messageId, sessionId, correlationId, occurredAt, message, connectionFence, clientSequence) {
    const meta = { messageId, sessionId, occurredAt, ...(connectionFence === undefined ? {} : { connectionFence }) };
    switch (message.type) {
        case 'session.open': return {
            ...meta,
            type: message.type,
            taskId: correlationId,
            goal: message.goal,
            completionCriteria: [],
        };
        case 'observation.submitted': return { ...meta, type: message.type, observation: message.observation };
        case 'action.acknowledged': return { ...meta, type: message.type, clientSequence, actionId: message.actionId, stepId: message.stepId, observationId: message.observationId, acknowledgedAt: message.acknowledgedAt };
        case 'action.completed': return { ...meta, type: message.type, result: message.result };
        case 'approval.resolved': return { ...meta, type: message.type, resolution: message.resolution };
        case 'reconcile.request': return { ...meta, type: message.type, lastReceivedSequence: message.lastReceivedSequence, lastSentClientSequence: message.lastSentClientSequence, pendingActionIds: message.pendingActionIds };
        case 'task.cancelled': return { ...meta, type: message.type, reason: message.reason };
        default: return null;
    }
}
export function connectionTokenFromProtocols(headerValue) {
    const protocols = (headerValue ?? '').split(',').map((value) => value.trim());
    if (!protocols.includes('brotto-v1'))
        throw new ConnectionAuthError('TOKEN_REQUIRED', 'Required WebSocket protocol is missing');
    const credential = protocols.find((value) => value.startsWith('brotto-credential.'));
    if (credential === undefined || credential.length === 'brotto-credential.'.length)
        throw new ConnectionAuthError('TOKEN_REQUIRED', 'Connection credential is missing');
    return credential.slice('brotto-credential.'.length);
}
export async function registerAgentWebSocket(app, options) {
    await app.register(websocket);
    const now = options.now ?? Date.now;
    const authenticate = createConnectionAuthenticator({ verifier: options.tokenVerifier, now, allowedOrigins: options.allowedOrigins });
    const authenticated = new WeakMap();
    app.get('/v1/agent', {
        websocket: true,
        preValidation: async (request) => {
            const claims = await authenticate({ token: connectionTokenFromProtocols(header(request.headers['sec-websocket-protocol'])), origin: header(request.headers.origin) });
            if (!await options.credentials.consume(claims.credentialId, claims.expiresAt, now()))
                throw new ConnectionAuthError('TOKEN_REPLAY', 'Connection credential was already used');
            authenticated.set(request, claims);
        },
    }, (socketValue, request) => {
        const socket = socketValue;
        const claims = authenticated.get(request);
        if (claims === undefined) {
            socket.close(4401, 'TOKEN_INVALID');
            return;
        }
        const connectionId = randomUUID();
        let closed = false;
        let cleanup;
        socket.on('close', () => { closed = true; cleanup?.(); });
        const ready = options.leases.acquire(claims, connectionId, now() + (options.heartbeatTimeoutMs ?? 30_000) * 2, now(), async (sessionId, fence) => await options.store.claimConnectionFence?.(sessionId, fence) ?? false).then(async (initialLease) => {
            if (closed) {
                await options.leases.release(initialLease);
                return null;
            }
            const state = { lease: initialLease };
            const envelopeSigner = options.envelopeSignerResolver === undefined
                ? options.envelopeVerifier
                : await options.envelopeSignerResolver.resolve(claims);
            if (envelopeSigner === undefined)
                throw new TransportError('SIGNER_UNAVAILABLE', 'Authenticated session envelope signer is unavailable');
            const session = new TransportSession({ claims, recipientId: options.recipientId, verifier: envelopeSigner, engine: options.engine, store: options.store, now });
            const outboundLimit = options.maxOutboundBytes ?? 1_000_000;
            const queue = new OrderedOutboundQueue({ maxBytes: outboundLimit, send: (value) => socketSend(socket, value, outboundLimit) });
            const detach = options.hub?.attach({ claims, session, queue, signer: envelopeSigner });
            let alive = true;
            const timer = setInterval(() => {
                void options.leases.isOwner(claims.sessionId, state.lease, now()).then(async (owner) => {
                    if (!owner || !alive || state.lease.expiresAt <= now()) {
                        socket.close(4001, 'connection lease expired');
                        clearInterval(timer);
                        return;
                    }
                    const renewed = await options.leases.renew(state.lease, now() + (options.heartbeatTimeoutMs ?? 30_000) * 2, now());
                    if (renewed === null) {
                        socket.close(4001, 'connection lease fenced');
                        clearInterval(timer);
                        return;
                    }
                    state.lease = renewed;
                    alive = false;
                    socket.ping();
                });
            }, options.heartbeatTimeoutMs ?? 30_000);
            timer.unref();
            socket.on('pong', () => { alive = true; });
            cleanup = () => { clearInterval(timer); detach?.(); void options.leases.release(state.lease); };
            if (closed) {
                cleanup();
                return null;
            }
            return { state, session, queue };
        });
        socket.on('message', (data) => {
            void ready.then((active) => {
                if (active === null || closed)
                    return undefined;
                const { state, session, queue } = active;
                return options.leases.runIfOwner(state.lease, now(), async () => {
                    const result = await session.receive(normalizeWire(data), state.lease.fence);
                    if (result.kind === 'outcome' && result.responseWire !== undefined)
                        await queue.enqueue(result.responseWire);
                });
            }).catch((error) => socket.close(closeCode(error), safeReason(error)));
        });
        void ready.catch((error) => socket.close(closeCode(error), safeReason(error)));
    });
}
function socketSend(socket, value, maxBufferedBytes) {
    if (socket.bufferedAmount + Buffer.byteLength(value) > maxBufferedBytes)
        return Promise.reject(new TransportError('BACKPRESSURE', 'Socket buffer is full'));
    try {
        socket.send(value);
        return Promise.resolve();
    }
    catch (error) {
        return Promise.reject(error);
    }
}
function header(value) { return Array.isArray(value) ? value[0] : value; }
function normalizeWire(data) { if (typeof data === 'string' || data instanceof Uint8Array)
    return data; throw new TransportError('INVALID_WIRE', 'WebSocket frame must be text or binary'); }
function closeCode(error) { return error instanceof ConnectionAuthError ? 4401 : error instanceof TransportError && error.code === 'RATE_LIMITED' ? 4429 : 4400; }
function safeReason(error) { return error instanceof ConnectionAuthError || error instanceof TransportError ? error.code : 'INTERNAL_ERROR'; }
//# sourceMappingURL=ws-server.js.map