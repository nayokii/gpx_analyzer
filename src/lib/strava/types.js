/**
 * Modèle de données pour l'état de connexion/synchronisation Strava, persisté
 * dans `strava.json` à la racine du dossier de stockage local (voir storage.js
 * — même mécanisme que `athlete.json`, voir ../progression/persistence.js).
 *
 * Ce fichier ne contient JAMAIS le `client_secret` (qui ne quitte jamais le
 * serveur, voir netlify/functions/) : uniquement les jetons OBTENUS pour ce
 * compte (access_token, refresh_token), qui sont par nature déjà côté
 * utilisateur une fois l'échange effectué (voir docs/STRAVA_INTEGRATION.md,
 * section "Sécurité", pour la discussion complète de ce compromis).
 */

/** Version du schéma d'état Strava persisté — permet une migration future. */
export const STRAVA_STATE_VERSION = 1;

/**
 * @typedef {Object} StravaTokens
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAt - Timestamp Unix (secondes) d'expiration de accessToken
 * @property {string} scope - Scopes accordés, tels que renvoyés par Strava (espace-séparés)
 */

/**
 * @typedef {Object} StravaAthleteSummary
 * @property {number|string} id
 * @property {string|null} firstname
 * @property {string|null} lastname
 */

/**
 * @typedef {Object} StravaSyncSummary
 * @property {string|null} startedAt - ISO 8601
 * @property {string|null} finishedAt - ISO 8601
 * @property {number} imported - Nombre d'activités importées lors de cette synchro
 * @property {number} skippedDuplicates - Nombre d'activités ignorées car doublon probable
 * @property {number} skippedNonCycling - Nombre d'activités ignorées (type non cycliste)
 * @property {Array<{activityId: string|number, message: string}>} errors - Erreurs partielles (une activité en échec n'interrompt pas les autres)
 */

/**
 * @typedef {Object} StravaConnectionState
 * @property {number} version
 * @property {boolean} connected
 * @property {StravaTokens|null} tokens
 * @property {StravaAthleteSummary|null} athlete
 * @property {string|null} connectedAt - ISO 8601
 * @property {string|null} lastSyncAt - ISO 8601 de la dernière synchro terminée (réussie ou partielle)
 * @property {number|null} syncCursor - Timestamp Unix (secondes) `start_date` de l'activité Strava la plus récente déjà importée ; sert de paramètre `after` pour la synchro incrémentale suivante
 * @property {string[]} importedStravaIds - Identifiants Strava déjà importés (déduplication rapide, voir sync.js)
 * @property {StravaSyncSummary|null} lastSyncSummary
 */

/**
 * @returns {StravaConnectionState} état vide (déconnecté), jamais de jeton fabriqué
 */
export function createEmptyStravaState() {
  return {
    version: STRAVA_STATE_VERSION,
    connected: false,
    tokens: null,
    athlete: null,
    connectedAt: null,
    lastSyncAt: null,
    syncCursor: null,
    importedStravaIds: [],
    lastSyncSummary: null,
  };
}

/**
 * @param {any} obj
 * @returns {boolean}
 */
export function isValidStravaState(obj) {
  if (!obj || typeof obj !== "object") return false;
  return (
    typeof obj.version === "number" &&
    typeof obj.connected === "boolean" &&
    Array.isArray(obj.importedStravaIds)
  );
}

/** Types d'activités Strava considérés comme "cyclisme" par cette application
 * (voir sync.js: le filtrage). Les autres types (Run, Swim, Hike...) ne sont
 * jamais importés : les moteurs profil/progression/archétype supposent tous
 * une activité cycliste (cadence en rpm, puissance vélo...). */
export const CYCLING_SPORT_TYPES = new Set([
  "Ride",
  "VirtualRide",
  "GravelRide",
  "MountainBikeRide",
  "EBikeRide",
  "Velomobile",
  "Handcycle",
]);

/**
 * @param {string} stravaSportType - `sport_type` (ou `type` legacy) d'une SummaryActivity Strava
 * @returns {'cycling'|'mtb'|'gravel'|null} sportType du modèle Activity, ou `null` si non cycliste (à ignorer)
 */
export function mapStravaSportType(stravaSportType) {
  if (!CYCLING_SPORT_TYPES.has(stravaSportType)) return null;
  if (stravaSportType === "MountainBikeRide") return "mtb";
  if (stravaSportType === "GravelRide") return "gravel";
  return "cycling";
}
