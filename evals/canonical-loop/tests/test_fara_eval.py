from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "fara-eval.py"
FIXTURE_PATH = ROOT / "fixtures" / "fara-eval-cases.json"


def load_module():
    spec = importlib.util.spec_from_file_location("fara_eval", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load fara-eval.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FaraEvalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(MODULE_PATH.is_file(), "fara-eval.py must exist")
        self.module = load_module()

    def test_fixture_corpus_scores_contract_failures_and_representative_tasks(self) -> None:
        cases = self.module.load_cases(FIXTURE_PATH)

        report = self.module.evaluate_cases(cases, self.module.FixtureTransport())

        self.assertEqual(report["mode"], "fixture")
        self.assertEqual(report["caseCount"], 15)
        self.assertEqual(report["validStructuredProposalCount"], 12)
        self.assertEqual(report["validStructuredProposalRate"], 0.8)
        self.assertEqual(report["correctNextActionCount"], 9)
        self.assertEqual(report["correctNextActionScoredCount"], 13)
        self.assertAlmostEqual(report["correctNextActionRate"], 9 / 13)
        self.assertEqual(report["prematureCompletionCount"], 1)
        self.assertEqual(report["speculativeProseCount"], 1)
        self.assertEqual(report["xmlOutputCount"], 1)
        self.assertEqual(report["malformedOutputCount"], 1)
        self.assertEqual(report["repairCount"], 1)
        self.assertEqual(report["repairTelemetryMissingCount"], 0)
        self.assertTrue(
            all(bucket["rate"] == 1.0 for bucket in report["representativeTasks"].values())
        )
        self.assertEqual(len(report["corpusSha256"]), 64)
        self.assertNotIn("cases", report)
        self.assertNotIn("request", json.dumps(report).lower())
        self.assertNotIn("response", json.dumps(report).lower())

    def test_corpus_covers_task11_categories_with_exact_actions(self) -> None:
        cases = self.module.load_cases(FIXTURE_PATH)
        categories = {case["category"] for case in cases}

        self.assertTrue({
            "navigation",
            "exploration",
            "extraction",
            "search-comparison",
            "wrong-click-recovery",
            "form-no-submit",
            "approval-required-submission",
            "reconnect-context",
            "cancellation",
        }.issubset(categories))
        for case in cases:
            expected = case["expected"]
            if expected["kind"] == "action":
                self.assertIsInstance(expected.get("action"), dict, case["id"])
                self.assertNotIn("actionType", expected, case["id"])

    def test_all_action_expectations_are_scored_and_require_exact_action(self) -> None:
        request = self.module.load_cases(FIXTURE_PATH)[0]["request"]
        case = {
            "id": "wrong-scroll",
            "category": "exploration",
            "request": request,
            "expected": {"kind": "action", "action": {"type": "scroll", "deltaX": 0, "deltaY": 600}},
            "fixtureResponse": {
                "status": 200,
                "repairCount": 0,
                "body": {
                    "kind": "action",
                    "observationId": request["observation"]["observationId"],
                    "proposedAt": "2026-08-03T10:00:01Z",
                    "action": {"type": "scroll", "deltaX": 0, "deltaY": 200},
                },
            },
        }

        report = self.module.evaluate_cases([case], self.module.FixtureTransport())

        self.assertEqual(report["correctNextActionScoredCount"], 1)
        self.assertEqual(report["correctNextActionCount"], 0)

    def test_forbidden_browser_data_is_rejected_before_transport(self) -> None:
        case = self.module.load_cases(FIXTURE_PATH)[0]
        case["request"]["observation"]["cookies"] = [{"name": "session"}]

        class NeverTransport:
            mode = "live"

            def send(self, _case):
                self.fail("transport must not receive invalid browser data")

        with self.assertRaises(self.module.EvaluationError):
            self.module.evaluate_cases([case], NeverTransport())

    def test_corpus_and_fixture_response_sizes_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            oversized = Path(directory) / "oversized.json"
            oversized.write_bytes(b" " * (self.module.MAX_CORPUS_BYTES + 1))
            with self.assertRaises(self.module.EvaluationError):
                self.module.load_cases(oversized)

        case = self.module.load_cases(FIXTURE_PATH)[0]
        case["fixtureResponse"] = {
            "status": 200,
            "repairCount": 0,
            "bodyText": "x" * (self.module.MAX_RESPONSE_BYTES + 1),
        }
        with self.assertRaises(self.module.EvaluationError):
            self.module.FixtureTransport().send(case)

    def test_contract_validation_rejects_unknown_fields(self) -> None:
        proposal = {
            "kind": "action",
            "observationId": "11111111-1111-4111-8111-111111111111",
            "proposedAt": "2026-08-03T10:00:01Z",
            "action": {"type": "wait", "durationMs": 100, "invented": True},
        }

        valid, reason = self.module.validate_proposal(proposal)

        self.assertFalse(valid)
        self.assertEqual(reason, "action has unknown fields")

    def test_loaded_live_corpus_contains_complete_planning_requests(self) -> None:
        cases = self.module.load_cases(FIXTURE_PATH)

        for case in cases:
            self.assertEqual(
                set(case["request"]),
                {"goal", "completionCriteria", "observation", "trajectory", "limits"},
                case["id"],
            )

    def test_proposal_for_another_observation_is_a_context_violation(self) -> None:
        request = self.module.load_cases(FIXTURE_PATH)[0]["request"]
        case = {
            "id": "stale",
            "category": "context",
            "request": request,
            "expected": {"kind": "action", "action": {"type": "wait", "durationMs": 100}},
            "fixtureResponse": {
                "status": 200,
                "repairCount": 0,
                "body": {
                    "kind": "action",
                    "observationId": "99999999-9999-4999-8999-999999999999",
                    "proposedAt": "2026-08-03T10:00:01Z",
                    "action": {"type": "wait", "durationMs": 100},
                },
            },
        }

        report = self.module.evaluate_cases([case], self.module.FixtureTransport())

        self.assertEqual(report["validStructuredProposalCount"], 0)
        self.assertEqual(report["contextViolationCount"], 1)
        self.assertEqual(report["correctNextActionCount"], 0)

    def test_live_transport_sends_contract_and_reads_repair_telemetry(self) -> None:
        received: dict[str, object] = {}

        class Response:
            status = 200
            headers = {"x-fara-repair-count": "2"}

            def __enter__(self):
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self, _limit: int) -> bytes:
                return json.dumps({
                    "kind": "action",
                    "observationId": "11111111-1111-4111-8111-111111111111",
                    "proposedAt": "2026-08-03T10:00:01Z",
                    "action": {"type": "wait", "durationMs": 100},
                }).encode()

        def urlopen(request, timeout):
            received["url"] = request.full_url
            received["authorization"] = request.headers.get("Authorization")
            received["body"] = json.loads(request.data)
            received["timeout"] = timeout
            return Response()

        transport = self.module.LiveTransport(
            "http://127.0.0.1:8080/v1/plan",
            api_key="runtime-secret",
            timeout=2,
            allow_insecure_http=True,
        )
        request = self.module.load_cases(FIXTURE_PATH)[0]["request"]
        with patch.object(self.module, "urlopen", urlopen):
            result = transport.send({"id": "local", "request": request})

        self.assertEqual(received["url"], "http://127.0.0.1:8080/v1/plan")
        self.assertEqual(received["authorization"], "Bearer runtime-secret")
        self.assertEqual(received["body"], request)
        self.assertEqual(received["timeout"], 2)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.repair_count, 2)

    def test_live_endpoint_rejects_ambiguous_or_insecure_urls(self) -> None:
        invalid = [
            "http://user:password@127.0.0.1:8080/v1/plan",
            "http://127.0.0.1:8080/v1/plan?token=top-secret",
            "http://127.0.0.1:8080/v1/plan#fragment",
            "http://127.0.0.1:8080/v1/plan",
            "https://inference.example/v1/plan/",
            "https://inference.example/v1/chat/completions",
            "http://inference.example/v1/plan",
        ]
        for endpoint in invalid:
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(self.module.EvaluationError):
                    self.module.LiveTransport(endpoint)

        transport = self.module.LiveTransport("http://dev-inference.internal", allow_insecure_http=True)
        self.assertIsInstance(transport, self.module.LiveTransport)
        self.assertEqual(
            self.module._planning_endpoint("http://dev-inference.internal", True),
            "http://dev-inference.internal/v1/plan",
        )

    def test_live_response_read_is_bounded_and_rejects_overflow(self) -> None:
        class OversizedResponse:
            status = 200
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self, limit: int) -> bytes:
                return b"x" * limit

        transport = self.module.LiveTransport("https://inference.example/v1/plan")
        case = self.module.load_cases(FIXTURE_PATH)[0]
        with patch.object(self.module, "urlopen", lambda *_args, **_kwargs: OversizedResponse()):
            with self.assertRaises(self.module.EvaluationError):
                transport.send(case)

    def test_live_failures_do_not_expose_endpoint_or_key_material(self) -> None:
        with self.assertRaises(self.module.EvaluationError) as invalid_endpoint:
            self.module.LiveTransport(
                "https://user:password@inference.example/v1/plan?key=query-secret"
            )
        self.assertNotIn("password", str(invalid_endpoint.exception))
        self.assertNotIn("query-secret", str(invalid_endpoint.exception))

        transport = self.module.LiveTransport(
            "https://inference.example/v1/plan", api_key="runtime-secret"
        )
        case = self.module.load_cases(FIXTURE_PATH)[0]
        with patch.object(self.module, "urlopen", side_effect=OSError("query-secret")):
            with self.assertRaises(self.module.EvaluationError) as request_failure:
                transport.send(case)
        self.assertEqual(str(request_failure.exception), "live endpoint request failed")
        self.assertNotIn("runtime-secret", str(request_failure.exception))
        self.assertNotIn("query-secret", str(request_failure.exception))

    def test_live_mode_fails_closed_without_service_contract_models(self) -> None:
        case = self.module.load_cases(FIXTURE_PATH)[0]

        class NeverTransport:
            mode = "live"

            def send(self, _case):
                raise AssertionError("transport must not run without canonical models")

        with patch.object(self.module, "_load_contract_models", return_value=None):
            with self.assertRaisesRegex(
                self.module.EvaluationError, "canonical planning contract is unavailable"
            ):
                self.module.evaluate_cases([case], NeverTransport())

    def test_live_request_size_is_bounded_before_http(self) -> None:
        transport = self.module.LiveTransport("https://inference.example/v1/plan")
        case = self.module.load_cases(FIXTURE_PATH)[0]
        case["request"]["goal"] = "x" * self.module.MAX_REQUEST_BYTES

        with patch.object(
            self.module, "urlopen", side_effect=AssertionError("HTTP must not be called")
        ):
            with self.assertRaises(self.module.EvaluationError):
                transport.send(case)

    def test_cli_requires_endpoint_only_when_live_mode_is_selected(self) -> None:
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            exit_code = self.module.main(
                ["--mode", "live", "--tasks", str(FIXTURE_PATH)], environ={}
            )

        self.assertEqual(exit_code, 2)
        self.assertEqual(stderr.getvalue().strip(), "error: live mode requires an endpoint")


if __name__ == "__main__":
    unittest.main()
