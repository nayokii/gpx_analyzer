/**
 * Format standard d'une preuve individuelle utilisée par une dimension du
 * profil. Permet à une future UI de répondre "pourquoi ce score ?" (voir
 * consigne §9) sans avoir à deviner la structure interne de chaque dimension.
 */

/**
 * @param {Object} params
 * @param {string} params.activityId
 * @param {string} params.metric - nom de la métrique contribuée (ex. "movingTimeHours", "climbVam")
 * @param {number} params.value - valeur brute de la métrique pour cette activité/preuve
 * @param {"measured"|"estimated"|"speed"} params.dataQuality - qualité de CETTE preuve précise
 * @param {string} params.reason - phrase courte et factuelle expliquant la contribution (jamais de conclusion psychologique)
 * @returns {{activityId: string, metric: string, value: number, dataQuality: string, reason: string}}
 */
export function buildEvidenceEntry({ activityId, metric, value, dataQuality, reason }) {
  return { activityId, metric, value, dataQuality, reason };
}

/**
 * Détermine la `dataQuality` agrégée d'un ensemble de preuves individuelles :
 * "measured" seulement si TOUTES les preuves sont mesurées, "estimated" si
 * toutes estimées, "mixed" si les deux coexistent, "speed" si aucune preuve
 * n'a de composante puissance/capteur dédié.
 * @param {Array<{dataQuality: string}>} evidence
 * @returns {"measured"|"estimated"|"speed"|"mixed"|"none"}
 */
export function aggregateDataQuality(evidence) {
  if (!evidence || evidence.length === 0) return "none";
  const kinds = new Set(evidence.map((e) => e.dataQuality));
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has("measured") && kinds.has("estimated")) return "mixed";
  return "mixed";
}
