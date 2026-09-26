/**
 * Upload/download du fichier original (FIT/GPX) dans Supabase Storage — voir
 * supabase/schema.sql section 3 pour le bucket et ses policies (chemin
 * `<user_id>/<activity_id>.<ext>`, un utilisateur ne peut jamais lire/écrire
 * en dehors de son propre préfixe).
 *
 * Ce module ne connaît rien du modèle Activity ni des métadonnées : il ne
 * fait que transporter des octets, exactement comme
 * ../storage/activityStore.js (writeBinaryFile/writeTextFile) côté local.
 */

import { getSupabaseClient } from "./client.js";
import { ACTIVITY_FILES_BUCKET, activityFilePath } from "./types.js";
import { CloudStorageError, CloudNotAuthenticatedError } from "./errors.js";
import { getCurrentUser } from "./auth.js";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new CloudNotAuthenticatedError();
  return user;
}

function contentTypeFor(ext) {
  return ext === "fit" ? "application/octet-stream" : "application/gpx+xml";
}

/**
 * @param {Object} params
 * @param {string} params.activityId
 * @param {'gpx'|'fit'} params.ext
 * @param {string|ArrayBuffer} params.content - texte pour un GPX, ArrayBuffer pour un FIT (jamais l'inverse, même convention que ../storage/activityStore.js)
 * @returns {Promise<string>} le chemin Storage où le fichier a été écrit
 */
export async function uploadActivityFile({ activityId, ext, content }) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const path = activityFilePath(user.id, activityId, ext);
  const { error } = await client.storage.from(ACTIVITY_FILES_BUCKET).upload(path, content, {
    contentType: contentTypeFor(ext),
    upsert: false, // un fichier d'activité n'est jamais réécrit en place — voir schema.sql (pas de policy UPDATE)
  });
  if (error) throw new CloudStorageError(error.message);
  return path;
}

/**
 * @param {Object} params
 * @param {string} params.activityId
 * @param {'gpx'|'fit'} params.ext
 * @returns {Promise<string|ArrayBuffer>} texte pour un GPX, ArrayBuffer pour un FIT
 */
export async function downloadActivityFile({ activityId, ext }) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const path = activityFilePath(user.id, activityId, ext);
  const { data, error } = await client.storage.from(ACTIVITY_FILES_BUCKET).download(path);
  if (error) throw new CloudStorageError(error.message);
  return ext === "fit" ? data.arrayBuffer() : data.text();
}

/**
 * @param {Object} params
 * @param {string} params.activityId
 * @param {'gpx'|'fit'} params.ext
 */
export async function deleteActivityFile({ activityId, ext }) {
  const user = await requireUser();
  const client = getSupabaseClient();
  const path = activityFilePath(user.id, activityId, ext);
  const { error } = await client.storage.from(ACTIVITY_FILES_BUCKET).remove([path]);
  if (error) throw new CloudStorageError(error.message);
}
