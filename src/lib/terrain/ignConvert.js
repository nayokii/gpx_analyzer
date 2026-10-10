/**
 * Conversion des tronçons IGN BD TOPO (couche `BDTOPO_V3:troncon_de_route`) vers le format de chemins que consomment
 * classify.js, matching.js et difficulty.js : `{ id, tags, geom: [[lat, lon], …], src: "ign" }`.
 *
 * Principe : on ne FABRIQUE aucun tag OpenStreetMap que la source ne contient pas. La BD TOPO ne décrit ni le
 * revêtement, ni la praticabilité, ni la difficulté VTT : `surface`, `tracktype`, `smoothness`, `mtb:scale`,
 * `sac_scale` et `trail_visibility` ne sont donc JAMAIS produits ici (ils ne peuvent venir que d'OpenStreetMap, voir
 * merge.js). Ne sont produits que :
 *  - `highway` : correspondance de la valeur `nature` de l'IGN vers le type de voie le plus proche (tableau ci-dessous) ;
 *  - `ign:nature` : la valeur d'origine, pour que le classement et l'affichage puissent s'y référer sans qu'on la déforme.
 *
 * Champs réellement présents et utilisés (vérifiés par sondes réelles sur la Guadeloupe, la Réunion, la Corse, les Alpes
 * et Paris) : `nature`, `etat_de_l_objet`, `fictif`, `urbain`, `cleabs`, et la géométrie `geometrie` (GeoJSON
 * [lon, lat, altitude] ; l'altitude de la BD TOPO n'est pas conservée).
 */

/**
 * nature IGN → tags `highway` OSM les plus proches. `null` = non rattachable au réseau roulable (ignoré, jamais deviné).
 *  - « Route à 1 chaussée », « Route à 2 chaussées », « Rond-point », « Bretelle », « Échangeur » : voie de circulation
 *    sans classe précise → `road` (valeur OSM « classe inconnue »), qui reste « route » sans revêtement renseigné,
 *    exactement comme une route OSM sans tag `surface` ;
 *  - « Autoroute », « Quasi-autoroute », « Type autoroutier » : `motorway` ;
 *  - « Route empierrée » : voie carrossable dont l'IGN dit qu'elle est empierrée → `road` + `ign:nature` (le classement la
 *    range en « piste » sauf si OpenStreetMap indique explicitement une surface revêtue) ;
 *  - « Chemin » → `track` ; « Sentier » → `path` ; « Piste cyclable » → `cycleway` ;
 *  - « Escalier » → `steps` (ignoré par le classement) ; « Bac ou liaison maritime » → ignoré.
 */
export const IGN_NATURE_TO_HIGHWAY = {
  "Autoroute": "motorway",
  "Quasi-autoroute": "motorway",
  "Type autoroutier": "motorway",
  "Bretelle": "road",
  "Échangeur": "road",
  "Route à 2 chaussées": "road",
  "Route à 1 chaussée": "road",
  "Rond-point": "road",
  "Route empierrée": "road",
  "Chemin": "track",
  "Sentier": "path",
  "Piste cyclable": "cycleway",
  "Escalier": "steps",
  "Bac ou liaison maritime": null,
};

/**
 * Un « Sentier » en zone urbaine (`urbain = true`) est presque toujours un cheminement piéton (allée de parc, passage
 * entre immeubles : 286 sur 289 sentiers à Paris centre dans nos sondes, tous « physiquement impossibles » aux voitures).
 * Pour ne pas les compter comme sentiers VTT, ils sont mappés en `footway` : le classement les laisse non classés tant
 * qu'aucune surface non revêtue n'est renseignée (même prudence que pour OpenStreetMap).
 */
export function ignHighway(nature, urbain) {
  if (!Object.prototype.hasOwnProperty.call(IGN_NATURE_TO_HIGHWAY, nature)) return undefined; // nature inconnue
  const hw = IGN_NATURE_TO_HIGHWAY[nature];
  if (nature === "Sentier" && urbain === true) return "footway";
  return hw;
}

/** Identifiant numérique NÉGATIF (jamais en collision avec un id OSM) tiré de `cleabs` (« TRONROUT0000001170141851 »). */
export function ignWayId(cleabs, part = 0) {
  const digits = String(cleabs || "").replace(/\D+/g, "");
  const n = digits ? Number(digits.slice(-12)) : NaN;
  if (!Number.isFinite(n)) return null;
  return -(n * 10 + part);
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/**
 * @param {Object} feature - Feature GeoJSON d'un tronçon IGN
 * @returns {{ways: Array, drop: null|"geometry"|"inactive"|"fictif"|"nature"|"id", nature: string|null}}
 */
export function convertIgnFeature(feature) {
  const p = (feature && feature.properties) || {};
  const nature = p.nature == null ? null : String(p.nature);
  if (p.fictif === true) return { ways: [], drop: "fictif", nature };
  if (p.etat_de_l_objet != null && p.etat_de_l_objet !== "En service") return { ways: [], drop: "inactive", nature };
  const highway = ignHighway(nature, p.urbain);
  if (highway === undefined) return { ways: [], drop: "nature", nature }; // valeur inconnue : comptée, jamais devinée
  if (highway === null) return { ways: [], drop: "nature", nature };
  const parts = lineParts(feature.geometry);
  const ways = [];
  parts.forEach((coords, i) => {
    const geom = (coords || [])
      .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => [round5(c[1]), round5(c[0])]); // GeoJSON [lon, lat, z] → [lat, lon]
    const id = ignWayId(p.cleabs, i);
    if (geom.length >= 2 && id != null) ways.push({ id, tags: { highway, "ign:nature": nature }, geom, src: "ign" });
  });
  if (ways.length === 0) return { ways: [], drop: parts.length === 0 ? "geometry" : "id", nature };
  return { ways, drop: null, nature };
}

/**
 * Réponse GeoJSON de la Géoplateforme → chemins + bilan (rien n'est perdu sans être compté).
 * @returns {{ways: Array, latest: string|null, matched: number, returned: number, dropped: {fictif: number, inactive: number, geometry: number, id: number, nature: Object<string, number>}}}
 */
export function parseIgnResponse(json) {
  if (!json || !Array.isArray(json.features)) throw new Error("Réponse IGN inattendue.");
  const ways = [];
  const dropped = { fictif: 0, inactive: 0, geometry: 0, id: 0, nature: {} };
  for (const f of json.features) {
    const r = convertIgnFeature(f);
    if (r.drop === "nature") dropped.nature[r.nature || "(vide)"] = (dropped.nature[r.nature || "(vide)"] || 0) + 1;
    else if (r.drop) dropped[r.drop] += 1;
    ways.push(...r.ways);
  }
  const returned = json.features.length;
  // Date de dernière modification des tronçons réutilisés (mention de la source exigée par la Licence Ouverte)
  let latest = null;
  for (const f of json.features) { const d = f && f.properties && f.properties.date_modification; if (typeof d === "string" && (!latest || d > latest)) latest = d; }
  const matched = Number.isFinite(json.numberMatched) ? json.numberMatched : Number.isFinite(json.totalFeatures) ? json.totalFeatures : returned;
  return { ways, matched, returned, dropped, latest };
}
