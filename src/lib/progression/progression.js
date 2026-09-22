/**
 * Point d'entrée du système de progression (Alter Ego).
 *
 *   Activity[] (déjà chargées, jamais reparsées)
 *         ↓ un seul passage chronologique
 *   événements XP (xp.js) — idempotent par construction (voir xp.js)
 *         ↓
 *   XP total → niveau/titre (levels.js)
 *         ↓
 *   achievements (achievements.js) — dérivés des mêmes événements
 *         ↓
 *   challenges actifs (challenges.js) — recalculés, jamais stockés
 *         ↓
 *   Alter Ego structuré, sérialisable
 *
 * `computeProgression` est une fonction PURE de `(activities, profile)` :
 * rejouer le même historique (même 3 fois la même activité dans le tableau
 * serait un bug appelant, pas un problème ici puisqu'on ne fait QUE lire
 * `activities` une fois) donne toujours EXACTEMENT le même résultat — voir
 * consigne §11/§12. Il n'y a pas de "compteur qui s'incrémente" quelque part :
 * l'XP totale est recalculée en entier à chaque appel à partir de
 * l'historique complet, jamais accumulée par-dessus un état précédent.
 */

import { computeActivityXp, XP_AMOUNTS } from "./xp.js";
import { attachActivityContext, MILESTONE_EVENT_TYPES } from "./events.js";
import { computeAchievements } from "./achievements.js";
import { computeChallenges } from "./challenges.js";
import { getXpProgress, getTitleForLevel } from "./levels.js";
import { localWeekIndex } from "./weeks.js";
import { parseActivityDate } from "../history/dateUtils.js";
import { computeCyclistProfile } from "../profile/profile.js";

export const PROGRESSION_VERSION = 1;

/** Paliers de streak hebdomadaire qui déclenchent un événement XP (pas un XP à chaque semaine indéfiniment — voir xp.js pour le montant). */
const WEEKLY_STREAK_XP_TIERS = new Set([2, 4, 8, 12]);

const RECENT_EVENTS_LIMIT = 15;

function isMtbOrGravel(activity) {
  return activity.sportType === "mtb" || activity.sportType === "gravel";
}

/**
 * Parcourt les activités triées chronologiquement une seule fois et produit
 * la liste plate de tous les événements XP (chaque événement daté/attribué à
 * une activité). Séparé de `computeProgression` pour rester testable seul.
 *
 * @param {import('../types.js').Activity[]} activities
 * @returns {Array} événements XP, dans l'ordre chronologique des activités
 */
export function computeXpTimeline(activities) {
  const dated = (activities || [])
    .map((a) => ({ activity: a, date: parseActivityDate(a) }))
    .sort((a, b) => {
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      if (a.date) return -1; // les activités non datées passent après, dans leur ordre d'origine
      if (b.date) return 1;
      return 0;
    });

  const context = {
    isFirstActivityEver: true,
    priorBestDistanceKm: null,
    priorBestElevationGainM: null,
    priorLongestDurationSec: null,
    priorHasMeasuredPower: false,
    priorHasHeartRate: false,
    priorHasMtb: false,
  };
  let lastActiveWeekIndex = null;
  let currentStreak = 0;

  const allEvents = [];

  for (const { activity, date } of dated) {
    let activityContext = { ...context };

    if (date) {
      const weekIdx = localWeekIndex(date);
      if (lastActiveWeekIndex == null) {
        currentStreak = 1;
      } else if (weekIdx === lastActiveWeekIndex) {
        // Même semaine locale qu'une activité déjà traitée : ne recalcule pas le streak.
      } else if (weekIdx === lastActiveWeekIndex + 1) {
        currentStreak += 1;
      } else {
        currentStreak = 1; // rupture de régularité
      }
      if (weekIdx !== lastActiveWeekIndex) {
        if (WEEKLY_STREAK_XP_TIERS.has(currentStreak)) {
          activityContext.newWeeklyStreak = currentStreak;
        }
        lastActiveWeekIndex = weekIdx;
      }
    }

    const { events } = computeActivityXp(activity, activityContext);
    for (const e of events) {
      allEvents.push(attachActivityContext(e, { activityId: activity.id, date: activity.date }));
    }

    // Met à jour le contexte pour l'activité SUIVANTE (jamais la sienne propre).
    context.isFirstActivityEver = false;
    if (activity.distance != null) context.priorBestDistanceKm = Math.max(context.priorBestDistanceKm ?? -Infinity, activity.distance);
    if (activity.elevationGain != null) context.priorBestElevationGainM = Math.max(context.priorBestElevationGainM ?? -Infinity, activity.elevationGain);
    const durationSec = activity.movingTime ?? activity.duration;
    if (durationSec != null) context.priorLongestDurationSec = Math.max(context.priorLongestDurationSec ?? -Infinity, durationSec);
    if (activity.flags) {
      context.priorHasMeasuredPower = context.priorHasMeasuredPower || (activity.flags.hasPower && !activity.flags.powerEstimated);
      context.priorHasHeartRate = context.priorHasHeartRate || !!activity.flags.hasHeartRate;
    }
    context.priorHasMtb = context.priorHasMtb || isMtbOrGravel(activity);
  }

  return allEvents;
}

/**
 * @param {import('../types.js').Activity[]} activities - activités déjà chargées (voir README.md pour les besoins en `samples`)
 * @param {Object|null} profile - résultat de computeCyclistProfile(activities) — PASSÉ PAR L'APPELANT, jamais recalculé ici (voir consigne §22). `null` accepté (profileSnapshot sera `null`).
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @returns {Object} Alter Ego structuré (voir README.md)
 */
export function computeProgression(activities, profile, options = {}) {
  const list = activities || [];
  const now = options.now || new Date();

  const events = computeXpTimeline(list);
  const xp = events.reduce((sum, e) => sum + e.xp, 0);
  const levelProgress = getXpProgress(xp);
  const title = getTitleForLevel(levelProgress.level);
  const achievements = computeAchievements(events);
  const challenges = computeChallenges(list, { now });

  const completedMilestones = events
    .filter((e) => MILESTONE_EVENT_TYPES.has(e.type))
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const recentEvents = events
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, RECENT_EVENTS_LIMIT);

  return {
    version: PROGRESSION_VERSION,
    computedAt: now.toISOString(),
    activityCount: list.length,
    processedActivityIds: list.map((a) => a.id),
    xp,
    level: levelProgress.level,
    title,
    levelProgress,
    profileSnapshot: profile || null,
    achievements,
    challenges,
    completedMilestones,
    recentEvents,
  };
}

/**
 * Reconstruction complète depuis l'historique seul (voir consigne §12) :
 * recalcule aussi le profil 6A plutôt que d'en exiger un déjà calculé —
 * utile pour une réparation d'état ou un appel autonome hors ProfileView.
 * Fonctionnellement identique à `computeProgression(activities,
 * computeCyclistProfile(activities), options)`.
 *
 * @param {import('../types.js').Activity[]} activities
 * @param {Object} [options]
 * @returns {Object}
 */
export function rebuildProgression(activities, options = {}) {
  const profile = computeCyclistProfile(activities || [], options);
  return computeProgression(activities, profile, options);
}

export { XP_AMOUNTS };
