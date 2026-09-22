/**
 * Forme de l'état de progression PERSISTÉ (athlete.json — voir persistence.js).
 *
 * IMPORTANT — ce que ce fichier n'est PAS : une deuxième source de vérité.
 * `computeProgression()`/`rebuildProgression()` (progression.js) recalculent
 * TOUJOURS l'intégralité de l'XP/niveau/achievements/challenges à partir des
 * `Activity[]` complètes — exactement comme `computeCyclistProfile()` ne
 * stocke jamais le profil ailleurs que dans les activités elles-mêmes (voir
 * consigne §1/§3/§12). L'état persisté ici n'est qu'un INSTANTANÉ DE CACHE :
 * il sert à (1) afficher immédiatement un état plausible avant que le
 * recalcul complet ne soit disponible, et (2) savoir quelles activités
 * étaient déjà connues au dernier enregistrement, pour distinguer "nouveau
 * depuis la dernière visite" dans l'UI (voir `processedActivityIds`). Si ce
 * fichier est perdu ou corrompu, `rebuildProgression(activities)` reconstruit
 * un état strictement équivalent — jamais de perte de progression réelle.
 */

export const PROGRESSION_STATE_VERSION = 1;

/** @returns {Object} état vide, avant toute activité. */
export function createEmptyProgressionState() {
  const now = new Date().toISOString();
  return {
    version: PROGRESSION_STATE_VERSION,
    xp: 0,
    level: 1,
    unlockedAchievements: [],
    completedChallenges: [],
    activeChallenges: [],
    processedActivityIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Construit l'état à persister à partir d'un résultat frais de
 * `computeProgression()`/`rebuildProgression()` — une simple projection
 * (sous-ensemble sérialisable, pas de recalcul) plus la préservation de
 * `createdAt` depuis l'état précédent s'il existe.
 *
 * @param {Object} progression - résultat de computeProgression()
 * @param {Object|null} [previousState] - état persisté précédent, pour préserver createdAt
 * @returns {Object}
 */
export function progressionToState(progression, previousState = null) {
  const now = new Date().toISOString();
  return {
    version: PROGRESSION_STATE_VERSION,
    xp: progression.xp,
    level: progression.level,
    unlockedAchievements: progression.achievements
      .filter((a) => a.unlocked)
      .map((a) => ({ id: a.id, unlockedAt: a.unlockedAt, activityId: a.activityId })),
    completedChallenges: progression.completedMilestones.map((m) => ({
      type: m.type,
      tier: m.tier ?? null,
      reason: m.reason,
      xp: m.xp,
      activityId: m.activityId,
      date: m.date,
    })),
    activeChallenges: progression.challenges,
    processedActivityIds: progression.processedActivityIds,
    createdAt: (previousState && previousState.createdAt) || now,
    updatedAt: now,
  };
}

/**
 * @param {any} obj
 * @returns {boolean} true si `obj` a la forme minimale attendue d'un état de progression persisté.
 */
export function isValidProgressionState(obj) {
  return (
    !!obj &&
    typeof obj === "object" &&
    typeof obj.version === "number" &&
    typeof obj.xp === "number" &&
    Array.isArray(obj.unlockedAchievements) &&
    Array.isArray(obj.completedChallenges) &&
    Array.isArray(obj.processedActivityIds)
  );
}
