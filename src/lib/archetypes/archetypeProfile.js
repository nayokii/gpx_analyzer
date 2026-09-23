/**
 * Convertit un profil 6A (`computeCyclistProfile()`) en vecteur de matching
 * — la seule porte d'entrée entre le moteur de profil et le moteur
 * d'archétypes, pour ne jamais dupliquer la lecture de `dimensions.*`
 * ailleurs dans ce module.
 *
 * PONDÉRATION — Phase 9D (voir consigne : "score ≠ confidence ≠ matching
 * weight"). `dim.confidence` (profile/confidence.js) reste la SEULE source
 * de fiabilité — ce module ne la redérive jamais depuis les données brutes,
 * il se contente de décider À QUEL POINT une confidence donnée doit
 * influencer le matching final.
 *
 * Avant la Phase 9D, `weight = dim.confidence` directement (relation 1:1).
 * Ça posait un problème concret : une dimension à confidence 0.30 ("low",
 * juste sous le seuil bas de profile/confidence.js) gardait encore ~35% du
 * poids relatif d'une dimension à confidence 0.85 ("high") dans la moyenne
 * pondérée de computeCloseness() — pas assez conservateur pour une preuve
 * qu'on sait elle-même peu fiable (voir consigne : Punch speed-only à faible
 * confiance ne doit pas peser presque autant qu'une dimension mesurée).
 *
 * Phase 9D introduit `matchingWeight()` : une transformation CONVEXE
 * (`confidence²`) de la confidence, appliquée uniquement à la pondération du
 * matching — jamais à `dim.confidence`/`dim.value` eux-mêmes, qui restent
 * strictement ceux de Phase 6A (affichés tels quels dans ProfileView).
 * Propriétés de `x²` sur [0,1], choisies précisément pour ça :
 *   - monotone croissante : une confidence plus haute reste toujours un poids
 *     plus haut (jamais d'inversion, jamais d'effet caché) ;
 *   - convexe : elle réduit BEAUCOUP plus les faibles valeurs que les fortes
 *     (0.3² = 0.09 → réduction de 70% ; 0.85² = 0.7225 → réduction de 15%
 *     seulement) — exactement la hiérarchie "low → très faible influence,
 *     medium → réduite, high → quasi normale" demandée, sans palier abrupt à
 *     une frontière de label (contrairement à un multiplicateur différent par
 *     tranche, qui créerait un saut brutal juste avant/après un seuil) ;
 *   - aucun nouveau paramètre : pas de coefficient arbitraire à calibrer, pas
 *     de nouvelle donnée requise — seulement la confidence déjà produite par
 *     Phase 6A.
 * Déterministe, stable, testé (voir archetypeProfile.test.js).
 */

import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";

/** Exposant de la transformation de fiabilité — voir docstring ci-dessus. */
export const MATCHING_RELIABILITY_EXPONENT = 2;

/**
 * Transforme une confidence Phase 6A (0-1) en poids de matching (0-1).
 * Toujours ≤ la confidence d'origine (voir docstring du module).
 * @param {number|null} confidence
 * @returns {number} 0-1
 */
export function matchingWeight(confidence) {
  if (confidence == null || confidence <= 0) return 0;
  return Math.pow(Math.min(1, confidence), MATCHING_RELIABILITY_EXPONENT);
}

/** Libellé qualitatif de l'influence dans le matching, dérivé du MÊME
 * `confidenceLabel` que partout ailleurs dans l'app (jamais un nouveau
 * vocabulaire) — utilisé uniquement pour l'affichage ("Pourquoi ce profil ?",
 * voir ArchetypeView.jsx), jamais pour le calcul (qui utilise `weight`,
 * continu, voir ci-dessus).
 * @param {string} confidenceLabel
 * @returns {string}
 */
export function matchingInfluenceLabel(confidenceLabel) {
  switch (confidenceLabel) {
    case "high":
      return "forte influence";
    case "medium":
      return "influence moyenne";
    case "low":
      return "influence faible";
    default:
      return "données insuffisantes";
  }
}

/**
 * @param {Object|null} profile - résultat de computeCyclistProfile()
 * @returns {Object} `{ [dimension]: { value: number|null, weight: number, confidence: number|null, confidenceLabel: string, matchingInfluence: string } }`
 */
export function buildMatchingVector(profile) {
  const vector = {};
  for (const dim of ARCHETYPE_DIMENSIONS) {
    const d = profile && profile.dimensions && profile.dimensions[dim];
    const value = d && d.value != null ? d.value : null;
    const confidenceLabel = d ? d.confidenceLabel : "insufficient_data";
    vector[dim] = {
      value,
      weight: value != null ? matchingWeight(d.confidence) : 0,
      confidence: d ? d.confidence : null,
      confidenceLabel,
      matchingInfluence: value != null ? matchingInfluenceLabel(confidenceLabel) : "données insuffisantes",
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
