/**
 * Géométrie locale pour l'analyse du terrain (aucune dépendance).
 *
 * Les distances sont calculées dans un plan local équirectangulaire centré sur le tracé : à l'échelle d'une sortie
 * (quelques dizaines de km) l'erreur est négligeable devant la précision d'un GPS (quelques mètres).
 */

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_AT_EQUATOR = 111320;

/** Taille d'une zone de requête cartographique (degrés) : ≈ 2,2 km en latitude. */
export const CELL_SIZE_DEG = 0.02;

/**
 * @param {number} lat0 - latitude du centre du plan local
 * @param {number} lon0 - longitude du centre du plan local
 * @returns {(lat: number, lon: number) => {x: number, y: number}} projection en mètres
 */
export function makeProjection(lat0, lon0) {
  const kx = M_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  return (lat, lon) => ({ x: (lon - lon0) * kx, y: (lat - lat0) * M_PER_DEG_LAT });
}

/** Distance en mètres entre deux points (plan local autour du premier). */
export function distanceM(lat1, lon1, lat2, lon2) {
  const p = makeProjection(lat1, lon1)(lat2, lon2);
  return Math.hypot(p.x, p.y);
}

/** Distance (m) d'un point à un segment [a, b], tous trois en coordonnées planes. */
export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Cap (degrés, 0-360) du vecteur (dx, dy). */
export function headingDeg(dx, dy) {
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Écart angulaire absolu entre deux caps, dans [0, 180]. */
export function angleDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Clé stable d'une zone de requête. */
export function cellKey(lat, lon) {
  return `${Math.floor(lat / CELL_SIZE_DEG)}:${Math.floor(lon / CELL_SIZE_DEG)}`;
}

/** @returns {{south: number, west: number, north: number, east: number}} */
export function cellBounds(key) {
  const [i, j] = key.split(":").map(Number);
  return { south: i * CELL_SIZE_DEG, west: j * CELL_SIZE_DEG, north: (i + 1) * CELL_SIZE_DEG, east: (j + 1) * CELL_SIZE_DEG };
}

/**
 * Zones traversées par un tracé, avec une marge (m) pour qu'un chemin situé juste de l'autre côté d'une limite
 * de zone soit tout de même couvert. Seules ces zones (jamais le tracé lui-même) servent à interroger la carte.
 * @param {Array<{lat: number, lon: number}>} points
 * @param {number} [marginM=30]
 * @returns {string[]} clés de zones, triées
 */
export function cellsForTrack(points, marginM = 30) {
  const keys = new Set();
  for (const p of points) {
    if (p.lat == null || p.lon == null) continue;
    const dLat = marginM / M_PER_DEG_LAT;
    const dLon = marginM / (M_PER_DEG_LON_AT_EQUATOR * Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)));
    for (const la of [p.lat - dLat, p.lat + dLat]) for (const lo of [p.lon - dLon, p.lon + dLon]) keys.add(cellKey(la, lo));
  }
  return [...keys].sort();
}
