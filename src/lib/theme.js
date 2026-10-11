/**
 * Thème de l'application : préférence (system | light | dark), thème effectivement appliqué (light | dark) et lecture
 * des couleurs concrètes pour les dessins qui ne lisent pas le CSS (canvas du profil, tracés Leaflet).
 *
 * Architecture : UN SEUL store au niveau du module, la source de vérité côté JavaScript.
 *  - il lit la préférence enregistrée (clé unique dans localStorage, valeurs invalides → "system") ;
 *  - il résout le thème effectif (en "system" : prefers-color-scheme, suivi en direct) ;
 *  - il applique le résultat sur <html> : attribut data-theme="light|dark" et propriété color-scheme ;
 *  - il notifie React via useSyncExternalStore (useTheme), donc aucun état parallèle à synchroniser.
 * Le script précoce d'index.html applique la même règle avant le premier rendu (pas de flash) ; ce store reprend ensuite la main.
 * Les tokens CSS (styles/tokens.css) réagissent à l'attribut ; MapView et ProfileChart se redessinent via `useColorScheme()`,
 * qui renvoie le thème effectif.
 *
 * localStorage peut être inaccessible (navigation privée, stockage bloqué) : toute lecture/écriture est protégée et
 * l'application continue avec le thème système (la préférence vit alors seulement en mémoire pour la session).
 */
import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "cycling-os-theme";
export const THEME_PREFERENCES = ["system", "light", "dark"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** @returns {"system"|"light"|"dark"} la valeur si valide, sinon "system" */
export function normalizePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

function systemQuery() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

/** @returns {"light"|"dark"} */
export function resolveTheme(preference, systemIsDark) {
  if (preference === "light" || preference === "dark") return preference;
  return systemIsDark ? "dark" : "light";
}

export function readStoredPreference() {
  try {
    return normalizePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function writeStoredPreference(preference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* stockage inaccessible : la préférence reste valable pour la session en cours */
  }
}

function applyToDocument(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}

// ---- store ---------------------------------------------------------------------------------------------------------

let state = null; // { preference, theme }
let detach = null;
const listeners = new Set();

function computeState(preference) {
  const query = systemQuery();
  return { preference, theme: resolveTheme(preference, !!(query && query.matches)) };
}

function commit(next) {
  const changed = !state || state.preference !== next.preference || state.theme !== next.theme;
  if (changed) state = next;
  applyToDocument(state.theme);
  if (changed) listeners.forEach((l) => l());
}

function init() {
  if (state) return;
  state = computeState(readStoredPreference());
  applyToDocument(state.theme);

  const query = systemQuery();
  const onSystemChange = () => {
    // Un choix manuel n'est JAMAIS remplacé par le thème du système : seul le mode "system" suit ses changements.
    if (state.preference === "system") commit(computeState("system"));
  };
  const onStorage = (event) => {
    // Autre onglet : on s'aligne sur sa préférence (clé absente = retour à "system").
    if (event.key === THEME_STORAGE_KEY || event.key === null) commit(computeState(readStoredPreference()));
  };
  if (query) {
    if (query.addEventListener) query.addEventListener("change", onSystemChange);
    else if (query.addListener) query.addListener(onSystemChange);
  }
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  detach = () => {
    if (query) {
      if (query.removeEventListener) query.removeEventListener("change", onSystemChange);
      else if (query.removeListener) query.removeListener(onSystemChange);
    }
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function subscribe(listener) {
  init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  init();
  return state;
}

/** Change la préférence : valide, enregistre, applique et notifie. Une valeur invalide revient à "system". */
export function setThemePreference(preference) {
  init();
  const next = normalizePreference(preference);
  writeStoredPreference(next);
  commit(computeState(next));
}

/** Instantané courant { preference, theme } (initialise le store si besoin). */
export function getThemeState() {
  return getSnapshot();
}

/** Remet le store à zéro (tests uniquement). */
export function __resetThemeForTests() {
  if (detach) detach();
  detach = null;
  state = null;
  listeners.clear();
}

/**
 * @returns {{preference: "system"|"light"|"dark", theme: "light"|"dark", setPreference: (p: string) => void}}
 */
export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { preference: snapshot.preference, theme: snapshot.theme, setPreference: setThemePreference };
}

/** @returns {"light"|"dark"} thème effectif ; sert de dépendance de redessin aux canvas et à Leaflet. */
export function useColorScheme() {
  return useTheme().theme;
}

// ---- couleurs concrètes --------------------------------------------------------------------------------------------

/** @returns {string} valeur calculée d'une variable CSS de :root (ex. "--speed"), ou `fallback`. */
export function cssVar(name, fallback = "") {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Résout `var(--x)` en sa valeur concrète ; toute autre valeur est renvoyée telle quelle. */
export function resolveColor(value, fallback = "#888") {
  const m = /^var\((--[\w-]+)\)$/.exec(value || "");
  return m ? cssVar(m[1], fallback) : value;
}
