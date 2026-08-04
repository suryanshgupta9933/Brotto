from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
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
        self.assertEqual(report["caseCount"], 9)
        self.assertEqual(report["validStructuredProposalCount"], 6)
        self.assertAlmostEqual(report["validStructuredProposalRate"], 2 / 3)
        self.assertEqual(report["correctNextActionCount"], 4)
        self.assertEqual(report["correctNextActionScoredCount"], 5)
        self.assertAlmostEqual(report["correctNextActionRate"], 0.8)
        self.assertEqual(report["prematureCompletionCount"], 1)
        self.assertEqual(report["speculativeProseCount"], 1)
        self.assertEqual(report["xmlOutputCount"], 1)
        self.assertEqual(report["malformedOutputCount"], 1)
        self.assertEqual(report["repairCount"], 1)
        self.assertEqual(report["repairTelemetryMissingCount"], 0)
        self.assertEqual(
            report["representativeTasks"],
            {
                "exploration": {"correct": 2, "total": 2, "rate": 1.0},
                "navigation": {"correct": 1, "total": 1, "rate": 1.0},
            },
        )
        self.assertEqual(len(report["corpusSha256"]), 64)
        self.assertNotIn("cases", report)
        self.assertNotIn("request", json.dumps(report).lower())
        self.assertNotIn("response", json.dumps(report).lower())

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
        case = {
            "id": "stale",
            "scoreNextAction": True,
            "request": {
                "observation": {
                    "observationId": "11111111-1111-4111-8111-111111111111"
                },
                "trajectory": [],
            },
            "expected": {"kind": "action", "actionType": "wait"},
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

            def read(self) -> bytes:
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
            "http://127.0.0.1:8080/v1/plan", api_key="runtime-secret", timeout=2
        )
        request = {"goal": "Wait", "completionCriteria": ["Page settles"]}
        with patch.object(self.module, "urlopen", urlopen):
            result = transport.send({"id": "local", "request": request})

        self.assertEqual(received["url"], "http://127.0.0.1:8080/v1/plan")
        self.assertEqual(received["authorization"], "Bearer runtime-secret")
        self.assertEqual(received["body"], request)
        self.assertEqual(received["timeout"], 2)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.repair_count, 2)

    def test_live_failure_never_exposes_endpoint_credentials_or_query(self) -> None:
        transport = self.module.LiveTransport(
            "http://user:password@127.0.0.1:1/v1/plan?token=top-secret",
            api_key="runtime-secret",
            timeout=0.05,
        )

        with self.assertRaises(self.module.EvaluationError) as caught:
            transport.send({"id": "local", "request": {"goal": "Wait"}})

        message = str(caught.exception)
        self.assertEqual(message, "live endpoint request failed")
        self.assertNotIn("password", message)
        self.assertNotIn("top-secret", message)
        self.assertNotIn("runtime-secret", message)

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
