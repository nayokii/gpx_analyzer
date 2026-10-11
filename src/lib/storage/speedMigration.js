/**
 * Migration unique des vitesses moyennes déjà enregistrées.
 *
 * Les sorties importées avant la règle de lib/speed.js portent une
 * `avgSpeed` / `movingTime` qui ignorait les pauses du timer (le device
 * n'écrit aucun point pendant une pause, la durée écoulée était donc prise
 * pour du temps de roulage). Quand le fichier source original est encore
 * dans le dossier choisi, on le reparse avec les parsers et le moteur
 * actuels et on ne remplace QUE les champs de vitesse / temps en mouvement.
 *
 * Ce qui ne peut pas être reconstitué avec certitude est laissé intact (aucune écriture) :
 *   - sorties Strava (pas de fichier source ; la valeur vient déjà de Strava),
 *   - fichier source absent ou illisible.
 * Aucune autre statistique (distance, D+, FC, puissance...) n'est modifiée.
 */
import { listActivities, loadActivityDetail, loadActivitySourceArrayBuffer, loadActivitySourceText, patchActivity } from "./activityStore.js";
import { invalidateActivityCache } from "./activityCache.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { SPEED_MODEL_VERSION } from "../speed.js";

export { SPEED_MODEL_VERSION };

/**
 * @returns {Promise<{updated: Array, unchanged: number, skipped: Array, failed: Array}>}
 */
export function migrateStoredSpeeds(rootHandle) {
  // Un seul passage à la fois par dossier (ex. double effet React en dev) :
  // patchActivity fait un lire-modifier-écrire sur index.json.
  const running = inFlight.get(rootHandle);
  if (running) return running;
  const promise = runMigration(rootHandle).finally(() => inFlight.delete(rootHandle));
  inFlight.set(rootHandle, promise);
  return promise;
}

const inFlight = new WeakMap();

async function runMigration(rootHandle) {
  const report = { updated: [], unchanged: 0, skipped: [], failed: [] };
  const summaries = await listActivities(rootHandle);

  for (const summary of summaries) {
    try {
      const detail = await loadActivityDetail(rootHandle, summary.id);
      if ((detail.speedModelVersion || 0) >= SPEED_MODEL_VERSION) {
        report.unchanged++;
        continue;
      }

      const type = detail.source && detail.source.type;
      if (type === "strava" || !detail.source || !detail.source.storedFilename) {
        // Aucune écriture : une sortie sans fichier source reste strictement intacte.
        report.skipped.push({ id: detail.id, name: detail.name, reason: type === "strava" ? "strava" : "source-missing" });
        continue;
      }

      let points;
      let measured = null;
      if (type === "fit") {
        ({ points, measured } = await parseFITArrayBuffer(await loadActivitySourceArrayBuffer(rootHandle, detail.id)));
      } else {
        ({ points } = parseGPXString(await loadActivitySourceText(rootHandle, detail.id)));
      }
      const analysis = computeAnalysis(points, null, { measured });
      if (analysis.avgSpeedKmh == null) {
        report.skipped.push({ id: detail.id, name: detail.name, reason: "no-time-data" });
        continue;
      }

      const patch = {
        avgSpeed: analysis.avgSpeedKmh,
        avgSpeedElapsed: analysis.avgSpeedElapsedKmh,
        avgSpeedSource: analysis.avgSpeedSource,
        movingTime: analysis.movingTimeSec,
        speedModelVersion: SPEED_MODEL_VERSION,
      };
      // Appliqué sous le verrou d'écriture du store, sur l'Activity COURANTE : si la
      // sortie a été réimportée / migrée entre-temps (autre onglet, import en cours),
      // on renonce plutôt que d'écraser avec des valeurs périmées.
      const applied = await patchActivity(rootHandle, detail.id, (current) =>
        (current.speedModelVersion || 0) < SPEED_MODEL_VERSION &&
        current.source && current.source.storedFilename === detail.source.storedFilename
          ? patch
          : null
      );
      if (!applied) {
        report.unchanged++;
        continue;
      }
      invalidateActivityCache(rootHandle, detail.id);
      report.updated.push({
        id: detail.id,
        name: detail.name,
        source: type,
        before: { avgSpeed: detail.avgSpeed, movingTime: detail.movingTime },
        after: { avgSpeed: patch.avgSpeed, movingTime: patch.movingTime, source: patch.avgSpeedSource },
      });
    } catch (err) {
      report.failed.push({ id: summary.id, name: summary.name, error: (err && err.message) || String(err) });
    }
  }
  return report;
}
