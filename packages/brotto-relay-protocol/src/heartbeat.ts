/**
 * Heartbeat types and handling
 *
 * Heartbeats maintain session liveness and detect stale connections.
 * Both clients and servers should send heartbeats.
 */

import {
  HeartbeatPayload,
  MessageType,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  RelayMessage,
  ProtocolOptions,
} from './types.js';
import { createMessage } from './serialization.js';

/**
 * Heartbeat status
 */
export type HeartbeatStatus = 'active' | 'idle' | 'closing';

/**
 * Heartbeat state for tracking
 */
export interface HeartbeatState {
  lastSent: number;
  lastReceived: number;
  status: HeartbeatStatus;
  missedHeartbeats: number;
  consecutiveFailures: number;
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  intervalMs: number;
  maxMissedHeartbeats: number;
  ackTimeoutMs: number;
  onMissedHeartbeat?: (count: number) => void;
  onHeartbeatAck?: () => void;
  onTimeout?: () => void;
}

/**
 * Default heartbeat configuration
 */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxMissedHeartbeats: 3,
  ackTimeoutMs: 5000,
};

/**
 * Create a heartbeat payload
 */
export function createHeartbeatPayload(
  sequenceNumber: number,
  status: HeartbeatStatus = 'active'
): HeartbeatPayload {
  return {
    timestamp: Date.now(),
    sequenceNumber,
    status,
  };
}

/**
 * Create a heartbeat message
 */
export function createHeartbeatMessage(
  options: ProtocolOptions,
  sequenceNumber: number,
  status: HeartbeatStatus = 'active'
): RelayMessage {
  const payload = createHeartbeatPayload(sequenceNumber, status);
  return createMessage({
    ...options,
    messageType: MessageType.HEARTBEAT,
    payload,
  });
}

/**
 * Check if a heartbeat has expired (missed deadline)
 */
export function isHeartbeatExpired(
  lastHeartbeat: number,
  intervalMs: number,
  maxMissed: number
): boolean {
  const deadline = lastHeartbeat + intervalMs * maxMissed;
  return Date.now() > deadline;
}

/**
 * Calculate time until next heartbeat is due
 */
export function timeUntilNextHeartbeat(
  lastHeartbeat: number,
  intervalMs: number
): number {
  const nextHeartbeat = lastHeartbeat + intervalMs;
  return Math.max(0, nextHeartbeat - Date.now());
}

/**
 * Determine heartbeat status based on activity
 */
export function determineHeartbeatStatus(
  lastActivity: number,
  idleThresholdMs: number = 60000
): HeartbeatStatus {
  const timeSinceActivity = Date.now() - lastActivity;

  if (timeSinceActivity > idleThresholdMs) {
    return 'idle';
  }
  return 'active';
}

/**
 * Heartbeat manager for tracking and sending heartbeats
 */
export class HeartbeatManager {
  private state: HeartbeatState;
  private config: HeartbeatConfig;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<HeartbeatConfig> = {}) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
    this.state = {
      lastSent: 0,
      lastReceived: 0,
      status: 'active',
      missedHeartbeats: 0,
      consecutiveFailures: 0,
    };
  }

  /**
   * Start the heartbeat manager
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.state.lastSent = Date.now();
    this.state.lastReceived = Date.now();

    this.intervalHandle = setInterval(() => {
      this.tick();
    }, this.config.intervalMs);
  }

  /**
   * Stop the heartbeat manager
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;
    this.state.status = 'closing';
  }

  /**
   * Process an incoming heartbeat
   */
  receiveHeartbeat(heartbeat: HeartbeatPayload): void {
    this.state.lastReceived = Date.now();
    this.state.missedHeartbeats = 0;

    // Update status based on received heartbeat
    if (heartbeat.status === 'idle') {
      this.state.status = 'idle';
    } else {
      this.state.status = 'active';
    }

    this.config.onHeartbeatAck?.();
  }

  /**
   * Record a sent heartbeat
   */
  recordSent(): void {
    this.state.lastSent = Date.now();
  }

  /**
   * Get current heartbeat state
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * Check if the connection is considered stale
   */
  isStale(): boolean {
    return isHeartbeatExpired(
      this.state.lastReceived,
      this.config.intervalMs,
      this.config.maxMissedHeartbeats
    );
  }

  /**
   * Get time until next heartbeat should be sent
   */
  getTimeUntilNextHeartbeat(): number {
    return timeUntilNextHeartbeat(this.state.lastSent, this.config.intervalMs);
  }

  /**
   * Internal tick function
   */
  private tick(): void {
    if (!this.isRunning) return;

    const now = Date.now();
    const timeSinceLastSent = now - this.state.lastSent;

    // Check if we missed a heartbeat deadline
    if (timeSinceLastSent > this.config.intervalMs * 1.5) {
      this.state.missedHeartbeats++;
      this.config.onMissedHeartbeat?.(this.state.missedHeartbeats);
    }

    // Check for timeout (missed too many heartbeats)
    if (this.state.missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this.config.onTimeout?.();
      this.stop();
    }

    // Update status based on time since last activity
    this.state.status = determineHeartbeatStatus(
      this.state.lastReceived,
      this.config.intervalMs * 2
    );
  }
}

/**
 * Validate heartbeat payload
 */
export function validateHeartbeatPayload(
  payload: unknown
): payload is HeartbeatPayload {
  if (!payload || typeof payload !== 'object') return false;

  const p = payload as Record<string, unknown>;

  return (
    typeof p.timestamp === 'number' &&
    typeof p.sequenceNumber === 'number' &&
    typeof p.status === 'string' &&
    ['active', 'idle', 'closing'].includes(p.status)
  );
}
