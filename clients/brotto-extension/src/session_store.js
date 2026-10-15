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

// Which server a mirrored row belongs to: the base address, normalised so a
// typed trailing slash or a capital host is the same server.
//
// `auth_mode` is deliberately NOT part of this. It was the other candidate,
// and it is the wrong one twice over: mode is a property of the server at an
// address rather than of the user, so it separates nothing the address does
// not already separate — and the panel's `state.authMode` is null until the
// /health probe lands, so keying on it made every mirrored row vanish from
// History for the moments the probe was still in flight.
//
// `accountId` folds in only when there is one, and then only as an inner key:
// the address stays the outer key. Self-host has no account and answers
// `account_id: null`; a degraded exchange answers `""`. Both leave the
// namespace byte-identical to what it has always been, so a self-hoster's
// existing rows keep resolving and nothing about the pinned self-host
// behaviour moves.
function namespaceFor(base, accountId) {
  const ns = String(base || '').replace(/\/$/, '').toLowerCase();
  return accountId ? `${ns}#${accountId}` : ns;
}

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
//
// `meta.namespace` is the server the document came from and is what every read
// below filters on. The extension origin is shared by every server a user
// points it at, so an un-namespaced store showed one account's conversations
// under another's History — replayable, with the self-hosted server never
// involved. `session_id` stays the keyPath: it is a uuid, so a cross-server
// collision is not worth a DB migration, and a collision would overwrite rather
// than disclose.
async function put(sessionId, doc, meta = {}) {
  if (!sessionId || !doc) return false;
  try {
    await tx('readwrite', (store) => store.put({
      session_id: sessionId,
      doc,
      ns: meta.namespace || '',
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

// A row with no namespace predates this field, so it belongs to no server and
// is shown under none of them. Migrating it to whichever server happens to be
// pointed at on first read would be the friendlier reading and the unsafe one:
// that is the same disclosure this filter exists to stop, decided by which
// address the user happened to type. A conversation the user cannot see is
// recoverable; one shown under the wrong account is not.
const inNamespace = (row, ns) => Boolean(ns) && row.ns === ns;

// Index rows only. The document is the expensive part and the list does not
// need it, so it is dropped here rather than in every caller.
async function list(ns) {
  try {
    const rows = await tx('readonly', (store) => store.getAll());
    return (rows || [])
      .filter((row) => inNamespace(row, ns))
      .map(({ doc, ...meta }) => meta)
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  } catch (err) {
    console.warn('[brotto] session mirror list failed:', err);
    return [];
  }
}

async function get(sessionId, ns) {
  if (!sessionId) return null;
  try {
    const row = await tx('readonly', (store) => store.get(sessionId));
    return row && inNamespace(row, ns) ? row.doc : null;
  } catch {
    return null;
  }
}

// Scoped exactly like the reads, and this is not a disclosure question but a
// destruction one: the read filter hides another server's row, and an ungated
// delete would destroy it anyway, so the read fix would be undone by the write
// path. The caller gets `false` for "not ours, left alone" so it can tell a
// deletion from a refusal.
async function remove(sessionId, ns) {
  if (!sessionId) return false;
  try {
    const row = await tx('readonly', (store) => store.get(sessionId));
    if (!inNamespace(row, ns)) return false;
    await tx('readwrite', (store) => store.delete(sessionId));
    return true;
  } catch (err) {
    console.warn('[brotto] session mirror delete failed:', err);
    return false;
  }
}

// Scoped like the reads: "delete every conversation in the list" must not
// reach rows the list never showed.
async function clear(ns) {
  try {
    const rows = await tx('readonly', (store) => store.getAll());
    const doomed = (rows || []).filter((row) => inNamespace(row, ns)).map((r) => r.session_id);
    if (!doomed.length) return;
    await tx('readwrite', (store) => {
      for (const id of doomed) store.delete(id);
    });
  } catch (err) {
    console.warn('[brotto] session mirror clear failed:', err);
  }
}

globalThis.brottoSessionStore = { put, list, get, remove, clear, namespaceFor };