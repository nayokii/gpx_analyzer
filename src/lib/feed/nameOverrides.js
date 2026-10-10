/**
 * Noms personnalisés des sorties pour le fil d'activités.
 *
 * Le fichier original ET le JSON normalisé d'une sortie ne sont jamais
 * modifiés : renommer n'écrit qu'une correspondance `id → nom` dans le
 * stockage du navigateur. Ce n'est PAS un second stockage d'activités (aucune
 * donnée de sortie n'y figure) mais une simple surcharge d'affichage.
 */
const KEY = "cyclingos.feed.names.v1";
export const MAX_NAME_LENGTH = 80;

export function loadNameOverrides() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Nettoie un nom saisi : espaces normalisés, longueur bornée. Retourne "" si vide. */
export function sanitizeName(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Enregistre (ou, pour un nom vide, retire) la surcharge d'une sortie.
 * @returns {Object} la nouvelle table complète (même si l'écriture échoue)
 */
export function saveNameOverride(overrides, id, rawName) {
  const next = { ...overrides };
  const name = sanitizeName(rawName);
  if (name) next[id] = name;
  else delete next[id];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // stockage indisponible (navigation privée…) : le nom reste valable pour la session
  }
  return next;
}
