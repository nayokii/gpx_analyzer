/**
 * Cache local des zones cartographiques déjà téléchargées (aucun envoi : lecture/écriture dans ce navigateur).
 *
 * Interface : { get(key) → Promise<record|null>, put(key, record) → Promise<void>, clear() → Promise<void> }.
 * `memoryStore()` sert aux tests et de repli ; `idbStore()` persiste dans IndexedDB (jamais localStorage : une zone
 * de 2 km peut dépasser 500 Ko).
 */

export function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, record) { map.set(key, record); },
    async clear() { map.clear(); },
    _map: map,
  };
}

const DB_NAME = "gpx-analyzer-terrain";
const STORE = "cells";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    })
  );
}

/** Cache persistant ; si IndexedDB est indisponible, retombe silencieusement sur un cache mémoire de session. */
export function idbStore() {
  if (typeof indexedDB === "undefined") return memoryStore();
  const fallback = memoryStore();
  let broken = false;
  const guard = async (primary, secondary) => {
    if (broken) return secondary();
    try { return await primary(); } catch { broken = true; return secondary(); }
  };
  return {
    get: (key) => guard(async () => (await run("readonly", (s) => s.get(key))) || null, () => fallback.get(key)),
    put: (key, record) => guard(() => run("readwrite", (s) => s.put(record, key)), () => fallback.put(key, record)),
    clear: () => guard(() => run("readwrite", (s) => s.clear()), () => fallback.clear()),
  };
}
