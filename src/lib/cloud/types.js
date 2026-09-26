/**
 * Modèle de données cloud + petits utilitaires purs partagés par activities.js
 * et files.js (voir supabase/schema.sql pour le schéma réel côté base).
 *
 * IMPORTANT (voir consigne §18) : ceci N'EST PAS un second modèle Activity
 * complet. Une CloudActivity ne porte que les métadonnées légères nécessaires
 * pour lister/trier des sorties cloud — jamais `samples`, jamais de profil/
 * archétype/progression dérivés. Le fichier original (GPX/FIT), dans
 * Supabase Storage, reste l'unique source de vérité ; tout le reste continue
 * à être recalculé côté client à partir de lui, exactement comme pour une
 * activité locale (voir ../normalize.js, ../analysis.js).
 */

export const ACTIVITY_FILES_BUCKET = "activity-files";

/**
 * @typedef {Object} CloudActivity
 * @property {string} id - uuid Postgres
 * @property {string} userId
 * @property {string|null} localId - id local d'origine, informationnel uniquement (jamais utilisé pour la déduplication)
 * @property {string|null} name - nom de l'activité (voir ../types.js: Activity.name) ; ajouté Phase 11B pour l'affichage dans l'historique unifié
 * @property {'local_upload'} sourceType
 * @property {string|null} sourceFileName
 * @property {'gpx'|'fit'} sourceFormat
 * @property {string} fileHash - SHA-256 hex (64 caractères)
 * @property {string|null} startedAt - ISO 8601
 * @property {number|null} distance
 * @property {number|null} duration
 * @property {number|null} movingTime
 * @property {number|null} elevationGain
 * @property {number|null} elevationLoss
 * @property {number|null} avgSpeed
 * @property {number|null} avgPower
 * @property {number|null} avgCadence
 * @property {Object|null} flags
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Convertit une ligne Postgres (snake_case, telle que renvoyée par
 * PostgREST) en CloudActivity (camelCase, conventions JS du reste du projet).
 * @param {Object} row
 * @returns {CloudActivity}
 */
export function mapRowToCloudActivity(row) {
  return {
    id: row.id,
    userId: row.user_id,
    localId: row.local_id,
    name: row.name,
    sourceType: row.source_type,
    sourceFileName: row.source_file_name,
    sourceFormat: row.source_format,
    fileHash: row.file_hash,
    startedAt: row.started_at,
    distance: row.distance,
    duration: row.duration,
    movingTime: row.moving_time,
    elevationGain: row.elevation_gain,
    elevationLoss: row.elevation_loss,
    avgSpeed: row.avg_speed,
    avgPower: row.avg_power,
    avgCadence: row.avg_cadence,
    flags: row.flags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convertit une Activity locale (voir ../types.js) en ligne prête à insérer
 * dans `public.activities` (voir supabase/schema.sql). `user_id` n'est PAS
 * inclus : la colonne a `default auth.uid()` côté base, qui fait foi (voir
 * schema.sql section 1, consigne §7) — l'inclure ici n'apporterait aucune
 * garantie supplémentaire, seulement une occasion de désynchronisation.
 * @param {import('../types.js').Activity} activity
 * @param {Object} params
 * @param {string} params.fileHash
 * @param {'gpx'|'fit'} params.sourceFormat
 * @returns {Object} ligne snake_case pour `.insert()`
 */
export function activityToRow(activity, { fileHash, sourceFormat }) {
  return {
    local_id: activity.id,
    name: activity.name || null,
    source_type: "local_upload",
    source_file_name: activity.source?.originalFilename || null,
    source_format: sourceFormat,
    file_hash: fileHash,
    started_at: activity.date,
    distance: activity.distance,
    duration: activity.duration,
    moving_time: activity.movingTime,
    elevation_gain: activity.elevationGain,
    elevation_loss: activity.elevationLoss,
    avg_speed: activity.avgSpeed,
    avg_power: activity.avgPower,
    avg_cadence: activity.avgCadence,
    flags: activity.flags,
  };
}

/**
 * Calcule l'empreinte SHA-256 (hex) d'un contenu de fichier brut — seule base
 * de déduplication cloud (voir consigne §17 : jamais une correspondance
 * approximative par date/distance). Fonctionne aussi bien pour un texte GPX
 * (converti en octets) que pour un ArrayBuffer FIT.
 * @param {string|ArrayBuffer} content
 * @returns {Promise<string>} hash hexadécimal (64 caractères)
 */
export async function computeFileHash(content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Chemin Storage d'un fichier d'activité — voir supabase/schema.sql section 3 :
 * le PREMIER segment doit être l'id utilisateur pour que les policies Storage
 * fonctionnent.
 * @param {string} userId
 * @param {string} activityId
 * @param {'gpx'|'fit'} ext
 * @returns {string}
 */
export function activityFilePath(userId, activityId, ext) {
  return `${userId}/${activityId}.${ext}`;
}
