/**
 * WebSocket relay client for browser-tab-to-server communication
 * Establishes outbound WSS connection and handles CDP frame tunneling
 */

import { sendCommand, type DebuggerSession } from "./debugger";

export interface RelayConfig {
  relayUrl: string;
  sessionId: string;
  deviceId: string;
  token: string;
  tenantId?: string;
}

export interface RelayMessage {
  type: "cdp_command" | "cdp_event" | "heartbeat" | "ack" | "error" | "status";
  channelId: string;
  sequenceNumber: number;
  payload: unknown;
  timestamp: number;
}

export interface CdpFrame {
  sessionId: string;
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

export type RelayEventHandler = (message: RelayMessage) => void;
export type RelayStatusHandler = (status: "connecting" | "connected" | "disconnected" | "error", reason?: string) => void;

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_SEQUENCE_NUMBER = Number.MAX_SAFE_INTEGER;

let ws: WebSocket | null = null;
let config: RelayConfig | null = null;
let sequenceNumber = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let isIntentionallyClosed = false;

const eventHandlers: Set<RelayEventHandler> = new Set();
const statusHandlers: Set<RelayStatusHandler> = new Set();

/**
 * Connect to the WebSocket relay
 */
export async function connect(relayConfig: RelayConfig): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.warn("Relay already connected");
    return;
  }

  config = relayConfig;
  isIntentionallyClosed = false;
  sequenceNumber = Math.floor(Math.random() * MAX_SEQUENCE_NUMBER);

  return new Promise((resolve, reject) => {
    notifyStatus("connecting");

    try {
      ws = new WebSocket(relayConfig.relayUrl);
    } catch (err) {
      notifyStatus("error", `Failed to create WebSocket: ${err}`);
      reject(err);
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      notifyStatus("connected");
      startHeartbeat();
      resolve();
    };

    ws.onclose = (event) => {
      stopHeartbeat();

      if (!isIntentionallyClosed) {
        notifyStatus("disconnected", `Code: ${event.code}, Reason: ${event.reason}`);
        attemptReconnect();
      } else {
        notifyStatus("disconnected", "Connection closed by client");
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      notifyStatus("error", "WebSocket error occurred");
    };

    ws.onmessage = (event) => {
      try {
        const message: RelayMessage = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error("Failed to parse relay message:", err);
      }
    };
  });
}

/**
 * Disconnect from the WebSocket relay
 */
export function disconnect(): void {
  isIntentionallyClosed = true;
  stopHeartbeat();

  if (ws) {
    ws.close(1000, "Client disconnect");
    ws = null;
  }

  config = null;
  notifyStatus("disconnected", "Client initiated disconnect");
}

/**
 * Check if relay is connected
 */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Send a CDP command through the relay
 */
export async function sendCdpCommand(
  session: DebuggerSession,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  if (!isConnected() || !config) {
    throw new Error("Relay not connected");
  }

  const messageId = ++sequenceNumber;
  const channelId = `cdp-${session.tabId}-${Date.now()}`;

  const cdpFrame: CdpFrame = {
    sessionId: session.sessionId,
    method,
    params,
    id: messageId
  };

  const message: RelayMessage = {
    type: "cdp_command",
    channelId,
    sequenceNumber: messageId,
    payload: cdpFrame,
    timestamp: Date.now()
  };

  // Wait for acknowledgment or result
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      handlers.delete(messageId);
      reject(new Error(`CDP command timeout: ${method}`));
    }, 30_000);

    const handlers = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    handlers.set(messageId, { resolve: (v) => { clearTimeout(timeout); resolve(v); }, reject: (e) => { clearTimeout(timeout); reject(e); } });

    try {
      ws!.send(JSON.stringify(message));
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

/**
 * Forward a CDP event to the relay
 */
export function forwardCdpEvent(
  session: DebuggerSession,
  method: string,
  params?: Record<string, unknown>
): void {
  if (!isConnected() || !config) {
    return;
  }

  const channelId = `event-${session.tabId}-${Date.now()}`;

  const cdpFrame: CdpFrame = {
    sessionId: session.sessionId,
    method,
    params
  };

  const message: RelayMessage = {
    type: "cdp_event",
    channelId,
    sequenceNumber: ++sequenceNumber,
    payload: cdpFrame,
    timestamp: Date.now()
  };

  try {
    ws!.send(JSON.stringify(message));
  } catch (err) {
    console.error("Failed to forward CDP event:", err);
  }
}

/**
 * Register an event handler for relay messages
 */
export function onRelayEvent(handler: RelayEventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

/**
 * Register a status change handler
 */
export function onStatusChange(handler: RelayStatusHandler): () => void {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

/**
 * Handle incoming relay messages
 */
function handleMessage(message: RelayMessage): void {
  // Notify event handlers
  for (const handler of eventHandlers) {
    try {
      handler(message);
    } catch (err) {
      console.error("Event handler error:", err);
    }
  }

  // Handle heartbeat
  if (message.type === "heartbeat") {
    handleHeartbeat();
  }
}

/**
 * Start heartbeat interval
 */
function startHeartbeat(): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (isConnected() && config) {
      const message: RelayMessage = {
        type: "heartbeat",
        channelId: `hb-${Date.now()}`,
        sequenceNumber: ++sequenceNumber,
        payload: { timestamp: Date.now() },
        timestamp: Date.now()
      };

      try {
        ws!.send(JSON.stringify(message));

        // Set timeout for heartbeat response
        heartbeatTimeoutTimer = setTimeout(() => {
          console.warn("Heartbeat timeout - closing connection");
          ws?.close(4000, "Heartbeat timeout");
        }, HEARTBEAT_TIMEOUT_MS);
      } catch (err) {
        console.error("Failed to send heartbeat:", err);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop heartbeat interval
 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = null;
  }
}

/**
 * Handle heartbeat response
 */
function handleHeartbeat(): void {
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = null;
  }
}

/**
 * Attempt to reconnect after disconnect
 */
function attemptReconnect(): void {
  if (isIntentionallyClosed || !config) {
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    notifyStatus("error", "Max reconnect attempts reached");
    return;
  }

  reconnectAttempts++;
  console.log(`Attempting reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

  setTimeout(() => {
    if (!isIntentionallyClosed && config) {
      connect(config).catch((err) => {
        console.error("Reconnect failed:", err);
      });
    }
  }, RECONNECT_DELAY_MS * reconnectAttempts);
}

/**
 * Notify all status handlers of status change
 */
function notifyStatus(status: "connecting" | "connected" | "disconnected" | "error", reason?: string): void {
  for (const handler of statusHandlers) {
    try {
      handler(status, reason);
    } catch (err) {
      console.error("Status handler error:", err);
    }
  }
}

/**
 * Get relay connection state
 */
export function getConnectionState(): {
  connected: boolean;
  reconnectAttempts: number;
  config: RelayConfig | null;
} {
  return {
    connected: isConnected(),
    reconnectAttempts,
    config
  };
}
