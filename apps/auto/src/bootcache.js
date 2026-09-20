// A small IndexedDB key-value store for work the boot can skip on a later
// launch of the SAME build: results that are deterministic in the map data
// and the code (citygen's grading today). Keys carry the build number, and
// writing one build's entry clears every other build's, so an update can never
// read something computed by older code.
//
// Every failure -- no IndexedDB (private mode), a quota error, iOS leaving an
// open() hanging -- degrades to "not cached": the caller computes as usual.

const DB = 'auto-boot', STORE = 'kv', VERSION = 1, TIMEOUT_MS = 1500;

function withTimeout(p) {
  return Promise.race([p, new Promise((res) => setTimeout(() => res(null), TIMEOUT_MS))]);
}

let dbp = null;
function open() {
  if (!dbp) {
    dbp = withTimeout(new Promise((res) => {
      try {
        const r = indexedDB.open(DB, VERSION);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch (e) { res(null); }
    }));
  }
  return dbp;
}

export const buildId = () => {
  const el = typeof document !== 'undefined' && document.getElementById('build');
  return el ? el.textContent.trim() : 'dev';
};

export async function cacheGet(key) {
  const db = await open();
  if (!db) return null;
  return withTimeout(new Promise((res) => {
    try {
      const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${buildId()}:${key}`);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    } catch (e) { res(null); }
  }));
}

export async function cachePut(key, value) {
  const db = await open();
  if (!db) return false;
  const full = `${buildId()}:${key}`, prefix = `${buildId()}:`;
  return withTimeout(new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      // other builds' entries go: they can never be read again
      const keys = st.getAllKeys();
      keys.onsuccess = () => { for (const k of keys.result) if (!String(k).startsWith(prefix)) st.delete(k); };
      st.put(value, full);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
      tx.onabort = () => res(false);
    } catch (e) { res(false); }
  }));
}
