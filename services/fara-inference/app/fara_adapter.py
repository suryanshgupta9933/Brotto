"""Stateless multimodal adapter from sanitized planning input to strict proposals."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, cast

from pydantic import ValidationError

from .client import InferenceRequest, VLLMClient, VLLMClientError
from .contracts import (
    ContractErrorProposal,
    PlanningRequest,
    PlanningResponse,
    PlanningResponseAdapter,
)
from .models import get_model_manifest
from .prompts import planning_system_prompt


@dataclass(frozen=True)
class InferenceMetadata:
    """Response provenance retained for logging without extending the proposal contract."""

    finish_reason: str
    usage: dict[str, int]
    model: str


class FaraAdapter:
    """Calls an OpenAI-compatible endpoint without retaining session or browser state."""

    def __init__(
        self,
        client: VLLMClient | None = None,
        model: str | None = None,
        supports_json_schema: bool | None = None,
    ) -> None:
        self.client = client
        self.model = model or os.environ.get("VLLM_MODEL_ID", "fara1.5-9b")
        configured_capability = os.environ.get("VLLM_SUPPORTS_JSON_SCHEMA")
        manifest = get_model_manifest(self.model)
        self.supports_json_schema = (
            supports_json_schema
            if supports_json_schema is not None
            else configured_capability.lower() == "true"
            if configured_capability is not None
            else manifest.supports_json_schema
            if manifest is not None
            else True
        )
        self.last_inference_metadata: InferenceMetadata | None = None

    async def plan(self, request: PlanningRequest) -> PlanningResponse:
        if self.client is None:
            return self._contract_error("No model client is configured")

        messages = self._planning_messages(request)
        last_error = "Model output did not satisfy the planning contract"
        for attempt in range(request.limits.max_repair_attempts + 1):
            try:
                response = await self.client.complete(self._inference_request(request, messages))
            except VLLMClientError as error:
                return self._contract_error(f"Model endpoint failed: {error}")

            self.last_inference_metadata = InferenceMetadata(
                finish_reason=response.finish_reason,
                usage=dict(response.usage),
                model=response.model,
            )
            parsed = self.parse_model_output(response.content)
            if (
                parsed.kind != "contract_error"
                and parsed.observation_id != request.observation.observation_id
            ):
                parsed = self._contract_error(
                    "Proposal observationId does not match the planning observation"
                )
            if parsed.kind != "contract_error":
                return parsed
            last_error = parsed.message
            if attempt < request.limits.max_repair_attempts:
                messages.extend(self._repair_messages(last_error))

        return self._contract_error(f"Model output remained invalid after repairs: {last_error}")

    def parse_model_output(self, content: str) -> PlanningResponse:
        """Parse only a complete JSON proposal; prose and malformed JSON are contract errors."""
        try:
            decoded = json.loads(content)
        except json.JSONDecodeError as error:
            return self._contract_error(f"Model output is not valid JSON: {error.msg}")
        try:
            return cast(PlanningResponse, PlanningResponseAdapter.validate_python(decoded))
        except ValidationError as error:
            detail = error.errors()[0]["msg"]
            return self._contract_error(f"Model output violates the planning contract: {detail}")

    def _inference_request(
        self, request: PlanningRequest, messages: list[dict[str, Any]]
    ) -> InferenceRequest:
        return InferenceRequest(
            model=self.model,
            messages=messages,
            temperature=0,
            max_tokens=request.limits.max_tokens,
            top_p=1,
            stream=False,
            response_format=self._response_format(),
        )

    def _planning_messages(self, request: PlanningRequest) -> list[dict[str, Any]]:
        payload = request.model_dump(by_alias=True)
        screenshot = payload["observation"]["screenshot"]
        if screenshot["kind"] == "inline":
            screenshot["data"] = "Provided separately as image content."
        parts: list[dict[str, Any]] = [
            {"type": "text", "text": json.dumps(payload, separators=(",", ":"))}
        ]
        if request.observation.screenshot.kind == "inline":
            image = request.observation.screenshot
            mime = "png" if image.encoding == "base64" else image.encoding
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/{mime};base64,{image.data}"},
                }
            )
        return [
            {"role": "system", "content": planning_system_prompt()},
            {"role": "user", "content": parts},
        ]

    def _repair_messages(self, error: str) -> list[dict[str, Any]]:
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "instruction": (
                                    "Return a complete JSON proposal matching this schema. "
                                    "Do not add prose."
                                ),
                                "validationError": error,
                                "schema": PlanningResponseAdapter.json_schema(),
                            },
                            separators=(",", ":"),
                        ),
                    },
                ],
            },
        ]

    def _response_format(self) -> dict[str, Any] | None:
        if not self.supports_json_schema:
            return None
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "fara_planning_response",
                "strict": True,
                "schema": PlanningResponseAdapter.json_schema(),
            },
        }

    @staticmethod
    def _contract_error(message: str) -> ContractErrorProposal:
        return ContractErrorProposal(code="INFERENCE_CONTRACT_ERROR", message=message)
