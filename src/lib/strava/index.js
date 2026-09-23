/**
 * Point d'entrée public du module Strava (voir README/consigne : l'UI et
 * GPXAnalyzer.jsx ne doivent importer que depuis ici, jamais directement
 * auth.js/api.js/adapter.js/sync.js/storage.js — pour garder la liberté de
 * réorganiser l'intérieur du module sans casser ses appelants).
 */

export {
  buildAuthorizeUrl,
  generateOAuthState,
  parseAuthCallback,
  assertHasActivityReadScope,
  exchangeCodeForTokens,
  revokeConnection,
  isTokenExpired,
  REQUESTED_SCOPE,
} from "./auth.js";

export { syncStrava, isProbableDuplicate } from "./sync.js";

export { loadStravaState, saveStravaState, clearStravaState } from "./storage.js";

export { createEmptyStravaState } from "./types.js";

export * from "./errors.js";
