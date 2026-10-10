/**
 * Rattachement du tracé GPS aux chemins OpenStreetMap (« map matching » volontairement simple et transparent).
 *
 * Le tracé est découpé en sous-segments d'au plus 25 m. Chaque sous-segment est rattaché au chemin LE PLUS PROCHE de
 * son milieu, à condition qu'il soit à moins de MATCH_MAX_DISTANCE_M (précision GPS typique). Conséquences :
 *  - chaque mètre de tracé n'est compté qu'UNE fois, même quand plusieurs chemins se superposent ou se croisent ;
 *  - un sous-segment sans chemin assez proche reste « non classifié » : jamais deviné ni extrapolé.
 */
import { makeProjection, pointSegmentDistance, headingDeg } from "./geo.js";
import { classifyWay } from "./classify.js";

export const MATCH_MAX_DISTANCE_M = 20;
export const SUBSEGMENT_M = 25;
const BUCKET_M = 40;

function buildIndex(ways, project, bounds) {
  const buckets = new Map();
  let segCount = 0;
  const margin = MATCH_MAX_DISTANCE_M + BUCKET_M;
  for (const way of ways) {
    const category = classifyWay(way.tags);
    if (!category) continue; // type de voie non interprétable : on ne la rattache pas
    const pts = way.geom.map(([lat, lon]) => project(lat, lon));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const minX = Math.min(a.x, b.x) - MATCH_MAX_DISTANCE_M;
      const maxX = Math.max(a.x, b.x) + MATCH_MAX_DISTANCE_M;
      const minY = Math.min(a.y, b.y) - MATCH_MAX_DISTANCE_M;
      const maxY = Math.max(a.y, b.y) + MATCH_MAX_DISTANCE_M;
      // Chemins sans rapport avec l'emprise du tracé : ignorés (économie de mémoire).
      if (maxX < bounds.minX - margin || minX > bounds.maxX + margin || maxY < bounds.minY - margin || minY > bounds.maxY + margin) continue;
      const seg = { way, category, ax: a.x, ay: a.y, bx: b.x, by: b.y, id: segCount++ };
      for (let bx = Math.floor(minX / BUCKET_M); bx <= Math.floor(maxX / BUCKET_M); bx++) {
        for (let by = Math.floor(minY / BUCKET_M); by <= Math.floor(maxY / BUCKET_M); by++) {
          const k = `${bx}:${by}`;
          let list = buckets.get(k);
          if (!list) { list = []; buckets.set(k, list); }
          list.push(seg);
        }
      }
    }
  }
  return buckets;
}

/**
 * @param {Array<{lat: number, lon: number, grade?: number|null}>} points - tracé ordonné
 * @param {Array<{id: number, tags: Object, geom: Array<[number, number]>}>} ways
 * @returns {{segments: Array<{len: number, category: string|null, way: Object|null, grade: number|null, heading: number|null}>, totalM: number}}
 */
export function matchTrack(points, ways) {
  const pts = (points || []).filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number");
  if (pts.length < 2) return { segments: [], totalM: 0 };

  const project = makeProjection(pts[0].lat, pts[0].lon);
  const xy = pts.map((p) => project(p.lat, p.lon));
  const bounds = xy.reduce(
    (b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const index = buildIndex(ways || [], project, bounds);

  const segments = [];
  let totalM = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = xy[i - 1];
    const b = xy[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const grade = pts[i - 1].grade != null && pts[i].grade != null ? (pts[i - 1].grade + pts[i].grade) / 2 : null;
    const heading = len >= 3 ? headingDeg(b.x - a.x, b.y - a.y) : null; // en dessous de 3 m, le cap n'est que du bruit GPS
    const n = Math.max(1, Math.ceil(len / SUBSEGMENT_M));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      const candidates = index.get(`${Math.floor(mx / BUCKET_M)}:${Math.floor(my / BUCKET_M)}`) || [];
      let best = null;
      let bestDist = Infinity;
      for (const seg of candidates) {
        const d = pointSegmentDistance(mx, my, seg.ax, seg.ay, seg.bx, seg.by);
        if (d < bestDist || (d === bestDist && best && seg.way.id < best.way.id)) { best = seg; bestDist = d; }
      }
      const matched = best && bestDist <= MATCH_MAX_DISTANCE_M ? best : null;
      segments.push({ len: len / n, category: matched ? matched.category : null, way: matched ? matched.way : null, grade, heading });
    }
    totalM += len;
  }
  return { segments, totalM };
}
