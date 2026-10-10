/**
 * Difficulté technique ESTIMÉE du terrain (0-100) — séparée du profil de terrain.
 *
 * Elle ne s'appuie que sur des indices réellement disponibles :
 *  1. Terrain (0-75) : moyenne, pondérée par la distance hors route, des points attribués à chaque tronçon selon
 *     sa catégorie (piste / sentier) et ses tags OSM EXPLICITES (mtb:scale, sac_scale, smoothness, trail_visibility,
 *     tracktype, surface). Un sentier sans aucun tag vaut un niveau de base modeste (jamais 0), avec une confiance réduite.
 *     Pas de double comptage : `mtb:scale:uphill` (qui décrit la raideur) est ignoré car la pente est comptée à part
 *     (composante 2) ; `smoothness` et `surface` décrivent la même rugosité du sol → on retient le plus fort des deux,
 *     pas leur somme ; `mtb:scale` et `sac_scale` décrivent le même obstacle → le plus fort des deux.
 *  2. Pente (0-15) : part de la distance hors route à plus de 10 % de pente (valeur absolue).
 *  3. Virages (0-10) : nombre de changements de direction marqués (≥ 45° sur ~50 m) par km hors route.
 * Le dénivelé total n'est PAS une difficulté technique et n'est pas utilisé.
 *
 * Ce que la carte ne dit pas : racines, pierres, boue réelle, adhérence, état du jour, exposition. Ces éléments ne
 * sont jamais « détectés » ici ; ils figurent dans les limites affichées.
 *
 * Seuils : < 30 « Facile », 30-54 « Modéré », ≥ 55 « Difficile ». Estimation du TERRAIN, pas de l'effort ressenti.
 */
import { angleDiffDeg } from "./geo.js";
import { hasTechnicalTags } from "./classify.js";

export const MIN_COVERAGE_FOR_DIFFICULTY = 0.5;
export const MIN_OFFROAD_M = 1000;
export const MIN_OFFROAD_SHARE = 0.2;
export const LEVEL_THRESHOLDS = { moderate: 30, hard: 55 };
const STEEP_GRADE_PCT = 10;
const SHARP_TURN_DEG = 45;

const TRACK_BASE = { grade1: 4, grade2: 8, grade3: 14, grade4: 20, grade5: 24 };
const TRACK_BASE_UNKNOWN = 10;
const TRAIL_BASE = 25;
const UNPAVED_ROAD_BASE = 6;

const SAC = { hiking: 0, mountain_hiking: 8, demanding_mountain_hiking: 18, alpine_hiking: 28, demanding_alpine_hiking: 36, difficult_alpine_hiking: 40 };
const MTB = { 0: 6, 1: 14, 2: 24, 3: 34, 4: 42, 5: 50, 6: 50 };
const SMOOTHNESS = { excellent: 0, good: 0, intermediate: 3, bad: 10, very_bad: 18, horrible: 26, very_horrible: 32, impassable: 40 };
const VISIBILITY = { excellent: 0, good: 0, intermediate: 3, bad: 10, horrible: 18, no: 24 };
const SURFACE = { sand: 8, mud: 10, rock: 10, pebblestone: 8, stone: 8, scree: 14, gravel: 2, grass: 2 };
const MODIFIER_CAP = 50;
const SEGMENT_CAP = 75;

/** Points techniques d'un tronçon hors route d'après SES tags (jamais d'après sa seule présence en forêt). */
export function segmentTechnicalPoints(category, tags) {
  const t = tags || {};
  let base;
  if (category === "trail") base = TRAIL_BASE;
  else if (t.highway === "track") base = TRACK_BASE[t.tracktype] ?? TRACK_BASE_UNKNOWN;
  else base = UNPAVED_ROAD_BASE; // voie de circulation à surface non revêtue
  const obstacle = Math.max(MTB[t["mtb:scale"]] ?? 0, SAC[t.sac_scale] ?? 0);
  const roughness = Math.max(SMOOTHNESS[t.smoothness] ?? 0, SURFACE[t.surface] ?? 0);
  const mods = obstacle + roughness + (VISIBILITY[t.trail_visibility] ?? 0);
  return Math.min(SEGMENT_CAP, base + Math.min(MODIFIER_CAP, mods));
}

export function difficultyLevel(score) {
  if (score >= LEVEL_THRESHOLDS.hard) return "hard";
  if (score >= LEVEL_THRESHOLDS.moderate) return "moderate";
  return "easy";
}
export const LEVEL_LABELS = { easy: "Facile", moderate: "Modéré", hard: "Difficile" };

function countSharpTurns(segments) {
  let turns = 0;
  for (let i = 0; i + 2 < segments.length; i++) {
    const a = segments[i];
    const m = segments[i + 1];
    const b = segments[i + 2];
    if (!a.category || a.category === "road" || !m.category || m.category === "road" || !b.category || b.category === "road") continue;
    if (a.heading == null || b.heading == null) continue;
    if (angleDiffDeg(a.heading, b.heading) >= SHARP_TURN_DEG) { turns += 1; i += 2; } // un virage n'est compté qu'une fois
  }
  return turns;
}

/**
 * @param {Array<{len: number, category: string|null, way: Object|null, grade: number|null, heading: number|null}>} segments
 * @param {{coverage: number, classifiedM: number}} summary - voir profile.js: summarizeTerrain
 * @returns {{
 *   status: "ok"|"insufficient"|"not_applicable", reason?: string,
 *   score?: number, level?: "easy"|"moderate"|"hard",
 *   confidence?: {label: "low"|"medium"|"high", tagRichness: number},
 *   components?: {terrain: number, slope: number, turns: number},
 *   factors?: Array<{key: string, label: string, weight: number}>
 * }}
 */
export function estimateDifficulty(segments, summary) {
  if (summary.coverage < MIN_COVERAGE_FOR_DIFFICULTY) {
    return { status: "insufficient", reason: "Couverture cartographique insuffisante : trop peu du tracé est rattaché à un chemin connu pour estimer la difficulté sans la fausser." };
  }
  const off = segments.filter((s) => s.category === "track" || s.category === "trail");
  const offM = off.reduce((a, s) => a + s.len, 0);
  if (offM < MIN_OFFROAD_M || summary.classifiedM <= 0 || offM / summary.classifiedM < MIN_OFFROAD_SHARE) {
    return { status: "not_applicable", reason: "Sortie essentiellement routière (ou trop peu de hors-route) : une difficulté technique VTT n'aurait pas de sens ici." };
  }

  // 1. Terrain
  let weighted = 0;
  let taggedM = 0;
  let trailM = 0;
  let mtbMaxScale = null;
  let mtbM = 0;
  let sacM = 0;
  let badSmoothM = 0;
  let badVisM = 0;
  let roughSurfM = 0;
  for (const s of off) {
    const tags = (s.way && s.way.tags) || {};
    weighted += segmentTechnicalPoints(s.category, tags) * s.len;
    if (hasTechnicalTags(tags)) taggedM += s.len;
    if (s.category === "trail") trailM += s.len;
    const mtb = tags["mtb:scale"];
    if (mtb != null && MTB[mtb] != null) { mtbM += s.len; mtbMaxScale = Math.max(mtbMaxScale ?? 0, Number(mtb)); }
    if (SAC[tags.sac_scale] > 0) sacM += s.len;
    if ((SMOOTHNESS[tags.smoothness] ?? 0) >= 10) badSmoothM += s.len;
    if ((VISIBILITY[tags.trail_visibility] ?? 0) >= 10) badVisM += s.len;
    if ((SURFACE[tags.surface] ?? 0) >= 8) roughSurfM += s.len;
  }
  const terrain = weighted / offM;

  // 2. Pente (seulement si l'altitude est disponible sur ces tronçons)
  const withGrade = off.filter((s) => s.grade != null);
  const gradeM = withGrade.reduce((a, s) => a + s.len, 0);
  const steepM = withGrade.filter((s) => Math.abs(s.grade) >= STEEP_GRADE_PCT).reduce((a, s) => a + s.len, 0);
  const steepShare = gradeM > 0 ? steepM / gradeM : 0;
  const slope = Math.min(15, steepShare * 50);

  // 3. Virages
  const turns = countSharpTurns(segments);
  const turnDensity = turns / (offM / 1000);
  const turnsPts = Math.min(10, turnDensity);

  const score = Math.round(Math.min(100, terrain + slope + turnsPts));
  const tagRichness = taggedM / offM;
  const gradeAvailable = gradeM / offM >= 0.5;

  let label = "low";
  if (summary.coverage >= 0.85 && tagRichness >= 0.6) label = "high";
  else if (summary.coverage >= 0.65 && tagRichness >= 0.3) label = "medium";
  if (!gradeAvailable && label === "high") label = "medium"; // sans altitude, un indice sur trois manque

  const km = (m) => (m / 1000).toFixed(1).replace(".", ",");
  const factors = [
    { key: "terrain", weight: terrain, label: `${Math.round((trailM / offM) * 100)} % du hors-route est en sentier (le reste en pistes/chemins).` },
  ];
  if (mtbM > 0) factors.push({ key: "mtb", weight: 40, label: `Échelle VTT (mtb:scale) renseignée sur ${km(mtbM)} km, niveau maximal ${mtbMaxScale}.` });
  if (sacM > 0) factors.push({ key: "sac", weight: 30, label: `Échelle de difficulté de randonnée (sac_scale) au-dessus de « hiking » sur ${km(sacM)} km.` });
  if (badSmoothM > 0) factors.push({ key: "smoothness", weight: 25, label: `Revêtement décrit comme dégradé (smoothness) sur ${km(badSmoothM)} km.` });
  if (badVisM > 0) factors.push({ key: "visibility", weight: 20, label: `Sentier peu visible (trail_visibility) sur ${km(badVisM)} km.` });
  if (roughSurfM > 0) factors.push({ key: "surface", weight: 15, label: `Surface cartographiée sable, boue, rocher ou pierres sur ${km(roughSurfM)} km.` });
  if (gradeAvailable && steepShare > 0.05) factors.push({ key: "slope", weight: slope, label: `${Math.round(steepShare * 100)} % du hors-route à plus de ${STEEP_GRADE_PCT} % de pente.` });
  if (turnDensity >= 2) factors.push({ key: "turns", weight: turnsPts, label: `${turnDensity.toFixed(1).replace(".", ",")} virages marqués par km hors route.` });
  if (!gradeAvailable) factors.push({ key: "no_elevation", weight: 0, label: "Altitude absente : la composante « pente » n'a pas pu être évaluée (la note peut être sous-estimée)." });
  if (tagRichness < 0.3) factors.push({ key: "sparse", weight: 0, label: "Peu de tags techniques sur ces chemins dans OpenStreetMap : l'estimation reste grossière." });
  factors.sort((a, b) => b.weight - a.weight);

  return {
    status: "ok",
    score,
    level: difficultyLevel(score),
    confidence: { label, tagRichness },
    components: { terrain: Math.round(terrain * 10) / 10, slope: Math.round(slope * 10) / 10, turns: Math.round(turnsPts * 10) / 10 },
    factors,
  };
}
