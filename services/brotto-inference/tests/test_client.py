"""
Unit tests for vLLM client.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.client import (
    VLLMClient,
    SyncVLLMClient,
    InferenceRequest,
    InferenceResponse,
    StreamChunk,
    VLLMClientError,
    VLLMConnectionError,
    VLLMInferenceError,
)


class TestInferenceRequest:
    """Tests for InferenceRequest dataclass."""

    def test_request_creation(self):
        """Test basic request creation."""
        request = InferenceRequest(
            model="fara1.5-9b",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert request.model == "fara1.5-9b"
        assert len(request.messages) == 1
        assert request.temperature == 0.7
        assert request.max_tokens == 2048
        assert request.stream is False

    def test_request_with_options(self):
        """Test request with custom options."""
        request = InferenceRequest(
            model="fara1.5-9b",
            messages=[{"role": "user", "content": "Hello"}],
            temperature=0.5,
            max_tokens=1024,
            top_p=0.95,
            stop=["\n"],
        )
        assert request.temperature == 0.5
        assert request.max_tokens == 1024
        assert request.top_p == 0.95
        assert request.stop == ["\n"]

    def test_request_to_dict(self):
        """Test request serialization to dict."""
        request = InferenceRequest(
            model="fara1.5-9b",
            messages=[{"role": "user", "content": "Hello"}],
        )
        data = request.to_dict()
        assert data["model"] == "fara1.5-9b"
        assert data["messages"] == [{"role": "user", "content": "Hello"}]
        assert "temperature" in data
        assert "max_tokens" in data


class TestInferenceResponse:
    """Tests for InferenceResponse dataclass."""

    def test_response_from_vllm(self):
        """Test parsing vLLM API response."""
        vllm_data = {
            "id": "chatcmpl-123",
            "model": "fara1.5-9b",
            "choices": [
                {
                    "message": {"content": "Hello back"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        }
        response = InferenceResponse.from_vllm_response(vllm_data, 100.0)

        assert response.id == "chatcmpl-123"
        assert response.content == "Hello back"
        assert response.finish_reason == "stop"
        assert response.usage["prompt_tokens"] == 10
        assert response.latency_ms == 100.0


class TestStreamChunk:
    """Tests for StreamChunk dataclass."""

    def test_chunk_from_event(self):
        """Test parsing streaming event data."""
        event = {
            "id": "chatcmpl-123",
            "choices": [{"delta": {"content": "Hello"}}],
        }
        chunk = StreamChunk.from_vllm_event(event)

        assert chunk.id == "chatcmpl-123"
        assert chunk.content == "Hello"
        assert chunk.finish_reason is None

    def test_chunk_with_finish_reason(self):
        """Test parsing chunk with finish reason."""
        event = {
            "id": "chatcmpl-123",
            "choices": [
                {
                    "delta": {"content": " done"},
                    "finish_reason": "stop",
                }
            ],
        }
        chunk = StreamChunk.from_vllm_event(event)

        assert chunk.content == " done"
        assert chunk.finish_reason == "stop"


class TestVLLMClient:
    """Tests for VLLMClient."""

    @pytest.fixture
    def client(self):
        """Create a test client instance."""
        return VLLMClient(base_url="http://localhost:8000")

    def test_client_initialization(self, client):
        """Test client initialization with defaults."""
        assert client.base_url == "http://localhost:8000"
        assert client.timeout == 120.0
        assert client.max_retries == 3

    def test_client_with_api_key(self):
        """Test client initialization with API key."""
        client = VLLMClient(
            base_url="http://localhost:8000",
            api_key="test-key",
        )
        assert client._headers.get("Authorization") == "Bearer test-key"

    @pytest.mark.asyncio
    async def test_health_check_success(self, client):
        """Test successful health check."""
        mock_response = AsyncMock()
        mock_response.status_code = 200

        with patch.object(client, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.get.return_value = mock_response
            mock_get_client.return_value = mock_client

            result = await client.health_check()
            assert result is True

    @pytest.mark.asyncio
    async def test_health_check_failure(self, client):
        """Test failed health check."""
        with patch.object(client, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.get.side_effect = Exception("Connection failed")
            mock_get_client.return_value = mock_client

            result = await client.health_check()
            assert result is False


class TestSyncVLLMClient:
    """Tests for SyncVLLMClient wrapper."""

    def test_sync_client_initialization(self):
        """Test sync client initialization."""
        client = SyncVLLMClient(base_url="http://localhost:8000")
        assert client._async_client.base_url == "http://localhost:8000"


class TestVLLMErrors:
    """Tests for VLLM error classes."""

    def test_vllm_client_error(self):
        """Test VLLMClientError."""
        error = VLLMClientError("Test error")
        assert str(error) == "Test error"

    def test_vllm_connection_error(self):
        """Test VLLMConnectionError."""
        error = VLLMConnectionError("Connection failed")
        assert str(error) == "Connection failed"

    def test_vllm_inference_error(self):
        """Test VLLMInferenceError with details."""
        error = VLLMInferenceError(
            "Inference failed",
            status_code=500,
            error_detail="Model not found",
        )
        assert str(error) == "Inference failed"
        assert error.status_code == 500
        assert error.error_detail == "Model not found"
