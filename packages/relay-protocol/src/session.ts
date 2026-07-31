/**
 * Session lease management
 *
 * Handles session creation, renewal, and revocation.
 * Sessions have short-lived leases that must be renewed.
 */

import {
  SessionLease,
  SessionCreatePayload,
  SessionCreateACKPayload,
  SessionRenewPayload,
  SessionRevokePayload,
  MessageType,
  DEFAULT_SESSION_LEASE_MS,
  ProtocolErrorCode,
  ProtocolOptions,
  RelayMessage,
} from './types.js';
import { createMessage } from './serialization.js';

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
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private defaultLeaseMs: number;

  constructor(defaultLeaseMs: number = DEFAULT_SESSION_LEASE_MS) {
    this.defaultLeaseMs = defaultLeaseMs;
  }

  /**
   * Create a new session
   */
  createSession(
    tenantId: string,
    deviceId: string,
    requestedLeaseMs?: number,
    metadata?: Record<string, string>
  ): Session {
    const sessionId = generateSessionId();
    const now = Date.now();
    const leaseMs = requestedLeaseMs || this.defaultLeaseMs;

    const session: Session = {
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
  activateSession(sessionId: string): boolean {
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
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session is valid (active and not expired)
   */
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.state !== 'active' && session.state !== 'renewing') return false;
    if (Date.now() > session.expiresAt) {
      session.state = 'expired';
      return false;
    }
    return true;
  }

  /**
   * Add a channel to a session
   */
  addChannel(sessionId: string, channelId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.state === 'revoked' || session.state === 'expired') return false;

    session.channelIds.add(channelId);
    return true;
  }

  /**
   * Remove a channel from a session
   */
  removeChannel(sessionId: string, channelId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    return session.channelIds.delete(channelId);
  }

  /**
   * Renew a session's lease
   */
  renewSession(sessionId: string, additionalMs?: number): number | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.state === 'revoked' || session.state === 'expired') return null;

    const leaseMs = additionalMs || this.defaultLeaseMs;
    session.expiresAt = Date.now() + leaseMs;
    session.lastHeartbeat = Date.now();
    session.state = 'active';

    return session.expiresAt;
  }

  /**
   * Revoke a session immediately
   */
  revokeSession(sessionId: string, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.state = 'revoked';
    session.channelIds.clear();
    return true;
  }

  /**
   * Update heartbeat timestamp
   */
  updateHeartbeat(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.state !== 'active') return false;

    session.lastHeartbeat = Date.now();
    return true;
  }

  /**
   * Get expired sessions
   */
  getExpiredSessions(): Session[] {
    const now = Date.now();
    const expired: Session[] = [];

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
  cleanupExpired(): number {
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
  getTenantSessions(tenantId: string): Session[] {
    const result: Session[] = [];

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
  getActiveCount(): number {
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
  createSessionCreatePayload(
    tenantId: string,
    deviceId: string,
    requestedLeaseMs?: number,
    metadata?: Record<string, string>
  ): SessionCreatePayload {
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
  createSessionCreateACKPayload(
    sessionId: string,
    sessionKey: string,
    leaseExpiry: number,
    channelId: string
  ): SessionCreateACKPayload {
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
  isExpired(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return true;
    return Date.now() > session.expiresAt;
  }

  /**
   * Get time until session expires
   */
  getTimeUntilExpiry(sessionId: string): number | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return Math.max(0, session.expiresAt - Date.now());
  }
}

/**
 * Generate a cryptographically random session ID
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a cryptographically random channel ID
 */
export function generateChannelId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a cryptographically random device ID
 */
export function generateDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a session lease object
 */
export function createSessionLease(
  sessionId: string,
  tenantId: string,
  deviceId: string,
  leaseMs: number = DEFAULT_SESSION_LEASE_MS
): SessionLease {
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
export function isLeaseValid(lease: SessionLease): boolean {
  if (lease.isRevoked) return false;
  return Date.now() < lease.expiresAt;
}

/**
 * Get time remaining on a session lease
 */
export function getLeaseTimeRemaining(lease: SessionLease): number {
  return Math.max(0, lease.expiresAt - Date.now());
}

/**
 * Revoke a session lease
 */
export function revokeLease(lease: SessionLease): void {
  lease.isRevoked = true;
  lease.channelIds.clear();
}
