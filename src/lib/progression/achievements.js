/**
 * Catalogue d'achievements + calcul de leur état de déverrouillage.
 *
 * Ne fait AUCUN parcours d'activités lui-même : reçoit la liste plate des
 * événements XP déjà produits par le passage chronologique unique de
 * progression.js (voir xp.js: `achievementId` porté par l'événement qui
 * déverrouille chaque achievement). Ainsi achievement et XP proviennent
 * toujours du même fait, à la même date — jamais deux logiques séparées qui
 * pourraient diverger.
 */

export const ACHIEVEMENT_CATALOG = {
  FIRST_RIDE: { label: "Première sortie", description: "Enregistrer sa toute première sortie." },
  FIRST_20KM: { label: "20 km", description: "Parcourir 20 km en une sortie." },
  FIRST_40KM: { label: "40 km", description: "Parcourir 40 km en une sortie." },
  FIRST_50KM: { label: "50 km", description: "Parcourir 50 km en une sortie." },
  FIRST_100KM: { label: "100 km", description: "Parcourir 100 km en une sortie." },
  FIRST_500M_CLIMB: { label: "500 m D+", description: "Accumuler 500 m de dénivelé positif en une sortie." },
  FIRST_1000M_CLIMB: { label: "1000 m D+", description: "Accumuler 1000 m de dénivelé positif en une sortie." },
  FIRST_2H_RIDE: { label: "2 heures", description: "Rouler plus de 2 h en une sortie." },
  FIRST_MEASURED_POWER: { label: "Puissance mesurée", description: "Enregistrer une sortie avec un capteur de puissance réel." },
  FIRST_HEART_RATE_DATA: { label: "Fréquence cardiaque", description: "Enregistrer une sortie avec la fréquence cardiaque." },
  FIRST_MTB_RIDE: { label: "VTT / Gravel", description: "Enregistrer une sortie VTT ou gravel." },
  FIRST_WEEK_STREAK: { label: "2 semaines de suite", description: "Rouler au moins une fois par semaine, deux semaines consécutives." },
};

/**
 * @param {Array<{achievementId?: string|null, activityId: string, date: string|null}>} xpEvents - liste plate (voir progression.js)
 * @returns {Array<{id: string, label: string, description: string, unlocked: boolean, unlockedAt: string|null, activityId: string|null}>}
 *   Ordre stable : celui de ACHIEVEMENT_CATALOG (pas trié par date de déverrouillage).
 */
export function computeAchievements(xpEvents) {
  const unlockedMap = new Map();
  for (const e of xpEvents || []) {
    if (e.achievementId && !unlockedMap.has(e.achievementId)) {
      unlockedMap.set(e.achievementId, { unlockedAt: e.date, activityId: e.activityId });
    }
  }

  return Object.entries(ACHIEVEMENT_CATALOG).map(([id, meta]) => {
    const unlock = unlockedMap.get(id);
    return {
      id,
      label: meta.label,
      description: meta.description,
      unlocked: !!unlock,
      unlockedAt: unlock ? unlock.unlockedAt : null,
      activityId: unlock ? unlock.activityId : null,
    };
  });
}
