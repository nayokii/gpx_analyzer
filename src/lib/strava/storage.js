/**
 * Lecture/écriture de l'état de connexion/synchronisation Strava, dans
 * `strava.json` à la RACINE du dossier choisi par l'utilisateur — même
 * mécanisme que `athlete.json` (voir ../progression/persistence.js) : ce
 * module réutilise `readTextFile`/`writeTextFile` exportées depuis
 * ../storage/activityStore.js, jamais un deuxième mécanisme de fichiers.
 *
 * Les activités Strava elles-mêmes ne sont JAMAIS stockées ici : une fois
 * converties par adapter.js, elles rejoignent `activities/` comme n'importe
 * quelle autre sortie (voir ../storage/activityStore.js: saveActivity) —
 * `strava.json` ne contient que l'état de connexion/synchro (voir types.js).
 */

import { readTextFile, writeTextFile } from "../storage/activityStore.js";
import { createEmptyStravaState, isValidStravaState, STRAVA_STATE_VERSION } from "./types.js";

const STRAVA_FILE = "strava.json";

/**
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<import('./types.js').StravaConnectionState>} état persisté, ou état vide (déconnecté) si absent/corrompu — jamais une exception
 */
export async function loadStravaState(rootHandle) {
  try {
    const text = await readTextFile(rootHandle, STRAVA_FILE);
    const parsed = JSON.parse(text);
    if (!isValidStravaState(parsed)) return createEmptyStravaState();
    return { ...createEmptyStravaState(), ...parsed, version: STRAVA_STATE_VERSION };
  } catch {
    return createEmptyStravaState();
  }
}

/**
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {import('./types.js').StravaConnectionState} state
 */
export async function saveStravaState(rootHandle, state) {
  await writeTextFile(rootHandle, STRAVA_FILE, JSON.stringify(state, null, 2));
}

/** Efface toute trace de connexion (déconnexion) — jamais les activités déjà importées, qui restent dans l'historique comme n'importe quelle sortie. */
export async function clearStravaState(rootHandle) {
  await saveStravaState(rootHandle, createEmptyStravaState());
}
