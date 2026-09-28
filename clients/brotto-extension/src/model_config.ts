// Storage split for model config + API key.
// - model_config: chrome.storage.local — persists across browser restarts (not sensitive).
// - api_key:      chrome.storage.session — in-memory only, cleared on browser restart.
//                  Mirrors the existing pause-state pattern (background.ts:97).
//                  Disk leak avoided; UX unchanged (auto-sent per task_start).
//
// Migration: the pre-security-fix layout stored everything under one key
// `modelConfig = { model_config: {...}, api_key: "..." }`. Reads transparently
// detect that shape and re-save in the new layout on first call.

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

function isModelConfig(v: unknown): v is ModelConfig {
  return !!v && typeof v === "object"
    && typeof (v as ModelConfig).provider === "string"
    && typeof (v as ModelConfig).model === "string";
}

export async function getStoredModelConfig(): Promise<StoredModelConfig> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(MODEL_KEY),
    chrome.storage.session.get(API_KEY_KEY),
  ]);
  const m = local[MODEL_KEY] as unknown;
  const k = session[API_KEY_KEY];

  // Migration: old shape is `{ model_config: {...}, api_key: "..." }`.
  if (m && typeof m === "object" && !isModelConfig(m)) {
    const old = m as { model_config?: unknown; api_key?: unknown };
    const migrated = isModelConfig(old.model_config) ? old.model_config : null;
    const oldKey = typeof old.api_key === "string" ? old.api_key : null;
    // Re-save in new layout and drop the legacy blob. Idempotent.
    await Promise.all([
      migrated
        ? chrome.storage.local.set({ [MODEL_KEY]: migrated })
        : chrome.storage.local.remove(MODEL_KEY),
      oldKey
        ? chrome.storage.session.set({ [API_KEY_KEY]: oldKey })
        : chrome.storage.session.remove(API_KEY_KEY),
    ]);
    return { model_config: migrated, api_key: oldKey };
  }

  return {
    model_config: isModelConfig(m) ? m : null,
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