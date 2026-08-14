import { type BrottoPlannerConfig } from "./adapters/brotto-planner.js";
import { type OpenAICompatibleConfig } from "./adapters/openai-compatible-planner.js";
import type { InferencePort } from "./engine/types.js";
export type InferenceFamily = "brotto" | "openai-compatible";
export type InferenceConfig = ({
    family: "brotto";
} & BrottoPlannerConfig) | ({
    family: "openai-compatible";
} & OpenAICompatibleConfig);
export declare function createPlanner(config: InferenceConfig): InferencePort;
export declare function inferFamilyFromEnv(): InferenceFamily;
export declare function buildPlannerConfigFromEnv(): InferenceConfig;
//# sourceMappingURL=inference-registry.d.ts.map