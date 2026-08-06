/**
 * Message serialization and deserialization
 *
 * Uses JSON with base64 encoding for binary payloads.
 * All messages are validated during deserialization.
 */
import { RelayMessage, SerializedRelayMessage, ProtocolErrorCode, ValidationResult, ValidationError, CreateMessageOptions } from './types.js';
/**
 * Encode a Uint8Array to base64 string
 */
export declare function encodeBase64(data: Uint8Array): string;
/**
 * Decode a base64 string to Uint8Array
 */
export declare function decodeBase64(encoded: string): Uint8Array;
/**
 * Serialize a RelayMessage to JSON string
 * Binary payloads are base64 encoded
 */
export declare function serializeMessage(message: RelayMessage): string;
/**
 * Deserialize JSON string to RelayMessage
 * Base64 payloads are decoded to Uint8Array
 */
export declare function deserializeMessage(data: string): RelayMessage;
/**
 * Encode payload to base64 if it's binary
 */
export declare function encodePayload(payload: Uint8Array | string): string;
/**
 * Decode payload from base64 if needed
 */
export declare function decodePayload(encoded: string): Uint8Array | string;
/**
 * Validate a serialized message structure
 */
export declare function validateSerializedMessage(msg: SerializedRelayMessage): ValidationResult;
/**
 * Check if a protocol version is compatible (major version match)
 */
export declare function isVersionCompatible(version: string): boolean;
/**
 * Validate a deserialized RelayMessage
 */
export declare function validateMessage(msg: RelayMessage): ValidationResult;
/**
 * Custom error class for protocol validation failures
 */
export declare class ProtocolValidationError extends Error {
    readonly code: ProtocolErrorCode;
    readonly errors: ValidationError[];
    constructor(code: ProtocolErrorCode, message: string, errors: ValidationError[]);
}
/**
 * Get the size of a serialized message in bytes
 */
export declare function getSerializedSize(msg: RelayMessage): number;
/**
 * Create a new RelayMessage with the given options
 *
 * This is a convenience function that builds a properly formatted message.
 */
export declare function createMessage(options: CreateMessageOptions): RelayMessage;
//# sourceMappingURL=serialization.d.ts.map