/**
 * Couleurs métier de Cycling OS.
 *
 * Les valeurs de COLORS sont des références `var(--…)` définies dans styles/tokens.css (thème clair par
 * défaut, thème sombre via prefers-color-scheme) : elles se résolvent d'elles-mêmes dans les styles
 * inline et les attributs SVG (Recharts). Les dessins qui exigent une couleur concrète (canvas,
 * Leaflet) passent par `resolveColor` de lib/theme.js.
 *
 * Sémantique : vitesse = turquoise, dénivelé = ambre, effort/FC = corail, puissance/cadence = indigo.
 */

export const COLORS = {
  bg: "var(--bg)",
  bgAlt: "var(--bgAlt)",
  surface: "var(--surface)",
  surface2: "var(--surface2)",
  border: "var(--border)",
  borderStrong: "var(--borderStrong)",
  text: "var(--text)",
  textMuted: "var(--muted)",
  textFaint: "var(--faint)",
  speed: "var(--speed)",
  speedDim: "color-mix(in srgb, var(--speed) 45%, var(--surface))",
  climb: "var(--climb)",
  climbDim: "color-mix(in srgb, var(--climb) 45%, var(--surface))",
  effort: "var(--effort)",
  effortDim: "color-mix(in srgb, var(--effort) 45%, var(--surface))",
  alert: "var(--alert)",
  info: "var(--info)",
};

/**
 * Axes Recharts : sans filet ni graduation, texte discret et lisible (11 px) — réutilisé par tous les petits graphiques.
 */
export const CHART_AXIS = {
  stroke: COLORS.textMuted,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

/**
 * Style d'infobulle Recharts : suit le thème (surface + ombre), sans bordure décorative.
 */
export const CHART_TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "none",
  borderRadius: 14,
  boxShadow: "var(--shadow-pop)",
  fontSize: 13,
  color: "var(--text)",
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
export const SPEED_SCALE = ["#6a5acd", "#4dd9c0", "#c8e86a", "#f4b740", "#e8543a"];
export const GRADE_SCALE = ["#6a5acd", "#4dd9c0", "#8b948e", "#f4b740", "#e8543a"];
export const HR_SCALE = ["#4dd9c0", "#c8e86a", "#f4b740", "#e8543a", "#c22b1c"];
export const ELE_SCALE = ["#4b45a8", "#7a52c4", "#b05fb8", "#f4b740", "#e8734a"];

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
export const MAP_HALO_COLOR = "var(--map-halo)";
export const MAP_HALO_OPACITY = 0.92;
export const MAP_MARKER_RING_COLOR = "#ffffff";

/**
 * Filtre CSS appliqué uniquement au calque de tuiles Leaflet (jamais au
 * tracé ni aux marqueurs, qui vivent dans d'autres calques) pour que le fond
 * de carte reste identifiable pour se repérer sans jamais concurrencer
 * visuellement le tracé et les données analytiques posées par-dessus.
 */
export const MAP_TILE_FILTER = "var(--map-tile-filter)"; // défini par thème dans styles/tokens.css

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
