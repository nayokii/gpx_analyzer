/**
 * Coach V2 — compare la dernière sortie aux sorties récentes.
 *
 * Ne recalcule rien : prend directement les résumés déjà produits par
 * `summarizeRide()` (context.js) — eux-mêmes de simples recopies de champs
 * `Activity` déjà calculés — et n'ajoute qu'une moyenne arithmétique et un
 * écart en % (voir `utils.js: avg()`), aucun nouvel algorithme.
 */

import { avg } from "../utils.js";

/**
 * @param {number|null} current
 * @param {number|null} baseline
 * @returns {number|null} écart en % (positif = au-dessus de la moyenne récente), `null` si non calculable
 */
function deltaPct(current, baseline) {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

function compareMetric(rides, key, lastValue) {
  const values = rides.map((r) => r[key]).filter((v) => v != null);
  const baseline = values.length ? avg(values) : null;
  return { lastValue, avgOfOthers: baseline, deltaPct: deltaPct(lastValue, baseline), sampleSize: values.length };
}

/**
 * @param {Array} recentRides - voir context.js: buildCoachContext() — le plus récent en premier (recentRides[0] = dernière sortie)
 * @returns {{available: boolean, reason?: string, sampleSize?: number, distance?: Object, duration?: Object, avgSpeed?: Object, elevationGain?: Object}}
 */
export function compareLastRideToRecent(recentRides) {
  const list = Array.isArray(recentRides) ? recentRides : [];
  if (list.length === 0) return { available: false, reason: "no_last_ride" };

  const [last, ...others] = list;
  if (others.length === 0) return { available: false, reason: "insufficient_history", sampleSize: 0 };

  return {
    available: true,
    sampleSize: others.length,
    distance: compareMetric(others, "distanceKm", last.distanceKm),
    duration: compareMetric(others, "durationSec", last.durationSec),
    avgSpeed: compareMetric(others, "avgSpeedKmh", last.avgSpeedKmh),
    elevationGain: compareMetric(others, "elevationGainM", last.elevationGainM),
  };
}
