/**
 * Affinité profil ↔ étape — Tour Simulator (Phase 10A).
 *
 * Compare les dimensions déjà calculées par `computeCyclistProfile()` (voir
 * ../profile/profile.js — jamais recalculées ici, voir consigne §3/§15 :
 * aucune donnée GPS/samples n'entre dans ce module) à l'importance que le
 * type d'étape accorde à chacune (voir stageTypes.js), pour produire un
 * score d'AFFINITÉ DE STYLE — jamais une prédiction de temps, de vitesse ou
 * de classement.
 *
 * PONDÉRATION PAR LA CONFIANCE : réutilise TEL QUEL
 * `archetypes/archetypeProfile.js: matchingWeight()` (transformation
 * `confidence²`, Phase 9D) — le même problème ("une dimension peu
 * documentée ne doit pas peser presque autant qu'une dimension bien
 * documentée") a déjà une solution testée dans ce projet ; ce module ne la
 * redérive pas, il l'importe. Voir ce fichier pour la justification complète
 * des propriétés de cette transformation.
 *
 *   affinité = Σ(valeur_dimension × importance_étape × matchingWeight(confidence))
 *              ──────────────────────────────────────────────────────────────────
 *              Σ(importance_étape × matchingWeight(confidence))
 *
 * Une dimension à `value: null` (données insuffisantes) a un poids de 0 par
 * construction — jamais traitée comme 0, jamais transformée en une valeur
 * numérique (même principe que `archetypes/matching.js: computeCloseness`).
 */

import { STAGE_TYPE_DIMENSIONS } from "./stageTypes.js";
import { matchingWeight } from "../archetypes/archetypeProfile.js";
import { confidenceLabel } from "../profile/confidence.js";

const KEY_FACTORS_LIMIT = 3;

/** Seuils de catégorie d'affinité, documentés — voir consigne §6 : des
 * labels descriptifs, jamais un classement "meilleur/pire" absolu. */
const AFFINITY_CATEGORY_THRESHOLDS = [
  { min: 75, label: "très favorable" },
  { min: 60, label: "favorable" },
  { min: 40, label: "neutre" },
];
const LOW_AFFINITY_LABEL = "moins favorable";
export const INSUFFICIENT_AFFINITY_LABEL = "données insuffisantes";

/**
 * @param {number|null} score - 0-100, ou `null` si aucune dimension exploitable
 * @returns {string}
 */
export function categorizeAffinity(score) {
  if (score == null) return INSUFFICIENT_AFFINITY_LABEL;
  for (const { min, label } of AFFINITY_CATEGORY_THRESHOLDS) {
    if (score >= min) return label;
  }
  return LOW_AFFINITY_LABEL;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * @param {import('../profile/profile.js').CyclistProfile|null} profile - résultat de computeCyclistProfile(), jamais recalculé ici
 * @param {import('./stages.js').Stage} stage
 * @returns {{
 *   score: number|null,
 *   category: string,
 *   confidence: number|null,
 *   confidenceLabel: string,
 *   dimensions: Array<{dimension: string, value: number|null, confidence: number|null, confidenceLabel: string, importance: number, weight: number, contribution: number|null}>,
 *   keyFactors: string[],
 *   missingDimensions: string[]
 * }}
 */
export function computeStageAffinity(profile, stage) {
  // Premier passage : poids de chaque dimension (importance d'étape × fiabilité de la preuve).
  const rows = STAGE_TYPE_DIMENSIONS.map((dim) => {
    const d = profile && profile.dimensions && profile.dimensions[dim];
    const value = d && d.value != null ? d.value : null;
    const confidence = d ? d.confidence : null;
    const importance = clamp01(stage ? stage[dim] ?? 0 : 0);
    const reliability = value != null ? matchingWeight(confidence) : 0; // 0 si value est null — jamais une donnée absente traitée comme 0
    const weight = importance * reliability;
    return {
      dimension: dim,
      value,
      confidence,
      confidenceLabel: d ? d.confidenceLabel : "insufficient_data",
      importance,
      weight,
    };
  });

  const weightTotal = rows.reduce((sum, r) => sum + r.weight, 0);
  const weightedValueSum = rows.reduce((sum, r) => sum + (r.weight > 0 ? r.value * r.weight : 0), 0);

  const usedRows = rows.filter((r) => r.weight > 0);
  const score = weightTotal > 0 ? Math.round(Math.max(0, Math.min(100, weightedValueSum / weightTotal))) : null;

  // Second passage : contribution RELATIVE de chaque dimension au score final
  // (part du poids total qu'elle représente, 0-1) — plus explicable qu'une
  // valeur brute, voir consigne §4 : "suffisamment d'informations pour
  // expliquer le résultat".
  const dimensions = rows.map((r) => ({
    ...r,
    contribution: r.weight > 0 && weightTotal > 0 ? r.weight / weightTotal : null,
  }));

  // Confiance globale de CETTE affinité : même principe que
  // archetypes/confidence.js (couverture × confidence moyenne des dimensions
  // effectivement utilisées) — jamais redérivé différemment.
  const coverage = usedRows.length / STAGE_TYPE_DIMENSIONS.length;
  const avgConfidence = usedRows.length > 0 ? usedRows.reduce((s, r) => s + (r.confidence || 0), 0) / usedRows.length : null;
  const confidenceValue = score != null && avgConfidence != null ? coverage * avgConfidence : null;

  const keyFactors = dimensions
    .filter((d) => d.contribution != null)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, KEY_FACTORS_LIMIT)
    .map((d) => d.dimension);

  const missingDimensions = dimensions.filter((d) => d.value == null && d.importance > 0).map((d) => d.dimension);

  return {
    score,
    category: categorizeAffinity(score),
    confidence: confidenceValue,
    confidenceLabel: confidenceLabel(confidenceValue),
    dimensions,
    keyFactors,
    missingDimensions,
  };
}
