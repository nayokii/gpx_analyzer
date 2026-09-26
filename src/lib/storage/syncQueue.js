/**
 * File d'attente simple pour les opérations cloud en attente (Phase 11B,
 * étendue Phase 11C — voir consigne §4/§5/§19). Sert à ne jamais perdre
 * silencieusement le besoin de "cette sortie locale doit encore être
 * envoyée/supprimée dans le cloud" quand la tentative immédiate (voir
 * activityRepository.js: saveActivity/deleteActivity) échoue (hors ligne,
 * erreur réseau, cloud momentanément indisponible).
 *
 * Volontairement minimal (voir consigne 11B : "pas besoin de construire un
 * système distribué complexe") :
 * - persistée dans `localStorage` (survit aux rechargements de page, propre à
 *   ce navigateur/appareil — jamais synchronisée elle-même) ;
 * - pas de retry automatique en tâche de fond ici : le retry est déclenché
 *   par le repository (voir activityRepository.js: sync(), qui rejoue les
 *   suppressions en attente et retrouve les uploads en attente en
 *   recalculant la fusion fraîche — jamais en "rejouant" bêtement la file) ;
 * - dédoublonnée par `activityId` : une même sortie ne peut avoir qu'UNE
 *   seule opération en attente à la fois (upload OU delete, jamais les
 *   deux) — enfiler une nouvelle opération pour un id remplace l'ancienne
 *   (ex. supprimer une sortie dont l'upload était encore en attente annule
 *   cet upload, voir consigne §5).
 */

const STORAGE_KEY = "gpx-analyzer-sync-queue";

function readRaw() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // localStorage indisponible (navigation privée stricte, quota...) ou
    // contenu corrompu : une file vide est un état sûr, jamais une exception
    // qui bloquerait l'import/la suppression qui a déclenché cet appel.
    return [];
  }
}

function writeRaw(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort : si l'écriture échoue, l'opération locale reste effective
    // (jamais perdue) mais ne sera pas rejouée automatiquement — acceptable
    // pour cette fondation simple.
  }
}

function enqueue(partialEntry) {
  const entries = readRaw().filter((e) => e.activityId !== partialEntry.activityId);
  const entry = { createdAt: new Date().toISOString(), ...partialEntry };
  entries.push(entry);
  writeRaw(entries);
  return entry;
}

/**
 * @typedef {Object} SyncQueueEntry
 * @property {'upload'|'delete'} type
 * @property {string} activityId - id local de l'activité concernée
 * @property {string|null} [fileHash] - empreinte du fichier, si déjà connue au moment de l'enfilage (type 'upload')
 * @property {string} createdAt - ISO 8601
 */

/**
 * Ajoute (ou remplace, si déjà présente) un upload en attente.
 * @param {{activityId: string, fileHash?: string|null}} params
 * @returns {SyncQueueEntry}
 */
export function enqueueUpload({ activityId, fileHash = null }) {
  return enqueue({ type: "upload", activityId, fileHash });
}

/**
 * Ajoute (ou remplace, si déjà présente) une suppression en attente — voir
 * consigne 11C §5/§19 : une suppression cloud qui échoue ne doit jamais être
 * perdue silencieusement.
 * @param {{activityId: string}} params
 * @returns {SyncQueueEntry}
 */
export function enqueueDelete({ activityId }) {
  return enqueue({ type: "delete", activityId });
}

/** @returns {SyncQueueEntry[]} copie de toute la file (uploads + suppressions), dans l'ordre d'ajout */
export function listQueuedOperations() {
  return readRaw();
}

/** @returns {SyncQueueEntry[]} uniquement les uploads en attente */
export function listQueuedUploads() {
  return readRaw().filter((e) => e.type === "upload");
}

/** @returns {SyncQueueEntry[]} uniquement les suppressions en attente */
export function listQueuedDeletes() {
  return readRaw().filter((e) => e.type === "delete");
}

/** Retire une entrée de la file, quel que soit son type (opération réussie, ou devenue sans objet). */
export function dequeue(activityId) {
  writeRaw(readRaw().filter((e) => e.activityId !== activityId));
}

/** @returns {boolean} true si cette activité a une opération en attente (upload ou suppression) */
export function isQueued(activityId) {
  return readRaw().some((e) => e.activityId === activityId);
}

/** Vide entièrement la file — réservé aux tests et à une déconnexion cloud explicite. */
export function clearQueue() {
  writeRaw([]);
}
