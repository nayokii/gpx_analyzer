/**
 * Orchestration d'un Tour simulé — Tour Simulator (Phase 10A).
 *
 * Parcourt les étapes dans l'ordre, calcule l'affinité de style de chacune
 * (stageAffinity.js), applique la fatigue simulée accumulée (fatigue.js) et
 * une petite variation "forme du jour" (voir `dayVariance` ci-dessous),
 * produit un résultat par étape puis un résultat global (results.js).
 *
 * PERFORMANCE (voir consigne §15) : ce module ne consomme QUE `profile`
 * (déjà calculé par computeCyclistProfile(), jamais recalculé ici) et
 * `stages` (objets de données purs, voir stages.js) — jamais une `Activity`,
 * jamais `samples`, jamais un appel à computeCyclistProfile()/analytics.
 * Coût : O(étapes × 6 dimensions), pas O(étapes × échantillons GPS).
 *
 * SEED (voir consigne §8) : `simulateTour()` exige un `seed` explicite. La
 * seule source de non-déterminisme du moteur est la petite variation "forme
 * du jour" ci-dessous (± quelques points, JAMAIS assez pour changer la
 * catégorie d'affinité par elle-même à elle seule dans la plupart des cas) —
 * un mécanisme de jeu, pas une prédiction. Un PRNG seedé (mulberry32, aucune
 * dépendance externe) garantit que le même `seed` + le même profil + le même
 * Tour produisent TOUJOURS exactement le même résultat.
 */

import { computeStageAffinity } from "./stageAffinity.js";
import { createInitialFatigueState, computeStageFatigue, applyRecovery } from "./fatigue.js";
import { buildStageResult, buildOverallResult } from "./results.js";
import { isValidStage } from "./stages.js";

/** Amplitude maximale (points, sur un score 0-100) de la variation "forme du
 * jour" — volontairement modeste : un mécanisme de jeu qui nuance le
 * résultat, jamais une source d'aléa dominante. Documentée ici, pas cachée
 * dans le calcul. */
const MAX_DAY_VARIANCE = 6;

/**
 * Hash déterministe d'un seed (nombre ou chaîne) vers un entier 32 bits,
 * pour pouvoir accepter `seed: "mon-seed"` aussi bien que `seed: 42`.
 * @param {string|number} seed
 * @returns {number}
 */
function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * PRNG mulberry32 — rapide, sans dépendance, à état minimal. Domaine public
 * (implémentation largement documentée) ; retourne un générateur `() => [0,1)`.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Object} params
 * @param {import('../profile/profile.js').CyclistProfile|null} params.profile - résultat DÉJÀ CALCULÉ de computeCyclistProfile() — jamais recalculé ici
 * @param {import('./stages.js').Stage[]} params.stages - voir stages.js (createStage/createGenericTour)
 * @param {string|number} params.seed - obligatoire, garantit un résultat déterministe
 * @returns {{ stageResults: Array, overall: Object, seed: string|number }}
 */
export function simulateTour({ profile, stages, seed }) {
  if (seed == null) throw new Error("simulateTour() nécessite un `seed` explicite (voir consigne §8 : résultats déterministes).");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("simulateTour() nécessite un tableau `stages` non vide.");
  for (const stage of stages) {
    if (!isValidStage(stage)) throw new Error(`Étape invalide : ${stage && stage.id ? stage.id : "(sans id)"}.`);
  }

  const rng = mulberry32(hashSeed(seed));

  let fatigueState = createInitialFatigueState();
  const stageResults = [];

  for (const stage of stages) {
    const fatigueBefore = fatigueState;
    const affinity = computeStageAffinity(profile, stage);
    const dayVariance = affinity.score == null ? 0 : (rng() * 2 - 1) * MAX_DAY_VARIANCE;

    const fatigueAfterStage = computeStageFatigue(stage, fatigueBefore);
    const result = buildStageResult({ stage, affinity, fatigueBefore, fatigueAfter: fatigueAfterStage, dayVariance });
    stageResults.push(result);

    // Récupération entre deux étapes : l'état transmis à l'étape SUIVANTE
    // part de la fatigue post-étape, partiellement récupérée.
    fatigueState = applyRecovery(fatigueAfterStage);
  }

  const overall = buildOverallResult(stageResults, profile);

  return { stageResults, overall, seed };
}
