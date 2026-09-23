/**
 * Profils génériques de types d'étape — Tour Simulator (Phase 10A).
 *
 * Chaque type documente, sur une échelle 0-1, à quel point CHAQUE dimension
 * du profil cycliste (voir ../profile/profile.js) est déterminante pour ce
 * type de terrain — c'est le facteur "importance_étape" utilisé par
 * `stageAffinity.js`. Ce ne sont PAS des données professionnelles réelles ni
 * des mesures : un raisonnement qualitatif documenté ligne par ligne,
 * exactement comme `archetypes/archetypes.js` le fait déjà pour les
 * archétypes de style (voir ce fichier pour le précédent direct).
 *
 * `fatigueFactor` (0-1) est le coût ludique de base de ce type de terrain
 * pour le modèle de fatigue simulée (voir fatigue.js) — encore une fois un
 * ordre de grandeur qualitatif documenté, jamais une donnée physiologique.
 *
 * Les 6 dimensions utilisées ici sont EXACTEMENT celles déjà utilisées pour
 * le matching d'archétype (voir archetypes/archetypes.js:
 * ARCHETYPE_DIMENSIONS) — `consistency` en est délibérément absente pour la
 * même raison : c'est une fréquence de pratique, pas un trait de style de
 * course.
 */

export const STAGE_TYPE_DIMENSIONS = ["endurance", "climbing", "punch", "sprint", "timeTrial", "technical"];

export const STAGE_TYPES = {
  flat: {
    id: "flat",
    label: "Plat",
    description: "Terrain plat, souvent joué au sprint massif en fin d'étape.",
    // Sprint dominant (arrivée groupée) ; endurance modérée (rythme régulier,
    // pas d'effort soutenu isolé) ; climbing/technical quasi nuls (peu ou pas
    // de relief) ; punch faible à modéré (quelques relances dans le peloton).
    dimensions: { endurance: 0.5, climbing: 0.1, punch: 0.25, sprint: 0.9, timeTrial: 0.1, technical: 0.05 },
    fatigueFactor: 0.3,
  },
  hilly: {
    id: "hilly",
    label: "Vallonné",
    description: "Succession de bosses courtes, terrain typique des classiques et des puncheurs.",
    // Punch élevé (relances répétées sur les bosses courtes) ; endurance
    // élevée (enchaînement des difficultés sur la durée) ; climbing modéré
    // (bosses courtes, pas de vraie ascension longue) ; sprint modéré (arrivée
    // parfois groupée si le final s'aplanit).
    dimensions: { endurance: 0.65, climbing: 0.5, punch: 0.8, sprint: 0.4, timeTrial: 0.15, technical: 0.2 },
    fatigueFactor: 0.55,
  },
  mountain: {
    id: "mountain",
    label: "Montagne",
    description: "Une ou plusieurs ascensions longues, arrivée le plus souvent en altitude.",
    // Climbing très élevé (cœur du profil de l'étape) ; endurance élevée
    // (gérer l'effort sur une ascension longue) ; punch modéré (attaques
    // possibles dans les pentes) ; sprint faible (rarement une arrivée groupée).
    dimensions: { endurance: 0.75, climbing: 0.9, punch: 0.5, sprint: 0.1, timeTrial: 0.2, technical: 0.15 },
    fatigueFactor: 0.75,
  },
  highMountain: {
    id: "highMountain",
    label: "Haute montagne",
    description: "Plusieurs cols de catégorie supérieure enchaînés — l'étape reine.",
    // Climbing au maximum ; endurance très élevée (durée + répétition des
    // efforts) ; punch modéré, sprint quasi nul (jamais d'arrivée groupée) ;
    // fatigueFactor le plus élevé du modèle (voir fatigue.js).
    dimensions: { endurance: 0.9, climbing: 0.95, punch: 0.4, sprint: 0.05, timeTrial: 0.15, technical: 0.2 },
    fatigueFactor: 0.95,
  },
  timeTrial: {
    id: "timeTrial",
    label: "Contre-la-montre",
    description: "Effort individuel chronométré, seul face au parcours.",
    // timeTrial au maximum par définition ; endurance élevée (effort soutenu
    // sur la durée du CLM) ; climbing variable selon le tracé (laissé modéré
    // par défaut, un CLM peut être plat ou vallonné) ; sprint/punch quasi nuls
    // (pas de peloton, pas de relance).
    dimensions: { endurance: 0.6, climbing: 0.3, punch: 0.1, sprint: 0.05, timeTrial: 0.95, technical: 0.1 },
    fatigueFactor: 0.55,
  },
  mixed: {
    id: "mixed",
    label: "Mixte",
    description: "Terrain varié sans dominante nette — un peu de tout.",
    // Volontairement proche du centre sur toutes les dimensions : aucune
    // qualité n'y est décisive plus qu'une autre (voir all_rounder dans
    // archetypes/archetypes.js pour le même principe appliqué à un style de
    // coureur plutôt qu'à un terrain).
    dimensions: { endurance: 0.6, climbing: 0.5, punch: 0.55, sprint: 0.45, timeTrial: 0.3, technical: 0.3 },
    fatigueFactor: 0.5,
  },
};

export const STAGE_TYPE_IDS = Object.keys(STAGE_TYPES);

/**
 * @param {string} typeId - une clé de STAGE_TYPES
 * @returns {Object|null}
 */
export function getStageTypeProfile(typeId) {
  return STAGE_TYPES[typeId] || null;
}
