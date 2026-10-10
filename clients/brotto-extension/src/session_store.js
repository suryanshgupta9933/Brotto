// session_store.js — a client-side mirror of the server's audit documents.
//
// Why this exists: the server's `logs/sessions/` is the only *complete* copy
// of a conversation, and on a hosted orchestrator that disk is ephemeral. A
// dyno restart, a deploy, or the daily cycle wipes it, and with it every
// transcript the user has — silently, because nothing ever says the history
// is gone. The 20-row `chrome.storage.local` array is not a substitute: it
// records only what *this panel* watched finish, so a run on another machine
// was never in it.
//
// IndexedDB, not `chrome.storage.local` and not OPFS:
//
//   - `chrome.storage.local` caps at ~10MB and wants `unlimitedStorage` to
//     exceed it, which is a permission the store review has to approve.
//   - OPFS may not be reachable from an MV3 service worker at all, and the
//     writer has to live there. If it cannot, every write would have to be
//     routed through the side panel — which is closed most of the time, so
//     the mirror would stop recording exactly when a background run ends.
//   - The panel needs to list, fetch by id and delete. That is a record set,
//     so it gets a real index rather than a directory plus a hand-kept
//     `storage.local` index that can drift out of step with it.
//
// This is a *mirror*. The server stays authoritative; the mirror only answers
// when the server cannot. The wider move — harness state living client-side,
// with the operator keeping nothing — is separate and still unbuilt.

const DB_NAME = 'brotto-sessions';
const DB_VERSION = 1;
const STORE = 'audits';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'session_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // A blocked upgrade (another tab holds the old version open) leaves this
    // pending forever without an error, so `onblocked` has to fail it too.
    req.onerror = () => reject(req.error || new Error('indexedDB.open failed'));
    req.onblocked = () => reject(new Error('indexedDB.open blocked by another context'));
  });
  // A rejected promise cached forever would take the mirror down for the
  // life of the page, so the cache is cleared and the next call retries.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error || req?.error || new Error('transaction failed'));
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  }));
}

// `doc` is the audit document exactly as the server returned it — this store
// is not where it gets reshaped, because the replay path wants the server's
// bytes and a re-serialisation is one more way for the two copies to differ.
async function put(sessionId, doc, meta = {}) {
  if (!sessionId || !doc) return false;
  try {
    await tx('readwrite', (store) => store.put({
      session_id: sessionId,
      doc,
      task: meta.task || '',
      status: meta.status || '',
      steps: meta.steps ?? null,
      started_at: meta.startedAt || null,
      updated_at: Date.now(),
    }));
    return true;
  } catch (err) {
    // A mirror that cannot write is a degraded history, not a broken
    // session — the run is still on the server. Never throw into a caller
    // that is on a terminal-event path and already `void`ed.
    console.warn('[brotto] session mirror write failed:', err);
    return false;
  }
}

// Index rows only. The document is the expensive part and the list does not
// need it, so it is dropped here rather than in every caller.
async function list() {
  try {
    const rows = await tx('readonly', (store) => store.getAll());
    return (rows || [])
      .map(({ doc, ...meta }) => meta)
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  } catch (err) {
    console.warn('[brotto] session mirror list failed:', err);
    return [];
  }
}

async function get(sessionId) {
  if (!sessionId) return null;
  try {
    const row = await tx('readonly', (store) => store.get(sessionId));
    return row ? row.doc : null;
  } catch {
    return null;
  }
}

async function remove(sessionId) {
  if (!sessionId) return;
  try {
    await tx('readwrite', (store) => store.delete(sessionId));
  } catch (err) {
    console.warn('[brotto] session mirror delete failed:', err);
  }
}

async function clear() {
  try {
    await tx('readwrite', (store) => store.clear());
  } catch (err) {
    console.warn('[brotto] session mirror clear failed:', err);
  }
}

globalThis.brottoSessionStore = { put, list, get, remove, clear };