/**
 * XP par activité — fonction pure : `computeActivityXp(activity, context)`.
 *
 * RÈGLE (voir consigne §2/§3) : chaque événement correspond à un fait
 * observable, jamais à un multiplicateur brut d'une métrique
 * (`distance * 100` interdit). Les montants sont des constantes plates,
 * documentées ci-dessous, jamais proportionnelles à la valeur de la métrique
 * elle-même.
 *
 * IDEMPOTENCE (voir consigne §11) : cette fonction ne dépend que de
 * `activity` et de `context` (les "meilleurs" déjà connus AVANT cette
 * activité, fournis par l'appelant — voir progression.js qui parcourt
 * l'historique une seule fois, chronologiquement). Rejouer la même activité
 * avec le même `context` produit exactement le même résultat — l'idempotence
 * vient de la façon dont progression.js appelle cette fonction (un seul
 * passage chronologique sur l'historique complet, jamais un total qu'on
 * incrémente au fil des ouvertures d'activité), pas d'un verrou ad hoc ici.
 *
 * MESURÉ VS ESTIMÉ (voir consigne §3) : les paliers "première puissance
 * mesurée" exigent explicitement `flags.hasPower && !flags.powerEstimated` —
 * une sortie à puissance estimée ne déclenche jamais cet événement.
 */

import { fmtDurationLong } from "../utils.js";

export const XP_AMOUNTS = {
  ACTIVITY_COMPLETED: 15,
  DISTANCE_MILESTONE: 25,
  ELEVATION_MILESTONE: 25,
  DURATION_MILESTONE: 20,
  NEW_BEST: 10,
  CAPABILITY_FIRST: 10,
  WEEKLY_STREAK_MILESTONE: 15,
};

/** Paliers de distance par sortie (km) — la répétition d'une même sortie ne peut pas re-franchir un palier déjà connu (voir `newlyCrossedTiers`). */
export const DISTANCE_MILESTONES_KM = [20, 40, 50, 100, 150, 200];
/** Paliers de D+ par sortie (m). */
export const ELEVATION_MILESTONES_M = [300, 500, 1000, 1500, 2000];
/** Paliers de durée par sortie (s). */
export const DURATION_MILESTONES_SEC = [3600, 7200, 3 * 3600, 5 * 3600];

/** Palier → id d'achievement (voir achievements.js) ; `undefined` = palier XP sans badge dédié. */
const DISTANCE_ACHIEVEMENTS = { 20: "FIRST_20KM", 40: "FIRST_40KM", 50: "FIRST_50KM", 100: "FIRST_100KM" };
const ELEVATION_ACHIEVEMENTS = { 500: "FIRST_500M_CLIMB", 1000: "FIRST_1000M_CLIMB" };
const DURATION_ACHIEVEMENTS = { [2 * 3600]: "FIRST_2H_RIDE" };

/**
 * Paliers d'une échelle nouvellement franchis par `value`, sachant que
 * `priorBest` (le meilleur déjà atteint AVANT cette activité) a déjà pu en
 * franchir certains. Une seule activité peut franchir plusieurs paliers d'un
 * coup (ex. première sortie à 120 km franchit 20/40/50/100) — c'est un fait
 * réel, pas un bug : voir levels.js pour la courbe qui empêche que cela ne
 * donne pour autant des dizaines de niveaux d'un coup.
 *
 * @param {number|null} value
 * @param {number|null|undefined} priorBest
 * @param {number[]} tiers
 * @returns {number[]}
 */
export function newlyCrossedTiers(value, priorBest, tiers) {
  if (value == null) return [];
  const floor = priorBest ?? -Infinity;
  return tiers.filter((t) => t > floor && value >= t);
}

/**
 * @param {import('../types.js').Activity} activity
 * @param {Object} [context]
 * @param {boolean} [context.isFirstActivityEver]
 * @param {number|null} [context.priorBestDistanceKm]
 * @param {number|null} [context.priorBestElevationGainM]
 * @param {number|null} [context.priorLongestDurationSec]
 * @param {boolean} [context.priorHasMeasuredPower]
 * @param {boolean} [context.priorHasHeartRate]
 * @param {boolean} [context.priorHasMtb]
 * @param {number|null} [context.newWeeklyStreak] - fourni par progression.js UNIQUEMENT sur l'activité qui étend le streak d'une nouvelle semaine (voir progression.js)
 * @returns {{total: number, events: Array<{type: string, xp: number, reason: string, achievementId?: string|null}>}}
 */
export function computeActivityXp(activity, context = {}) {
  const events = [];
  let total = 0;
  function push(type, xp, reason, extra = {}) {
    events.push({ type, xp, reason, achievementId: extra.achievementId ?? null, ...extra });
    total += xp;
  }

  push(
    "activity_completed",
    XP_AMOUNTS.ACTIVITY_COMPLETED,
    context.isFirstActivityEver ? "Première sortie enregistrée" : "Sortie enregistrée",
    context.isFirstActivityEver ? { achievementId: "FIRST_RIDE" } : {}
  );

  if (activity.distance != null) {
    for (const tier of newlyCrossedTiers(activity.distance, context.priorBestDistanceKm, DISTANCE_MILESTONES_KM)) {
      push("distance_milestone", XP_AMOUNTS.DISTANCE_MILESTONE, `${tier} km atteints en une sortie`, {
        tier,
        achievementId: DISTANCE_ACHIEVEMENTS[tier] || null,
      });
    }
    if (context.priorBestDistanceKm != null && activity.distance > context.priorBestDistanceKm) {
      push("new_best", XP_AMOUNTS.NEW_BEST, `Nouvelle plus longue distance : ${activity.distance.toFixed(1)} km`, { metric: "distance" });
    }
  }

  if (activity.elevationGain != null) {
    for (const tier of newlyCrossedTiers(activity.elevationGain, context.priorBestElevationGainM, ELEVATION_MILESTONES_M)) {
      push("elevation_milestone", XP_AMOUNTS.ELEVATION_MILESTONE, `${tier} m de D+ accumulés en une sortie`, {
        tier,
        achievementId: ELEVATION_ACHIEVEMENTS[tier] || null,
      });
    }
    if (context.priorBestElevationGainM != null && activity.elevationGain > context.priorBestElevationGainM) {
      push("new_best", XP_AMOUNTS.NEW_BEST, `Nouveau record de dénivelé : ${Math.round(activity.elevationGain)} m`, { metric: "elevationGain" });
    }
  }

  const durationSec = activity.movingTime ?? activity.duration;
  if (durationSec != null) {
    for (const tier of newlyCrossedTiers(durationSec, context.priorLongestDurationSec, DURATION_MILESTONES_SEC)) {
      push("duration_milestone", XP_AMOUNTS.DURATION_MILESTONE, `Sortie de plus de ${fmtDurationLong(tier)}`, {
        tier,
        achievementId: DURATION_ACHIEVEMENTS[tier] || null,
      });
    }
    if (context.priorLongestDurationSec != null && durationSec > context.priorLongestDurationSec) {
      push("new_best", XP_AMOUNTS.NEW_BEST, "Nouvelle plus longue sortie (temps en mouvement)", { metric: "duration" });
    }
  }

  if (activity.flags) {
    if (activity.flags.hasPower && !activity.flags.powerEstimated && !context.priorHasMeasuredPower) {
      push("capability_first", XP_AMOUNTS.CAPABILITY_FIRST, "Première sortie avec puissance mesurée", { achievementId: "FIRST_MEASURED_POWER" });
    }
    if (activity.flags.hasHeartRate && !context.priorHasHeartRate) {
      push("capability_first", XP_AMOUNTS.CAPABILITY_FIRST, "Première sortie avec fréquence cardiaque", { achievementId: "FIRST_HEART_RATE_DATA" });
    }
  }

  if ((activity.sportType === "mtb" || activity.sportType === "gravel") && !context.priorHasMtb) {
    push("capability_first", XP_AMOUNTS.CAPABILITY_FIRST, "Première sortie VTT/gravel", { achievementId: "FIRST_MTB_RIDE" });
  }

  if (context.newWeeklyStreak != null) {
    push("weekly_streak_milestone", XP_AMOUNTS.WEEKLY_STREAK_MILESTONE, `${context.newWeeklyStreak} semaines actives consécutives`, {
      streak: context.newWeeklyStreak,
      achievementId: context.newWeeklyStreak === 2 ? "FIRST_WEEK_STREAK" : null,
    });
  }

  return { total, events };
}
