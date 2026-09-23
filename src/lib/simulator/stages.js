/**
 * Modèle d'étape générique — Tour Simulator (Phase 10A).
 *
 * Une `Stage` est un objet de données pur, indépendant de toute source
 * externe (voir consigne §13 : aucune dépendance web, aucun parcours réel
 * dans cette phase — un parcours réel pourra être injecté plus tard tant
 * qu'il respecte cette même forme). Ses 6 caractéristiques de dimension
 * (`endurance`/`climbing`/`punch`/`sprint`/`timeTrial`/`technical`, voir
 * STAGE_TYPE_DIMENSIONS) sont normalisées 0-1 et représentent à quel point
 * CHAQUE dimension du profil cycliste est déterminante pour RÉUSSIR cette
 * étape précise — ce sont des poids d'importance, jamais une prédiction de
 * temps ou de vitesse.
 */

import { STAGE_TYPES, STAGE_TYPE_DIMENSIONS, getStageTypeProfile } from "./stageTypes.js";

/** Distance de référence (km) au-delà de laquelle la distance seule ne rend
 * plus l'étape "plus difficile" pour le modèle de difficulté ci-dessous —
 * une borne de mise à l'échelle documentée, pas une donnée de course réelle. */
const REFERENCE_LONG_DISTANCE_KM = 220;
/** Part de la difficulté d'étape venant du type de terrain vs de la distance
 * (voir `computeDifficulty`) — documenté ici pour ne jamais être un nombre
 * magique caché dans un calcul. */
const DIFFICULTY_TYPE_WEIGHT = 0.65;
const DIFFICULTY_DISTANCE_WEIGHT = 1 - DIFFICULTY_TYPE_WEIGHT;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Difficulté globale d'étape (0-1), utilisée par fatigue.js. Combine le
 * `fatigueFactor` documenté du type de terrain et la distance (une étape
 * plus longue reste plus exigeante même à terrain égal) — jamais une
 * mesure physiologique, un simple mélange pondéré et documenté.
 * @param {string} typeId
 * @param {number} distanceKm
 * @returns {number} 0-1
 */
export function computeDifficulty(typeId, distanceKm) {
  const type = getStageTypeProfile(typeId);
  const typeFactor = type ? type.fatigueFactor : 0.5;
  const distanceFactor = clamp01((distanceKm || 0) / REFERENCE_LONG_DISTANCE_KM);
  return clamp01(DIFFICULTY_TYPE_WEIGHT * typeFactor + DIFFICULTY_DISTANCE_WEIGHT * distanceFactor);
}

/**
 * Construit une étape à partir d'un type connu, avec ses caractéristiques
 * par défaut (voir stageTypes.js), surchargeables au cas par cas (ex. une
 * étape de montagne particulièrement dure).
 *
 * @param {Object} params
 * @param {string} params.id
 * @param {string} params.name
 * @param {string} params.type - une clé de STAGE_TYPES
 * @param {number} params.distanceKm
 * @param {Object} [params.dimensionOverrides] - `{[dim]: 0-1}`, remplace ponctuellement une ou plusieurs valeurs par défaut du type
 * @param {number} [params.difficulty] - remplace la difficulté calculée par défaut si fourni
 * @returns {import('./stages.js').Stage}
 */
export function createStage({ id, name, type, distanceKm, dimensionOverrides = {}, difficulty }) {
  const typeProfile = getStageTypeProfile(type);
  if (!typeProfile) throw new Error(`Type d'étape inconnu : "${type}". Types valides : ${Object.keys(STAGE_TYPES).join(", ")}.`);
  if (!id || !name) throw new Error("Une étape nécessite un id et un name.");
  if (!(distanceKm > 0)) throw new Error("distanceKm doit être un nombre positif.");

  const stage = { id, name, type, distanceKm };
  for (const dim of STAGE_TYPE_DIMENSIONS) {
    const value = dim in dimensionOverrides ? dimensionOverrides[dim] : typeProfile.dimensions[dim];
    stage[dim] = clamp01(value);
  }
  stage.difficulty = difficulty != null ? clamp01(difficulty) : computeDifficulty(type, distanceKm);
  return stage;
}

/**
 * Vérifie qu'un objet a bien la forme d'une `Stage` exploitable par le
 * simulateur (voir consigne §14 : "aucune valeur hors 0-1").
 * @param {any} stage
 * @returns {boolean}
 */
export function isValidStage(stage) {
  if (!stage || typeof stage !== "object") return false;
  if (typeof stage.id !== "string" || !stage.id) return false;
  if (typeof stage.name !== "string" || !stage.name) return false;
  if (!STAGE_TYPES[stage.type]) return false;
  if (!(stage.distanceKm > 0)) return false;
  for (const dim of STAGE_TYPE_DIMENSIONS) {
    const v = stage[dim];
    if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 1) return false;
  }
  if (typeof stage.difficulty !== "number" || stage.difficulty < 0 || stage.difficulty > 1) return false;
  return true;
}

/**
 * Petit Tour fictif de 6 étapes pour les tests et la démonstration du moteur
 * (voir consigne §13). Distances plausibles pour un Grand Tour générique,
 * choisies arbitrairement — PAS le tracé d'une course réelle.
 * @returns {import('./stages.js').Stage[]}
 */
export function createGenericTour() {
  return [
    createStage({ id: "stage-1", name: "Étape 1 — Plat", type: "flat", distanceKm: 180 }),
    createStage({ id: "stage-2", name: "Étape 2 — Vallonné", type: "hilly", distanceKm: 165 }),
    createStage({ id: "stage-3", name: "Étape 3 — Montagne", type: "mountain", distanceKm: 155 }),
    createStage({ id: "stage-4", name: "Étape 4 — Plat", type: "flat", distanceKm: 195 }),
    createStage({ id: "stage-5", name: "Étape 5 — Contre-la-montre", type: "timeTrial", distanceKm: 32 }),
    createStage({ id: "stage-6", name: "Étape 6 — Haute montagne", type: "highMountain", distanceKm: 148 }),
  ];
}
