/**
 * Synchronisation Strava : première importation (historique complet) et
 * synchronisations suivantes (nouvelles activités uniquement), avec
 * déduplication et écriture dans le stockage existant (voir
 * ../storage/activityStore.js — jamais un magasin parallèle).
 *
 * Séparation volontaire (voir consigne) :
 *  - auth.js   : jetons (rafraîchissement)
 *  - api.js    : appels HTTP Strava bruts
 *  - adapter.js: SummaryActivity+streams → Activity
 *  - storage.js: persistance de l'état de connexion/synchro (strava.json)
 *  - sync.js (ici) : orchestration — ne connaît ni le détail des appels HTTP
 *    ni le détail de conversion, appelle les modules ci-dessus.
 */

import { ensureFreshTokens } from "./auth.js";
import { listAllAthleteActivities, getActivityStreams } from "./api.js";
import { stravaActivityToActivity } from "./adapter.js";
import { mapStravaSportType } from "./types.js";
import { saveActivity } from "../storage/activityStore.js";
import { saveStravaState } from "./storage.js";
import { StravaNotConnectedError } from "./errors.js";

/** Tolérance de déduplication inter-sources (voir consigne : ne jamais
 * supprimer/ignorer silencieusement en cas de doute — seule une
 * correspondance SERRÉE est traitée comme doublon probable). */
const DEDUPE_TIME_TOLERANCE_SEC = 120;
const DEDUPE_DISTANCE_TOLERANCE_RATIO = 0.02; // 2%
const DEDUPE_DISTANCE_TOLERANCE_MIN_KM = 0.3;

/**
 * @param {Object} stravaSummary
 * @param {Array} existingSummaries - résumés issus de listActivities() (voir ../storage/activityStore.js)
 * @returns {boolean}
 */
export function isProbableDuplicate(stravaSummary, existingSummaries) {
  const stravaDate = stravaSummary.start_date ? new Date(stravaSummary.start_date).getTime() : null;
  const stravaDistanceKm = stravaSummary.distance != null ? stravaSummary.distance / 1000 : null;
  if (stravaDate == null || stravaDistanceKm == null) return false;

  return existingSummaries.some((existing) => {
    if (!existing.date || existing.distance == null) return false;
    const existingDate = new Date(existing.date).getTime();
    if (!isFinite(existingDate)) return false;
    const dtSec = Math.abs(existingDate - stravaDate) / 1000;
    if (dtSec > DEDUPE_TIME_TOLERANCE_SEC) return false;

    const tolerance = Math.max(DEDUPE_DISTANCE_TOLERANCE_MIN_KM, stravaDistanceKm * DEDUPE_DISTANCE_TOLERANCE_RATIO);
    return Math.abs(existing.distance - stravaDistanceKm) <= tolerance;
  });
}

/**
 * Synchronise les activités Strava : première importation si
 * `state.syncCursor` est `null`, incrémentale sinon (ne demande à l'API que
 * les activités postérieures au curseur — voir consigne : jamais un
 * re-téléchargement complet à chaque ouverture).
 *
 * Résiliente aux erreurs partielles : l'échec d'une activité (flux
 * indisponible, GPS absent, donnée malformée) est consigné dans
 * `summary.errors` et n'interrompt pas la synchro des suivantes.
 *
 * @param {Object} params
 * @param {FileSystemDirectoryHandle} params.rootHandle
 * @param {import('./types.js').StravaConnectionState} params.state - état courant (doit avoir `connected: true` et des `tokens`)
 * @param {Array} params.existingSummaries - résumés d'activités déjà en historique (voir ../storage/activityStore.js: listActivities)
 * @param {Object|null} [params.userSettings] - {weight, bikeWeight, ftp}, transmis à computeAnalysis via l'adaptateur
 * @param {typeof fetch} [params.fetchImpl]
 * @param {(info: {phase: string, current: number, total: number}) => void} [params.onProgress]
 * @returns {Promise<{state: import('./types.js').StravaConnectionState, summary: import('./types.js').StravaSyncSummary}>}
 */
export async function syncStrava({ rootHandle, state, existingSummaries, userSettings = null, fetchImpl = fetch, onProgress }) {
  if (!state || !state.connected || !state.tokens) throw new StravaNotConnectedError();

  const startedAt = new Date().toISOString();
  const summary = { startedAt, finishedAt: null, imported: 0, skippedDuplicates: 0, skippedNonCycling: 0, errors: [] };

  // 1) Jeton à jour (rafraîchi si besoin) — persisté immédiatement pour ne
  //    jamais perdre un rafraîchissement en cas d'échec plus tard dans la synchro.
  const { tokens, refreshed } = await ensureFreshTokens(state.tokens, { fetchImpl });
  let nextState = { ...state, tokens };
  if (refreshed) await saveStravaState(rootHandle, nextState);

  // 2) Récupération des activités (toutes pages) depuis le curseur de synchro.
  const afterEpoch = nextState.syncCursor || undefined;
  const fetched = await listAllAthleteActivities({
    accessToken: tokens.accessToken,
    after: afterEpoch,
    fetchImpl,
    onPage: (batch, page) => onProgress && onProgress({ phase: "list", current: page, total: null, count: batch.length }),
  });

  let maxSeenEpoch = nextState.syncCursor || 0;
  const importedIds = new Set(nextState.importedStravaIds);

  for (let i = 0; i < fetched.length; i++) {
    const activitySummary = fetched[i];
    onProgress && onProgress({ phase: "import", current: i + 1, total: fetched.length });

    const epoch = activitySummary.start_date ? Math.floor(new Date(activitySummary.start_date).getTime() / 1000) : null;
    if (epoch != null && epoch > maxSeenEpoch) maxSeenEpoch = epoch;

    const stravaId = String(activitySummary.id);

    if (importedIds.has(stravaId)) {
      summary.skippedDuplicates += 1;
      continue;
    }
    if (!mapStravaSportType(activitySummary.sport_type || activitySummary.type)) {
      summary.skippedNonCycling += 1;
      continue;
    }
    if (isProbableDuplicate(activitySummary, existingSummaries)) {
      summary.skippedDuplicates += 1;
      importedIds.add(stravaId); // évite de re-évaluer ce doublon à chaque synchro future
      continue;
    }

    try {
      const streams = await getActivityStreams({ accessToken: tokens.accessToken, activityId: activitySummary.id, fetchImpl });
      const activity = stravaActivityToActivity(activitySummary, streams, { athleteId: nextState.athlete?.id, userSettings });
      const rawSource = JSON.stringify({ summary: activitySummary, streams }, null, 2);
      // Extension volontairement SANS ".json" final : rebuildIndex() (voir
      // ../storage/activityStore.js) repère les fichiers d'activité par ce
      // seul suffixe — un ".strava.json" serait donc pris à tort pour une
      // seconde Activity normalisée lors d'une reconstruction d'index.
      const saved = await saveActivity(rootHandle, activity, rawSource, "strava");
      existingSummaries = [...existingSummaries, { id: saved.id, date: saved.date, distance: saved.distance, source: saved.source }];
      importedIds.add(stravaId);
      summary.imported += 1;
    } catch (err) {
      summary.errors.push({ activityId: activitySummary.id, message: err.message || String(err) });
    }
  }

  summary.finishedAt = new Date().toISOString();

  nextState = {
    ...nextState,
    lastSyncAt: summary.finishedAt,
    syncCursor: maxSeenEpoch || nextState.syncCursor,
    importedStravaIds: Array.from(importedIds),
    lastSyncSummary: summary,
  };
  await saveStravaState(rootHandle, nextState);

  return { state: nextState, summary };
}
