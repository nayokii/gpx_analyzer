/**
 * AnimatedValue — affiche une valeur numérique DÉJÀ FORMATÉE et l'interpole quand elle CHANGE.
 *
 * Règles :
 *  - premier rendu : affichage direct (jamais de count-up depuis 0) ;
 *  - même valeur (rerender sans changement) : rien ne bouge ;
 *  - changement : interpolation de la valeur affichée vers la nouvelle (--dur-base, --ease, ≤ 400 ms),
 *    au format d'origine (virgule, signe, unité, durées 1h09 / 12:45…) ;
 *  - changement pendant une animation : on repart de la valeur actuellement affichée, pas de 0 ;
 *  - structure différente (ex. "—" → "18,6", "59:30" → "1h02") ou prefers-reduced-motion : affichage direct ;
 *  - l'état est local à ce composant : aucun rerender du parent à chaque frame, pas de setInterval.
 *
 * Largeur : la police est monospace + tabular-nums ; pendant l'animation on réserve la longueur
 * maximale (ancienne/nouvelle valeur) en `ch` pour que l'unité voisine ne bouge pas.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDisplay, isCompatible, parseDisplay, prefersReducedMotion, readDurationMs, readEasing } from "./animatedValue.js";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const MIN_ANIMATED_MS = 20;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** @param {string} text - valeur formatée ; @returns {{text:string, reserve:number}} texte à afficher et longueur à réserver */
export function useAnimatedText(text) {
  const [view, setView] = useState({ text, reserve: text.length });
  const targetRef = useRef(text);
  const currentRef = useRef(null); // { parsed, vector } : valeur visuellement affichée (non arrondie)
  const shownRef = useRef(text);
  const rafRef = useRef(null);

  if (currentRef.current === null) {
    const parsed = parseDisplay(text);
    currentRef.current = { parsed, vector: parsed.vector };
  }

  const show = (t, reserve) => {
    shownRef.current = t;
    setView((v) => (v.text === t && v.reserve === reserve ? v : { text: t, reserve }));
  };

  useIsoLayoutEffect(() => {
    if (text === targetRef.current) return undefined; // première passe ou même valeur : rien à animer
    targetRef.current = text;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const to = parseDisplay(text);
    const from = currentRef.current; // depuis la valeur actuellement affichée, même si une animation est en cours
    const duration = readDurationMs();
    const direct = prefersReducedMotion() || duration < MIN_ANIMATED_MS || typeof requestAnimationFrame !== "function" || !isCompatible(from.parsed, to);

    if (direct) {
      currentRef.current = { parsed: to, vector: to.vector };
      show(text, text.length);
      return undefined;
    }

    const ease = readEasing();
    const fromVector = from.vector;
    const reserve = Math.max(shownRef.current.length, text.length);
    const start = now();

    const step = () => {
      const t = Math.min(1, (now() - start) / duration);
      if (t >= 1) {
        currentRef.current = { parsed: to, vector: to.vector };
        rafRef.current = null;
        show(text, text.length); // dernière image = valeur exacte
        return;
      }
      const e = ease(t);
      const vector = fromVector.map((a, i) => a + (to.vector[i] - a) * e);
      currentRef.current = { parsed: to, vector };
      show(formatDisplay(to, vector), reserve);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return undefined;
  }, [text]);

  useEffect(
    () => () => {
      if (rafRef.current != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return view;
}

/**
 * @param {Object} props
 * @param {string|number|any} props.value - valeur déjà formatée ; tout ce qui n'est pas une chaîne/un nombre est rendu tel quel (sans animation)
 */
export function AnimatedValue({ value, className }) {
  const animatable = typeof value === "string" || typeof value === "number";
  const view = useAnimatedText(animatable ? String(value) : "");
  if (!animatable) return value == null ? null : value;
  const text = String(value);
  const style = view.reserve > text.length ? { minWidth: view.reserve + "ch" } : undefined;
  return (
    // aria-live="off" : les images intermédiaires ne sont jamais annoncées, même si un parent devenait une zone live.
    <span className={"gpx-av" + (className ? " " + className : "")} style={style} aria-live="off">
      {view.text}
    </span>
  );
}
