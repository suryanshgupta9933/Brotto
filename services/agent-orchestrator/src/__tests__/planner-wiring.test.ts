/**
 * Planner Wiring Tests
 *
 * Tests that AgentOrchestrator.plan() correctly routes through InferencePort
 * instead of the legacy FaraInferenceClient.
 */

import { jest } from '@jest/globals';
import { AgentOrchestrator } from '../server.js';
import type { InferencePort, PlanningInput, PlanningOutcome } from '../engine/types.js';
import type { ActionProposalV1 } from '@fara-platform/fara-action-schema';

const fakeOutcome: PlanningOutcome = {
  kind: 'action',
  proposalId: '00000000-0000-4000-8000-000000000010' as never,
  observationId: '00000000-0000-4000-8000-000000000011' as never,
  taskId: '00000000-0000-4000-8000-000000000012' as never,
  proposedAt: '2026-08-06T00:00:00.000Z',
  rationale: 'test stub',
  action: {
    type: 'left_click',
    x: 0,
    y: 0,
    targetId: '00000000-0000-4000-8000-000000000013' as never,
  },
} as ActionProposalV1;

const stubPlanner: InferencePort = {
  plan: jest.fn(async (_input: PlanningInput, _signal: AbortSignal) => fakeOutcome) as InferencePort['plan'],
};

describe('AgentOrchestrator.plan() routes through InferencePort', () => {
  it('calls planner.plan() instead of legacy FaraInferenceClient', async () => {
    const orch = new AgentOrchestrator({
      session: { sessionId: 's1', goal: 'click buy', tenantId: 't1', userId: 'u1' },
      plannerConfig: { family: 'openai-compatible', baseUrl: 'http://x', model: 'y', apiKey: 'k', transport: jest.fn() as never },
      mcpGateway: {} as never,
    });
    orch.setPlannerForTesting(stubPlanner);
    await orch.triggerPlan();
    expect(stubPlanner.plan).toHaveBeenCalledTimes(1);
  });
});
