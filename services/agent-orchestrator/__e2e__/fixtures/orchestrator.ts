import { AgentOrchestrator } from "../../src/server.js";
import type { PlanningInput, PlanningOutcome } from "../../src/engine/types.js";
import type { InferenceConfig } from "../../src/inference-registry.js";
import type { ObservationV1 } from "@fara-platform/fara-action-schema";

export interface OrchestratorFixture {
  planStep: (observation: ObservationV1) => Promise<PlanningOutcome>;
  stop: () => Promise<void>;
}

export async function startOrchestrator(config: {
  plannerConfig: InferenceConfig;
  ollamaUrl: string;
}): Promise<OrchestratorFixture> {
  const orch = new AgentOrchestrator({
    session: { sessionId: "e2e-" + Date.now(), goal: "login", tenantId: "t", userId: "u" },
    plannerConfig: config.plannerConfig,
    mcpGateway: {} as never,
  });

  return {
    planStep: async (observation: ObservationV1) => {
      const input: PlanningInput = {
        workId: "e2e-step-" + Date.now(),
        sessionId: orch.sessionIdForTesting() as never,
        taskId: orch.taskIdForTesting() as never,
        goal: "Log in to https://the-internet.herokuapp.com/login with username 'tomsmith' and password 'SuperSecretPassword!' then verify the page contains 'Welcome to the Secure Area'",
        completionCriteria: ["Welcome to the Secure Area visible"],
        observation,
        recentResults: [],
        trajectory: [],
      };
      return orch.runPlannerForTesting(input);
    },
    stop: async () => { /* no async cleanup needed */ },
  };
}
