"""Strict, stateless planning contracts mirrored from the canonical V1 protocol."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

FORBIDDEN_BROWSER_DATA_KEYS = {
    "cookie",
    "cookies",
    "authorization",
    "proxyauthorization",
    "localstorage",
    "sessionstorage",
    "password",
    "credentials",
    "profile",
}
SENSITIVE_SEMANTIC_CONTENT = re.compile(
    r"\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\b",
    re.IGNORECASE,
)
UUID_STRING = Annotated[
    str,
    Field(
        pattern=(
            r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
            r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
        )
    ),
]


def _normalized_key(value: str) -> str:
    return "".join(char for char in value.lower() if char.isalnum())


def assert_no_forbidden_browser_data(value: Any, path: str = "$") -> None:
    """Reject secret-shaped browser-state keys recursively before serialization."""
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = _normalized_key(str(key))
            if any(forbidden in normalized for forbidden in FORBIDDEN_BROWSER_DATA_KEYS):
                raise ValueError(f"Forbidden browser data key at {path}.{key}")
            assert_no_forbidden_browser_data(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            assert_no_forbidden_browser_data(nested, f"{path}[{index}]")


def _is_safe_semantic_text(value: str) -> str:
    if SENSITIVE_SEMANTIC_CONTENT.search(value):
        raise ValueError("Semantic content may not include sensitive browser data")
    return value


def _http_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Only HTTP(S) URLs are allowed")
    return value


def _rfc3339_timestamp(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Expected an RFC 3339 timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError("Expected a timezone-aware RFC 3339 timestamp")
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, allow_inf_nan=False)


class BrowserSafeModel(StrictModel):
    @model_validator(mode="before")
    @classmethod
    def reject_forbidden_browser_data(cls, value: Any) -> Any:
        assert_no_forbidden_browser_data(value)
        return value


class Screenshot(BrowserSafeModel):
    kind: Literal["inline", "artifact"]
    encoding: Literal["base64", "png", "jpeg", "webp"]
    sha256: Annotated[str, Field(pattern=r"^[a-fA-F0-9]{64}$")]
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    data: Annotated[str, Field(min_length=1, max_length=10_000_000)] | None = None
    artifact_id: UUID_STRING | None = Field(default=None, alias="artifactId")

    @model_validator(mode="after")
    def validate_reference(self) -> Screenshot:
        if self.kind == "inline" and self.data is None:
            raise ValueError("Inline screenshots require data")
        if self.kind == "artifact" and self.artifact_id is None:
            raise ValueError("Artifact screenshots require artifactId")
        if self.kind == "artifact" and self.data is not None:
            raise ValueError("Artifact screenshots may not contain data")
        if self.kind == "artifact" and self.encoding == "base64":
            raise ValueError("Artifact screenshots must name an image encoding")
        if self.kind == "inline" and self.artifact_id is not None:
            raise ValueError("Inline screenshots may not contain artifactId")
        return self


class Viewport(StrictModel):
    width: Annotated[int, Field(gt=0)]
    height: Annotated[int, Field(gt=0)]
    device_pixel_ratio: Annotated[float, Field(gt=0, le=8)] = Field(alias="devicePixelRatio")
    zoom: Annotated[float, Field(gt=0, le=8)]
    scroll_x: float = Field(alias="scrollX")
    scroll_y: float = Field(alias="scrollY")


class PageState(StrictModel):
    tab_id: UUID_STRING = Field(alias="tabId")
    frame_id: UUID_STRING = Field(alias="frameId")
    lifecycle: Literal["loading", "interactive", "complete", "frozen"]
    visibility: Literal["visible", "hidden", "prerender"]


class AccessibleName(BrowserSafeModel):
    source: Literal["aria-label", "aria-labelledby", "visible_text"]
    text: Annotated[str, Field(min_length=1, max_length=512)]

    _safe_text = field_validator("text")(_is_safe_semantic_text)


class BoundingBox(StrictModel):
    x: float
    y: float
    width: Annotated[float, Field(gt=0)]
    height: Annotated[float, Field(gt=0)]


class ControlMetadata(StrictModel):
    kind: Literal["input", "non_input"]
    input_type: (
        Literal["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"]
        | None
    ) = Field(default=None, alias="inputType")

    @model_validator(mode="after")
    def validate_input_type(self) -> ControlMetadata:
        if self.kind == "input" and self.input_type is None:
            raise ValueError("Input controls require inputType")
        if self.kind == "non_input" and self.input_type is not None:
            raise ValueError("Non-input controls may not include inputType")
        return self


class LocatorCandidate(BrowserSafeModel):
    kind: Literal["role_name", "label", "test_id", "safe_attribute"]
    role: Annotated[str, Field(min_length=1, max_length=512)] | None = None
    name: AccessibleName | None = None
    label: AccessibleName | None = None
    test_id: Annotated[str, Field(min_length=1, max_length=512)] | None = Field(
        default=None, alias="testId"
    )
    attribute: Literal["aria-label", "aria-describedby", "aria-controls", "aria-current"] | None = (
        None
    )
    value: Annotated[str, Field(min_length=1, max_length=512)] | None = None

    _safe_role = field_validator("role")(_is_safe_semantic_text)
    _safe_test_id = field_validator("test_id")(_is_safe_semantic_text)
    _safe_value = field_validator("value")(_is_safe_semantic_text)

    @model_validator(mode="after")
    def validate_variant(self) -> LocatorCandidate:
        required = {
            "role_name": (self.role, self.name),
            "label": (self.label,),
            "test_id": (self.test_id,),
            "safe_attribute": (self.attribute, self.value),
        }[self.kind]
        if any(item is None for item in required):
            raise ValueError(f"{self.kind} locator requires its canonical fields")
        allowed_fields = {
            "role_name": {"kind", "role", "name"},
            "label": {"kind", "label"},
            "test_id": {"kind", "test_id"},
            "safe_attribute": {"kind", "attribute", "value"},
        }[self.kind]
        if self.model_fields_set - allowed_fields:
            raise ValueError(f"{self.kind} locator may only contain its canonical fields")
        return self


class SemanticTarget(BrowserSafeModel):
    target_id: UUID_STRING = Field(alias="targetId")
    tag: Annotated[str, Field(min_length=1, max_length=64)]
    role: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    accessible_name: AccessibleName | None = Field(default=None, alias="accessibleName")
    attributes: (
        dict[
            Literal[
                "aria-label",
                "aria-describedby",
                "aria-controls",
                "aria-expanded",
                "aria-haspopup",
                "aria-current",
                "aria-pressed",
                "aria-selected",
            ],
            str,
        ]
        | None
    ) = None
    control: ControlMetadata
    bounding_box: BoundingBox = Field(alias="boundingBox")
    visible: bool
    frame_path: list[UUID_STRING] = Field(max_length=20, alias="framePath")
    shadow_path: list[UUID_STRING] | None = Field(default=None, max_length=20, alias="shadowPath")
    locator_candidates: list[LocatorCandidate] = Field(max_length=10, alias="locatorCandidates")

    _safe_tag = field_validator("tag")(_is_safe_semantic_text)
    _safe_role = field_validator("role")(_is_safe_semantic_text)

    @model_validator(mode="after")
    def validate_control(self) -> SemanticTarget:
        if self.tag.lower() == "input" and self.control.kind != "input":
            raise ValueError("Input targets require input control metadata")
        return self

    @field_validator("attributes")
    @classmethod
    def validate_safe_attributes(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is not None:
            for attribute_value in value.values():
                _is_safe_semantic_text(attribute_value)
        return value


class Observation(BrowserSafeModel):
    observation_id: UUID_STRING = Field(alias="observationId")
    captured_at: str = Field(alias="capturedAt")
    url: str
    title: Annotated[str, Field(max_length=512)]
    screenshot: Screenshot
    viewport: Viewport
    page: PageState
    semantic_targets: list[SemanticTarget] = Field(max_length=200, alias="semanticTargets")

    _http_url = field_validator("url")(_http_url)
    _captured_at = field_validator("captured_at")(_rfc3339_timestamp)


class TrajectoryEvent(BrowserSafeModel):
    event_id: UUID_STRING = Field(alias="eventId")
    session_id: UUID_STRING = Field(alias="sessionId")
    task_id: UUID_STRING = Field(alias="taskId")
    step_id: UUID_STRING | None = Field(default=None, alias="stepId")
    action_id: UUID_STRING | None = Field(default=None, alias="actionId")
    kind: Literal[
        "session_lifecycle",
        "observation_captured",
        "model_request",
        "model_response",
        "model_parse_failure",
        "action_proposed",
        "policy_decided",
        "approval_requested",
        "approval_resolved",
        "action_acknowledged",
        "action_completed",
        "verification_result",
        "task_terminal_outcome",
    ]
    occurred_at: str = Field(alias="occurredAt")
    correlation_id: UUID_STRING | None = Field(default=None, alias="correlationId")
    causation_id: UUID_STRING | None = Field(default=None, alias="causationId")
    sequence: Annotated[int, Field(ge=0)]
    summary: Annotated[str, Field(max_length=2000)] | None = None
    observation_id: UUID_STRING | None = Field(default=None, alias="observationId")

    _occurred_at = field_validator("occurred_at")(_rfc3339_timestamp)


class PlanningLimits(StrictModel):
    max_tokens: Annotated[int, Field(ge=1, le=32768)] = Field(default=2048, alias="maxTokens")
    max_repair_attempts: Annotated[int, Field(ge=0, le=2)] = Field(
        default=2, alias="maxRepairAttempts"
    )


class PlanningRequest(BrowserSafeModel):
    goal: Annotated[str, Field(min_length=1, max_length=4000)]
    completion_criteria: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(
        min_length=1, max_length=100, alias="completionCriteria"
    )
    observation: Observation
    trajectory: list[TrajectoryEvent] = Field(max_length=100)
    limits: PlanningLimits = Field(default_factory=PlanningLimits)


class ClickAction(StrictModel):
    type: Literal["left_click", "double_click", "right_click"]
    x: Annotated[int, Field(ge=0)]
    y: Annotated[int, Field(ge=0)]
    target_id: UUID_STRING | None = Field(default=None, alias="targetId")


class MouseMoveAction(StrictModel):
    type: Literal["mouse_move"]
    x: Annotated[int, Field(ge=0)]
    y: Annotated[int, Field(ge=0)]


class DragAction(StrictModel):
    type: Literal["drag"]
    start_x: Annotated[int, Field(ge=0)] = Field(alias="startX")
    start_y: Annotated[int, Field(ge=0)] = Field(alias="startY")
    end_x: Annotated[int, Field(ge=0)] = Field(alias="endX")
    end_y: Annotated[int, Field(ge=0)] = Field(alias="endY")


class ScrollAction(StrictModel):
    type: Literal["scroll"]
    delta_x: int = Field(alias="deltaX")
    delta_y: int = Field(alias="deltaY")


class KeyAction(StrictModel):
    type: Literal["key"]
    key: Annotated[str, Field(min_length=1, max_length=128)]
    modifiers: dict[Literal["ctrl", "shift", "alt", "meta"], bool] | None = None


class InsertTextAction(StrictModel):
    type: Literal["insert_text"]
    text: Annotated[str, Field(min_length=1, max_length=10000)]
    target_id: UUID_STRING | None = Field(default=None, alias="targetId")


class VisitUrlAction(StrictModel):
    type: Literal["visit_url"]
    url: str

    _http_url = field_validator("url")(_http_url)


class HistoryBackAction(StrictModel):
    type: Literal["history_back"]
    steps: Annotated[int, Field(ge=1, le=20)] = 1


class WaitAction(StrictModel):
    type: Literal["wait"]
    duration_ms: Annotated[int, Field(ge=1, le=60000)] = Field(alias="durationMs")


ExecutableAction = Annotated[
    ClickAction
    | MouseMoveAction
    | DragAction
    | ScrollAction
    | KeyAction
    | InsertTextAction
    | VisitUrlAction
    | HistoryBackAction
    | WaitAction,
    Field(discriminator="type"),
]


class ActionProposal(BrowserSafeModel):
    kind: Literal["action"]
    observation_id: UUID_STRING = Field(alias="observationId")
    proposed_at: str = Field(alias="proposedAt")
    action: ExecutableAction

    _proposed_at = field_validator("proposed_at")(_rfc3339_timestamp)


class CompletionFinding(BrowserSafeModel):
    fact: Annotated[str, Field(min_length=1, max_length=2000)]
    observation_ids: list[UUID_STRING] = Field(min_length=1, max_length=20, alias="observationIds")


class CompletionProposal(BrowserSafeModel):
    kind: Literal["completion"]
    observation_id: UUID_STRING = Field(alias="observationId")
    type: Literal["terminate"]
    status: Literal["succeeded", "partial", "failed"]
    summary: Annotated[str, Field(min_length=1, max_length=4000)]
    findings: list[CompletionFinding] = Field(max_length=100)
    unmet_criteria: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(
        max_length=100, alias="unmetCriteria"
    )
    confidence: Annotated[float, Field(ge=0, le=1)]

    @model_validator(mode="after")
    def require_evidence_for_success(self) -> CompletionProposal:
        if self.status == "succeeded" and not self.findings:
            raise ValueError("Successful completion requires findings with observation evidence")
        return self


class QuestionProposal(BrowserSafeModel):
    kind: Literal["question"]
    observation_id: UUID_STRING = Field(alias="observationId")
    question: Annotated[str, Field(min_length=1, max_length=2000)]
    choices: list[Annotated[str, Field(min_length=1, max_length=256)]] | None = Field(
        default=None, max_length=20
    )


class ContractErrorProposal(StrictModel):
    kind: Literal["contract_error"] = "contract_error"
    code: Literal["INFERENCE_CONTRACT_ERROR"]
    message: Annotated[str, Field(min_length=1, max_length=2000)]
    retryable: bool = False


PlanningResponse = Annotated[
    ActionProposal | CompletionProposal | QuestionProposal | ContractErrorProposal,
    Field(discriminator="kind"),
]
PlanningResponseAdapter: TypeAdapter[PlanningResponse] = TypeAdapter(PlanningResponse)
