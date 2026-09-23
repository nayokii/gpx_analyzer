/**
 * Modèle de fatigue LUDIQUE ("simulationFatigue") — Tour Simulator (Phase 10A).
 *
 * IMPORTANT : ceci n'est PAS un modèle physiologique et ne prétend calculer
 * aucune fatigue réelle. C'est un mécanisme de JEU, simple, transparent et
 * déterministe, qui réduit temporairement l'affinité simulée après des
 * étapes difficiles enchaînées — pour que le Tour simulé ait un arc narratif
 * (plusieurs jours de montagne qui pèsent, un profil de rouleur qui souffre
 * en fin de semaine difficile) sans jamais être présenté comme une mesure
 * d'effort ou de récupération réelle. Voir simulation.js pour comment ce
 * mécanisme s'articule avec `computeStageAffinity()`.
 *
 * Toutes les constantes ci-dessous sont des choix de design documentés, pas
 * des données scientifiques calibrées.
 */

const FATIGUE_CARRYOVER = 0.55; // part de la fatigue de la veille qui persiste avant d'ajouter l'étape du jour
const STAGE_FATIGUE_GAIN = 0.5; // part de la difficulté d'étape (0-1, voir stages.js) qui s'ajoute à la fatigue
const CONSECUTIVE_DAY_BONUS = 0.05; // fatigue additionnelle par jour "difficile" consécutif
const MAX_CONSECUTIVE_BONUS_DAYS = 4; // au-delà, l'enchaînement ne pèse plus davantage (borne documentée)
const RECOVERY_FRACTION = 0.4; // part de la fatigue retirée par une récupération entre deux étapes
/** Difficulté (voir stages.js: Stage.difficulty) au-delà de laquelle une
 * étape compte comme "difficile" pour l'enchaînement de jours consécutifs. */
const DIFFICULT_STAGE_THRESHOLD = 0.6;
/** Réduction MAXIMALE (0-1) que la fatigue peut appliquer à un score
 * d'affinité — volontairement modeste : la fatigue simulée nuance le
 * résultat, elle ne l'écrase jamais (voir `fatiguePenalty`). */
const FATIGUE_MAX_PENALTY = 0.25;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * @returns {{fatigue: number, consecutiveDifficultDays: number}} état initial (aucune fatigue accumulée)
 */
export function createInitialFatigueState() {
  return { fatigue: 0, consecutiveDifficultDays: 0 };
}

/**
 * Fatigue accumulée après avoir couru `stage`, à partir de l'état précédent.
 * Fonction PURE et déterministe : mêmes entrées, même résultat.
 * @param {import('./stages.js').Stage} stage
 * @param {{fatigue: number, consecutiveDifficultDays: number}} [previousState]
 * @returns {{fatigue: number, consecutiveDifficultDays: number}}
 */
export function computeStageFatigue(stage, previousState = createInitialFatigueState()) {
  const prevFatigue = clamp01(previousState ? previousState.fatigue : 0);
  const prevStreak = Math.max(0, (previousState && previousState.consecutiveDifficultDays) || 0);
  const difficulty = clamp01(stage ? stage.difficulty ?? 0 : 0);

  const isDifficult = difficulty >= DIFFICULT_STAGE_THRESHOLD;
  const streak = isDifficult ? Math.min(prevStreak + 1, MAX_CONSECUTIVE_BONUS_DAYS) : 0;
  const streakBonus = streak * CONSECUTIVE_DAY_BONUS;

  const fatigue = clamp01(prevFatigue * FATIGUE_CARRYOVER + difficulty * STAGE_FATIGUE_GAIN + streakBonus);

  return { fatigue, consecutiveDifficultDays: streak };
}

/**
 * Récupération simulée entre deux étapes (jour de transfert/repos implicite
 * entre chaque étape du Tour). Ne remet jamais le compteur de jours
 * difficiles consécutifs à zéro à elle seule — seule une étape FACILE le
 * fait (voir `computeStageFatigue`) : une bonne nuit ne "réinitialise" pas
 * complètement l'enchaînement d'une semaine de montagne, dans ce modèle ludique.
 * @param {{fatigue: number, consecutiveDifficultDays: number}} [previousState]
 * @returns {{fatigue: number, consecutiveDifficultDays: number}}
 */
export function applyRecovery(previousState = createInitialFatigueState()) {
  const prevFatigue = clamp01(previousState ? previousState.fatigue : 0);
  return {
    fatigue: clamp01(prevFatigue * (1 - RECOVERY_FRACTION)),
    consecutiveDifficultDays: Math.max(0, (previousState && previousState.consecutiveDifficultDays) || 0),
  };
}

/**
 * Réduction (0 - `FATIGUE_MAX_PENALTY`) à appliquer à un score d'affinité
 * brut pour simuler l'effet de la fatigue accumulée — voir simulation.js.
 * @param {{fatigue: number}|null} fatigueState
 * @returns {number} 0 - FATIGUE_MAX_PENALTY
 */
export function fatiguePenalty(fatigueState) {
  return clamp01(fatigueState ? fatigueState.fatigue : 0) * FATIGUE_MAX_PENALTY;
}
