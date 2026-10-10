/**
 * Authentification cloud — email + mot de passe via Supabase Auth (voir
 * consigne §8 : pas de système maison de mots de passe, pas de multiplication
 * de providers OAuth pour cette phase).
 *
 * Abstraction volontairement minimale (consigne §9) : getCurrentUser/
 * onAuthStateChange/signUp/signIn/signOut, jamais d'appel direct à
 * `supabase.auth.*` en dehors de ce fichier — l'UI (CloudAccountPanel.jsx)
 * n'importe que ces fonctions via ./index.js.
 *
 * Récupération de mot de passe : `requestPasswordReset()` envoie l'e-mail (lien
 * de retour = origine de l'app, voir `getRecoveryRedirectUrl()` — à autoriser
 * dans Supabase → Authentication → URL Configuration). Le client est créé avec
 * `detectSessionInUrl: false` (voir client.js) : le SDK ne lit donc PAS seul le
 * fragment `#access_token=…&type=recovery` du lien ; `beginPasswordRecovery()`
 * le fait explicitement, établit la session de récupération, puis
 * `updatePassword()` enregistre le nouveau mot de passe (`auth.updateUser`).
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

/* ------------------------------------------------------------------ */
/* Récupération de mot de passe                                        */
/* ------------------------------------------------------------------ */

const MIN_PASSWORD_LENGTH = 6; // même minimum que le formulaire de création de compte (voir CloudAccountPanel.jsx)

/** URL vers laquelle Supabase renvoie après le clic sur le lien du mail (origine de l'app + "/"). */
export function getRecoveryRedirectUrl() {
  return `${window.location.origin}/`;
}

/**
 * Envoie l'e-mail de réinitialisation. Supabase ne révèle pas si l'adresse existe : un succès signifie
 * seulement « demande acceptée », jamais « ce compte existe ».
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function requestPasswordReset(email) {
  const address = (email || "").trim();
  if (!address) throw new CloudAuthError("Renseigne l'adresse e-mail du compte.");
  const client = getSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(address, { redirectTo: getRecoveryRedirectUrl() });
  if (error) throw new CloudAuthError(friendlyAuthMessage(error));
}

/**
 * Analyse le fragment d'URL d'un lien de récupération (fonction pure).
 * @param {string} hash - `window.location.hash`
 * @returns {{status: "none"} | {status: "recovery", accessToken: string, refreshToken: string} | {status: "error", message: string}}
 */
export function parseRecoveryHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  if (!raw) return { status: "none" };
  const params = new URLSearchParams(raw);
  if (params.get("error_code") || (params.get("error") && params.get("error_description"))) {
    const expired = params.get("error_code") === "otp_expired";
    return {
      status: "error",
      message: expired
        ? "Ce lien a expiré ou a déjà été utilisé. Redemande un e-mail de réinitialisation."
        : "Ce lien de récupération n'est pas valide. Redemande un e-mail de réinitialisation.",
    };
  }
  if (params.get("type") === "recovery" && params.get("access_token") && params.get("refresh_token")) {
    return { status: "recovery", accessToken: params.get("access_token"), refreshToken: params.get("refresh_token") };
  }
  return { status: "none" };
}

/**
 * Retire le fragment (jetons) de la barre d'adresse, sans recharger la page ni toucher au chemin/à la query
 * (la query sert au retour OAuth Strava).
 */
export function clearAuthHash() {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * Si l'URL courante est un lien de récupération valide, établit la session de récupération.
 * @param {string} hash - `window.location.hash`
 * @returns {Promise<{status: "none"} | {status: "ready", email: string|null} | {status: "error", message: string}>}
 */
export async function beginPasswordRecovery(hash) {
  const parsed = parseRecoveryHash(hash);
  if (parsed.status !== "recovery") return parsed;
  const client = getSupabaseClient();
  const { data, error } = await client.auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken });
  if (error || !data || !data.session) {
    return { status: "error", message: "Ce lien a expiré ou n'est plus valide. Redemande un e-mail de réinitialisation." };
  }
  return { status: "ready", email: data.session.user ? data.session.user.email : null };
}

/**
 * Enregistre le nouveau mot de passe de la session de récupération (ou de la session courante).
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export async function updatePassword(newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new CloudAuthError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  const client = getSupabaseClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw new CloudAuthError(friendlyAuthMessage(error));
}

/**
 * S'abonne à l'événement `PASSWORD_RECOVERY` du SDK (émis quand le SDK traite lui-même un lien de récupération,
 * par exemple si `detectSessionInUrl` est activé un jour). Complète `beginPasswordRecovery()`.
 * @param {(user: import('@supabase/supabase-js').User|null) => void} callback
 * @returns {() => void}
 */
export function onPasswordRecovery(callback) {
  const client = getSupabaseClient();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") callback(session?.user || null);
  });
  return () => data.subscription.unsubscribe();
}

/** Messages Supabase courants → français ; sinon le message d'origine. */
function friendlyAuthMessage(error) {
  const code = error.code || "";
  const msg = error.message || "";
  if (code === "same_password" || /different from the old password/i.test(msg)) return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (code === "weak_password" || /password should be at least|weak/i.test(msg)) return "Ce mot de passe est trop faible. Choisis-en un plus long ou plus varié.";
  if (code === "over_email_send_rate_limit" || /rate limit|security purposes/i.test(msg)) return "Trop de demandes. Patiente une minute avant de redemander un e-mail.";
  if (/session.*missing|not authenticated|jwt/i.test(msg)) return "La session de récupération a expiré. Redemande un e-mail de réinitialisation.";
  return msg || "Une erreur est survenue.";
}
