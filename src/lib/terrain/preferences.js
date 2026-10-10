/**
 * Préférences locales de l'analyse du terrain (localStorage, jamais envoyées nulle part) :
 *  - consentement aux requêtes cartographiques externes (révocable) ;
 *  - correction manuelle du TYPE de terrain d'une sortie (n'altère ni le tracé ni la difficulté estimée).
 * Tout accès est protégé : un stockage indisponible ne doit jamais empêcher l'affichage.
 */

const CONSENT_KEY = "gpx-terrain-osm-consent";
const COOLDOWN_KEY = "gpx-terrain-overpass-cooldown-until";
const OVERRIDE_PREFIX = "gpx-terrain-override:";
export const OVERRIDABLE_TYPES = ["road", "mtb_tracks", "mtb_trails", "mixed"];

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* best-effort */ }
}

/** @returns {boolean} true si l'utilisateur a autorisé les requêtes vers le service cartographique. */
export function hasOsmConsent() {
  return read(CONSENT_KEY) === "granted";
}
export function setOsmConsent(granted) {
  write(CONSENT_KEY, granted ? "granted" : null);
}

/** @returns {string|null} type choisi manuellement pour cette sortie, ou null (automatique). */
export function getTypeOverride(activityKey) {
  const v = read(OVERRIDE_PREFIX + activityKey);
  return OVERRIDABLE_TYPES.includes(v) ? v : null;
}
export function setTypeOverride(activityKey, type) {
  write(OVERRIDE_PREFIX + activityKey, OVERRIDABLE_TYPES.includes(type) ? type : null);
}

/**
 * Délai d'attente avant la prochaine requête cartographique (horodatage ms), conservé à travers les changements d'onglet
 * et les rechargements de page : fermer et rouvrir l'onglet ne permet pas de contourner l'attente imposée après un
 * 429 ou une panne du service. 0 = aucune attente.
 */
export function getCooldownUntil() {
  const v = Number(read(COOLDOWN_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}
export function setCooldownUntil(timestampMs) {
  write(COOLDOWN_KEY, timestampMs > 0 ? String(Math.round(timestampMs)) : null);
}
