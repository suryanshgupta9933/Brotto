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

// Protocol constants
export const PROTOCOL_VERSION = '1.0.0';
export const MIN_PROTOCOL_VERSION = '1.0.0';
export const MAX_SEQUENCE_WINDOW = 1000; // Maximum sequence number window for replay protection
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
export const DEFAULT_SESSION_LEASE_MS = 300000; // 5 minutes
export const MAX_MESSAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_PAYLOAD_SIZE_BYTES = 9 * 1024 * 1024; // 9MB (leave room for overhead)

// Message types
export enum MessageType {
  // Control messages
  HELLO = 'HELLO',
  HELLO_ACK = 'HELLO_ACK',
  HEARTBEAT = 'HEARTBEAT',
  HEARTBEAT_ACK = 'HEARTBEAT_ACK',
  GOODBYE = 'GOODBYE',
  ERROR = 'ERROR',

  // Session messages
  SESSION_CREATE = 'SESSION_CREATE',
  SESSION_CREATE_ACK = 'SESSION_CREATE_ACK',
  SESSION_CREATE_ERROR = 'SESSION_CREATE_ERROR',
  SESSION_RENEW = 'SESSION_RENEW',
  SESSION_RENEW_ACK = 'SESSION_RENEW_ACK',
  SESSION_REVOKE = 'SESSION_REVOKE',
  SESSION_REVOKED = 'SESSION_REVOKED',

  // Channel messages
  CHANNEL_OPEN = 'CHANNEL_OPEN',
  CHANNEL_OPEN_ACK = 'CHANNEL_OPEN_ACK',
  CHANNEL_OPEN_ERROR = 'CHANNEL_OPEN_ERROR',
  CHANNEL_CLOSE = 'CHANNEL_CLOSE',
  CHANNEL_CLOSED = 'CHANNEL_CLOSED',

  // CDP frames
  CDP_FRAME = 'CDP_FRAME',
  CDP_FRAME_ACK = 'CDP_FRAME_ACK',

  // Backpressure signals
  BACKPRESSURE_BEGIN = 'BACKPRESSURE_BEGIN',
  BACKPRESSURE_END = 'BACKPRESSURE_END',
  RATE_LIMIT_UPDATE = 'RATE_LIMIT_UPDATE',
}

// Error codes
export enum ProtocolErrorCode {
  PROTOCOL_VERSION_MISMATCH = 'PROTOCOL_VERSION_MISMATCH',
  SEQUENCE_NUMBER_INVALID = 'SEQUENCE_NUMBER_INVALID',
  SEQUENCE_NUMBER_REPLAY = 'SEQUENCE_NUMBER_REPLAY',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  CHANNEL_NOT_FOUND = 'CHANNEL_NOT_FOUND',
  CHANNEL_ALREADY_OPEN = 'CHANNEL_ALREADY_OPEN',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  MESSAGE_TYPE_INVALID = 'MESSAGE_TYPE_INVALID',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// Core message interface
export interface RelayMessage {
  protocolVersion: string;
  tenantId: string;
  sessionId: string;
  deviceId: string;
  channelId: string;
  sequenceNumber: number;
  messageType: MessageType;
  expiry: number; // Unix timestamp in milliseconds
  payload: Uint8Array | string;
  signature?: string;
}

// Serialized message interface (for JSON serialization)
export interface SerializedRelayMessage {
  protocolVersion: string;
  tenantId: string;
  sessionId: string;
  deviceId: string;
  channelId: string;
  sequenceNumber: number;
  messageType: MessageType;
  expiry: number;
  payload: string; // Base64 encoded
  signature?: string;
}

// CDP Frame payload
export interface CDPFramePayload {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  id?: number;
}

// Hello message payload (for protocol version negotiation)
export interface HelloPayload {
  supportedVersions: string[];
  clientType: 'connector' | 'extension' | 'relay';
  clientId?: string;
}

// Hello ACK payload
export interface HelloACKPayload {
  negotiatedVersion: string;
  serverTime: number;
  sessionLeaseMs: number;
  heartbeatIntervalMs: number;
  maxMessageSizeBytes: number;
}

// Session create payload
export interface SessionCreatePayload {
  tenantId: string;
  deviceId: string;
  requestedLeaseMs?: number;
  metadata?: Record<string, string>;
}

// Session create ACK payload
export interface SessionCreateACKPayload {
  sessionId: string;
  sessionKey: string; // Used for message signing
  leaseExpiry: number;
  channelId: string;
}

// Session renew payload
export interface SessionRenewPayload {
  sessionId: string;
}

// Session revoke payload
export interface SessionRevokePayload {
  sessionId: string;
  reason?: string;
}

// Channel open payload
export interface ChannelOpenPayload {
  sessionId: string;
  channelId: string;
  channelType: 'cdp' | 'artifact' | 'control';
}

// Backpressure payload
export interface BackpressurePayload {
  sessionId: string;
  channelId: string;
  reason: 'bandwidth' | 'memory' | 'rate_limit' | 'queue_full';
  windowSize?: number; // For rate limiting
}

// Rate limit update payload
export interface RateLimitPayload {
  sessionId: string;
  channelId?: string;
  tokensPerSecond: number;
  burstSize: number;
  windowSizeMs: number;
}

// Error payload
export interface ErrorPayload {
  code: ProtocolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// Heartbeat payload
export interface HeartbeatPayload {
  timestamp: number;
  sequenceNumber: number;
  status: 'active' | 'idle' | 'closing';
}

// Sequence tracking state
export interface SequenceState {
  lastSequenceNumber: number;
  receivedSequences: Set<number>;
  windowStart: number;
}

// Session lease
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

// TLS configuration types
export interface TLSConfig {
  enabled: boolean;
  // Server-side options
  certFile?: string;
  keyFile?: string;
  caFile?: string;
  // Client-side options
  clientCertFile?: string;
  clientKeyFile?: string;
  // Mutual TLS
  mtlsEnabled: boolean;
  mtlsCaFile?: string;
  // Security options
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  cipherSuites?: string[];
  verifyClient?: boolean;
}

// Rate limiter configuration
export interface RateLimiterConfig {
  tokensPerSecond: number;
  burstSize: number;
  windowSizeMs: number;
}

// Per-session rate limit state
export interface RateLimitState {
  tokensAvailable: number;
  lastRefill: number;
  currentBurst: number;
}

// Backpressure state
export interface BackpressureState {
  isBackpressured: boolean;
  reason?: BackpressurePayload['reason'];
  windowSize?: number;
  startTime?: number;
}

// Message validation result
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: ProtocolErrorCode;
}

// Protocol options for creating messages
export interface ProtocolOptions {
  protocolVersion?: string;
  tenantId: string;
  sessionId: string;
  deviceId: string;
  channelId: string;
  sessionKey?: string;
  expiry?: number;
}

// Helper type for message creation
export type CreateMessageOptions = ProtocolOptions &
  (
    | { messageType: MessageType; payload: Uint8Array | string; signature?: string }
    | { messageType: MessageType.HELLO; payload: HelloPayload; signature?: string }
    | { messageType: MessageType.HELLO_ACK; payload: HelloACKPayload; signature?: string }
    | { messageType: MessageType.HEARTBEAT; payload: HeartbeatPayload; signature?: string }
    | { messageType: MessageType.SESSION_CREATE; payload: SessionCreatePayload; signature?: string }
    | { messageType: MessageType.SESSION_CREATE_ACK; payload: SessionCreateACKPayload; signature?: string }
    | { messageType: MessageType.SESSION_CREATE_ERROR; payload: ErrorPayload; signature?: string }
    | { messageType: MessageType.SESSION_RENEW; payload: SessionRenewPayload; signature?: string }
    | { messageType: MessageType.SESSION_RENEW_ACK; payload: { sessionId: string; newExpiry: number }; signature?: string }
    | { messageType: MessageType.SESSION_REVOKE; payload: SessionRevokePayload; signature?: string }
    | { messageType: MessageType.SESSION_REVOKED; payload: { sessionId: string; reason?: string }; signature?: string }
    | { messageType: MessageType.CHANNEL_OPEN; payload: ChannelOpenPayload; signature?: string }
    | { messageType: MessageType.CHANNEL_OPEN_ACK; payload: { channelId: string }; signature?: string }
    | { messageType: MessageType.CHANNEL_OPEN_ERROR; payload: ErrorPayload; signature?: string }
    | { messageType: MessageType.CHANNEL_CLOSE; payload: { channelId: string }; signature?: string }
    | { messageType: MessageType.CHANNEL_CLOSED; payload: { channelId: string }; signature?: string }
    | { messageType: MessageType.CDP_FRAME; payload: CDPFramePayload | Uint8Array | string; signature?: string }
    | { messageType: MessageType.CDP_FRAME_ACK; payload: { sequenceNumber: number }; signature?: string }
    | { messageType: MessageType.BACKPRESSURE_BEGIN; payload: BackpressurePayload; signature?: string }
    | { messageType: MessageType.BACKPRESSURE_END; payload: { sessionId: string; channelId: string }; signature?: string }
    | { messageType: MessageType.RATE_LIMIT_UPDATE; payload: RateLimitPayload; signature?: string }
    | { messageType: MessageType.ERROR; payload: ErrorPayload; signature?: string }
    | { messageType: MessageType.GOODBYE; payload: { reason?: string }; signature?: string }
  );
