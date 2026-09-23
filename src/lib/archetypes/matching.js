/**
 * Algorithme de matching — distance euclidienne pondérée normalisée, en
 * RMS (root-mean-square) pour rester sur l'échelle [0,1] quel que soit le
 * nombre de dimensions comparées.
 *
 * Pour deux vecteurs (utilisateur, cible) et un ensemble de dimensions
 * communes disponibles D :
 *
 *   diff_d      = |valeur_utilisateur_d − valeur_cible_d| / 100      (normalisé, cible/utilisateur sur 0-100)
 *   distance    = sqrt( Σ(poids_d × diff_d²) / Σ(poids_d) )          (pour d ∈ D, poids_d > 0)
 *   closeness   = 1 − distance                                       (borné [0,1] en pratique)
 *
 * `poids_d` vient de archetypeProfile.js: `matchingWeight(confidence)` — une
 * transformation CONVEXE de la confidence de la dimension côté utilisateur
 * (Phase 9D : plus conservatrice qu'une simple égalité poids=confidence,
 * voir archetypeProfile.js pour le détail), 0 si absente. Une dimension
 * absente côté UTILISATEUR *ou* côté CIBLE (coureur/archétype) est
 * simplement exclue de D — jamais traitée comme un écart de 0 ou de 100
 * (consigne §3/§9 : ne jamais pénaliser un `null`).
 *
 * `closeness` est un score INTERNE (jamais affiché tel quel, voir
 * consigne §12) : l'UI ne doit consommer que `similarityLabel`
 * ("Profil très proche" / "Profil proche" / "Profil partiellement proche")
 * ou l'ordre déjà trié des résultats.
 *
 * Phase 9D ajoute un second garde-fou à `matchArchetypes()` (voir plus bas) :
 * même avec une `closeness` élevée, un `primary` n'est affirmé que si la
 * fiabilité GLOBALE du matching (`computeMatchConfidence`, couverture ×
 * confidence moyenne) n'est pas "low"/"insufficient_data" — `closeness` seule
 * mesure la forme du profil, pas la quantité/qualité de preuves derrière.
 */

import { ARCHETYPES, ARCHETYPE_DIMENSIONS } from "./archetypes.js";
import { REFERENCE_RIDERS } from "./references.js";
import { buildMatchingVector, availableDimensions, missingDimensions } from "./archetypeProfile.js";
import { computeMatchConfidence } from "./confidence.js";
import { explainArchetypeMatch, explainRiderMatch, explainInsufficientMatch } from "./explanations.js";
import { buildProfileTimeline } from "../profile/profile.js";

/** En dessous, le secondaire n'est pas annoncé comme faisant partie d'une combinaison (trop loin du primaire pour être honnête). */
const SECONDARY_RATIO_THRESHOLD = 0.85;
/** En dessous, même le meilleur archétype n'est pas assez proche pour être annoncé comme "primaire" — "Profil indéterminé" à la place. */
const MIN_CLOSENESS_FOR_PRIMARY = 0.35;
/** Nombre minimal de dimensions communes pour qu'une comparaison à un coureur soit montrée du tout. */
const DEFAULT_MIN_MATCHED_DIMENSIONS = 2;
/** En dessous, même avec assez de dimensions communes, le résultat est jugé trop faible pour être présenté comme une similarité. */
const MIN_SIMILARITY_TO_SHOW = 0.4;

/**
 * @param {Object} userVector - voir archetypeProfile.js: buildMatchingVector()
 * @param {Object} targetDimensions - `{ [dimension]: number|null }` (archétype toujours complet, coureur parfois partiel)
 * @returns {{closeness: number|null, matchedDimensions: string[]}}
 */
function computeCloseness(userVector, targetDimensions) {
  let weightedSqSum = 0;
  let weightSum = 0;
  const matchedDimensions = [];

  for (const dim of ARCHETYPE_DIMENSIONS) {
    const weight = userVector[dim].weight;
    const targetValue = targetDimensions[dim];
    if (weight <= 0 || targetValue == null) continue;

    const diff = (userVector[dim].value - targetValue) / 100;
    weightedSqSum += weight * diff * diff;
    weightSum += weight;
    matchedDimensions.push(dim);
  }

  if (weightSum === 0) return { closeness: null, matchedDimensions: [] };
  const rmsDiff = Math.sqrt(weightedSqSum / weightSum);
  return { closeness: Math.max(0, 1 - rmsDiff), matchedDimensions };
}

/**
 * @param {number} closeness - 0-1
 * @returns {string} libellé qualitatif, jamais un pourcentage (voir consigne §12)
 */
export function similarityLabel(closeness) {
  if (closeness == null) return "Profil insuffisant";
  if (closeness >= 0.85) return "Profil très proche";
  if (closeness >= 0.65) return "Profil proche";
  if (closeness >= MIN_SIMILARITY_TO_SHOW) return "Profil partiellement proche";
  return "Profil éloigné";
}

/**
 * @param {Object|null} profile - résultat de computeCyclistProfile()
 * @returns {{
 *   primary: Object|null, secondary: Object|null, combinedLabel: string,
 *   confidence: Object, explanation: string[], insufficientDimensions: string[],
 *   allScores: Array<{id: string, closeness: number}>
 * }}
 */
export function matchArchetypes(profile) {
  const vector = buildMatchingVector(profile);
  const available = availableDimensions(vector);
  const missing = missingDimensions(vector);
  const confidence = computeMatchConfidence(vector);

  if (available.length === 0) {
    return { primary: null, secondary: null, combinedLabel: "Profil en construction", confidence, explanation: [], insufficientDimensions: missing, allScores: [], vector };
  }

  const scored = ARCHETYPES.map((archetype) => ({ archetype, ...computeCloseness(vector, archetype.dimensions) }))
    .filter((s) => s.closeness != null)
    .sort((a, b) => b.closeness - a.closeness);

  const top = scored[0];
  // Deuxième garde-fou, Phase 9D (en plus de closeness < seuil ci-dessous) :
  // `confidence` ici est la fiabilité GLOBALE du matching (couverture × confidence
  // moyenne des dimensions dispo, voir archetypes/confidence.js) — indépendante
  // de `closeness` (qui ne mesure que la FORME du profil, pas la quantité/qualité
  // des preuves derrière). Sans ce garde-fou, un profil avec une seule dimension
  // disponible (même à closeness élevée) ou plusieurs dimensions toutes à
  // confidence "low" pouvait produire un archétype présenté comme affirmatif —
  // exactement le cas que cette phase corrige (voir consigne, exemple Punch=82/low).
  const overallConfidenceTooLow = confidence.label === "low";
  if (!top || top.closeness < MIN_CLOSENESS_FOR_PRIMARY || overallConfidenceTooLow) {
    return {
      primary: null,
      secondary: null,
      combinedLabel: "Profil indéterminé",
      confidence,
      explanation: explainInsufficientMatch(vector, available, missing, confidence),
      insufficientDimensions: missing,
      allScores: scored.map((s) => ({ id: s.archetype.id, closeness: s.closeness })),
      vector,
    };
  }

  const second = scored[1];
  const hasSecondary = second && second.closeness >= top.closeness * SECONDARY_RATIO_THRESHOLD;

  const primary = { ...top.archetype, closeness: top.closeness };
  const secondary = hasSecondary ? { ...second.archetype, closeness: second.closeness } : null;
  const combinedLabel = secondary ? `${primary.name} / ${secondary.name}` : primary.name;

  return {
    primary,
    secondary,
    combinedLabel,
    confidence,
    explanation: explainArchetypeMatch(vector, primary, secondary, available),
    insufficientDimensions: missing,
    allScores: scored.map((s) => ({ id: s.archetype.id, closeness: s.closeness })),
    vector,
  };
}

/**
 * @param {Object|null} profile - résultat de computeCyclistProfile()
 * @param {Object} [options]
 * @param {number} [options.minMatchedDimensions=2]
 * @param {number} [options.limit] - nombre maximal de résultats (par défaut : tous ceux qui passent le seuil)
 * @returns {Array<{rider: Object, similarity: number, similarityLabel: string, matchedDimensions: string[], missingDimensions: string[], explanation: string[]}>}
 *   Trié par similarité décroissante. `similarity` est un score interne — l'UI n'affiche que `similarityLabel`.
 */
export function matchReferenceRiders(profile, options = {}) {
  const vector = buildMatchingVector(profile);
  if (availableDimensions(vector).length === 0) return [];

  const minMatchedDimensions = options.minMatchedDimensions ?? DEFAULT_MIN_MATCHED_DIMENSIONS;

  const results = REFERENCE_RIDERS.map((rider) => {
    const { closeness, matchedDimensions } = computeCloseness(vector, rider.profile);
    if (closeness == null || closeness < MIN_SIMILARITY_TO_SHOW || matchedDimensions.length < minMatchedDimensions) return null;

    const missingForRider = ARCHETYPE_DIMENSIONS.filter((d) => vector[d].value == null || rider.profile[d] == null);

    return {
      rider,
      similarity: closeness,
      similarityLabel: similarityLabel(closeness),
      matchedDimensions,
      missingDimensions: missingForRider,
      explanation: explainRiderMatch(vector, rider, matchedDimensions, missingForRider),
    };
  }).filter(Boolean);

  results.sort((a, b) => b.similarity - a.similarity);
  return options.limit ? results.slice(0, options.limit) : results;
}

/**
 * Évolution de l'archétype dominant dans le temps (voir consigne §18) —
 * réutilise buildProfileTimeline (Phase 6A) tel quel, n'ajoute qu'une passe
 * de matching sur chaque point déjà calculé.
 *
 * @param {import('../types.js').Activity[]} activities
 * @param {Object} [options] - transmis à buildProfileTimeline (bucket, cumulative, now)
 * @returns {Array<{date: string, activityCountAtPoint: number, match: Object}>}
 */
export function buildArchetypeTimeline(activities, options = {}) {
  const timeline = buildProfileTimeline(activities, options);
  return timeline.map((point) => ({
    date: point.date,
    activityCountAtPoint: point.activityCountAtPoint,
    match: matchArchetypes(point.profile),
  }));
}
