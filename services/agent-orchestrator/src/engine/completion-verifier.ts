import type {
  CompletionFindingV1,
  CompletionProposalV1,
  ObservationV1Id,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';
import type { CompletionVerificationDecision, CompletionVerificationPort } from './types.js';

const speculativeLanguage = /\b(?:apparently|assum(?:e|ed|ing)|likely|may|might|perhaps|probably|seems?|should|possibly)\b/i;

export class CompletionVerifier implements CompletionVerificationPort {
  verify(
    proposal: CompletionProposalV1,
    trajectory: TrajectoryEventV1[],
  ): CompletionVerificationDecision {
    if (proposal.status === 'failed') {
      return this.decision('failed', 'MODEL_REPORTED_FAILURE', proposal.summary);
    }
    if (proposal.status === 'partial' || proposal.unmetCriteria.length > 0) {
      return this.decision(
        'continue',
        'UNMET_CRITERIA',
        proposal.unmetCriteria.length === 0
          ? 'The model reported only partial completion'
          : `Required criteria remain unmet: ${proposal.unmetCriteria.join('; ')}`,
      );
    }
    if (proposal.findings.length === 0) {
      return this.decision('continue', 'INSUFFICIENT_EVIDENCE', 'Completion has no structured findings');
    }
    if (proposal.findings.every((finding: CompletionFindingV1) => speculativeLanguage.test(finding.fact))) {
      return this.decision('continue', 'SPECULATIVE_EVIDENCE', 'All completion findings are speculative');
    }

    const observed = new Set(
      trajectory
        .filter((event) => event.kind === 'observation_captured' || event.kind === 'verification_result')
        .flatMap((event) => event.observationId === undefined ? [] : [event.observationId]),
    );
    const hasReferencedEvidence = proposal.findings.some((finding: CompletionFindingV1) => (
      finding.observationIds.some((observationId: ObservationV1Id) => observed.has(observationId))
    ));
    if (!hasReferencedEvidence) {
      return this.decision(
        'continue',
        'INSUFFICIENT_EVIDENCE',
        'No finding references an observed or verified browser fact',
      );
    }

    const lastAction = trajectory
      .filter((event) => event.kind === 'action_completed')
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))[0];
    const hasFreshPostActionObservation = lastAction !== undefined && trajectory.some((event) => (
      event.kind === 'observation_captured' &&
      event.observationId !== undefined &&
      Date.parse(event.occurredAt) > Date.parse(lastAction.occurredAt) &&
      proposal.findings.some((finding: CompletionFindingV1) => finding.observationIds.includes(event.observationId!))
    ));
    if (!hasFreshPostActionObservation) {
      return this.decision(
        'continue',
        'STALE_EVIDENCE',
        'Completion lacks referenced browser evidence newer than the last executed action',
      );
    }

    return this.decision('accepted', 'VERIFIED_COMPLETION', 'Completion evidence is verified');
  }

  private decision(
    outcome: CompletionVerificationDecision['outcome'],
    code: CompletionVerificationDecision['code'],
    reason: string,
  ): CompletionVerificationDecision {
    return { outcome, accepted: outcome === 'accepted', code, reason };
  }
}
