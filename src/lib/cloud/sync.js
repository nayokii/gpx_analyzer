/**
 * Orchestration de la synchronisation d'UNE sortie locale vers le cloud (voir
 * consigne §15 : "première synchronisation" — pas encore de synchro
 * bidirectionnelle automatique, voir consigne §22, qui reste une phase dédiée
 * future). Même séparation de responsabilités que ../strava/sync.js :
 *  - activities.js : métadonnées (Postgres)
 *  - files.js       : fichier original (Storage)
 *  - types.js       : hash + conversion Activity -> ligne
 *  - sync.js (ici)  : orchestration, ne connaît le détail d'aucun des deux
 */

import { computeFileHash, activityToRow } from "./types.js";
import { createCloudActivity, findCloudActivityByHash, deleteCloudActivity } from "./activities.js";
import { uploadActivityFile } from "./files.js";
import { CloudDuplicateActivityError, CloudUnsupportedSourceError } from "./errors.js";

/**
 * Synchronise une activité locale vers le cloud : hash du fichier original,
 * vérification de doublon, création de la ligne de métadonnées, upload du
 * fichier. Résultat garanti cohérent : si l'upload du fichier échoue après
 * création de la ligne, la ligne orpheline est retirée plutôt que laissée
 * sans fichier source (voir §5 : le fichier original est la source de vérité,
 * une ligne sans fichier n'en serait pas une).
 *
 * @param {Object} params
 * @param {import('../types.js').Activity} params.activity - Activity locale complète (voir ../storage/activityStore.js: loadActivityDetail)
 * @param {string|ArrayBuffer} params.originalFileContent - contenu brut du fichier original (texte GPX ou ArrayBuffer FIT — voir ../storage/activityStore.js: loadActivitySourceText/loadActivitySourceArrayBuffer)
 * @param {'gpx'|'fit'} params.sourceFormat
 * @returns {Promise<import('./types.js').CloudActivity>}
 * @throws {CloudUnsupportedSourceError} si sourceFormat n'est ni 'gpx' ni 'fit' (voir consigne §6 : seuls ces formats sont pris en charge en 11A — une sortie 'demo' ou déjà importée depuis Strava n'est pas synchronisable ici)
 * @throws {CloudDuplicateActivityError} si un fichier identique (même empreinte) est déjà synchronisé pour cet utilisateur — `.existingActivity` porte l'activité déjà présente
 */
export async function uploadActivity({ activity, originalFileContent, sourceFormat }) {
  if (sourceFormat !== "gpx" && sourceFormat !== "fit") {
    throw new CloudUnsupportedSourceError(activity.source?.type || sourceFormat);
  }

  const fileHash = await computeFileHash(originalFileContent);

  // Vérification préalable : évite un upload de fichier inutile avant un
  // échec prévisible. La contrainte UNIQUE (user_id, file_hash) côté base
  // (voir supabase/schema.sql) reste la garantie réelle contre une course
  // concurrente (deux synchros du même fichier lancées en parallèle) — gérée
  // en filet de sécurité juste après.
  const existing = await findCloudActivityByHash(fileHash);
  if (existing) throw new CloudDuplicateActivityError(existing);

  const row = activityToRow(activity, { fileHash, sourceFormat });

  let created;
  try {
    created = await createCloudActivity(row);
  } catch (err) {
    if (err.code === "duplicate") {
      const existingAfterRace = await findCloudActivityByHash(fileHash);
      throw new CloudDuplicateActivityError(existingAfterRace);
    }
    throw err;
  }

  try {
    await uploadActivityFile({ activityId: created.id, ext: sourceFormat, content: originalFileContent });
  } catch (err) {
    await deleteCloudActivity(created.id).catch(() => {
      // Best-effort : si le nettoyage échoue aussi, la ligne orpheline reste
      // visible (sans fichier) plutôt que de masquer l'erreur d'upload d'origine.
    });
    throw err;
  }

  return created;
}
