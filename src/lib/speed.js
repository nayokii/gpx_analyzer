/**
 * Règle UNIQUE de calcul de la vitesse moyenne d'une activité.
 *
 * Deux métriques distinctes, jamais mélangées :
 *   - vitesse moyenne EN MOUVEMENT  = distance / temps en mouvement (timer
 *     du device quand il existe, sinon temps calculé hors arrêts). C'est la
 *     valeur affichée partout comme "Vitesse moy." (feed, détails, dashboard,
 *     exports PNG) — elle se lit sur `Activity.avgSpeed` / `analysis.avgSpeedKmh`.
 *   - vitesse moyenne SUR LA DURÉE ÉCOULÉE = distance / temps écoulé (pauses
 *     incluses). Exposée à part (`avgSpeedElapsedKmh`), jamais affichée à la
 *     place de la précédente.
 *
 * Source de la vitesse en mouvement, par ordre de priorité :
 *   1. "device"  : la vitesse moyenne enregistrée dans la session FIT
 *      (`session.avg_speed`, m/s → km/h), si elle est plausible ET cohérente
 *      avec distance / timer du même fichier (±10 %). Vérifié sur un FIT
 *      iGPSPORT : avg_speed == total_distance / total_timer_time.
 *   2. "derived" : distance / temps en mouvement. Distance et temps viennent
 *      du même jeu de données (session FIT si présente, sinon points).
 *   Pour un GPX il n'existe pas de valeur officielle : la source est toujours
 *   "derived" (distance Haversine / temps en mouvement hors arrêts).
 */

/** Version de la règle de calcul, stockée sur chaque Activity ; l'incrémenter relance la migration (voir storage/speedMigration.js). */
export const SPEED_MODEL_VERSION = 2;
/** Au-delà, une vitesse moyenne vélo est considérée comme invalide (unité erronée, donnée corrompue). */
export const MAX_PLAUSIBLE_AVG_KMH = 120;
/** Écart relatif toléré entre la vitesse enregistrée par le device et distance / timer. */
export const DEVICE_CONSISTENCY_TOLERANCE = 0.1;

const isPositive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** m/s → km/h ; `null` si la valeur n'est pas un nombre fini. */
export function msToKmh(ms) {
  return typeof ms === "number" && Number.isFinite(ms) ? ms * 3.6 : null;
}

/**
 * distance (km) / durée (s) → km/h. `null` si l'une des deux est absente,
 * non finie, ou si la durée / la distance n'est pas strictement positive.
 */
export function speedFromDistanceTime(distanceKm, seconds) {
  if (!isPositive(distanceKm) || !isPositive(seconds)) return null;
  return distanceKm / (seconds / 3600);
}

/**
 * Valide une vitesse moyenne enregistrée par un device (km/h).
 * @returns {number|null} la valeur si plausible, sinon `null`
 */
export function sanitizeDeviceAvgKmh(kmh) {
  return isPositive(kmh) && kmh <= MAX_PLAUSIBLE_AVG_KMH ? kmh : null;
}

/**
 * @param {Object} p
 * @param {number|null} p.distanceKm - distance de référence (session FIT si dispo, sinon calculée)
 * @param {number|null} p.movingTimeSec - temps en mouvement de référence
 * @param {number|null} [p.elapsedSec] - temps écoulé (pauses incluses)
 * @param {number|null} [p.deviceAvgKmh] - vitesse moyenne enregistrée par le device (km/h), si présente
 * @returns {{avgSpeedKmh: number|null, avgSpeedElapsedKmh: number|null, source: 'device'|'derived'|null}}
 */
export function resolveAverageSpeed({ distanceKm, movingTimeSec, elapsedSec = null, deviceAvgKmh = null }) {
  const derived = speedFromDistanceTime(distanceKm, movingTimeSec);
  const avgSpeedElapsedKmh = speedFromDistanceTime(distanceKm, elapsedSec);

  const device = sanitizeDeviceAvgKmh(deviceAvgKmh);
  if (device != null) {
    const consistent = derived == null || Math.abs(device - derived) / derived <= DEVICE_CONSISTENCY_TOLERANCE;
    if (consistent) return { avgSpeedKmh: device, avgSpeedElapsedKmh, source: "device" };
  }
  if (derived != null) return { avgSpeedKmh: derived, avgSpeedElapsedKmh, source: "derived" };
  return { avgSpeedKmh: null, avgSpeedElapsedKmh, source: null };
}

/**
 * Temps en mouvement à retenir quand le device en fournit un (timer FIT).
 * Accepté seulement s'il est > 0 et ne dépasse pas le temps écoulé (tolérance
 * de 2 % + 5 s pour les écarts de bornes entre session et records).
 * @returns {number|null}
 */
export function sanitizeDeviceMovingSec(movingSec, elapsedSec) {
  if (!isPositive(movingSec)) return null;
  if (isPositive(elapsedSec) && movingSec > elapsedSec * 1.02 + 5) return null;
  return movingSec;
}

/**
 * Vitesse moyenne à afficher pour une activité déjà normalisée / un résumé
 * d'index. Point d'entrée unique pour les composants : relit la valeur
 * stockée (déjà résolue par `resolveAverageSpeed` à l'import) et la rejette
 * si elle est invalide. Ne recalcule jamais à partir d'une autre durée.
 * @returns {number|null}
 */
export function displayAvgSpeedKmh(activity) {
  const v = activity ? activity.avgSpeed : null;
  return isPositive(v) && v <= MAX_PLAUSIBLE_AVG_KMH ? v : null;
}
