/**
 * Comparaison détaillée entre deux activités.
 *
 * Les zones (section "Zones" de la consigne) ne sont jamais persistées dans
 * `Activity` — elles sont calculées à la volée par
 * `src/lib/analytics/zones.js`. Plutôt que de rouvrir et reparser les fichiers
 * GPX/FIT source pour les recalculer, on reconstruit ici un objet
 * "analysis-like" minimal directement depuis `Activity.samples` (déjà stocké
 * dans le `<id>.json` normalisé, lu par `loadActivityDetail()`) : timestamp,
 * puissance et FC de chaque sample suffisent à `computeZones`/`computeHRZones`.
 * Si `activity.samples` est vide (résumé d'index plutôt qu'activité complète),
 * la comparaison de zones est marquée `available: false` plutôt que de
 * fabriquer un résultat.
 */

import { computeZones } from "../analytics/zones.js";

function pick(activity, key) {
  return activity && activity[key] != null ? activity[key] : null;
}

/**
 * Compare une métrique numérique entre deux activités.
 * @returns {{a: number|null, b: number|null, deltaAbs: number|null, deltaPct: number|null, available: boolean}}
 */
function compareMetric(a, b, key) {
  const va = pick(a, key), vb = pick(b, key);
  const available = va != null && vb != null;
  return {
    a: va,
    b: vb,
    deltaAbs: available ? vb - va : null,
    deltaPct: available && va !== 0 ? ((vb - va) / Math.abs(va)) * 100 : null,
    available,
  };
}

function powerSourceOf(activity) {
  if (!activity || !activity.flags || !activity.flags.hasPower) return "unavailable";
  return activity.flags.powerEstimated ? "estimated" : "measured";
}

function heartRateAvailability(activity) {
  return !!(activity && activity.flags && activity.flags.hasHeartRate);
}

function cadenceAvailability(activity) {
  return !!(activity && activity.flags && activity.flags.hasCadence);
}

/** Reconstruit un objet minimal exploitable par computeZones()/computeHRZones() depuis Activity.samples, sans jamais rouvrir le fichier source GPX/FIT. */
function activityToAnalysisLike(activity) {
  const samples = (activity && activity.samples) || [];
  let t0ms = null;
  for (const s of samples) {
    if (s.timestamp) { t0ms = new Date(s.timestamp).getTime(); break; }
  }
  const series = samples.map((s) => ({
    power: s.power != null ? s.power : null,
    hr: s.heartRate != null ? s.heartRate : null,
    elapsed: t0ms != null && s.timestamp ? (new Date(s.timestamp).getTime() - t0ms) / 1000 : null,
  }));
  return {
    series,
    hasPower: !!(activity.flags && activity.flags.hasPower),
    hasHR: !!(activity.flags && activity.flags.hasHeartRate),
    hasTime: series.some((s) => s.elapsed != null),
    isEstimatedPower: !!(activity.flags && activity.flags.powerEstimated),
  };
}

function compareZones(a, b, options) {
  const samplesA = a && a.samples, samplesB = b && b.samples;
  if (!samplesA || !samplesA.length || !samplesB || !samplesB.length) {
    return { available: false, reason: "Échantillons complets indisponibles pour au moins une des deux sorties (résumé d'index plutôt qu'activité complète)." };
  }
  if (!options.ftp && !options.maxHR) {
    return { available: false, reason: "FTP et FC max non fournies : impossible de calculer des zones." };
  }
  const zonesA = computeZones(activityToAnalysisLike(a), options);
  const zonesB = computeZones(activityToAnalysisLike(b), options);
  return { available: true, power: { a: zonesA.power, b: zonesB.power }, heartRate: { a: zonesA.heartRate, b: zonesB.heartRate } };
}

/**
 * Compare deux activités et retourne une structure exploitable par l'UI.
 * Ne compare jamais directement une puissance mesurée à une puissance
 * estimée comme si elles étaient de même nature : `dataQuality.power` indique
 * la source de chaque côté et `comparable` dit explicitement si le
 * rapprochement a un sens.
 *
 * @param {Object} a - Activity (voir types.js)
 * @param {Object} b - Activity
 * @param {Object} [options]
 * @param {number} [options.ftp] - Requis pour comparer les zones de puissance
 * @param {number} [options.maxHR] - Requis pour comparer les zones de FC
 * @returns {Object}
 */
export function compareActivities(a, b, options = {}) {
  if (!a || !b) throw new Error("compareActivities nécessite deux activités.");

  const general = {
    distanceKm: compareMetric(a, b, "distance"),
    durationSec: compareMetric(a, b, "duration"),
    movingTimeSec: compareMetric(a, b, "movingTime"),
    elevationGainM: compareMetric(a, b, "elevationGain"),
    elevationLossM: compareMetric(a, b, "elevationLoss"),
  };

  const performance = {
    avgSpeedKmh: compareMetric(a, b, "avgSpeed"),
    maxSpeedKmh: compareMetric(a, b, "maxSpeed"),
    avgPowerW: compareMetric(a, b, "avgPower"),
    maxPowerW: compareMetric(a, b, "maxPower"),
    avgHeartRateBpm: compareMetric(a, b, "avgHeartRate"),
    maxHeartRateBpm: compareMetric(a, b, "maxHeartRate"),
    avgCadenceRpm: compareMetric(a, b, "avgCadence"),
    maxCadenceRpm: compareMetric(a, b, "maxCadence"),
  };

  const powerSourceA = powerSourceOf(a), powerSourceB = powerSourceOf(b);

  const dataQuality = {
    power: {
      a: powerSourceA,
      b: powerSourceB,
      comparable: powerSourceA !== "unavailable" && powerSourceA === powerSourceB,
    },
    heartRate: { a: heartRateAvailability(a), b: heartRateAvailability(b) },
    cadence: { a: cadenceAvailability(a), b: cadenceAvailability(b) },
  };

  return {
    activityIds: { a: a.id, b: b.id },
    general,
    performance,
    zones: compareZones(a, b, options),
    dataQuality,
  };
}
