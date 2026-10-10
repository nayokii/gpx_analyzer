/**
 * Provenance et qualité des données utilisées pour une analyse : ce qui vient de la carte (observé) est rapporté
 * SÉPARÉMENT de la difficulté (estimée). Rien ici ne modifie un classement ni une note.
 *
 * Quatre questions distinctes, quatre réponses distinctes :
 *  1. COUVERTURE : quelle part du tracé est rattachée à un chemin connu, et de quelle source ?
 *  2. TYPES DE VOIES : route / piste / sentier (déjà dans le profil), dont la part qui repose sur « Route empierrée » IGN ;
 *  3. TAGS TECHNIQUES : sur le hors-route, quelle part porte de vrais tags de technicité (OpenStreetMap seulement) ?
 *  4. CONFIANCE : celle de l'estimation de difficulté (difficulty.js), inchangée.
 */
import { hasTechnicalTags } from "./classify.js";

/**
 * @param {Array<{len: number, category: string|null, way: Object|null}>} segments - voir matching.js
 * @returns {{
 *   matchedM: {ign: number, osm: number}, enrichedM: number,
 *   offroadM: number, technicalM: number, technicalShare: number|null,
 *   ignEmpierreeM: number, ignEmpierreeShare: number|null,
 * }}
 */
export function buildProvenance(segments) {
  const matchedM = { ign: 0, osm: 0 };
  let enrichedM = 0;
  let offroadM = 0;
  let technicalM = 0;
  let ignEmpireeM = 0;
  for (const s of segments) {
    if (!s.way || !s.category) continue;
    const src = s.way.src === "ign" ? "ign" : "osm";
    matchedM[src] += s.len;
    if (s.way.enrichedKeys && s.way.enrichedKeys.length) enrichedM += s.len;
    if (s.category === "track" || s.category === "trail") {
      offroadM += s.len;
      if (hasTechnicalTags(s.way.tags)) technicalM += s.len;
      if (s.way.tags && s.way.tags["ign:nature"] === "Route empierrée" && !s.way.tags.surface) ignEmpireeM += s.len;
    }
  }
  return {
    matchedM, enrichedM, offroadM, technicalM,
    technicalShare: offroadM > 0 ? technicalM / offroadM : null,
    ignEmpierreeM: ignEmpireeM,
    ignEmpierreeShare: offroadM > 0 ? ignEmpireeM / offroadM : null,
  };
}
