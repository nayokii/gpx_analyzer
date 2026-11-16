/**
 * Effort par sortie et courbe Forme / Fatigue / Fraîcheur.
 *
 * Effort d'une sortie = durée (h) × intensité² × 100 (même échelle que le « TSS » : une heure à l'allure seuil vaut
 * 100). L'intensité vient, par ordre de préférence, de :
 *  1. la fréquence cardiaque moyenne (mesurée) rapportée à la FC max ;
 *  2. la puissance moyenne rapportée au FTP — ESTIMÉE par l'app (vitesse, pente, poids) quand il n'y a pas de capteur ;
 *  3. un modèle physique simple (vitesse, dénivelé, masse) si l'index n'a pas de puissance.
 * Les sources 2 et 3 sont donc des estimations : `source` le dit, et l'interface doit l'afficher.
 *
 * Forme (CTL, 42 j), fatigue (ATL, 7 j) et fraîcheur (TSB = CTL − ATL de la veille) : moyennes mobiles exponentielles
 * de la charge quotidienne. Jours calendaires LOCAUX, comme le reste de la page Progrès.
 */
import { parseActivityDate, localDayKey } from "../history/dateUtils.js";

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/** En dessous de ce nombre de jours d'historique, la forme n'est pas encore fiable (la moyenne longue se « charge »). */
export const CALIBRATION_DAYS = 42;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Puissance moyenne (W) d'après un modèle physique : traînée, roulement, pente. Ordre de grandeur, pas une mesure. */
export function modelPowerWatts({ distanceKm, movingTimeSec, elevationGainM }, massKg = 80) {
  const t = num(movingTimeSec);
  const d = num(distanceKm);
  if (!t || t <= 0 || !d || d <= 0) return null;
  const v = (d * 1000) / t; // m/s
  const g = 9.81;
  const aero = 0.5 * 1.2 * 0.38 * v ** 3;
  const rolling = 0.006 * massKg * g * v;
  const climb = (Math.max(0, num(elevationGainM) || 0) * massKg * g) / t;
  return Math.max(0, (aero + rolling + climb) / 0.975);
}

/**
 * @param {Object} a - résumé d'index ou activité (distance km, movingTime s, elevationGain m, avgHeartRate, avgPower, flags)
 * @param {{ftp?: number, maxHR?: number, massKg?: number}} [opts]
 * @returns {{score: number, intensity: number, source: 'hr'|'power'|'power-estimated'|'model'}|null}
 */
export function estimateEffort(a, { ftp = 250, maxHR = 190, massKg = 80 } = {}) {
  if (!a) return null;
  const sec = num(a.movingTime) > 0 ? a.movingTime : num(a.duration) > 0 ? a.duration : null;
  if (!sec) return null;
  const hours = sec / 3600;
  let intensity = null;
  let source = null;

  if (num(a.avgHeartRate) > 0 && maxHR > 0) {
    // 70 % de la FC max ≈ 0,65 ; 80 % ≈ 0,80 ; 90 % ≈ 0,95
    intensity = clamp(1.5 * (a.avgHeartRate / maxHR) - 0.4, 0.3, 1.3);
    source = "hr";
  } else if (num(a.avgPower) > 0 && ftp > 0) {
    intensity = clamp((a.avgPower * 1.05) / ftp, 0.2, 1.3); // 1,05 : la moyenne sous-estime l'effort d'une sortie irrégulière
    source = a.flags && a.flags.powerEstimated ? "power-estimated" : "power";
  } else if (ftp > 0) {
    const p = modelPowerWatts({ distanceKm: a.distance, movingTimeSec: sec, elevationGainM: a.elevationGain }, massKg);
    if (p != null) {
      intensity = clamp((p * 1.05) / ftp, 0.2, 1.3);
      source = "model";
    }
  }
  if (intensity == null) return null;
  return { score: Math.round(hours * intensity * intensity * 100), intensity, source };
}

/** « hr » = mesuré ; le reste est une estimation. */
export const isEstimatedSource = (source) => source !== "hr" && source !== "power";

export function effortLevel(score) {
  if (score == null) return null;
  if (score < 50) return "Facile";
  if (score < 100) return "Modéré";
  if (score < 200) return "Soutenu";
  return "Très dur";
}

/** Charge totale par jour calendaire local : Map "YYYY-MM-DD" → { load, count, estimated }. */
export function dailyLoads(activities, opts) {
  const map = new Map();
  for (const a of activities || []) {
    const d = parseActivityDate(a);
    if (!d) continue;
    const e = estimateEffort(a, opts);
    if (!e) continue;
    const key = localDayKey(d);
    const cur = map.get(key) || { load: 0, count: 0, estimated: false };
    cur.load += e.score;
    cur.count += 1;
    cur.estimated = cur.estimated || isEstimatedSource(e.source);
    map.set(key, cur);
  }
  return map;
}

/** Libellé de forme d'après la fraîcheur (TSB). */
export function formStatus(tsb) {
  if (tsb > 15) return { key: "rested", label: "Très frais", hint: "Peu de charge récente : bon moment pour un gros effort, mais la forme peut redescendre." };
  if (tsb > 5) return { key: "fresh", label: "Frais", hint: "Fatigue basse par rapport à ta forme : idéal pour une sortie ou une course importante." };
  if (tsb >= -10) return { key: "neutral", label: "Neutre", hint: "Charge et forme équilibrées." };
  if (tsb >= -30) return { key: "loaded", label: "En charge", hint: "Tu t'entraînes fort : c'est la zone où l'on progresse, avec de la fatigue." };
  return { key: "overload", label: "Surcharge", hint: "Fatigue très élevée par rapport à ta forme : pense à lever le pied." };
}

const dayAdd = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * @param {Array} activities
 * @param {{ftp?: number, maxHR?: number, massKg?: number}} [opts]
 * @param {{days?: number, today?: Date}} [range] - nombre de jours à renvoyer (les plus récents)
 * @returns {{series: Array<{date: Date, load: number, ctl: number, atl: number, tsb: number}>, current: Object|null,
 *   status: Object|null, calibrating: boolean, historyDays: number, rides: number, estimatedShare: number}}
 */
export function computeFitness(activities, opts = {}, { days = 90, today = new Date() } = {}) {
  const loads = dailyLoads(activities, opts);
  if (loads.size === 0) return { series: [], current: null, status: null, calibrating: true, historyDays: 0, rides: 0, estimatedShare: 0 };

  const keys = [...loads.keys()].sort();
  const [y, m, d] = keys[0].split("-").map(Number);
  const first = new Date(y, m - 1, d);
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const kC = 1 - Math.exp(-1 / CTL_DAYS);
  const kA = 1 - Math.exp(-1 / ATL_DAYS);

  const all = [];
  let ctl = 0;
  let atl = 0;
  for (let day = first; day <= last; day = dayAdd(day, 1)) {
    const load = (loads.get(localDayKey(day)) || { load: 0 }).load;
    const tsb = ctl - atl; // fraîcheur du matin : forme et fatigue de la veille
    ctl += (load - ctl) * kC;
    atl += (load - atl) * kA;
    all.push({ date: day, load, ctl, atl, tsb });
  }

  let rides = 0;
  let estimatedRides = 0;
  for (const v of loads.values()) { rides += v.count; if (v.estimated) estimatedRides += v.count; }
  const series = all.slice(-days);
  const current = all[all.length - 1];
  return {
    series, current, status: formStatus(current.tsb),
    calibrating: all.length < CALIBRATION_DAYS, historyDays: all.length, rides,
    estimatedShare: rides ? estimatedRides / rides : 0,
  };
}
