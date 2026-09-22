/**
 * Challenges dynamiques — un objectif "actif" par catégorie, toujours le
 * PROCHAIN palier au-dessus du meilleur déjà réalisé (voir consigne §7 :
 * "adaptatifs", jamais un saut de volume absurde puisque chaque palier n'est
 * que légèrement au-dessus du précédent).
 *
 * Fonction pure de `activities` (+ `now`, injectable pour les tests) :
 * rejouer avec le même historique redonne exactement les mêmes challenges
 * actifs (voir consigne §11/§12) — rien n'est mémorisé ici, tout est
 * recalculé. Les challenges COMPLÉTÉS ne sont pas gérés par ce module : ils
 * sont déjà visibles dans les événements XP de type `*_milestone`
 * (progression.js), pour ne jamais faire diverger deux mécanismes qui
 * décriraient le même fait.
 *
 * Personnalisation (consigne §6) : les challenges "grimpe" et "punch" portent
 * sur le VOLUME accumulé sur une période récente (30 jours), pas sur le score
 * de la dimension correspondante (voir profile/dimensions/climbing.js : le
 * score climbing mesure un RYTHME de montée, pas un volume — les confondre
 * romprait la distinction que 6A a délibérément construite). Le comptage
 * d'efforts "punch" réutilise `activitySignals.js` (déjà utilisé par la
 * dimension punch elle-même), jamais une réimplémentation de la détection.
 */

import { deriveAllActivitySignals } from "../profile/activitySignals.js";
import { parseActivityDate } from "../history/dateUtils.js";
import { localWeekIndex } from "./weeks.js";

const DISTANCE_TIERS_KM = [20, 40, 50, 100];
const DISTANCE_XP = [30, 40, 50, 80];
const ELEVATION_TIERS_M = [300, 500, 1000];
const ELEVATION_XP = [30, 40, 60];
const ENDURANCE_TARGET_SEC = 2 * 3600;
const ENDURANCE_XP = 40;
const CONSISTENCY_TIERS_WEEKS = [2, 3, 4];
const CONSISTENCY_XP = [30, 40, 60];
const CLIMB_ACCUMULATION_TIERS_M = [300, 500, 1000];
const CLIMB_ACCUMULATION_XP = [30, 40, 60];
const PUNCH_EFFORT_TIERS = [3, 5, 10];
const PUNCH_EFFORT_XP = [30, 40, 60];

const RECENT_PERIOD_DAYS = 30;
const PUNCH_EFFORT_MIN_SEC = 60;
const PUNCH_EFFORT_MAX_SEC = 300;

function bestSingleRide(activities, key) {
  let best = null;
  for (const a of activities) {
    if (a[key] != null && (best == null || a[key] > best)) best = a[key];
  }
  return best;
}

/** Prochain palier non encore atteint par `current`, avec son XP associé. */
function nextTier(current, tiers, xpTable) {
  const value = current ?? 0;
  for (let i = 0; i < tiers.length; i++) {
    if (value < tiers[i]) return { target: tiers[i], xpReward: xpTable[i], index: i };
  }
  return null; // tous les paliers de cette échelle sont déjà dépassés
}

function activitiesInLastDays(activities, now, days) {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return activities.filter((a) => {
    const d = parseActivityDate(a);
    return d != null && d >= cutoff && d <= now;
  });
}

function activitiesInCurrentMonth(activities, now) {
  return activities.filter((a) => {
    const d = parseActivityDate(a);
    return d != null && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
}

function distinctActiveWeeks(activities) {
  const weeks = new Set();
  for (const a of activities) {
    const d = parseActivityDate(a);
    if (d) weeks.add(localWeekIndex(d));
  }
  return weeks.size;
}

function countPunchyEfforts(activities) {
  const signals = deriveAllActivitySignals(activities);
  let count = 0;
  for (const s of signals) {
    for (const e of s.efforts || []) {
      if (e.durationSec >= PUNCH_EFFORT_MIN_SEC && e.durationSec <= PUNCH_EFFORT_MAX_SEC) count++;
    }
  }
  return count;
}

/**
 * @param {import('../types.js').Activity[]} activities
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @returns {Array<{id: string, category: string, label: string, unit: string, current: number, target: number, completed: boolean, xpReward: number, reason?: string}>}
 */
export function computeChallenges(activities, options = {}) {
  const list = activities || [];
  const now = options.now || new Date();
  const challenges = [];

  {
    const best = bestSingleRide(list, "distance");
    const nt = nextTier(best, DISTANCE_TIERS_KM, DISTANCE_XP);
    if (nt) {
      challenges.push({
        id: "distance",
        category: "distance",
        label: `Faire une sortie de ${nt.target} km`,
        unit: "km",
        current: Math.round(Math.min(best ?? 0, nt.target) * 10) / 10,
        target: nt.target,
        completed: false,
        xpReward: nt.xpReward,
      });
    }
  }

  {
    const best = bestSingleRide(list, "elevationGain");
    const nt = nextTier(best, ELEVATION_TIERS_M, ELEVATION_XP);
    if (nt) {
      challenges.push({
        id: "elevation",
        category: "elevation",
        label: `Accumuler ${nt.target} m de D+ en une sortie`,
        unit: "m",
        current: Math.round(Math.min(best ?? 0, nt.target)),
        target: nt.target,
        completed: false,
        xpReward: nt.xpReward,
      });
    }
  }

  {
    let bestDurationSec = null;
    for (const a of list) {
      const d = a.movingTime ?? a.duration;
      if (d != null && (bestDurationSec == null || d > bestDurationSec)) bestDurationSec = d;
    }
    if (bestDurationSec == null || bestDurationSec < ENDURANCE_TARGET_SEC) {
      challenges.push({
        id: "endurance",
        category: "endurance",
        label: "Faire une sortie de plus de 2 h",
        unit: "s",
        current: Math.round(Math.min(bestDurationSec ?? 0, ENDURANCE_TARGET_SEC)),
        target: ENDURANCE_TARGET_SEC,
        completed: false,
        xpReward: ENDURANCE_XP,
      });
    }
  }

  {
    const monthActivities = activitiesInCurrentMonth(list, now);
    const current = distinctActiveWeeks(monthActivities);
    const nt = nextTier(current, CONSISTENCY_TIERS_WEEKS, CONSISTENCY_XP);
    if (nt) {
      challenges.push({
        id: "consistency",
        category: "consistency",
        label: `Rouler ${nt.target} semaines différentes ce mois-ci`,
        unit: "semaines",
        current,
        target: nt.target,
        completed: false,
        xpReward: nt.xpReward,
        reason: "Mesure la fréquence de pratique sur le mois en cours, pas une performance.",
      });
    }
  }

  {
    const recent = activitiesInLastDays(list, now, RECENT_PERIOD_DAYS);
    const current = recent.reduce((sum, a) => sum + (a.elevationGain || 0), 0);
    const nt = nextTier(current, CLIMB_ACCUMULATION_TIERS_M, CLIMB_ACCUMULATION_XP);
    if (nt) {
      challenges.push({
        id: "climb_accumulation",
        category: "climbing",
        label: `Développer ta grimpe : accumuler ${nt.target} m de D+ sur ${RECENT_PERIOD_DAYS} jours`,
        unit: "m",
        current: Math.round(current),
        target: nt.target,
        completed: false,
        xpReward: nt.xpReward,
        personalized: true,
      });
    }
  }

  {
    const recent = activitiesInLastDays(list, now, RECENT_PERIOD_DAYS);
    const current = countPunchyEfforts(recent);
    const nt = nextTier(current, PUNCH_EFFORT_TIERS, PUNCH_EFFORT_XP);
    if (nt) {
      challenges.push({
        id: "punch_effort",
        category: "punch",
        label: `Entretenir ton punch : ${nt.target} efforts courts détectés sur ${RECENT_PERIOD_DAYS} jours`,
        unit: "efforts",
        current,
        target: nt.target,
        completed: false,
        xpReward: nt.xpReward,
        personalized: true,
      });
    }
  }

  return challenges;
}
