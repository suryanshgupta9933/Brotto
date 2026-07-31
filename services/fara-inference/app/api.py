"""
OpenAI-compatible API endpoints for Fara inference service.

Implements the OpenAI Chat Completions API format using vLLM as the backend.
"""

from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .client import VLLMClient, InferenceRequest, InferenceResponse, VLLMClientError, VLLMInferenceError
from .models import ModelManifest, MODEL_REGISTRY, get_model_manifest, get_default_model_manifest
from .prompts import get_prompt_manager, PromptVersion


router = APIRouter()


class Message(BaseModel):
    """Chat message in OpenAI format."""
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible chat completion request."""
    model: str = Field(description="Model ID to use for completion")
    messages: list[Message] = Field(description="List of messages in chat format")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=1, le=32768)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    stop: Optional[list[str]] = None
    stream: bool = Field(default=False)


class ChatCompletionChoice(BaseModel):
    """Single choice in chat completion response."""
    index: int
    message: Message
    finish_reason: str


class UsageInfo(BaseModel):
    """Token usage information."""
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """OpenAI-compatible chat completion response."""
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: UsageInfo


class ModelList(BaseModel):
    """List of available models."""
    object: str = "list"
    data: list[dict[str, Any]]


class Model(BaseModel):
    """Single model information."""
    id: str
    object: str = "model"
    created: int
    owned_by: str


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model: Optional[str] = None
    version: str = "1.0.0"


def _create_response(
    request: ChatCompletionRequest,
    content: str,
    usage: dict[str, int],
    finish_reason: str = "stop",
) -> ChatCompletionResponse:
    """Create a standardized chat completion response."""
    import time

    return ChatCompletionResponse(
        id=f"chatcmpl-{int(time.time() * 1000)}",
        created=int(time.time()),
        model=request.model,
        choices=[
            ChatCompletionChoice(
                index=0,
                message=Message(role="assistant", content=content),
                finish_reason=finish_reason,
            )
        ],
        usage=UsageInfo(
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
        ),
    )


@router.post("/v1/chat/completions", response_model=ChatCompletionResponse)
async def chat_completions(
    request: ChatCompletionRequest,
    vllm_url: str = Query(default="http://localhost:8000", description="vLLM server URL"),
    api_key: Optional[str] = Query(default=None, description="API key for vLLM"),
) -> ChatCompletionResponse:
    """
    OpenAI-compatible chat completions endpoint.

    Receives chat messages and returns model inference results via vLLM.
    """
    # Validate model is available
    model_manifest = get_model_manifest(request.model)
    if model_manifest is None:
        # Allow model ID even if not in registry (for flexibility)
        pass

    # Build messages for vLLM
    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    # Create inference request
    inference_request = InferenceRequest(
        model=request.model,
        messages=messages,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
        top_p=request.top_p,
        stop=request.stop,
        stream=False,
    )

    # Execute inference
    client = VLLMClient(base_url=vllm_url, api_key=api_key)

    try:
        response = await client.complete(inference_request)
    except VLLMInferenceError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Inference error: {e.error_detail or str(e)}",
        )
    except VLLMClientError as e:
        raise HTTPException(
            status_code=503,
            detail=f"vLLM service unavailable: {str(e)}",
        )

    # Build response
    return _create_response(
        request=request,
        content=response.content,
        usage=response.usage,
        finish_reason=response.finish_reason,
    )


@router.get("/v1/models", response_model=ModelList)
async def list_models() -> ModelList:
    """
    List available models.

    Returns all registered Fara model manifests.
    """
    models = []
    for model_id, manifest in MODEL_REGISTRY.items():
        models.append({
            "id": manifest.model_id,
            "object": "model",
            "created": 1700000000,  # Placeholder timestamp
            "owned_by": "inventic",
            "permission": [],  # Placeholder
        })

    return ModelList(data=models)


@router.get("/v1/models/{model_id}", response_model=Model)
async def get_model(model_id: str) -> Model:
    """
    Get information about a specific model.
    """
    if model_id not in MODEL_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    return Model(
        id=model_id,
        created=1700000000,
        owned_by="inventic",
    )


@router.get("/health", response_model=HealthResponse)
async def health_check(
    vllm_url: str = Query(default="http://localhost:8000", description="vLLM server URL"),
) -> HealthResponse:
    """
    Health check endpoint.

    Verifies connectivity to vLLM server.
    """
    client = VLLMClient(base_url=vllm_url)

    try:
        is_healthy = await client.health_check()
        default_model = get_default_model_manifest()
        return HealthResponse(
            status="healthy" if is_healthy else "degraded",
            model=default_model.model_id if is_healthy else None,
        )
    except Exception:
        return HealthResponse(status="unhealthy", model=None)


@router.post("/prompts/render")
async def render_prompt(
    goal: str,
    screenshot_description: str,
    recent_actions: list[dict[str, Any]],
    approved_user_answers: list[str],
    previous_action_result: dict[str, Any],
    failure_message: Optional[str] = None,
    prompt_version: Optional[str] = None,
) -> dict[str, Any]:
    """
    Render a prompt using the prompt template manager.

    Useful for debugging and validating prompt templates.
    """
    manager = get_prompt_manager()

    if prompt_version:
        try:
            version = PromptVersion(prompt_version)
            manager.set_active_version(version)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid prompt version: {prompt_version}. Valid versions: {[v.value for v in manager.list_versions()]}",
            )

    system_prompt, user_prompt = manager.render_prompt(
        goal=goal,
        screenshot_description=screenshot_description,
        recent_actions=recent_actions,
        approved_user_answers=approved_user_answers,
        previous_action_result=previous_action_result,
        failure_message=failure_message,
    )

    return {
        "version": manager.get_version().value,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
    }


@router.get("/prompts/versions")
async def list_prompt_versions() -> dict[str, Any]:
    """List available prompt template versions."""
    manager = get_prompt_manager()
    return {
        "versions": [v.value for v in manager.list_versions()],
        "active_version": manager.get_version().value,
    }
