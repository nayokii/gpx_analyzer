/**
 * Activity Feed — logique PURE (aucun accès au DOM ni au stockage).
 *
 * Tout ce que le fil et les cartes partageables affichent est dérivé ici de
 * l'objet Activity existant (voir ../types.js) ou de son résumé d'index :
 * aucune donnée n'est inventée, une valeur absente reste `null` et la
 * statistique correspondante est masquée (jamais affichée comme 0).
 *
 * Confidentialité : les fonctions de projection (`projectRoute`) ne renvoient
 * que des coordonnées en PIXELS. Tout visuel partageable est construit à
 * partir de ces pixels et jamais des latitudes/longitudes brutes.
 */
import { haversine, fmt1, fmtInt, fmtDuration } from "../utils.js";

export const ACTIVITY_TYPE_LABELS = { cycling: "Route", mtb: "VTT", gravel: "Gravel", other: "Autre" };

/** @returns {string} libellé FR d'un type d'activité ; toute valeur inconnue devient « Autre ». */
export function activityTypeLabel(sportType) {
  return ACTIVITY_TYPE_LABELS[sportType] || ACTIVITY_TYPE_LABELS.other;
}

export const SORT_OPTIONS = [
  { key: "date", label: "Date" },
  { key: "distance", label: "Distance" },
  { key: "elevation", label: "Dénivelé" },
];

/** Nom affiché : surcharge utilisateur > nom du fichier > libellé neutre. */
export function displayName(activity, overrides = {}) {
  const custom = overrides && activity ? overrides[activity.id] : null;
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return (activity && activity.name && String(activity.name).trim()) || "Sortie vélo";
}

/**
 * Recherche par nom + filtre de type + tri. Ne modifie jamais l'entrée.
 * Les valeurs absentes sont toujours reléguées en fin de liste (jamais 0).
 */
export function filterAndSortActivities(items, { query = "", type = "all", sort = "date", overrides = {} } = {}) {
  const q = query.trim().toLowerCase();
  const filtered = (items || []).filter((a) => {
    if (type !== "all" && (a.sportType || "other") !== type) return false;
    if (q && !displayName(a, overrides).toLowerCase().includes(q)) return false;
    return true;
  });
  const value = {
    date: (a) => (a.date ? Date.parse(a.date) : null),
    distance: (a) => (a.distance > 0 ? a.distance : null),
    elevation: (a) => a.elevationGain,
  }[sort] || ((a) => (a.date ? Date.parse(a.date) : null));
  return filtered
    .map((a) => ({ a, v: value(a) }))
    .sort((x, y) => {
      const xn = x.v == null || Number.isNaN(x.v);
      const yn = y.v == null || Number.isNaN(y.v);
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      return y.v - x.v;
    })
    .map((e) => e.a);
}

/** Types réellement présents dans la liste (pour n'afficher que des filtres utiles). */
export function availableTypes(items) {
  const present = new Set((items || []).map((a) => a.sportType || "other"));
  return Object.keys(ACTIVITY_TYPE_LABELS).filter((t) => present.has(t));
}

// ---------------------------------------------------------------- Tracé GPS

export function isValidCoord(lat, lon) {
  return (
    typeof lat === "number" && typeof lon === "number" &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0) // « null island » : valeur typique d'un fix GPS absent
  );
}

/**
 * Coordonnées exploitables d'une activité (gpsTrack, sinon samples), ou `null`
 * s'il n'y a pas au moins 2 points valides et distincts.
 * @returns {{lat: number, lon: number}[]|null}
 */
export function extractRoute(activity) {
  if (!activity) return null;
  const fromTrack = Array.isArray(activity.gpsTrack) ? activity.gpsTrack : [];
  let raw = fromTrack.map((p) => (p ? { lat: p.lat, lon: p.lon } : null));
  if (raw.filter(Boolean).length < 2 && Array.isArray(activity.samples)) {
    raw = activity.samples.map((s) => (s ? { lat: s.latitude, lon: s.longitude } : null));
  }
  const valid = raw.filter((p) => p && isValidCoord(p.lat, p.lon));
  if (valid.length < 2) return null;
  const first = valid[0];
  const moved = valid.some((p) => p.lat !== first.lat || p.lon !== first.lon);
  return moved ? valid : null;
}

/** Longueur cumulée d'une polyligne, en mètres. */
export function routeLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon);
  return total;
}

/**
 * Retire le début et la fin du tracé (zone de domicile). La distance retirée
 * de chaque côté est `meters`, plafonnée à 15 % de la longueur totale pour
 * qu'une courte sortie reste lisible. Si rien d'exploitable ne reste, le
 * tracé complet est renvoyé SANS marqueurs (voir `shareRoute`).
 */
export function trimRouteEnds(coords, meters = 300) {
  const total = routeLengthMeters(coords);
  const cut = Math.min(meters, total * 0.15);
  if (cut <= 0) return coords;
  let acc = 0;
  let start = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversine(coords[i - 1].lat, coords[i - 1].lon, coords[i].lat, coords[i].lon);
    if (acc >= cut) { start = i; break; }
  }
  acc = 0;
  let end = coords.length - 1;
  for (let i = coords.length - 1; i > 0; i--) {
    acc += haversine(coords[i].lat, coords[i].lon, coords[i - 1].lat, coords[i - 1].lon);
    if (acc >= cut) { end = i - 1; break; }
  }
  const trimmed = coords.slice(start, end + 1);
  return trimmed.length >= 2 ? trimmed : coords;
}

/** Projection équirectangulaire locale en mètres (suffisante à l'échelle d'une sortie). */
function toMeters(coords) {
  const lat0 = coords.reduce((s, p) => s + p.lat, 0) / coords.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const ky = 110540;
  return coords.map((p) => ({ x: p.lon * kx, y: p.lat * ky }));
}

function perpDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker itératif (pas de récursion : traces de plusieurs dizaines de milliers de points). */
function rdp(points, tolerance) {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * Simplifie un tracé à `maxPoints` points au plus (tolérance augmentée
 * jusqu'à y parvenir). Conserve toujours le premier et le dernier point.
 */
export function simplifyRoute(coords, maxPoints = 400) {
  if (!coords || coords.length <= maxPoints) return coords || [];
  const m = toMeters(coords);
  let tol = 2;
  let idx = rdp(m, tol);
  let guard = 0;
  while (idx.length > maxPoints && guard++ < 24) {
    tol *= 1.6;
    idx = rdp(m, tol);
  }
  if (idx.length > maxPoints) {
    const step = (idx.length - 1) / (maxPoints - 1);
    idx = Array.from({ length: maxPoints }, (_, i) => idx[Math.round(i * step)]);
  }
  return idx.map((i) => coords[i]);
}

/**
 * Projette un tracé dans un rectangle en PIXELS, proportions respectées,
 * centré, avec marge. C'est la seule représentation du tracé qui sort de ce
 * module vers les visuels : aucune latitude/longitude n'y subsiste.
 * @returns {{points: {x: number, y: number}[], width: number, height: number}|null}
 */
export function projectRoute(coords, { width, height, padding = 0 }) {
  if (!coords || coords.length < 2) return null;
  const m = toMeters(coords);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of m) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  const scale = Math.min(availW / spanX, availH / spanY);
  const offX = padding + (availW - spanX * scale) / 2;
  const offY = padding + (availH - spanY * scale) / 2;
  const round = (v) => Math.round(v * 10) / 10;
  const points = m.map((p) => ({ x: round(offX + (p.x - minX) * scale), y: round(offY + (maxY - p.y) * scale) }));
  return { points, width, height };
}

/**
 * Tracé prêt pour un visuel partageable.
 * @param {Array} coords - coordonnées brutes (extractRoute)
 * @param {{hidePlaces?: boolean, simplify?: boolean}} opts
 * @returns {{coords: Array, showEndpoints: boolean}}
 */
export function shareRoute(coords, { hidePlaces = true, simplify = true } = {}) {
  let out = coords;
  let showEndpoints = true;
  if (hidePlaces) {
    const trimmed = trimRouteEnds(out);
    showEndpoints = false; // jamais de marqueur de départ/arrivée si l'option est active
    out = trimmed;
  }
  if (simplify) out = simplifyRoute(out, 300);
  return { coords: out, showEndpoints };
}

/** Chemin SVG « M x y L x y … » à partir de points en pixels. */
export function pointsToPath(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

// ---------------------------------------------------------------- Altitude

/**
 * Profil d'altitude réduit à `n` points normalisés (distance 0–1, altitude en
 * mètres) à partir des échantillons mesurés. `null` si absent ou plat.
 */
export function elevationProfile(activity, n = 60) {
  if (!activity || !Array.isArray(activity.samples) || activity.flags?.hasElevation === false) return null;
  const alts = activity.samples.map((s) => (s && typeof s.altitude === "number" && Number.isFinite(s.altitude) ? s.altitude : null));
  const valid = alts.filter((a) => a != null);
  if (valid.length < 10) return null;
  const step = (alts.length - 1) / (n - 1);
  const out = [];
  let last = valid[0];
  for (let i = 0; i < n; i++) {
    const v = alts[Math.round(i * step)];
    if (v != null) last = v;
    out.push(last);
  }
  const min = Math.min(...out);
  const max = Math.max(...out);
  if (max - min < 3) return null;
  return { values: out, min, max };
}

// ---------------------------------------------------------------- Statistiques

/**
 * @typedef {Object} FeedStat
 * @property {string} key
 * @property {string} label
 * @property {string} value  - déjà formaté
 * @property {string} [unit]
 * @property {'measured'|'calculated'|'estimated'} kind
 */

const num = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Statistiques d'une sortie, groupées en `primary` (distance, durée en
 * mouvement, vitesse moyenne, D+) et `secondary` (FC, cadence, puissance,
 * temps écoulé). Une valeur indisponible est OMISE du tableau.
 * @param {Object} activity - Activity complète ou résumé d'index
 * @returns {{primary: FeedStat[], secondary: FeedStat[]}}
 */
export function buildStats(activity) {
  const a = activity || {};
  const flags = a.flags || {};
  const primary = [];
  const secondary = [];

  if (num(a.distance) && a.distance > 0) primary.push({ key: "distance", label: "Distance", value: fmt1(a.distance), unit: "km", kind: "calculated" });
  if (num(a.movingTime) && a.movingTime > 0) primary.push({ key: "movingTime", label: "Durée", value: fmtDuration(a.movingTime), kind: "calculated" });
  if (num(a.avgSpeed) && a.avgSpeed > 0) primary.push({ key: "avgSpeed", label: "Vitesse moy.", value: fmt1(a.avgSpeed), unit: "km/h", kind: "calculated" });
  if (num(a.elevationGain)) primary.push({ key: "elevationGain", label: "Dénivelé +", value: fmtInt(a.elevationGain), unit: "m", kind: "calculated" });

  if (num(a.avgHeartRate) && a.avgHeartRate > 0) {
    const max = num(a.maxHeartRate) && a.maxHeartRate > 0 ? ` · max ${fmtInt(a.maxHeartRate)}` : "";
    secondary.push({ key: "heartRate", label: "FC moy.", value: `${fmtInt(a.avgHeartRate)}${max}`, unit: "bpm", kind: "measured" });
  }
  if (num(a.avgCadence) && a.avgCadence > 0) secondary.push({ key: "cadence", label: "Cadence moy.", value: fmtInt(a.avgCadence), unit: "rpm", kind: "measured" });
  if (num(a.avgPower) && a.avgPower > 0) {
    const est = !!flags.powerEstimated;
    const max = num(a.maxPower) && a.maxPower > 0 ? ` · max ${fmtInt(a.maxPower)}` : "";
    secondary.push({ key: "power", label: est ? "Puissance estimée" : "Puissance moy.", value: `${est ? "≈ " : ""}${fmtInt(a.avgPower)}${max}`, unit: "W", kind: est ? "estimated" : "measured" });
  }
  if (num(a.duration) && a.duration > 0) secondary.push({ key: "elapsed", label: "Temps écoulé", value: fmtDuration(a.duration), kind: "calculated" });

  return { primary, secondary };
}
