// Thin wrapper around chrome.storage.local for model config + API key.
// Mirrors the storage pattern used for userPolicy in this extension.

export interface ModelConfig {
  provider: string;
  model: string;
  context_window?: number;
}

export interface StoredModelConfig {
  model_config: ModelConfig | null;
  api_key: string | null;
}

const KEY = "modelConfig";

export async function getStoredModelConfig(): Promise<StoredModelConfig> {
  const got = await chrome.storage.local.get(KEY);
  const v = got[KEY];
  if (!v || typeof v !== "object") return { model_config: null, api_key: null };
  return {
    model_config: v.model_config ?? null,
    api_key: v.api_key ?? null,
  };
}

export async function setStoredModelConfig(value: StoredModelConfig): Promise<void> {
  await chrome.storage.local.set({ [KEY]: value });
}