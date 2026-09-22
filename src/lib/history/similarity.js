/**
 * Similarité entre activités et détection de parcours répétés.
 *
 * Aucun machine learning ici : un score interne simple et explicable (voir
 * `similarityScore`), utilisé uniquement pour trier/filtrer des sorties
 * suffisamment proches pour être comparées — CE N'EST PAS un score de
 * performance et il ne doit jamais être présenté comme tel à l'utilisateur.
 *
 * La position de départ utilise `Activity.gpsTrack` (ou, à défaut,
 * `Activity.samples`) — aucune des deux n'existe dans le résumé léger de
 * `index.json` : ces fonctions ont donc besoin d'activités complètes
 * (`loadActivityDetail()`), pas seulement de l'index. Sans position de
 * départ connue pour les deux activités, la similarité se rabat sur
 * distance/D+/allure uniquement (voir `similarityScore`).
 */

import { haversine } from "../utils.js";

const DEFAULT_WEIGHTS = { distance: 1, elevationGain: 1, pace: 1, startLocation: 1 };
const DEFAULT_START_PROXIMITY_KM = 2; // au-delà, la proximité de départ n'apporte plus d'info utile

function relativeDiff(a, b) {
  if (a == null || b == null) return null;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.abs(a - b) / denom;
}

function startPoint(activity) {
  const track = activity && activity.gpsTrack;
  if (track && track.length) return track[0];
  const samples = activity && activity.samples;
  if (samples && samples.length) {
    const s = samples.find((p) => p.latitude != null && p.longitude != null);
    if (s) return { lat: s.latitude, lon: s.longitude };
  }
  return null;
}

function paceSecPerKm(activity) {
  if (!activity || !activity.distance || activity.distance <= 0 || activity.duration == null) return null;
  return activity.duration / activity.distance;
}

/**
 * Score de similarité INTERNE entre deux activités (0 = identiques sur tous
 * les critères disponibles ; plus c'est haut, moins elles se ressemblent —
 * comme une distance, pas un pourcentage de performance). Moyenne pondérée
 * des écarts RELATIFS de distance, de D+, d'allure (durée/distance), plus un
 * terme de proximité du point de départ GPS (normalisé sur `startProximityKm`)
 * quand les deux activités ont une position de départ connue. Les critères
 * sans donnée des deux côtés sont simplement exclus de la moyenne (jamais
 * comptés comme "différents").
 *
 * @param {Object} a - Activity
 * @param {Object} b - Activity
 * @param {Object} [options]
 * @param {{distance?, elevationGain?, pace?, startLocation?}} [options.weights]
 * @param {number} [options.startProximityKm=2]
 * @returns {{score: number|null, comparable: boolean, startDistanceKm: number|null, distanceDiffRatio: number|null, elevationGainDiffRatio: number|null, paceDiffRatio: number|null}}
 */
export function similarityScore(a, b, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const startProximityKm = options.startProximityKm ?? DEFAULT_START_PROXIMITY_KM;

  const distanceDiffRatio = relativeDiff(pickOrNull(a, "distance"), pickOrNull(b, "distance"));
  const elevationGainDiffRatio = relativeDiff(pickOrNull(a, "elevationGain"), pickOrNull(b, "elevationGain"));
  const paceDiffRatio = relativeDiff(paceSecPerKm(a), paceSecPerKm(b));

  let weightedSum = 0, weightTotal = 0;
  if (distanceDiffRatio != null) { weightedSum += distanceDiffRatio * weights.distance; weightTotal += weights.distance; }
  if (elevationGainDiffRatio != null) { weightedSum += elevationGainDiffRatio * weights.elevationGain; weightTotal += weights.elevationGain; }
  if (paceDiffRatio != null) { weightedSum += paceDiffRatio * weights.pace; weightTotal += weights.pace; }

  const pa = startPoint(a), pb = startPoint(b);
  let startDistanceKm = null;
  if (pa && pb) {
    startDistanceKm = haversine(pa.lat, pa.lon, pb.lat, pb.lon) / 1000;
    const startScore = Math.min(1, startDistanceKm / startProximityKm);
    weightedSum += startScore * weights.startLocation;
    weightTotal += weights.startLocation;
  }

  if (weightTotal === 0) return { score: null, comparable: false, startDistanceKm, distanceDiffRatio, elevationGainDiffRatio, paceDiffRatio };
  return { score: weightedSum / weightTotal, comparable: true, startDistanceKm, distanceDiffRatio, elevationGainDiffRatio, paceDiffRatio };
}

function pickOrNull(activity, key) {
  return activity && activity[key] != null ? activity[key] : null;
}

/**
 * Retourne les activités les plus similaires à `target` (voir similarityScore),
 * triées par score croissant (les plus proches d'abord).
 * @param {Object} target - Activity de référence
 * @param {Array} activities - Activités candidates (target est ignorée si présente dans la liste)
 * @param {Object} [options] - Voir similarityScore ; plus :
 * @param {number} [options.maxScore=0.25] - Seuil de score au-delà duquel une activité n'est pas retenue
 * @param {number} [options.limit=10] - Nombre maximal de résultats (0/null = illimité)
 * @returns {Array<{activity: Object, score: number, startDistanceKm: number|null}>}
 */
export function findSimilarActivities(target, activities, options = {}) {
  const maxScore = options.maxScore ?? 0.25;
  const limit = options.limit ?? 10;

  const results = [];
  for (const candidate of activities || []) {
    if (!candidate || candidate.id === target.id) continue;
    const sim = similarityScore(target, candidate, options);
    if (sim.comparable && sim.score <= maxScore) results.push({ activity: candidate, ...sim });
  }
  results.sort((x, y) => x.score - y.score);
  return limit ? results.slice(0, limit) : results;
}

const SAME_ROUTE_THRESHOLDS = { distanceDiffRatio: 0.15, elevationGainDiffRatio: 0.3, startDistanceKm: 1 };

/**
 * Estime si deux activités semblent correspondre au même parcours. Ne
 * cherche pas une correspondance GPS exacte (les traces varient légèrement
 * d'une sortie à l'autre) : exige un départ GPS connu et proche des deux
 * côtés, une distance et un D+ proches (seuils par défaut personnalisables).
 * Résultat destiné à un futur usage UI ("Ces sorties semblent correspondre au
 * même parcours") — cette phrase n'est pas affichée ici.
 *
 * @param {Object} a - Activity
 * @param {Object} b - Activity
 * @param {Object} [options] - Voir similarityScore ; plus `options.thresholds` pour surcharger SAME_ROUTE_THRESHOLDS
 * @returns {{same: boolean, reason?: string, startDistanceKm?: number|null, distanceDiffRatio?: number|null, elevationGainDiffRatio?: number|null}}
 */
export function looksLikeSameRoute(a, b, options = {}) {
  const thresholds = { ...SAME_ROUTE_THRESHOLDS, ...options.thresholds };
  const sim = similarityScore(a, b, options);
  if (!sim.comparable) return { same: false, reason: "Pas assez de données comparables entre les deux sorties." };
  if (sim.startDistanceKm == null) return { same: false, reason: "Position de départ inconnue pour au moins une des deux sorties.", ...sim };

  const distOk = sim.distanceDiffRatio == null || sim.distanceDiffRatio <= thresholds.distanceDiffRatio;
  const gainOk = sim.elevationGainDiffRatio == null || sim.elevationGainDiffRatio <= thresholds.elevationGainDiffRatio;
  const startOk = sim.startDistanceKm <= thresholds.startDistanceKm;

  return { same: distOk && gainOk && startOk, ...sim, thresholds };
}

/**
 * Regroupe les activités par parcours probable (composantes connexes au sens
 * de `looksLikeSameRoute` : une activité rejoint un groupe si elle
 * "correspond" à au moins un membre déjà présent — approche gloutonne simple,
 * pas de clustering avancé). Seuls les groupes de 2 sorties ou plus (parcours
 * effectivement répété) sont retournés.
 *
 * @param {Array} activities - Activités complètes (avec gpsTrack ou samples)
 * @param {Object} [options] - Voir looksLikeSameRoute
 * @returns {Array<Array<Object>>}
 */
export function groupActivitiesByRoute(activities, options = {}) {
  const groups = [];
  for (const activity of activities || []) {
    const group = groups.find((g) => g.some((member) => looksLikeSameRoute(activity, member, options).same));
    if (group) group.push(activity);
    else groups.push([activity]);
  }
  return groups.filter((g) => g.length > 1);
}
