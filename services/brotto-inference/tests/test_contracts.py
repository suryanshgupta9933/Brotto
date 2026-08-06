import pytest
from pydantic import ValidationError

from app.contracts import PlanningRequest, PlanningResponseEnvelope


def valid_request_body() -> dict:
    return {
        "goal": "Open the example site",
        "completionCriteria": ["The example page is visible"],
        "observation": {
            "observationId": "11111111-1111-4111-8111-111111111111",
            "capturedAt": "2026-08-03T10:00:00Z",
            "url": "https://example.com",
            "title": "Example",
            "screenshot": {
                "kind": "inline",
                "encoding": "base64",
                "data": "c2NyZWVuc2hvdA==",
                "sha256": "a" * 64,
                "width": 1280,
                "height": 720,
            },
            "viewport": {
                "width": 1280,
                "height": 720,
                "devicePixelRatio": 1,
                "zoom": 1,
                "scrollX": 0,
                "scrollY": 0,
            },
            "page": {
                "tabId": "22222222-2222-4222-8222-222222222222",
                "frameId": "33333333-3333-4333-8333-333333333333",
                "lifecycle": "complete",
                "visibility": "visible",
            },
            "semanticTargets": [
                {
                    "targetId": "44444444-4444-4444-8444-444444444444",
                    "tag": "button",
                    "role": "button",
                    "accessibleName": {"source": "aria-label", "text": "Continue"},
                    "control": {"kind": "non_input"},
                    "boundingBox": {"x": 20, "y": 30, "width": 100, "height": 40},
                    "visible": True,
                    "framePath": [],
                    "locatorCandidates": [
                        {
                            "kind": "role_name",
                            "role": "button",
                            "name": {"source": "aria-label", "text": "Continue"},
                        }
                    ],
                }
            ],
        },
        "trajectory": [],
        "limits": {"maxTokens": 1024, "maxRepairAttempts": 2},
    }


def test_planning_request_accepts_screenshot_and_sanitized_targets():
    request = PlanningRequest.model_validate(valid_request_body())

    assert request.observation.screenshot.kind == "inline"
    assert request.observation.semantic_targets[0].accessible_name.text == "Continue"


def test_planning_response_envelope_validates_the_canonical_proposal_union():
    response = PlanningResponseEnvelope.model_validate(
        {
            "kind": "action",
            "observationId": "11111111-1111-4111-8111-111111111111",
            "proposedAt": "2026-08-03T10:00:01Z",
            "action": {"type": "wait", "durationMs": 100},
        }
    )

    assert response.root.kind == "action"


def test_planning_request_rejects_forbidden_browser_data_at_any_depth():
    body = valid_request_body()
    candidate = body["observation"]["semanticTargets"][0]["locatorCandidates"][0]
    candidate["Proxy Authorization"] = "secret"

    with pytest.raises(ValidationError, match="Forbidden browser data"):
        PlanningRequest.model_validate(body)


def test_planning_request_rejects_unknown_browser_fields():
    body = valid_request_body()
    body["observation"]["cookies"] = []

    with pytest.raises(ValidationError):
        PlanningRequest.model_validate(body)


@pytest.mark.parametrize(
    ("field", "secret"),
    [("role", "Password"), ("testId", "auth-token")],
)
def test_planning_request_rejects_secret_bearing_locator_content(field: str, secret: str):
    body = valid_request_body()
    candidate = body["observation"]["semanticTargets"][0]["locatorCandidates"][0]
    if field == "testId":
        candidate.clear()
        candidate.update({"kind": "test_id", "testId": secret})
    candidate[field] = secret

    with pytest.raises(ValidationError, match="sensitive browser data"):
        PlanningRequest.model_validate(body)


def test_planning_request_rejects_secret_bearing_semantic_attribute():
    body = valid_request_body()
    body["observation"]["semanticTargets"][0]["attributes"] = {"aria-label": "Password reset"}

    with pytest.raises(ValidationError, match="sensitive browser data"):
        PlanningRequest.model_validate(body)


def test_planning_request_rejects_overlong_safe_semantic_attribute():
    body = valid_request_body()
    body["observation"]["semanticTargets"][0]["attributes"] = {"aria-label": "x" * 513}

    with pytest.raises(ValidationError):
        PlanningRequest.model_validate(body)


@pytest.mark.parametrize(
    ("attribute", "value"),
    [
        ("aria-expanded", "maybe"),
        ("aria-haspopup", "popup"),
        ("aria-current", "current"),
        ("aria-pressed", "yes"),
        ("aria-selected", "selected"),
    ],
)
def test_planning_request_rejects_invalid_semantic_attribute_state(attribute: str, value: str):
    body = valid_request_body()
    body["observation"]["semanticTargets"][0]["attributes"] = {attribute: value}

    with pytest.raises(ValidationError):
        PlanningRequest.model_validate(body)


def test_planning_request_accepts_canonical_semantic_attribute_boundaries_and_states():
    body = valid_request_body()
    body["observation"]["semanticTargets"][0]["attributes"] = {
        "aria-label": "x" * 512,
        "aria-describedby": "description",
        "aria-controls": "results",
        "aria-expanded": "true",
        "aria-haspopup": "listbox",
        "aria-current": "page",
        "aria-pressed": "mixed",
        "aria-selected": "false",
    }

    request = PlanningRequest.model_validate(body)

    assert request.observation.semantic_targets[0].attributes is not None
