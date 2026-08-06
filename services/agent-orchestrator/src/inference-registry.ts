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
    default:
      config satisfies never;
      throw new Error(`Unsupported inference family: ${(config as { family: string }).family}`);
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

// ponytail: mirror demo-server's env handling so the production server picks
// up the same config without callers having to re-implement env parsing.
export function buildPlannerConfigFromEnv(): InferenceConfig {
  const family = inferFamilyFromEnv();
  if (family === "fara") {
    return { family: "fara", endpoint: process.env.FARA_ENDPOINT ?? "" };
  }
  const isAzure = !!process.env.AZURE_OPENAI_API_KEY;
  const baseUrl = process.env.OLLAMA_HOST
    ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/v1`
    : isAzure
      ? `${process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "") ?? ""}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT ?? ""}`
      : "https://api.openai.com/v1";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const baseUrlWithVersion = isAzure && apiVersion
    ? `${baseUrl}?api-version=${encodeURIComponent(apiVersion)}`
    : baseUrl;
  return {
    family: "openai-compatible",
    baseUrl: baseUrlWithVersion,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY,
    apiKeyHeader: isAzure ? "api-key" : "authorization",
    apiKeyPrefix: isAzure ? "" : "Bearer ",
    model: process.env.SMOKE_MODEL ?? process.env.AZURE_OPENAI_MODEL_NAME ?? "gpt-4o-mini",
  };
}
