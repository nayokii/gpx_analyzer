/**
 * Résumé qualitatif de l'évolution d'une dimension — Phase 9F.
 *
 * Construit UNIQUEMENT à partir de `buildProfileTimeline()` (Phase 6A, déjà
 * calculé — voir profile.js), jamais un nouveau calcul de score. Ne produit
 * jamais de pourcentage ni de magnitude ("+12%", "+8 points") : seulement une
 * direction (`up`/`down`/`stable`) entre le premier et le dernier point DATÉ
 * où la dimension a une valeur, ou `emerging`/`insufficient` s'il n'y a pas
 * assez de points pour comparer quoi que ce soit — jamais une "progression"
 * inventée à partir d'un point unique.
 *
 * Aucun seuil de "variation significative" n'est inventé ici : le premier et
 * le dernier point sont comparés tels quels (`last !== first`). Le
 * vocabulaire d'affichage (voir ProfileView.jsx) reste volontairement neutre
 * ("évolution récente", pas "progrès" ni "amélioration") précisément pour ne
 * jamais sur-interpréter un petit écart.
 */

/**
 * @param {Array} timeline - voir profile.js: buildProfileTimeline() (ou son
 *   équivalent mémoïsé derivedCache.js: getCachedProfileTimeline())
 * @param {string} dimKey - une des 7 clés de profile.dimensions
 * @returns {{
 *   status: "insufficient"|"emerging"|"up"|"down"|"stable",
 *   pointCount: number,
 *   contributingActivities: number|null
 * }}
 */
export function summarizeDimensionTrend(timeline, dimKey) {
  const points = (timeline || [])
    .map((t) => t.profile && t.profile.dimensions && t.profile.dimensions[dimKey])
    .filter((d) => d && d.value != null);

  if (points.length === 0) {
    return { status: "insufficient", pointCount: 0, contributingActivities: null };
  }
  if (points.length === 1) {
    return { status: "emerging", pointCount: 1, contributingActivities: points[0].contributingActivities ?? null };
  }

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const status = last > first ? "up" : last < first ? "down" : "stable";
  return { status, pointCount: points.length, contributingActivities: points[points.length - 1].contributingActivities ?? null };
}
