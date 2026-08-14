import type { CompletionProposalV1, TrajectoryEventV1 } from '@brotto/brotto-action-schema';
import type { CompletionVerificationDecision, CompletionVerificationPort } from './types.js';
export declare class CompletionVerifier implements CompletionVerificationPort {
    verify(proposal: CompletionProposalV1, trajectory: TrajectoryEventV1[]): CompletionVerificationDecision;
    private decision;
}
//# sourceMappingURL=completion-verifier.d.ts.map