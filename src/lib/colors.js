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

/**
 * Échelles de couleur analytiques (mode carte : vitesse / pente / FC / altitude).
 *
 * Contrainte de conception : ces teintes ne doivent jamais recouper le
 * vocabulaire chromatique des fonds de carte (vert forêt, bleu eau/rivière),
 * sous peine de rendre le tracé illisible à l'endroit précis où il traverse
 * une zone boisée ou longe un cours d'eau. Le violet/indigo est utilisé comme
 * extrémité "froide" à la place du bleu classique — il ne correspond à aucune
 * texture de carte usuelle — en conservant la même logique de dégradé
 * froid → chaud (faible → élevé). HR_SCALE ne présente pas ce risque et n'a
 * pas été modifiée.
 */
export const SPEED_SCALE = ["#4a3a8f", "#4dd9c0", "#c8e86a", "#f4b740", "#e8543a"];
export const GRADE_SCALE = ["#4a3a8f", "#4dd9c0", "#8b948e", "#f4b740", "#e8543a"];
export const HR_SCALE = ["#4dd9c0", "#c8e86a", "#f4b740", "#e8543a", "#c22b1c"];
export const ELE_SCALE = ["#1c1a2e", "#4a3a8f", "#9b5fc0", "#f4b740", "#c96b3a"];

/**
 * Tokens dédiés à la lisibilité des tracés/marqueurs sur fond de carte
 * (tuiles OpenStreetMap, non maîtrisées). Le halo est volontairement quasi
 * opaque : son rôle est d'agir comme une "plaque" de séparation nette entre
 * le tracé et le fond (à la manière du "casing" des traits GPS sur
 * Strava/Komoot), pas comme un simple filtre translucide — un halo
 * translucide laisse transparaître un fond chargé (labels, routes, forêts)
 * et ne suffit pas à garantir le contraste à lui seul. Tout futur marqueur ou
 * tracé (FC, puissance, cadence, comparaison...) doit réutiliser ces mêmes
 * tokens pour rester visuellement cohérent.
 */
export const MAP_HALO_COLOR = COLORS.bg;
export const MAP_HALO_OPACITY = 0.92;
export const MAP_MARKER_RING_COLOR = "#ffffff";

/**
 * Filtre CSS appliqué uniquement au calque de tuiles Leaflet (jamais au
 * tracé ni aux marqueurs, qui vivent dans d'autres calques) pour que le fond
 * de carte reste identifiable pour se repérer sans jamais concurrencer
 * visuellement le tracé et les données analytiques posées par-dessus.
 */
export const MAP_TILE_FILTER = "saturate(0.5) brightness(1.06) contrast(0.95)";

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
