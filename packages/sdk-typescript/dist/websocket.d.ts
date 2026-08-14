/**
 * WebSocket session client for real-time events
 */
import type { SessionEvent, SessionState, ApprovalRequest } from './types.js';
import { TokenManager } from './auth.js';
export interface WebSocketClientConfig {
    /** WebSocket endpoint URL */
    url: string;
    /** Session ID to subscribe to */
    sessionId: string;
    /** Authentication token or token manager */
    authToken?: string;
    /** Token manager for automatic token refresh */
    tokenManager?: TokenManager;
    /** Called on connection open */
    onOpen?: () => void;
    /** Called on connection close */
    onClose?: (code: number, reason?: string) => void;
    /** Called on errors */
    onError?: (error: Error) => void;
    /** Called on any session event */
    onEvent?: (event: SessionEvent) => void;
    /** Called on state change */
    onStateChange?: (previous: SessionState, current: SessionState) => void;
    /** Called when an action is requested */
    onActionRequested?: (action: unknown) => void;
    /** Called when an action is executed */
    onActionExecuted?: (actionId: string, success: boolean, error?: string) => void;
    /** Called when approval is required */
    onApprovalRequired?: (approval: ApprovalRequest) => void;
    /** Called when an approval decision is made */
    onApprovalDecided?: (approvalId: string, decision: 'approved' | 'denied', decidedBy: string) => void;
    /** Called on errors */
    onSessionError?: (error: string) => void;
    /** Called on heartbeat */
    onHeartbeat?: (leaseExpiresAt: number) => void;
    /** Reconnect on disconnect */
    reconnect?: boolean;
    /** Reconnect delay in milliseconds */
    reconnectDelay?: number;
    /** Maximum reconnection attempts */
    maxReconnectAttempts?: number;
}
/**
 * WebSocket client for subscribing to session events
 */
export declare class WebSocketClient {
    private ws;
    private config;
    private reconnectAttempts;
    private reconnectTimeout;
    private shouldReconnect;
    private isIntentionallyClosed;
    constructor(config: WebSocketClientConfig);
    /**
     * Connect to the WebSocket server
     */
    connect(): Promise<void>;
    /**
     * Handle incoming WebSocket message
     */
    private handleMessage;
    /**
     * Send a message to the WebSocket server
     */
    private send;
    /**
     * Attempt to reconnect with exponential backoff
     */
    private attemptReconnect;
    /**
     * Disconnect from the WebSocket server
     */
    disconnect(): void;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Get the session ID
     */
    getSessionId(): string;
}
/**
 * Create a WebSocket URL from a base URL
 */
export declare function createWebSocketUrl(baseUrl: string, sessionId: string): string;
/**
 * Async iterator for session events
 */
export declare class SessionEventIterator {
    private client;
    private eventQueue;
    private resolveQueue;
    private done;
    constructor(client: WebSocketClient);
    next(): Promise<{
        value: SessionEvent;
        done: boolean;
    }>;
    [Symbol.asyncIterator](): AsyncIterator<SessionEvent>;
    /**
     * Stop iterating
     */
    stop(): void;
}
/**
 * Watch a session for events as an async iterator
 */
export declare function watchSession(config: WebSocketClientConfig): AsyncGenerator<SessionEvent, void, unknown>;
//# sourceMappingURL=websocket.d.ts.map