/**
 * Confiance du matching d'archétype — réutilise directement le label de
 * confiance de Phase 6A (profile/confidence.js: confidenceLabel) plutôt que
 * d'inventer une nouvelle échelle de textes ("faible"/"moyenne"/"élevée"
 * garde exactement le même sens qu'ailleurs dans l'app).
 *
 * La confiance du MATCHING (pas d'une dimension individuelle) combine :
 * - la fraction de dimensions disponibles parmi les 6 utilisées pour le
 *   matching (voir archetypes.js: ARCHETYPE_DIMENSIONS) ;
 * - la confiance moyenne de ces dimensions disponibles (déjà un mélange
 *   preuves/qualité de données, voir archetypeProfile.js).
 *
 * Un profil avec 1 seule dimension disponible, même à confiance élevée sur
 * cette dimension, ne peut PAS produire une confiance de matching élevée —
 * la fraction de couverture (1/6) la plafonne. C'est intentionnel : matcher
 * un style de coureur sur une seule dimension serait trompeur.
 */

import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";
import { availableDimensions } from "./archetypeProfile.js";
import { confidenceLabel } from "../profile/confidence.js";

/**
 * @param {Object} vector - voir archetypeProfile.js: buildMatchingVector()
 * @returns {{value: number|null, label: string, availableCount: number, totalDimensions: number}}
 */
export function computeMatchConfidence(vector) {
  const available = availableDimensions(vector);
  const totalDimensions = ARCHETYPE_DIMENSIONS.length;

  if (available.length === 0) {
    return { value: null, label: "insufficient_data", availableCount: 0, totalDimensions };
  }

  const availabilityFraction = available.length / totalDimensions;
  const avgConfidence = available.reduce((sum, d) => sum + (vector[d].confidence || 0), 0) / available.length;
  const value = availabilityFraction * avgConfidence;

  return { value, label: confidenceLabel(value), availableCount: available.length, totalDimensions };
}
