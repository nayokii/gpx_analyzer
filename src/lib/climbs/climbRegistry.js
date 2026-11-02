/**
 * Registre des montées : regroupe les montées détectées dans chaque sortie
 * (voir ../analytics/climbs.js) qui correspondent au MÊME col/route, afin de
 * comparer les chronos d'une même montée au fil des sorties.
 *
 * Deux montées sont la même si leurs points de départ ET d'arrivée sont
 * proches (MATCH_RADIUS_M) — la détection (analysis.js: detectClimbs) coupe
 * un peu différemment d'une sortie à l'autre, d'où une tolérance plutôt
 * qu'une égalité stricte. Le sens compte : descendre le même col n'est pas
 * une montée détectée, et départ/arrivée inversés ne correspondent pas.
 *
 * Le nom saisi par l'utilisateur est lié à la POSITION du groupe (et non à un
 * identifiant recalculé à chaque chargement) : voir climbNames.js.
 */
import { haversine } from "../utils.js";

export const MATCH_RADIUS_M = 200;

function near(aLat, aLon, bLat, bLon) {
  return haversine(aLat, aLon, bLat, bLon) <= MATCH_RADIUS_M;
}

function hasCoords(c) {
  return c.startLat != null && c.startLon != null && c.endLat != null && c.endLon != null;
}

/** @returns {boolean} true si `a` et `b` (montées ou groupes avec startLat/startLon/endLat/endLon) sont la même montée */
export function sameClimb(a, b) {
  return near(a.startLat, a.startLon, b.startLat, b.startLon) && near(a.endLat, a.endLon, b.endLat, b.endLon);
}

/**
 * @param {Array} activitySignals - voir ../profile/activitySignals.js (deriveAllActivitySignals)
 * @returns {Array<{
 *   id: string, startLat: number, startLon: number, endLat: number, endLon: number,
 *   distanceM: number, gainM: number, avgGrade: number, path: Array<[number, number]>,
 *   attempts: Array<{activityId: string, date: string|null, durationSec: number|null, avgSpeedKmh: number|null, vam: number|null, avgPowerW: number|null, avgHeartRateBpm: number|null, gainM: number, distanceM: number}>,
 * }>} groupes, les plus pratiquées d'abord
 */
export function buildClimbGroups(activitySignals) {
  const groups = [];

  for (const s of activitySignals || []) {
    for (const c of s.climbs || []) {
      if (!hasCoords(c)) continue;
      const attempt = {
        activityId: s.activityId,
        date: s.date ?? null,
        durationSec: c.durationSec ?? null,
        avgSpeedKmh: c.avgSpeedKmh ?? null,
        vam: c.durationSec > 0 && c.gainM > 0 ? (c.gainM / c.durationSec) * 3600 : null,
        avgPowerW: c.avgPowerW ?? null,
        avgHeartRateBpm: c.avgHeartRateBpm ?? null,
        gainM: c.gainM,
        distanceM: c.distanceM,
      };
      let group = groups.find((g) => sameClimb(g, c));
      if (!group) {
        group = {
          startLat: c.startLat, startLon: c.startLon, endLat: c.endLat, endLon: c.endLon,
          members: [],
          attempts: [],
        };
        groups.push(group);
      }
      group.members.push(c);
      group.attempts.push(attempt);
    }
  }

  return groups
    .map((g) => {
      const n = g.members.length;
      const avg = (key) => g.members.reduce((sum, m) => sum + m[key], 0) / n;
      const attempts = g.attempts.slice().sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
      return {
        id: `${g.startLat.toFixed(4)},${g.startLon.toFixed(4)}`,
        startLat: g.startLat, startLon: g.startLon, endLat: g.endLat, endLon: g.endLon,
        path: g.members[0].path || [],
        distanceM: avg("distanceM"), gainM: avg("gainM"), avgGrade: avg("avgGrade"),
        attempts,
      };
    })
    .sort((a, b) => b.attempts.length - a.attempts.length || b.gainM - a.gainM);
}

/**
 * Records battus lors d'une sortie : les montées où le passage de cette sortie
 * est plus rapide que tous les passages précédents (au moins un passage
 * chronométré avant, sinon ce n'est pas un « record » mais un premier temps).
 *
 * @param {ReturnType<typeof buildClimbGroups>} groups
 * @param {string} activityId
 * @returns {Array<{group: Object, attempt: Object, previousBest: Object, gainSec: number}>}
 */
export function recordsForActivity(groups, activityId) {
  const out = [];
  for (const group of groups || []) {
    const timed = group.attempts.filter((a) => a.durationSec != null && a.durationSec > 0);
    const mine = timed.filter((a) => a.activityId === activityId);
    if (mine.length === 0) continue;
    const best = mine.reduce((m, a) => (a.durationSec < m.durationSec ? a : m));
    const firstIndex = timed.indexOf(mine[0]);
    const earlier = timed.slice(0, firstIndex).filter((a) => a.activityId !== activityId);
    if (earlier.length === 0) continue; // premier passage connu : un temps, pas un record
    const previousBest = earlier.reduce((m, a) => (a.durationSec < m.durationSec ? a : m));
    if (best.durationSec < previousBest.durationSec) {
      out.push({ group, attempt: best, previousBest, gainSec: previousBest.durationSec - best.durationSec });
    }
  }
  return out;
}

const POWER_NOISE_RATIO = 0.03; // sous ±3 % de puissance, on parle de puissance « similaire »

/**
 * Lecture du dernier passage face au meilleur temps précédent, pour distinguer
 * une vraie progression (plus vite ET plus de puissance) d'un chrono porté par
 * les conditions (plus vite à puissance égale ou moindre : vent, route,
 * efficacité). Ce sont des hypothèses, jamais des certitudes.
 *
 * @returns {{timeDeltaSec: number, powerDeltaW: number|null, hrDeltaBpm: number|null, kind: "progress"|"conditions"|"harder"|"easier"|"time-only", message: string}|null}
 */
export function compareLatestToBest(attempts) {
  const timed = (attempts || []).filter((a) => a.durationSec != null && a.durationSec > 0);
  if (timed.length < 2) return null;
  const latest = timed[timed.length - 1];
  const reference = timed.slice(0, -1).reduce((m, a) => (a.durationSec < m.durationSec ? a : m));

  const timeDeltaSec = latest.durationSec - reference.durationSec;
  const powerDeltaW = latest.avgPowerW != null && reference.avgPowerW != null ? latest.avgPowerW - reference.avgPowerW : null;
  const hrDeltaBpm = latest.avgHeartRateBpm != null && reference.avgHeartRateBpm != null ? latest.avgHeartRateBpm - reference.avgHeartRateBpm : null;
  const faster = timeDeltaSec < 0;

  if (powerDeltaW == null) {
    return { timeDeltaSec, powerDeltaW, hrDeltaBpm, kind: "time-only", message: "Pas de puissance sur les deux passages : impossible de dire si le chrono vient de ta forme ou des conditions." };
  }
  const noise = reference.avgPowerW * POWER_NOISE_RATIO;
  const morePower = powerDeltaW > noise;
  const lessPower = powerDeltaW < -noise;
  const w = Math.round(Math.abs(powerDeltaW));

  if (faster && morePower) return { timeDeltaSec, powerDeltaW, hrDeltaBpm, kind: "progress", message: `Plus rapide avec plus de puissance (+${w} W) : progression réelle probable.` };
  if (faster) return { timeDeltaSec, powerDeltaW, hrDeltaBpm, kind: "conditions", message: `Plus rapide à puissance ${lessPower ? `inférieure (−${w} W)` : "similaire"} : meilleures conditions (vent, route) ou meilleure efficacité.` };
  if (morePower) return { timeDeltaSec, powerDeltaW, hrDeltaBpm, kind: "harder", message: `Plus lent malgré plus de puissance (+${w} W) : conditions difficiles (vent, chaleur) ou fatigue probables.` };
  return { timeDeltaSec, powerDeltaW, hrDeltaBpm, kind: "easier", message: `Plus lent avec ${lessPower ? `moins de puissance (−${w} W)` : "une puissance similaire"} : effort moins soutenu ou conditions moins favorables.` };
}

/**
 * Évolution des chronos d'une montée.
 * @returns {{timed: number, best: Object|null, latest: Object|null, previousBest: Object|null, deltaVsPreviousBestSec: number|null, isLatestBest: boolean}}
 */
export function summarizeAttempts(attempts) {
  const timed = (attempts || []).filter((a) => a.durationSec != null && a.durationSec > 0);
  if (timed.length === 0) return { timed: 0, best: null, latest: null, previousBest: null, deltaVsPreviousBestSec: null, isLatestBest: false };
  const latest = timed[timed.length - 1];
  const best = timed.reduce((m, a) => (a.durationSec < m.durationSec ? a : m));
  const before = timed.slice(0, -1);
  const previousBest = before.length ? before.reduce((m, a) => (a.durationSec < m.durationSec ? a : m)) : null;
  return {
    timed: timed.length,
    best,
    latest,
    previousBest,
    deltaVsPreviousBestSec: previousBest ? latest.durationSec - previousBest.durationSec : null,
    isLatestBest: previousBest != null && latest.durationSec < previousBest.durationSec,
  };
}
