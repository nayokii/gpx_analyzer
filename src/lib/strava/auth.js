/**
 * OAuth 2.0 Strava — construction de l'URL d'autorisation, lecture du
 * callback, échange/rafraîchissement/révocation de jetons.
 *
 * Le `client_secret` n'apparaît JAMAIS dans ce fichier ni ailleurs dans
 * src/ : l'échange, le rafraîchissement et la révocation passent tous par de
 * petites fonctions serveur (voir netlify/functions/strava-*.js) qui seules
 * connaissent le secret via une variable d'environnement côté serveur
 * (`STRAVA_CLIENT_SECRET`, jamais préfixée `VITE_`, donc jamais embarquée
 * dans le bundle — voir docs/STRAVA_INTEGRATION.md).
 *
 * Référence : https://developers.strava.com/docs/authentication/
 */

import {
  StravaAuthDeniedError,
  StravaInvalidCallbackError,
  StravaScopeError,
  StravaRefreshError,
} from "./errors.js";

export const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";

/** Scope minimal requis pour cette intégration (lecture seule, voir consigne
 * §"scopes" : jamais activity:write ni profile:write dans cette phase). */
export const REQUESTED_SCOPE = "activity:read";

/** Endpoints par défaut des fonctions serveur (Netlify Functions, voir
 * netlify/functions/) chargées de tout échange impliquant le client_secret. */
export const DEFAULT_ENDPOINTS = {
  exchange: "/.netlify/functions/strava-exchange",
  refresh: "/.netlify/functions/strava-refresh",
  revoke: "/.netlify/functions/strava-revoke",
};

/**
 * Construit l'URL d'autorisation Strava vers laquelle rediriger le
 * navigateur (redirection pleine page — window.location.href — pas un
 * popup : voir DataSourcesView.jsx).
 *
 * @param {Object} params
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string} [params.scope]
 * @param {string} [params.state] - opaque, revalidé au retour du callback (protection CSRF)
 * @param {'auto'|'force'} [params.approvalPrompt]
 * @returns {string}
 */
export function buildAuthorizeUrl({ clientId, redirectUri, scope = REQUESTED_SCOPE, state, approvalPrompt = "auto" }) {
  if (!clientId) throw new Error("clientId manquant : configure VITE_STRAVA_CLIENT_ID (voir .env.example).");
  if (!redirectUri) throw new Error("redirectUri manquant : configure VITE_STRAVA_REDIRECT_URI (voir .env.example).");

  const url = new URL(STRAVA_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("approval_prompt", approvalPrompt);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Génère une valeur opaque pour le paramètre `state` (protection CSRF de
 * base) — jamais destinée à contenir de donnée sensible.
 * @returns {string}
 */
export function generateOAuthState() {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  if (bytes.every((b) => b === 0)) {
    // Environnement sans crypto.getRandomValues (ex. certains contextes de test) :
    // repli non cryptographique, acceptable ici car le state ne protège que
    // contre un callback confus, pas contre une attaque nécessitant un secret.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Lit les paramètres d'un callback OAuth Strava (query string de retour) et
 * lève une erreur typée explicite en cas de refus/anomalie, plutôt que de
 * laisser l'appelant deviner. Ne lève PAS si tout est correct : retourne
 * simplement `{code, state}`.
 *
 * @param {URLSearchParams|Object} params - query string du retour Strava (ex. `?state=...&code=...&scope=...` ou `?error=access_denied`)
 * @param {string|null} [expectedState] - state envoyé lors de buildAuthorizeUrl, pour comparaison
 * @returns {{code: string, state: string|null, grantedScope: string|null}}
 * @throws {StravaAuthDeniedError} si l'utilisateur a refusé l'autorisation (`error=access_denied`)
 * @throws {StravaInvalidCallbackError} si le callback est incohérent (state ne correspond pas, code absent)
 */
export function parseAuthCallback(params, expectedState = null) {
  const get = (key) => (params instanceof URLSearchParams ? params.get(key) : params?.[key] ?? null);

  const error = get("error");
  if (error) throw new StravaAuthDeniedError(error);

  const code = get("code");
  if (!code) throw new StravaInvalidCallbackError("Paramètre 'code' absent du callback.");

  const state = get("state");
  if (expectedState != null && state !== expectedState) {
    throw new StravaInvalidCallbackError("Le paramètre 'state' du callback ne correspond pas à celui envoyé (risque de callback falsifié ou de session expirée).");
  }

  const grantedScope = get("scope");
  return { code, state, grantedScope };
}

/**
 * Vérifie que le scope réellement accordé (renvoyé par Strava, jamais
 * supposé identique au scope demandé — voir consigne) couvre bien la lecture
 * des activités.
 * @param {string|null} grantedScope - scope espace/virgule-séparé renvoyé par Strava
 * @throws {StravaScopeError}
 */
export function assertHasActivityReadScope(grantedScope) {
  const granted = (grantedScope || "").split(/[,\s]+/).filter(Boolean);
  const ok = granted.includes("activity:read") || granted.includes("activity:read_all");
  if (!ok) throw new StravaScopeError(grantedScope);
}

async function postJson(url, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const message = (payload && payload.error) || `Échec de la requête (HTTP ${res.status}).`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return payload;
}

/**
 * Échange un code d'autorisation contre des jetons, via la fonction serveur
 * dédiée (voir netlify/functions/strava-exchange.js) — c'est cette fonction,
 * et elle seule, qui détient le client_secret nécessaire à cet appel.
 *
 * @param {Object} params
 * @param {string} params.code
 * @param {string} [params.endpoint]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresAt: number, scope: string, athlete: {id: number|string, firstname: string|null, lastname: string|null}}>}
 */
export async function exchangeCodeForTokens({ code, endpoint = DEFAULT_ENDPOINTS.exchange, fetchImpl = fetch }) {
  const payload = await postJson(endpoint, { code }, fetchImpl);
  return normalizeTokenPayload(payload);
}

/**
 * Rafraîchit un access_token expiré (ou proche de l'expiration) via
 * refresh_token, en passant par la fonction serveur dédiée. Ne suppose
 * jamais que le refresh_token reste identique (Strava peut le faire
 * tourner) : le nouveau refresh_token renvoyé doit toujours remplacer
 * l'ancien dans l'état persisté (voir storage.js).
 *
 * @param {Object} params
 * @param {string} params.refreshToken
 * @param {string} [params.endpoint]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresAt: number}>}
 */
export async function refreshAccessToken({ refreshToken, endpoint = DEFAULT_ENDPOINTS.refresh, fetchImpl = fetch }) {
  try {
    const payload = await postJson(endpoint, { refreshToken }, fetchImpl);
    return normalizeTokenPayload(payload);
  } catch (err) {
    throw new StravaRefreshError(err.message);
  }
}

/**
 * Révoque la connexion côté Strava (voir consigne : gérer proprement la
 * déconnexion) via la fonction serveur dédiée (Basic Auth client_id:client_secret,
 * jamais exposée au frontend).
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {string} [params.endpoint]
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<void>}
 */
export async function revokeConnection({ accessToken, endpoint = DEFAULT_ENDPOINTS.revoke, fetchImpl = fetch }) {
  await postJson(endpoint, { accessToken }, fetchImpl);
}

function normalizeTokenPayload(payload) {
  if (!payload || !payload.accessToken || !payload.refreshToken || !payload.expiresAt) {
    throw new Error("Réponse de jeton Strava incomplète.");
  }
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: payload.expiresAt,
    scope: payload.scope || null,
    athlete: payload.athlete || null,
  };
}

/**
 * @param {import('./types.js').StravaTokens|null} tokens
 * @param {number} [marginSeconds] - marge de sécurité avant l'expiration réelle
 * @returns {boolean}
 */
export function isTokenExpired(tokens, marginSeconds = 300) {
  if (!tokens || !tokens.expiresAt) return true;
  const nowSec = Date.now() / 1000;
  return nowSec >= tokens.expiresAt - marginSeconds;
}

/**
 * Retourne un access_token valide, en le rafraîchissant d'abord si besoin.
 * Ne modifie pas l'état persisté elle-même : à l'appelant (sync.js) de
 * persister le résultat via storage.js après un rafraîchissement.
 *
 * @param {import('./types.js').StravaTokens} tokens
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{tokens: import('./types.js').StravaTokens, refreshed: boolean}>}
 */
export async function ensureFreshTokens(tokens, options = {}) {
  if (!isTokenExpired(tokens)) return { tokens, refreshed: false };
  const refreshed = await refreshAccessToken({ refreshToken: tokens.refreshToken, ...options });
  return {
    tokens: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope || tokens.scope,
    },
    refreshed: true,
  };
}
