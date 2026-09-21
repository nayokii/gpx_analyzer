/**
 * Vue d'ensemble d'une activité : distance, durée, vitesse, altitude, température.
 *
 * Prend en entrée le résultat de `computeAnalysis()` (voir ../analysis.js) —
 * jamais les points bruts : toutes les valeurs calculées (distance, vitesse,
 * dénivelé...) existent déjà dans `analysis`, ce module ne fait qu'assembler
 * et compléter (ex. vitesse moyenne "totale", absente de analysis.js).
 *
 * Règle absolue du projet (voir types.js) : mesuré et calculé ne se
 * substituent jamais l'un à l'autre. Les valeurs mesurées par le device
 * source (FIT) sont dérivées ici des champs `distanceMeasured`/`speedMeasured`
 * déjà propagés par point dans `analysis.series` (voir analysis.js), sauf si
 * l'appelant fournit explicitement des totaux mesurés plus autoritaires (ex.
 * `session.total_distance` du FIT, via `options.measured`).
 */

import { avg } from "../utils.js";

/**
 * @param {Array} series - analysis.series
 * @param {"distanceMeasured"|"speedMeasured"} key
 * @returns {number[]} valeurs mesurées non nulles, dans l'ordre de la série
 */
function measuredValues(series, key) {
  return series.map((p) => p[key]).filter((v) => v != null);
}

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @param {Object} [options]
 * @param {{distanceKm?: number|null, avgSpeedKmh?: number|null, maxSpeedKmh?: number|null}} [options.measured] -
 *   Totaux mesurés par le device source, quand connus de l'appelant (ex.
 *   `Activity.distanceMeasured`/`avgSpeedMeasured`/`maxSpeedMeasured` issus de
 *   la session FIT). Prioritaires sur la dérivation depuis `analysis.series`.
 * @returns {{distance: Object, duration: Object, speed: Object, elevation: Object, temperature: Object}}
 */
export function computeOverview(analysis, options = {}) {
  const { series, hasTime, hasEle, hasTemp } = analysis;
  const measuredOverride = options.measured || {};

  const measuredDistanceVals = measuredValues(series, "distanceMeasured");
  const measuredSpeedVals = measuredValues(series, "speedMeasured");

  const distanceMeasuredKm =
    measuredOverride.distanceKm != null
      ? measuredOverride.distanceKm
      : measuredDistanceVals.length
      ? measuredDistanceVals[measuredDistanceVals.length - 1]
      : null;

  const avgSpeedMeasuredKmh =
    measuredOverride.avgSpeedKmh != null ? measuredOverride.avgSpeedKmh : avg(measuredSpeedVals);

  const maxSpeedMeasuredKmh =
    measuredOverride.maxSpeedKmh != null
      ? measuredOverride.maxSpeedKmh
      : measuredSpeedVals.length
      ? Math.max(...measuredSpeedVals)
      : null;

  // Vitesse moyenne "totale" (distance / temps total, arrêts inclus) — distincte
  // de analysis.avgSpeedKmh qui est déjà une moyenne en temps de mouvement.
  const avgSpeedTotalKmh =
    hasTime && analysis.totalTimeSec > 0 ? analysis.totalDistanceKm / (analysis.totalTimeSec / 3600) : null;

  return {
    distance: {
      calculatedKm: analysis.totalDistanceKm,
      measuredKm: distanceMeasuredKm,
    },
    duration: {
      totalSec: hasTime ? analysis.totalTimeSec : null,
      movingSec: hasTime ? analysis.movingTimeSec : null,
      stoppedSec: hasTime ? analysis.stoppedTimeSec : null,
    },
    speed: {
      avgMovingKmh: analysis.avgSpeedKmh,
      avgTotalKmh: avgSpeedTotalKmh,
      maxKmh: analysis.maxSpeedKmh,
      avgMeasuredKmh: avgSpeedMeasuredKmh,
      maxMeasuredKmh: maxSpeedMeasuredKmh,
    },
    elevation: {
      available: hasEle,
      gainM: hasEle ? analysis.elevGain : null,
      lossM: hasEle ? analysis.elevLoss : null,
      minM: hasEle ? analysis.minEle : null,
      maxM: hasEle ? analysis.maxEle : null,
    },
    temperature: {
      available: hasTemp,
      avgC: hasTemp ? analysis.tempStats.avg : null,
      minC: hasTemp ? analysis.tempStats.min : null,
      maxC: hasTemp ? analysis.tempStats.max : null,
    },
  };
}
