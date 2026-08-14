/**
 * WebSocket session client for real-time events
 */
import { WebSocketError, AuthenticationError } from './errors.js';
/**
 * WebSocket client for subscribing to session events
 */
export class WebSocketClient {
    ws = null;
    config;
    reconnectAttempts = 0;
    reconnectTimeout = null;
    shouldReconnect = true;
    isIntentionallyClosed = false;
    constructor(config) {
        this.config = {
            url: config.url,
            sessionId: config.sessionId,
            authToken: config.authToken || '',
            tokenManager: config.tokenManager || null,
            onOpen: config.onOpen || (() => { }),
            onClose: config.onClose || (() => { }),
            onError: config.onError || (() => { }),
            onEvent: config.onEvent || (() => { }),
            onStateChange: config.onStateChange || (() => { }),
            onActionRequested: config.onActionRequested || (() => { }),
            onActionExecuted: config.onActionExecuted || (() => { }),
            onApprovalRequired: config.onApprovalRequired || (() => { }),
            onApprovalDecided: config.onApprovalDecided || (() => { }),
            onSessionError: config.onSessionError || (() => { }),
            onHeartbeat: config.onHeartbeat || (() => { }),
            reconnect: config.reconnect ?? true,
            reconnectDelay: config.reconnectDelay ?? 1000,
            maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
        };
        // Ensure authToken is set if no tokenManager
        if (!this.config.authToken && !this.config.tokenManager) {
            throw new AuthenticationError('WebSocket requires authentication token or token manager');
        }
    }
    /**
     * Connect to the WebSocket server
     */
    async connect() {
        if (this.ws) {
            return;
        }
        return new Promise((resolve, reject) => {
            try {
                // Get auth token
                const token = this.config.tokenManager?.getAccessToken() || this.config.authToken;
                if (!token) {
                    reject(new AuthenticationError('No authentication token available'));
                    return;
                }
                // Build WebSocket URL with auth token
                const wsUrl = new URL(this.config.url);
                wsUrl.searchParams.set('token', token);
                wsUrl.searchParams.set('sessionId', this.config.sessionId);
                this.ws = new WebSocket(wsUrl.toString());
                this.ws.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.shouldReconnect = true;
                    this.isIntentionallyClosed = false;
                    this.config.onOpen();
                    // Subscribe to session
                    this.send({
                        type: 'subscribe',
                        sessionId: this.config.sessionId,
                    });
                    resolve();
                };
                this.ws.onclose = (event) => {
                    this.ws = null;
                    this.config.onClose(event.code, event.reason || undefined);
                    if (this.shouldReconnect && !this.isIntentionallyClosed) {
                        this.attemptReconnect();
                    }
                };
                this.ws.onerror = (event) => {
                    this.config.onError(new WebSocketError('WebSocket error occurred'));
                };
                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleMessage(message);
                    }
                    catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                };
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Handle incoming WebSocket message
     */
    handleMessage(message) {
        const sessionEvent = {
            type: message.type,
            payload: message.payload,
            timestamp: message.timestamp,
        };
        // Emit general event
        this.config.onEvent(sessionEvent);
        // Emit typed events
        switch (message.type) {
            case 'state_changed': {
                const payload = message.payload;
                this.config.onStateChange(payload.previousState, payload.newState);
                break;
            }
            case 'action_requested': {
                const payload = message.payload;
                this.config.onActionRequested(payload.action);
                break;
            }
            case 'action_executed': {
                const payload = message.payload;
                this.config.onActionExecuted(payload.actionId, payload.success, payload.error);
                break;
            }
            case 'approval_required': {
                const payload = message.payload;
                this.config.onApprovalRequired(payload.approvalRequest);
                break;
            }
            case 'approval_decided': {
                const payload = message.payload;
                this.config.onApprovalDecided(payload.approvalId, payload.decision, payload.decidedBy);
                break;
            }
            case 'error': {
                const payload = message.payload;
                this.config.onSessionError(payload.error);
                break;
            }
            case 'heartbeat': {
                const payload = message.payload;
                this.config.onHeartbeat(payload.leaseExpiresAt);
                break;
            }
        }
    }
    /**
     * Send a message to the WebSocket server
     */
    send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new WebSocketError('WebSocket is not connected');
        }
        this.ws.send(JSON.stringify(message));
    }
    /**
     * Attempt to reconnect with exponential backoff
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.config.onError(new WebSocketError('Maximum reconnection attempts reached'));
            return;
        }
        const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        this.reconnectTimeout = setTimeout(() => {
            if (this.shouldReconnect && !this.isIntentionallyClosed) {
                this.config.onError(new WebSocketError(`Attempting to reconnect (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`));
                this.connect().catch((error) => {
                    this.config.onError(error);
                });
            }
        }, delay);
    }
    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        this.shouldReconnect = false;
        this.isIntentionallyClosed = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            // Unsubscribe before closing
            try {
                this.send({
                    type: 'unsubscribe',
                    sessionId: this.config.sessionId,
                });
            }
            catch {
                // Ignore errors when unsubscribing
            }
            this.ws.close(1000, 'Client disconnecting');
            this.ws = null;
        }
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    /**
     * Get the session ID
     */
    getSessionId() {
        return this.config.sessionId;
    }
}
/**
 * Create a WebSocket URL from a base URL
 */
export function createWebSocketUrl(baseUrl, sessionId) {
    // Convert http/https to ws/wss
    const wsUrl = baseUrl
        .replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
        .replace(/\/$/, ''); // Remove trailing slash
    return `${wsUrl}/ws/sessions/${sessionId}`;
}
/**
 * Async iterator for session events
 */
export class SessionEventIterator {
    client;
    eventQueue = [];
    resolveQueue = null;
    done = false;
    constructor(client) {
        this.client = client;
        this.client.onEvent((event) => {
            if (this.resolveQueue) {
                this.resolveQueue(event);
                this.resolveQueue = null;
            }
            else {
                this.eventQueue.push(event);
            }
        });
    }
    async next() {
        if (this.done) {
            return { value: null, done: true };
        }
        if (this.eventQueue.length > 0) {
            return { value: this.eventQueue.shift(), done: false };
        }
        if (!this.client.isConnected()) {
            this.done = true;
            return { value: null, done: true };
        }
        return new Promise((resolve) => {
            this.resolveQueue = (event) => {
                resolve({ value: event, done: false });
            };
        });
    }
    [Symbol.asyncIterator]() {
        return this;
    }
    /**
     * Stop iterating
     */
    stop() {
        this.done = true;
        this.client.disconnect();
    }
}
/**
 * Watch a session for events as an async iterator
 */
export async function* watchSession(config) {
    const client = new WebSocketClient(config);
    try {
        await client.connect();
        const queue = [];
        let resolve = null;
        client.onEvent((event) => {
            if (resolve) {
                resolve(event);
                resolve = null;
            }
            else {
                queue.push(event);
            }
        });
        while (client.isConnected()) {
            if (queue.length > 0) {
                yield queue.shift();
            }
            else {
                yield await new Promise((res) => {
                    resolve = res;
                });
            }
        }
    }
    finally {
        client.disconnect();
    }
}
//# sourceMappingURL=websocket.js.map