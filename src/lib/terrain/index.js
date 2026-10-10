/**
 * Analyse du terrain d'une sortie : point d'entrée public (voir README.md de ce dossier pour la méthode).
 *
 * Flux : points GPS → zones à charger (cellsForTrack) → chemins OSM (cache, puis réseau SI consentement)
 *        → rattachement (matchTrack) → profil (summarizeTerrain) + difficulté estimée (estimateDifficulty).
 * Aucune donnée GPS n'est modifiée, aucune portion absente de la carte n'est inventée.
 */
import { cellsForTrack } from "./geo.js";
import { loadCells, MAX_NETWORK_CELLS } from "./osm.js";
import { matchTrack } from "./matching.js";
import { summarizeTerrain, terrainStrip } from "./profile.js";
import { estimateDifficulty } from "./difficulty.js";

export { memoryStore, idbStore } from "./store.js";
export { cellsForTrack, CELL_SIZE_DEG } from "./geo.js";
export { MAX_NETWORK_CELLS, OVERPASS_ENDPOINTS, MAX_FAILED_CELLS, MAX_REQUESTS_PER_RUN, MAX_REQUESTS_PER_CELL } from "./osm.js";
export { TERRAIN_LABELS, TERRAIN_TYPE_LABELS, TERRAIN_CATEGORIES } from "./profile.js";
export { LEVEL_LABELS } from "./difficulty.js";

/**
 * Analyse pure à partir de chemins déjà chargés (testable sans réseau).
 * @param {Array<{lat: number, lon: number, grade?: number|null}>} points
 * @param {Array} ways
 */
export function analyzeTerrain(points, ways) {
  const { segments, totalM } = matchTrack(points, ways);
  const summary = summarizeTerrain(segments);
  return {
    summary,
    strip: terrainStrip(segments),
    difficulty: estimateDifficulty(segments, summary),
    analyzedKm: totalM / 1000,
  };
}

/** Zones qu'il faudrait pour ce tracé (affichées au consentement : nombre de zones, jamais le tracé). */
export function planTerrainCells(points) {
  const cellKeys = cellsForTrack((points || []).filter((p) => p && p.lat != null && p.lon != null));
  return { cellKeys, count: cellKeys.length, tooLarge: cellKeys.length > MAX_NETWORK_CELLS };
}

/**
 * Charge les données puis analyse.
 * @param {Object} params
 * @param {Array} params.points
 * @param {{get: Function, put: Function}} params.store
 * @param {boolean} params.allowNetwork - true seulement après consentement explicite de l'utilisateur
 * @returns {Promise<{status: "no_gps"} | {status: "done", result: Object, load: {cells: Object, errors: string[], tooLarge: boolean, unavailable: boolean, capped: boolean, requests: number}, cellCounts: {total, available, missing, deferred, error}}>}
 *   `missing` inclut les zones différées (`deferred`) : elles restent « non classifiées » et peuvent être relancées.
 */
export async function runTerrainAnalysis({ points, store, allowNetwork, fetchImpl, sleep, minIntervalMs, signal, onProgress }) {
  const usable = (points || []).filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number");
  if (usable.length < 2) return { status: "no_gps" };
  const { cellKeys } = planTerrainCells(usable);
  const load = await loadCells({ cellKeys, store, allowNetwork, fetchImpl, sleep, minIntervalMs, signal, onProgress });
  const result = analyzeTerrain(usable, load.ways);
  const cellCounts = { total: cellKeys.length, available: 0, missing: 0, deferred: 0, error: 0 };
  for (const status of Object.values(load.cells)) {
    if (status === "cache" || status === "network" || status === "stale") cellCounts.available += 1;
    else if (status === "error") cellCounts.error += 1;
    else {
      cellCounts.missing += 1;
      if (status === "deferred") cellCounts.deferred += 1;
    }
  }
  return {
    status: "done", result, cellCounts,
    load: { cells: load.cells, errors: load.errors, tooLarge: load.tooLarge, unavailable: load.unavailable, capped: load.capped, requests: load.requests },
  };
}
