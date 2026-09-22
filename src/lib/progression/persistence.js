/**
 * Lecture/écriture de l'état de progression persisté, dans `athlete.json` à
 * la RACINE du dossier choisi par l'utilisateur (voir storage/activityStore.js
 * — ce fichier était déjà annoncé "(Phase 7)" dans son commentaire d'en-tête
 * depuis la Phase 2). Réutilise `readTextFile`/`writeTextFile`, exportées
 * depuis activityStore.js pour cet usage précis — pas de deuxième mécanisme
 * de fichiers, même API FileSystemDirectoryHandle que le reste du projet.
 *
 * `athlete.json` ne duplique JAMAIS les activités : voir state.js pour ce
 * qu'il contient réellement (un instantané de cache, pas une source de
 * vérité — `rebuildProgression()` en `progression.js` reconstruit toujours
 * un équivalent strict depuis les `Activity[]`).
 */

import { readTextFile, writeTextFile } from "../storage/activityStore.js";
import { createEmptyProgressionState, isValidProgressionState, progressionToState, PROGRESSION_STATE_VERSION } from "./state.js";
import { rebuildProgression, computeProgression } from "./progression.js";

const ATHLETE_FILE = "athlete.json";

/**
 * @param {any} raw - état lu depuis athlete.json
 * @returns {Object} état à jour du schéma courant
 */
function migrateProgressionState(raw) {
  if (raw.version === PROGRESSION_STATE_VERSION) return raw;
  // Aucune version antérieure à migrer pour l'instant (première version du
  // schéma) — garde-fou prêt pour de futures migrations : fusionne sur un
  // état vide plutôt que de faire confiance aveuglément à un schéma inconnu.
  return { ...createEmptyProgressionState(), ...raw, version: PROGRESSION_STATE_VERSION };
}

/**
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<Object|null>} état persisté (migré si besoin), ou `null` si absent/corrompu — jamais une exception (voir rebuildProgression pour le repli).
 */
export async function loadProgressionState(rootHandle) {
  try {
    const text = await readTextFile(rootHandle, ATHLETE_FILE);
    const parsed = JSON.parse(text);
    if (!isValidProgressionState(parsed)) return null;
    return migrateProgressionState(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {Object} state - voir state.js
 */
export async function saveProgressionState(rootHandle, state) {
  await writeTextFile(rootHandle, ATHLETE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Recalcule la progression depuis l'historique complet (voir
 * progression.js: rebuildProgression/computeProgression — jamais un total
 * incrémenté) et persiste l'instantané résultant. C'est l'opération normale
 * après chargement de l'historique par l'UI (voir AlterEgoView.jsx).
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {import('../types.js').Activity[]} activities
 * @param {Object|null} [profile] - résultat déjà calculé de computeCyclistProfile(activities), pour éviter un recalcul (voir consigne §22) ; si absent, recalculé via rebuildProgression.
 * @param {Object} [options]
 * @returns {Promise<{progression: Object, state: Object, previousState: Object|null}>}
 */
export async function computeAndPersistProgression(rootHandle, activities, profile, options = {}) {
  const previousState = await loadProgressionState(rootHandle);
  const progression = profile
    ? computeProgression(activities, profile, options)
    : rebuildProgression(activities, options);
  const state = progressionToState(progression, previousState);
  await saveProgressionState(rootHandle, state);
  return { progression, state, previousState };
}
