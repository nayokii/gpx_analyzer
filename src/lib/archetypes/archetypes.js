/**
 * Archétypes cyclistes — profils vectoriels THÉORIQUES sur les 6 dimensions
 * du moteur de profil (Phase 6A) qui décrivent un STYLE de course, pas la
 * régularité de pratique : `consistency` (fréquence des sorties) est
 * délibérément exclue de ce vecteur, ce n'est pas un trait de style.
 *
 * Ces valeurs sont des POSITIONS RELATIVES sur l'échelle interne 0-100 déjà
 * utilisée par le profil 6A (voir profile/normalization.js) — pas des
 * performances réelles, pas des watts, pas un niveau. Chaque archétype est
 * une forme caricaturale/théorique documentée ci-dessous, construite par
 * raisonnement qualitatif (pas calibrée sur des données réelles) : c'est un
 * REPÈRE DE STRUCTURE, pas une vérité physiologique.
 */

export const ARCHETYPE_DIMENSIONS = ["endurance", "climbing", "punch", "sprint", "timeTrial", "technical"];

// Paliers qualitatifs partagés par tous les archétypes ci-dessous, pour que
// "élevé" signifie toujours la même chose d'un archétype à l'autre.
export const LEVELS = {
  LOW: 20,
  LOW_MEDIUM: 35,
  MEDIUM: 50,
  MEDIUM_HIGH: 65,
  HIGH: 80,
  VERY_HIGH: 92,
};
const { LOW, LOW_MEDIUM, MEDIUM, MEDIUM_HIGH, HIGH, VERY_HIGH } = LEVELS;

export const ARCHETYPES = [
  {
    id: "climber",
    name: "Grimpeur",
    description: "Profil orienté montée soutenue et gestion de l'effort sur la durée en ascension.",
    // Grimpe dominante, portée par une bonne endurance (les ascensions longues
    // exigent de tenir l'effort) ; sprint et technique volontairement bas —
    // un grimpeur pur n'est pas défini par ces qualités.
    dimensions: { endurance: HIGH, climbing: VERY_HIGH, punch: MEDIUM, sprint: LOW, timeTrial: MEDIUM, technical: LOW_MEDIUM },
  },
  {
    id: "puncheur",
    name: "Puncheur",
    description: "Profil orienté efforts courts et intenses, changements de rythme répétés.",
    dimensions: { endurance: MEDIUM, climbing: MEDIUM_HIGH, punch: VERY_HIGH, sprint: MEDIUM_HIGH, timeTrial: MEDIUM, technical: MEDIUM },
  },
  {
    id: "rouleur",
    name: "Rouleur",
    description: "Profil orienté effort soutenu et régulier sur la durée, typique du rouleur/contre-la-montre.",
    dimensions: { endurance: HIGH, climbing: MEDIUM, punch: MEDIUM, sprint: LOW_MEDIUM, timeTrial: VERY_HIGH, technical: LOW_MEDIUM },
  },
  {
    id: "sprinter",
    name: "Sprinteur",
    description: "Profil orienté pointe de vitesse et puissance de très courte durée.",
    dimensions: { endurance: LOW_MEDIUM, climbing: LOW, punch: HIGH, sprint: VERY_HIGH, timeTrial: LOW_MEDIUM, technical: LOW_MEDIUM },
  },
  {
    id: "endurance",
    name: "Endurance",
    description: "Profil orienté sorties longues et gestion de l'effort dans la durée, sans pic dominant.",
    dimensions: { endurance: VERY_HIGH, climbing: MEDIUM, punch: LOW_MEDIUM, sprint: LOW, timeTrial: MEDIUM, technical: LOW_MEDIUM },
  },
  {
    id: "all_rounder",
    name: "All-rounder",
    description: "Profil sans dominante marquée, relativement équilibré entre les dimensions.",
    // Volontairement centré autour de "assez élevé partout" plutôt qu'un pic :
    // c'est la définition même de ce profil.
    dimensions: { endurance: MEDIUM_HIGH, climbing: MEDIUM_HIGH, punch: MEDIUM_HIGH, sprint: MEDIUM, timeTrial: MEDIUM_HIGH, technical: MEDIUM },
  },
  {
    id: "technical_mtb",
    name: "Technical MTB",
    description: "Profil orienté terrain technique et irrégulier, VTT/gravel.",
    dimensions: { endurance: MEDIUM, climbing: MEDIUM, punch: MEDIUM_HIGH, sprint: LOW_MEDIUM, timeTrial: LOW_MEDIUM, technical: VERY_HIGH },
  },
];

/** @param {string} id @returns {Object|null} */
export function getArchetypeById(id) {
  return ARCHETYPES.find((a) => a.id === id) || null;
}
