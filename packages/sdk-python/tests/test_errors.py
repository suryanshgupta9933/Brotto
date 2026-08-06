"""Tests for brotto_sdk.errors"""
import pytest
from brotto_sdk.errors import (
    FaraSDKError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ValidationError,
    RateLimitError,
    NetworkError,
    SessionNotFoundError,
    SessionTerminatedError,
    TaskNotFoundError,
    ApprovalNotFoundError,
    ApprovalAlreadyDecidedError,
    ApprovalExpiredError,
    WebSocketError,
    WebSocketClosedError,
    TimeoutError,
    ServerError,
    BadGatewayError,
    ServiceUnavailableError,
    is_sdk_error,
    is_authentication_error,
    is_network_error,
)


class TestFaraSDKError:
    """Tests for FaraSDKError."""

    def test_default_values(self):
        """Test error with default values."""
        error = FaraSDKError("Test error")
        assert error.message == "Test error"
        assert error.code == "SDK_ERROR"
        assert error.status_code == 500
        assert error.details is None

    def test_custom_values(self):
        """Test error with custom values."""
        error = FaraSDKError("Test error", "CUSTOM", 400, {"key": "value"})
        assert error.message == "Test error"
        assert error.code == "CUSTOM"
        assert error.status_code == 400
        assert error.details == {"key": "value"}

    def test_is_sdk_error(self):
        """Test is_sdk_error helper."""
        error = FaraSDKError("Test error")
        assert is_sdk_error(error) is True


class TestAuthenticationError:
    """Tests for AuthenticationError."""

    def test_default_message(self):
        """Test error with default message."""
        error = AuthenticationError()
        assert error.message == "Authentication failed"
        assert error.code == "AUTHENTICATION_ERROR"
        assert error.status_code == 401

    def test_custom_message(self):
        """Test error with custom message."""
        error = AuthenticationError("Token invalid")
        assert error.message == "Token invalid"

    def test_is_authentication_error(self):
        """Test is_authentication_error helper."""
        error = AuthenticationError()
        assert is_authentication_error(error) is True


class TestAuthorizationError:
    """Tests for AuthorizationError."""

    def test_default_message(self):
        """Test error with default message."""
        error = AuthorizationError()
        assert error.message == "Access denied"
        assert error.code == "AUTHORIZATION_ERROR"
        assert error.status_code == 403


class TestNotFoundError:
    """Tests for NotFoundError."""

    def test_with_resource_and_id(self):
        """Test error with resource and ID."""
        error = NotFoundError("Task", "123")
        assert error.message == "Task with id '123' not found"
        assert error.code == "NOT_FOUND"
        assert error.status_code == 404

    def test_with_resource_only(self):
        """Test error with resource only."""
        error = NotFoundError("Resource")
        assert error.message == "Resource not found"


class TestValidationError:
    """Tests for ValidationError."""

    def test_with_validation_errors(self):
        """Test error with validation errors."""
        validation_errors = [{"field": "goal", "message": "required"}]
        error = ValidationError("Validation failed", validation_errors)
        assert error.message == "Validation failed"
        assert error.code == "VALIDATION_ERROR"
        assert error.status_code == 400
        assert error.validation_errors == validation_errors


class TestRateLimitError:
    """Tests for RateLimitError."""

    def test_with_retry_after(self):
        """Test error with retry_after."""
        error = RateLimitError("Rate limit exceeded", 60)
        assert error.message == "Rate limit exceeded"
        assert error.code == "RATE_LIMIT_ERROR"
        assert error.status_code == 429
        assert error.retry_after == 60


class TestNetworkError:
    """Tests for NetworkError."""

    def test_default_message(self):
        """Test error with default message."""
        error = NetworkError()
        assert error.message == "Network error occurred"
        assert error.code == "NETWORK_ERROR"
        assert error.status_code == 0

    def test_is_network_error(self):
        """Test is_network_error helper."""
        error = NetworkError()
        assert is_network_error(error) is True


class TestSessionNotFoundError:
    """Tests for SessionNotFoundError."""

    def test_with_session_id(self):
        """Test error with session ID."""
        error = SessionNotFoundError("session-123")
        assert error.message == "Session 'session-123' not found or expired"
        assert error.code == "SESSION_NOT_FOUND"
        assert error.status_code == 404


class TestSessionTerminatedError:
    """Tests for SessionTerminatedError."""

    def test_with_session_id(self):
        """Test error with session ID."""
        error = SessionTerminatedError("session-123")
        assert error.message == "Session 'session-123' has been terminated"
        assert error.code == "SESSION_TERMINATED"

    def test_with_reason(self):
        """Test error with reason."""
        error = SessionTerminatedError("session-123", "user_requested")
        assert "user_requested" in error.message


class TestTaskNotFoundError:
    """Tests for TaskNotFoundError."""

    def test_with_task_id(self):
        """Test error with task ID."""
        error = TaskNotFoundError("task-456")
        assert error.message == "Task 'task-456' not found"
        assert error.code == "TASK_NOT_FOUND"
        assert error.status_code == 404


class TestApprovalNotFoundError:
    """Tests for ApprovalNotFoundError."""

    def test_with_approval_id(self):
        """Test error with approval ID."""
        error = ApprovalNotFoundError("approval-789")
        assert error.message == "Approval request 'approval-789' not found"
        assert error.code == "APPROVAL_NOT_FOUND"
        assert error.status_code == 404


class TestApprovalAlreadyDecidedError:
    """Tests for ApprovalAlreadyDecidedError."""

    def test_with_approval_id_and_status(self):
        """Test error with approval ID and current status."""
        error = ApprovalAlreadyDecidedError("approval-123", "approved")
        assert error.message == "Approval request 'approval-123' has already been approved"
        assert error.code == "APPROVAL_ALREADY_DECIDED"


class TestApprovalExpiredError:
    """Tests for ApprovalExpiredError."""

    def test_with_approval_id(self):
        """Test error with approval ID."""
        error = ApprovalExpiredError("approval-123")
        assert error.message == "Approval request 'approval-123' has expired"
        assert error.code == "APPROVAL_EXPIRED"


class TestWebSocketError:
    """Tests for WebSocketError."""

    def test_with_message(self):
        """Test error with message."""
        error = WebSocketError("Connection failed")
        assert error.message == "Connection failed"
        assert error.code == "WEBSOCKET_ERROR"
        assert error.status_code == 0


class TestWebSocketClosedError:
    """Tests for WebSocketClosedError."""

    def test_with_code(self):
        """Test error with code."""
        error = WebSocketClosedError(1000)
        assert "1000" in error.message
        assert error.code == 1000

    def test_with_reason(self):
        """Test error with reason."""
        error = WebSocketClosedError(1001, "Server closed")
        assert "Server closed" in error.message


class TestTimeoutError:
    """Tests for TimeoutError."""

    def test_default_message(self):
        """Test error with default message."""
        error = TimeoutError()
        assert error.message == "Operation timed out"
        assert error.code == "TIMEOUT_ERROR"


class TestServerError:
    """Tests for ServerError."""

    def test_default_message(self):
        """Test error with default message."""
        error = ServerError()
        assert error.message == "Internal server error"
        assert error.code == "SERVER_ERROR"
        assert error.status_code == 500


class TestBadGatewayError:
    """Tests for BadGatewayError."""

    def test_default_message(self):
        """Test error with default message."""
        error = BadGatewayError()
        assert error.message == "Bad gateway"
        assert error.code == "BAD_GATEWAY"
        assert error.status_code == 502


class TestServiceUnavailableError:
    """Tests for ServiceUnavailableError."""

    def test_default_message(self):
        """Test error with default message."""
        error = ServiceUnavailableError()
        assert error.message == "Service unavailable"
        assert error.code == "SERVICE_UNAVAILABLE"
        assert error.status_code == 503
