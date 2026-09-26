/**
 * Authentification cloud — email + mot de passe via Supabase Auth (voir
 * consigne §8 : pas de système maison de mots de passe, pas de multiplication
 * de providers OAuth pour cette phase).
 *
 * Abstraction volontairement minimale (consigne §9) : getCurrentUser/
 * onAuthStateChange/signUp/signIn/signOut, jamais d'appel direct à
 * `supabase.auth.*` en dehors de ce fichier — l'UI (CloudAccountPanel.jsx)
 * n'importe que ces fonctions via ./index.js.
 */

import { getSupabaseClient } from "./client.js";
import { CloudAuthError } from "./errors.js";

/**
 * Utilisateur actuellement connecté, d'après la session mémorisée par le SDK
 * (localStorage, gérée automatiquement — voir client.js). Ne fait pas d'appel
 * réseau de vérification à chaque appel : suffisant pour de l'affichage
 * d'état UI, l'autorisation réelle des requêtes est de toute façon toujours
 * revérifiée côté serveur par la Row Level Security (voir supabase/schema.sql).
 * @returns {Promise<import('@supabase/supabase-js').User|null>}
 */
export async function getCurrentUser() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new CloudAuthError(error.message);
  return data.session?.user || null;
}

/**
 * S'abonne aux changements d'état de connexion (connexion, déconnexion,
 * rafraîchissement de jeton...).
 * @param {(user: import('@supabase/supabase-js').User|null) => void} callback
 * @returns {() => void} fonction de désabonnement
 */
export function onAuthStateChange(callback) {
  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Crée un compte. Selon la configuration du projet Supabase, une confirmation
 * par email peut être requise avant que la session soit active (voir
 * docs/CLOUD_ARCHITECTURE.md) — dans ce cas `user` est renvoyé mais
 * `getCurrentUser()` restera `null` tant que l'email n'est pas confirmé.
 * @param {{email: string, password: string}} params
 * @returns {Promise<import('@supabase/supabase-js').User|null>}
 */
export async function signUp({ email, password }) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new CloudAuthError(error.message);
  return data.user;
}

/**
 * @param {{email: string, password: string}} params
 * @returns {Promise<import('@supabase/supabase-js').User>}
 */
export async function signIn({ email, password }) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new CloudAuthError(error.message);
  return data.user;
}

/** @returns {Promise<void>} */
export async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw new CloudAuthError(error.message);
}
