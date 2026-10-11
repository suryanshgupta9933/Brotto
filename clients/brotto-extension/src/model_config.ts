// Storage for model config + API key. Both in chrome.storage.local.
//
// The key used to live in chrome.storage.session, which cleared it on browser
// restart — that made "browser restart" the only way to lose it, and every
// restart cost the user a re-paste for no benefit: the key never leaves the
// device (it is sent per task_start to the relay, which is the only
// destination), and chrome.storage.local is already where the non-secret half
// sits. Persistence is the user's call — clear it, or change it.
//
// Migration: the pre-security-fix layout stored everything under one key
// `modelConfig = { model_config: {...}, api_key: "..." }`. Reads transparently
// detect that shape and re-save in the new layout on first call.

export interface ModelConfig {
  provider: string;
  model: string;
  context_window?: number;
  // Where the provider's API lives, for the OpenAI-compatible and self-hosted
  // vendors. On the config rather than beside the key because it is not a
  // secret and must survive a browser restart — otherwise a self-hosted or
  // OpenRouter user re-pastes the URL every restart, the way they re-paste
  // their key.
  base_url?: string;
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
  const stored = await chrome.storage.local.get([MODEL_KEY, API_KEY_KEY]);
  const m = stored[MODEL_KEY] as unknown;
  const k = stored[API_KEY_KEY];

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
        ? chrome.storage.local.set({ [API_KEY_KEY]: oldKey })
        : chrome.storage.local.remove(API_KEY_KEY),
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
      ? chrome.storage.local.set({ [API_KEY_KEY]: value.api_key })
      : chrome.storage.local.remove(API_KEY_KEY),
  ]);
}