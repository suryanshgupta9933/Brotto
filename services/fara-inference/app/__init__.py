"""
Fara Inference Service

OpenAI-compatible inference service for Fara1.5 model family.
"""

from .models import (
    ModelSize,
    ModelProfile,
    ModelManifest,
    FARA_4B_MANIFEST,
    FARA_9B_MANIFEST,
    FARA_27B_MANIFEST,
    MODEL_REGISTRY,
    DEFAULT_MODEL_ID,
    get_model_manifest,
    get_default_model_manifest,
    get_models_by_profile,
)

from .prompts import (
    PromptVersion,
    ObservationPrompt,
    PromptTemplate,
    PromptTemplateManager,
    get_prompt_manager,
)

from .client import (
    VLLMClient,
    VLLMClientError,
    VLLMConnectionError,
    VLLMInferenceError,
    InferenceRequest,
    InferenceResponse,
    StreamChunk,
    SyncVLLMClient,
)

from .api import router

__all__ = [
    # Models
    "ModelSize",
    "ModelProfile",
    "ModelManifest",
    "FARA_4B_MANIFEST",
    "FARA_9B_MANIFEST",
    "FARA_27B_MANIFEST",
    "MODEL_REGISTRY",
    "DEFAULT_MODEL_ID",
    "get_model_manifest",
    "get_default_model_manifest",
    "get_models_by_profile",
    # Prompts
    "PromptVersion",
    "ObservationPrompt",
    "PromptTemplate",
    "PromptTemplateManager",
    "get_prompt_manager",
    # Client
    "VLLMClient",
    "VLLMClientError",
    "VLLMConnectionError",
    "VLLMInferenceError",
    "InferenceRequest",
    "InferenceResponse",
    "StreamChunk",
    "SyncVLLMClient",
    # API
    "router",
]
