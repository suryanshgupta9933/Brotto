// Storage split for model config + API key.
// - model_config: chrome.storage.local — persists across browser restarts (not sensitive).
// - api_key:      chrome.storage.session — in-memory only, cleared on browser restart.
//                  Mirrors the existing pause-state pattern (background.ts:97).
//                  Disk leak avoided; UX unchanged (auto-sent per task_start).

export interface ModelConfig {
  provider: string;
  model: string;
  context_window?: number;
}

export interface StoredModelConfig {
  model_config: ModelConfig | null;
  api_key: string | null;
}

const MODEL_KEY = "modelConfig";
const API_KEY_KEY = "modelApiKey";

export async function getStoredModelConfig(): Promise<StoredModelConfig> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(MODEL_KEY),
    chrome.storage.session.get(API_KEY_KEY),
  ]);
  const m = local[MODEL_KEY];
  const k = session[API_KEY_KEY];
  return {
    model_config: m && typeof m === "object" ? (m as ModelConfig) : null,
    api_key: typeof k === "string" ? k : null,
  };
}

export async function setStoredModelConfig(value: StoredModelConfig): Promise<void> {
  await Promise.all([
    chrome.storage.local.set({ [MODEL_KEY]: value.model_config }),
    value.api_key
      ? chrome.storage.session.set({ [API_KEY_KEY]: value.api_key })
      : chrome.storage.session.remove(API_KEY_KEY),
  ]);
}