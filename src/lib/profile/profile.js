/**
 * Point d'entrée du moteur de profil cycliste.
 *
 *   Activity[] (déjà chargées, jamais reparsées)
 *         ↓ activitySignals.js (réutilise analysis.js/analytics/*)
 *   signaux par activité (montées, efforts, meilleurs efforts)
 *         ↓ normalization.js + confidence.js
 *   dimensions (endurance, grimpe, punch, sprint, CLM, technique, régularité)
 *         ↓
 *   profil cycliste structuré, sérialisable
 *
 * `computeCyclistProfile` fonctionne avec `[]`, 1 activité, ou un historique
 * complet — jamais d'erreur, jamais de donnée fabriquée (voir chaque module
 * de dimensions/ pour le détail par dimension).
 */

import { deriveAllActivitySignals } from "./activitySignals.js";
import { computeEndurance } from "./dimensions/endurance.js";
import { computeClimbing } from "./dimensions/climbing.js";
import { computePunch } from "./dimensions/punch.js";
import { computeSprint } from "./dimensions/sprint.js";
import { computeTimeTrial } from "./dimensions/timeTrial.js";
import { computeTechnical } from "./dimensions/technical.js";
import { computeConsistency } from "./dimensions/consistency.js";
import { parseActivityDate, localMonthKey, localWeekKey } from "../history/dateUtils.js";

export const PROFILE_VERSION = 1;

function computeDataAvailability(activities) {
  const list = activities || [];
  return {
    activityCount: list.length,
    withSamples: list.filter((a) => a.samples && a.samples.length > 0).length,
    withHeartRate: list.filter((a) => a.flags && a.flags.hasHeartRate).length,
    withCadence: list.filter((a) => a.flags && a.flags.hasCadence).length,
    withMeasuredPower: list.filter((a) => a.flags && a.flags.hasPower && !a.flags.powerEstimated).length,
    withEstimatedPower: list.filter((a) => a.flags && a.flags.hasPower && a.flags.powerEstimated).length,
    withMtbOrGravel: list.filter((a) => a.sportType === "mtb" || a.sportType === "gravel").length,
  };
}

function avgOf(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * @param {import('../types.js').Activity[]} activities - activités déjà chargées (idéalement complètes, avec `samples`, pour les dimensions qui en dépendent — voir activitySignals.js pour la dégradation sinon)
 * @param {Object} [options]
 * @param {Date} [options.now] - horodatage de génération (tests)
 * @returns {{
 *   version: number,
 *   generatedAt: string,
 *   activityCount: number,
 *   dimensions: Object,
 *   dataAvailability: Object,
 *   overallConfidence: number|null,
 * }}
 */
export function computeCyclistProfile(activities, options = {}) {
  const list = activities || [];
  const activitySignals = deriveAllActivitySignals(list);

  const dimensions = {
    endurance: computeEndurance(activitySignals),
    climbing: computeClimbing(activitySignals),
    punch: computePunch(activitySignals),
    sprint: computeSprint(activitySignals),
    timeTrial: computeTimeTrial(activitySignals),
    technical: computeTechnical(activitySignals),
    consistency: computeConsistency(list),
  };

  const confidences = Object.values(dimensions)
    .map((d) => d.confidence)
    .filter((c) => c != null);

  return {
    version: PROFILE_VERSION,
    generatedAt: (options.now || new Date()).toISOString(),
    activityCount: list.length,
    dimensions,
    dataAvailability: computeDataAvailability(list),
    overallConfidence: confidences.length ? avgOf(confidences) : null,
  };
}

const TIMELINE_BUCKET_KEY_FNS = { week: localWeekKey, month: localMonthKey };

/**
 * Calcule le profil cycliste à plusieurs points dans le temps, pour préparer
 * l'affichage futur de l'évolution de l'alter ego (consigne §12) — ne
 * construit AUCUNE UI ici.
 *
 * Par défaut CUMULATIF : le profil au bucket N utilise toutes les activités
 * jusqu'à N inclus (montre comment le profil se stabilise avec l'historique
 * qui grandit), pas seulement les activités du bucket N. `options.cumulative
 * = false` donne le profil "de ce mois-ci seulement" à la place.
 *
 * Coût : un `computeCyclistProfile` complet par bucket (pas de calcul
 * incrémental) — acceptable au volume de données actuel ; à optimiser en
 * Phase 6B si le nombre de sorties devient important (voir README.md).
 *
 * @param {import('../types.js').Activity[]} activities
 * @param {Object} [options]
 * @param {"week"|"month"} [options.bucket="month"]
 * @param {boolean} [options.cumulative=true]
 * @returns {Array<{date: string, activityCountAtPoint: number, profile: Object}>} trié chronologiquement, vide si aucune activité datée
 */
export function buildProfileTimeline(activities, options = {}) {
  const bucket = options.bucket || "month";
  const keyFn = TIMELINE_BUCKET_KEY_FNS[bucket];
  if (!keyFn) throw new Error(`Regroupement de timeline inconnu : ${bucket} (attendu "week" ou "month")`);
  const cumulative = options.cumulative !== false;

  const dated = (activities || [])
    .map((a) => {
      const date = parseActivityDate(a);
      return date ? { activity: a, date, key: keyFn(date) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (dated.length === 0) return [];

  const keysInOrder = [];
  const seenKeys = new Set();
  for (const d of dated) {
    if (!seenKeys.has(d.key)) {
      seenKeys.add(d.key);
      keysInOrder.push(d.key);
    }
  }

  return keysInOrder.map((key) => {
    const subset = cumulative
      ? dated.filter((d) => d.key <= key).map((d) => d.activity)
      : dated.filter((d) => d.key === key).map((d) => d.activity);
    return {
      date: key,
      activityCountAtPoint: subset.length,
      profile: computeCyclistProfile(subset, options),
    };
  });
}
