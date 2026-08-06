/**
 * Error types for the Brotto Platform SDK
 */

/**
 * Base class for all SDK errors
 */
export class FaraSDKError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string = 'SDK_ERROR',
    statusCode: number = 500,
    details?: unknown
  ) {
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
  constructor(message: string = 'Authentication failed', details?: unknown) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

/**
 * Invalid or expired token
 */
export class TokenExpiredError extends AuthenticationError {
  constructor(message: string = 'Token has expired', details?: unknown) {
    super(message, details);
    this.name = 'TokenExpiredError';
    this.code = 'TOKEN_EXPIRED';
  }
}

/**
 * Authorization/access control errors
 */
export class AuthorizationError extends FaraSDKError {
  constructor(message: string = 'Access denied', details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', 403, details);
    this.name = 'AuthorizationError';
  }
}

/**
 * Resource not found errors
 */
export class NotFoundError extends FaraSDKError {
  constructor(resource: string, id?: string, details?: unknown) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation errors for request data
 */
export class ValidationError extends FaraSDKError {
  public readonly validationErrors?: unknown[];

  constructor(message: string = 'Validation failed', validationErrors?: unknown[], details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
    this.validationErrors = validationErrors;
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends FaraSDKError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number, details?: unknown) {
    super(message, 'RATE_LIMIT_ERROR', 429, details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Session related errors
 */
export class SessionError extends FaraSDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'SESSION_ERROR', 400, details);
    this.name = 'SessionError';
  }
}

/**
 * Session not found or expired
 */
export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string) {
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
  constructor(sessionId: string, reason?: string) {
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
  constructor(message: string, details?: unknown) {
    super(message, 'TASK_ERROR', 400, details);
    this.name = 'TaskError';
  }
}

/**
 * Task not found
 */
export class TaskNotFoundError extends TaskError {
  constructor(taskId: string) {
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
  constructor(message: string, details?: unknown) {
    super(message, 'APPROVAL_ERROR', 400, details);
    this.name = 'ApprovalError';
  }
}

/**
 * Approval request not found
 */
export class ApprovalNotFoundError extends ApprovalError {
  constructor(approvalId: string) {
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
  constructor(approvalId: string, currentStatus: string) {
    super(`Approval request '${approvalId}' has already been ${currentStatus}`);
    this.name = 'ApprovalAlreadyDecidedError';
    this.code = 'APPROVAL_ALREADY_DECIDED';
  }
}

/**
 * Approval expired
 */
export class ApprovalExpiredError extends ApprovalError {
  constructor(approvalId: string) {
    super(`Approval request '${approvalId}' has expired`);
    this.name = 'ApprovalExpiredError';
    this.code = 'APPROVAL_EXPIRED';
  }
}

/**
 * Network/connection errors
 */
export class NetworkError extends FaraSDKError {
  constructor(message: string = 'Network error occurred', details?: unknown) {
    super(message, 'NETWORK_ERROR', 0, details);
    this.name = 'NetworkError';
  }
}

/**
 * WebSocket connection errors
 */
export class WebSocketError extends FaraSDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'WEBSOCKET_ERROR', 0, details);
    this.name = 'WebSocketError';
  }
}

/**
 * WebSocket connection closed
 */
export class WebSocketClosedError extends WebSocketError {
  public readonly code: number;
  public readonly reason?: string;

  constructor(code: number = 1000, reason?: string) {
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
  constructor(message: string = 'Operation timed out', details?: unknown) {
    super(message, 'TIMEOUT_ERROR', 0, details);
    this.name = 'TimeoutError';
  }
}

/**
 * Server errors (5xx)
 */
export class ServerError extends FaraSDKError {
  constructor(message: string = 'Internal server error', details?: unknown) {
    super(message, 'SERVER_ERROR', 500, details);
    this.name = 'ServerError';
  }
}

/**
 * Bad gateway error (502)
 */
export class BadGatewayError extends ServerError {
  constructor(message: string = 'Bad gateway', details?: unknown) {
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
  constructor(message: string = 'Service unavailable', details?: unknown) {
    super(message, details);
    this.name = 'ServiceUnavailableError';
    this.code = 'SERVICE_UNAVAILABLE';
    this.statusCode = 503;
  }
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
export function isSDKError(error: unknown): error is FaraSDKError {
  return error instanceof FaraSDKError;
}

/**
 * Check if an error is an authentication error
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

/**
 * Check if an error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}
