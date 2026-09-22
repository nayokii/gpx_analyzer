/**
 * Base LOCALE et versionnée de coureurs professionnels de référence (voir
 * consigne §26 : pas de scraping dynamique, tout est statique dans ce
 * fichier).
 *
 * CE QUE CES DONNÉES SONT : une conversion STYLISÉE et QUALITATIVE de la
 * réputation publique/sportive de chaque coureur (spécialités documentées :
 * classements UCI par spécialité, palmarès, type de courses gagnées) en un
 * vecteur relatif 0-100 sur les mêmes 6 dimensions que archetypes.js — la
 * même échelle interne que le profil 6A, jamais des watts, un FTP, un
 * VO2max ou un classement de performance.
 *
 * CE QUE CES DONNÉES NE SONT PAS : des statistiques physiologiques privées,
 * un classement de "meilleur coureur", ou une affirmation de fait
 * scientifique. Une dimension reste `null` quand elle n'est pas documentée
 * publiquement pour ce coureur (ex. `technical` pour un rouleur de route pur
 * — on ne sait pas ce que vaudrait son pilotage en terrain technique, donc
 * on ne l'invente pas, exactement comme le profil 6A traite une dimension
 * sans preuve).
 *
 * SOURCES : procyclingstats.com (base de statistiques cyclisme publique,
 * classements par spécialité — Climber/GC/TT/Sprint/Oneday/Hills — et
 * palmarès) pour chaque coureur, voir `sources` par entrée. Les URLs ont été
 * vérifiées manuellement. Quand une spécialité est ambiguë ou peu
 * documentée pour un coureur donné, la dimension correspondante est laissée
 * `null` plutôt que codée comme un fait certain (voir consigne §7).
 */

const PCS = (slug) => ({ label: "ProCyclingStats", url: `https://www.procyclingstats.com/rider/${slug}` });

export const REFERENCE_RIDERS = [
  {
    id: "nairo-quintana",
    name: "Nairo Quintana",
    discipline: "road",
    specialties: ["climbing", "stage_racing"],
    profile: { endurance: 80, climbing: 92, punch: 50, sprint: 20, timeTrial: 35, technical: null },
    description: "Grimpeur colombien, plusieurs podiums/victoires sur les grands tours par étapes, réputé pour sa capacité à attaquer en haute montagne.",
    sources: [PCS("nairo-quintana")],
  },
  {
    id: "tadej-pogacar",
    name: "Tadej Pogačar",
    discipline: "road",
    specialties: ["climbing", "stage_racing", "classics", "time_trial"],
    profile: { endurance: 85, climbing: 92, punch: 80, sprint: 45, timeTrial: 80, technical: null },
    description: "Coureur slovène au palmarès très large (grands tours, classiques, contre-la-montre), profil rarement spécialisé sur une seule dimension.",
    sources: [PCS("tadej-pogacar")],
  },
  {
    id: "jonas-vingegaard",
    name: "Jonas Vingegaard",
    discipline: "road",
    specialties: ["climbing", "stage_racing"],
    profile: { endurance: 90, climbing: 92, punch: 50, sprint: 20, timeTrial: 65, technical: null },
    description: "Grimpeur danois spécialiste des grands tours, connu pour sa régularité en haute montagne sur plusieurs semaines de course.",
    sources: [PCS("jonas-vingegaard")],
  },
  {
    id: "mathieu-van-der-poel",
    name: "Mathieu van der Poel",
    discipline: "road",
    specialties: ["punch", "classics", "cyclocross"],
    profile: { endurance: 65, climbing: 50, punch: 92, sprint: 80, timeTrial: 50, technical: 80 },
    description: "Multi-spécialiste (route, cyclocross, VTT), réputé pour ses accélérations en classiques et son pilotage en terrain technique (issu du cyclocross).",
    sources: [PCS("mathieu-van-der-poel")],
  },
  {
    id: "julian-alaphilippe",
    name: "Julian Alaphilippe",
    discipline: "road",
    specialties: ["punch", "classics"],
    profile: { endurance: 55, climbing: 65, punch: 92, sprint: 60, timeTrial: 35, technical: 35 },
    description: "Puncheur français, plusieurs victoires en classiques ardennaises et championnats du monde, profil d'attaquant sur circuits vallonnés.",
    sources: [PCS("julian-alaphilippe")],
  },
  {
    id: "wout-van-aert",
    name: "Wout van Aert",
    discipline: "road",
    specialties: ["punch", "classics", "sprint", "cyclocross"],
    profile: { endurance: 75, climbing: 55, punch: 85, sprint: 80, timeTrial: 65, technical: 80 },
    description: "Belge multi-spécialiste (classiques, sprints massifs, cyclocross), profil parmi les plus polyvalents du peloton.",
    sources: [PCS("wout-van-aert")],
  },
  {
    id: "mark-cavendish",
    name: "Mark Cavendish",
    discipline: "road",
    specialties: ["sprint"],
    profile: { endurance: 50, climbing: 20, punch: 50, sprint: 95, timeTrial: 30, technical: null },
    description: "Sprinteur pur britannique, l'un des plus grands vainqueurs d'étapes en sprint massif de l'histoire du cyclisme sur route.",
    sources: [PCS("mark-cavendish")],
  },
  {
    id: "jasper-philipsen",
    name: "Jasper Philipsen",
    discipline: "road",
    specialties: ["sprint", "classics"],
    profile: { endurance: 55, climbing: 20, punch: 65, sprint: 95, timeTrial: 35, technical: null },
    description: "Sprinteur belge, performant aussi bien en sprint massif qu'en classiques pavées disputées au sprint.",
    sources: [PCS("jasper-philipsen")],
  },
  {
    id: "filippo-ganna",
    name: "Filippo Ganna",
    discipline: "road",
    specialties: ["time_trial"],
    profile: { endurance: 75, climbing: 30, punch: 50, sprint: 55, timeTrial: 95, technical: null },
    description: "Rouleur italien, champion du monde du contre-la-montre à plusieurs reprises, référence de la discipline.",
    sources: [PCS("filippo-ganna")],
  },
  {
    id: "remco-evenepoel",
    name: "Remco Evenepoel",
    discipline: "road",
    specialties: ["time_trial", "climbing", "stage_racing"],
    profile: { endurance: 80, climbing: 80, punch: 65, sprint: 35, timeTrial: 92, technical: null },
    description: "Coureur belge combinant contre-la-montre de très haut niveau et solides qualités de grimpeur sur les tours par étapes.",
    sources: [PCS("remco-evenepoel")],
  },
  {
    id: "primoz-roglic",
    name: "Primož Roglič",
    discipline: "road",
    specialties: ["time_trial", "climbing", "stage_racing"],
    profile: { endurance: 80, climbing: 80, punch: 60, sprint: 35, timeTrial: 85, technical: null },
    description: "Coureur slovène, ancien sauteur à ski, plusieurs victoires sur les grands tours combinant montagne et contre-la-montre.",
    sources: [PCS("primoz-roglic")],
  },
  {
    id: "peter-sagan",
    name: "Peter Sagan",
    discipline: "road",
    specialties: ["punch", "sprint", "classics"],
    profile: { endurance: 65, climbing: 35, punch: 80, sprint: 80, timeTrial: 50, technical: 50 },
    description: "Coureur slovaque au style très polyvalent (classiques, sprints, ex-pratiquant de VTT en junior), triple champion du monde sur route.",
    sources: [PCS("peter-sagan")],
  },
  {
    id: "egan-bernal",
    name: "Egan Bernal",
    discipline: "road",
    specialties: ["climbing", "stage_racing"],
    profile: { endurance: 75, climbing: 80, punch: 50, sprint: 20, timeTrial: 60, technical: null },
    description: "Grimpeur colombien, vainqueur d'un grand tour, profil de leader d'équipe en montagne.",
    sources: [PCS("egan-bernal")],
  },
  {
    id: "richard-carapaz",
    name: "Richard Carapaz",
    discipline: "road",
    specialties: ["climbing", "stage_racing"],
    profile: { endurance: 75, climbing: 80, punch: 50, sprint: 20, timeTrial: 50, technical: null },
    description: "Grimpeur équatorien, vainqueur d'un grand tour, régulièrement performant en haute montagne sur plusieurs semaines.",
    sources: [PCS("richard-carapaz")],
  },
  {
    id: "pauline-ferrand-prevot",
    name: "Pauline Ferrand-Prévot",
    discipline: "multi",
    specialties: ["technical", "climbing", "cyclocross", "mtb"],
    profile: { endurance: 80, climbing: 80, punch: 65, sprint: 50, timeTrial: 50, technical: 92 },
    description: "Championne française multi-disciplines (route, VTT cross-country, cyclocross), titrée championne du monde dans plusieurs disciplines la même saison.",
    sources: [PCS("pauline-ferrand-prevot")],
  },
  {
    id: "nino-schurter",
    name: "Nino Schurter",
    discipline: "mtb",
    specialties: ["technical", "mtb"],
    profile: { endurance: 75, climbing: 65, punch: 65, sprint: 35, timeTrial: 35, technical: 92 },
    description: "Coureur suisse de VTT cross-country, l'un des plus titrés de l'histoire de la discipline (plusieurs titres mondiaux et olympiques).",
    sources: [PCS("nino-schurter")],
  },
  {
    id: "annemiek-van-vleuten",
    name: "Annemiek van Vleuten",
    discipline: "road",
    specialties: ["climbing", "endurance", "time_trial"],
    profile: { endurance: 92, climbing: 80, punch: 50, sprint: 20, timeTrial: 80, technical: null },
    description: "Coureuse néerlandaise réputée pour ses longues attaques solitaires et sa capacité à tenir l'effort sur de très longues distances.",
    sources: [PCS("annemiek-van-vleuten")],
  },
  {
    id: "marianne-vos",
    name: "Marianne Vos",
    discipline: "multi",
    specialties: ["punch", "sprint", "classics", "cyclocross", "track"],
    profile: { endurance: 75, climbing: 50, punch: 80, sprint: 80, timeTrial: 50, technical: 50 },
    description: "Coureuse néerlandaise au palmarès exceptionnellement large (route, piste, cyclocross), souvent citée comme l'une des cyclistes les plus complètes.",
    sources: [PCS("marianne-vos")],
  },
];

/** @param {string} id @returns {Object|null} */
export function getRiderById(id) {
  return REFERENCE_RIDERS.find((r) => r.id === id) || null;
}
