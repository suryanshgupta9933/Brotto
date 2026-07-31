"""
Main API client for the Fara1.5 Platform SDK
"""
import asyncio
from dataclasses import dataclass
from typing import Any, Callable, Optional, TypeVar
import httpx
from .types import (
    Task,
    Session,
    ApprovalRequest,
    PaginatedResponse,
    CreateTaskInput,
    UpdateTaskInput,
    CreateSessionInput,
    ApprovalDecision,
    TaskStatus,
    SessionState,
    Priority,
)
from .errors import (
    FaraSDKError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ValidationError,
    RateLimitError,
    NetworkError,
    ServerError,
)
from .auth import TokenManager, OIDCTokens


T = TypeVar("T")


@dataclass
class FaraClientConfig:
    """Configuration for FaraClient."""
    base_url: str
    api_key: Optional[str] = None
    oidc: Optional[dict] = None
    timeout: int = 30
    max_retries: int = 3
    on_token_refresh: Optional[Callable[[str], None]] = None


@dataclass
class APIErrorResponse:
    """API error response."""
    error: str
    message: str
    status_code: int
    details: Optional[dict] = None


from dataclasses import dataclass


class FaraClient:
    """Main API client for interacting with the Fara1.5 Platform."""

    def __init__(self, config: FaraClientConfig):
        self.base_url = config.base_url.rstrip("/")  # Remove trailing slash
        self.api_key = config.api_key
        self.timeout = config.timeout
        self.max_retries = config.max_retries
        self.on_token_refresh = config.on_token_refresh

        if config.api_key:
            self._token_manager: Optional[TokenManager] = None
        elif config.oidc:
            self._token_manager = TokenManager(
                config.oidc["issuer"],
                config.oidc["client_id"],
                config.oidc.get("audience"),
            )
            if config.oidc.get("tokens"):
                self._token_manager.set_tokens(
                    OIDCTokens(
                        access_token=config.oidc["tokens"]["access_token"],
                        refresh_token=config.oidc["tokens"].get("refresh_token"),
                        expires_at=config.oidc["tokens"].get("expires_at"),
                    )
                )
        else:
            raise ValueError("Either api_key or oidc configuration must be provided")

        self._client = httpx.AsyncClient(timeout=self.timeout)

    async def _get_auth_header(self) -> str:
        """Get the authorization header value."""
        if self.api_key:
            return f"Bearer {self.api_key}"

        if self._token_manager:
            if self._token_manager.is_expired() and self._token_manager.has_refresh_token():
                new_token = await self._token_manager.refresh()
                if self.on_token_refresh:
                    self.on_token_refresh(new_token)
                return f"Bearer {new_token}"

            token = self._token_manager.get_access_token()
            if not token:
                raise AuthenticationError("No authentication token available")
            return f"Bearer {token}"

        raise AuthenticationError("No authentication configured")

    def _handle_api_error(self, status_code: int, error: APIErrorResponse) -> None:
        """Handle API error responses."""
        if status_code == 401:
            raise AuthenticationError(error.message, error.details)
        elif status_code == 403:
            raise AuthorizationError(error.message, error.details)
        elif status_code == 404:
            raise NotFoundError(error.message, None, error.details)
        elif status_code == 400:
            raise ValidationError(
                error.message,
                error.details.get("validation_errors") if error.details else None,
                error.details,
            )
        elif status_code == 429:
            raise RateLimitError(error.message, None, error.details)
        else:
            if status_code >= 500:
                raise ServerError(error.message, error.details)
            raise FaraSDKError(
                error.message, error.error, status_code, error.details
            )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[dict] = None,
        query: Optional[dict] = None,
        headers: Optional[dict] = None,
    ) -> dict:
        """Make an authenticated request."""
        url = f"{self.base_url}{path}"
        request_headers = {"Content-Type": "application/json", **(headers or {})}

        auth_header = await self._get_auth_header()
        if "Authorization" not in request_headers:
            request_headers["Authorization"] = auth_header

        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.request(
                    method,
                    url,
                    json=body,
                    params=query,
                    headers=request_headers,
                )

                if not response.is_success:
                    try:
                        error_data = response.json()
                        error = APIErrorResponse(**error_data)
                    except Exception:
                        error = APIErrorResponse(
                            error="Unknown",
                            message=response.text,
                            status_code=response.status_code,
                        )
                    self._handle_api_error(response.status_code, error)

                return response.json()

            except FaraSDKError:
                raise
            except httpx.TimeoutException:
                raise FaraSDKError("Request timed out", "TIMEOUT", 0)
            except httpx.HTTPError as e:
                last_error = e

                # Don't retry on client errors (4xx)
                if isinstance(last_error, httpx.HTTPStatusError):
                    if 400 <= last_error.response.status_code < 500:
                        raise

                # Don't retry on last attempt
                if attempt == self.max_retries:
                    break

                # Exponential backoff
                await asyncio.sleep(2**attempt)

        raise NetworkError(f"Request failed after {self.max_retries + 1} attempts: {last_error}")

    async def close(self) -> None:
        """Close the client and clean up resources."""
        await self._client.aclose()

    # Tasks API

    async def tasks_create(self, input: CreateTaskInput) -> dict:
        """Create a new task."""
        return await self._request("POST", "/tasks", body=input.model_dump(exclude_none=True))

    async def tasks_get(self, task_id: str) -> dict:
        """Get a task by ID."""
        return await self._request("GET", f"/tasks/{task_id}")

    async def tasks_list(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[TaskStatus] = None,
        device_id: Optional[str] = None,
    ) -> dict:
        """List tasks with optional filters."""
        query = {"page": page, "limit": limit}
        if status:
            query["status"] = status.value
        if device_id:
            query["deviceId"] = device_id
        return await self._request("GET", "/tasks", query=query)

    async def tasks_update(self, task_id: str, input: UpdateTaskInput) -> dict:
        """Update a task."""
        return await self._request(
            "PATCH", f"/tasks/{task_id}", body=input.model_dump(exclude_none=True)
        )

    async def tasks_cancel(self, task_id: str) -> dict:
        """Cancel a task."""
        return await self._request("POST", f"/tasks/{task_id}/cancel")

    # Sessions API

    async def sessions_create(self, input: CreateSessionInput) -> dict:
        """Create a new session for a task."""
        return await self._request("POST", "/sessions", body=input.model_dump())

    async def sessions_get(self, session_id: str) -> dict:
        """Get a session by ID."""
        return await self._request("GET", f"/sessions/{session_id}")

    async def sessions_list(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[SessionState] = None,
        task_id: Optional[str] = None,
    ) -> dict:
        """List sessions with optional filters."""
        query: dict[str, Any] = {"page": page, "limit": limit}
        if status:
            query["status"] = status.value
        if task_id:
            query["taskId"] = task_id
        return await self._request("GET", "/sessions", query=query)

    async def sessions_terminate(self, session_id: str, reason: Optional[str] = None) -> dict:
        """Terminate a session."""
        body = {"reason": reason} if reason else None
        return await self._request("POST", f"/sessions/{session_id}/terminate", body=body)

    # Approvals API

    async def approvals_get(self, approval_id: str) -> dict:
        """Get an approval request by ID."""
        return await self._request("GET", f"/approvals/{approval_id}")

    async def approvals_list(
        self,
        *,
        page: int = 1,
        limit: int = 20,
        status: Optional[str] = None,
        session_id: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> dict:
        """List approval requests with optional filters."""
        query: dict[str, Any] = {"page": page, "limit": limit}
        if status:
            query["status"] = status
        if session_id:
            query["sessionId"] = session_id
        if task_id:
            query["taskId"] = task_id
        return await self._request("GET", "/approvals", query=query)

    async def approvals_decide(self, approval_id: str, decision: ApprovalDecision) -> dict:
        """Decide on an approval request."""
        return await self._request(
            "POST",
            f"/approvals/{approval_id}/decide",
            body=decision.model_dump(exclude_none=True),
        )

    # Health checks

    async def health_check(self) -> dict:
        """Health check."""
        return await self._request("GET", "/health")

    async def readiness_check(self) -> dict:
        """Readiness check."""
        return await self._request("GET", "/ready")


def create_client_with_api_key(
    base_url: str, api_key: str, **kwargs: Any
) -> FaraClient:
    """Create a client with API key authentication."""
    config = FaraClientConfig(base_url=base_url, api_key=api_key, **kwargs)
    return FaraClient(config)


def create_client_with_oidc(
    base_url: str, oidc: dict, **kwargs: Any
) -> FaraClient:
    """Create a client with OIDC authentication."""
    config = FaraClientConfig(base_url=base_url, oidc=oidc, **kwargs)
    return FaraClient(config)
