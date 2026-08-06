/**
 * Relay Protocol Package
 *
 * TypeScript types and utilities for the CDP relay wire protocol.
 * Used by clients (desktop connector, browser extension) and server (cdp-relay).
 */
export * from './v1/index.js';
export { RelayMessage, SerializedRelayMessage, CDPFramePayload, HelloPayload, HelloACKPayload, SessionCreatePayload, SessionCreateACKPayload, SessionRenewPayload, SessionRevokePayload, ChannelOpenPayload, BackpressurePayload, RateLimitPayload, ErrorPayload, HeartbeatPayload, SessionLease, SequenceState, TLSConfig, RateLimiterConfig, RateLimitState, BackpressureState, ValidationResult, ValidationError, ProtocolOptions, CreateMessageOptions, } from './types.js';
export { PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, MAX_SEQUENCE_WINDOW, DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SESSION_LEASE_MS, MAX_MESSAGE_SIZE_BYTES, MAX_PAYLOAD_SIZE_BYTES, } from './types.js';
export { MessageType, ProtocolErrorCode, } from './types.js';
export { Session, SessionState, SessionManager, generateSessionId, generateChannelId, generateDeviceId, createSessionLease, isLeaseValid, getLeaseTimeRemaining, revokeLease, } from './session.js';
export { HeartbeatManager, HeartbeatState, HeartbeatStatus, DEFAULT_HEARTBEAT_CONFIG, createHeartbeatPayload, createHeartbeatMessage, isHeartbeatExpired, timeUntilNextHeartbeat, determineHeartbeatStatus, validateHeartbeatPayload, } from './heartbeat.js';
export { BackpressureManager, BackpressureReason, BackpressureThresholds, DEFAULT_BACKPRESSURE_THRESHOLDS, createBackpressureBeginPayload, createBackpressureEndPayload, createBackpressureBeginMessage, createBackpressureEndMessage, validateBackpressurePayload, calculateRecommendedWindow, } from './backpressure.js';
export { serializeMessage, deserializeMessage, validateMessage, validateSerializedMessage, isVersionCompatible, encodePayload, decodePayload, encodeBase64, decodeBase64, getSerializedSize, ProtocolValidationError, createMessage, } from './serialization.js';
export { SequenceTracker, defaultSequenceTracker, } from './sequence.js';
export { DEFAULT_TLS_CONFIG, ServerTLSConfig, ClientTLSConfig, MTLSConfig, NodeTLSOptions, createServerTLSConfig, createClientTLSConfig, createMTLSConfig, validateTLSConfig, requiresClientCert, getSecureCipherSuites, getCompatibleCipherSuites, toNodeTLSOptions, SECURITY_OPTIONS, } from './tls.js';
export { RateLimiter, SessionRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, createRateLimitPayload, createRateLimitMessage, calculateRateLimit, } from './ratelimit.js';
//# sourceMappingURL=index.d.ts.map