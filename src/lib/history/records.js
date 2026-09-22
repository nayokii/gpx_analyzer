/**
 * Records / meilleures performances, contextualisés.
 *
 * On ne compare JAMAIS aveuglément toutes les activités entre elles pour une
 * métrique qui dépend fortement du contexte : une vitesse moyenne sur 10 km
 * et une vitesse moyenne sur 80 km ne sont pas comparables, une puissance
 * moyenne mesurée et une puissance estimée non plus. Les records
 * "absolus" (distance, D+, durée) sont sans ambiguïté et comparés sur tout
 * l'historique ; les records "contextuels" (vitesse, puissance) sont
 * restreints à un sous-ensemble pertinent (sorties à puissance mesurée
 * uniquement, ou groupe de sorties similaires via similarity.js).
 */

import { findSimilarActivities } from "./similarity.js";

function pickBest(activities, key, direction = "max") {
  let best = null;
  for (const a of activities) {
    const v = a[key];
    if (v == null) continue;
    if (!best || (direction === "max" ? v > best.value : v < best.value)) best = { value: v, activityId: a.id };
  }
  return best;
}

/**
 * Records absolus (comparables sans restriction) + record de puissance
 * moyenne restreint aux sorties à puissance RÉELLEMENT MESURÉE (jamais
 * mélangée avec l'estimée pour un "record").
 * @param {Array} activities - Objets Activity
 * @returns {Array<{type: string, value: number, activityId: string, context?: string}>}
 */
export function computeRecords(activities) {
  const list = activities || [];
  const records = [];

  const longestDistance = pickBest(list, "distance");
  if (longestDistance) records.push({ type: "longest_distance", value: longestDistance.value, activityId: longestDistance.activityId });

  const biggestGain = pickBest(list, "elevationGain");
  if (biggestGain) records.push({ type: "biggest_elevation_gain", value: biggestGain.value, activityId: biggestGain.activityId });

  const longestDuration = pickBest(list, "duration");
  if (longestDuration) records.push({ type: "longest_duration", value: longestDuration.value, activityId: longestDuration.activityId });

  const measuredPowerActivities = list.filter((a) => a.flags && a.flags.hasPower && !a.flags.powerEstimated);
  const bestMeasuredPower = pickBest(measuredPowerActivities, "avgPower");
  if (bestMeasuredPower) {
    records.push({
      type: "highest_avg_power_measured",
      value: bestMeasuredPower.value,
      activityId: bestMeasuredPower.activityId,
      context: `Parmi ${measuredPowerActivities.length} sortie(s) à puissance mesurée (les sorties à puissance estimée sont exclues).`,
    });
  }

  return records;
}

/**
 * Vitesse moyenne la plus élevée, mais UNIQUEMENT comparée au sein d'un
 * groupe de sorties similaires (voir similarity.js) à chaque candidate — pas
 * un classement global qui mélangerait des distances incompatibles.
 * @param {Array} activities - Objets Activity complètes (similarity.js a besoin de gpsTrack/samples pour la position de départ, sinon se rabat sur distance/D+/allure)
 * @param {Object} [options] - Transmis à findSimilarActivities (maxScore, weights, ...)
 * @returns {{type: string, value: number, activityId: string, context: string}|null}
 */
export function computeBestAvgSpeedAmongComparable(activities, options = {}) {
  const list = (activities || []).filter((a) => a.avgSpeed != null);
  let best = null;

  for (const candidate of list) {
    const comparableGroup = findSimilarActivities(candidate, list, options).map((r) => r.activity);
    comparableGroup.push(candidate);
    const localBest = pickBest(comparableGroup, "avgSpeed");
    if (localBest && (!best || localBest.value > best.value)) {
      best = { value: localBest.value, activityId: localBest.activityId, groupSize: comparableGroup.length };
    }
  }

  if (!best) return null;
  return {
    type: "highest_avg_speed_among_comparable",
    value: best.value,
    activityId: best.activityId,
    context: `Parmi un groupe de ${best.groupSize} sortie(s) de distance/D+/allure similaires (voir similarity.js) — pas comparée à l'ensemble de l'historique.`,
  };
}
