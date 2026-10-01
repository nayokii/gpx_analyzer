/**
 * Coach V2 — détail enrichi d'UNE sortie (montées, efforts, arrêts détaillés).
 *
 * Ces trois blocs n'existent nulle part comme champ résumé de `Activity`
 * (voir types.js) : contrairement à distance/durée/vitesse/D+/FC/cadence/
 * puissance (déjà couverts par `summarizeRide()` dans context.js sans le
 * moindre recalcul), la détection de montées, d'efforts et d'arrêts
 * individuels n'existe QUE via le pipeline `computeAnalysis()` +
 * `computeActivityAnalytics()` (analysis.js / analytics/*), qui a besoin des
 * points de la sortie.
 *
 * Ce module ne réimplémente RIEN de cette détection : il se contente de
 * reformer les points attendus par `computeAnalysis()` à partir de
 * `activity.samples`, qui sont déjà entièrement PARSÉS et déjà stockés (pas
 * une nouvelle lecture de fichier, pas un nouveau parsing GPX/FIT), puis
 * appelle les mêmes fonctions que la vue "Performance"/"Analytique"
 * (climbs.js: computeClimbs, efforts.js: detectEfforts, pauses.js:
 * computePauses, profile/dimensions/climbing.js: vamOf).
 *
 * Important : `activity.samples[].power` porte déjà la puissance mesurée OU
 * précédemment estimée (voir normalize.js) — recalculer `computeAnalysis()`
 * dessus ne RE-estime jamais une deuxième fois (analysis.js ne déclenche
 * l'estimation que si aucune puissance n'est présente du tout), donc aucune
 * incohérence avec `activity.avgPower`/`flags.powerEstimated` déjà exposés
 * par `summarizeRide()`. Ce module n'expose d'ailleurs jamais de nouvelle
 * moyenne globale de puissance : uniquement des agrégats PAR montée/effort,
 * qui n'existent pas ailleurs.
 *
 * Lecture seule, aucune écriture, aucune donnée fabriquée : un bloc
 * indisponible (pas assez d'échantillons, pas d'horodatage...) est signalé
 * explicitement via `available: false`, jamais par une liste vide silencieuse
 * qui se confondrait avec "aucune montée détectée".
 */

import { computeAnalysis } from "../analysis.js";
import { computeClimbs } from "../analytics/climbs.js";
import { detectEfforts } from "../analytics/efforts.js";
import { computePauses } from "../analytics/pauses.js";
import { vamOf } from "../profile/dimensions/climbing.js";

/**
 * Reconstruit les points `{lat, lon, ele, time, hr, cad, power, temp}`
 * attendus par `computeAnalysis()` à partir de `activity.samples` (déjà
 * normalisés — voir types.js: ActivitySample). Pur renommage de champs,
 * aucun calcul.
 * @param {import('../types.js').Activity} activity
 * @returns {Array}
 */
function samplesToAnalysisPoints(activity) {
  const samples = Array.isArray(activity.samples) ? activity.samples : [];
  return samples.map((s) => ({
    lat: s.latitude,
    lon: s.longitude,
    ele: s.altitude,
    time: s.timestamp ? new Date(s.timestamp) : null,
    hr: s.heartRate,
    cad: s.cadence,
    power: s.power,
    temp: s.temperature,
  }));
}

function summarizeClimb(rawClimb) {
  return {
    name: rawClimb.name,
    distanceKm: rawClimb.distanceM / 1000,
    gainM: rawClimb.gainM,
    avgGradePct: rawClimb.avgGrade,
    maxGradePct: rawClimb.maxGrade,
    durationSec: rawClimb.durationSec,
    avgSpeedKmh: rawClimb.avgSpeedKmh,
    vamMh: vamOf(rawClimb),
    power: rawClimb.avgPowerW != null ? { avgW: rawClimb.avgPowerW } : null,
    avgHeartRateBpm: rawClimb.avgHeartRateBpm,
  };
}

function summarizeEffort(rawEffort) {
  return {
    durationSec: rawEffort.durationSec,
    distanceKm: rawEffort.distanceM / 1000,
    avgSpeedKmh: rawEffort.avgSpeedKmh,
    maxSpeedKmh: rawEffort.maxSpeedKmh,
    power: rawEffort.avgPowerW != null ? { avgW: rawEffort.avgPowerW, maxW: rawEffort.maxPowerW } : null,
    avgHeartRateBpm: rawEffort.avgHeartRateBpm,
  };
}

/**
 * @param {import('../types.js').Activity} activity - doit porter `samples` (voir loadActivityDetail)
 * @returns {{
 *   available: boolean,
 *   reason?: string,
 *   climbs?: {count: number, list: Array},
 *   efforts?: {count: number, list: Array},
 *   pauses?: {available: boolean, count: number, totalSec: number|null, avgSec: number|null, longestSec: number|null}
 * }}
 */
export function buildRideDetail(activity) {
  if (!activity) return { available: false, reason: "no_activity" };

  const points = samplesToAnalysisPoints(activity);
  if (points.length < 2) {
    return { available: false, reason: "insufficient_samples" };
  }

  // `userSettings: null` — jamais d'estimation ici : `points[].power` porte déjà
  // la valeur mesurée/estimée persistée (voir docstring du fichier), donc
  // `hasPower` est déjà vrai si applicable et analysis.js ne ré-estime rien.
  const analysis = computeAnalysis(points, null);

  const climbs = computeClimbs(analysis).map(summarizeClimb);
  const efforts = detectEfforts(analysis).map(summarizeEffort);
  const pauses = computePauses(analysis);

  return {
    available: true,
    climbs: { count: climbs.length, list: climbs },
    efforts: { count: efforts.length, list: efforts },
    pauses: {
      available: pauses.available,
      count: pauses.count,
      totalSec: pauses.totalSec,
      avgSec: pauses.avgSec,
      longestSec: pauses.longestSec,
    },
  };
}
