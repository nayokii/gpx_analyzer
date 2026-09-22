/**
 * Point d'entrée public du module archétypes — l'UI (ArchetypeView.jsx,
 * AlterEgoView.jsx) importe depuis ce fichier plutôt que depuis les modules
 * internes, pour garder une seule surface d'API stable.
 */
export { ARCHETYPES, ARCHETYPE_DIMENSIONS, LEVELS, getArchetypeById } from "./archetypes.js";
export { REFERENCE_RIDERS, getRiderById } from "./references.js";
export { buildMatchingVector, availableDimensions, missingDimensions } from "./archetypeProfile.js";
export { computeMatchConfidence } from "./confidence.js";
export { matchArchetypes, matchReferenceRiders, buildArchetypeTimeline, similarityLabel } from "./matching.js";
export { explainArchetypeMatch, explainRiderMatch } from "./explanations.js";
