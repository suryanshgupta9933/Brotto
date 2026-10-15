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

// Where the config and the key live for the account in `settings.accountId`.
//
// With an id, both carry it: two cloud accounts in one Chrome profile shared
// one flat slot, and the key was the one that mattered — account A's run paid
// with account B's credential. Without an id they are the flat keys, byte for
// byte what every self-hoster's install already uses.
//
// **No migration.** A flat key written before this change belongs to whoever
// was signed in then and nothing records which, so moving it into whichever
// account signs in next would hand that account a credential that may be
// someone else's — the exact harm this exists to remove. The cloud path
// ignores the flat key; a cloud user re-pastes once into their own slot and
// the two never meet again. Self-host reads the flat key exactly as before.
//
// This is the worker-side copy of model_keys.js's `modelKeys` (the worker is a
// TS bundle, the panel a plain script, so they cannot share one function);
// scripts/test-model-keys.test.js runs both against one table.
function modelKeys(accountId: unknown): { config: string; apiKey: string } {
  return typeof accountId === "string" && accountId
    ? { config: `${MODEL_KEY}:${accountId}`, apiKey: `${API_KEY_KEY}:${accountId}` }
    : { config: MODEL_KEY, apiKey: API_KEY_KEY };
}

async function modelKeysForSettings(): Promise<{ config: string; apiKey: string }> {
  const stored = await chrome.storage.local.get("settings");
  const settings = stored.settings as { accountId?: unknown } | undefined;
  return modelKeys(settings?.accountId);
}

function isModelConfig(v: unknown): v is ModelConfig {
  return !!v && typeof v === "object"
    && typeof (v as ModelConfig).provider === "string"
    && typeof (v as ModelConfig).model === "string";
}

export async function getStoredModelConfig(): Promise<StoredModelConfig> {
  const keys = await modelKeysForSettings();
  const stored = await chrome.storage.local.get([keys.config, keys.apiKey]);
  const m = stored[keys.config] as unknown;
  const k = stored[keys.apiKey];

  // Migration: old shape is `{ model_config: {...}, api_key: "..." }`, and it
  // only ever sat under the flat key — a self-hoster's, since the wizard wrote
  // it before accounts existed.
  if (m && typeof m === "object" && !isModelConfig(m)) {
    const old = m as { model_config?: unknown; api_key?: unknown };
    const migrated = isModelConfig(old.model_config) ? old.model_config : null;
    const oldKey = typeof old.api_key === "string" ? old.api_key : null;
    // Re-save in new layout and drop the legacy blob. Idempotent.
    await Promise.all([
      migrated
        ? chrome.storage.local.set({ [keys.config]: migrated })
        : chrome.storage.local.remove(keys.config),
      oldKey
        ? chrome.storage.local.set({ [keys.apiKey]: oldKey })
        : chrome.storage.local.remove(keys.apiKey),
    ]);
    return { model_config: migrated, api_key: oldKey };
  }

  return {
    model_config: isModelConfig(m) ? m : null,
    api_key: typeof k === "string" ? k : null,
  };
}

export async function setStoredModelConfig(value: StoredModelConfig): Promise<void> {
  const keys = await modelKeysForSettings();
  await Promise.all([
    chrome.storage.local.set({ [keys.config]: value.model_config }),
    value.api_key
      ? chrome.storage.local.set({ [keys.apiKey]: value.api_key })
      : chrome.storage.local.remove(keys.apiKey),
  ]);
}