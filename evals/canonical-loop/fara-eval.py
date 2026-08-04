#!/usr/bin/env python3
"""Evaluate Fara's strict planning contract without launching a browser.

Fixture mode is deterministic and performs no network I/O. Live mode is opt-in and
posts the same sanitized planning requests to a configured ``/v1/plan`` endpoint.
Only hashes and aggregate metrics are emitted; response bodies and credentials are
never included in reports or errors.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
MAX_CORPUS_BYTES = 16 * 1024 * 1024
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
FORBIDDEN_BROWSER_DATA_KEYS = {
    "authorization",
    "cookie",
    "cookies",
    "credentials",
    "localstorage",
    "password",
    "profile",
    "proxyauthorization",
    "sessionstorage",
}
ACTION_FIELDS: dict[str, tuple[set[str], set[str]]] = {
    "left_click": ({"type", "x", "y"}, {"targetId"}),
    "double_click": ({"type", "x", "y"}, {"targetId"}),
    "right_click": ({"type", "x", "y"}, {"targetId"}),
    "mouse_move": ({"type", "x", "y"}, set()),
    "drag": ({"type", "startX", "startY", "endX", "endY"}, set()),
    "scroll": ({"type", "deltaX", "deltaY"}, set()),
    "key": ({"type", "key"}, {"modifiers"}),
    "insert_text": ({"type", "text"}, {"targetId"}),
    "visit_url": ({"type", "url"}, set()),
    "history_back": ({"type"}, {"steps"}),
    "wait": ({"type", "durationMs"}, set()),
}


class EvaluationError(RuntimeError):
    """A safe-to-display evaluation error with no remote payload details."""


@dataclass(frozen=True)
class TransportResult:
    status: int
    body_text: str
    repair_count: int | None
    latency_ms: float


class Transport(Protocol):
    mode: str

    def send(self, case: Mapping[str, Any]) -> TransportResult:
        """Return the endpoint-shaped result for one corpus case."""


class FixtureTransport:
    """Replay response fixtures without making network requests."""

    mode = "fixture"

    def send(self, case: Mapping[str, Any]) -> TransportResult:
        fixture = case.get("fixtureResponse")
        if not isinstance(fixture, dict):
            raise EvaluationError("fixture case is missing fixtureResponse")
        status = fixture.get("status", 200)
        if not _is_int(status) or status < 100 or status > 599:
            raise EvaluationError("fixture response has an invalid status")
        repair_count = fixture.get("repairCount")
        if repair_count is not None and (not _is_int(repair_count) or repair_count < 0):
            raise EvaluationError("fixture response has an invalid repair count")
        if "body" in fixture:
            body_text = _canonical_json(fixture["body"])
        elif isinstance(fixture.get("bodyText"), str):
            body_text = fixture["bodyText"]
        else:
            raise EvaluationError("fixture response is missing a body")
        if len(body_text.encode("utf-8")) > MAX_RESPONSE_BYTES:
            raise EvaluationError("fixture response exceeds the byte limit")
        latency = fixture.get("latencyMs", 0)
        if not isinstance(latency, (int, float)) or isinstance(latency, bool) or latency < 0:
            raise EvaluationError("fixture response has an invalid latency")
        return TransportResult(status, body_text, repair_count, float(latency))


class LiveTransport:
    """POST planning requests to an explicitly configured HTTP(S) endpoint."""

    mode = "live"

    def __init__(
        self,
        endpoint: str,
        api_key: str | None = None,
        timeout: float = 30,
        allow_insecure_http: bool = False,
    ) -> None:
        self._endpoint = _planning_endpoint(endpoint, allow_insecure_http)
        self._api_key = api_key
        if not math.isfinite(timeout) or timeout <= 0:
            raise EvaluationError("timeout must be a positive finite number")
        self._timeout = timeout

    def send(self, case: Mapping[str, Any]) -> TransportResult:
        planning_request = case.get("request")
        if not isinstance(planning_request, dict):
            raise EvaluationError("evaluation case is missing a planning request")
        body = _canonical_json(planning_request).encode("utf-8")
        if len(body) > MAX_REQUEST_BYTES:
            raise EvaluationError("planning request exceeds the byte limit")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "fara-contract-eval/1",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = Request(self._endpoint, data=body, headers=headers, method="POST")
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=self._timeout) as response:  # noqa: S310
                response_body = _read_bounded(response).decode("utf-8", errors="replace")
                status = int(response.status)
                repair_count = _repair_count(response.headers.get("x-fara-repair-count"))
        except HTTPError as error:
            status = int(error.code)
            response_body = _read_bounded(error).decode("utf-8", errors="replace")
            repair_count = _repair_count(error.headers.get("x-fara-repair-count"))
        except (OSError, TimeoutError, URLError, ValueError) as error:
            raise EvaluationError("live endpoint request failed") from error
        latency_ms = (time.perf_counter() - started) * 1000
        return TransportResult(status, response_body, repair_count, latency_ms)


def load_cases(path: Path) -> list[dict[str, Any]]:
    """Load a dedicated corpus or the ``faraEvalCases`` section of Task 11 tasks."""
    try:
        with path.open("rb") as source:
            raw_document = source.read(MAX_CORPUS_BYTES + 1)
        if len(raw_document) > MAX_CORPUS_BYTES:
            raise EvaluationError("evaluation corpus exceeds the byte limit")
        document = json.loads(raw_document)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise EvaluationError("unable to load evaluation corpus") from error
    request_template: dict[str, Any] | None = None
    if isinstance(document, list):
        cases = document
    elif isinstance(document, dict):
        cases = document.get("faraEvalCases", document.get("cases"))
        configured_template = document.get("requestTemplate")
        if configured_template is not None and not isinstance(configured_template, dict):
            raise EvaluationError("requestTemplate must be an object")
        request_template = configured_template
    else:
        cases = None
    if not isinstance(cases, list) or not cases:
        raise EvaluationError("evaluation corpus must contain non-empty cases")
    if not all(isinstance(case, dict) for case in cases):
        raise EvaluationError("every evaluation case must be an object")
    ids = [case.get("id") for case in cases]
    if any(not isinstance(case_id, str) or not case_id for case_id in ids):
        raise EvaluationError("every evaluation case requires a non-empty id")
    if len(ids) != len(set(ids)):
        raise EvaluationError("evaluation case ids must be unique")
    expanded = copy.deepcopy(cases)
    if request_template is not None:
        for case in expanded:
            request = case.get("request")
            if not isinstance(request, dict):
                raise EvaluationError("every evaluation case requires a planning request")
            case["request"] = _deep_merge(request_template, request)
    for case in expanded:
        _validate_case_definition(case)
    return expanded


def validate_proposal(value: Any) -> tuple[bool, str]:
    """Validate the strict response contract without importing service internals."""
    if not isinstance(value, dict):
        return False, "proposal is not an object"
    kind = value.get("kind")
    if kind == "action":
        return _validate_action_proposal(value)
    if kind == "completion":
        return _validate_completion(value)
    if kind == "question":
        return _validate_question(value)
    if kind == "contract_error":
        return _validate_contract_error(value)
    return False, "proposal kind is unsupported"


def _load_contract_models() -> tuple[Any, Any] | None:
    """Load the service-owned Pydantic contract without importing app startup code."""
    contracts_path = (
        Path(__file__).resolve().parents[2]
        / "services"
        / "fara-inference"
        / "app"
        / "contracts.py"
    )
    try:
        spec = importlib.util.spec_from_file_location("fara_eval_contracts", contracts_path)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module.PlanningRequest, module.PlanningResponseEnvelope
    except Exception:
        sys.modules.pop("fara_eval_contracts", None)
        return None


def _validate_planning_request(request: Any, contract_models: tuple[Any, Any] | None) -> None:
    if not isinstance(request, dict):
        raise EvaluationError("evaluation case is missing a planning request")
    encoded = _canonical_json(request).encode("utf-8")
    if len(encoded) > MAX_REQUEST_BYTES:
        raise EvaluationError("planning request exceeds the byte limit")
    _assert_no_forbidden_browser_data(request)
    if contract_models is not None:
        try:
            contract_models[0].model_validate(request)
        except Exception as error:
            raise EvaluationError("planning request violates the canonical contract") from error
        return
    if set(request) != {"goal", "completionCriteria", "observation", "trajectory", "limits"}:
        raise EvaluationError("planning request violates the fallback contract")
    observation = request.get("observation")
    if not isinstance(observation, dict) or not _uuid(observation.get("observationId")):
        raise EvaluationError("planning request violates the fallback contract")
    screenshot = observation.get("screenshot")
    if not isinstance(screenshot, dict) or not isinstance(screenshot.get("sha256"), str):
        raise EvaluationError("planning request violates the fallback contract")
    if not isinstance(request.get("trajectory"), list):
        raise EvaluationError("planning request violates the fallback contract")


def _validate_response(
    value: Any, contract_models: tuple[Any, Any] | None
) -> tuple[bool, str, Any]:
    if contract_models is not None:
        try:
            envelope = contract_models[1].model_validate(value)
            normalized = envelope.root.model_dump(by_alias=True, exclude_none=True)
            return True, "valid", normalized
        except Exception:
            return False, "proposal violates the canonical contract", value
    valid, reason = validate_proposal(value)
    return valid, reason, value


def _validate_case_definition(case: Mapping[str, Any]) -> None:
    if not isinstance(case.get("category"), str) or not case["category"]:
        raise EvaluationError("every evaluation case requires a category")
    if not isinstance(case.get("request"), dict):
        raise EvaluationError("every evaluation case requires a planning request")
    expected = case.get("expected")
    if not isinstance(expected, dict):
        raise EvaluationError("every evaluation case requires an expected outcome")
    kind = expected.get("kind")
    if kind == "action":
        if set(expected) != {"kind", "action"} or not isinstance(expected["action"], dict):
            raise EvaluationError("action expectations require one exact action")
        valid, _ = _validate_action_proposal(
            {
                "kind": "action",
                "observationId": "11111111-1111-4111-8111-111111111111",
                "proposedAt": "2026-08-03T10:00:00Z",
                "action": expected["action"],
            }
        )
        if not valid:
            raise EvaluationError("expected action violates the planning contract")
    elif kind == "completion":
        if set(expected) != {"kind", "status"} or expected.get("status") not in {
            "succeeded",
            "partial",
            "failed",
        }:
            raise EvaluationError("completion expectations require one exact status")
    elif kind == "question":
        if set(expected) != {"kind", "question"} or not _bounded_string(
            expected.get("question"), 2_000
        ):
            raise EvaluationError("question expectations require exact question text")
    else:
        raise EvaluationError("expected outcome kind is unsupported")


def _assert_no_forbidden_browser_data(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = "".join(char for char in str(key).lower() if char.isalnum())
            if any(forbidden in normalized for forbidden in FORBIDDEN_BROWSER_DATA_KEYS):
                raise EvaluationError(f"forbidden browser data at {path}")
            _assert_no_forbidden_browser_data(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _assert_no_forbidden_browser_data(nested, f"{path}[{index}]")


def evaluate_cases(cases: Sequence[Mapping[str, Any]], transport: Transport) -> dict[str, Any]:
    """Evaluate cases and return a payload-free scorecard."""
    contract_models = _load_contract_models()
    if transport.mode == "live" and contract_models is None:
        raise EvaluationError("canonical planning contract is unavailable")
    valid_count = 0
    correct_count = 0
    scored_count = 0
    premature_count = 0
    prose_count = 0
    xml_count = 0
    malformed_count = 0
    invalid_schema_count = 0
    contract_error_count = 0
    context_violation_count = 0
    http_error_count = 0
    repair_count = 0
    repaired_case_count = 0
    repair_missing_count = 0
    latencies: list[float] = []
    representative: dict[str, dict[str, int]] = {}

    for case in cases:
        _validate_case_definition(case)
        _validate_planning_request(case.get("request"), contract_models)
        result = transport.send(case)
        latencies.append(result.latency_ms)
        if result.repair_count is None:
            repair_missing_count += 1
        else:
            repair_count += result.repair_count
            repaired_case_count += int(result.repair_count > 0)
        if result.status < 200 or result.status >= 300:
            http_error_count += 1

        parsed, output_kind = _parse_output(result.body_text)
        valid = False
        reason = output_kind
        if output_kind == "json":
            valid, reason, parsed = _validate_response(parsed, contract_models)
            if valid and isinstance(parsed, dict) and parsed.get("kind") == "contract_error":
                contract_error_count += 1
                valid = False
                reason = "contract_error"
            elif not valid:
                invalid_schema_count += 1
        elif output_kind == "speculative_prose":
            prose_count += 1
        elif output_kind == "xml":
            xml_count += 1
        else:
            malformed_count += 1

        if result.status < 200 or result.status >= 300:
            valid = False
            reason = "http_error"
        if valid and not _proposal_matches_context(parsed, case.get("request")):
            valid = False
            reason = "context_violation"
            context_violation_count += 1
        if valid:
            valid_count += 1

        expected = case.get("expected")
        correct = valid and _matches_expected(parsed, expected)
        if isinstance(expected, dict) and expected.get("kind") == "action":
            scored_count += 1
            correct_count += int(correct)
        if (
            valid
            and isinstance(parsed, dict)
            and parsed.get("kind") == "completion"
            and isinstance(expected, dict)
            and expected.get("kind") != "completion"
        ):
            premature_count += 1

        if case.get("representative") is True:
            category = case.get("category")
            if not isinstance(category, str) or not category:
                raise EvaluationError("representative cases require a category")
            bucket = representative.setdefault(category, {"correct": 0, "total": 0})
            bucket["total"] += 1
            bucket["correct"] += int(correct)

        # Keep this variable local to make accidental raw-output reporting obvious.
        _ = reason

    representative_report = {
        category: {
            "correct": bucket["correct"],
            "total": bucket["total"],
            "rate": _rate(bucket["correct"], bucket["total"]),
        }
        for category, bucket in sorted(representative.items())
    }
    return {
        "schemaVersion": 1,
        "mode": transport.mode,
        "caseCount": len(cases),
        "corpusSha256": hashlib.sha256(_canonical_json(list(cases)).encode()).hexdigest(),
        "validStructuredProposalCount": valid_count,
        "validStructuredProposalRate": _rate(valid_count, len(cases)),
        "correctNextActionCount": correct_count,
        "correctNextActionScoredCount": scored_count,
        "correctNextActionRate": _rate(correct_count, scored_count),
        "prematureCompletionCount": premature_count,
        "speculativeProseCount": prose_count,
        "xmlOutputCount": xml_count,
        "malformedOutputCount": malformed_count,
        "invalidSchemaCount": invalid_schema_count,
        "contractErrorCount": contract_error_count,
        "contextViolationCount": context_violation_count,
        "httpErrorCount": http_error_count,
        "repairCount": repair_count,
        "repairedCaseCount": repaired_case_count,
        "repairTelemetryMissingCount": repair_missing_count,
        "repairRate": _rate(repaired_case_count, len(cases) - repair_missing_count),
        "latencyMs": _latency_metrics(latencies),
        "representativeTasks": representative_report,
    }


def _validate_action_proposal(value: Mapping[str, Any]) -> tuple[bool, str]:
    if not _exact_fields(value, {"kind", "observationId", "proposedAt", "action"}):
        return False, "action proposal has unknown or missing fields"
    if not _uuid(value["observationId"]) or not _timestamp(value["proposedAt"]):
        return False, "action proposal has invalid provenance"
    action = value["action"]
    if not isinstance(action, dict) or not isinstance(action.get("type"), str):
        return False, "action is invalid"
    action_type = action["type"]
    field_sets = ACTION_FIELDS.get(action_type)
    if field_sets is None:
        return False, "action type is unsupported"
    required, optional = field_sets
    if set(action) - required - optional or not required.issubset(action):
        return False, "action has unknown fields"
    if not _action_values_are_valid(action_type, action):
        return False, "action values are invalid"
    return True, "valid"


def _action_values_are_valid(action_type: str, action: Mapping[str, Any]) -> bool:
    coordinate_fields = {
        "left_click": ("x", "y"),
        "double_click": ("x", "y"),
        "right_click": ("x", "y"),
        "mouse_move": ("x", "y"),
        "drag": ("startX", "startY", "endX", "endY"),
    }
    if action_type in coordinate_fields:
        if not all(_is_int(action[field]) and action[field] >= 0 for field in coordinate_fields[action_type]):
            return False
    if action_type == "scroll" and not all(_is_int(action[field]) for field in ("deltaX", "deltaY")):
        return False
    if action_type == "key":
        if not _bounded_string(action["key"], 128):
            return False
        modifiers = action.get("modifiers")
        if modifiers is not None and (
            not isinstance(modifiers, dict)
            or set(modifiers) - {"ctrl", "shift", "alt", "meta"}
            or not all(isinstance(item, bool) for item in modifiers.values())
        ):
            return False
    if action_type == "insert_text" and not _bounded_string(action["text"], 10_000):
        return False
    if "targetId" in action and not _uuid(action["targetId"]):
        return False
    if action_type == "visit_url" and not _http_url(action["url"]):
        return False
    if action_type == "history_back":
        steps = action.get("steps", 1)
        if not _is_int(steps) or steps < 1 or steps > 20:
            return False
    if action_type == "wait":
        duration = action["durationMs"]
        if not _is_int(duration) or duration < 1 or duration > 60_000:
            return False
    return True


def _validate_completion(value: Mapping[str, Any]) -> tuple[bool, str]:
    required = {
        "kind", "observationId", "type", "status", "summary", "findings",
        "unmetCriteria", "confidence",
    }
    if not _exact_fields(value, required):
        return False, "completion has unknown or missing fields"
    if not _uuid(value["observationId"]) or value["type"] != "terminate":
        return False, "completion provenance is invalid"
    if value["status"] not in {"succeeded", "partial", "failed"}:
        return False, "completion status is invalid"
    if not _bounded_string(value["summary"], 4_000):
        return False, "completion summary is invalid"
    findings = value["findings"]
    unmet = value["unmetCriteria"]
    confidence = value["confidence"]
    if not isinstance(findings, list) or len(findings) > 100:
        return False, "completion findings are invalid"
    if value["status"] == "succeeded" and not findings:
        return False, "successful completion requires evidence"
    for finding in findings:
        if not isinstance(finding, dict) or not _exact_fields(finding, {"fact", "observationIds"}):
            return False, "completion finding is invalid"
        ids = finding["observationIds"]
        if (
            not _bounded_string(finding["fact"], 2_000)
            or not isinstance(ids, list)
            or not 1 <= len(ids) <= 20
            or not all(_uuid(item) for item in ids)
        ):
            return False, "completion finding is invalid"
    if (
        not isinstance(unmet, list)
        or len(unmet) > 100
        or not all(_bounded_string(item, 1_000) for item in unmet)
    ):
        return False, "completion unmet criteria are invalid"
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        return False, "completion confidence is invalid"
    if not math.isfinite(float(confidence)) or confidence < 0 or confidence > 1:
        return False, "completion confidence is invalid"
    return True, "valid"


def _validate_question(value: Mapping[str, Any]) -> tuple[bool, str]:
    required = {"kind", "observationId", "question"}
    optional = {"choices"}
    if not required.issubset(value) or set(value) - required - optional:
        return False, "question has unknown or missing fields"
    if not _uuid(value["observationId"]) or not _bounded_string(value["question"], 2_000):
        return False, "question values are invalid"
    choices = value.get("choices")
    if choices is not None and (
        not isinstance(choices, list)
        or len(choices) > 20
        or not all(_bounded_string(choice, 256) for choice in choices)
    ):
        return False, "question choices are invalid"
    return True, "valid"


def _validate_contract_error(value: Mapping[str, Any]) -> tuple[bool, str]:
    if not _exact_fields(value, {"kind", "code", "message", "retryable"}):
        return False, "contract error has unknown or missing fields"
    if value["code"] != "INFERENCE_CONTRACT_ERROR":
        return False, "contract error code is invalid"
    if not _bounded_string(value["message"], 2_000) or not isinstance(value["retryable"], bool):
        return False, "contract error values are invalid"
    return True, "valid"


def _matches_expected(proposal: Any, expected: Any) -> bool:
    if not isinstance(proposal, dict) or not isinstance(expected, dict):
        return False
    if proposal.get("kind") != expected.get("kind"):
        return False
    expected_action = expected.get("action")
    if expected.get("kind") == "action":
        action = proposal.get("action")
        if not isinstance(action, dict) or action != expected_action:
            return False
    if expected.get("kind") == "completion" and proposal.get("status") != expected.get("status"):
        return False
    if expected.get("kind") == "question" and proposal.get("question") != expected.get("question"):
        return False
    return True


def _proposal_matches_context(proposal: Any, request: Any) -> bool:
    if not isinstance(proposal, dict) or proposal.get("kind") == "contract_error":
        return True
    if not isinstance(request, dict):
        return False
    observation = request.get("observation")
    if not isinstance(observation, dict):
        return False
    current_id = observation.get("observationId")
    if proposal.get("observationId") != current_id:
        return False
    if proposal.get("kind") != "completion":
        return True
    allowed = {current_id}
    trajectory = request.get("trajectory", [])
    if not isinstance(trajectory, list):
        return False
    for event in trajectory:
        if isinstance(event, dict) and isinstance(event.get("observationId"), str):
            allowed.add(event["observationId"])
    return all(
        observation_id in allowed
        for finding in proposal.get("findings", [])
        for observation_id in finding.get("observationIds", [])
    )


def _parse_output(text: str) -> tuple[Any, str]:
    stripped = text.strip()
    if stripped.startswith("<") and stripped.endswith(">"):
        return None, "xml"
    try:
        return json.loads(stripped), "json"
    except json.JSONDecodeError:
        if stripped.startswith(("{", "[", '"')):
            return None, "malformed"
        return None, "speculative_prose"


def _planning_endpoint(endpoint: str, allow_insecure_http: bool = False) -> str:
    try:
        parsed = urlsplit(endpoint)
    except ValueError as error:
        raise EvaluationError("live endpoint is invalid") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise EvaluationError("live endpoint must use HTTP(S)")
    if parsed.username is not None or parsed.password is not None:
        raise EvaluationError("live endpoint may not contain user information")
    if parsed.query or parsed.fragment:
        raise EvaluationError("live endpoint may not contain query or fragment data")
    path = parsed.path
    if path in {"", "/"}:
        path = "/v1/plan"
    elif path != "/v1/plan":
        raise EvaluationError("live endpoint path must be /v1/plan")
    if parsed.scheme == "http" and not allow_insecure_http:
        raise EvaluationError("HTTP requires explicit development opt-in")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _repair_count(raw: str | None) -> int | None:
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


def _read_bounded(stream: Any) -> bytes:
    body = stream.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise EvaluationError("live response exceeds the byte limit")
    return body


def _latency_metrics(values: Sequence[float]) -> dict[str, float]:
    ordered = sorted(values)
    if not ordered:
        return {"mean": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    return {
        "mean": round(sum(ordered) / len(ordered), 3),
        "p50": round(_percentile(ordered, 0.50), 3),
        "p95": round(_percentile(ordered, 0.95), 3),
        "max": round(ordered[-1], 3),
    }


def _percentile(ordered: Sequence[float], quantile: float) -> float:
    index = max(0, math.ceil(len(ordered) * quantile) - 1)
    return ordered[index]


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _deep_merge(base: Mapping[str, Any], override: Mapping[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(dict(base))
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _exact_fields(value: Mapping[str, Any], required: set[str]) -> bool:
    return set(value) == required


def _bounded_string(value: Any, maximum: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= maximum


def _uuid(value: Any) -> bool:
    return isinstance(value, str) and UUID_RE.fullmatch(value) is not None


def _timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _http_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and parsed.hostname is not None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate the isolated Fara planning contract")
    parser.add_argument(
        "--tasks",
        type=Path,
        default=Path(__file__).with_name("fixtures") / "fara-eval-cases.json",
        help="JSON corpus containing cases or faraEvalCases",
    )
    parser.add_argument("--mode", choices=("fixture", "live"), default="fixture")
    parser.add_argument("--endpoint", help="Live HTTP(S) endpoint; key remains environment-only")
    parser.add_argument(
        "--allow-insecure-http",
        action="store_true",
        help="Allow HTTP for an explicitly configured development endpoint",
    )
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--output", type=Path, help="Optional path for the metrics-only JSON report")
    return parser


def main(argv: Sequence[str] | None = None, environ: Mapping[str, str] | None = None) -> int:
    env = os.environ if environ is None else environ
    args = _parser().parse_args(argv)
    endpoint = args.endpoint or env.get("FARA_EVAL_ENDPOINT") or env.get("FARA_INFERENCE_URL")
    if args.mode == "live" and not endpoint:
        print("error: live mode requires an endpoint", file=sys.stderr)
        return 2
    try:
        cases = load_cases(args.tasks)
        if args.mode == "live":
            api_key = env.get("FARA_EVAL_API_KEY") or env.get("FARA_API_KEY")
            transport: Transport = LiveTransport(
                endpoint,
                api_key,
                args.timeout_seconds,
                allow_insecure_http=args.allow_insecure_http,
            )
        else:
            transport = FixtureTransport()
        report = evaluate_cases(cases, transport)
        report["configuration"] = {
            "endpointConfigured": bool(endpoint) if args.mode == "live" else False,
            "apiKeyConfigured": bool(api_key) if args.mode == "live" else False,
        }
        rendered = json.dumps(report, sort_keys=True, indent=2) + "\n"
        if args.output is not None:
            args.output.write_text(rendered, encoding="utf-8")
        sys.stdout.write(rendered)
        return 0
    except (EvaluationError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
