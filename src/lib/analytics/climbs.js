/**
 * Montées détectées — adapte `analysis.climbs` (analysis.js) au format de
 * sortie du moteur analytique, sans réimplémenter la détection.
 *
 * La détection elle-même (analysis.js: detectClimbs) est déjà robuste :
 * altitude lissée (fenêtre 7 points) avant toute détection de pente, seuils
 * pente ≥ 2.5 %, dénivelé ≥ 25 m, longueur ≥ 300 m, fusion des segments
 * proches (< 150 m) — ce qui filtre déjà le bruit GPS/altitude et les
 * micro-variations. Fonctionne indifféremment sur des points issus de GPX ou
 * de FIT puisqu'elle n'opère que sur `analysis.series`/`analysis.dist`.
 */

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @returns {Array<{
 *   id: number,
 *   name: string,
 *   startTime: Date|null,
 *   endTime: Date|null,
 *   durationSec: number|null,
 *   distanceM: number,
 *   gainM: number,
 *   avgGrade: number,
 *   maxGrade: number,
 *   avgSpeedKmh: number|null,
 *   avgPowerW: number|null,
 *   avgHeartRateBpm: number|null,
 * }>}
 */
export function computeClimbs(analysis) {
  return (analysis.climbs || []).map((c) => ({
    id: c.id,
    name: c.name,
    startTime: analysis.series[c.startIdx].time || null,
    endTime: analysis.series[c.endIdx].time || null,
    durationSec: c.duration,
    distanceM: c.lengthKm * 1000,
    gainM: c.gain,
    avgGrade: c.avgGrade,
    maxGrade: c.maxGrade,
    avgSpeedKmh: c.avgSpeed,
    avgPowerW: c.avgPower != null ? c.avgPower : null,
    avgHeartRateBpm: c.avgHR != null ? c.avgHR : null,
  }));
}
