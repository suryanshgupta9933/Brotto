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
export var MessageType;
(function (MessageType) {
    // Control messages
    MessageType["HELLO"] = "HELLO";
    MessageType["HELLO_ACK"] = "HELLO_ACK";
    MessageType["HEARTBEAT"] = "HEARTBEAT";
    MessageType["HEARTBEAT_ACK"] = "HEARTBEAT_ACK";
    MessageType["GOODBYE"] = "GOODBYE";
    MessageType["ERROR"] = "ERROR";
    // Session messages
    MessageType["SESSION_CREATE"] = "SESSION_CREATE";
    MessageType["SESSION_CREATE_ACK"] = "SESSION_CREATE_ACK";
    MessageType["SESSION_CREATE_ERROR"] = "SESSION_CREATE_ERROR";
    MessageType["SESSION_RENEW"] = "SESSION_RENEW";
    MessageType["SESSION_RENEW_ACK"] = "SESSION_RENEW_ACK";
    MessageType["SESSION_REVOKE"] = "SESSION_REVOKE";
    MessageType["SESSION_REVOKED"] = "SESSION_REVOKED";
    // Channel messages
    MessageType["CHANNEL_OPEN"] = "CHANNEL_OPEN";
    MessageType["CHANNEL_OPEN_ACK"] = "CHANNEL_OPEN_ACK";
    MessageType["CHANNEL_OPEN_ERROR"] = "CHANNEL_OPEN_ERROR";
    MessageType["CHANNEL_CLOSE"] = "CHANNEL_CLOSE";
    MessageType["CHANNEL_CLOSED"] = "CHANNEL_CLOSED";
    // CDP frames
    MessageType["CDP_FRAME"] = "CDP_FRAME";
    MessageType["CDP_FRAME_ACK"] = "CDP_FRAME_ACK";
    // Backpressure signals
    MessageType["BACKPRESSURE_BEGIN"] = "BACKPRESSURE_BEGIN";
    MessageType["BACKPRESSURE_END"] = "BACKPRESSURE_END";
    MessageType["RATE_LIMIT_UPDATE"] = "RATE_LIMIT_UPDATE";
})(MessageType || (MessageType = {}));
// Error codes
export var ProtocolErrorCode;
(function (ProtocolErrorCode) {
    ProtocolErrorCode["PROTOCOL_VERSION_MISMATCH"] = "PROTOCOL_VERSION_MISMATCH";
    ProtocolErrorCode["SEQUENCE_NUMBER_INVALID"] = "SEQUENCE_NUMBER_INVALID";
    ProtocolErrorCode["SEQUENCE_NUMBER_REPLAY"] = "SEQUENCE_NUMBER_REPLAY";
    ProtocolErrorCode["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    ProtocolErrorCode["SESSION_REVOKED"] = "SESSION_REVOKED";
    ProtocolErrorCode["CHANNEL_NOT_FOUND"] = "CHANNEL_NOT_FOUND";
    ProtocolErrorCode["CHANNEL_ALREADY_OPEN"] = "CHANNEL_ALREADY_OPEN";
    ProtocolErrorCode["PAYLOAD_TOO_LARGE"] = "PAYLOAD_TOO_LARGE";
    ProtocolErrorCode["MESSAGE_TYPE_INVALID"] = "MESSAGE_TYPE_INVALID";
    ProtocolErrorCode["SIGNATURE_INVALID"] = "SIGNATURE_INVALID";
    ProtocolErrorCode["AUTHENTICATION_FAILED"] = "AUTHENTICATION_FAILED";
    ProtocolErrorCode["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ProtocolErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ProtocolErrorCode || (ProtocolErrorCode = {}));
//# sourceMappingURL=types.js.map