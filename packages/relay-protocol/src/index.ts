/**
 * Relay Protocol Package
 *
 * TypeScript types and utilities for the CDP relay wire protocol.
 * Used by clients (desktop connector, browser extension) and server (cdp-relay).
 */

// Types from types.js
export {
  // Core types
  RelayMessage,
  SerializedRelayMessage,
  CDPFramePayload,
  HelloPayload,
  HelloACKPayload,
  SessionCreatePayload,
  SessionCreateACKPayload,
  SessionRenewPayload,
  SessionRevokePayload,
  ChannelOpenPayload,
  BackpressurePayload,
  RateLimitPayload,
  ErrorPayload,
  HeartbeatPayload,
  SessionLease,
  SequenceState,
  TLSConfig,
  RateLimiterConfig,
  RateLimitState,
  BackpressureState,
  ValidationResult,
  ValidationError,
  ProtocolOptions,
  CreateMessageOptions,
} from './types.js';

export {
  // Constants
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  MAX_SEQUENCE_WINDOW,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_SESSION_LEASE_MS,
  MAX_MESSAGE_SIZE_BYTES,
  MAX_PAYLOAD_SIZE_BYTES,
} from './types.js';

export {
  MessageType,
  ProtocolErrorCode,
} from './types.js';

// Session types from session.js
export {
  Session,
  SessionState,
  SessionManager,
  generateSessionId,
  generateChannelId,
  generateDeviceId,
  createSessionLease,
  isLeaseValid,
  getLeaseTimeRemaining,
  revokeLease,
} from './session.js';

// Heartbeat types from heartbeat.js
export {
  HeartbeatManager,
  HeartbeatState,
  HeartbeatStatus,
  DEFAULT_HEARTBEAT_CONFIG,
  createHeartbeatPayload,
  createHeartbeatMessage,
  isHeartbeatExpired,
  timeUntilNextHeartbeat,
  determineHeartbeatStatus,
  validateHeartbeatPayload,
} from './heartbeat.js';

// Backpressure types from backpressure.js
export {
  BackpressureManager,
  BackpressureReason,
  BackpressureThresholds,
  DEFAULT_BACKPRESSURE_THRESHOLDS,
  createBackpressureBeginPayload,
  createBackpressureEndPayload,
  createBackpressureBeginMessage,
  createBackpressureEndMessage,
  validateBackpressurePayload,
  calculateRecommendedWindow,
} from './backpressure.js';

// Serialization
export {
  serializeMessage,
  deserializeMessage,
  validateMessage,
  validateSerializedMessage,
  isVersionCompatible,
  encodePayload,
  decodePayload,
  encodeBase64,
  decodeBase64,
  getSerializedSize,
  ProtocolValidationError,
  createMessage,
} from './serialization.js';

// Sequence tracking
export {
  SequenceTracker,
  defaultSequenceTracker,
} from './sequence.js';

// TLS configuration
export {
  DEFAULT_TLS_CONFIG,
  ServerTLSConfig,
  ClientTLSConfig,
  MTLSConfig,
  NodeTLSOptions,
  createServerTLSConfig,
  createClientTLSConfig,
  createMTLSConfig,
  validateTLSConfig,
  requiresClientCert,
  getSecureCipherSuites,
  getCompatibleCipherSuites,
  toNodeTLSOptions,
  SECURITY_OPTIONS,
} from './tls.js';

// Rate limiting
export {
  RateLimiter,
  SessionRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
  createRateLimitPayload,
  createRateLimitMessage,
  calculateRateLimit,
} from './ratelimit.js';
