/**
 * Verification gate for the long-horizon harness.
 *
 * Blocks the model's `terminate` action until every must_have completion
 * criterion has been verified (model called verify_completion with
 * satisfied=true) at least once during the session.
 *
 * ponytail: keep this dumb. The gate is a pure function over (criteria,
 * verifications). No I/O, no async, no model calls. The orchestrator wires
 * it into the action pipeline; the model sees the rejection reason in its
 * next prompt and pivots to verify the missing criterion(s).
 */
import type { CompletionCriterion } from "../criteria/extract.js";
import type { ScratchpadSummary } from "../scratchpad/summarize.js";
export interface TerminationGateInput {
    criteria: CompletionCriterion[];
    verifications: ScratchpadSummary["verifications"];
}
export interface TerminationGateResult {
    allowed: boolean;
    missingMustHave: string[];
    missingShouldHave: string[];
    reason: string;
}
export declare function evaluateTerminationGate(input: TerminationGateInput): TerminationGateResult;
//# sourceMappingURL=gate.d.ts.map