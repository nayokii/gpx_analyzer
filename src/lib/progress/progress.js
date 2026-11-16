/**
 * Moteur de la page « Progrès » : totaux par semaine / mois / année, séries sur les périodes récentes, comparaison
 * avec la période précédente, comparatif mois par mois d'une année à l'autre, série de semaines consécutives.
 *
 * Fonctions pures, sans React. Toutes les périodes sont calendaires LOCALES (semaine ISO du lundi au dimanche),
 * même choix que ../history/dateUtils.js. Une période est identifiée par sa date de début (Date locale à 00:00) ;
 * la fin est exclusive.
 */
import { parseActivityDate, localDayKey } from "../history/dateUtils.js";

export const PERIOD_KINDS = [
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "year", label: "Année" },
];

const SERIES_LENGTH = { week: 12, month: 12, year: 5 };

/** Début (lundi 00:00 local) de la semaine contenant `date`. */
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Début de la période de type `kind` contenant `date`. */
export function periodStart(kind, date) {
  if (kind === "week") return startOfWeek(date);
  if (kind === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  if (kind === "year") return new Date(date.getFullYear(), 0, 1);
  throw new Error(`Période inconnue : ${kind}`);
}

/** Début de la période décalée de `delta` périodes (négatif = passé). `start` doit être un début de période. */
export function shiftPeriod(kind, start, delta) {
  if (kind === "week") return new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta * 7);
  if (kind === "month") return new Date(start.getFullYear(), start.getMonth() + delta, 1);
  if (kind === "year") return new Date(start.getFullYear() + delta, 0, 1);
  throw new Error(`Période inconnue : ${kind}`);
}

/** Début (inclus) et fin (exclue) de la période commençant à `start`. */
export function periodBounds(kind, start) {
  return { start, end: shiftPeriod(kind, start, 1) };
}

/** Nombre de jours de la période. */
export function daysInPeriod(kind, start) {
  const { end } = periodBounds(kind, start);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

const fr = (date, opts) => date.toLocaleDateString("fr-FR", opts);

/** Libellé complet : « 2 nov. – 8 nov. 2026 », « novembre 2026 », « 2026 ». */
export function periodLabel(kind, start) {
  if (kind === "year") return String(start.getFullYear());
  if (kind === "month") {
    const s = fr(start, { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return `${fr(start, { day: "numeric", month: "short" })} – ${fr(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Libellé court pour l'axe d'un graphique. */
export function periodShortLabel(kind, start) {
  if (kind === "year") return String(start.getFullYear());
  if (kind === "month") return fr(start, { month: "short" }).replace(".", "");
  return fr(start, { day: "numeric", month: "short" }).replace(".", "");
}

/** Types de pratique présents dans les sorties (index cloud sans type : « other »). */
export function sportKeys(activities) {
  const set = new Set();
  for (const a of activities || []) set.add(a.sportType || "other");
  return [...set];
}

export function filterBySport(activities, sport) {
  if (!sport || sport === "all") return activities || [];
  return (activities || []).filter((a) => (a.sportType || "other") === sport);
}

/** Sorties datées dans [start, end). */
export function activitiesBetween(activities, start, end) {
  const out = [];
  for (const a of activities || []) {
    const d = parseActivityDate(a);
    if (d && d >= start && d < end) out.push(a);
  }
  return out;
}

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Totaux d'un lot de sorties. La vitesse moyenne est pondérée par le temps en mouvement (jamais une moyenne de moyennes). */
export function aggregate(activities) {
  let distanceKm = 0, movingTimeSec = 0, elevationGainM = 0, count = 0, timedDistance = 0;
  for (const a of activities || []) {
    count += 1;
    distanceKm += n(a.distance);
    movingTimeSec += n(a.movingTime);
    elevationGainM += n(a.elevationGain);
    if (n(a.movingTime) > 0) timedDistance += n(a.distance);
  }
  return {
    count, distanceKm, movingTimeSec, elevationGainM,
    avgSpeedKmh: movingTimeSec > 0 ? timedDistance / (movingTimeSec / 3600) : null,
  };
}

/** Totaux de la période commençant à `start`. */
export function totalsForPeriod(activities, kind, start) {
  const { end } = periodBounds(kind, start);
  return aggregate(activitiesBetween(activities, start, end));
}

/**
 * Série des `length` dernières périodes finissant à la période `start` (incluse), zéros compris :
 * un graphique sans trou, comme les 12 dernières semaines de Strava.
 */
export function buildSeries(activities, kind, start, length = SERIES_LENGTH[kind]) {
  const out = [];
  for (let i = length - 1; i >= 0; i--) {
    const s = shiftPeriod(kind, start, -i);
    out.push({ start: s, label: periodLabel(kind, s), shortLabel: periodShortLabel(kind, s), ...totalsForPeriod(activities, kind, s) });
  }
  return out;
}

/** Variation absolue et relative d'une métrique entre deux totaux ; `pct` est null si la base est nulle. */
export function delta(current, previous, metric) {
  const c = current[metric];
  const p = previous[metric];
  if (c == null || p == null) return { diff: null, pct: null };
  const diff = c - p;
  return { diff, pct: p > 0 ? (diff / p) * 100 : null };
}

/** Heures de selle moyennes par semaine sur la période (une année partielle est ramenée aux semaines écoulées). */
export function avgHoursPerWeek(totals, kind, start, today = new Date()) {
  const { end } = periodBounds(kind, start);
  const upTo = today < end ? today : end;
  const days = Math.max(1, Math.min(daysInPeriod(kind, start), Math.ceil((upTo.getTime() - start.getTime()) / 86400000)));
  return totals.movingTimeSec / 3600 / (days / 7);
}

/**
 * Comparatif mois par mois : pour chaque mois de `year`, totaux de cette année et de l'année précédente.
 * @returns {Array<{month: number, label: string, current: Object, previous: Object}>}
 */
export function monthlyComparison(activities, year) {
  const rows = [];
  for (let m = 0; m < 12; m++) {
    const cur = new Date(year, m, 1);
    const prev = new Date(year - 1, m, 1);
    rows.push({
      month: m,
      label: periodShortLabel("month", cur),
      current: totalsForPeriod(activities, "month", cur),
      previous: totalsForPeriod(activities, "month", prev),
    });
  }
  return rows;
}

/**
 * Série de semaines consécutives avec au moins une sortie. La semaine en cours compte si elle a déjà une sortie ;
 * sinon la série reste vivante jusqu'à dimanche (on part de la semaine précédente), comme sur Strava.
 */
export function weekStreak(activities, today = new Date()) {
  const weeks = new Set();
  for (const a of activities || []) {
    const d = parseActivityDate(a);
    if (d) weeks.add(localDayKey(startOfWeek(d)));
  }
  let cursor = startOfWeek(today);
  if (!weeks.has(localDayKey(cursor))) cursor = shiftPeriod("week", cursor, -1);
  let streak = 0;
  while (weeks.has(localDayKey(cursor))) {
    streak += 1;
    cursor = shiftPeriod("week", cursor, -1);
  }
  return streak;
}

/**
 * Jours du mois (ou de la semaine) de `start`, chacun avec ses totaux, pour une grille de points type calendrier.
 * Les jours futurs sont marqués `future`.
 */
export function dayCells(activities, kind, start, today = new Date()) {
  const days = daysInPeriod(kind, start);
  const byDay = new Map();
  for (const a of activitiesBetween(activities, start, periodBounds(kind, start).end)) {
    const key = localDayKey(parseActivityDate(a));
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: d, count: byDay.get(localDayKey(d)) || 0, future: d > today });
  }
  return cells;
}
