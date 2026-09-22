/**
 * Format standard d'un événement XP (voir xp.js pour la production, et
 * progression.js pour l'assemblage en une liste plate datée/attribuée à une
 * activité). Même esprit que profile/evidence.js : une structure explicable,
 * pas un nombre nu.
 */

/** Types d'événements XP produits par xp.js — vocabulaire partagé par achievements.js et l'UI. */
export const EVENT_TYPES = {
  ACTIVITY_COMPLETED: "activity_completed",
  DISTANCE_MILESTONE: "distance_milestone",
  ELEVATION_MILESTONE: "elevation_milestone",
  DURATION_MILESTONE: "duration_milestone",
  NEW_BEST: "new_best",
  CAPABILITY_FIRST: "capability_first",
  WEEKLY_STREAK_MILESTONE: "weekly_streak_milestone",
  CHALLENGE_COMPLETED: "challenge_completed",
};

/** Types considérés comme des "paliers" pour l'affichage "challenges récemment complétés" (voir progression.js). */
export const MILESTONE_EVENT_TYPES = new Set([
  EVENT_TYPES.DISTANCE_MILESTONE,
  EVENT_TYPES.ELEVATION_MILESTONE,
  EVENT_TYPES.DURATION_MILESTONE,
  EVENT_TYPES.WEEKLY_STREAK_MILESTONE,
  EVENT_TYPES.CHALLENGE_COMPLETED,
]);

/**
 * Attache activité/date à un événement brut produit par computeActivityXp
 * (qui ne connaît pas l'id/la date de l'activité — voir xp.js).
 * @param {{type: string, xp: number, reason: string, achievementId?: string|null}} rawEvent
 * @param {{activityId: string, date: string|null}} context
 * @returns {Object}
 */
export function attachActivityContext(rawEvent, { activityId, date }) {
  return { ...rawEvent, activityId, date: date || null };
}
