/**
 * Convertit un profil 6A (`computeCyclistProfile()`) en vecteur de matching
 * — la seule porte d'entrée entre le moteur de profil et le moteur
 * d'archétypes, pour ne jamais dupliquer la lecture de `dimensions.*`
 * ailleurs dans ce module.
 *
 * PONDÉRATION (voir consigne §10) : le poids d'une dimension = sa
 * `confidence` telle que produite par Phase 6A, ou 0 si `value` est absent.
 * `dim.confidence` (voir profile/confidence.js: computeConfidence) est déjà
 * le produit de la quantité de preuves ET de la qualité des données
 * (mesuré/estimé/vitesse) — le reproduire ici multiplierait deux fois le
 * même facteur de qualité, ce qui fausserait le poids. Réutiliser
 * directement `dim.confidence` est donc la lecture correcte de "poids =
 * disponibilité × confiance × qualité des données", pas une simplification.
 */

import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";

/**
 * @param {Object|null} profile - résultat de computeCyclistProfile()
 * @returns {Object} `{ [dimension]: { value: number|null, weight: number, confidence: number|null, confidenceLabel: string } }`
 */
export function buildMatchingVector(profile) {
  const vector = {};
  for (const dim of ARCHETYPE_DIMENSIONS) {
    const d = profile && profile.dimensions && profile.dimensions[dim];
    const value = d && d.value != null ? d.value : null;
    vector[dim] = {
      value,
      weight: value != null ? d.confidence ?? 0 : 0,
      confidence: d ? d.confidence : null,
      confidenceLabel: d ? d.confidenceLabel : "insufficient_data",
    };
  }
  return vector;
}

/** @returns {string[]} dimensions avec une valeur exploitable (jamais celles à `null`, jamais traitées comme 0). */
export function availableDimensions(vector) {
  return ARCHETYPE_DIMENSIONS.filter((d) => vector[d].value != null);
}

/** @returns {string[]} dimensions insuffisantes (`value === null`). */
export function missingDimensions(vector) {
  return ARCHETYPE_DIMENSIONS.filter((d) => vector[d].value == null);
}
