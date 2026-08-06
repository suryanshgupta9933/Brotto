/**
 * Session lease management
 *
 * Handles session creation, renewal, and revocation.
 * Sessions have short-lived leases that must be renewed.
 */
import { DEFAULT_SESSION_LEASE_MS, } from './types.js';
/**
 * Session manager for creating and tracking sessions
 */
export class SessionManager {
    sessions = new Map();
    defaultLeaseMs;
    constructor(defaultLeaseMs = DEFAULT_SESSION_LEASE_MS) {
        this.defaultLeaseMs = defaultLeaseMs;
    }
    /**
     * Create a new session
     */
    createSession(tenantId, deviceId, requestedLeaseMs, metadata) {
        const sessionId = generateSessionId();
        const now = Date.now();
        const leaseMs = requestedLeaseMs || this.defaultLeaseMs;
        const session = {
            id: sessionId,
            tenantId,
            deviceId,
            state: 'pending',
            createdAt: now,
            expiresAt: now + leaseMs,
            lastHeartbeat: now,
            channelIds: new Set(),
            metadata: new Map(Object.entries(metadata || {})),
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    /**
     * Activate a pending session (after handshake)
     */
    activateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.state !== 'pending') {
            return false;
        }
        session.state = 'active';
        return true;
    }
    /**
     * Get a session by ID
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Check if a session is valid (active and not expired)
     */
    isSessionValid(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        if (session.state !== 'active' && session.state !== 'renewing')
            return false;
        if (Date.now() > session.expiresAt) {
            session.state = 'expired';
            return false;
        }
        return true;
    }
    /**
     * Add a channel to a session
     */
    addChannel(sessionId, channelId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        if (session.state === 'revoked' || session.state === 'expired')
            return false;
        session.channelIds.add(channelId);
        return true;
    }
    /**
     * Remove a channel from a session
     */
    removeChannel(sessionId, channelId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        return session.channelIds.delete(channelId);
    }
    /**
     * Renew a session's lease
     */
    renewSession(sessionId, additionalMs) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        if (session.state === 'revoked' || session.state === 'expired')
            return null;
        const leaseMs = additionalMs || this.defaultLeaseMs;
        session.expiresAt = Date.now() + leaseMs;
        session.lastHeartbeat = Date.now();
        session.state = 'active';
        return session.expiresAt;
    }
    /**
     * Revoke a session immediately
     */
    revokeSession(sessionId, reason) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        session.state = 'revoked';
        session.channelIds.clear();
        return true;
    }
    /**
     * Update heartbeat timestamp
     */
    updateHeartbeat(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        if (session.state !== 'active')
            return false;
        session.lastHeartbeat = Date.now();
        return true;
    }
    /**
     * Get expired sessions
     */
    getExpiredSessions() {
        const now = Date.now();
        const expired = [];
        for (const session of this.sessions.values()) {
            if (session.state === 'active' && now > session.expiresAt) {
                session.state = 'expired';
                expired.push(session);
            }
        }
        return expired;
    }
    /**
     * Clean up expired sessions
     */
    cleanupExpired() {
        let cleaned = 0;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.state === 'expired' || session.state === 'revoked') {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }
        return cleaned;
    }
    /**
     * Get sessions for a tenant
     */
    getTenantSessions(tenantId) {
        const result = [];
        for (const session of this.sessions.values()) {
            if (session.tenantId === tenantId) {
                result.push(session);
            }
        }
        return result;
    }
    /**
     * Get active session count
     */
    getActiveCount() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.state === 'active' || session.state === 'renewing' || session.state === 'pending') {
                count++;
            }
        }
        return count;
    }
    /**
     * Create session create payload
     */
    createSessionCreatePayload(tenantId, deviceId, requestedLeaseMs, metadata) {
        return {
            tenantId,
            deviceId,
            requestedLeaseMs,
            metadata,
        };
    }
    /**
     * Create session create ACK payload
     */
    createSessionCreateACKPayload(sessionId, sessionKey, leaseExpiry, channelId) {
        return {
            sessionId,
            sessionKey,
            leaseExpiry,
            channelId,
        };
    }
    /**
     * Validate session expiry
     */
    isExpired(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return true;
        return Date.now() > session.expiresAt;
    }
    /**
     * Get time until session expires
     */
    getTimeUntilExpiry(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        return Math.max(0, session.expiresAt - Date.now());
    }
}
/**
 * Generate a cryptographically random session ID
 */
export function generateSessionId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Generate a cryptographically random channel ID
 */
export function generateChannelId() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Generate a cryptographically random device ID
 */
export function generateDeviceId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Create a session lease object
 */
export function createSessionLease(sessionId, tenantId, deviceId, leaseMs = DEFAULT_SESSION_LEASE_MS) {
    const now = Date.now();
    return {
        sessionId,
        tenantId,
        deviceId,
        createdAt: now,
        expiresAt: now + leaseMs,
        lastHeartbeat: now,
        channelIds: new Set(),
        isRevoked: false,
    };
}
/**
 * Check if a session lease is valid
 */
export function isLeaseValid(lease) {
    if (lease.isRevoked)
        return false;
    return Date.now() < lease.expiresAt;
}
/**
 * Get time remaining on a session lease
 */
export function getLeaseTimeRemaining(lease) {
    return Math.max(0, lease.expiresAt - Date.now());
}
/**
 * Revoke a session lease
 */
export function revokeLease(lease) {
    lease.isRevoked = true;
    lease.channelIds.clear();
}
//# sourceMappingURL=session.js.map