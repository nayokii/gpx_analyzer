/**
 * Profil du terrain : répartition des distances par catégorie, couverture des données et type de sortie.
 *
 * Les pourcentages « de la sortie » incluent la part non classifiée (ils somment à 100 %). Le TYPE de sortie, lui,
 * est déterminé sur la seule part classifiée, et seulement si la couverture est suffisante : sinon « Indéterminé ».
 */

/** Part minimale de la distance rattachée à un chemin pour oser nommer un type de sortie. */
export const MIN_COVERAGE_FOR_TYPE = 0.5;
/** Part de route (parmi le classifié) à partir de laquelle la sortie est dite « Route ». */
export const ROAD_SHARE_THRESHOLD = 0.8;
/** Entre ce seuil et ROAD_SHARE_THRESHOLD de route, la sortie est « Mixte » (route + chemins/sentiers). */
export const MIXED_ROAD_MIN = 0.25;
/** Sous le seuil « Mixte » : part de sentiers (parmi le classifié) à partir de laquelle la sortie est dite « VTT sentiers ». */
export const TRAIL_SHARE_THRESHOLD = 0.35;

export const TERRAIN_CATEGORIES = ["road", "track", "trail", "unclassified"];
export const TERRAIN_LABELS = { road: "Route", track: "Pistes et chemins", trail: "Sentiers", unclassified: "Non classifié" };
export const TERRAIN_TYPE_LABELS = {
  road: "Route",
  mtb_tracks: "VTT chemins/pistes",
  mtb_trails: "VTT sentiers",
  mixed: "Mixte",
  unknown: "Indéterminé",
};

/**
 * @param {Array<{len: number, category: string|null}>} segments
 * @returns {{
 *   totalM: number, classifiedM: number, coverage: number,
 *   distancesM: Record<string, number>, pctOfTotal: Record<string, number>, shareOfClassified: Record<string, number|null>,
 *   type: "road"|"mtb_tracks"|"mtb_trails"|"mixed"|"unknown"
 * }}
 */
export function summarizeTerrain(segments) {
  const distancesM = { road: 0, track: 0, trail: 0, unclassified: 0 };
  for (const s of segments) distancesM[s.category || "unclassified"] += s.len;
  const totalM = distancesM.road + distancesM.track + distancesM.trail + distancesM.unclassified;
  const classifiedM = distancesM.road + distancesM.track + distancesM.trail;
  const coverage = totalM > 0 ? classifiedM / totalM : 0;

  const pctOfTotal = {};
  const shareOfClassified = {};
  for (const c of TERRAIN_CATEGORIES) {
    pctOfTotal[c] = totalM > 0 ? (distancesM[c] / totalM) * 100 : 0;
    shareOfClassified[c] = c !== "unclassified" && classifiedM > 0 ? distancesM[c] / classifiedM : null;
  }

  let type = "unknown";
  if (totalM > 0 && coverage >= MIN_COVERAGE_FOR_TYPE && classifiedM > 0) {
    const road = distancesM.road / classifiedM;
    const trail = distancesM.trail / classifiedM;
    if (road >= ROAD_SHARE_THRESHOLD) type = "road";
    else if (road > MIXED_ROAD_MIN) type = "mixed";
    else if (trail >= TRAIL_SHARE_THRESHOLD) type = "mtb_trails";
    else type = "mtb_tracks";
  }
  return { totalM, classifiedM, coverage, distancesM, pctOfTotal, shareOfClassified, type };
}

/**
 * Bande de terrain le long de la sortie : `bins` tranches de distance égale, chacune étiquetée par sa catégorie dominante.
 * @returns {Array<{category: string, share: number}>}
 */
export function terrainStrip(segments, bins = 120) {
  const total = segments.reduce((a, s) => a + s.len, 0);
  if (total <= 0) return [];
  const acc = Array.from({ length: bins }, () => ({ road: 0, track: 0, trail: 0, unclassified: 0 }));
  let pos = 0;
  for (const s of segments) {
    // Un sous-segment est attribué à la tranche de son milieu (la précision de 25 m suffit pour un affichage).
    const bin = Math.min(bins - 1, Math.floor(((pos + s.len / 2) / total) * bins));
    acc[bin][s.category || "unclassified"] += s.len;
    pos += s.len;
  }
  return acc.map((a) => {
    const [category, value] = Object.entries(a).sort((x, y) => y[1] - x[1])[0];
    const sum = a.road + a.track + a.trail + a.unclassified;
    return { category: sum > 0 ? category : "unclassified", share: sum > 0 ? value / sum : 0 };
  });
}
