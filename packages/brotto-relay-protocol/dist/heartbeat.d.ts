/**
 * Heartbeat types and handling
 *
 * Heartbeats maintain session liveness and detect stale connections.
 * Both clients and servers should send heartbeats.
 */
import { HeartbeatPayload, RelayMessage, ProtocolOptions } from './types.js';
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
export declare const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig;
/**
 * Create a heartbeat payload
 */
export declare function createHeartbeatPayload(sequenceNumber: number, status?: HeartbeatStatus): HeartbeatPayload;
/**
 * Create a heartbeat message
 */
export declare function createHeartbeatMessage(options: ProtocolOptions, sequenceNumber: number, status?: HeartbeatStatus): RelayMessage;
/**
 * Check if a heartbeat has expired (missed deadline)
 */
export declare function isHeartbeatExpired(lastHeartbeat: number, intervalMs: number, maxMissed: number): boolean;
/**
 * Calculate time until next heartbeat is due
 */
export declare function timeUntilNextHeartbeat(lastHeartbeat: number, intervalMs: number): number;
/**
 * Determine heartbeat status based on activity
 */
export declare function determineHeartbeatStatus(lastActivity: number, idleThresholdMs?: number): HeartbeatStatus;
/**
 * Heartbeat manager for tracking and sending heartbeats
 */
export declare class HeartbeatManager {
    private state;
    private config;
    private intervalHandle;
    private isRunning;
    constructor(config?: Partial<HeartbeatConfig>);
    /**
     * Start the heartbeat manager
     */
    start(): void;
    /**
     * Stop the heartbeat manager
     */
    stop(): void;
    /**
     * Process an incoming heartbeat
     */
    receiveHeartbeat(heartbeat: HeartbeatPayload): void;
    /**
     * Record a sent heartbeat
     */
    recordSent(): void;
    /**
     * Get current heartbeat state
     */
    getState(): HeartbeatState;
    /**
     * Check if the connection is considered stale
     */
    isStale(): boolean;
    /**
     * Get time until next heartbeat should be sent
     */
    getTimeUntilNextHeartbeat(): number;
    /**
     * Internal tick function
     */
    private tick;
}
/**
 * Validate heartbeat payload
 */
export declare function validateHeartbeatPayload(payload: unknown): payload is HeartbeatPayload;
//# sourceMappingURL=heartbeat.d.ts.map