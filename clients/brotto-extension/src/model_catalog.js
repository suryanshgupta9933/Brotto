// model_catalog.js — the provider/model list, fetched from the server.
//
// This was three hand-kept copies (sidepanel.js, welcome.js, and the Python
// registry) and they had already drifted: the extension listed three MiniMax
// models where the server listed four. `GET /v1/models` is now the one that
// counts, so adding a model is one edit in model/catalog.py.
//
// The FALLBACK below is the remaining copy and it is deliberately not a thing
// to maintain: it is small, it is stale-tolerant, and it exists only so
// Settings still opens when the server is down. Anything missing from it
// arrives on the next successful fetch.

const FALLBACK = {
  providers: [
    { id: 'anthropic', label: 'Anthropic', accepts_base_url: false, default_base_url: null,
      accepts_any_model: false, keyless_ok: false,
      models: [
        { id: 'claude-sonnet-5-5', context_window: 1000000 },
        { id: 'claude-haiku-4-5', context_window: 200000 },
      ] },
    { id: 'openai', label: 'OpenAI', accepts_base_url: false, default_base_url: null,
      accepts_any_model: false, keyless_ok: false,
      models: [
        { id: 'gpt-6.1-sol', context_window: 1050000 },
        { id: 'gpt-6-luna', context_window: 1050000 },
      ] },
    { id: 'minimax', label: 'MiniMax', accepts_base_url: false,
      default_base_url: 'https://api.minimax.io/anthropic',
      accepts_any_model: false, keyless_ok: false,
      models: [
        { id: 'MiniMax-M3.1-Flash-Preview', context_window: 1000000 },
        { id: 'MiniMax-M3', context_window: 1000000 },
        { id: 'MiniMax-M2.7', context_window: 204800 },
        { id: 'MiniMax-M2.7-highspeed', context_window: 204800 },
      ] },
    { id: 'ollama', label: 'Ollama (local)', accepts_base_url: true,
      default_base_url: 'http://localhost:11434/v1',
      accepts_any_model: true, keyless_ok: true,
      models: [{ id: 'llama3.1', context_window: 128000 }] },
  ],
};

const CACHE_KEY = 'modelCatalog';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function usable(payload) {
  return !!(payload && Array.isArray(payload.providers) && payload.providers.length);
}

// Cached copy first so the panel renders without a round trip; the network
// result replaces it for next time. A stale cache still beats the fallback —
// the alternative is a server edit silently not showing up in the UI.
async function load(baseUrl) {
  const cached = await chrome.storage.local.get(CACHE_KEY);
  const hit = cached[CACHE_KEY];
  const fresh = hit && Date.now() - (hit.at || 0) < CACHE_MAX_AGE_MS;

  if (usable(hit) && fresh) return { ...hit, offline: false };

  const base = String(baseUrl || '').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/v1/models`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!usable(body)) throw new Error('empty catalogue');
    const entry = { providers: body.providers, at: Date.now() };
    await chrome.storage.local.set({ [CACHE_KEY]: entry });
    return { ...entry, offline: false };
  } catch {
    if (usable(hit)) return { ...hit, offline: true };
    return { providers: FALLBACK.providers, at: 0, offline: true };
  }
}

function provider(list, id) {
  return (list.providers || []).find((p) => p.id === id) || null;
}

// The context window drives the AX-tree budget (window/20). A free-text model
// id has no catalog entry, and inventing a large one would overrun the real
// window and 400 on the next step — so the fallback is the smallest window the
// catalog knows of, which can only ever under-fill.
const SMALLEST_KNOWN_WINDOW = 128000;

function contextWindow(list, providerId, modelId) {
  const p = provider(list, providerId);
  const hit = p?.models?.find((m) => m.id === modelId);
  if (hit) return hit.context_window;
  const known = (p?.models || []).map((m) => m.context_window).filter(Boolean);
  return known.length ? Math.min(...known) : SMALLEST_KNOWN_WINDOW;
}

globalThis.brottoModelCatalog = { load, provider, contextWindow, FALLBACK, CACHE_KEY };
