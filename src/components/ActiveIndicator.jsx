/**
 * Indicateur d'état actif partagé (présentation uniquement).
 *
 * Règle visuelle unique de Cycling OS : ACTIF = accent sémantique + marque glissante (capsule dans la navigation, filet sous les onglets).
 * Le conteneur doit être `position: relative` ; l'indicateur se place sur l'élément
 * enfant marqué `.active` (ou `aria-current`) et glisse de l'un à l'autre quand la
 * sélection change (transition utilitaire, désactivée par prefers-reduced-motion
 * via les tokens de durée).
 *
 * Usage :
 *   const { ref, style, ready } = useActiveIndicator(activeKey);
 *   <nav ref={ref} className="gpx-has-indicator">…<ActiveIndicator style={style} ready={ready} /></nav>
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

// useLayoutEffect évite un flash de l'indicateur à la mauvaise place ; repli sur useEffect hors navigateur.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * @param {string|number|null} activeKey - toute valeur qui change quand la sélection change
 * @param {string} [selector] - sélecteur de l'élément actif dans le conteneur
 */
export function useActiveIndicator(activeKey, selector = ".active, [aria-current='page']") {
  // Ref de rappel : le conteneur peut monter APRÈS ce hook (ex. onglets d'une vue affichée plus tard). Le
  // stocker en état relance la mesure à son montage, sans effet « à chaque rendu ».
  const [root, setRoot] = useState(null);
  const [box, setBox] = useState({ x: 0, w: 0, visible: false });
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const el = root && root.querySelector(selector);
    // Conteneur masqué (display: none) ou aucun élément actif : pas d'indicateur.
    if (!el || el.offsetWidth === 0) {
      setBox((b) => (b.visible ? { x: 0, w: 0, visible: false } : b));
      return;
    }
    const x = el.offsetLeft;
    const w = el.offsetWidth;
    setBox((b) => (b.x === x && b.w === w && b.visible ? b : { x, w, visible: true }));
  }, [root, selector]);

  useIsoLayoutEffect(() => {
    measure();
    // Barre défilante (onglets sur mobile) : l'élément actif doit rester visible.
    const el = root && root.querySelector(selector);
    if (el && root.scrollWidth > root.clientWidth) {
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (left < root.scrollLeft) root.scrollLeft = Math.max(0, left - 8);
      else if (right > root.scrollLeft + root.clientWidth) root.scrollLeft = right - root.clientWidth + 8;
    }
  }, [activeKey, measure, root, selector]);

  // Le premier placement ne doit pas "glisser" depuis 0 : la transition n'est activée qu'après.
  useEffect(() => {
    if (!box.visible || ready) return undefined;
    const id = typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => setReady(true)) : null;
    if (id == null) {
      setReady(true);
      return undefined;
    }
    return () => cancelAnimationFrame(id);
  }, [box.visible, ready]);

  // Les largeurs changent avec le viewport (labels masqués, nav basse, rotation, polices) : on re-mesure.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", measure);
    let observer = null;
    if (root && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure());
      observer.observe(root);
      Array.from(root.children).forEach((child) => observer.observe(child));
    }
    return () => {
      window.removeEventListener("resize", measure);
      if (observer) observer.disconnect();
    };
  }, [measure, root, activeKey]);

  const style = { transform: `translateX(${box.x}px)`, width: box.w + "px", opacity: box.visible ? 1 : 0 };
  return { ref: setRoot, style, ready };
}

export function ActiveIndicator({ style, ready }) {
  return <span className={"gpx-active-indicator" + (ready ? " is-ready" : "")} style={style} aria-hidden="true" />;
}
