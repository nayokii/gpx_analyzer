/**
 * Appels HTTP directs à l'API Strava v3 (lecture seule : liste des
 * activités de l'athlète connecté, flux d'une activité). Ces appels portent
 * le access_token dans l'en-tête Authorization ; ils n'impliquent jamais le
 * client_secret (voir auth.js pour l'échange/rafraîchissement, qui seul en a
 * besoin, côté serveur).
 *
 * Référence : https://developers.strava.com/docs/reference/
 */

import {
  StravaTokenExpiredError,
  StravaApiUnavailableError,
  StravaRateLimitError,
  StravaActivityUnavailableError,
} from "./errors.js";

const API_BASE = "https://www.strava.com/api/v3";

/** Flux disponibles demandés (voir consigne : ne jamais inventer un flux
 * absent — un type non renvoyé par Strava pour cette activité reste absent
 * du résultat, voir adapter.js). */
export const STREAM_KEYS = [
  "time",
  "latlng",
  "distance",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
];

async function stravaFetch(path, { accessToken, params = {}, fetchImpl = fetch, activityId = null }) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }

  const res = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) throw new StravaTokenExpiredError();
  if (res.status === 429) {
    const retryAfter = res.headers && res.headers.get ? res.headers.get("Retry-After") : null;
    throw new StravaRateLimitError(retryAfter != null ? Number(retryAfter) : null);
  }
  if (res.status === 404) throw new StravaActivityUnavailableError(activityId != null ? activityId : path);
  if (!res.ok) throw new StravaApiUnavailableError(res.status);

  try {
    return await res.json();
  } catch {
    throw new StravaApiUnavailableError(res.status);
  }
}

/**
 * Liste une page d'activités de l'athlète connecté (SummaryActivity[]).
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {number} [params.page]
 * @param {number} [params.perPage]
 * @param {number} [params.after] - timestamp Unix (secondes) : ne retourne que les activités après cette date (synchro incrémentale)
 * @param {number} [params.before]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<Array>}
 */
export async function listAthleteActivities({ accessToken, page = 1, perPage = 30, after, before, fetchImpl = fetch }) {
  const data = await stravaFetch("/athlete/activities", {
    accessToken,
    fetchImpl,
    params: { page, per_page: perPage, after, before },
  });
  if (!Array.isArray(data)) throw new StravaApiUnavailableError(null);
  return data;
}

/**
 * Récupère TOUTES les activités d'un athlète en paginant automatiquement
 * jusqu'à une page incomplète (fin de liste). S'arrête aussi si `maxPages`
 * est atteint, filet de sécurité contre une boucle infinie en cas de réponse
 * anormale de l'API.
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {number} [params.after]
 * @param {number} [params.perPage]
 * @param {number} [params.maxPages]
 * @param {typeof fetch} [params.fetchImpl]
 * @param {(pageActivities: Array, pageNumber: number) => void} [params.onPage] - callback de progression, appelé après chaque page reçue
 * @returns {Promise<Array>}
 */
export async function listAllAthleteActivities({ accessToken, after, perPage = 100, maxPages = 200, fetchImpl = fetch, onPage }) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await listAthleteActivities({ accessToken, page, perPage, after, fetchImpl });
    all.push(...batch);
    if (onPage) onPage(batch, page);
    if (batch.length < perPage) break;
  }
  return all;
}

/**
 * Récupère les flux disponibles d'une activité. Ne demande que les clés
 * listées dans STREAM_KEYS ; la réponse ne contient que celles réellement
 * disponibles pour cette activité (voir adapter.js pour la conversion en
 * points, qui traite toute clé absente comme `null`, jamais inventée).
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {string|number} params.activityId
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<Object>} objet `{ [streamType]: {data: Array, series_type, original_size, resolution} }`
 */
export async function getActivityStreams({ accessToken, activityId, fetchImpl = fetch }) {
  const data = await stravaFetch(`/activities/${activityId}/streams`, {
    accessToken,
    fetchImpl,
    activityId,
    params: { keys: STREAM_KEYS.join(","), key_by_type: true },
  });
  return data && typeof data === "object" ? data : {};
}
