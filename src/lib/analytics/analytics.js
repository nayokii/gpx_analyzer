/**
 * Moteur d'analyse avancée — point d'entrée unique.
 *
 * Indépendant de l'interface : prend le résultat de `computeAnalysis()`
 * (src/lib/analysis.js) — la structure déjà la plus riche disponible pour
 * une activité normalisée GPX ou FIT — et produit un résultat analytique
 * structuré, déterministe, ne fabriquant jamais de donnée absente.
 *
 *   Activity → computeAnalysis() → computeActivityAnalytics() → résultats → UI (plus tard)
 *
 * N'invente rien : chaque bloc expose son `available` (ou peut être vide/`null`)
 * quand la source ne fournit pas la donnée, conformément à la règle du projet
 * (voir types.js). Ne remplace jamais silencieusement une valeur mesurée
 * (FIT) par une valeur recalculée — les deux coexistent dans `overview.speed`
 * et `overview.distance`.
 */

import { computeOverview } from "./overview.js";
import { computePauses } from "./pauses.js";
import { computeZones } from "./zones.js";
import { detectEfforts } from "./efforts.js";
import { computeClimbs } from "./climbs.js";

function computePowerBlock(analysis) {
  if (!analysis.hasPower || !analysis.powerStats) return { available: false, source: null };
  return {
    available: true,
    source: analysis.isEstimatedPower ? "estimated" : "measured",
    avgW: analysis.powerStats.avg,
    maxW: analysis.powerStats.max,
    normalizedW: analysis.powerStats.np,
  };
}

function computeHeartRateBlock(analysis) {
  if (!analysis.hasHR || !analysis.hrStats) return { available: false };
  const values = analysis.series.map((p) => p.hr).filter((v) => v != null);
  return {
    available: true,
    avgBpm: analysis.hrStats.avg,
    maxBpm: analysis.hrStats.max,
    minBpm: values.length ? Math.min(...values) : null,
  };
}

function computeCadenceBlock(analysis) {
  if (!analysis.hasCad || !analysis.cadStats) return { available: false };
  return {
    available: true,
    avgRpm: analysis.cadStats.avg,
    maxRpm: analysis.cadStats.max,
  };
}

function computeDataAvailability(analysis, overview) {
  return {
    elevation: { available: analysis.hasEle },
    time: { available: analysis.hasTime },
    power: { available: analysis.hasPower, source: analysis.hasPower ? (analysis.isEstimatedPower ? "estimated" : "measured") : null },
    heartRate: { available: analysis.hasHR },
    cadence: { available: analysis.hasCad },
    temperature: { available: analysis.hasTemp },
    measuredDistance: { available: overview.distance.measuredKm != null },
    measuredSpeed: { available: overview.speed.avgMeasuredKmh != null || overview.speed.maxMeasuredKmh != null },
  };
}

/**
 * @param {Object} analysis - Résultat de computeAnalysis() (voir ../analysis.js)
 * @param {Object} [options]
 * @param {number} [options.ftp] - FTP en watts (zones de puissance)
 * @param {number} [options.maxHR] - FC max en bpm (zones de FC)
 * @param {{name: string, min: number, max: number}[]} [options.hrZoneBounds] - Bornes de zones FC personnalisées
 * @param {{distanceKm?: number|null, avgSpeedKmh?: number|null, maxSpeedKmh?: number|null}} [options.measured] -
 *   Totaux mesurés par le device source, s'ils sont connus de l'appelant en
 *   plus des valeurs déjà portées par `analysis.series` (voir overview.js)
 * @returns {Object} Résultat analytique structuré (voir docs du module)
 */
export function computeActivityAnalytics(analysis, options = {}) {
  const overview = computeOverview(analysis, { measured: options.measured });

  return {
    overview: {
      distance: overview.distance,
      duration: overview.duration,
    },
    speed: overview.speed,
    elevation: overview.elevation,
    temperature: overview.temperature,
    pauses: computePauses(analysis),
    power: computePowerBlock(analysis),
    heartRate: computeHeartRateBlock(analysis),
    cadence: computeCadenceBlock(analysis),
    zones: computeZones(analysis, options),
    efforts: detectEfforts(analysis),
    climbs: computeClimbs(analysis),
    dataAvailability: computeDataAvailability(analysis, overview),
  };
}
