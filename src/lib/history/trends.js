/**
 * Séries temporelles et tendances de progression.
 *
 * Les séries sont regroupées par jour/semaine/mois CALENDAIRE LOCAL (voir
 * dateUtils.js pour le choix et sa limite documentée concernant le fuseau
 * horaire). Les tendances (`computeTrend`) ne déclarent jamais de conclusion
 * ("tu progresses") : elles renvoient les points ordonnés dans le temps et
 * une direction statistique, à charge de l'UI de les présenter.
 */

import { avg } from "../utils.js";
import { parseActivityDate, localDayKey, localWeekKey, localMonthKey } from "./dateUtils.js";

const BUCKET_KEY_FNS = { day: localDayKey, week: localWeekKey, month: localMonthKey };

/**
 * Regroupe les activités par jour/semaine/mois calendaire local et agrège
 * distance/durée/temps en mouvement/D+/nombre de sorties par bucket.
 * Permet de dériver "distance par jour/semaine/mois", "D+ par semaine",
 * "temps de selle par semaine", "nombre de sorties par semaine" (mêmes
 * champs, seul le regroupement change).
 *
 * @param {Array} activities - Objets Activity avec `date` (voir types.js)
 * @param {Object} [options]
 * @param {"day"|"week"|"month"} [options.bucket="day"]
 * @returns {Array<{key: string, count: number, distanceKm: number, durationSec: number, movingTimeSec: number, elevationGainM: number}>}
 *   Trié chronologiquement par `key`. Un bucket n'apparaît que s'il contient au moins une activité datée.
 */
export function buildTimeSeries(activities, { bucket = "day" } = {}) {
  const keyFn = BUCKET_KEY_FNS[bucket];
  if (!keyFn) throw new Error(`Regroupement inconnu : ${bucket} (attendu "day", "week" ou "month")`);

  const map = new Map();
  for (const a of activities || []) {
    const date = parseActivityDate(a);
    if (!date) continue; // pas d'horodatage exploitable : exclu de la série, jamais placé arbitrairement
    const key = keyFn(date);
    if (!map.has(key)) {
      map.set(key, { key, count: 0, distanceKm: 0, durationSec: 0, movingTimeSec: 0, elevationGainM: 0 });
    }
    const entry = map.get(key);
    entry.count += 1;
    if (a.distance != null) entry.distanceKm += a.distance;
    if (a.duration != null) entry.durationSec += a.duration;
    if (a.movingTime != null) entry.movingTimeSec += a.movingTime;
    if (a.elevationGain != null) entry.elevationGainM += a.elevationGain;
  }

  return [...map.values()].sort((x, y) => x.key.localeCompare(y.key));
}

/** Accesseurs des métriques suivies pour la tendance (section 10 de la consigne). */
const TREND_METRIC_GETTERS = {
  distance: (a) => a.distance,
  avgSpeed: (a) => a.avgSpeed,
  elevationGain: (a) => a.elevationGain,
  avgPower: (a) => a.avgPower,
  duration: (a) => a.duration,
};

export const TREND_METRICS = Object.keys(TREND_METRIC_GETTERS);

const DEFAULT_MIN_POINTS_FOR_TREND = 5;
const FLAT_RELATIVE_THRESHOLD = 0.01; // pente < 1 % de la valeur moyenne par sortie -> "flat"

/**
 * Calcule la tendance d'une métrique dans le temps par régression linéaire
 * simple (moindres carrés) sur l'index chronologique des sorties. Ne conclut
 * JAMAIS "tu progresses" : renvoie `direction` ("up"/"down"/"flat") comme un
 * fait statistique sur les données fournies, et "insufficient_data" en
 * dessous d'un nombre minimal de points (5 par défaut, personnalisable) —
 * une tendance sur 1 ou 2 sorties n'a pas de sens.
 *
 * @param {Array} activities - Objets Activity
 * @param {"distance"|"avgSpeed"|"elevationGain"|"avgPower"|"duration"} metric
 * @param {Object} [options]
 * @param {number} [options.minPoints=5]
 * @returns {{metric: string, points: {date: string, activityId: string, value: number}[], direction: "up"|"down"|"flat"|"insufficient_data", slope: number|null}}
 */
export function computeTrend(activities, metric, options = {}) {
  const getter = TREND_METRIC_GETTERS[metric];
  if (!getter) throw new Error(`Métrique de tendance inconnue : ${metric} (attendu : ${TREND_METRICS.join(", ")})`);

  const minPoints = options.minPoints ?? DEFAULT_MIN_POINTS_FOR_TREND;

  const sorted = (activities || [])
    .map((a) => ({ id: a.id, date: parseActivityDate(a), value: getter(a) }))
    .filter((p) => p.date && p.value != null)
    .sort((x, y) => x.date.getTime() - y.date.getTime());

  const points = sorted.map((p) => ({ date: p.date.toISOString(), activityId: p.id, value: p.value }));

  if (points.length < minPoints) {
    return { metric, points, direction: "insufficient_data", slope: null };
  }

  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const xMean = avg(xs), yMean = avg(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;

  const scale = yMean !== 0 ? Math.abs(yMean) : 1;
  const relativeSlope = slope / scale;
  const direction = Math.abs(relativeSlope) < FLAT_RELATIVE_THRESHOLD ? "flat" : relativeSlope > 0 ? "up" : "down";

  return { metric, points, direction, slope };
}
