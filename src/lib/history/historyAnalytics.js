/**
 * Agrégation historique sur un ensemble d'activités.
 *
 * IMPORTANT (audité avant d'écrire ce module) : `index.json`
 * (activityStore.js) ne stocke qu'un résumé léger de chaque activité
 * (`id, name, date, sportType, distance, duration, elevationGain, avgSpeed,
 * avgHeartRate, flags, source, files`) — pas `movingTime`, `elevationLoss`,
 * `avgPower`, `avgCadence`, ni les champs mesurés (`distanceMeasured`, etc.).
 * Ce module accepte des objets `Activity` (voir types.js) et dégrade
 * proprement (métrique ignorée, jamais mise à 0) quand un champ est absent —
 * ce qui permet de l'utiliser aussi bien avec les résumés de l'index (moins
 * complet) qu'avec les activités complètes rechargées via
 * `loadActivityDetail()`. Recharger l'activité complète lit le fichier
 * `<id>.json` déjà normalisé sur disque : ce n'est PAS un reparsing du GPX/FIT
 * source (celui-ci n'est jamais rouvert par ce module).
 */

import { parseActivityDate, periodRange, isWithinPeriod } from "./dateUtils.js";

/**
 * Filtre une liste d'activités sur une période donnée (voir periodRange).
 * @param {Array} activities
 * @param {"7d"|"30d"|"90d"|"year"|"all"|{from?, to?}} period
 * @param {Date} [referenceDate]
 * @returns {Array} sous-ensemble de `activities` (nouvel tableau, jamais muté)
 */
export function filterActivitiesByPeriod(activities, period, referenceDate) {
  const { from, to } = periodRange(period, referenceDate);
  if (from == null && to == null) return activities.slice();
  return activities.filter((a) => isWithinPeriod(parseActivityDate(a), { from, to }));
}

function sum(values) {
  return values.reduce((s, v) => s + v, 0);
}

function numericValues(activities, key) {
  return activities.map((a) => a[key]).filter((v) => v != null);
}

/**
 * Vitesse moyenne globale, pondérée par le temps en mouvement plutôt que par
 * une moyenne simple des vitesses moyennes de chaque sortie (qui donnerait un
 * poids égal à une sortie de 10 minutes et à une sortie de 5 heures).
 * Restreinte aux activités qui ont à la fois `distance` et `movingTime` pour
 * que numérateur et dénominateur portent sur le même sous-ensemble.
 */
function weightedAvgSpeedKmh(activities) {
  const eligible = activities.filter((a) => a.distance != null && a.movingTime != null && a.movingTime > 0);
  if (eligible.length === 0) return null;
  const totalKm = sum(eligible.map((a) => a.distance));
  const totalHours = sum(eligible.map((a) => a.movingTime)) / 3600;
  return totalHours > 0 ? totalKm / totalHours : null;
}

/**
 * Puissance moyenne globale, pondérée par la durée de chaque sortie (une
 * sortie de 5 h pèse plus qu'un test de 20 min dans la moyenne). Approximation
 * documentée : on pondère la puissance moyenne DE CHAQUE SORTIE par sa durée,
 * on ne recalcule pas une moyenne watt-par-watt sur tous les échantillons de
 * tout l'historique (ce qui nécessiterait de recharger les `samples` de
 * chaque activité, coûteux et hors de propos pour un agrégat historique).
 */
function weightedAvgPowerW(activities) {
  const eligible = activities.filter((a) => a.avgPower != null && (a.movingTime || a.duration));
  if (eligible.length === 0) return null;
  let weightedSum = 0, weightSum = 0;
  for (const a of eligible) {
    const w = a.movingTime || a.duration;
    weightedSum += a.avgPower * w;
    weightSum += w;
  }
  return weightSum > 0 ? weightedSum / weightSum : null; // garde-fou division par zéro
}

/**
 * @param {Array} activities - Objets Activity (idéalement complets, voir note en tête de fichier)
 * @param {Object} [options]
 * @param {"7d"|"30d"|"90d"|"year"|"all"|{from?, to?}} [options.period] - Filtre de période (défaut : toutes)
 * @param {Date} [options.referenceDate] - "Maintenant" pour le calcul de période (tests)
 * @returns {Object} Agrégats historiques structurés
 */
export function computeHistoryAnalytics(activities, options = {}) {
  const source = activities || [];
  const period = options.period ?? "all";
  const list = filterActivitiesByPeriod(source, period, options.referenceDate);
  const { from, to } = periodRange(period, options.referenceDate);

  const count = list.length;

  const distances = numericValues(list, "distance");
  const durations = numericValues(list, "duration");
  const movingTimes = numericValues(list, "movingTime");
  const gains = numericValues(list, "elevationGain");
  const losses = numericValues(list, "elevationLoss");

  const totals = {
    distanceKm: distances.length ? sum(distances) : 0,
    durationSec: durations.length ? sum(durations) : null,
    movingTimeSec: movingTimes.length ? sum(movingTimes) : null,
    elevationGainM: gains.length ? sum(gains) : null,
    elevationLossM: losses.length ? sum(losses) : null,
  };

  const averages = {
    speedKmh: weightedAvgSpeedKmh(list),
    powerW: weightedAvgPowerW(list),
    method: "Vitesse pondérée par le temps en mouvement (distance totale / temps en mouvement total) ; puissance pondérée par la durée de chaque sortie — jamais une moyenne simple des moyennes par sortie.",
  };

  const sensorCoverage = {
    withHeartRate: list.filter((a) => a.flags && a.flags.hasHeartRate).length,
    withCadence: list.filter((a) => a.flags && a.flags.hasCadence).length,
    withRealPower: list.filter((a) => a.flags && a.flags.hasPower && !a.flags.powerEstimated).length,
    withEstimatedPower: list.filter((a) => a.flags && a.flags.hasPower && a.flags.powerEstimated).length,
  };

  return {
    period: { key: typeof period === "string" ? period : "custom", from: from ? from.toISOString() : null, to: to ? to.toISOString() : null },
    count,
    totals,
    averages,
    sensorCoverage,
    // Section "volume" (même chiffres, cadrage explicite demandé par la consigne) :
    volume: {
      count,
      distanceKm: totals.distanceKm,
      durationSec: totals.durationSec,
      elevationGainM: totals.elevationGainM,
    },
  };
}
