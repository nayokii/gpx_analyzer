/**
 * Accès au dossier de stockage local via la File System Access API du
 * navigateur (Chrome / Edge). Le handle du dossier choisi par l'utilisateur
 * est mémorisé dans IndexedDB pour ne pas avoir à le resélectionner à chaque
 * session — seule la permission doit parfois être reconfirmée par un clic
 * (contrainte de sécurité du navigateur : aucune requête de permission n'est
 * possible sans geste utilisateur explicite).
 *
 * Ce module est un pont fin vers des API navigateur qui n'existent pas dans
 * l'environnement de test (jsdom) : il est volontairement gardé minimal et
 * vérifié manuellement dans un vrai navigateur plutôt que par des tests
 * unitaires. La logique métier testable (lecture/écriture des activités) vit
 * dans ./activityStore.js, découplée de cette couche via un simple handle.
 */

const DB_NAME = "gpx-analyzer-storage";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "dataDirectory";

/** @returns {boolean} true si le navigateur supporte la File System Access API */
export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Ouvre le sélecteur de dossier natif et mémorise le choix de l'utilisateur.
 * Doit être appelé depuis un gestionnaire d'événement (clic) — le navigateur
 * refuse d'ouvrir ce sélecteur autrement.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickDataDirectory() {
  const handle = await window.showDirectoryPicker({ id: "gpx-analyzer-data", mode: "readwrite" });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

/** @returns {Promise<FileSystemDirectoryHandle|null>} le dossier mémorisé lors d'une session précédente, ou null */
export async function getStoredDirectoryHandle() {
  try {
    return await idbGet(HANDLE_KEY);
  } catch {
    return null;
  }
}

/** Oublie le dossier mémorisé (déconnexion du stockage local). */
export async function forgetDataDirectory() {
  try {
    await idbDelete(HANDLE_KEY);
  } catch {
    // rien à faire : au pire le handle reste mémorisé sans conséquence grave
  }
}

/**
 * Vérifie (et éventuellement demande) la permission lecture/écriture sur un
 * handle de dossier précédemment obtenu.
 * @param {FileSystemDirectoryHandle} handle
 * @param {{request?: boolean}} [opts] - `request: true` déclenche la boîte de
 *   dialogue navigateur ; ne fonctionne que depuis un geste utilisateur.
 * @returns {Promise<boolean>}
 */
export async function verifyPermission(handle, { request = false } = {}) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (request && (await handle.requestPermission(opts)) === "granted") return true;
  return false;
}
