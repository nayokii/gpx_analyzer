/**
 * Coach V1 — branchement du contexte pur (`context.js`) sur un repository
 * d'activités RÉEL (voir storage/activityRepository.js), sans dupliquer la
 * moindre logique de stockage/cloud/cache : ce module ne fait qu'appeler
 * `repository.listActivities()` puis `repository.loadActivityDetails()` —
 * exactement les mêmes fonctions déjà utilisées par ProfileView.jsx et les
 * autres vues — puis délègue tout le calcul à `buildCoachContext()`.
 *
 * Lecture seule : aucune des fonctions appelées ici n'écrit ni ne supprime.
 */

import { buildCoachContext } from "./context.js";

/**
 * @param {{listActivities: Function, loadActivityDetails: Function}} repository -
 *   voir storage/activityRepository.js: createActivityRepository()
 * @param {Object} [options] - transmis tel quel à `buildCoachContext()`
 * @returns {Promise<Object>} CoachContext (voir context.js)
 */
export async function buildCoachContextFromRepository(repository, options = {}) {
  const { items } = await repository.listActivities();
  const settled = await repository.loadActivityDetails(items);
  const activities = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  return buildCoachContext(activities, options);
}
