import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import get_fara_adapter
from app.contracts import ContractErrorProposal, PlanningRequest
from app.fara_adapter import FaraAdapter
from app.main import create_app
from tests.test_contracts import valid_request_body


@pytest.fixture
def corpus() -> dict:
    path = Path(__file__).parent / "fixtures" / "model_outputs.json"
    return json.loads(path.read_text())


@pytest.fixture
def adapter() -> FaraAdapter:
    return FaraAdapter(client=None)


def test_prose_only_never_becomes_completion(adapter: FaraAdapter, corpus: dict):
    result = adapter.parse_model_output(corpus["prose_only"]["output"])

    assert result.kind == "contract_error"


@pytest.mark.parametrize(
    ("case_name", "expected_kind"),
    [
        ("valid_visit_url", "action"),
        ("valid_click", "action"),
        ("valid_completion", "completion"),
        ("unsupported_action", "contract_error"),
        ("missing_coordinates", "contract_error"),
        ("speculative_completion", "contract_error"),
        ("xml_garbage", "contract_error"),
        ("truncated_json", "contract_error"),
    ],
)
def test_model_output_corpus_is_strictly_classified(
    adapter: FaraAdapter, corpus: dict, case_name: str, expected_kind: str
):
    result = adapter.parse_model_output(corpus[case_name]["output"])

    assert result.kind == expected_kind


def test_completion_findings_evidence_unmet_criteria_and_summary_survive_parsing(
    adapter: FaraAdapter, corpus: dict
):
    result = adapter.parse_model_output(corpus["valid_completion"]["output"])

    assert result.model_dump(exclude={"kind"}, by_alias=True) == {
        "observationId": "11111111-1111-4111-8111-111111111111",
        "type": "terminate",
        "status": "succeeded",
        "summary": "Search results are available.",
        "findings": [
            {
                "fact": "Results page loaded",
                "observationIds": ["11111111-1111-4111-8111-111111111111"],
            }
        ],
        "unmetCriteria": [],
        "confidence": 0.97,
    }


def test_planning_request_accepts_screenshot_and_sanitized_targets():
    class ContractOnlyAdapter:
        async def plan(self, request: PlanningRequest) -> ContractErrorProposal:
            return ContractErrorProposal(
                code="INFERENCE_CONTRACT_ERROR",
                message="No model client is configured",
                retryable=False,
            )

    app = create_app()
    app.dependency_overrides[get_fara_adapter] = lambda: ContractOnlyAdapter()
    with TestClient(app) as client:
        response = client.post("/v1/plan", json=valid_request_body())

    assert response.status_code == 200
    assert response.json()["kind"] == "contract_error"


@pytest.mark.asyncio
async def test_plan_stops_after_two_repairs_for_invalid_model_output():
    class InvalidOutputClient:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request):
            self.calls += 1
            return type(
                "Response",
                (),
                {
                    "content": "not json",
                    "finish_reason": "stop",
                    "usage": {"total_tokens": 1},
                    "model": "fara-test",
                },
            )()

    client = InvalidOutputClient()
    request = PlanningRequest.model_validate(valid_request_body())
    result = await FaraAdapter(client=client).plan(request)

    assert result.kind == "contract_error"
    assert client.calls == 3


@pytest.mark.asyncio
async def test_plan_repairs_a_proposal_for_a_different_observation():
    class StaleProposalClient:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request):
            self.calls += 1
            observation_id = (
                "99999999-9999-4999-8999-999999999999"
                if self.calls == 1
                else "11111111-1111-4111-8111-111111111111"
            )
            return type(
                "Response",
                (),
                {
                    "content": json.dumps(
                        {
                            "kind": "action",
                            "observationId": observation_id,
                            "proposedAt": "2026-08-03T10:00:01Z",
                            "action": {"type": "wait", "durationMs": 100},
                        }
                    ),
                    "finish_reason": "stop",
                    "usage": {"total_tokens": 1},
                    "model": "fara-test",
                },
            )()

    client = StaleProposalClient()
    request = PlanningRequest.model_validate(valid_request_body())
    result = await FaraAdapter(client=client).plan(request)

    assert result.kind == "action"
    assert result.observation_id == request.observation.observation_id
    assert client.calls == 2


@pytest.mark.asyncio
async def test_plan_omits_json_schema_when_endpoint_does_not_support_it():
    class CapturingClient:
        request = None

        async def complete(self, request):
            self.request = request
            return type(
                "Response",
                (),
                {
                    "content": (
                        '{"kind":"question","observationId":"11111111-1111-4111-8111-111111111111",'
                        '"question":"Continue?"}'
                    ),
                    "finish_reason": "stop",
                    "usage": {"total_tokens": 1},
                    "model": "fara-test",
                },
            )()

    client = CapturingClient()
    request = PlanningRequest.model_validate(valid_request_body())
    result = await FaraAdapter(client=client, supports_json_schema=False).plan(request)

    assert result.kind == "question"
    assert client.request.temperature == 0
    assert client.request.response_format is None
    assert client.request.messages[1]["content"][1]["type"] == "image_url"
