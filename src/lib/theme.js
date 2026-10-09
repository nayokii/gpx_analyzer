/**
 * Thème (clair / sombre) côté JavaScript.
 *
 * Les couleurs vivent dans styles/tokens.css. Ce module ne sert que là où une couleur CONCRÈTE est
 * indispensable (canvas du profil, tracés Leaflet) et pour redessiner quand le thème système change.
 */
import { useEffect, useState } from "react";

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

/** @returns {"light"|"dark"} thème système courant, mis à jour si l'utilisateur en change. */
export function useColorScheme() {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [scheme, setScheme] = useState(query && query.matches ? "dark" : "light");
  useEffect(() => {
    if (!query) return undefined;
    const onChange = (e) => setScheme(e.matches ? "dark" : "light");
    if (query.addEventListener) query.addEventListener("change", onChange);
    else if (query.addListener) query.addListener(onChange);
    return () => {
      if (query.removeEventListener) query.removeEventListener("change", onChange);
      else if (query.removeListener) query.removeListener(onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return scheme;
}
