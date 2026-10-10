/**
 * Analyse du terrain d'une sortie : point d'entrée public (voir README.md de ce dossier pour la méthode).
 *
 * Flux : points GPS → zones à charger (cellsForTrack)
 *   → IGN BD TOPO (source principale en France métropolitaine et DOM : cache, puis réseau SI consentement)
 *   → OpenStreetMap (hors IGN = source principale ; zone sans données IGN = secours ; sinon complément FACULTATIF de
 *     surface et de technicité)
 *   → fusion sans double comptage (merge.js) → rattachement (matchTrack) → profil (summarizeTerrain)
 *   + difficulté estimée (estimateDifficulty) + provenance (provenance.js).
 * Aucune donnée GPS n'est modifiée, aucune portion absente de la carte n'est inventée, et aucun tag absent des sources
 * n'est fabriqué. Le GPX/FIT et le tracé ne quittent jamais l'appareil : seules des zones fixes de ~2 km sont demandées.
 */
import { cellsForTrack } from "./geo.js";
import { loadCells, MAX_NETWORK_CELLS } from "./osm.js";
import { loadIgnCells } from "./ign.js";
import { isIgnEligible, ignRegionForCell } from "./coverage.js";
import { mergeSources } from "./merge.js";
import { matchTrack } from "./matching.js";
import { summarizeTerrain, terrainStrip } from "./profile.js";
import { estimateDifficulty } from "./difficulty.js";
import { buildProvenance } from "./provenance.js";

export { memoryStore, idbStore } from "./store.js";
export { cellsForTrack, CELL_SIZE_DEG } from "./geo.js";
export { MAX_NETWORK_CELLS, OVERPASS_ENDPOINTS, MAX_FAILED_CELLS, MAX_REQUESTS_PER_RUN, MAX_REQUESTS_PER_CELL, CELLS_PER_REQUEST } from "./osm.js";
export { IGN_WFS_URL, IGN_ATTRIBUTION, IGN_LAYER } from "./ign.js";
export { ignRegionForCell, isIgnEligible, IGN_REGIONS } from "./coverage.js";
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
    provenance: buildProvenance(segments),
    analyzedKm: totalM / 1000,
  };
}

/** Zones qu'il faudrait pour ce tracé (affichées au consentement : nombre de zones, jamais le tracé). */
export function planTerrainCells(points) {
  const cellKeys = cellsForTrack((points || []).filter((p) => p && p.lat != null && p.lon != null));
  const ignCount = cellKeys.filter(isIgnEligible).length;
  return { cellKeys, count: cellKeys.length, ignCount, osmOnlyCount: cellKeys.length - ignCount, tooLarge: cellKeys.length > MAX_NETWORK_CELLS };
}

const HAS_DATA = new Set(["cache", "network", "stale"]);

/**
 * Charge les données puis analyse.
 * @param {Object} params
 * @param {Array} params.points
 * @param {{get: Function, put: Function}} params.store
 * @param {boolean} params.allowNetwork - true seulement après consentement explicite de l'utilisateur
 * @param {typeof fetch} [params.fetchImpl] - utilisé pour les deux sources, sauf si `ignFetchImpl` / `osmFetchImpl` sont fournis
 * @param {{ign?: boolean, osm?: boolean, osmEnrichment?: "on"|"cache"|"off"}} [params.sources]
 *   `ign: false` : n'interroge pas l'IGN ; `osm: false` : n'utilise pas OpenStreetMap du tout ; `osmEnrichment` :
 *   « on » (défaut) complète les zones IGN avec OSM (réseau permis), « cache » n'utilise que le cache OSM pour ce
 *   complément, « off » l'ignore. Hors IGN (ou zone sans données IGN), OSM reste la source principale/de secours.
 * @returns {Promise<{status: "no_gps"} | {
 *   status: "done", result: Object, merge: Object, sources: Object,
 *   load: {cells: Object, errors: string[], tooLarge: boolean, unavailable: boolean, capped: boolean, requests: number, rateLimited: boolean, retryAfterMs: number},
 *   cellCounts: {total: number, available: number, missing: number, deferred: number, error: number, noIgnData: number}
 * }>}
 *   `missing` inclut les zones différées (`deferred`) et les zones sans aucune donnée : elles restent « non classifiées ».
 *   `load.unavailable` ne parle que des zones SANS données après toutes les tentatives ; l'échec d'un simple complément
 *   OpenStreetMap n'y compte jamais (voir `sources.enrichment`).
 */
export async function runTerrainAnalysis({
  points, store, allowNetwork, fetchImpl, ignFetchImpl, osmFetchImpl, sleep, minIntervalMs, signal, onProgress, cellsPerRequest, sources = {}, ignOptions = {},
}) {
  const usable = (points || []).filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number");
  if (usable.length < 2) return { status: "no_gps" };
  const { cellKeys } = planTerrainCells(usable);

  const useIgn = sources.ign !== false;
  const useOsm = sources.osm !== false;
  const enrichmentMode = useOsm ? sources.osmEnrichment || "on" : "off";
  const ignKeys = useIgn ? cellKeys.filter(isIgnEligible) : [];
  const ignSet = new Set(ignKeys);

  // 1. IGN : source principale sur son territoire
  const ign = ignKeys.length
    ? await loadIgnCells({ cellKeys: ignKeys, store, allowNetwork, fetchImpl: ignFetchImpl || fetchImpl, sleep, signal, onProgress, ...(minIntervalMs === 0 ? { minIntervalMs: 0 } : {}), ...ignOptions })
    : null;
  const ignData = (k) => !!ign && ignSet.has(k) && HAS_DATA.has(ign.cells[k]) && !ign.empty[k];

  // 2. OpenStreetMap : principal (hors IGN), secours (zone IGN sans données) ou complément (zone IGN avec données)
  const primaryOsmKeys = useOsm ? cellKeys.filter((k) => !ignSet.has(k) || !ignData(k)) : [];
  const enrichKeys = enrichmentMode !== "off" ? cellKeys.filter((k) => ignSet.has(k) && ignData(k)) : [];
  const loadOsm = (keys, allow) => (keys.length ? loadCells({ cellKeys: keys, store, allowNetwork: allow, fetchImpl: osmFetchImpl || fetchImpl, sleep, minIntervalMs, signal, onProgress, cellsPerRequest }) : null);
  const osmPrimary = await loadOsm(primaryOsmKeys, allowNetwork);
  const osmEnrich = await loadOsm(enrichKeys, allowNetwork && enrichmentMode === "on");
  const osmData = (k) => (!!osmPrimary && HAS_DATA.has(osmPrimary.cells[k])) || (!!osmEnrich && HAS_DATA.has(osmEnrich.cells[k]));

  // 3. Fusion sans double comptage, puis analyse
  const osmWays = new Map();
  for (const w of [...(osmPrimary ? osmPrimary.ways : []), ...(osmEnrich ? osmEnrich.ways : [])]) if (!osmWays.has(w.id)) osmWays.set(w.id, w);
  const merged = mergeSources(ign ? ign.ways : [], [...osmWays.values()]);
  const result = analyzeTerrain(usable, merged.ways);

  // 4. Bilan par zone : « disponible » = au moins UNE source a fourni des chemins pour cette zone
  const cellCounts = { total: cellKeys.length, available: 0, missing: 0, deferred: 0, error: 0, noIgnData: 0 };
  const cells = {};
  for (const k of cellKeys) {
    const statuses = [ign && ignSet.has(k) ? ign.cells[k] : null, osmPrimary ? osmPrimary.cells[k] : null].filter(Boolean);
    if (ignData(k)) cells[k] = ign.cells[k];
    else if (osmPrimary && HAS_DATA.has(osmPrimary.cells[k])) cells[k] = osmPrimary.cells[k];
    else if (statuses.includes("error")) cells[k] = "error";
    else if (statuses.includes("deferred")) cells[k] = "deferred";
    else cells[k] = "missing";
    if (ign && ignSet.has(k) && ign.empty[k]) cellCounts.noIgnData += 1;
    if (ignData(k) || (osmPrimary && HAS_DATA.has(osmPrimary.cells[k]))) cellCounts.available += 1;
    else if (cells[k] === "error") cellCounts.error += 1;
    else { cellCounts.missing += 1; if (cells[k] === "deferred") cellCounts.deferred += 1; }
  }
  const noDataCells = cellCounts.total - cellCounts.available;
  const primaries = [ign, osmPrimary].filter(Boolean);
  const unavailable = noDataCells > 0 && primaries.some((p) => p.unavailable);
  const rateLimited = primaries.some((p) => p.rateLimited);
  const enrichmentFailed = !!osmEnrich && (osmEnrich.unavailable || osmEnrich.rateLimited);

  return {
    status: "done",
    result,
    merge: merged.stats,
    cellCounts,
    sources: {
      ign: ign && {
        eligibleCells: ignKeys.length, loaded: ignKeys.filter(ignData).length, emptyCells: Object.keys(ign.empty).length,
        unavailable: ign.unavailable, rateLimited: ign.rateLimited, capped: ign.capped, requests: ign.requests,
        truncatedCells: ign.meta.truncatedCells, dropped: ign.meta.dropped, dataDate: ign.meta.latestModification,
      },
      osm: {
        mode: enrichmentMode, primaryUnavailable: !!osmPrimary && osmPrimary.unavailable && noDataCells > 0, primaryCells: primaryOsmKeys.length, primaryLoaded: primaryOsmKeys.filter((k) => osmPrimary && HAS_DATA.has(osmPrimary.cells[k])).length,
        requests: (osmPrimary ? osmPrimary.requests : 0) + (osmEnrich ? osmEnrich.requests : 0),
      },
      enrichment: {
        mode: enrichmentMode, cells: enrichKeys.length, loaded: enrichKeys.filter((k) => osmEnrich && HAS_DATA.has(osmEnrich.cells[k])).length,
        failed: enrichmentFailed, rateLimited: !!osmEnrich && osmEnrich.rateLimited, requests: osmEnrich ? osmEnrich.requests : 0,
        retryAfterMs: osmEnrich ? osmEnrich.retryAfterMs : 0,
      },
    },
    load: {
      cells,
      errors: [...(ign ? ign.errors : []), ...(osmPrimary ? osmPrimary.errors : []), ...(osmEnrich ? osmEnrich.errors : [])],
      tooLarge: primaries.some((p) => p.tooLarge),
      unavailable,
      capped: !unavailable && primaries.some((p) => p.capped),
      rateLimited,
      retryAfterMs: Math.max(0, ...primaries.map((p) => p.retryAfterMs || 0)),
      requests: primaries.reduce((a, p) => a + p.requests, 0) + (osmEnrich ? osmEnrich.requests : 0),
    },
  };
}

export { ignRegionForCell as regionOfCell };
