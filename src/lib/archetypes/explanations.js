/**
 * Génère les phrases d'explication d'un match (archétype ou coureur) à
 * partir des données réelles du vecteur de matching — jamais de texte figé
 * par archétype/coureur qui ignorerait les valeurs actuelles de
 * l'utilisateur. Vocabulaire volontairement prudent (voir consigne §17) :
 * "structure proche", jamais "tu es X".
 */

import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";

const DIMENSION_LABELS = {
  endurance: "endurance",
  climbing: "grimpe",
  punch: "punch",
  sprint: "sprint",
  timeTrial: "contre-la-montre",
  technical: "technique",
};

function levelWord(value) {
  if (value >= 80) return "élevé";
  if (value >= 60) return "assez élevé";
  if (value >= 40) return "modéré";
  if (value >= 20) return "plus faible";
  return "faible";
}

function dimensionLabel(dim) {
  return DIMENSION_LABELS[dim] || dim;
}

/**
 * @param {Object} vector - voir archetypeProfile.js: buildMatchingVector()
 * @param {Object|null} primary - archétype principal (avec `closeness`)
 * @param {Object|null} secondary - archétype secondaire éventuel
 * @param {string[]} availableDims - dimensions utilisées pour le matching
 * @returns {string[]} phrases, dans l'ordre d'affichage
 */
export function explainArchetypeMatch(vector, primary, secondary, availableDims) {
  if (!primary || !availableDims || availableDims.length === 0) return [];

  const ranked = availableDims
    .slice()
    .sort((a, b) => vector[b].value - vector[a].value)
    .slice(0, 3)
    .map((d) => `${dimensionLabel(d)} ${levelWord(vector[d].value)} (${vector[d].value})`);

  const label = secondary ? `${primary.name} / ${secondary.name}` : primary.name;

  return [
    `Ton profil actuel montre : ${ranked.join(", ")}.`,
    `Cela rapproche structurellement ton profil du style ${label}, sur les ${availableDims.length} dimension${availableDims.length > 1 ? "s" : ""} actuellement disponible${availableDims.length > 1 ? "s" : ""}.`,
    "Cette comparaison porte sur la forme du profil, pas sur un niveau de performance.",
  ];
}

/**
 * @param {Object} vector - voir archetypeProfile.js: buildMatchingVector()
 * @param {Object} rider - voir references.js
 * @param {string[]} matchedDimensions - dimensions communes utilisées pour ce match
 * @param {string[]} missingDimensions - dimensions qui manquent (côté utilisateur OU côté coureur) pour affiner
 * @returns {string[]}
 */
export function explainRiderMatch(vector, rider, matchedDimensions, missingDimensions) {
  if (!matchedDimensions || matchedDimensions.length === 0) return [];

  const parts = matchedDimensions
    .slice()
    .sort((a, b) => vector[b].value - vector[a].value)
    .map((d) => `${dimensionLabel(d)} ${levelWord(vector[d].value)}`);

  const sentences = [
    `Ton profil et celui de ${rider.name} présentent une structure proche sur : ${parts.join(", ")}.`,
    `Le matching utilise ${matchedDimensions.length} dimension${matchedDimensions.length > 1 ? "s" : ""} disponible${matchedDimensions.length > 1 ? "s" : ""}.`,
  ];

  if (missingDimensions && missingDimensions.length > 0) {
    sentences.push(`Dimensions manquantes pour affiner la comparaison : ${missingDimensions.map(dimensionLabel).join(", ")}.`);
  }

  sentences.push("Cette comparaison porte sur le profil de spécialités, pas sur le niveau de performance.");
  return sentences;
}

export { DIMENSION_LABELS, ARCHETYPE_DIMENSIONS };
