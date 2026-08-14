/**
 * Error types for the Brotto Platform SDK
 */
/**
 * Base class for all SDK errors
 */
export class FaraSDKError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code = 'SDK_ERROR', statusCode = 500, details) {
        super(message);
        this.name = 'FaraSDKError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}
/**
 * Authentication related errors
 */
export class AuthenticationError extends FaraSDKError {
    constructor(message = 'Authentication failed', details) {
        super(message, 'AUTHENTICATION_ERROR', 401, details);
        this.name = 'AuthenticationError';
    }
}
/**
 * Invalid or expired token
 */
export class TokenExpiredError extends AuthenticationError {
    constructor(message = 'Token has expired', details) {
        super(message, details);
        this.name = 'TokenExpiredError';
        this.code = 'TOKEN_EXPIRED';
    }
}
/**
 * Authorization/access control errors
 */
export class AuthorizationError extends FaraSDKError {
    constructor(message = 'Access denied', details) {
        super(message, 'AUTHORIZATION_ERROR', 403, details);
        this.name = 'AuthorizationError';
    }
}
/**
 * Resource not found errors
 */
export class NotFoundError extends FaraSDKError {
    constructor(resource, id, details) {
        const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
        super(message, 'NOT_FOUND', 404, details);
        this.name = 'NotFoundError';
    }
}
/**
 * Validation errors for request data
 */
export class ValidationError extends FaraSDKError {
    validationErrors;
    constructor(message = 'Validation failed', validationErrors, details) {
        super(message, 'VALIDATION_ERROR', 400, details);
        this.name = 'ValidationError';
        this.validationErrors = validationErrors;
    }
}
/**
 * Rate limiting errors
 */
export class RateLimitError extends FaraSDKError {
    retryAfter;
    constructor(message = 'Rate limit exceeded', retryAfter, details) {
        super(message, 'RATE_LIMIT_ERROR', 429, details);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}
/**
 * Session related errors
 */
export class SessionError extends FaraSDKError {
    constructor(message, details) {
        super(message, 'SESSION_ERROR', 400, details);
        this.name = 'SessionError';
    }
}
/**
 * Session not found or expired
 */
export class SessionNotFoundError extends SessionError {
    constructor(sessionId) {
        super(`Session '${sessionId}' not found or expired`);
        this.name = 'SessionNotFoundError';
        this.code = 'SESSION_NOT_FOUND';
        this.statusCode = 404;
    }
}
/**
 * Session already terminated
 */
export class SessionTerminatedError extends SessionError {
    constructor(sessionId, reason) {
        const message = reason
            ? `Session '${sessionId}' has been terminated: ${reason}`
            : `Session '${sessionId}' has been terminated`;
        super(message);
        this.name = 'SessionTerminatedError';
        this.code = 'SESSION_TERMINATED';
    }
}
/**
 * Task related errors
 */
export class TaskError extends FaraSDKError {
    constructor(message, details) {
        super(message, 'TASK_ERROR', 400, details);
        this.name = 'TaskError';
    }
}
/**
 * Task not found
 */
export class TaskNotFoundError extends TaskError {
    constructor(taskId) {
        super(`Task '${taskId}' not found`);
        this.name = 'TaskNotFoundError';
        this.code = 'TASK_NOT_FOUND';
        this.statusCode = 404;
    }
}
/**
 * Approval related errors
 */
export class ApprovalError extends FaraSDKError {
    constructor(message, details) {
        super(message, 'APPROVAL_ERROR', 400, details);
        this.name = 'ApprovalError';
    }
}
/**
 * Approval request not found
 */
export class ApprovalNotFoundError extends ApprovalError {
    constructor(approvalId) {
        super(`Approval request '${approvalId}' not found`);
        this.name = 'ApprovalNotFoundError';
        this.code = 'APPROVAL_NOT_FOUND';
        this.statusCode = 404;
    }
}
/**
 * Approval already decided
 */
export class ApprovalAlreadyDecidedError extends ApprovalError {
    constructor(approvalId, currentStatus) {
        super(`Approval request '${approvalId}' has already been ${currentStatus}`);
        this.name = 'ApprovalAlreadyDecidedError';
        this.code = 'APPROVAL_ALREADY_DECIDED';
    }
}
/**
 * Approval expired
 */
export class ApprovalExpiredError extends ApprovalError {
    constructor(approvalId) {
        super(`Approval request '${approvalId}' has expired`);
        this.name = 'ApprovalExpiredError';
        this.code = 'APPROVAL_EXPIRED';
    }
}
/**
 * Network/connection errors
 */
export class NetworkError extends FaraSDKError {
    constructor(message = 'Network error occurred', details) {
        super(message, 'NETWORK_ERROR', 0, details);
        this.name = 'NetworkError';
    }
}
/**
 * WebSocket connection errors
 */
export class WebSocketError extends FaraSDKError {
    constructor(message, details) {
        super(message, 'WEBSOCKET_ERROR', 0, details);
        this.name = 'WebSocketError';
    }
}
/**
 * WebSocket connection closed
 */
export class WebSocketClosedError extends WebSocketError {
    code;
    reason;
    constructor(code = 1000, reason) {
        const message = reason ? `WebSocket closed: ${reason}` : `WebSocket closed with code ${code}`;
        super(message);
        this.name = 'WebSocketClosedError';
        this.code = code;
        this.reason = reason;
    }
}
/**
 * Timeout errors
 */
export class TimeoutError extends FaraSDKError {
    constructor(message = 'Operation timed out', details) {
        super(message, 'TIMEOUT_ERROR', 0, details);
        this.name = 'TimeoutError';
    }
}
/**
 * Server errors (5xx)
 */
export class ServerError extends FaraSDKError {
    constructor(message = 'Internal server error', details) {
        super(message, 'SERVER_ERROR', 500, details);
        this.name = 'ServerError';
    }
}
/**
 * Bad gateway error (502)
 */
export class BadGatewayError extends ServerError {
    constructor(message = 'Bad gateway', details) {
        super(message, details);
        this.name = 'BadGatewayError';
        this.code = 'BAD_GATEWAY';
        this.statusCode = 502;
    }
}
/**
 * Service unavailable error (503)
 */
export class ServiceUnavailableError extends ServerError {
    constructor(message = 'Service unavailable', details) {
        super(message, details);
        this.name = 'ServiceUnavailableError';
        this.code = 'SERVICE_UNAVAILABLE';
        this.statusCode = 503;
    }
}
/**
 * Check if an error is an SDK error
 */
export function isSDKError(error) {
    return error instanceof FaraSDKError;
}
/**
 * Check if an error is an authentication error
 */
export function isAuthenticationError(error) {
    return error instanceof AuthenticationError;
}
/**
 * Check if an error is a network error
 */
export function isNetworkError(error) {
    return error instanceof NetworkError;
}
//# sourceMappingURL=errors.js.map