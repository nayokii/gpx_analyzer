/**
 * Segments Strava correspondant aux montées détectées (voir ../climbs/).
 *
 * Pour chaque montée, on interroge l'endpoint « explorer les segments » de
 * Strava sur la zone du tracé, puis on retient le segment dont le départ ET
 * l'arrivée sont proches de ceux de la montée (même tolérance que le
 * regroupement des montées). Lecture seule, un appel par montée, à la demande :
 * jamais en arrière-plan (limites de l'API Strava : 100 requêtes / 15 min).
 *
 * Les chronos restent ceux calculés par l'application à partir des traces ;
 * Strava fournit ici l'identité de la montée (nom, catégorie, lien).
 */
import { haversine } from "../utils.js";
import { MATCH_RADIUS_M } from "../climbs/climbRegistry.js";
import { exploreSegments } from "./api.js";
import { ensureFreshTokens } from "./auth.js";
import { saveStravaState } from "./storage.js";
import { StravaRateLimitError, StravaNotConnectedError } from "./errors.js";

const BOUNDS_PADDING_DEG = 0.002; // ~200 m autour du tracé

/** @returns {[number, number, number, number]|null} [sudLat, ouestLon, nordLat, estLon] */
export function boundsAround(path) {
  if (!path || path.length === 0) return null;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const [lat, lon] of path) {
    south = Math.min(south, lat); north = Math.max(north, lat);
    west = Math.min(west, lon); east = Math.max(east, lon);
  }
  return [south - BOUNDS_PADDING_DEG, west - BOUNDS_PADDING_DEG, north + BOUNDS_PADDING_DEG, east + BOUNDS_PADDING_DEG];
}

/**
 * Parmi les segments renvoyés par Strava, celui qui correspond à la montée
 * (départ et arrivée à moins de MATCH_RADIUS_M), le plus proche en cas de choix.
 * @param {Array} segments - résultats de exploreSegments (start_latlng / end_latlng)
 * @param {{startLat: number, startLon: number, endLat: number, endLon: number}} climb
 * @returns {{id: number|string, name: string, category: number|null}|null}
 */
export function pickSegmentForClimb(segments, climb) {
  let best = null;
  let bestScore = Infinity;
  for (const seg of segments || []) {
    if (!Array.isArray(seg.start_latlng) || !Array.isArray(seg.end_latlng)) continue;
    const dStart = haversine(climb.startLat, climb.startLon, seg.start_latlng[0], seg.start_latlng[1]);
    const dEnd = haversine(climb.endLat, climb.endLon, seg.end_latlng[0], seg.end_latlng[1]);
    if (dStart > MATCH_RADIUS_M || dEnd > MATCH_RADIUS_M) continue;
    if (dStart + dEnd < bestScore) {
      bestScore = dStart + dEnd;
      best = seg;
    }
  }
  return best ? { id: best.id, name: best.name, category: best.climb_category ?? null } : null;
}

/**
 * Cherche le segment Strava de chaque montée donnée, une à la fois.
 * S'arrête proprement si la limite de requêtes est atteinte (le reste pourra
 * être relancé plus tard).
 *
 * @param {Object} params
 * @param {FileSystemDirectoryHandle} params.rootHandle
 * @param {import('./types.js').StravaConnectionState} params.state
 * @param {Array<{id: string, path: Array, startLat: number, startLon: number, endLat: number, endLon: number}>} params.groups
 * @param {typeof fetch} [params.fetchImpl]
 * @param {(done: number, total: number) => void} [params.onProgress]
 * @returns {Promise<{matches: Array<{group: Object, segment: Object}>, searched: number, rateLimited: boolean}>}
 */
export async function findStravaSegmentsForClimbs({ rootHandle, state, groups, fetchImpl = fetch, onProgress }) {
  if (!state || !state.connected || !state.tokens) throw new StravaNotConnectedError();

  const { tokens, refreshed } = await ensureFreshTokens(state.tokens, { fetchImpl });
  if (refreshed && rootHandle) await saveStravaState(rootHandle, { ...state, tokens });

  const matches = [];
  let searched = 0;
  for (const group of groups) {
    const bounds = boundsAround(group.path);
    if (bounds) {
      try {
        const segments = await exploreSegments({ accessToken: tokens.accessToken, bounds, fetchImpl });
        const segment = pickSegmentForClimb(segments, group);
        if (segment) matches.push({ group, segment });
      } catch (err) {
        if (err instanceof StravaRateLimitError) return { matches, searched, rateLimited: true };
        throw err;
      }
    }
    searched += 1;
    if (onProgress) onProgress(searched, groups.length);
  }
  return { matches, searched, rateLimited: false };
}
