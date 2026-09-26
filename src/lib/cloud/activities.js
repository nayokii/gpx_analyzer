/**
 * CRUD des métadonnées d'activité cloud (table `public.activities`, voir
 * supabase/schema.sql). Ne touche jamais au fichier original (voir files.js)
 * ni à aucune donnée dérivée (voir consigne §18) — uniquement les lignes de
 * métadonnées légères.
 *
 * Sécurité : aucune fonction ici ne filtre explicitement par `user_id` — la
 * Row Level Security (schema.sql) le fait déjà, côté base, à partir du JWT de
 * la session. Un filtre client-side redondant donnerait à tort l'impression
 * que c'est LUI la barrière de sécurité (voir consigne §7 : l'id utilisateur
 * fourni par le frontend n'est jamais une preuve d'autorisation).
 */

import { getSupabaseClient } from "./client.js";
import { mapRowToCloudActivity } from "./types.js";
import { CloudApiError, CloudNotAuthenticatedError } from "./errors.js";
import { getCurrentUser } from "./auth.js";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new CloudNotAuthenticatedError();
  return user;
}

/**
 * Liste les activités cloud de l'utilisateur connecté (métadonnées légères
 * uniquement — voir consigne §25 : jamais le détail complet au login).
 * @returns {Promise<import('./types.js').CloudActivity[]>}
 */
export async function listCloudActivities() {
  await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client.from("activities").select("*").order("started_at", { ascending: false });
  if (error) throw new CloudApiError(error.message, error);
  return data.map(mapRowToCloudActivity);
}

/**
 * @param {string} id
 * @returns {Promise<import('./types.js').CloudActivity|null>} `null` si absent (supprimée, ou appartenant à un autre utilisateur — RLS la rend simplement invisible, jamais une erreur explicite)
 */
export async function getCloudActivity(id) {
  await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client.from("activities").select("*").eq("id", id).maybeSingle();
  if (error) throw new CloudApiError(error.message, error);
  return data ? mapRowToCloudActivity(data) : null;
}

/**
 * Recherche une activité cloud déjà synchronisée par empreinte de fichier
 * (voir consigne §17 : seule base de déduplication).
 * @param {string} fileHash
 * @returns {Promise<import('./types.js').CloudActivity|null>}
 */
export async function findCloudActivityByHash(fileHash) {
  await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client.from("activities").select("*").eq("file_hash", fileHash).maybeSingle();
  if (error) throw new CloudApiError(error.message, error);
  return data ? mapRowToCloudActivity(data) : null;
}

/**
 * Insère une nouvelle ligne d'activité cloud.
 * @param {Object} row - voir ./types.js: activityToRow()
 * @returns {Promise<import('./types.js').CloudActivity>}
 * @throws {CloudApiError} avec `.code === "duplicate"` si la contrainte UNIQUE (user_id, file_hash) est violée
 */
export async function createCloudActivity(row) {
  await requireUser();
  const client = getSupabaseClient();
  const { data, error } = await client.from("activities").insert(row).select().single();
  if (error) {
    const apiError = new CloudApiError(error.message, error);
    if (error.code === "23505") apiError.code = "duplicate"; // violation de contrainte UNIQUE Postgres
    throw apiError;
  }
  return mapRowToCloudActivity(data);
}

/** @param {string} id */
export async function deleteCloudActivity(id) {
  await requireUser();
  const client = getSupabaseClient();
  const { error } = await client.from("activities").delete().eq("id", id);
  if (error) throw new CloudApiError(error.message, error);
}
