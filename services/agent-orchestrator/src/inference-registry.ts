import { FaraPlanner, type FaraPlannerConfig } from "./adapters/fara-planner.js";
import { OpenAICompatiblePlanner, type OpenAICompatibleConfig } from "./adapters/openai-compatible-planner.js";
import type { InferencePort } from "./engine/types.js";

export type InferenceFamily = "fara" | "openai-compatible";

export type InferenceConfig =
  | ({ family: "fara" } & FaraPlannerConfig)
  | ({ family: "openai-compatible" } & OpenAICompatibleConfig);

export function createPlanner(config: InferenceConfig): InferencePort {
  switch (config.family) {
    case "fara":
      return new FaraPlanner(config);
    case "openai-compatible":
      return new OpenAICompatiblePlanner(config);
  }
}

export function inferFamilyFromEnv(): InferenceFamily {
  if (process.env.FARA_ENDPOINT) return "fara";
  if (process.env.OPENAI_API_KEY) return "openai-compatible";
  if (process.env.AZURE_OPENAI_API_KEY) return "openai-compatible";
  if (process.env.OLLAMA_HOST) return "openai-compatible";
  throw new Error(
    "No inference family configured. Set FARA_ENDPOINT, OPENAI_API_KEY, AZURE_OPENAI_API_KEY, or OLLAMA_HOST.",
  );
}
