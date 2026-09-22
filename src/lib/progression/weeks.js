/**
 * Index de semaine locale, monotone et consécutif — utilisé pour détecter des
 * "semaines actives consécutives" (streak) et pour compter des semaines
 * distinctes dans un mois (régularité). PAS un numéro de semaine ISO officiel
 * (voir history/dateUtils.js:localWeekKey pour ça, utilisé ailleurs pour
 * l'affichage) : ici on a seulement besoin qu'un pas de 7 jours locaux
 * corresponde à un pas de +1 sur l'index, sans se soucier de la numérotation
 * calendaire — donc pas de dépendance à la logique ISO existante.
 *
 * Même limite de fuseau horaire déjà documentée dans dateUtils.js (calcul en
 * fuseau local de l'environnement d'exécution).
 */

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;
// Lundi arbitraire fixe servant uniquement de point zéro — n'importe quel
// lundi conviendrait, seule la cohérence compte.
const EPOCH_MONDAY = new Date(2000, 0, 3);

/**
 * @param {Date} date
 * @returns {number} entier croissant avec le temps ; deux dates dans la même
 *   semaine locale (lundi-dimanche) partagent le même index, deux semaines
 *   consécutives ont des index consécutifs.
 */
export function localWeekIndex(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - dayNum);
  return Math.round((d.getTime() - EPOCH_MONDAY.getTime()) / MS_PER_WEEK);
}
