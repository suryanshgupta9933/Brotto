"""
vLLM client for OpenAI-compatible inference.

Provides client wrapper for vLLM's OpenAI-compatible API endpoints.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator, Optional
import httpx
import json


@dataclass
class InferenceRequest:
    """Request for model inference."""
    model: str
    messages: list[dict[str, str]]
    temperature: float = 0.7
    max_tokens: int = 2048
    top_p: float = 0.9
    stop: Optional[list[str]] = None
    stream: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert to vLLM API format."""
        data = {
            "model": self.model,
            "messages": self.messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "stream": self.stream,
        }
        if self.stop:
            data["stop"] = self.stop
        return data


@dataclass
class InferenceResponse:
    """Response from model inference."""
    id: str
    model: str
    content: str
    finish_reason: str
    usage: dict[str, int]
    latency_ms: float

    @classmethod
    def from_vllm_response(cls, data: dict[str, Any], latency_ms: float) -> "InferenceResponse":
        """Parse from vLLM API response."""
        choice = data["choices"][0]
        return cls(
            id=data.get("id", "unknown"),
            model=data.get("model", "unknown"),
            content=choice.get("message", {}).get("content", ""),
            finish_reason=choice.get("finish_reason", "stop"),
            usage=data.get("usage", {}),
            latency_ms=latency_ms,
        )


@dataclass
class StreamChunk:
    """Streaming response chunk."""
    id: str
    content: str
    finish_reason: Optional[str] = None
    usage: Optional[dict[str, int]] = None

    @classmethod
    def from_vllm_event(cls, event: dict[str, Any]) -> "StreamChunk":
        """Parse from SSE event data."""
        delta = event.get("choices", [{}])[0].get("delta", {})
        return cls(
            id=event.get("id", ""),
            content=delta.get("content", ""),
            finish_reason=event.get("choices", [{}]).get("finish_reason"),
        )


class VLLMClientError(Exception):
    """Base exception for vLLM client errors."""
    pass


class VLLMConnectionError(VLLMClientError):
    """Failed to connect to vLLM server."""
    pass


class VLLMInferenceError(VLLMClientError):
    """Inference request failed."""
    def __init__(self, message: str, status_code: Optional[int] = None, error_detail: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.error_detail = error_detail


class VLLMClient:
    """
    Client for vLLM OpenAI-compatible API.

    Handles connection pooling, retries, and response parsing.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 120.0,
        max_retries: int = 3,
    ):
        """
        Initialize vLLM client.

        Args:
            base_url: Base URL of vLLM server (e.g., "http://localhost:8000")
            api_key: Optional API key for authentication
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries

        self._headers: dict[str, str] = {
            "Content-Type": "application/json",
        }
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"

    def _get_client(self) -> httpx.AsyncClient:
        """Get HTTP client with configuration."""
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self._headers,
            timeout=self.timeout,
        )

    async def complete(
        self,
        request: InferenceRequest,
    ) -> InferenceResponse:
        """
        Make a synchronous inference request.

        Args:
            request: Inference request parameters

        Returns:
            InferenceResponse with model output

        Raises:
            VLLMConnectionError: If connection fails
            VLLMInferenceError: If inference fails
        """
        client = self._get_client()
        start_time = datetime.utcnow()

        try:
            response = await client.post(
                "/v1/chat/completions",
                json=request.to_dict(),
            )

            latency_ms = (datetime.utcnow() - start_time).total_seconds() * 1000

            if response.status_code != 200:
                try:
                    error_data = response.json()
                    error_detail = error_data.get("error", {}).get("message", response.text)
                except Exception:
                    error_detail = response.text

                raise VLLMInferenceError(
                    f"Inference failed with status {response.status_code}",
                    status_code=response.status_code,
                    error_detail=error_detail,
                )

            data = response.json()
            return InferenceResponse.from_vllm_response(data, latency_ms)

        except httpx.ConnectError as e:
            raise VLLMConnectionError(f"Failed to connect to vLLM server: {e}")
        except httpx.TimeoutException as e:
            raise VLLMInferenceError(f"Inference request timed out: {e}")
        finally:
            await client.aclose()

    async def complete_stream(
        self,
        request: InferenceRequest,
    ) -> AsyncIterator[StreamChunk]:
        """
        Make a streaming inference request.

        Args:
            request: Inference request parameters (stream=True is set automatically)

        Yields:
            StreamChunk for each token/segment

        Raises:
            VLLMConnectionError: If connection fails
            VLLMInferenceError: If inference fails
        """
        request.stream = True
        client = self._get_client()

        try:
            async with client.stream(
                "POST",
                "/v1/chat/completions",
                json=request.to_dict(),
            ) as response:
                if response.status_code != 200:
                    try:
                        error_data = await response.json()
                        error_detail = error_data.get("error", {}).get("message", response.text)
                    except Exception:
                        error_detail = response.text

                    raise VLLMInferenceError(
                        f"Streaming inference failed with status {response.status_code}",
                        status_code=response.status_code,
                        error_detail=error_detail,
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break

                    try:
                        event = json.loads(data_str)
                        yield StreamChunk.from_vllm_event(event)
                    except json.JSONDecodeError:
                        continue

        except httpx.ConnectError as e:
            raise VLLMConnectionError(f"Failed to connect to vLLM server: {e}")
        except httpx.TimeoutException as e:
            raise VLLMInferenceError(f"Streaming request timed out: {e}")
        finally:
            await client.aclose()

    async def health_check(self) -> bool:
        """
        Check if vLLM server is healthy.

        Returns:
            True if server is healthy, False otherwise
        """
        client = self._get_client()
        try:
            response = await client.get("/health")
            return response.status_code == 200
        except Exception:
            return False
        finally:
            await client.aclose()

    async def get_model_info(self) -> dict[str, Any]:
        """
        Get information about the loaded model.

        Returns:
            Model information dictionary

        Raises:
            VLLMConnectionError: If connection fails
            VLLMInferenceError: If request fails
        """
        client = self._get_client()
        try:
            response = await client.get("/v1/models")
            if response.status_code != 200:
                raise VLLMInferenceError(
                    f"Failed to get model info: {response.status_code}",
                    status_code=response.status_code,
                )
            return response.json()
        except httpx.ConnectError as e:
            raise VLLMConnectionError(f"Failed to connect to vLLM server: {e}")
        finally:
            await client.aclose()


class SyncVLLMClient:
    """
    Synchronous wrapper for VLLMClient.

    Useful for contexts where async is not available.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 120.0,
        max_retries: int = 3,
    ):
        self._async_client = VLLMClient(base_url, api_key, timeout, max_retries)

    def complete(self, request: InferenceRequest) -> InferenceResponse:
        """Synchronous inference request."""
        return asyncio.run(self._async_client.complete(request))

    def health_check(self) -> bool:
        """Synchronous health check."""
        return asyncio.run(self._async_client.health_check())

    def get_model_info(self) -> dict[str, Any]:
        """Synchronous model info request."""
        return asyncio.run(self._async_client.get_model_info())
