import { useLayoutEffect } from "react";

/**
 * Active le thème « cockpit » (styles/cockpit.css) sur <html> tant que `active` est vrai.
 *
 * Posé sur la racine du document, et non sur un conteneur, parce que MapView (tracés Leaflet) et ProfileChart
 * (canvas) lisent leurs couleurs via `getComputedStyle(document.documentElement)` (voir lib/theme.js) : seuls les
 * tokens de :root atteignent ces dessins. useLayoutEffect garantit que le thème est en place avant que les enfants
 * ne dessinent. Le thème précédent est restauré au démontage.
 */
export function useCockpitTheme(active) {
  useLayoutEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "cockpit");
    return () => {
      if (previous == null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, [active]);
}
