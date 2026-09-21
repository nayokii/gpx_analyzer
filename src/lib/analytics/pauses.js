/**
 * Détection et agrégation des pauses/arrêts d'une activité.
 *
 * Réutilise la détection déjà en place dans analysis.js (`analysis.stops`,
 * seuil 2.2 km/h maintenu au moins 20 s) plutôt que de la refaire : elle
 * filtre déjà les micro-ralentissements GPS. Ce module se contente d'adapter
 * la forme (timestamps réels plutôt qu'index) et d'ajouter les agrégats.
 */

import { avg } from "../utils.js";

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @returns {{
 *   available: boolean,
 *   count: number,
 *   totalSec: number|null,
 *   avgSec: number|null,
 *   longestSec: number|null,
 *   list: {startTime: Date|null, endTime: Date|null, durationSec: number}[]
 * }}
 */
export function computePauses(analysis) {
  if (!analysis.hasTime) {
    return { available: false, count: 0, totalSec: null, avgSec: null, longestSec: null, list: [] };
  }

  const list = (analysis.stops || []).map((s) => ({
    startTime: analysis.series[s.startIdx].time || null,
    endTime: analysis.series[s.endIdx].time || null,
    durationSec: s.duration,
  }));

  const durations = list.map((p) => p.durationSec);

  return {
    available: true,
    count: list.length,
    totalSec: analysis.stoppedTimeSec,
    avgSec: list.length ? avg(durations) : null,
    longestSec: list.length ? Math.max(...durations) : null,
    list,
  };
}
