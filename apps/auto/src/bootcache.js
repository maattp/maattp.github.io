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

// Read ONCE and kept: `#build` lives on the loading screen, which is removed
// after boot, and a write after that read 'dev' -- and writing one build's
// entry deletes every other build's, so a late write wiped the city's cache.
let BUILD = null;
export const buildId = () => {
  if (BUILD) return BUILD;
  const el = typeof document !== 'undefined' && document.getElementById('build');
  return el ? (BUILD = el.textContent.trim()) : 'dev';
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

// CRASH GUARD. A launch that starts from cached data and never reaches its
// first frame (a decode that hangs, an entry WebKit stored badly) must not
// leave the next launch doing the same: main.js marks the attempt here before
// reading and clears it at the first frame. Finding the mark still set means
// the last cached boot died, so the cache is ignored and wiped.
const GUARD = 'auto-boot-cache-inflight';
export function cacheGuardTripped() {
  try { return localStorage.getItem(GUARD) === buildId(); } catch (e) { return false; }
}
export function cacheGuardSet(on) {
  try { if (on) localStorage.setItem(GUARD, buildId()); else localStorage.removeItem(GUARD); } catch (e) { /* no storage */ }
}
export async function cacheClear() {
  const db = await open();
  if (!db) return;
  await withTimeout(new Promise((res) => {
    try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { res(); }
  }));
}

// THE MEMO: many smaller deterministic results in ONE entry ('memo'), for
// boot work too scattered to deserve an entry each -- the terrain's cut
// cells, where a beach's props may stand, which piers are built.
// `memo(key, make)` answers what an earlier launch of this build kept under
// `key`, else calls make() and keeps its answer for main.js to write with the
// rest at the end of the boot.
//
// A memoised value must be plain data (typed arrays, numbers, plain arrays and
// objects of them -- what IndexedDB clones exactly; never a Blob) that NOTHING
// mutates after it is returned: the computed value is written at the end of
// the boot, and an edit made in between would be read back by the next launch
// as if it had been computed. `ok(v)` may refuse a cached value that does not
// fit (the caller then computes, as on a first launch).
let MEMO_IN = null, MEMO_OUT = null;
export const memoStats = { hit: 0, miss: 0, keys: [] };
export function memoStart(cached) {
  MEMO_IN = cached && typeof cached === 'object' ? cached : null;
  MEMO_OUT = {};
}
export function memo(key, make, ok = null) {
  if (MEMO_IN && Object.prototype.hasOwnProperty.call(MEMO_IN, key)) {
    const v = MEMO_IN[key];
    if (!ok || ok(v)) { memoStats.hit++; return v; }
  }
  memoStats.miss++;
  const v = make();
  if (MEMO_OUT) { MEMO_OUT[key] = v; memoStats.keys.push(key); }
  return v;
}
/** memo() in two halves, for a result made piecemeal inside a loop that has
 *  other work to do: the kept value (or null), and keeping a computed one. */
export function memoPeek(key, ok = null) {
  if (MEMO_IN && Object.prototype.hasOwnProperty.call(MEMO_IN, key) && (!ok || ok(MEMO_IN[key]))) { memoStats.hit++; return MEMO_IN[key]; }
  memoStats.miss++;
  return null;
}
export function memoPut(key, v) {
  if (MEMO_OUT) { MEMO_OUT[key] = v; memoStats.keys.push(key); }
  return v;
}
/** What to keep: what was read plus what was computed, or null if nothing new. */
export function memoTake() {
  const out = MEMO_OUT && Object.keys(MEMO_OUT).length ? { ...(MEMO_IN || {}), ...MEMO_OUT } : null;
  MEMO_IN = MEMO_OUT = null;
  // its size, for the boot log (typed arrays only: the rest is small)
  const size = (v) => (ArrayBuffer.isView(v) ? v.byteLength : v && typeof v === 'object' ? Object.values(v).reduce((a, x) => a + size(x), 0) : 8);
  memoStats.bytes = out ? size(out) : 0;
  memoStats.sizes = {};
  for (const [k, v] of Object.entries(out || {})) {
    const g = k.replace(/[:,]?-?\d+(,-?\d+)?$/, '');
    memoStats.sizes[g] = (memoStats.sizes[g] || 0) + size(v);
  }
  return out;
}
