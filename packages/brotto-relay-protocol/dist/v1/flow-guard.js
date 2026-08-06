import { ObservationV1Schema, TrajectoryLinkageV1Schema } from '@brotto/brotto-action-schema';
import { AgentEnvelopeV1Schema } from './envelope.js';
/** Internal stateful flow component. Use SecureAgentIngress for raw inbound wire data. */
export class AgentFlowGuard {
    observationsBySession = new Map();
    actionsBySession = new Map();
    approvalsBySession = new Map();
    accept(input) {
        const parsed = AgentEnvelopeV1Schema.safeParse(input);
        if (!parsed.success)
            return { status: 'rejected', code: 'INVALID_ENVELOPE' };
        const envelope = parsed.data;
        switch (envelope.payload.type) {
            case 'observation.submitted':
                this.sessionMap(this.observationsBySession, envelope.sessionId).set(envelope.payload.observation.observationId, envelope.payload.observation);
                return { status: 'accepted', envelope };
            case 'approval.resolved':
                this.sessionMap(this.approvalsBySession, envelope.sessionId).set(envelope.payload.resolution.actionId, envelope.payload.resolution);
                return { status: 'accepted', envelope };
            case 'action.command': {
                const sourceObservation = this.sessionMap(this.observationsBySession, envelope.sessionId)
                    .get(envelope.payload.command.observationId);
                if (sourceObservation === undefined)
                    return { status: 'rejected', code: 'ACTION_FLOW_INVALID' };
                this.sessionMap(this.actionsBySession, envelope.sessionId).set(envelope.payload.command.actionId, {
                    sourceObservation,
                    proposal: envelope.payload.proposal,
                    policyDecision: envelope.payload.policyDecision,
                    command: envelope.payload.command,
                });
                return { status: 'accepted', envelope };
            }
            case 'action.completed': {
                const action = this.sessionMap(this.actionsBySession, envelope.sessionId).get(envelope.payload.result.actionId);
                if (action === undefined)
                    return { status: 'rejected', code: 'ACTION_FLOW_INVALID' };
                const approvalResolution = this.sessionMap(this.approvalsBySession, envelope.sessionId)
                    .get(envelope.payload.result.actionId);
                const linkage = TrajectoryLinkageV1Schema.safeParse({
                    ...action,
                    approvalResolution,
                    result: envelope.payload.result,
                });
                if (!linkage.success)
                    return { status: 'rejected', code: 'ACTION_FLOW_INVALID' };
                return { status: 'accepted', envelope };
            }
            default:
                return { status: 'accepted', envelope };
        }
    }
    restoreObservation(sessionId, observation) {
        const parsed = ObservationV1Schema.safeParse(observation);
        if (!parsed.success)
            throw new TypeError('Cannot restore invalid flow observation');
        this.sessionMap(this.observationsBySession, sessionId).set(parsed.data.observationId, parsed.data);
    }
    sessionMap(store, sessionId) {
        let sessionValues = store.get(sessionId);
        if (sessionValues === undefined) {
            sessionValues = new Map();
            store.set(sessionId, sessionValues);
        }
        return sessionValues;
    }
}
//# sourceMappingURL=flow-guard.js.map