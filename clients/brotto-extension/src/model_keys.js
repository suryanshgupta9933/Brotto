// model_keys.js — where the model config and the model API key live, for
// whoever is signed in right now.
//
// With an account id, the keys carry it: two cloud accounts in one Chrome
// profile had one flat slot for provider, model and key, and the one that
// mattered was the key — account A's run silently paid with account B's
// credential. Without one, they are the flat keys, byte-identical to every
// install from before accounts existed, which is every self-hoster.
//
// **No migration, deliberately.** A flat key written before this change
// belongs to whoever was signed in then, and nothing records which. Copying it
// into whichever account signs in next hands that account a credential that
// may be someone else's, which is the exact harm this file removes; so the
// cloud path ignores the flat key and a cloud user re-pastes once, into their
// own slot, after which the two never meet again. Self-host reads the flat key
// exactly as it always has.
//
// This is the panel-side copy of model_config.ts's `modelKeys`. The worker is
// a TS bundle and the panel is a plain script, so the two cannot share one
// function — but they must not drift either, and
// scripts/test-model-keys.test.js runs both against one table.
function modelKeys(accountId) {
  return typeof accountId === 'string' && accountId
    ? { config: `modelConfig:${accountId}`, apiKey: `modelApiKey:${accountId}` }
    : { config: 'modelConfig', apiKey: 'modelApiKey' };
}

if (typeof globalThis !== 'undefined') globalThis.brottoModelKeys = modelKeys;