/**
 * Error types for the Brotto Platform SDK
 */
/**
 * Base class for all SDK errors
 */
export declare class FaraSDKError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: unknown;
    constructor(message: string, code?: string, statusCode?: number, details?: unknown);
}
/**
 * Authentication related errors
 */
export declare class AuthenticationError extends FaraSDKError {
    constructor(message?: string, details?: unknown);
}
/**
 * Invalid or expired token
 */
export declare class TokenExpiredError extends AuthenticationError {
    constructor(message?: string, details?: unknown);
}
/**
 * Authorization/access control errors
 */
export declare class AuthorizationError extends FaraSDKError {
    constructor(message?: string, details?: unknown);
}
/**
 * Resource not found errors
 */
export declare class NotFoundError extends FaraSDKError {
    constructor(resource: string, id?: string, details?: unknown);
}
/**
 * Validation errors for request data
 */
export declare class ValidationError extends FaraSDKError {
    readonly validationErrors?: unknown[];
    constructor(message?: string, validationErrors?: unknown[], details?: unknown);
}
/**
 * Rate limiting errors
 */
export declare class RateLimitError extends FaraSDKError {
    readonly retryAfter?: number;
    constructor(message?: string, retryAfter?: number, details?: unknown);
}
/**
 * Session related errors
 */
export declare class SessionError extends FaraSDKError {
    constructor(message: string, details?: unknown);
}
/**
 * Session not found or expired
 */
export declare class SessionNotFoundError extends SessionError {
    constructor(sessionId: string);
}
/**
 * Session already terminated
 */
export declare class SessionTerminatedError extends SessionError {
    constructor(sessionId: string, reason?: string);
}
/**
 * Task related errors
 */
export declare class TaskError extends FaraSDKError {
    constructor(message: string, details?: unknown);
}
/**
 * Task not found
 */
export declare class TaskNotFoundError extends TaskError {
    constructor(taskId: string);
}
/**
 * Approval related errors
 */
export declare class ApprovalError extends FaraSDKError {
    constructor(message: string, details?: unknown);
}
/**
 * Approval request not found
 */
export declare class ApprovalNotFoundError extends ApprovalError {
    constructor(approvalId: string);
}
/**
 * Approval already decided
 */
export declare class ApprovalAlreadyDecidedError extends ApprovalError {
    constructor(approvalId: string, currentStatus: string);
}
/**
 * Approval expired
 */
export declare class ApprovalExpiredError extends ApprovalError {
    constructor(approvalId: string);
}
/**
 * Network/connection errors
 */
export declare class NetworkError extends FaraSDKError {
    constructor(message?: string, details?: unknown);
}
/**
 * WebSocket connection errors
 */
export declare class WebSocketError extends FaraSDKError {
    constructor(message: string, details?: unknown);
}
/**
 * WebSocket connection closed
 */
export declare class WebSocketClosedError extends WebSocketError {
    readonly code: number;
    readonly reason?: string;
    constructor(code?: number, reason?: string);
}
/**
 * Timeout errors
 */
export declare class TimeoutError extends FaraSDKError {
    constructor(message?: string, details?: unknown);
}
/**
 * Server errors (5xx)
 */
export declare class ServerError extends FaraSDKError {
    constructor(message?: string, details?: unknown);
}
/**
 * Bad gateway error (502)
 */
export declare class BadGatewayError extends ServerError {
    constructor(message?: string, details?: unknown);
}
/**
 * Service unavailable error (503)
 */
export declare class ServiceUnavailableError extends ServerError {
    constructor(message?: string, details?: unknown);
}
/**
 * API response error - when API returns an error response
 */
export interface APIErrorResponse {
    error: string;
    message: string;
    statusCode: number;
    details?: unknown;
}
/**
 * Check if an error is an SDK error
 */
export declare function isSDKError(error: unknown): error is FaraSDKError;
/**
 * Check if an error is an authentication error
 */
export declare function isAuthenticationError(error: unknown): error is AuthenticationError;
/**
 * Check if an error is a network error
 */
export declare function isNetworkError(error: unknown): error is NetworkError;
//# sourceMappingURL=errors.d.ts.map