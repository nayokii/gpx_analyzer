/**
 * Entrées d'analyse d'UNE sortie pour le cockpit, avec la même règle que GPXAnalyzer.jsx (openActivityFromHistory) :
 *  - FIT / GPX locaux : le fichier ORIGINAL est reparsé (altitude brute, totaux de session du device) ;
 *  - Strava (pas de fichier) : reconstruction depuis `samples` ;
 *  - fichier source illisible : repli sur `samples`, signalé par `source: "samples"`.
 *
 * Pourquoi pas toujours `samples` : leur altitude est déjà lissée à l'import, et computeAnalysis la lisse une seconde fois ;
 * le D+ cumulé et les montées divergeaient alors de l'analyse détaillée (mesuré sur la sortie FIT de test : D+ 200,8 m contre
 * 209,6 m, première montée 33,7 m contre 57,5 m).
 */
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { loadActivitySourceArrayBuffer, loadActivitySourceText } from "../storage/activityStore.js";
import { activityToPoints } from "./rideModel.js";

/**
 * @param {Object|null} rootHandle - dossier de stockage local (null : pas de fichier accessible)
 * @param {import('../types.js').Activity} activity
 * @returns {Promise<{points: Array, measured: Object|null, source: "file"|"samples"}>}
 */
export async function loadRideInputs(rootHandle, activity) {
  const fromSamples = () => ({ points: activityToPoints(activity), measured: null, source: "samples" });
  const type = activity && activity.source && activity.source.type;
  if (!rootHandle || !activity || !activity.source || !activity.source.storedFilename || (type !== "fit" && type !== "gpx")) {
    return fromSamples();
  }
  try {
    if (type === "fit") {
      const { points, measured } = await parseFITArrayBuffer(await loadActivitySourceArrayBuffer(rootHandle, activity.id));
      return { points, measured: measured || null, source: "file" };
    }
    const { points } = parseGPXString(await loadActivitySourceText(rootHandle, activity.id));
    return { points, measured: null, source: "file" };
  } catch {
    return fromSamples();
  }
}
