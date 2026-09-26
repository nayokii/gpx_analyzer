/**
 * REPOSITORY UNIFIÉ (Phase 11B, synchronisation automatique Phase 11C) —
 * abstrait "d'où viennent les activités" (dossier local / cloud Supabase)
 * derrière une seule API, pour que le reste de l'application (HistoryView,
 * ProfileView, AlterEgoView, ArchetypeView, TourView) n'ait plus jamais à
 * savoir si une sortie est locale ou cloud.
 *
 * Principe directeur (voir consigne 11B §5/§31, 11C §29) : ce module ne
 * recalcule RIEN — ni profil, ni progression, ni archétype, ni simulation.
 * Il ne fait que décider QUELLES `Activity[]` remonter à
 * `computeCyclistProfile()` etc., exactement au même format qu'aujourd'hui.
 * Les moteurs métier ne sont pas modifiés, pas même touchés.
 *
 * Source de vérité (voir consigne 11B §3) :
 * - utilisateur cloud connecté : le cloud fait foi ; le local sert de cache
 *   (jamais supprimé pour autant).
 * - utilisateur non connecté : le local fait foi, comportement 100%
 *   identique à avant la Phase 11B (si `cloudUser` est absent, chaque
 *   méthode retombe sur un simple passe-plat vers ../storage/activityStore.js).
 *
 * Identité d'une activité entre appareils (voir consigne 11B §16/§27) : la
 * clé de fusion est `cloudRow.local_id` (l'id local de l'appareil qui a fait
 * l'upload initial) — ou, à défaut, `cloudRow.id` lui-même. Cette même clé
 * est réutilisée comme `activity.id` local lors de la matérialisation d'une
 * sortie cloud-only, pour qu'un futur rapprochement ne crée jamais deux
 * entrées pour la même sortie (condition nécessaire et suffisante pour que
 * la progression, XP/achievements, ne compte jamais deux fois la même sortie).
 *
 * Conflits (voir consigne 11B §22, 11C §13-16) : détectés de façon purement
 * métadonnées (écart de distance) au moment de la fusion — jamais résolus
 * automatiquement. `resolveConflict()` (pure) traduit un choix utilisateur en
 * action ; `applyConflictResolution()` (impure, ci-dessous) l'exécute.
 *
 * Synchronisation automatique (Phase 11C, voir consigne §1/§2/§3) : ce
 * module expose un coordinateur MODULE-LEVEL (pas par instance de
 * repository) pour que deux composants distincts appelant `sync()` en même
 * temps pour le même compte ne déclenchent jamais deux réconciliations
 * parallèles — voir `getCoordinator()`. Le déclenchement automatique
 * lui-même (login, retour en ligne, ouverture de l'app) vit dans le hook
 * React (voir ../../components/useActivityRepository.js), pas ici : ce
 * module ne sait pas QUAND synchroniser, seulement COMMENT le faire sans
 * courses ni doublons.
 */

import * as localStore from "./activityStore.js";
import { getCachedActivityDetail, invalidateActivityCache } from "./activityCache.js";
import { enqueueUpload, enqueueDelete, dequeue, listQueuedDeletes } from "./syncQueue.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import {
  listCloudActivities,
  deleteCloudActivity,
  uploadActivity as cloudUploadActivity,
  downloadActivityFile,
  CloudDuplicateActivityError,
  CloudNotAuthenticatedError,
} from "../cloud/index.js";

/** Tolérance (km) avant de considérer un écart de distance comme un conflit plutôt qu'un simple arrondi — voir consigne 11B §22. */
const CONFLICT_DISTANCE_TOLERANCE_KM = 0.05;

/** Nombre de sorties matérialisées/chargées en parallèle au maximum — voir consigne 11B §26. */
const DETAIL_LOAD_CONCURRENCY = 4;

/** Fenêtre minimale entre deux cycles de sync() NON forcés (voir consigne 11C §3) — absorbe une rafale d'évènements "online" sans relancer un cycle complet à chaque fois. */
const SYNC_COOLDOWN_MS = 10000;

const SYNCABLE_SOURCE_TYPES = new Set(["gpx", "fit"]);

/* ------------------------------------------------------------------ */
/* Coordinateur de synchronisation — MODULE-LEVEL (voir consigne §2)   */
/* ------------------------------------------------------------------ */

// Clé = id de l'utilisateur cloud courant. Il n'existe en pratique qu'un seul
// compte actif à la fois dans cette application (une session par onglet) —
// une Map reste néanmoins plus sûre qu'une variable unique si ce n'était pas
// le cas, pour un coût de complexité nul.
const inFlightByAccount = new Map(); // accountId -> { promise, progressCallbacks: Set }
const lastAttemptByAccount = new Map(); // accountId -> timestamp ms
const lastResultByAccount = new Map(); // accountId -> dernier résultat de sync()

// Abonnés notifiés quand une synchronisation change réellement quelque chose
// (voir consigne §11/§12 : les vues doivent pouvoir se rafraîchir, sans
// jamais tout recalculer si rien n'a changé). Un seul jeu d'abonnés global :
// n'importe quelle vue montée doit être informée, quel que soit le
// composant qui a déclenché la synchronisation.
const syncCompletedListeners = new Set();

function notifySyncCompleted(result) {
  const changed = (result.uploaded || 0) + (result.downloaded || 0) + (result.deletedLocally || 0) + (result.conflictsResolved || 0) > 0;
  if (!changed) return; // rien de nouveau : ne jamais faire recalculer les vues pour rien (consigne §12)
  for (const cb of syncCompletedListeners) cb(result);
}

/**
 * S'abonne aux synchronisations réussies qui ont réellement changé quelque
 * chose (voir ../../components/useActivityRepository.js: useUnifiedActivities,
 * qui l'utilise pour se rafraîchir automatiquement après une synchro déclenchée
 * ailleurs — ex. par un autre composant monté, ou par le déclencheur "online").
 * @param {(result: Object) => void} callback
 * @returns {() => void} désabonnement
 */
export function onSyncCompleted(callback) {
  syncCompletedListeners.add(callback);
  return () => syncCompletedListeners.delete(callback);
}

/**
 * Réservé aux tests : les Maps de coordination ci-dessus sont MODULE-LEVEL
 * par conception (voir docstring du fichier — la déduplication doit survivre
 * à la recréation d'un repository). Deux fake backends de test différents
 * peuvent générer le même id d'utilisateur simulé (ex. "user-1", premier
 * compte créé dans chaque backend) : sans réinitialisation, un cooldown posé
 * par un test pourrait fausser le suivant. Appeler entre deux tests
 * indépendants (voir cloud/tests/fakeSupabase.js pour le même principe).
 */
export function __resetSyncCoordinatorForTests() {
  inFlightByAccount.clear();
  lastAttemptByAccount.clear();
  lastResultByAccount.clear();
  syncCompletedListeners.clear();
}

/** @returns {string} clé de fusion d'une ligne cloud — voir docstring du module. */
function mergeKeyForCloud(cloudEntry) {
  return cloudEntry.localId || cloudEntry.id;
}

/**
 * Convertit une CloudActivity (métadonnées légères, voir ../cloud/types.js)
 * dans la même forme qu'un résumé local (voir ../storage/activityStore.js:
 * summaryFromActivity) — uniquement les champs qu'un résumé local porte déjà,
 * pour que HistoryView/ProfileView etc. n'aient pas besoin de distinguer les
 * deux formes.
 */
function cloudSummaryToLocalShape(cloudEntry) {
  return {
    id: mergeKeyForCloud(cloudEntry),
    name: cloudEntry.name,
    date: cloudEntry.startedAt,
    sportType: null, // non stocké côté cloud (métadonnées légères) ; jamais affiché dans les listes existantes
    distance: cloudEntry.distance,
    duration: cloudEntry.duration,
    movingTime: cloudEntry.movingTime,
    elevationGain: cloudEntry.elevationGain,
    elevationLoss: cloudEntry.elevationLoss,
    avgSpeed: cloudEntry.avgSpeed,
    avgPower: cloudEntry.avgPower,
    avgHeartRate: null, // non stocké côté cloud
    avgCadence: cloudEntry.avgCadence,
    flags: cloudEntry.flags,
    source: { type: cloudEntry.sourceFormat, originalFilename: cloudEntry.sourceFileName, storedFilename: null, sourceId: null, athleteId: null },
    files: null,
  };
}

function detectConflict(localSummary, cloudEntry) {
  if (!localSummary || !cloudEntry) return false;
  if (localSummary.distance == null || cloudEntry.distance == null) return false;
  return Math.abs(localSummary.distance - cloudEntry.distance) > CONFLICT_DISTANCE_TOLERANCE_KM;
}

/**
 * Fusionne les résumés locaux et cloud en une seule liste, sans jamais
 * dupliquer une même activité (voir consigne 11B §11/§16). Fonction PURE
 * (aucun accès disque/réseau) — directement testable avec de simples tableaux.
 *
 * @param {Array} localSummaries - voir ../storage/activityStore.js: listActivities()
 * @param {import('../cloud/types.js').CloudActivity[]} cloudSummaries
 * @returns {Array} résumés fusionnés, chacun annoté d'un `syncStatus`:
 *   'local-only' | 'cloud-only' | 'synced' | 'conflict'
 */
export function mergeActivitySummaries(localSummaries, cloudSummaries) {
  const cloudByKey = new Map();
  for (const c of cloudSummaries) cloudByKey.set(mergeKeyForCloud(c), c);

  const merged = [];
  const seenKeys = new Set();

  for (const local of localSummaries) {
    const cloudEntry = cloudByKey.get(local.id) || null;
    seenKeys.add(local.id);
    if (!cloudEntry) {
      // `source.sourceId` est renseigné (voir materializeFromCloud/saveActivity/
      // runSync ci-dessous) UNIQUEMENT une fois qu'une synchronisation cloud a
      // réellement été confirmée pour cette activité. S'il est présent mais
      // qu'aucune ligne cloud ne correspond plus, la ligne a été supprimée
      // ailleurs — jamais un simple "pas encore envoyé" : la re-uploader
      // silencieusement la ressusciterait après une suppression légitime sur
      // un autre appareil (voir consigne 11C §6 : idempotence, jamais de
      // doublon ; §19 : une suppression hors-ligne doit se propager, jamais
      // être annulée par une resynchronisation).
      const previouslySynced = !!(local.source && local.source.sourceId);
      merged.push({ ...local, cloudId: null, fileHash: null, syncStatus: previouslySynced ? "cloud-deleted" : "local-only" });
    } else {
      const conflict = detectConflict(local, cloudEntry);
      merged.push({
        ...local,
        cloudId: cloudEntry.id,
        fileHash: cloudEntry.fileHash,
        syncStatus: conflict ? "conflict" : "synced",
        // Version cloud complète, uniquement portée en cas de conflit — voir
        // consigne 11C §16 : l'UI de résolution doit pouvoir afficher les
        // deux versions (distance, date, durée, source) côte à côte.
        cloudVersion: conflict ? cloudSummaryToLocalShape(cloudEntry) : undefined,
      });
    }
  }

  for (const [key, cloudEntry] of cloudByKey) {
    if (seenKeys.has(key)) continue;
    merged.push({ ...cloudSummaryToLocalShape(cloudEntry), cloudId: cloudEntry.id, fileHash: cloudEntry.fileHash, syncStatus: "cloud-only" });
  }

  merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return merged;
}

/**
 * Traduit un choix utilisateur ('local'|'cloud'|'cancel') pour un conflit
 * détecté en action à effectuer — fonction PURE (voir consigne 11C §14) :
 * aucune I/O, aucune connaissance de l'UI. `applyConflictResolution()`
 * (méthode du repository, ci-dessous) exécute réellement l'action décrite.
 * @param {{choice: 'local'|'cloud'|'cancel'}} params
 * @returns {{action: 'upload-local'|'download-cloud'|'none'}}
 */
export function resolveConflict({ choice }) {
  if (choice === "local") return { action: "upload-local" };
  if (choice === "cloud") return { action: "download-cloud" };
  return { action: "none" };
}

/** Équivalent de `Promise.allSettled(items.map(fn))` mais au plus `limit` exécutions concurrentes — voir consigne 11B §26. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * @param {Object} params
 * @param {FileSystemDirectoryHandle|null} [params.rootHandle] - dossier local connecté, ou `null`
 * @param {import('@supabase/supabase-js').User|null} [params.cloudUser] - utilisateur cloud connecté, ou `null`
 * @param {Object|null} [params.userSettings] - {weight, bikeWeight, ftp}, nécessaire pour recalculer une activité matérialisée depuis le cloud exactement comme le ferait un import local (voir ../analysis.js: computeAnalysis)
 */
export function createActivityRepository({ rootHandle = null, cloudUser = null, userSettings = null } = {}) {
  const hasLocal = !!rootHandle;
  const hasCloud = !!cloudUser;
  const accountId = cloudUser ? cloudUser.id || cloudUser.email || "cloud-account" : null;

  // ../storage/activityStore.js: saveActivity() fait un lire-modifier-écrire
  // non atomique sur index.json (lit l'index, ajoute une entrée, réécrit) :
  // deux appels concurrents (ex. plusieurs sorties cloud-only matérialisées
  // en parallèle par loadActivityDetails(), voir plus bas) peuvent sinon se
  // marcher dessus et perdre une entrée. `loadActivityDetail` télécharge et
  // reparse en parallèle (coûteux, réseau) mais sérialise cette seule
  // dernière étape d'écriture locale (rapide, disque) via cette petite queue.
  let localWriteQueue = Promise.resolve();
  function withLocalWriteLock(fn) {
    const result = localWriteQueue.then(fn, fn);
    localWriteQueue = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  /**
   * Télécharge le fichier original d'une activité cloud-only, le reparse avec
   * les MÊMES parsers que l'import manuel (voir ../parsers/), reconstruit une
   * Activity, et la met en cache local si possible — voir consigne 11B §13.
   * @param {boolean} [replaceLocal] - si true, supprime d'abord toute copie
   *   locale existante du même id avant de réécrire (voir
   *   `applyConflictResolution`: "garder la version cloud" doit remplacer la
   *   copie locale, jamais laisser un fichier orphelin si sa date a changé).
   */
  async function materializeFromCloud(cloudEntry, { replaceLocal = false } = {}) {
    const ext = cloudEntry.sourceFormat;
    const content = await downloadActivityFile({ activityId: cloudEntry.id, ext });

    let name, points, measured;
    if (ext === "fit") {
      ({ name, points, measured } = await parseFITArrayBuffer(content));
    } else {
      ({ name, points } = parseGPXString(content));
      measured = null;
    }

    const analysis = computeAnalysis(points, userSettings);
    const activity = toActivity(analysis, points, {
      id: mergeKeyForCloud(cloudEntry),
      name: cloudEntry.name || name || null,
      sourceType: ext,
      originalFilename: cloudEntry.sourceFileName,
      measured,
    });
    // Marque cette activité comme confirmée synchronisée avec CETTE ligne
    // cloud (voir mergeActivitySummaries : sert à distinguer "jamais envoyé"
    // de "supprimé du cloud" si elle disparaît plus tard de la liste cloud).
    activity.source.sourceId = cloudEntry.id;

    if (hasLocal) {
      try {
        if (replaceLocal) {
          await withLocalWriteLock(() => localStore.deleteActivity(rootHandle, activity.id)).catch(() => {});
        }
        await withLocalWriteLock(() => localStore.saveActivity(rootHandle, activity, content, ext));
        invalidateActivityCache(rootHandle, activity.id);
      } catch {
        // Écriture locale best-effort : si elle échoue (dossier en lecture
        // seule...), l'activité reste utilisable pour cet appel mais ne sera
        // pas mise en cache — un prochain accès la re-téléchargera.
      }
    }
    return activity;
  }

  /** Version tolérante (jamais d'exception) — réservée aux opérations de
   * réconciliation best-effort (`sync`, `hasActivity`), jamais au chemin
   * principal `listActivities()` ci-dessous (voir sa docstring : une erreur
   * locale doit y rester visible pour un utilisateur non connecté au cloud,
   * exactement comme avant cette phase). */
  async function listLocalSummariesLenient() {
    if (!hasLocal) return [];
    try {
      return await localStore.listActivities(rootHandle);
    } catch {
      return [];
    }
  }

  /**
   * @returns {Promise<{items: Array, source: 'local'|'cloud'|'offline'|'error', cloudError: Error|null}>}
   *   `source` documente la provenance réelle du résultat (voir consigne 11B §7) —
   *   jamais présenté comme "synchronisé" si `source` n'est pas `'cloud'`.
   * @throws si le cloud échoue ET qu'aucun dossier local n'est connecté (donc
   *   aucun repli possible) ; si le cloud n'est pas utilisé, une erreur de
   *   lecture locale remonte aussi telle quelle — comportement STRICTEMENT
   *   identique à `../storage/activityStore.js: listActivities()` d'avant
   *   la Phase 11B pour un utilisateur non connecté au cloud.
   */
  async function listActivities() {
    if (!hasCloud) {
      const items = hasLocal ? await localStore.listActivities(rootHandle) : [];
      return { items, source: "local", cloudError: null };
    }

    // Ici, un échec de lecture LOCALE est toléré (le cloud peut compenser) —
    // voir listLocalSummariesLenient ci-dessus.
    const localSummaries = await listLocalSummariesLenient();
    try {
      const cloudSummaries = await listCloudActivities();
      return { items: mergeActivitySummaries(localSummaries, cloudSummaries), source: "cloud", cloudError: null };
    } catch (err) {
      // Cloud inaccessible (hors ligne, panne...) : ne jamais bloquer sur une
      // erreur réseau (consigne 11B §20) — retomber sur le local disponible, sauf
      // s'il n'y en a structurellement aucun (pas de dossier connecté), où
      // l'erreur cloud est alors la seule information utile à remonter.
      if (!hasLocal) throw err;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      return { items: localSummaries, source: offline ? "offline" : "error", cloudError: err };
    }
  }

  /** @returns {Promise<import('../types.js').Activity>} */
  async function loadActivityDetail(id) {
    if (hasLocal) {
      try {
        return await getCachedActivityDetail(rootHandle, id);
      } catch (err) {
        if (!hasCloud) throw err; // comportement inchangé pour un utilisateur non connecté au cloud
      }
    } else if (!hasCloud) {
      throw new Error(`Sortie introuvable (id ${id}).`);
    }

    const cloudSummaries = await listCloudActivities();
    const cloudEntry = cloudSummaries.find((c) => mergeKeyForCloud(c) === id);
    if (!cloudEntry) throw new Error(`Sortie introuvable (id ${id}).`);
    return materializeFromCloud(cloudEntry);
  }

  /**
   * Équivalent batch de `loadActivityDetail`, résultat au format
   * `PromiseSettledResult[]` — remplacement direct de
   * `loadCachedActivityDetails(rootHandle, summaries)` (voir
   * ../storage/activityCache.js) dans les vues existantes. Concurrence
   * plafonnée (voir consigne 11B §26) : les sorties déjà en cache local
   * répondent instantanément, seules celles à matérialiser depuis le cloud
   * sont réellement limitées en parallélisme.
   * @param {Array<{id: string}>} summaries
   */
  function loadActivityDetails(summaries) {
    return mapWithConcurrency(summaries, DETAIL_LOAD_CONCURRENCY, (s) => loadActivityDetail(s.id));
  }

  /**
   * Marque localement une activité comme confirmée synchronisée avec une
   * ligne cloud précise (voir mergeActivitySummaries : `source.sourceId`
   * distingue ensuite "jamais envoyé" de "supprimé du cloud depuis" — sans
   * ce marqueur, une resynchronisation après une suppression sur un autre
   * appareil re-uploaderait l'activité au lieu de la supprimer localement).
   * Best-effort : un échec ici ne remet jamais en cause l'upload déjà
   * réussi, seul le marquage sera refait à la prochaine synchronisation.
   */
  async function markSyncedLocally(activityId, cloudId) {
    if (!hasLocal) return;
    try {
      const detail = await localStore.loadActivityDetail(rootHandle, activityId);
      if (detail.source && detail.source.sourceId === cloudId) return; // déjà à jour
      const ext = detail.source.type;
      const content = ext === "fit"
        ? await localStore.loadActivitySourceArrayBuffer(rootHandle, activityId)
        : await localStore.loadActivitySourceText(rootHandle, activityId);
      const updated = { ...detail, source: { ...detail.source, sourceId: cloudId } };
      await withLocalWriteLock(() => localStore.saveActivity(rootHandle, updated, content, ext));
      invalidateActivityCache(rootHandle, activityId);
    } catch {
      // best-effort, voir docstring ci-dessus
    }
  }

  /**
   * Enregistre localement IMMÉDIATEMENT (attendu par l'appelant), puis lance
   * l'upload cloud en ARRIÈRE-PLAN sans bloquer (voir consigne 11C §10 :
   * "l'import ne doit pas être rendu inutilement lent par le réseau").
   * L'appelant peut observer `cloudSyncPromise` pour mettre à jour son UI
   * une fois l'upload résolu (réussi, en doublon, ou mis en attente).
   *
   * @param {import('../types.js').Activity} activity
   * @param {string|ArrayBuffer} sourceContent
   * @param {'gpx'|'fit'} sourceExt
   * @returns {Promise<{
   *   activity: import('../types.js').Activity,
   *   cloudSyncPromise: Promise<{cloudSynced: boolean, cloudError: string|null}>,
   * }>}
   */
  async function saveActivity(activity, sourceContent, sourceExt) {
    if (!hasLocal) throw new Error("Aucun dossier de stockage local connecté.");
    const saved = await withLocalWriteLock(() => localStore.saveActivity(rootHandle, activity, sourceContent, sourceExt));

    // Une sortie 'demo' n'atteint structurellement jamais cette fonction
    // (voir GPXAnalyzer.jsx: loadDemo() ne l'enregistre jamais) — voir
    // consigne 11B §32/11C §22 : rien à filtrer ici, l'isolation est déjà
    // garantie en amont, à aucun moment une activité demo n'a de
    // sourceContent/sourceExt à sauvegarder par ce chemin.
    let cloudSyncPromise;
    if (hasCloud && SYNCABLE_SOURCE_TYPES.has(sourceExt)) {
      cloudSyncPromise = cloudUploadActivity({ activity: saved, originalFileContent: sourceContent, sourceFormat: sourceExt })
        .then(async (created) => {
          await markSyncedLocally(saved.id, created.id);
          notifySyncCompleted({ uploaded: 1, downloaded: 0 });
          return { cloudSynced: true, cloudError: null };
        })
        .catch(async (err) => {
          if (err instanceof CloudDuplicateActivityError) {
            // déjà présente côté cloud (même fichier) : rien à réessayer, mais
            // marquer quand même le lien vers la ligne existante (voir
            // markSyncedLocally) pour ne jamais la re-uploader plus tard.
            if (err.existingActivity) await markSyncedLocally(saved.id, err.existingActivity.id);
            return { cloudSynced: true, cloudError: null };
          }
          enqueueUpload({ activityId: saved.id });
          return { cloudSynced: false, cloudError: err.message || "Échec de la synchronisation cloud." };
        });
    } else {
      cloudSyncPromise = Promise.resolve({ cloudSynced: false, cloudError: null });
    }

    return { activity: saved, cloudSyncPromise };
  }

  /**
   * Supprime une activité localement (immédiat) puis, si une ligne cloud
   * correspondante existe, dans le cloud. Si la suppression cloud échoue,
   * elle est mise en file d'attente (voir consigne 11C §5/§19 — jamais
   * perdue silencieusement, contrairement à la version 11B "best-effort").
   */
  async function deleteActivity(id) {
    if (hasLocal) {
      try {
        await withLocalWriteLock(() => localStore.deleteActivity(rootHandle, id));
        invalidateActivityCache(rootHandle, id);
      } catch (err) {
        if (!hasCloud) throw err; // comportement inchangé pour un utilisateur non connecté
        // sinon : peut être une activité cloud-only jamais matérialisée localement — pas une vraie erreur
      }
    }

    if (!hasCloud) {
      dequeue(id); // plus la peine de réessayer un upload pour une activité supprimée
      return;
    }

    dequeue(id); // annule un upload en attente éventuel (voir syncQueue.js : un id n'a qu'une opération à la fois)

    try {
      const cloudSummaries = await listCloudActivities();
      const cloudEntry = cloudSummaries.find((c) => mergeKeyForCloud(c) === id);
      if (cloudEntry) await deleteCloudActivity(cloudEntry.id);
    } catch {
      // La suppression locale a déjà eu lieu ; si le cloud est inaccessible,
      // la suppression est mise en attente plutôt que silencieusement perdue.
      enqueueDelete({ activityId: id });
    }
  }

  /** @returns {Promise<boolean>} true si l'activité est disponible localement OU dans le cloud */
  async function hasActivity(id) {
    const localSummaries = await listLocalSummariesLenient();
    if (localSummaries.some((s) => s.id === id)) return true;
    if (!hasCloud) return false;
    try {
      const cloudSummaries = await listCloudActivities();
      return cloudSummaries.some((c) => mergeKeyForCloud(c) === id);
    } catch {
      return false;
    }
  }

  /** Rejoue les suppressions en attente (voir consigne 11C §5/§19) — appelé en tout début de `runSync`. */
  async function processQueuedDeletes(cloudSummariesHint) {
    const queuedDeletes = listQueuedDeletes();
    if (queuedDeletes.length === 0) return { processed: 0, cloudSummaries: cloudSummariesHint };
    let cloudSummaries = cloudSummariesHint;
    let processed = 0;
    for (const op of queuedDeletes) {
      try {
        if (!cloudSummaries) cloudSummaries = await listCloudActivities();
        const cloudEntry = cloudSummaries.find((c) => mergeKeyForCloud(c) === op.activityId);
        if (cloudEntry) await deleteCloudActivity(cloudEntry.id);
        dequeue(op.activityId);
        processed += 1;
      } catch {
        // Toujours hors ligne/en échec : reste en file, réessayé au prochain sync().
        cloudSummaries = null; // ne pas réutiliser un résultat potentiellement responsable de l'échec réseau
      }
    }
    return { processed, cloudSummaries };
  }

  /**
   * Corps réel de la réconciliation — jamais appelé directement, uniquement
   * via `sync()` qui applique la déduplication/le cooldown (voir plus bas).
   */
  async function runSync(reportProgress) {
    const deleteOutcome = await processQueuedDeletes(null);

    const localSummaries = await listLocalSummariesLenient();
    const cloudSummaries = deleteOutcome.cloudSummaries || (await listCloudActivities());
    const merged = mergeActivitySummaries(localSummaries, cloudSummaries);

    const toUpload = merged.filter((m) => m.syncStatus === "local-only" && SYNCABLE_SOURCE_TYPES.has(m.source?.type));
    const toDownload = merged.filter((m) => m.syncStatus === "cloud-only");
    // Supprimée du cloud depuis un autre appareil (voir mergeActivitySummaries) :
    // honore la suppression plutôt que de la re-uploader — voir consigne 11C
    // §6 (idempotence, jamais de doublon) et §19 (une suppression doit se
    // propager, jamais être annulée par une resynchronisation).
    const toDeleteLocally = merged.filter((m) => m.syncStatus === "cloud-deleted");
    const total = toUpload.length + toDownload.length + toDeleteLocally.length;
    let done = 0;
    const result = {
      uploaded: 0,
      downloaded: 0,
      deletedLocally: 0,
      alreadySynced: merged.filter((m) => m.syncStatus === "synced").length,
      deletesProcessed: deleteOutcome.processed,
      errors: [],
    };
    const report = () => reportProgress({ current: done, total });

    for (const entry of toUpload) {
      try {
        const detail = await localStore.loadActivityDetail(rootHandle, entry.id);
        const ext = detail.source.type;
        const content = ext === "fit"
          ? await localStore.loadActivitySourceArrayBuffer(rootHandle, entry.id)
          : await localStore.loadActivitySourceText(rootHandle, entry.id);
        const created = await cloudUploadActivity({ activity: detail, originalFileContent: content, sourceFormat: ext });
        await markSyncedLocally(entry.id, created.id);
        dequeue(entry.id);
        result.uploaded += 1;
      } catch (err) {
        if (err instanceof CloudDuplicateActivityError) {
          if (err.existingActivity) await markSyncedLocally(entry.id, err.existingActivity.id);
          dequeue(entry.id);
          result.uploaded += 1;
        } else {
          result.errors.push({ activityId: entry.id, message: err.message || String(err) });
          enqueueUpload({ activityId: entry.id });
        }
      }
      done += 1;
      report();
    }

    for (const entry of toDownload) {
      try {
        const rawCloudEntry = cloudSummaries.find((c) => mergeKeyForCloud(c) === entry.id);
        await materializeFromCloud(rawCloudEntry);
        result.downloaded += 1;
      } catch (err) {
        result.errors.push({ activityId: entry.id, message: err.message || String(err) });
      }
      done += 1;
      report();
    }

    for (const entry of toDeleteLocally) {
      try {
        await withLocalWriteLock(() => localStore.deleteActivity(rootHandle, entry.id));
        invalidateActivityCache(rootHandle, entry.id);
        result.deletedLocally += 1;
      } catch (err) {
        result.errors.push({ activityId: entry.id, message: err.message || String(err) });
      }
      done += 1;
      report();
    }

    return result;
  }

  /**
   * Réconciliation local ⇄ cloud (voir consigne 11B §9/§10/§11, 11C §1-3) :
   * envoie chaque sortie locale absente du cloud, télécharge+matérialise
   * chaque sortie cloud absente localement, rejoue les suppressions en
   * attente. Déduplication + cooldown au niveau MODULE (voir docstring du
   * fichier) : deux appels concurrents pour le même compte cloud partagent
   * le même cycle et son résultat, jamais deux réconciliations parallèles.
   *
   * @param {{onProgress?: (info: {current: number, total: number}) => void, force?: boolean}} [options]
   *   `force: true` (utilisé par le bouton "Synchroniser"/"Réessayer" de
   *   CloudAccountPanel.jsx) ignore le cooldown mais respecte toujours la
   *   déduplication d'un cycle déjà en cours.
   * @returns {Promise<{uploaded: number, downloaded: number, alreadySynced: number, deletesProcessed: number, errors: Array<{activityId: string, message: string}>}>}
   */
  async function sync({ onProgress, force = false } = {}) {
    if (!hasCloud) throw new CloudNotAuthenticatedError();

    const existing = inFlightByAccount.get(accountId);
    if (existing) {
      if (onProgress) existing.progressCallbacks.add(onProgress);
      return existing.promise;
    }

    const lastAttempt = lastAttemptByAccount.get(accountId) || 0;
    if (!force && Date.now() - lastAttempt < SYNC_COOLDOWN_MS && lastResultByAccount.has(accountId)) {
      return lastResultByAccount.get(accountId);
    }
    lastAttemptByAccount.set(accountId, Date.now());

    const progressCallbacks = new Set();
    if (onProgress) progressCallbacks.add(onProgress);
    const reportProgress = (info) => {
      for (const cb of progressCallbacks) cb(info);
    };

    const promise = runSync(reportProgress).finally(() => {
      inFlightByAccount.delete(accountId);
    });
    inFlightByAccount.set(accountId, { promise, progressCallbacks });

    const result = await promise;
    lastResultByAccount.set(accountId, result);
    notifySyncCompleted(result);
    return result;
  }

  /**
   * Applique la résolution d'un conflit détecté (voir `resolveConflict()`,
   * pure, ci-dessus) : "garder la version locale" réenvoie le fichier local
   * au cloud (remplace l'ancienne ligne+fichier cloud) ; "garder la version
   * cloud" retélécharge et écrase la copie locale. Jamais silencieux : le
   * choix vient toujours d'une confirmation explicite de l'utilisateur
   * (voir CloudAccountPanel.jsx) — voir consigne 11C §15.
   * @param {string} id
   * @param {'local'|'cloud'|'cancel'} choice
   * @returns {Promise<{action: 'upload-local'|'download-cloud'|'none'}>}
   */
  async function applyConflictResolution(id, choice) {
    if (!hasCloud) throw new CloudNotAuthenticatedError();
    const resolution = resolveConflict({ choice });

    if (resolution.action === "none") return resolution;

    const cloudSummaries = await listCloudActivities();
    const cloudEntry = cloudSummaries.find((c) => mergeKeyForCloud(c) === id);

    if (resolution.action === "upload-local") {
      if (!hasLocal) throw new Error("Aucun dossier de stockage local connecté.");
      const detail = await localStore.loadActivityDetail(rootHandle, id);
      const ext = detail.source.type;
      const content = ext === "fit"
        ? await localStore.loadActivitySourceArrayBuffer(rootHandle, id)
        : await localStore.loadActivitySourceText(rootHandle, id);
      if (cloudEntry) await deleteCloudActivity(cloudEntry.id);
      const created = await cloudUploadActivity({ activity: detail, originalFileContent: content, sourceFormat: ext });
      await markSyncedLocally(id, created.id);
    } else if (resolution.action === "download-cloud") {
      if (!cloudEntry) throw new Error(`Sortie cloud introuvable pour le conflit (id ${id}).`);
      await materializeFromCloud(cloudEntry, { replaceLocal: true });
    }

    notifySyncCompleted({ uploaded: 0, downloaded: 0, conflictsResolved: 1 });
    return resolution;
  }

  return {
    hasLocal,
    hasCloud,
    listActivities,
    loadActivityDetail,
    loadActivityDetails,
    saveActivity,
    deleteActivity,
    hasActivity,
    sync,
    applyConflictResolution,
  };
}
