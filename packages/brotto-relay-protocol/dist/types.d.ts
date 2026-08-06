/**
 * TypeScript types for the CDP Relay Protocol
 *
 * Every message includes:
 * - protocolVersion: Version of the protocol in use
 * - tenantId: Tenant identifier for multi-tenant isolation
 * - sessionId: Unique session identifier (cryptographically random)
 * - deviceId: Device identifier
 * - channelId: Channel identifier (no cross-session reuse)
 * - sequenceNumber: Ordered sequence number for replay protection
 * - messageType: Type of message
 * - expiry: Expiration timestamp for short-lived session leases
 * - payload: Message payload (CDP frames, heartbeats, etc.)
 * - signature: Message signature or authenticated transport context
 */
export declare const PROTOCOL_VERSION = "1.0.0";
export declare const MIN_PROTOCOL_VERSION = "1.0.0";
export declare const MAX_SEQUENCE_WINDOW = 1000;
export declare const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
export declare const DEFAULT_SESSION_LEASE_MS = 300000;
export declare const MAX_MESSAGE_SIZE_BYTES: number;
export declare const MAX_PAYLOAD_SIZE_BYTES: number;
export declare enum MessageType {
    HELLO = "HELLO",
    HELLO_ACK = "HELLO_ACK",
    HEARTBEAT = "HEARTBEAT",
    HEARTBEAT_ACK = "HEARTBEAT_ACK",
    GOODBYE = "GOODBYE",
    ERROR = "ERROR",
    SESSION_CREATE = "SESSION_CREATE",
    SESSION_CREATE_ACK = "SESSION_CREATE_ACK",
    SESSION_CREATE_ERROR = "SESSION_CREATE_ERROR",
    SESSION_RENEW = "SESSION_RENEW",
    SESSION_RENEW_ACK = "SESSION_RENEW_ACK",
    SESSION_REVOKE = "SESSION_REVOKE",
    SESSION_REVOKED = "SESSION_REVOKED",
    CHANNEL_OPEN = "CHANNEL_OPEN",
    CHANNEL_OPEN_ACK = "CHANNEL_OPEN_ACK",
    CHANNEL_OPEN_ERROR = "CHANNEL_OPEN_ERROR",
    CHANNEL_CLOSE = "CHANNEL_CLOSE",
    CHANNEL_CLOSED = "CHANNEL_CLOSED",
    CDP_FRAME = "CDP_FRAME",
    CDP_FRAME_ACK = "CDP_FRAME_ACK",
    BACKPRESSURE_BEGIN = "BACKPRESSURE_BEGIN",
    BACKPRESSURE_END = "BACKPRESSURE_END",
    RATE_LIMIT_UPDATE = "RATE_LIMIT_UPDATE"
}
export declare enum ProtocolErrorCode {
    PROTOCOL_VERSION_MISMATCH = "PROTOCOL_VERSION_MISMATCH",
    SEQUENCE_NUMBER_INVALID = "SEQUENCE_NUMBER_INVALID",
    SEQUENCE_NUMBER_REPLAY = "SEQUENCE_NUMBER_REPLAY",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    SESSION_REVOKED = "SESSION_REVOKED",
    CHANNEL_NOT_FOUND = "CHANNEL_NOT_FOUND",
    CHANNEL_ALREADY_OPEN = "CHANNEL_ALREADY_OPEN",
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",
    MESSAGE_TYPE_INVALID = "MESSAGE_TYPE_INVALID",
    SIGNATURE_INVALID = "SIGNATURE_INVALID",
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
    INTERNAL_ERROR = "INTERNAL_ERROR"
}
export interface RelayMessage {
    protocolVersion: string;
    tenantId: string;
    sessionId: string;
    deviceId: string;
    channelId: string;
    sequenceNumber: number;
    messageType: MessageType;
    expiry: number;
    payload: Uint8Array | string;
    signature?: string;
}
export interface SerializedRelayMessage {
    protocolVersion: string;
    tenantId: string;
    sessionId: string;
    deviceId: string;
    channelId: string;
    sequenceNumber: number;
    messageType: MessageType;
    expiry: number;
    payload: string;
    signature?: string;
}
export interface CDPFramePayload {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
    id?: number;
}
export interface HelloPayload {
    supportedVersions: string[];
    clientType: 'connector' | 'extension' | 'relay';
    clientId?: string;
}
export interface HelloACKPayload {
    negotiatedVersion: string;
    serverTime: number;
    sessionLeaseMs: number;
    heartbeatIntervalMs: number;
    maxMessageSizeBytes: number;
}
export interface SessionCreatePayload {
    tenantId: string;
    deviceId: string;
    requestedLeaseMs?: number;
    metadata?: Record<string, string>;
}
export interface SessionCreateACKPayload {
    sessionId: string;
    sessionKey: string;
    leaseExpiry: number;
    channelId: string;
}
export interface SessionRenewPayload {
    sessionId: string;
}
export interface SessionRevokePayload {
    sessionId: string;
    reason?: string;
}
export interface ChannelOpenPayload {
    sessionId: string;
    channelId: string;
    channelType: 'cdp' | 'artifact' | 'control';
}
export interface BackpressurePayload {
    sessionId: string;
    channelId: string;
    reason: 'bandwidth' | 'memory' | 'rate_limit' | 'queue_full';
    windowSize?: number;
}
export interface RateLimitPayload {
    sessionId: string;
    channelId?: string;
    tokensPerSecond: number;
    burstSize: number;
    windowSizeMs: number;
}
export interface ErrorPayload {
    code: ProtocolErrorCode;
    message: string;
    details?: Record<string, unknown>;
}
export interface HeartbeatPayload {
    timestamp: number;
    sequenceNumber: number;
    status: 'active' | 'idle' | 'closing';
}
export interface SequenceState {
    lastSequenceNumber: number;
    receivedSequences: Set<number>;
    windowStart: number;
}
export interface SessionLease {
    sessionId: string;
    tenantId: string;
    deviceId: string;
    createdAt: number;
    expiresAt: number;
    lastHeartbeat: number;
    channelIds: Set<string>;
    isRevoked: boolean;
}
export interface TLSConfig {
    enabled: boolean;
    certFile?: string;
    keyFile?: string;
    caFile?: string;
    clientCertFile?: string;
    clientKeyFile?: string;
    mtlsEnabled: boolean;
    mtlsCaFile?: string;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    cipherSuites?: string[];
    verifyClient?: boolean;
}
export interface RateLimiterConfig {
    tokensPerSecond: number;
    burstSize: number;
    windowSizeMs: number;
}
export interface RateLimitState {
    tokensAvailable: number;
    lastRefill: number;
    currentBurst: number;
}
export interface BackpressureState {
    isBackpressured: boolean;
    reason?: BackpressurePayload['reason'];
    windowSize?: number;
    startTime?: number;
}
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}
export interface ValidationError {
    field: string;
    message: string;
    code: ProtocolErrorCode;
}
export interface ProtocolOptions {
    protocolVersion?: string;
    tenantId: string;
    sessionId: string;
    deviceId: string;
    channelId: string;
    sessionKey?: string;
    expiry?: number;
}
export type CreateMessageOptions = ProtocolOptions & ({
    messageType: MessageType;
    payload: Uint8Array | string;
    signature?: string;
} | {
    messageType: MessageType.HELLO;
    payload: HelloPayload;
    signature?: string;
} | {
    messageType: MessageType.HELLO_ACK;
    payload: HelloACKPayload;
    signature?: string;
} | {
    messageType: MessageType.HEARTBEAT;
    payload: HeartbeatPayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_CREATE;
    payload: SessionCreatePayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_CREATE_ACK;
    payload: SessionCreateACKPayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_CREATE_ERROR;
    payload: ErrorPayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_RENEW;
    payload: SessionRenewPayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_RENEW_ACK;
    payload: {
        sessionId: string;
        newExpiry: number;
    };
    signature?: string;
} | {
    messageType: MessageType.SESSION_REVOKE;
    payload: SessionRevokePayload;
    signature?: string;
} | {
    messageType: MessageType.SESSION_REVOKED;
    payload: {
        sessionId: string;
        reason?: string;
    };
    signature?: string;
} | {
    messageType: MessageType.CHANNEL_OPEN;
    payload: ChannelOpenPayload;
    signature?: string;
} | {
    messageType: MessageType.CHANNEL_OPEN_ACK;
    payload: {
        channelId: string;
    };
    signature?: string;
} | {
    messageType: MessageType.CHANNEL_OPEN_ERROR;
    payload: ErrorPayload;
    signature?: string;
} | {
    messageType: MessageType.CHANNEL_CLOSE;
    payload: {
        channelId: string;
    };
    signature?: string;
} | {
    messageType: MessageType.CHANNEL_CLOSED;
    payload: {
        channelId: string;
    };
    signature?: string;
} | {
    messageType: MessageType.CDP_FRAME;
    payload: CDPFramePayload | Uint8Array | string;
    signature?: string;
} | {
    messageType: MessageType.CDP_FRAME_ACK;
    payload: {
        sequenceNumber: number;
    };
    signature?: string;
} | {
    messageType: MessageType.BACKPRESSURE_BEGIN;
    payload: BackpressurePayload;
    signature?: string;
} | {
    messageType: MessageType.BACKPRESSURE_END;
    payload: {
        sessionId: string;
        channelId: string;
    };
    signature?: string;
} | {
    messageType: MessageType.RATE_LIMIT_UPDATE;
    payload: RateLimitPayload;
    signature?: string;
} | {
    messageType: MessageType.ERROR;
    payload: ErrorPayload;
    signature?: string;
} | {
    messageType: MessageType.GOODBYE;
    payload: {
        reason?: string;
    };
    signature?: string;
});
//# sourceMappingURL=types.d.ts.map