/**
 * Fusion des chemins IGN (source principale) et OpenStreetMap (complément facultatif), sans double comptage.
 *
 * Les deux sources décrivent souvent la MÊME voie. Pour ne pas la compter deux fois et ne pas laisser deux classements
 * se contredire, un chemin OpenStreetMap dont au moins ENRICH_MIN_OVERLAP des points (échantillonnés tous les ≤ 20 m)
 * se trouvent à moins de ENRICH_MAX_DISTANCE_M d'un tronçon IGN est considéré comme la même voie :
 *  - il n'est PAS ajouté comme chemin supplémentaire ;
 *  - ses tags de surface et de technicité (ENRICH_KEYS) sont copiés sur le tronçon IGN le plus proche, uniquement
 *    pour les clés que l'IGN ne renseigne pas (il n'en renseigne aucune) : les données cartographiques réelles d'OSM
 *    complètent l'IGN, jamais l'inverse. La catégorie (route / piste / sentier) reste celle du classement habituel, qui
 *    laisse une surface OSM explicite l'emporter sur l'interprétation de la nature IGN.
 * Un chemin OSM sans équivalent IGN (voie absente de la BD TOPO) est conservé tel quel (`src: "osm"`).
 * Aucun chemin d'entrée n'est modifié : les chemins enrichis sont des copies (les caches restent intacts).
 */
import { makeProjection, pointSegmentDistance } from "./geo.js";

export const ENRICH_MAX_DISTANCE_M = 15;
export const ENRICH_MIN_OVERLAP = 0.6;
export const ENRICH_SAMPLE_M = 20;
/** Tags OSM copiés vers un tronçon IGN (surface et technicité) ; `highway` n'en fait pas partie. */
export const ENRICH_KEYS = ["surface", "tracktype", "smoothness", "sac_scale", "trail_visibility", "mtb:scale", "mtb:scale:uphill"];
const BUCKET_M = 40;

function buildIgnIndex(ignWays, project) {
  const buckets = new Map();
  for (const way of ignWays) {
    const pts = way.geom.map(([lat, lon]) => project(lat, lon));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = { way, ax: a.x, ay: a.y, bx: b.x, by: b.y };
      const minX = Math.min(a.x, b.x) - ENRICH_MAX_DISTANCE_M;
      const maxX = Math.max(a.x, b.x) + ENRICH_MAX_DISTANCE_M;
      const minY = Math.min(a.y, b.y) - ENRICH_MAX_DISTANCE_M;
      const maxY = Math.max(a.y, b.y) + ENRICH_MAX_DISTANCE_M;
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

/** Points d'un chemin, densifiés pour qu'aucun écart entre deux points ne dépasse ENRICH_SAMPLE_M. */
function samplePoints(way, project) {
  const pts = way.geom.map(([lat, lon]) => project(lat, lon));
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / ENRICH_SAMPLE_M));
    for (let s = 1; s <= n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  return out;
}

/** Tronçon IGN le plus proche d'un point (à moins de ENRICH_MAX_DISTANCE_M), ou null. */
function nearestIgn(index, p) {
  const list = index.get(`${Math.floor(p.x / BUCKET_M)}:${Math.floor(p.y / BUCKET_M)}`) || [];
  let best = null;
  let bestD = Infinity;
  for (const seg of list) {
    const d = pointSegmentDistance(p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by);
    if (d < bestD || (d === bestD && best && seg.way.id < best.way.id)) { best = seg; bestD = d; }
  }
  return best && bestD <= ENRICH_MAX_DISTANCE_M ? best.way : null;
}

/**
 * @param {Array} ignWays - chemins IGN (src "ign")
 * @param {Array} osmWays - chemins OpenStreetMap (tags OSM)
 * @returns {{ways: Array, stats: {ign: number, osm: number, osmDuplicates: number, osmOnly: number, enrichedWays: number, enrichedKeys: Object<string, number>, conflicts: number}}}
 */
export function mergeSources(ignWays, osmWays) {
  const ign = ignWays || [];
  const osm = osmWays || [];
  const stats = { ign: ign.length, osm: osm.length, osmDuplicates: 0, osmOnly: 0, enrichedWays: 0, enrichedKeys: {}, conflicts: 0 };
  const tagOsm = (w) => ({ ...w, src: "osm" });
  if (osm.length === 0) return { ways: ign, stats };
  if (ign.length === 0) { stats.osmOnly = osm.length; return { ways: osm.map(tagOsm), stats }; }

  const first = ign[0].geom[0];
  const project = makeProjection(first[0], first[1]);
  const index = buildIgnIndex(ign, project);
  const clones = new Map(); // id IGN → copie enrichie
  const extra = [];

  for (const ow of [...osm].sort((a, b) => a.id - b.id)) {
    if (!ow.geom || ow.geom.length < 2) continue;
    const samples = samplePoints(ow, project);
    const hits = new Map();
    let near = 0;
    for (const p of samples) {
      const w = nearestIgn(index, p);
      if (w) { near += 1; hits.set(w.id, (hits.get(w.id) || 0) + 1); }
    }
    if (near / samples.length < ENRICH_MIN_OVERLAP) { extra.push(tagOsm(ow)); stats.osmOnly += 1; continue; }

    stats.osmDuplicates += 1;
    let dominantId = null;
    let dominantHits = -1;
    for (const [id, n] of hits) if (n > dominantHits || (n === dominantHits && id < dominantId)) { dominantId = id; dominantHits = n; }
    const base = clones.get(dominantId) || ign.find((w) => w.id === dominantId);
    for (const key of ENRICH_KEYS) {
      const value = ow.tags && ow.tags[key];
      if (value == null || value === "") continue;
      if (base.tags[key] != null && base.tags[key] !== value) { if (clones.has(dominantId)) stats.conflicts += 1; continue; }
      if (base.tags[key] === value) continue;
      let clone = clones.get(dominantId);
      if (!clone) { clone = { ...base, tags: { ...base.tags }, enrichedBy: [], enrichedKeys: [] }; clones.set(dominantId, clone); }
      clone.tags[key] = value;
      if (!clone.enrichedBy.includes(ow.id)) clone.enrichedBy.push(ow.id);
      if (!clone.enrichedKeys.includes(key)) clone.enrichedKeys.push(key);
      stats.enrichedKeys[key] = (stats.enrichedKeys[key] || 0) + 1;
    }
  }
  stats.enrichedWays = clones.size;
  return { ways: [...ign.map((w) => clones.get(w.id) || w), ...extra], stats };
}
