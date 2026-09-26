/**
 * Initialisation du client Supabase public (SDK officiel, voir
 * package.json: @supabase/supabase-js). Un seul client est créé, mémorisé
 * (singleton paresseux) et réutilisé par tous les autres modules de
 * src/lib/cloud/ — jamais un `createClient()` répété ailleurs dans le projet.
 *
 * Sécurité : `VITE_SUPABASE_ANON_KEY` est, par conception Supabase, une clé
 * PUBLIQUE (elle finit de toute façon dans le bundle navigateur comme tout ce
 * qui est préfixé VITE_) — elle ne donne accès à rien par elle-même. C'est la
 * Row Level Security côté base (voir supabase/schema.sql) qui décide ce que
 * chaque utilisateur authentifié peut lire/écrire. Aucun secret serveur
 * n'existe dans ce module ni ailleurs sous src/ (contrairement à Strava, qui
 * a besoin de netlify/functions/ pour cacher client_secret).
 */

import { createClient } from "@supabase/supabase-js";
import { CloudNotConfiguredError } from "./errors.js";

let cachedClient = null;
let cachedConfigKey = null;

function readConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  return { url, anonKey };
}

/** @returns {boolean} true si VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont renseignées. */
export function isCloudConfigured() {
  const { url, anonKey } = readConfig();
  return Boolean(url && anonKey);
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 * @throws {CloudNotConfiguredError} si la configuration est absente
 */
export function getSupabaseClient() {
  // Un client de test injecté (voir __setSupabaseClientForTests) prend
  // toujours le dessus, même si VITE_SUPABASE_URL/ANON_KEY ne sont pas
  // renseignées dans l'environnement de test.
  if (cachedClient && cachedConfigKey === "__test__") return cachedClient;

  const { url, anonKey } = readConfig();
  if (!url || !anonKey) throw new CloudNotConfiguredError();

  const configKey = `${url}|${anonKey}`;
  if (cachedClient && cachedConfigKey === configKey) return cachedClient;

  cachedClient = createClient(url, anonKey, {
    auth: {
      // Persistance de session gérée par le SDK (localStorage) : voir
      // consigne §9, aucun mécanisme maison de session n'est nécessaire ici.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  cachedConfigKey = configKey;
  return cachedClient;
}

/** Réservé aux tests : injecte un client simulé plutôt que d'en créer un réel. */
export function __setSupabaseClientForTests(client) {
  cachedClient = client;
  cachedConfigKey = client ? "__test__" : null;
}
