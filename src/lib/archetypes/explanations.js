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

  const lowConfidenceDims = availableDims.filter((d) => vector[d].confidenceLabel === "low");

  const sentences = [
    `Ton profil actuel montre : ${ranked.join(", ")}.`,
    `Cela rapproche structurellement ton profil du style ${label}, sur les ${availableDims.length} dimension${availableDims.length > 1 ? "s" : ""} actuellement disponible${availableDims.length > 1 ? "s" : ""}.`,
  ];

  // Signale explicitement quand une dimension à confiance faible a quand
  // même contribué (avec un poids réduit, voir archetypeProfile.js:
  // matchingWeight) — pour que l'utilisateur comprenne qu'un score visible
  // élevé sur cette dimension n'a pas fortement déplacé le résultat.
  if (lowConfidenceDims.length > 0) {
    const list = lowConfidenceDims.map((d) => dimensionLabel(d)).join(", ");
    sentences.push(
      `${lowConfidenceDims.length > 1 ? "Les dimensions" : "La dimension"} ${list} ${lowConfidenceDims.length > 1 ? "reposent" : "repose"} sur des preuves encore limitées : ${lowConfidenceDims.length > 1 ? "elles ont" : "elle a"} peu influencé ce résultat.`
    );
  }

  sentences.push("Cette comparaison porte sur la forme du profil, pas sur un niveau de performance.");
  return sentences;
}

/**
 * Explique pourquoi AUCUN archétype n'est proposé avec confiance (voir
 * consigne : préférer "Profil indéterminé" à un faux matching précis quand
 * les dimensions réellement fiables sont trop peu nombreuses). Construite à
 * partir des vraies dimensions disponibles/manquantes, jamais un texte figé.
 *
 * @param {Object} vector - voir archetypeProfile.js: buildMatchingVector()
 * @param {string[]} availableDims
 * @param {string[]} missingDims
 * @param {{label: string}} matchConfidence - voir archetypes/confidence.js: computeMatchConfidence()
 * @returns {string[]}
 */
export function explainInsufficientMatch(vector, availableDims, missingDims, matchConfidence) {
  const sentences = [];

  if (availableDims.length > 0) {
    const describedDims = availableDims
      .map((d) => `${dimensionLabel(d)} (${vector[d].confidenceLabel === "low" ? "preuves limitées" : "confiance " + vector[d].confidenceLabel})`)
      .join(", ");
    sentences.push(`Dimensions disponibles pour l'instant : ${describedDims}.`);
  }

  if (missingDims.length > 0) {
    sentences.push(`Données insuffisantes pour : ${missingDims.map(dimensionLabel).join(", ")}.`);
  }

  sentences.push(
    "Un score élevé isolé, avec peu de preuves derrière, ne suffit pas à proposer un archétype affirmatif : plus de sorties (et si possible un capteur de puissance) affineront ce résultat."
  );

  return sentences;
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
