/**
 * Préférences locales de l'analyse du terrain (localStorage, jamais envoyées nulle part) :
 *  - consentement aux requêtes cartographiques externes (révocable) ;
 *  - correction manuelle du TYPE de terrain d'une sortie (n'altère ni le tracé ni la difficulté estimée).
 * Tout accès est protégé : un stockage indisponible ne doit jamais empêcher l'affichage.
 */

// Consentement aux requêtes cartographiques EXTERNES : IGN (Géoplateforme) ET OpenStreetMap (Overpass). Clé « v2 » : le
// consentement OpenStreetMap seul de l'ancienne version ne vaut pas pour un nouveau destinataire (l'IGN) ; il n'est pas repris.
const CONSENT_KEY = "gpx-terrain-map-consent-v2";
const ENRICHMENT_KEY = "gpx-terrain-osm-enrichment";
const COOLDOWN_KEY = "gpx-terrain-overpass-cooldown-until";
const ENRICHMENT_COOLDOWN_KEY = "gpx-terrain-osm-enrichment-cooldown-until";
const OVERRIDE_PREFIX = "gpx-terrain-override:";
export const OVERRIDABLE_TYPES = ["road", "mtb_tracks", "mtb_trails", "mixed"];

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* best-effort */ }
}

/** @returns {boolean} true si l'utilisateur a autorisé les requêtes vers les services cartographiques (IGN et OpenStreetMap). */
export function hasMapConsent() {
  return read(CONSENT_KEY) === "granted";
}
export function setMapConsent(granted) {
  write(CONSENT_KEY, granted ? "granted" : null);
}

/** Complément facultatif OpenStreetMap (surface, technicité) pour les zones couvertes par l'IGN : « on » (défaut) ou « off ». */
export function getOsmEnrichment() {
  return read(ENRICHMENT_KEY) === "off" ? "off" : "on";
}
export function setOsmEnrichment(mode) {
  write(ENRICHMENT_KEY, mode === "off" ? "off" : null);
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
const cooldownKey = (kind) => (kind === "enrichment" ? ENRICHMENT_COOLDOWN_KEY : COOLDOWN_KEY);
/** @param {"map"|"enrichment"} [kind] - « map » : requêtes principales ; « enrichment » : complément OpenStreetMap seul */
export function getCooldownUntil(kind = "map") {
  const v = Number(read(cooldownKey(kind)));
  return Number.isFinite(v) && v > 0 ? v : 0;
}
export function setCooldownUntil(timestampMs, kind = "map") {
  write(cooldownKey(kind), timestampMs > 0 ? String(Math.round(timestampMs)) : null);
}
