/**
 * Générateurs de tracés et de chemins OSM SYNTHÉTIQUES, réservés aux tests (aucune donnée réelle, jamais importés
 * par le code de production).
 */
const LAT = 45;
const LON0 = 6;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

/** Abscisse (m, vers l'est) → longitude. */
export const lonAt = (xM) => LON0 + xM / M_PER_DEG_LON;

/** Tracé rectiligne vers l'est, un point tous les `stepM` mètres. `grade` : pente constante (%) ou fonction de x. */
export function makeTrack({ fromM = 0, toM = 1000, stepM = 10, grade = null, latOffsetM = 0 } = {}) {
  const pts = [];
  for (let x = fromM; x <= toM + 1e-9; x += stepM) {
    pts.push({ lat: LAT + latOffsetM / 110540, lon: lonAt(x), grade: typeof grade === "function" ? grade(x) : grade });
  }
  return pts;
}

/** Chemin OSM synthétique couvrant [fromM, toM] (même axe que le tracé, décalé de `offsetM` mètres au nord). */
export function makeWay(id, tags, { fromM = 0, toM = 1000, offsetM = 0 } = {}) {
  const lat = LAT + offsetM / 110540;
  const geom = [];
  for (let x = fromM; x <= toM + 1e-9; x += 50) geom.push([lat, lonAt(x)]);
  if (geom[geom.length - 1][1] !== lonAt(toM)) geom.push([lat, lonAt(toM)]);
  return { id, tags, geom };
}

/** Réponse Overpass minimale à partir de chemins de makeWay. */
export function overpassResponse(ways) {
  return {
    elements: ways.map((w) => ({
      type: "way", id: w.id, tags: w.tags,
      geometry: w.geom.map(([lat, lon]) => ({ lat, lon })),
    })),
  };
}
