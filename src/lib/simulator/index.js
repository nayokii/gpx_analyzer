/**
 * API publique du Tour Simulator (Phase 10A) — voir README.md pour le détail
 * du modèle. Rien d'autre sous src/lib/simulator/ ne doit être importé
 * ailleurs dans l'application : les détails internes (formats intermédiaires
 * de stageTypes.js/stages.js/results.js) peuvent changer librement tant que
 * cette surface reste stable.
 */

export { computeStageAffinity, categorizeAffinity } from "./stageAffinity.js";
export { computeStageFatigue, applyRecovery, createInitialFatigueState } from "./fatigue.js";
export { simulateTour } from "./simulation.js";
export { getStageTypeProfile, STAGE_TYPES, STAGE_TYPE_IDS } from "./stageTypes.js";
export { createStage, createGenericTour, isValidStage } from "./stages.js";
export { categorizePerformanceBand } from "./results.js";
