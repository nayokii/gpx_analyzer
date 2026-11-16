/**
 * Temps passé par zone d'intensité, agrégé sur plusieurs sorties.
 *
 * Cinq zones (Récup, Endurance, Tempo, Seuil, VO2max). Source par sortie :
 *  - « hr » : fréquence cardiaque mesurée, en % de la FC max (bornes de analytics/zones.js) ;
 *  - « estimated » : puissance ESTIMÉE par l'app (pas de capteur), en % du FTP — mêmes seuils, les zones 5 à 7 de
 *    puissance étant regroupées dans « VO2max+ ».
 * Une sortie sans FC ni puissance n'a pas de zones (jamais inventées). Le mode est conservé par sortie pour que
 * l'interface puisse dire quelle part est estimée.
 */
import { parseActivityDate } from "../history/dateUtils.js";
import { periodBounds, shiftPeriod, periodLabel, periodShortLabel } from "./progress.js";

export const ZONES = [
  { key: "z1", name: "Z1 Récup", short: "Z1", hr: [0, 60], power: [0, 0.55], color: "#4dd9c0" },
  { key: "z2", name: "Z2 Endurance", short: "Z2", hr: [60, 70], power: [0.55, 0.75], color: "#8fd66a" },
  { key: "z3", name: "Z3 Tempo", short: "Z3", hr: [70, 80], power: [0.75, 0.9], color: "#f4b740" },
  { key: "z4", name: "Z4 Seuil", short: "Z4", hr: [80, 90], power: [0.9, 1.05], color: "#e8834a" },
  { key: "z5", name: "Z5 VO2max", short: "Z5", hr: [90, 999], power: [1.05, 999], color: "#e8543a" },
];

/** Écart maximal entre deux échantillons pour compter le temps (au-delà : pause, jamais comptée). */
const MAX_GAP_SEC = 30;

function zoneIndex(value, range) {
  for (let i = 0; i < ZONES.length; i++) {
    const [lo, hi] = ZONES[i][range];
    if (value >= lo && value < hi) return i;
  }
  return -1;
}

function seconds(sample) {
  const t = sample && sample.timestamp ? Date.parse(sample.timestamp) : NaN;
  return Number.isFinite(t) ? t / 1000 : null;
}

/**
 * Temps par zone d'une sortie complète (avec `samples`).
 * @param {Object} activity
 * @param {{maxHR?: number, ftp?: number}} opts
 * @returns {{mode: 'hr'|'estimated', seconds: number[]}|null}
 */
export function activityZones(activity, { maxHR = 190, ftp = 250 } = {}) {
  const samples = activity && Array.isArray(activity.samples) ? activity.samples : [];
  if (samples.length < 2) return null;
  const withHr = samples.filter((s) => s && s.heartRate > 0).length;
  const withPower = samples.filter((s) => s && s.power > 0).length;
  let mode = null;
  if (withHr >= samples.length * 0.5 && maxHR > 0) mode = "hr";
  else if (withPower >= samples.length * 0.5 && ftp > 0) mode = "estimated";
  if (!mode) return null;

  const out = ZONES.map(() => 0);
  let counted = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = seconds(samples[i - 1]);
    const b = seconds(samples[i]);
    if (a == null || b == null) continue;
    const dt = b - a;
    if (dt <= 0 || dt > MAX_GAP_SEC) continue;
    const idx = mode === "hr"
      ? (samples[i].heartRate > 0 ? zoneIndex((samples[i].heartRate / maxHR) * 100, "hr") : -1)
      : (samples[i].power > 0 ? zoneIndex(samples[i].power / ftp, "power") : -1);
    if (idx < 0) continue;
    out[idx] += dt;
    counted += dt;
  }
  return counted > 0 ? { mode, seconds: out } : null;
}

/** Zones de chaque sortie datée : [{ date, mode, seconds }], les sorties sans zones sont ignorées. */
export function zonesForActivities(activities, opts) {
  const out = [];
  for (const a of activities || []) {
    const d = parseActivityDate(a);
    if (!d) continue;
    const z = activityZones(a, opts);
    if (z) out.push({ date: d, ...z });
  }
  return out;
}

/** Totaux par zone des entrées datées dans [from, to) (bornes nulles = illimité). */
export function zoneTotals(entries, from = null, to = null) {
  const sec = ZONES.map(() => 0);
  let estimated = 0;
  let count = 0;
  for (const e of entries) {
    if ((from && e.date < from) || (to && e.date >= to)) continue;
    count += 1;
    if (e.mode === "estimated") estimated += 1;
    e.seconds.forEach((v, i) => { sec[i] += v; });
  }
  const total = sec.reduce((a, b) => a + b, 0);
  return {
    seconds: sec, total, count,
    percent: sec.map((v) => (total > 0 ? (v / total) * 100 : 0)),
    estimatedShare: count ? estimated / count : 0,
  };
}

/** Série de `length` périodes finissant à `start` : minutes par zone, pour un diagramme empilé. */
export function zoneSeries(entries, kind, start, length = 12) {
  const out = [];
  for (let i = length - 1; i >= 0; i--) {
    const s = shiftPeriod(kind, start, -i);
    const t = zoneTotals(entries, s, periodBounds(kind, s).end);
    const row = { start: s, label: periodLabel(kind, s), shortLabel: periodShortLabel(kind, s), totalMin: t.total / 60 };
    ZONES.forEach((z, k) => { row[z.key] = t.seconds[k] / 60; });
    out.push(row);
  }
  return out;
}

/**
 * Répartition « polarisée » : part du temps facile (Z1-Z2), moyen (Z3), dur (Z4-Z5), et phrase d'interprétation.
 * Ne conclut rien sans assez de données (moins de 2 h).
 */
export function intensityBalance(totals) {
  if (!totals || totals.total < 2 * 3600) return null;
  const [z1, z2, z3, z4, z5] = totals.percent;
  const easy = z1 + z2;
  const hard = z4 + z5;
  let text;
  if (easy >= 75 && hard >= 10) text = "Répartition polarisée : beaucoup de facile, un peu de dur. C'est le schéma classique d'une bonne progression.";
  else if (easy >= 75) text = "Tu roules surtout en facile : bonne base d'endurance. Une séance par semaine plus soutenue ferait progresser.";
  else if (z3 >= 35) text = "Beaucoup de temps en zone moyenne (Tempo) : fatigant sans être très stimulant. Essaie de séparer plus nettement facile et dur.";
  else if (hard >= 35) text = "Beaucoup de temps en zone dure : surveille la récupération entre les sorties.";
  else text = "Répartition mixte entre les zones.";
  return { easy, medium: z3, hard, text };
}
