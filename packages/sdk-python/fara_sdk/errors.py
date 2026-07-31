"""
Error types for the Fara1.5 Platform SDK
"""
from typing import Optional, List, Dict, Any


class FaraSDKError(Exception):
    """Base class for all SDK errors."""

    def __init__(
        self,
        message: str,
        code: str = "SDK_ERROR",
        status_code: int = 500,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details

    def __repr__(self) -> str:
        return f"FaraSDKError({self.message!r}, code={self.code!r}, status_code={self.status_code})"


class AuthenticationError(FaraSDKError):
    """Authentication related errors."""

    def __init__(self, message: str = "Authentication failed", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "AUTHENTICATION_ERROR", 401, details)
        self.name = "AuthenticationError"


class TokenExpiredError(AuthenticationError):
    """Invalid or expired token."""

    def __init__(self, message: str = "Token has expired", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, details)
        self.name = "TokenExpiredError"
        self.code = "TOKEN_EXPIRED"


class AuthorizationError(FaraSDKError):
    """Authorization/access control errors."""

    def __init__(self, message: str = "Access denied", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "AUTHORIZATION_ERROR", 403, details)
        self.name = "AuthorizationError"


class NotFoundError(FaraSDKError):
    """Resource not found errors."""

    def __init__(
        self, resource: str, resource_id: Optional[str] = None, details: Optional[Dict[str, Any]] = None
    ):
        message = f"{resource} with id '{resource_id}' not found" if resource_id else f"{resource} not found"
        super().__init__(message, "NOT_FOUND", 404, details)
        self.name = "NotFoundError"


class ValidationError(FaraSDKError):
    """Validation errors for request data."""

    def __init__(
        self,
        message: str = "Validation failed",
        validation_errors: Optional[List[Dict[str, Any]]] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message, "VALIDATION_ERROR", 400, details)
        self.name = "ValidationError"
        self.validation_errors = validation_errors


class RateLimitError(FaraSDKError):
    """Rate limiting errors."""

    def __init__(
        self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None, details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message, "RATE_LIMIT_ERROR", 429, details)
        self.name = "RateLimitError"
        self.retry_after = retry_after


class SessionError(FaraSDKError):
    """Session related errors."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "SESSION_ERROR", 400, details)
        self.name = "SessionError"


class SessionNotFoundError(SessionError):
    """Session not found or expired."""

    def __init__(self, session_id: str):
        super().__init__(f"Session '{session_id}' not found or expired")
        self.name = "SessionNotFoundError"
        self.code = "SESSION_NOT_FOUND"
        self.status_code = 404


class SessionTerminatedError(SessionError):
    """Session already terminated."""

    def __init__(self, session_id: str, reason: Optional[str] = None):
        message = (
            f"Session '{session_id}' has been terminated: {reason}"
            if reason
            else f"Session '{session_id}' has been terminated"
        )
        super().__init__(message)
        self.name = "SessionTerminatedError"
        self.code = "SESSION_TERMINATED"


class TaskError(FaraSDKError):
    """Task related errors."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "TASK_ERROR", 400, details)
        self.name = "TaskError"


class TaskNotFoundError(TaskError):
    """Task not found."""

    def __init__(self, task_id: str):
        super().__init__(f"Task '{task_id}' not found")
        self.name = "TaskNotFoundError"
        self.code = "TASK_NOT_FOUND"
        self.status_code = 404


class ApprovalError(FaraSDKError):
    """Approval related errors."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "APPROVAL_ERROR", 400, details)
        self.name = "ApprovalError"


class ApprovalNotFoundError(ApprovalError):
    """Approval request not found."""

    def __init__(self, approval_id: str):
        super().__init__(f"Approval request '{approval_id}' not found")
        self.name = "ApprovalNotFoundError"
        self.code = "APPROVAL_NOT_FOUND"
        self.status_code = 404


class ApprovalAlreadyDecidedError(ApprovalError):
    """Approval already decided."""

    def __init__(self, approval_id: str, current_status: str):
        super().__init__(f"Approval request '{approval_id}' has already been {current_status}")
        self.name = "ApprovalAlreadyDecidedError"
        self.code = "APPROVAL_ALREADY_DECIDED"


class ApprovalExpiredError(ApprovalError):
    """Approval expired."""

    def __init__(self, approval_id: str):
        super().__init__(f"Approval request '{approval_id}' has expired")
        self.name = "ApprovalExpiredError"
        self.code = "APPROVAL_EXPIRED"


class NetworkError(FaraSDKError):
    """Network/connection errors."""

    def __init__(self, message: str = "Network error occurred", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "NETWORK_ERROR", 0, details)
        self.name = "NetworkError"


class WebSocketError(FaraSDKError):
    """WebSocket connection errors."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "WEBSOCKET_ERROR", 0, details)
        self.name = "WebSocketError"


class WebSocketClosedError(WebSocketError):
    """WebSocket connection closed."""

    def __init__(self, code: int = 1000, reason: Optional[str] = None):
        message = f"WebSocket closed: {reason}" if reason else f"WebSocket closed with code {code}"
        super().__init__(message)
        self.name = "WebSocketClosedError"
        self.code = code
        self.reason = reason


class TimeoutError(FaraSDKError):
    """Timeout errors."""

    def __init__(self, message: str = "Operation timed out", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "TIMEOUT_ERROR", 0, details)
        self.name = "TimeoutError"


class ServerError(FaraSDKError):
    """Server errors (5xx)."""

    def __init__(self, message: str = "Internal server error", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, "SERVER_ERROR", 500, details)
        self.name = "ServerError"


class BadGatewayError(ServerError):
    """Bad gateway error (502)."""

    def __init__(self, message: str = "Bad gateway", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, details)
        self.name = "BadGatewayError"
        self.code = "BAD_GATEWAY"
        self.status_code = 502


class ServiceUnavailableError(ServerError):
    """Service unavailable error (503)."""

    def __init__(self, message: str = "Service unavailable", details: Optional[Dict[str, Any]] = None):
        super().__init__(message, details)
        self.name = "ServiceUnavailableError"
        self.code = "SERVICE_UNAVAILABLE"
        self.status_code = 503


# Type checking helpers
def is_sdk_error(error: Exception) -> bool:
    """Check if an error is an SDK error."""
    return isinstance(error, FaraSDKError)


def is_authentication_error(error: Exception) -> bool:
    """Check if an error is an authentication error."""
    return isinstance(error, AuthenticationError)


def is_network_error(error: Exception) -> bool:
    """Check if an error is a network error."""
    return isinstance(error, NetworkError)
