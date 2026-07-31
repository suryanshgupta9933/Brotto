/**
 * WebSocket session client for real-time events
 */

import type {
  SessionEvent,
  SessionEventType,
  TypedSessionEvent,
  SessionState,
  ApprovalRequest,
} from './types.js';
import { WebSocketError, WebSocketClosedError, AuthenticationError } from './errors.js';
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
 * WebSocket message types
 */
interface WebSocketMessage {
  type: SessionEventType;
  payload: unknown;
  timestamp: number;
}

interface SubscribeMessage {
  type: 'subscribe';
  sessionId: string;
}

interface UnsubscribeMessage {
  type: 'unsubscribe';
  sessionId: string;
}

type OutgoingMessage = SubscribeMessage | UnsubscribeMessage;

/**
 * WebSocket client for subscribing to session events
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<Omit<WebSocketClientConfig, 'onOpen' | 'onClose' | 'onError' | 'onEvent' | 'onStateChange' | 'onActionRequested' | 'onActionExecuted' | 'onApprovalRequired' | 'onApprovalDecided' | 'onSessionError' | 'onHeartbeat'>>;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private isIntentionallyClosed = false;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      url: config.url,
      sessionId: config.sessionId,
      authToken: config.authToken || '',
      tokenManager: config.tokenManager || null as unknown as TokenManager,
      onOpen: config.onOpen || (() => {}),
      onClose: config.onClose || (() => {}),
      onError: config.onError || (() => {}),
      onEvent: config.onEvent || (() => {}),
      onStateChange: config.onStateChange || (() => {}),
      onActionRequested: config.onActionRequested || (() => {}),
      onActionExecuted: config.onActionExecuted || (() => {}),
      onApprovalRequired: config.onApprovalRequired || (() => {}),
      onApprovalDecided: config.onApprovalDecided || (() => {}),
      onSessionError: config.onSessionError || (() => {}),
      onHeartbeat: config.onHeartbeat || (() => {}),
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
  async connect(): Promise<void> {
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
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: WebSocketMessage): void {
    const sessionEvent: SessionEvent = {
      type: message.type,
      payload: message.payload,
      timestamp: message.timestamp,
    };

    // Emit general event
    this.config.onEvent(sessionEvent);

    // Emit typed events
    switch (message.type) {
      case 'state_changed': {
        const payload = message.payload as { previousState: SessionState; newState: SessionState };
        this.config.onStateChange(payload.previousState, payload.newState);
        break;
      }
      case 'action_requested': {
        const payload = message.payload as { action: unknown };
        this.config.onActionRequested(payload.action);
        break;
      }
      case 'action_executed': {
        const payload = message.payload as { actionId: string; success: boolean; error?: string };
        this.config.onActionExecuted(payload.actionId, payload.success, payload.error);
        break;
      }
      case 'approval_required': {
        const payload = message.payload as { approvalRequest: ApprovalRequest };
        this.config.onApprovalRequired(payload.approvalRequest);
        break;
      }
      case 'approval_decided': {
        const payload = message.payload as { approvalId: string; decision: 'approved' | 'denied'; decidedBy: string };
        this.config.onApprovalDecided(payload.approvalId, payload.decision, payload.decidedBy);
        break;
      }
      case 'error': {
        const payload = message.payload as { error: string };
        this.config.onSessionError(payload.error);
        break;
      }
      case 'heartbeat': {
        const payload = message.payload as { leaseExpiresAt: number };
        this.config.onHeartbeat(payload.leaseExpiresAt);
        break;
      }
    }
  }

  /**
   * Send a message to the WebSocket server
   */
  private send(message: OutgoingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WebSocketError('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
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
          this.config.onError(error as Error);
        });
      }
    }, delay);
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
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
      } catch {
        // Ignore errors when unsubscribing
      }

      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }
}

/**
 * Create a WebSocket URL from a base URL
 */
export function createWebSocketUrl(baseUrl: string, sessionId: string): string {
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
  private client: WebSocketClient;
  private eventQueue: SessionEvent[] = [];
  private resolveQueue: ((event: SessionEvent) => void) | null = null;
  private done = false;

  constructor(client: WebSocketClient) {
    this.client = client;
    this.client.onEvent((event) => {
      if (this.resolveQueue) {
        this.resolveQueue(event);
        this.resolveQueue = null;
      } else {
        this.eventQueue.push(event);
      }
    });
  }

  async next(): Promise<{ value: SessionEvent; done: boolean }> {
    if (this.done) {
      return { value: null as unknown as SessionEvent, done: true };
    }

    if (this.eventQueue.length > 0) {
      return { value: this.eventQueue.shift()!, done: false };
    }

    if (!this.client.isConnected()) {
      this.done = true;
      return { value: null as unknown as SessionEvent, done: true };
    }

    return new Promise((resolve) => {
      this.resolveQueue = (event) => {
        resolve({ value: event, done: false });
      };
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<SessionEvent> {
    return this;
  }

  /**
   * Stop iterating
   */
  stop(): void {
    this.done = true;
    this.client.disconnect();
  }
}

/**
 * Watch a session for events as an async iterator
 */
export async function* watchSession(
  config: WebSocketClientConfig
): AsyncGenerator<SessionEvent, void, unknown> {
  const client = new WebSocketClient(config);

  try {
    await client.connect();

    const queue: SessionEvent[] = [];
    let resolve: ((event: SessionEvent) => void) | null = null;

    client.onEvent((event) => {
      if (resolve) {
        resolve(event);
        resolve = null;
      } else {
        queue.push(event);
      }
    });

    while (client.isConnected()) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        yield await new Promise<SessionEvent>((res) => {
          resolve = res;
        });
      }
    }
  } finally {
    client.disconnect();
  }
}
