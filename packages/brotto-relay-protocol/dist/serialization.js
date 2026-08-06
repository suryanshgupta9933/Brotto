/**
 * Message serialization and deserialization
 *
 * Uses JSON with base64 encoding for binary payloads.
 * All messages are validated during deserialization.
 */
import { MessageType, ProtocolErrorCode, PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, MAX_MESSAGE_SIZE_BYTES, MAX_PAYLOAD_SIZE_BYTES, DEFAULT_SESSION_LEASE_MS, } from './types.js';
/**
 * Encode a Uint8Array to base64 string
 */
export function encodeBase64(data) {
    // For Node.js environments
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(data).toString('base64');
    }
    // For browser environments
    const binaryString = Array.from(data)
        .map((byte) => String.fromCharCode(byte))
        .join('');
    return btoa(binaryString);
}
/**
 * Decode a base64 string to Uint8Array
 */
export function decodeBase64(encoded) {
    // For Node.js environments
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(encoded, 'base64'));
    }
    // For browser environments
    const binaryString = atob(encoded);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}
/**
 * Serialize a RelayMessage to JSON string
 * Binary payloads are base64 encoded
 */
export function serializeMessage(message) {
    const serialized = {
        protocolVersion: message.protocolVersion,
        tenantId: message.tenantId,
        sessionId: message.sessionId,
        deviceId: message.deviceId,
        channelId: message.channelId,
        sequenceNumber: message.sequenceNumber,
        messageType: message.messageType,
        expiry: message.expiry,
        payload: encodePayload(message.payload),
        signature: message.signature,
    };
    return JSON.stringify(serialized);
}
/**
 * Deserialize JSON string to RelayMessage
 * Base64 payloads are decoded to Uint8Array
 */
export function deserializeMessage(data) {
    const parsed = JSON.parse(data);
    // Validate required fields exist
    const validation = validateSerializedMessage(parsed);
    if (!validation.isValid && validation.errors.length > 0) {
        const firstError = validation.errors[0];
        throw new ProtocolValidationError(firstError.code, firstError.message, validation.errors);
    }
    return {
        protocolVersion: parsed.protocolVersion,
        tenantId: parsed.tenantId,
        sessionId: parsed.sessionId,
        deviceId: parsed.deviceId,
        channelId: parsed.channelId,
        sequenceNumber: parsed.sequenceNumber,
        messageType: parsed.messageType,
        expiry: parsed.expiry,
        payload: decodePayload(parsed.payload),
        signature: parsed.signature,
    };
}
/**
 * Encode payload to base64 if it's binary
 */
export function encodePayload(payload) {
    if (typeof payload === 'string') {
        return payload;
    }
    return encodeBase64(payload);
}
/**
 * Decode payload from base64 if needed
 */
export function decodePayload(encoded) {
    // Check if it looks like base64 (alphanumeric + / + =)
    if (/^[A-Za-z0-9+/]+=*$/.test(encoded)) {
        // Try to detect if it's actually binary data
        // Binary data tends to have more high-byte characters after decoding
        try {
            const decoded = decodeBase64(encoded);
            // If the decoded result has any null bytes or high entropy,
            // it's likely binary. Otherwise, return as string.
            const asString = new TextDecoder().decode(decoded);
            // If it decodes cleanly to valid UTF-8, return as string
            if (isValidUtf8(decoded)) {
                return asString;
            }
            return decoded;
        }
        catch {
            // If base64 decode fails, return as-is (might be plain string)
            return encoded;
        }
    }
    return encoded;
}
/**
 * Check if Uint8Array contains valid UTF-8 string
 */
function isValidUtf8(data) {
    try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(data);
        // Check for replacement characters which indicate invalid UTF-8
        return !decoded.includes('�');
    }
    catch {
        return false;
    }
}
/**
 * Validate a serialized message structure
 */
export function validateSerializedMessage(msg) {
    const errors = [];
    // Required string fields
    const requiredStrings = [
        'protocolVersion',
        'tenantId',
        'sessionId',
        'deviceId',
        'channelId',
    ];
    for (const field of requiredStrings) {
        if (!msg[field] || typeof msg[field] !== 'string') {
            errors.push({
                field,
                message: `Field ${field} is required and must be a string`,
                code: ProtocolErrorCode.MESSAGE_TYPE_INVALID,
            });
        }
    }
    // Validate protocol version
    if (msg.protocolVersion) {
        if (!isVersionCompatible(msg.protocolVersion)) {
            errors.push({
                field: 'protocolVersion',
                message: `Protocol version ${msg.protocolVersion} is not compatible. Minimum: ${MIN_PROTOCOL_VERSION}`,
                code: ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH,
            });
        }
    }
    // Validate sequence number
    if (typeof msg.sequenceNumber !== 'number' || msg.sequenceNumber < 0 || !Number.isInteger(msg.sequenceNumber)) {
        errors.push({
            field: 'sequenceNumber',
            message: 'Sequence number must be a non-negative integer',
            code: ProtocolErrorCode.SEQUENCE_NUMBER_INVALID,
        });
    }
    // Validate message type
    if (!Object.values(MessageType).includes(msg.messageType)) {
        errors.push({
            field: 'messageType',
            message: `Invalid message type: ${msg.messageType}`,
            code: ProtocolErrorCode.MESSAGE_TYPE_INVALID,
        });
    }
    // Validate expiry
    if (typeof msg.expiry !== 'number' || msg.expiry < 0) {
        errors.push({
            field: 'expiry',
            message: 'Expiry must be a non-negative number (Unix timestamp in ms)',
            code: ProtocolErrorCode.MESSAGE_TYPE_INVALID,
        });
    }
    // Validate payload
    if (!msg.payload || typeof msg.payload !== 'string') {
        errors.push({
            field: 'payload',
            message: 'Payload is required and must be a string (base64 encoded)',
            code: ProtocolErrorCode.MESSAGE_TYPE_INVALID,
        });
    }
    // Validate message size
    const msgSize = new TextEncoder().encode(JSON.stringify(msg)).length;
    if (msgSize > MAX_MESSAGE_SIZE_BYTES) {
        errors.push({
            field: 'payload',
            message: `Message size ${msgSize} exceeds maximum ${MAX_MESSAGE_SIZE_BYTES} bytes`,
            code: ProtocolErrorCode.PAYLOAD_TOO_LARGE,
        });
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Check if a protocol version is compatible (major version match)
 */
export function isVersionCompatible(version) {
    const [major] = version.split('.').map(Number);
    const [minMajor] = MIN_PROTOCOL_VERSION.split('.').map(Number);
    return major === minMajor;
}
/**
 * Validate a deserialized RelayMessage
 */
export function validateMessage(msg) {
    const errors = [];
    // Check required fields
    if (!msg.protocolVersion) {
        errors.push({ field: 'protocolVersion', message: 'Protocol version is required', code: ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH });
    }
    if (!msg.tenantId) {
        errors.push({ field: 'tenantId', message: 'Tenant ID is required', code: ProtocolErrorCode.AUTHENTICATION_FAILED });
    }
    if (!msg.sessionId) {
        errors.push({ field: 'sessionId', message: 'Session ID is required', code: ProtocolErrorCode.SESSION_EXPIRED });
    }
    if (!msg.deviceId) {
        errors.push({ field: 'deviceId', message: 'Device ID is required', code: ProtocolErrorCode.AUTHENTICATION_FAILED });
    }
    if (!msg.channelId) {
        errors.push({ field: 'channelId', message: 'Channel ID is required', code: ProtocolErrorCode.CHANNEL_NOT_FOUND });
    }
    // Check expiry
    if (msg.expiry < Date.now()) {
        errors.push({ field: 'expiry', message: 'Message has expired', code: ProtocolErrorCode.SESSION_EXPIRED });
    }
    // Check payload size (only if we can measure it)
    if (msg.payload instanceof Uint8Array && msg.payload.length > MAX_PAYLOAD_SIZE_BYTES) {
        errors.push({
            field: 'payload',
            message: `Payload size ${msg.payload.length} exceeds maximum ${MAX_PAYLOAD_SIZE_BYTES} bytes`,
            code: ProtocolErrorCode.PAYLOAD_TOO_LARGE,
        });
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Custom error class for protocol validation failures
 */
export class ProtocolValidationError extends Error {
    code;
    errors;
    constructor(code, message, errors) {
        super(message);
        this.code = code;
        this.errors = errors;
        this.name = 'ProtocolValidationError';
    }
}
/**
 * Get the size of a serialized message in bytes
 */
export function getSerializedSize(msg) {
    return new TextEncoder().encode(serializeMessage(msg)).length;
}
/**
 * Create a new RelayMessage with the given options
 *
 * This is a convenience function that builds a properly formatted message.
 */
export function createMessage(options) {
    const { protocolVersion = PROTOCOL_VERSION, tenantId, sessionId, deviceId, channelId, expiry = Date.now() + DEFAULT_SESSION_LEASE_MS, messageType, payload, signature, } = options;
    // Convert payload to proper format
    let processedPayload;
    if (typeof payload === 'string') {
        // Try to detect if it's already base64 or a plain string
        processedPayload = payload;
    }
    else if (payload instanceof Uint8Array) {
        processedPayload = payload;
    }
    else if (typeof payload === 'object') {
        // JSON-serialize objects
        processedPayload = JSON.stringify(payload);
    }
    else {
        processedPayload = String(payload);
    }
    // Determine sequence number
    let sequenceNumber;
    if ('sequenceNumber' in options && typeof options.sequenceNumber === 'number') {
        sequenceNumber = options.sequenceNumber;
    }
    else {
        sequenceNumber = 0;
    }
    return {
        protocolVersion,
        tenantId,
        sessionId,
        deviceId,
        channelId,
        sequenceNumber,
        messageType,
        expiry,
        payload: processedPayload,
        signature,
    };
}
//# sourceMappingURL=serialization.js.map