/**
 * Design tokens et échelles de couleurs
 *
 * Palette inspirée d'une montée nocturne sur un ordinateur de bord de vélo : près du
 * noir basaltique, avec un fond vert foncé stylisant le relief guadeloupéen et un
 * accent bleu-vert pour la vitesse/motion, un jaune doux pour la montée, un corail
 * chaud pour l'effort (FC/puissance).
 */

export const COLORS = {
  bg: "#0a0d0c",
  bgAlt: "#0e1211",
  surface: "#141917",
  surface2: "#1a201d",
  border: "rgba(237, 239, 236, 0.08)",
  borderStrong: "rgba(237, 239, 236, 0.16)",
  text: "#eef1ee",
  textMuted: "#8b948e",
  textFaint: "#5c645f",
  speed: "#4dd9c0",
  speedDim: "#2a5c53",
  climb: "#f4b740",
  climbDim: "#5c4a20",
  effort: "#e8543a",
  effortDim: "#5c2c22",
  alert: "#ff5470",
  info: "#6f9cf2",
};

export const SPEED_SCALE = ["#2e5eaa", "#4dd9c0", "#c8e86a", "#f4b740", "#e8543a"];
export const GRADE_SCALE = ["#2e5eaa", "#4dd9c0", "#8b948e", "#f4b740", "#e8543a"];
export const HR_SCALE = ["#4dd9c0", "#c8e86a", "#f4b740", "#e8543a", "#c22b1c"];
export const ELE_SCALE = ["#1c2a24", "#2f5c4b", "#7fae5e", "#f4b740", "#c96b3a"];

/**
 * Tokens dédiés à la lisibilité des tracés/marqueurs sur fond de carte
 * (tuiles OpenStreetMap, non maîtrisées). Un halo sombre assorti au thème de
 * l'app détache systématiquement les éléments d'analyse du fond de carte,
 * quelle que soit la couleur du tracé (dégradés vitesse/pente/FC/altitude)
 * ou la zone géographique (routes claires, forêts, eau...). Tout futur
 * marqueur (FC, puissance, cadence...) doit réutiliser ces mêmes tokens pour
 * rester visuellement cohérent avec le tracé et les marqueurs existants.
 */
export const MAP_HALO_COLOR = COLORS.bg;
export const MAP_HALO_OPACITY = 0.6;
export const MAP_MARKER_RING_COLOR = "#ffffff";

/**
 * Interpole linéairement entre deux couleurs hexadécimales
 *
 * @param {string} hexA - Couleur de départ (ex: "#4dd9c0")
 * @param {string} hexB - Couleur d'arrivée
 * @param {number} t - Facteur d'interpolation entre 0 et 1
 * @returns {string} Couleur interpolée au format rgb()
 */
export function lerpColor(hexA, hexB, t) {
  if (hexA == null || hexB == null) return COLORS.textFaint;
  const a = hexA.match(/\w\w/g);
  const b = hexB.match(/\w\w/g);
  if (a == null || b == null) return COLORS.textFaint;
  const ai = a.map((x) => parseInt(x, 16));
  const bi = b.map((x) => parseInt(x, 16));
  const c = ai.map((v, i) => Math.round(v + (bi[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Calcule une couleur le long d'une échelle multi-stops en fonction d'un facteur [0,1]
 *
 * @param {number} t - Position sur l'échelle entre 0 et 1
 * @param {string[]} stops - Liste de couleurs hexadécimales formant l'échelle
 * @returns {string} Couleur calculée au format rgb()
 */
export function scaleColor(t, stops) {
  if (t == null || isNaN(t)) return COLORS.textFaint;
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const seg = t * n;
  const i = Math.min(n - 1, Math.floor(seg));
  const localT = seg - i;
  return lerpColor(stops[i], stops[i + 1], localT);
}
