const speculativeLanguage = /\b(?:apparently|assum(?:e|ed|ing)|likely|may|might|perhaps|probably|seems?|should|possibly)\b/i;
export class CompletionVerifier {
    verify(proposal, trajectory) {
        if (proposal.status === 'failed') {
            return this.decision('failed', 'MODEL_REPORTED_FAILURE', proposal.summary);
        }
        if (speculativeLanguage.test(proposal.summary)) {
            return this.decision('continue', 'SPECULATIVE_EVIDENCE', 'The completion summary is speculative');
        }
        if (proposal.status === 'partial' || proposal.unmetCriteria.length > 0) {
            return this.decision('continue', 'UNMET_CRITERIA', proposal.unmetCriteria.length === 0
                ? 'The model reported only partial completion'
                : `Required criteria remain unmet: ${proposal.unmetCriteria.join('; ')}`);
        }
        if (proposal.findings.length === 0) {
            return this.decision('continue', 'INSUFFICIENT_EVIDENCE', 'Completion has no structured findings');
        }
        const concreteFindings = proposal.findings.filter((finding) => !speculativeLanguage.test(finding.fact));
        if (concreteFindings.length === 0) {
            return this.decision('continue', 'SPECULATIVE_EVIDENCE', 'All completion findings are speculative');
        }
        const observed = new Set(trajectory
            .filter((event) => event.kind === 'observation_captured' || event.kind === 'verification_result')
            .flatMap((event) => event.observationId === undefined ? [] : [event.observationId]));
        const captured = new Set(trajectory
            .filter((event) => event.kind === 'observation_captured')
            .flatMap((event) => event.observationId === undefined ? [] : [event.observationId]));
        const hasReferencedEvidence = concreteFindings.some((finding) => (finding.observationIds.some((observationId) => observed.has(observationId))));
        if (!hasReferencedEvidence) {
            return this.decision('continue', 'INSUFFICIENT_EVIDENCE', 'No finding references an observed or verified browser fact');
        }
        const lastAction = trajectory
            .filter((event) => event.kind === 'action_completed')
            .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))[0];
        const hasFreshPostActionObservation = lastAction === undefined
            ? captured.has(proposal.observationId) && concreteFindings.some((finding) => finding.observationIds.includes(proposal.observationId))
            : trajectory.some((event) => (event.kind === 'observation_captured' &&
                event.observationId !== undefined &&
                Date.parse(event.occurredAt) > Date.parse(lastAction.occurredAt) &&
                concreteFindings.some((finding) => finding.observationIds.includes(event.observationId))));
        if (!hasFreshPostActionObservation) {
            return this.decision('continue', 'STALE_EVIDENCE', 'Completion lacks referenced browser evidence newer than the last executed action');
        }
        return this.decision('accepted', 'VERIFIED_COMPLETION', 'Completion evidence is verified');
    }
    decision(outcome, code, reason) {
        return { outcome, accepted: outcome === 'accepted', code, reason };
    }
}
//# sourceMappingURL=completion-verifier.js.map