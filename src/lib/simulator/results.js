/**
 * Construction des résultats (étape + global) — Tour Simulator (Phase 10A).
 *
 * Sépare la mise en forme du résultat de l'orchestration (simulation.js) et
 * du calcul d'affinité (stageAffinity.js) — chaque fichier une
 * responsabilité claire, voir consigne. Aucun calcul GPS/activité ici :
 * uniquement de l'agrégation sur des résultats déjà produits.
 */

import { fatiguePenalty } from "./fatigue.js";
import { matchArchetypes } from "../archetypes/matching.js";

/** Catégories de "forme simulée" (voir consigne §9) — explicitement des
 * catégories de JEU, jamais présentées comme une performance réelle. Seuils
 * appliqués au score d'affinité APRÈS ajustement de fatigue. */
const PERFORMANCE_BAND_THRESHOLDS = [
  { min: 80, band: "very_strong" },
  { min: 65, band: "strong" },
  { min: 50, band: "neutral" },
  { min: 35, band: "below_average" },
];
const STRUGGLING_BAND = "struggling";
export const INSUFFICIENT_PERFORMANCE_BAND = "insufficient_data";

/**
 * @param {number|null} adjustedScore - 0-100, score d'affinité après fatigue, ou `null` si l'étape est indocumentée
 * @returns {string}
 */
export function categorizePerformanceBand(adjustedScore) {
  if (adjustedScore == null) return INSUFFICIENT_PERFORMANCE_BAND;
  for (const { min, band } of PERFORMANCE_BAND_THRESHOLDS) {
    if (adjustedScore >= min) return band;
  }
  return STRUGGLING_BAND;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

/**
 * Assemble le résultat d'UNE étape simulée. `affinity` vient de
 * `computeStageAffinity()`, les états de fatigue de `fatigue.js` — cette
 * fonction ne fait que les combiner et appliquer la pénalité de fatigue au
 * score brut (voir consigne §9 : jamais une vitesse/un temps inventés).
 *
 * @param {Object} params
 * @param {import('./stages.js').Stage} params.stage
 * @param {ReturnType<typeof import('./stageAffinity.js').computeStageAffinity>} params.affinity
 * @param {{fatigue: number, consecutiveDifficultDays: number}} params.fatigueBefore
 * @param {{fatigue: number, consecutiveDifficultDays: number}} params.fatigueAfter
 * @param {number} [params.dayVariance] - petite variation "forme du jour" (points, voir simulation.js) — 0 si non fournie, jamais appliquée à un score `null`
 * @returns {Object}
 */
export function buildStageResult({ stage, affinity, fatigueBefore, fatigueAfter, dayVariance = 0 }) {
  const penalty = fatiguePenalty(fatigueBefore); // la fatigue AVANT l'étape est ce qui affecte sa performance
  const scoreOfTheDay = affinity.score == null ? null : Math.max(0, Math.min(100, affinity.score + dayVariance));
  const adjustedScore = scoreOfTheDay == null ? null : Math.round(Math.max(0, scoreOfTheDay * (1 - penalty)));

  return {
    stageId: stage.id,
    stageName: stage.name,
    stageType: stage.type,
    affinity: affinity.score,
    category: affinity.category,
    confidenceLabel: affinity.confidenceLabel,
    adjustedScore,
    performanceBand: categorizePerformanceBand(adjustedScore),
    fatigueBefore: round1(fatigueBefore.fatigue),
    fatigueAfter: round1(fatigueAfter.fatigue),
    keyFactors: affinity.keyFactors,
    missingDimensions: affinity.missingDimensions,
  };
}

/**
 * Moyenne des scores d'affinité BRUTS (non ajustés par la fatigue — cette
 * moyenne décrit l'adéquation de STYLE avec ce type de terrain, indépendante
 * du récit fatigue/récupération de cette simulation précise) parmi les
 * étapes d'un ou plusieurs types donnés, en ignorant les étapes
 * indocumentées (`null`) plutôt que de les compter comme 0.
 * @param {Array} stageResults - voir buildStageResult()
 * @param {string[]} types
 * @returns {number|null}
 */
function averageAffinityForTypes(stageResults, types) {
  const scores = stageResults.filter((r) => types.includes(r.stageType) && r.affinity != null).map((r) => r.affinity);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Régularité de la simulation : 100 = même niveau d'affinité ajustée à
 * chaque étape, 0 = très irrégulier. Dérivée de l'écart-type des scores
 * ajustés eux-mêmes (une statistique réelle du résultat produit, pas une
 * donnée externe inventée) — nécessite au moins 2 étapes avec un score.
 * @param {Array} stageResults
 * @returns {number|null}
 */
function computeConsistency(stageResults) {
  const scores = stageResults.map((r) => r.adjustedScore).filter((v) => v != null);
  if (scores.length < 2) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, v) => sum + (v - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  // Écart-type normalisé sur une plage de 0-50 points (borne documentée : au
  // delà d'un écart-type de 50 pts, la simulation est considérée maximalement
  // irrégulière) — pas une constante physiologique, une échelle d'affichage.
  const MAX_REFERENCE_STD_DEV = 50;
  return Math.round((1 - clamp01(stdDev / MAX_REFERENCE_STD_DEV)) * 100);
}

/**
 * Gestion de la fatigue simulée sur l'ensemble du Tour : 100 = fatigue
 * simulée restée nulle tout du long, 0 = pénalité de fatigue maximale
 * subie en moyenne. Dérivée des états de fatigue déjà calculés, jamais une
 * mesure physiologique (voir fatigue.js).
 * @param {Array} stageResults
 * @returns {number|null}
 */
function computeFatigueManagement(stageResults) {
  const fatigueValues = stageResults.map((r) => r.fatigueBefore).filter((v) => v != null);
  if (fatigueValues.length === 0) return null;
  const avgFatigue = fatigueValues.reduce((a, b) => a + b, 0) / fatigueValues.length;
  return Math.round((1 - clamp01(avgFatigue)) * 100);
}

/**
 * Recense, par dimension, combien d'étapes du Tour auraient pu bénéficier
 * d'une meilleure documentation de cette dimension (voir consigne §12 :
 * "identifier précisément lesquelles").
 * @param {Array} stageResults
 * @returns {Array<{dimension: string, stageCount: number}>}
 */
function summarizeDocumentationGaps(stageResults) {
  const counts = new Map();
  for (const r of stageResults) {
    for (const dim of r.missingDimensions) {
      counts.set(dim, (counts.get(dim) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([dimension, stageCount]) => ({ dimension, stageCount }))
    .sort((a, b) => b.stageCount - a.stageCount);
}

/**
 * Résultat global du Tour simulé (voir consigne §10) — délibérément SANS
 * classement/position dans un peloton fictif : identifie plutôt les types
 * de terrain favorables/difficiles et la tendance globale de style.
 * @param {Array} stageResults - voir buildStageResult()
 * @param {import('../profile/profile.js').CyclistProfile|null} profile
 * @returns {Object}
 */
export function buildOverallResult(stageResults, profile) {
  return {
    consistency: computeConsistency(stageResults),
    mountainAffinity: averageAffinityForTypes(stageResults, ["mountain", "highMountain"]),
    flatAffinity: averageAffinityForTypes(stageResults, ["flat"]),
    hillyAffinity: averageAffinityForTypes(stageResults, ["hilly"]),
    timeTrialAffinity: averageAffinityForTypes(stageResults, ["timeTrial"]),
    fatigueManagement: computeFatigueManagement(stageResults),
    documentationGaps: summarizeDocumentationGaps(stageResults),
    // Réutilise TEL QUEL le moteur d'archétypes existant (voir consigne §11 :
    // "si une information existe déjà dans src/lib/archetypes/, réutilise-la")
    // — jamais un second système de tendance de style recalculé ici.
    profileArchetype: matchArchetypes(profile),
  };
}
