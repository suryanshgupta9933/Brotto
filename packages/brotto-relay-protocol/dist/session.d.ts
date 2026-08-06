/**
 * Session lease management
 *
 * Handles session creation, renewal, and revocation.
 * Sessions have short-lived leases that must be renewed.
 */
import { SessionLease, SessionCreatePayload, SessionCreateACKPayload } from './types.js';
/**
 * Session state
 */
export type SessionState = 'pending' | 'active' | 'renewing' | 'revoked' | 'expired';
/**
 * Session information
 */
export interface Session {
    id: string;
    tenantId: string;
    deviceId: string;
    state: SessionState;
    createdAt: number;
    expiresAt: number;
    lastHeartbeat: number;
    channelIds: Set<string>;
    metadata: Map<string, string>;
}
/**
 * Session manager for creating and tracking sessions
 */
export declare class SessionManager {
    private sessions;
    private defaultLeaseMs;
    constructor(defaultLeaseMs?: number);
    /**
     * Create a new session
     */
    createSession(tenantId: string, deviceId: string, requestedLeaseMs?: number, metadata?: Record<string, string>): Session;
    /**
     * Activate a pending session (after handshake)
     */
    activateSession(sessionId: string): boolean;
    /**
     * Get a session by ID
     */
    getSession(sessionId: string): Session | undefined;
    /**
     * Check if a session is valid (active and not expired)
     */
    isSessionValid(sessionId: string): boolean;
    /**
     * Add a channel to a session
     */
    addChannel(sessionId: string, channelId: string): boolean;
    /**
     * Remove a channel from a session
     */
    removeChannel(sessionId: string, channelId: string): boolean;
    /**
     * Renew a session's lease
     */
    renewSession(sessionId: string, additionalMs?: number): number | null;
    /**
     * Revoke a session immediately
     */
    revokeSession(sessionId: string, reason?: string): boolean;
    /**
     * Update heartbeat timestamp
     */
    updateHeartbeat(sessionId: string): boolean;
    /**
     * Get expired sessions
     */
    getExpiredSessions(): Session[];
    /**
     * Clean up expired sessions
     */
    cleanupExpired(): number;
    /**
     * Get sessions for a tenant
     */
    getTenantSessions(tenantId: string): Session[];
    /**
     * Get active session count
     */
    getActiveCount(): number;
    /**
     * Create session create payload
     */
    createSessionCreatePayload(tenantId: string, deviceId: string, requestedLeaseMs?: number, metadata?: Record<string, string>): SessionCreatePayload;
    /**
     * Create session create ACK payload
     */
    createSessionCreateACKPayload(sessionId: string, sessionKey: string, leaseExpiry: number, channelId: string): SessionCreateACKPayload;
    /**
     * Validate session expiry
     */
    isExpired(sessionId: string): boolean;
    /**
     * Get time until session expires
     */
    getTimeUntilExpiry(sessionId: string): number | null;
}
/**
 * Generate a cryptographically random session ID
 */
export declare function generateSessionId(): string;
/**
 * Generate a cryptographically random channel ID
 */
export declare function generateChannelId(): string;
/**
 * Generate a cryptographically random device ID
 */
export declare function generateDeviceId(): string;
/**
 * Create a session lease object
 */
export declare function createSessionLease(sessionId: string, tenantId: string, deviceId: string, leaseMs?: number): SessionLease;
/**
 * Check if a session lease is valid
 */
export declare function isLeaseValid(lease: SessionLease): boolean;
/**
 * Get time remaining on a session lease
 */
export declare function getLeaseTimeRemaining(lease: SessionLease): number;
/**
 * Revoke a session lease
 */
export declare function revokeLease(lease: SessionLease): void;
//# sourceMappingURL=session.d.ts.map