/**
 * Classification d'un chemin OpenStreetMap (tags) en catégorie de terrain, et indices techniques EXPLICITES.
 *
 * Catégories : "road" (route / voie revêtue), "track" (piste ou chemin carrossable non revêtu), "trail" (sentier).
 * `null` = type de voie non interprétable (jamais deviné).
 *
 * Règles (volontairement prudentes) :
 *  - une surface explicitement revêtue (asphalt, concrete, paving_stones…) donne « road », quel que soit `highway`
 *    (un `path` ou un `footway` goudronné n'est pas un sentier VTT) ;
 *  - `track` non revêtu → « track » ; `path`/`bridleway` non revêtus → « trail » ;
 *  - `footway` : trottoirs et passages piétons (`footway=sidewalk|crossing…`) ignorés ; un `footway` sans surface non
 *    revêtue explicite reste NON classé (le plus souvent un cheminement urbain, pas un sentier) ; `steps` ignoré ;
 *  - une voie de circulation (`residential`, `tertiary`, `service`…) avec une surface explicitement non revêtue →
 *    « track » ; sans surface renseignée → « road » ;
 *  - `cycleway` sans surface renseignée → « road », avec surface non revêtue → « track ».
 *  - source IGN (voir ignConvert.js) : `ign:nature = "Route empierrée"` sans surface OSM renseignée → « track » ;
 *    toute surface explicite d'OpenStreetMap l'emporte sur cette interprétation.
 * La forêt (`landuse=forest`, `natural=wood`) n'intervient PAS : être en forêt ne dit rien du type de voie.
 */

const ROAD_HIGHWAYS = new Set([
  "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "road",
]);
const TRAIL_HIGHWAYS = new Set(["path", "footway", "bridleway"]);

const PAVED_SURFACES = new Set([
  "asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone",
  "unhewn_cobblestone", "chipseal", "bricks", "brick",
]);
const UNPAVED_SURFACES = new Set([
  "unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "ground", "dirt", "earth", "grass", "sand", "mud",
  "rock", "stone", "scree", "woodchips", "clay", "grass_paver",
]);

/**
 * Tags qui renseignent réellement la DIFFICULTÉ d'un chemin (utilisés pour la confiance). `surface` n'en fait pas
 * partie : « dirt » ou « gravel » dit de quoi est fait le sol, pas si le passage est technique — un sentier dont
 * le seul tag est `surface` ne doit pas donner une confiance élevée.
 */
export const TECHNICAL_TAG_KEYS = ["mtb:scale", "sac_scale", "smoothness", "trail_visibility", "tracktype"];

/** Sous-ensemble de tags conservé en cache (le reste est inutile à l'analyse). */
export const KEPT_TAG_KEYS = ["highway", "footway", "surface", "tracktype", "smoothness", "sac_scale", "trail_visibility", "mtb:scale", "mtb:scale:uphill", "bicycle", "access"];

/** Cheminements piétons urbains (trottoirs, passages piétons…) : jamais un sentier VTT, ignorés au rattachement. */
const NON_RIDING_FOOTWAYS = new Set(["sidewalk", "crossing", "access_aisle", "traffic_island"]);

/**
 * @param {Object<string,string>} tags
 * @returns {"road"|"track"|"trail"|null}
 */
export function classifyWay(tags) {
  const hw = tags && tags.highway;
  if (!hw) return null;
  if (hw === "steps") return null;
  if (hw === "footway" && NON_RIDING_FOOTWAYS.has(tags.footway)) return null;
  const surface = tags.surface;
  if (surface && PAVED_SURFACES.has(surface)) return ROAD_HIGHWAYS.has(hw) || hw === "track" || hw === "cycleway" || TRAIL_HIGHWAYS.has(hw) ? "road" : null;
  const unpaved = !!surface && UNPAVED_SURFACES.has(surface);
  // Source IGN : « Route empierrée » (voie carrossable empierrée) est une piste, sauf si OpenStreetMap indique
  // explicitement une surface (revêtue : traitée plus haut ; non revêtue : traitée par les règles générales).
  if (!surface && tags["ign:nature"] === "Route empierrée") return "track";
  if (hw === "track") return "track";
  if (hw === "footway") return unpaved ? "trail" : null; // surface inconnue : on ne devine pas
  if (TRAIL_HIGHWAYS.has(hw)) return "trail";
  if (hw === "cycleway") return unpaved ? "track" : "road";
  if (ROAD_HIGHWAYS.has(hw)) return unpaved ? "track" : "road";
  return null;
}

/** @returns {boolean} true si le chemin porte au moins une information technique explicite. */
export function hasTechnicalTags(tags) {
  return TECHNICAL_TAG_KEYS.some((k) => tags && tags[k] != null && tags[k] !== "");
}
