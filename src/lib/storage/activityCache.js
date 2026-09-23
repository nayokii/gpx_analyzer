/**
 * Cache du détail complet des activités (`loadActivityDetail`), par dossier
 * de stockage — Phase 9E (performance).
 *
 * Pourquoi : ProfileView.jsx, AlterEgoView.jsx et ArchetypeView.jsx chargent
 * chacune, indépendamment, le détail complet (avec `samples`) de TOUTES les
 * activités de l'historique à chaque montage. Comme ce sont des composants
 * différents montés/démontés à chaque changement d'onglet (voir
 * GPXAnalyzer.jsx), naviguer entre eux relisait et re-parsait plusieurs MB de
 * JSON par activité, plusieurs fois de suite, sans qu'aucune activité n'ait
 * changé entre-temps (mesuré : ~550 ms pour 3 lectures complètes de 6
 * activités réelles, voir docs/PERFORMANCE.md).
 *
 * Sécurité de ce cache : les fichiers `activities/<date>_<id>.json` sont
 * écrits une seule fois par id (voir storage/activityStore.js: saveActivity
 * — un nouvel import génère toujours un nouvel id, jamais une réécriture
 * d'un id existant) — un id déjà mis en cache ne peut donc jamais changer de
 * contenu sous nos pieds. La seule opération qui rend une entrée obsolète
 * est la SUPPRESSION d'une activité (voir `invalidateActivityCache`, appelée
 * par HistoryView.jsx après `deleteActivity`) — sans ça, l'entrée resterait
 * simplement orpheline (jamais redemandée, puisqu'absente du prochain
 * `listActivities()`), pas incorrecte, mais l'invalidation explicite reste
 * plus propre.
 *
 * Le cache est tenu par un `WeakMap` clé sur le `rootHandle` lui-même : si
 * l'utilisateur déconnecte/reconnecte un autre dossier, l'ancien cache n'est
 * simplement plus jamais consulté (et peut être collecté par le GC) — jamais
 * besoin de le vider explicitement au changement de dossier.
 */

import { loadActivityDetail } from "./activityStore.js";

const detailCacheByRoot = new WeakMap(); // rootHandle -> Map(id -> Promise<Activity>)

function tableFor(rootHandle) {
  let table = detailCacheByRoot.get(rootHandle);
  if (!table) {
    table = new Map();
    detailCacheByRoot.set(rootHandle, table);
  }
  return table;
}

/**
 * Équivalent mémoïsé de `loadActivityDetail(rootHandle, id)` — la promesse
 * elle-même est mise en cache (pas seulement le résultat), donc deux appels
 * concurrents pour le même id ne déclenchent qu'une seule lecture disque.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} id
 * @returns {Promise<import('../types.js').Activity>}
 */
export function getCachedActivityDetail(rootHandle, id) {
  const table = tableFor(rootHandle);
  const hit = table.get(id);
  if (hit) return hit;
  const promise = loadActivityDetail(rootHandle, id).catch((err) => {
    table.delete(id); // un échec ne doit jamais rester en cache : la prochaine tentative doit pouvoir réessayer
    throw err;
  });
  table.set(id, promise);
  return promise;
}

/**
 * Charge (avec cache) le détail complet d'une liste d'activités, avec la
 * même tolérance aux échecs individuels que le code appelant utilisait déjà
 * (`Promise.allSettled` — voir consigne §16 des phases précédentes : une
 * activité illisible ne doit jamais faire échouer les autres).
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {Array<{id: string}>} summaries
 * @returns {Promise<PromiseSettledResult<import('../types.js').Activity>[]>}
 */
export function loadCachedActivityDetails(rootHandle, summaries) {
  return Promise.allSettled(summaries.map((s) => getCachedActivityDetail(rootHandle, s.id)));
}

/** Oublie une entrée précise (ex. après suppression d'une activité). */
export function invalidateActivityCache(rootHandle, id) {
  const table = detailCacheByRoot.get(rootHandle);
  if (table) table.delete(id);
}

/** Réservé aux tests : vide tout le cache (tous dossiers confondus). */
export function __clearActivityCacheForTests() {
  // WeakMap n'est pas itérable : on ne peut pas "tout vider" à proprement
  // parler, mais chaque test utilise un `rootHandle` (MemoryDirectoryHandle)
  // fraîchement créé, donc aucune entrée précédente ne peut jamais être
  // revisitée — rien à faire ici au-delà de documenter cette garantie.
}
