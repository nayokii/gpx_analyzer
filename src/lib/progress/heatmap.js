/**
 * Carte de chaleur personnelle : toutes les traces d'une période superposées. Prépare les tracés (filtre période et
 * type, retrait des points invalides, allègement) ; le dessin est fait par la vue Leaflet.
 *
 * Le départ et l'arrivée de chaque tracé sont conservés tels quels : la carte reste sur l'appareil et n'est jamais
 * exportée ici (le partage d'image passe par shareCard.js, qui masque déjà départ et arrivée).
 */
import { parseActivityDate } from "../history/dateUtils.js";
import { extractRoute } from "../feed/feedModel.js";

/** Nombre maximal de points gardés par tracé pour l'affichage (assez pour une carte lisible, léger pour des centaines de sorties). */
export const MAX_POINTS_PER_TRACK = 300;

/** Garde au plus `max` points régulièrement espacés, premier et dernier compris. */
export function decimate(points, max = MAX_POINTS_PER_TRACK) {
  if (!Array.isArray(points) || points.length <= max) return points || [];
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * @param {Array} activities - activités complètes (gpsTrack / samples)
 * @param {{from?: Date|null, to?: Date|null, sport?: string}} [filter]
 * @returns {{tracks: Array<Array<[number, number]>>, count: number, distanceKm: number, bounds: [[number, number], [number, number]]|null}}
 */
export function collectTracks(activities, { from = null, to = null, sport = "all" } = {}) {
  const tracks = [];
  let distanceKm = 0;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const a of activities || []) {
    if (sport !== "all" && (a.sportType || "other") !== sport) continue;
    const d = parseActivityDate(a);
    if ((from || to) && !d) continue;
    if ((from && d < from) || (to && d >= to)) continue;
    const route = extractRoute(a);
    if (!route) continue;
    const pts = decimate(route.map((p) => [p.lat, p.lon]));
    tracks.push(pts);
    if (typeof a.distance === "number" && Number.isFinite(a.distance)) distanceKm += a.distance;
    for (const [lat, lon] of pts) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  return {
    tracks, count: tracks.length, distanceKm,
    bounds: tracks.length ? [[minLat, minLon], [maxLat, maxLon]] : null,
  };
}

/** Périodes proposées pour la carte. */
export const HEATMAP_PERIODS = [
  { key: "30d", label: "30 jours", days: 30 },
  { key: "90d", label: "3 mois", days: 90 },
  { key: "365d", label: "12 mois", days: 365 },
  { key: "all", label: "Tout", days: null },
];

export function heatmapRange(periodKey, today = new Date()) {
  const p = HEATMAP_PERIODS.find((x) => x.key === periodKey);
  if (!p || p.days == null) return { from: null, to: null };
  return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - p.days), to: null };
}
