/**
 * Relay Protocol Package
 *
 * TypeScript types and utilities for the CDP relay wire protocol.
 * Used by clients (desktop connector, browser extension) and server (cdp-relay).
 */
// Canonical application-level agent loop protocol (V1). Legacy CDP relay types
// remain below for existing runtime compatibility while migration is in progress.
export * from './v1/index.js';
export { 
// Constants
PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, MAX_SEQUENCE_WINDOW, DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SESSION_LEASE_MS, MAX_MESSAGE_SIZE_BYTES, MAX_PAYLOAD_SIZE_BYTES, } from './types.js';
export { MessageType, ProtocolErrorCode, } from './types.js';
// Session types from session.js
export { SessionManager, generateSessionId, generateChannelId, generateDeviceId, createSessionLease, isLeaseValid, getLeaseTimeRemaining, revokeLease, } from './session.js';
// Heartbeat types from heartbeat.js
export { HeartbeatManager, DEFAULT_HEARTBEAT_CONFIG, createHeartbeatPayload, createHeartbeatMessage, isHeartbeatExpired, timeUntilNextHeartbeat, determineHeartbeatStatus, validateHeartbeatPayload, } from './heartbeat.js';
// Backpressure types from backpressure.js
export { BackpressureManager, DEFAULT_BACKPRESSURE_THRESHOLDS, createBackpressureBeginPayload, createBackpressureEndPayload, createBackpressureBeginMessage, createBackpressureEndMessage, validateBackpressurePayload, calculateRecommendedWindow, } from './backpressure.js';
// Serialization
export { serializeMessage, deserializeMessage, validateMessage, validateSerializedMessage, isVersionCompatible, encodePayload, decodePayload, encodeBase64, decodeBase64, getSerializedSize, ProtocolValidationError, createMessage, } from './serialization.js';
// Sequence tracking
export { SequenceTracker, defaultSequenceTracker, } from './sequence.js';
// TLS configuration
export { DEFAULT_TLS_CONFIG, createServerTLSConfig, createClientTLSConfig, createMTLSConfig, validateTLSConfig, requiresClientCert, getSecureCipherSuites, getCompatibleCipherSuites, toNodeTLSOptions, SECURITY_OPTIONS, } from './tls.js';
// Rate limiting
export { RateLimiter, SessionRateLimiter, DEFAULT_RATE_LIMIT_CONFIG, createRateLimitPayload, createRateLimitMessage, calculateRateLimit, } from './ratelimit.js';
//# sourceMappingURL=index.js.map