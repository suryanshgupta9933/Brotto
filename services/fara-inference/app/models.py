"""
Model manifests for Fara1.5 model family.

Each manifest contains repository, revision, checksum, and license information.
"""

from dataclasses import dataclass
from enum import Enum


class ModelSize(Enum):
    """Model size variants."""

    SIZE_4B = "4b"
    SIZE_9B = "9b"
    SIZE_27B = "27b"


class ModelProfile(Enum):
    """Deployment profile types."""

    ECONOMY = "economy"  # Fara1.5-4B - development, self-hosted
    STANDARD = "standard"  # Fara1.5-9B - production default
    QUALITY = "quality"  # Fara1.5-27B - difficult tasks, optional escalation


@dataclass(frozen=True)
class ModelManifest:
    """
    Manifest for a Fara model version.

    Attributes:
        model_id: Unique identifier (e.g., "fara1.5-9b")
        profile: Deployment profile type
        size: Model size variant
        repository: HuggingFace repository path
        revision: Git revision/commit hash
        checksum: Expected model checksum (SHA256)
        license: Model license (e.g., "mit")
        recommended_vram_gb: Recommended GPU VRAM in GB
        max_context_length: Maximum context length in tokens
        description: Human-readable description
    """

    model_id: str
    profile: ModelProfile
    size: ModelSize
    repository: str
    revision: str
    checksum: str
    license: str
    recommended_vram_gb: int
    max_context_length: int
    description: str
    supports_json_schema: bool = True

    @property
    def hf_repo(self) -> str:
        """Get the full HuggingFace repository URL."""
        return f"https://huggingface.co/{self.repository}"

    def validate(self) -> bool:
        """Validate the manifest has all required fields."""
        return all(
            [
                self.model_id,
                self.repository,
                self.revision,
                self.checksum,
                self.license,
                self.recommended_vram_gb > 0,
                self.max_context_length > 0,
            ]
        )


# Model manifests for Fara1.5 family
# These would be populated with actual values when model weights are released

FARA_4B_MANIFEST = ModelManifest(
    model_id="fara1.5-4b",
    profile=ModelProfile.ECONOMY,
    size=ModelSize.SIZE_4B,
    repository="inventic/fara1.5-4b",
    revision="main",
    checksum="sha256:placeholder_4b_checksum",
    license="mit",
    recommended_vram_gb=8,
    max_context_length=32768,
    description="Fara1.5-4B: Economy profile for development and self-hosted deployments",
)

FARA_9B_MANIFEST = ModelManifest(
    model_id="fara1.5-9b",
    profile=ModelProfile.STANDARD,
    size=ModelSize.SIZE_9B,
    repository="inventic/fara1.5-9b",
    revision="main",
    checksum="sha256:placeholder_9b_checksum",
    license="mit",
    recommended_vram_gb=16,
    max_context_length=32768,
    description="Fara1.5-9B: Standard production model (default)",
)

FARA_27B_MANIFEST = ModelManifest(
    model_id="fara1.5-27b",
    profile=ModelProfile.QUALITY,
    size=ModelSize.SIZE_27B,
    repository="inventic/fara1.5-27b",
    revision="main",
    checksum="sha256:placeholder_27b_checksum",
    license="mit",
    recommended_vram_gb=48,
    max_context_length=32768,
    description="Fara1.5-27B: Quality profile for difficult tasks",
)

# Registry of all available models
MODEL_REGISTRY: dict[str, ModelManifest] = {
    FARA_4B_MANIFEST.model_id: FARA_4B_MANIFEST,
    FARA_9B_MANIFEST.model_id: FARA_9B_MANIFEST,
    FARA_27B_MANIFEST.model_id: FARA_27B_MANIFEST,
}

# Default model for production
DEFAULT_MODEL_ID = FARA_9B_MANIFEST.model_id


def get_model_manifest(model_id: str) -> ModelManifest | None:
    """Get model manifest by ID, returns None if not found."""
    return MODEL_REGISTRY.get(model_id)


def get_default_model_manifest() -> ModelManifest:
    """Get the default model manifest for production."""
    return FARA_9B_MANIFEST


def get_models_by_profile(profile: ModelProfile) -> list[ModelManifest]:
    """Get all models matching a specific profile."""
    return [m for m in MODEL_REGISTRY.values() if m.profile == profile]
