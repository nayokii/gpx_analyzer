/**
 * Dérive, pour une `Activity` déjà chargée (voir types.js), les signaux dont
 * les dimensions du profil ont besoin (montées détectées, efforts détectés,
 * meilleurs efforts de puissance) — SANS jamais rouvrir/reparser le fichier
 * GPX/FIT source.
 *
 * Principe : `Activity.samples` contient déjà tout ce qu'exige
 * `computeAnalysis()` (lat/lon/ele/time/hr/cad/power, voir ../analysis.js).
 * On reconstruit donc des "points" à partir des samples déjà normalisés et on
 * relance le même moteur d'analyse que celui utilisé à l'import — c'est
 * exactement ce que fait déjà `history/comparisons.js` (en plus léger) pour
 * recalculer des zones sans reparser. Aucune nouvelle estimation de
 * puissance n'est produite ici : si `samples[].power` provient du modèle
 * physique (activity.flags.powerEstimated === true), ces valeurs sont
 * réutilisées telles quelles (computeAnalysis ne réestime que si `power` est
 * totalement absent des points fournis).
 *
 * Dégradation : si une activité n'a pas de `samples` (résumé léger de
 * l'index, voir storage/activityStore.js), les signaux dérivés (montées,
 * efforts) sont simplement vides — les agrégats déjà présents au niveau de
 * l'activité (distance, durée, D+, vitesse, puissance moyenne) restent
 * disponibles pour les dimensions qui peuvent s'en contenter.
 */

import { computeAnalysis } from "../analysis.js";
import { computeClimbs } from "../analytics/climbs.js";
import { detectEfforts } from "../analytics/efforts.js";
import { computeBestPowerEfforts } from "../power.js";
import { coefficientOfVariation, stdDev } from "../utils.js";

/**
 * @param {import('../types.js').Activity} activity
 * @returns {Array} points exploitables par computeAnalysis()
 */
function samplesToPoints(activity) {
  return (activity.samples || []).map((s) => ({
    lat: s.latitude,
    lon: s.longitude,
    ele: s.altitude,
    time: s.timestamp ? new Date(s.timestamp) : null,
    hr: s.heartRate,
    cad: s.cadence,
    power: s.power,
    temp: s.temperature,
    distanceMeasured: s.distanceMeasured,
    speedMeasured: s.speedMeasured,
  }));
}

/**
 * @param {import('../types.js').Activity} activity
 * @returns {"measured"|"estimated"|"none"} source de la puissance de CETTE activité, telle que déjà établie à l'import (jamais redérivée ici)
 */
function powerSourceOf(activity) {
  if (!activity.flags || !activity.flags.hasPower) return "none";
  return activity.flags.powerEstimated ? "estimated" : "measured";
}

/**
 * @param {import('../types.js').Activity} activity - activité complète ou résumé léger d'index
 * @returns {{
 *   activityId: string,
 *   date: string|null,
 *   sportType: string,
 *   distanceKm: number|null,
 *   durationSec: number|null,
 *   movingTimeSec: number|null,
 *   elevationGainM: number|null,
 *   avgSpeedKmh: number|null,
 *   avgPowerW: number|null,
 *   normalizedPowerW: number|null,
 *   powerSource: "measured"|"estimated"|"none",
 *   hasSamples: boolean,
 *   climbs: Array,
 *   efforts: Array,
 *   bestPowerEfforts: Object|null,
 * }}
 */
export function deriveActivitySignals(activity) {
  const powerSource = powerSourceOf(activity);
  const hasSamples = !!(activity.samples && activity.samples.length > 0);

  const base = {
    activityId: activity.id,
    date: activity.date ?? null,
    sportType: activity.sportType ?? "cycling",
    distanceKm: activity.distance ?? null,
    durationSec: activity.duration ?? null,
    movingTimeSec: activity.movingTime ?? null,
    elevationGainM: activity.elevationGain ?? null,
    avgSpeedKmh: activity.avgSpeed ?? null,
    avgPowerW: activity.avgPower ?? null,
    normalizedPowerW: activity.normalizedPower ?? null,
    powerSource,
    hasSamples,
    effortsAnalyzed: false, // true seulement si detectEfforts() a effectivement pu tourner (voir plus bas) — un tableau vide AVANT ce flag ne veut rien dire (donnée manquante, pas "zéro effort")
    climbs: [],
    efforts: [],
    bestPowerEfforts: null,
    bestEfforts: null, // meilleurs efforts par distance (k1/k5/k10/k20) — durée/vitesse, jamais de puissance (voir analysis.js: computeBestEfforts)
    speedVariability: null, // coefficient de variation de la vitesse en mouvement — signal d'exposition pour dimensions/technical.js, PAS une mesure de compétence
    gradeVariability: null, // écart-type de la pente locale — idem
  };

  if (!hasSamples) return base;

  const points = samplesToPoints(activity).filter((p) => p.lat != null && p.lon != null);
  if (points.length < 2) return base; // pas assez de points exploitables : dégrade sans erreur

  let analysis;
  try {
    analysis = computeAnalysis(points);
  } catch {
    return base; // série corrompue : on ne fait jamais planter le profil pour une activité
  }

  base.climbs = computeClimbs(analysis).map((c) => ({
    ...c,
    powerSource: c.avgPowerW != null ? powerSource : "none",
  }));

  base.efforts = detectEfforts(analysis).map((e) => ({
    ...e,
    powerSource: e.avgPowerW != null ? powerSource : "none",
  }));
  base.effortsAnalyzed = !!analysis.hasTime;
  base.bestEfforts = analysis.bestEfforts || null;

  if (analysis.hasTime) {
    const movingSpeeds = analysis.series.filter((p) => p.speed != null && p.speed > 2).map((p) => p.speed);
    base.speedVariability = movingSpeeds.length >= 5 ? coefficientOfVariation(movingSpeeds) : null;
  }
  if (analysis.hasEle) {
    const grades = analysis.series.map((p) => p.grade).filter((g) => g != null);
    base.gradeVariability = grades.length >= 5 ? stdDev(grades) : null;
  }

  // Les meilleurs efforts de puissance (sprint) n'ont de sens que sur de la
  // puissance MESURÉE — jamais calculés sur de l'estimée (voir consigne §10 et dimensions/sprint.js).
  if (powerSource === "measured" && analysis.hasPower && analysis.hasTime) {
    base.bestPowerEfforts = computeBestPowerEfforts(analysis.series, [5, 30, 60, 300, 1200]);
  }

  return base;
}

/**
 * @param {import('../types.js').Activity[]} activities
 * @returns {Array} signaux dérivés, un par activité, même ordre que l'entrée
 */
export function deriveAllActivitySignals(activities) {
  return (activities || []).map(deriveActivitySignals);
}
