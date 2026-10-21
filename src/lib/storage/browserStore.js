/**
 * Stockage durable DANS LE NAVIGATEUR (IndexedDB) pour les appareils sans
 * File System Access API (téléphones, Safari, Firefox) : même rôle que le
 * dossier local choisi sur PC (voir directoryAccess.js), sans dossier.
 *
 * Comparaison des deux options étudiées :
 *  - Adapter chaque appelant de `rootHandle` (activityStore, activityCache,
 *    speedMigration, progression/persistence, strava/storage, 12 composants)
 *    à un second backend : changement large, risque de régression sur PC.
 *  - Exposer ici, sur une seule table IndexedDB clé/valeur, la surface
 *    minimale que ces modules utilisent déjà (getDirectoryHandle /
 *    getFileHandle / createWritable / getFile / removeEntry / itération).
 *    Un seul nouveau fichier, aucun appelant modifié, comportement PC intact.
 * On retient la seconde. Ce n'est PAS une émulation de système de fichiers :
 * c'est une table `chemin -> contenu` (texte ou ArrayBuffer), où chaque
 * écriture est un unique `put` transactionnel (donc atomique : un fichier est
 * soit entièrement écrit, soit absent).
 *
 * Le cloud reste la source commune ; ce stockage est le cache durable et la
 * copie de sécurité d'une sortie pas encore confirmée par le serveur.
 */

const DB_VERSION = 1;
const STORE = "files";

function notFound(path) {
  const err = new Error(`NotFoundError: ${path}`);
  err.name = "NotFoundError";
  return err;
}

function openDb(idb, dbName) {
  return new Promise((resolve, reject) => {
    const req = idb.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    const req = fn(tx.objectStore(STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction IndexedDB annulée."));
  });
}

function isBinary(value) {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]" || ArrayBuffer.isView(value);
}

function toArrayBuffer(value) {
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new TextEncoder().encode(String(value)).buffer;
}

class BrowserFileHandle {
  constructor(store, path, name) {
    this.store = store;
    this.path = path;
    this.name = name;
    this.kind = "file";
  }
  async getFile() {
    const value = await this.store.get(this.path);
    if (value === undefined) throw notFound(this.path);
    return {
      name: this.name,
      text: async () => (isBinary(value) ? new TextDecoder().decode(value) : value),
      arrayBuffer: async () => toArrayBuffer(value),
    };
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (chunk) => { chunks.push(chunk); },
      close: async () => {
        // Un seul `put` : écriture atomique du fichier entier.
        if (chunks.every((c) => typeof c === "string")) return this.store.put(this.path, chunks.join(""));
        const parts = chunks.map((c) => new Uint8Array(toArrayBuffer(c)));
        const merged = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const p of parts) { merged.set(p, offset); offset += p.length; }
        return this.store.put(this.path, merged.buffer);
      },
    };
  }
}

class BrowserDirectoryHandle {
  constructor(store, prefix, name) {
    this.store = store;
    this.prefix = prefix; // "" pour la racine, sinon "activities/"
    this.name = name;
    this.kind = "directory";
  }
  async getDirectoryHandle(name) {
    // Les « dossiers » n'existent que par préfixe de chemin : toujours disponibles.
    return new BrowserDirectoryHandle(this.store, `${this.prefix}${name}/`, name);
  }
  async getFileHandle(name, { create = false } = {}) {
    const path = `${this.prefix}${name}`;
    if (!create && (await this.store.get(path)) === undefined) throw notFound(path);
    return new BrowserFileHandle(this.store, path, name);
  }
  async removeEntry(name) {
    const path = `${this.prefix}${name}`;
    if ((await this.store.get(path)) === undefined) throw notFound(path);
    await this.store.remove(path);
  }
  async *[Symbol.asyncIterator]() {
    for (const key of await this.store.keys()) {
      if (!key.startsWith(this.prefix)) continue;
      const rest = key.slice(this.prefix.length);
      if (!rest || rest.includes("/")) continue;
      yield [rest, new BrowserFileHandle(this.store, key, rest)];
    }
  }
}

/** @returns {boolean} true si IndexedDB est utilisable dans cet environnement */
export function isBrowserStoreSupported(idb = globalThis.indexedDB) {
  return !!idb && typeof idb.open === "function";
}

const roots = new Map(); // dbName -> racine (singleton : les verrous/caches sont indexés par objet racine)

/**
 * Racine de stockage navigateur, utilisable partout où un `rootHandle` l'est.
 * @param {{dbName?: string, idb?: IDBFactory}} [options]
 */
export function getBrowserStoreRoot({ dbName = "cycling-os-local-store", idb = globalThis.indexedDB } = {}) {
  const key = `${dbName}`;
  if (roots.has(key) && roots.get(key).idb === idb) return roots.get(key).root;

  let dbPromise = null;
  const db = () => (dbPromise ||= openDb(idb, dbName));
  const store = {
    get: async (path) => request(await db(), "readonly", (s) => s.get(path)),
    put: async (path, value) => { await request(await db(), "readwrite", (s) => s.put(value, path)); },
    remove: async (path) => { await request(await db(), "readwrite", (s) => s.delete(path)); },
    keys: async () => request(await db(), "readonly", (s) => s.getAllKeys()),
  };
  const root = new BrowserDirectoryHandle(store, "", "Cet appareil");
  root.isBrowserStore = true;
  roots.set(key, { idb, root });
  return root;
}

/** Demande au navigateur de ne pas évincer ce stockage (best-effort, jamais bloquant). */
export async function requestPersistentStorage() {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    // ignoré : le cloud reste la source de vérité
  }
  return false;
}
