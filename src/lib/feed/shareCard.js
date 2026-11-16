/**
 * Carte partageable (Story 1080×1920, carré 1080×1080) dessinée directement
 * sur un canvas 2D — résolution réelle, indépendante de l'écran.
 *
 * Pourquoi un canvas et non une capture de Leaflet : les tuiles OpenStreetMap
 * ne sont pas servies avec les en-têtes CORS requis (le canvas serait
 * « tainted », toDataURL/toBlob échoueraient) et leur politique d'usage ne
 * prévoit pas la ré-utilisation massive de tuiles dans des visuels exportés.
 * Le fond est donc une composition graphique (grille et halo discrets) et le
 * tracé est redessiné depuis les coordonnées réelles, projetées en pixels.
 *
 * `buildShareModel` produit un modèle sans AUCUNE latitude/longitude (tracé en
 * pixels uniquement) ; `drawShareCard` ne dessine que ce modèle.
 *
 * Fond « transparent » : aucun pixel de fond n'est dessiné (le canvas reste vierge, donc le PNG exporté porte un vrai
 * canal alpha). Pour rester lisibles sur n'importe quelle photo, textes et tracé sont dessinés en couleurs claires avec
 * un contour sombre semi-transparent suivant les glyphes et le tracé (jamais de rectangle ni de bandeau opaque).
 * Les thèmes « dark » et « light » ne sont pas modifiés.
 */
import {
  extractRoute, shareRoute, projectRoute, buildStats, elevationProfile,
  activityTypeLabel, displayName,
} from "./feedModel.js";

export const SHARE_FORMATS = {
  story: { key: "story", label: "Story", width: 1080, height: 1920 },
  square: { key: "square", label: "Carré", width: 1080, height: 1080 },
  // Disposition compacte pour une superposition dans une story (surtout avec le fond transparent) : marges réduites.
  sticker: { key: "sticker", label: "Sticker", width: 1080, height: 1200 },
};

/** Choix de fond proposés à l'utilisateur. */
export const SHARE_BACKGROUNDS = [
  { key: "dark", label: "Sombre" },
  { key: "light", label: "Clair" },
  { key: "black", label: "Noir" },
  { key: "sunset", label: "Coucher de soleil" },
  { key: "ocean", label: "Océan" },
  { key: "forest", label: "Forêt" },
  { key: "transparent", label: "Transparent" },
];

/** Mises en page : même contenu, composition différente. */
export const SHARE_STYLES = [
  { key: "classic", label: "Classique", hint: "Titre à gauche, distance dominante" },
  { key: "centered", label: "Centré", hint: "Tout centré, façon affiche" },
  { key: "route", label: "Carte", hint: "Le tracé occupe l'image" },
  { key: "stats", label: "Chiffres", hint: "Les chiffres d'abord, tracé en petit" },
];

/** Polices : piles système (aucun téléchargement, donc identiques à l'aperçu et dans le PNG). */
export const SHARE_FONTS = [
  { key: "system", label: "Moderne", stack: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif' },
  { key: "serif", label: "Élégante", stack: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif' },
  { key: "condensed", label: "Condensée", stack: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue Condensed", "Franklin Gothic Medium", Impact, sans-serif' },
  { key: "mono", label: "Mono", stack: '"SF Mono", "Cascadia Mono", Consolas, Menlo, "Courier New", monospace' },
  { key: "rounded", label: "Ronde", stack: '"Trebuchet MS", "Avenir Next Rounded", "Segoe UI", "Helvetica Neue", sans-serif' },
  { key: "display", label: "Affiche", stack: 'Impact, "Haettenschweiler", "Arial Black", "Helvetica Neue", sans-serif' },
];

/** Couleurs d'accent proposées (tracé, unités, repères). `null` = rose Cycling OS. */
export const SHARE_ACCENTS = ["#D6116B", "#FC4C02", "#FFC400", "#34DCBD", "#2F80ED", "#9B51E0", "#FFFFFF", "#111111"];

/** Éléments décoratifs que l'on peut retirer. */
export const SHARE_PARTS = [
  { key: "title", label: "Titre" },
  { key: "date", label: "Date" },
  { key: "brand", label: "Signature" },
  { key: "grid", label: "Grille" },
  { key: "profile", label: "Profil d'altitude" },
];

/** Chiffres supplémentaires (s'ils existent pour la sortie). */
export const EXTRA_STATS = [
  { key: "heartRate", label: "Fréq. cardiaque" },
  { key: "power", label: "Puissance" },
  { key: "cadence", label: "Cadence" },
  { key: "elapsed", label: "Temps écoulé" },
];

/** Réglages manuels : bornes et valeurs par défaut. */
export const SHARE_ADJUST = {
  textScale: { min: 0.8, max: 1.25, step: 0.05, def: 1 },
  routeScale: { min: 0.5, max: 1.4, step: 0.05, def: 1 },
  routeX: { min: -300, max: 300, step: 10, def: 0 },
  routeY: { min: -300, max: 300, step: 10, def: 0 },
  routeWidth: { min: 4, max: 26, step: 1, def: 10 },
};

const clamp = (v, { min, max, def }) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const HEX = /^#[0-9a-f]{6}$/i;

export const HIDEABLE_STATS = [
  { key: "distance", label: "Distance" },
  { key: "movingTime", label: "Durée" },
  { key: "avgSpeed", label: "Vitesse" },
  { key: "elevationGain", label: "Dénivelé" },
];

const FONT = SHARE_FONTS[0].stack;

/** Rose de marque Cycling OS : couleur du tracé GPS (et de ses repères) sur les trois fonds exportés. */
export const SHARE_ROUTE_COLOR = "#D6116B";

export const SHARE_THEMES = {
  dark: {
    bg0: "#0b100e", bg1: "#16201b", grid: "rgba(236,244,239,0.055)", glow: "rgba(52,220,189,0.16)",
    text: "#f0f4f1", muted: "#9fb0a6", faint: "#6f7f76", route: SHARE_ROUTE_COLOR, halo: "rgba(7,12,10,0.85)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#f0f4f1", markerInk: "#0b100e", profile: "rgba(52,220,189,0.22)",
  },
  light: {
    bg0: "#f4f7f5", bg1: "#e4ebe7", grid: "rgba(16,28,22,0.06)", glow: "rgba(6,117,99,0.10)",
    text: "#0f1512", muted: "#56615b", faint: "#8a958f", route: SHARE_ROUTE_COLOR, halo: "rgba(255,255,255,0.95)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#0f1512", markerInk: "#ffffff", profile: "rgba(6,117,99,0.18)",
  },
  black: {
    bg0: "#000000", bg1: "#050505", grid: "rgba(255,255,255,0.07)", glow: "rgba(255,255,255,0.05)",
    text: "#ffffff", muted: "#a8a8a8", faint: "#757575", route: SHARE_ROUTE_COLOR, halo: "rgba(0,0,0,0.9)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#ffffff", markerInk: "#000000", profile: "rgba(255,255,255,0.14)",
  },
  sunset: {
    bg0: "#2a0f3c", bg1: "#ff7a45", grid: "rgba(255,255,255,0.09)", glow: "rgba(255,210,120,0.28)",
    text: "#fff8ee", muted: "rgba(255,248,238,0.86)", faint: "rgba(255,248,238,0.68)", route: SHARE_ROUTE_COLOR, halo: "rgba(40,10,50,0.75)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#fff8ee", markerInk: "#2a0f3c", profile: "rgba(255,248,238,0.22)",
  },
  ocean: {
    bg0: "#04121f", bg1: "#0b4a6f", grid: "rgba(190,230,255,0.08)", glow: "rgba(80,200,255,0.22)",
    text: "#eaf7ff", muted: "#9fc6dd", faint: "#6f9bb5", route: SHARE_ROUTE_COLOR, halo: "rgba(2,12,22,0.85)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#eaf7ff", markerInk: "#04121f", profile: "rgba(120,210,255,0.22)",
  },
  forest: {
    bg0: "#06150d", bg1: "#1f4d33", grid: "rgba(200,255,220,0.07)", glow: "rgba(120,230,150,0.18)",
    text: "#effbf2", muted: "#a5c8b1", faint: "#74977f", route: SHARE_ROUTE_COLOR, halo: "rgba(3,14,8,0.85)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#effbf2", markerInk: "#06150d", profile: "rgba(140,240,170,0.2)",
  },
  // Fond transparent : couleurs claires + contour sombre (`outline`) pour la lisibilité sur photo ; `bg0/bg1/grid/glow` inutilisés.
  transparent: {
    bg0: null, bg1: null, grid: null, glow: null,
    text: "#ffffff", muted: "rgba(255,255,255,0.92)", faint: "rgba(255,255,255,0.82)", route: SHARE_ROUTE_COLOR, halo: "rgba(4,8,6,0.9)",
    startFill: SHARE_ROUTE_COLOR, endFill: "#ffffff", markerInk: "#04080a", profile: "rgba(255,255,255,0.13)", outline: "rgba(4,8,6,0.58)",
  },
};

/** Disposition de base (style « classique ») selon le format. */
function baseLayout(format) {
  if (format === "story") {
    return { margin: 80, route: { x: 80, y: 400, w: 920, h: 820 }, profile: { x: 80, y: 1680, w: 920, h: 110 }, statsY: 1500, distanceY: 1370, distanceSize: 250, titleSize: 80, titleY: 190 };
  }
  if (format === "sticker") {
    return { margin: 56, route: { x: 56, y: 215, w: 968, h: 560 }, profile: null, statsY: 1010, distanceY: 925, distanceSize: 170, titleSize: 58, titleY: 130 };
  }
  return { margin: 72, route: { x: 72, y: 215, w: 936, h: 450 }, profile: null, statsY: 905, distanceY: 800, distanceSize: 170, titleSize: 58, titleY: 150 };
}

/** Variantes de composition : seules les zones changent, le dessin reste le même. */
const STYLE_OVERRIDES = {
  route: {
    story: { route: { x: 60, y: 300, w: 960, h: 1000 }, profile: null, distanceY: 1470, distanceSize: 190, statsY: 1590 },
    sticker: { route: { x: 40, y: 190, w: 1000, h: 640 }, distanceY: 950, distanceSize: 140, statsY: 1050 },
    square: { route: { x: 60, y: 190, w: 960, h: 560 }, distanceY: 860, distanceSize: 130, statsY: 950 },
  },
  stats: {
    story: { route: { x: 80, y: 330, w: 920, h: 520 }, distanceY: 1150, distanceSize: 330, statsY: 1290 },
    sticker: { route: { x: 56, y: 200, w: 968, h: 380 }, distanceY: 810, distanceSize: 230, statsY: 910 },
    square: { route: { x: 72, y: 200, w: 936, h: 330 }, distanceY: 750, distanceSize: 220, statsY: 850 },
  },
};

/** Rectangle réservé au tracé et positions des textes, selon le format et le style. */
function layoutFor(format, style = "classic") {
  const base = baseLayout(format);
  const over = STYLE_OVERRIDES[style] && STYLE_OVERRIDES[style][format];
  return { ...base, ...(over || {}), align: style === "centered" ? "center" : "left", statRowGap: 150 };
}

/**
 * @param {Object} activity - Activity complète (avec gpsTrack/samples)
 * @param {Object} options
 * @param {string} [options.name] - nom affiché (surcharge utilisateur)
 * @param {'story'|'square'} [options.format]
 * @param {'dark'|'light'} [options.theme]
 * @param {string[]} [options.hidden] - clés de HIDEABLE_STATS à masquer
 * @param {boolean} [options.hidePlaces] - masque départ/arrivée (défaut : true)
 * @param {boolean} [options.simplify] - simplifie le tracé (défaut : true)
 * @returns {Object} modèle de dessin, sans coordonnées géographiques
 */
export function buildShareModel(activity, options = {}) {
  const {
    name, format = "story", theme = "dark", hidden = [], hidePlaces = true, simplify = true,
    style = "classic", font = "system", accent = null, hiddenParts = [], extra = [],
    textScale, routeScale, routeX, routeY, routeWidth,
  } = options;
  const fmt = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const layout = layoutFor(fmt.key, STYLE_OVERRIDES[style] || style === "centered" ? style : "classic");
  const hiddenSet = new Set(hidden);
  const partsHidden = new Set(hiddenParts);
  const fontDef = SHARE_FONTS.find((f) => f.key === font) || SHARE_FONTS[0];
  const adjust = {
    textScale: clamp(textScale, SHARE_ADJUST.textScale),
    routeScale: clamp(routeScale, SHARE_ADJUST.routeScale),
    routeX: clamp(routeX, SHARE_ADJUST.routeX),
    routeY: clamp(routeY, SHARE_ADJUST.routeY),
    routeWidth: clamp(routeWidth, SHARE_ADJUST.routeWidth),
  };

  const { primary, secondary } = buildStats(activity);
  const byKey = Object.fromEntries(primary.map((s) => [s.key, s]));
  const distance = hiddenSet.has("distance") ? null : byKey.distance || null;
  const secondaryByKey = Object.fromEntries(secondary.map((x) => [x.key, x]));
  const stats = [
    ...["movingTime", "avgSpeed", "elevationGain"].filter((k) => !hiddenSet.has(k) && byKey[k]).map((k) => byKey[k]),
    // Sur l'image seule la moyenne est gardée (« 148 · max 176 » est trop long pour une colonne).
    ...EXTRA_STATS.map((e) => e.key).filter((k) => extra.includes(k) && secondaryByKey[k]).map((k) => ({ ...secondaryByKey[k], value: String(secondaryByKey[k].value).split(" · ")[0] })),
  ].slice(0, 6);

  // Seconde rangée de chiffres : si elle dépasse l'image, distance et chiffres remontent et la zone du tracé se réduit.
  const rows = Math.ceil(stats.length / 3);
  if (rows > 1) {
    const bottom = layout.statsY + (rows - 1) * layout.statRowGap + 78 + layout.margin * 0.6;
    const over = Math.ceil(bottom - fmt.height);
    if (over > 0) {
      const shrink = Math.min(over, Math.max(0, layout.route.h - 260));
      layout.route = { ...layout.route, h: layout.route.h - shrink };
      layout.distanceY -= over;
      layout.statsY -= over;
      layout.statRowGap = Math.max(120, layout.statRowGap - Math.max(0, over - shrink));
    }
  }

  const coords = extractRoute(activity);
  let route = null;
  if (coords) {
    const shared = shareRoute(coords, { hidePlaces, simplify });
    const projected = projectRoute(shared.coords, { width: layout.route.w, height: layout.route.h, padding: 44 });
    route = projected && { points: projected.points, showEndpoints: shared.showEndpoints };
  }

  // Plus de trois chiffres : une seconde rangée, qui prend la place du profil d'altitude.
  let profile = null;
  if (layout.profile && !hiddenSet.has("elevationGain") && !partsHidden.has("profile") && stats.length <= 3) {
    const p = elevationProfile(activity, 90);
    if (p) profile = p.values.map((v) => (v - p.min) / (p.max - p.min)); // valeurs relatives 0–1 : aucune altitude absolue (lieu)
  }

  const date = activity && activity.date ? new Date(activity.date) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : null;

  return {
    format: fmt.key,
    width: fmt.width,
    height: fmt.height,
    theme,
    layout,
    style: layout.align === "center" ? "centered" : STYLE_OVERRIDES[style] ? style : "classic",
    fontStack: fontDef.stack,
    accent: typeof accent === "string" && HEX.test(accent) ? accent : null,
    parts: { title: !partsHidden.has("title"), date: !partsHidden.has("date"), brand: !partsHidden.has("brand"), grid: !partsHidden.has("grid") },
    adjust,
    title: displayName(activity, name ? { [activity?.id]: name } : {}),
    typeLabel: activityTypeLabel(activity && activity.sportType),
    dateLabel,
    route,
    distance,
    stats,
    profile,
    powerEstimated: secondary.some((s) => s.key === "power" && s.kind === "estimated"),
  };
}

// ------------------------------------------------------------------ dessin

/** fillText, précédé d'un contour sombre quand le thème en définit un (fond transparent). Aucun effet sur clair/sombre. */
function put(ctx, t, text, x, y, size) {
  if (t.outline) {
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = Math.min(14, Math.max(4, Math.round(size * 0.1)));
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
}

function fitText(ctx, text, maxWidth, size, minSize, weight = 700, family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

/** Coupe en `maxLines` lignes ; la dernière est tronquée par « … » si nécessaire. */
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const test = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxWidth || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines - 1) {
        cur = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (cur) lines.push(cur);
  const last = lines.length - 1;
  while (lines[last] && ctx.measureText(lines[last]).width > maxWidth && lines[last].length > 1) {
    lines[last] = lines[last].slice(0, -2).trimEnd();
    if (ctx.measureText(`${lines[last]}…`).width <= maxWidth) { lines[last] += "…"; break; }
  }
  return lines;
}

/** Thème + couleur d'accent choisie : l'accent remplace le rose pour le tracé, ses repères et les unités. */
function withAccent(theme, accent) {
  return accent ? { ...theme, route: accent, startFill: accent } : theme;
}

function drawBackground(ctx, model, t) {
  const { width: W, height: H } = model;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, t.bg0);
  g.addColorStop(1, t.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const r = model.layout.route;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(r.w, r.h) * 0.75);
  glow.addColorStop(0, t.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  if (model.parts && !model.parts.grid) return;
  // Grille discrète type carte, sur la zone du tracé uniquement
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = t.grid;
  ctx.lineWidth = 2;
  const step = 76;
  ctx.beginPath();
  for (let x = r.x; x <= r.x + r.w; x += step) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
  for (let y = r.y; y <= r.y + r.h; y += step) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
  ctx.stroke();
  ctx.restore();
}

function drawRoute(ctx, model, t) {
  const { route, layout } = model;
  const adjust = model.adjust || { routeScale: 1, routeX: 0, routeY: 0, routeWidth: 10 };
  const ox = layout.route.x;
  const oy = layout.route.y;
  const ff = model.fontStack || FONT;
  if (!route) {
    ctx.fillStyle = t.faint;
    ctx.textAlign = "center";
    ctx.font = `600 38px ${ff}`;
    put(ctx, t, "Tracé GPS indisponible", ox + layout.route.w / 2, oy + layout.route.h / 2, 38);
    ctx.textAlign = "left";
    return;
  }
  // Réglages manuels : échelle et décalage du tracé autour du centre de sa zone ; l'épaisseur reste celle choisie.
  const cx = ox + layout.route.w / 2;
  const cy = oy + layout.route.h / 2;
  const k = 1 / adjust.routeScale;
  ctx.save();
  ctx.translate(cx + adjust.routeX, cy + adjust.routeY);
  ctx.scale(adjust.routeScale, adjust.routeScale);
  ctx.translate(-cx, -cy);
  const trace = () => {
    ctx.beginPath();
    route.points.forEach((p, i) => (i === 0 ? ctx.moveTo(ox + p.x, oy + p.y) : ctx.lineTo(ox + p.x, oy + p.y)));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = t.halo;
  ctx.lineWidth = (adjust.routeWidth + 10) * k;
  trace();
  ctx.stroke();
  ctx.strokeStyle = t.route;
  ctx.lineWidth = adjust.routeWidth * k;
  trace();
  ctx.stroke();

  if (route.showEndpoints) {
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    const rad = Math.max(8, adjust.routeWidth * 1.3) * k;
    const marker = (p, fill) => {
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, rad + 7 * k, 0, Math.PI * 2);
      ctx.fillStyle = t.halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    marker(first, t.startFill);
    marker(last, t.endFill);
  }
  ctx.restore();
}

function drawProfile(ctx, model, t) {
  if (!model.profile || !model.layout.profile) return;
  const { x, y, w, h } = model.layout.profile;
  const n = model.profile.length;
  ctx.lineCap = "round"; // même embout que le tracé (l'état est restauré après les réglages manuels du tracé)
  const pt = (i) => [x + (i / (n - 1)) * w, y + h - 8 - model.profile[i] * (h - 24)];
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let i = 0; i < n; i++) ctx.lineTo(...pt(i));
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fillStyle = t.profile;
  ctx.fill();
  if (t.outline) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(...pt(i)) : ctx.lineTo(...pt(i)));
    ctx.strokeStyle = t.halo;
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(...pt(i)) : ctx.lineTo(...pt(i)));
  ctx.strokeStyle = t.route;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * Dessine le modèle sur un contexte 2D dont le canvas fait déjà
 * model.width × model.height.
 */
export function drawShareCard(ctx, model) {
  const t = withAccent(SHARE_THEMES[model.theme] || SHARE_THEMES.dark, model.accent);
  const ff = model.fontStack || FONT;
  const ts = model.adjust ? model.adjust.textScale : 1;
  const parts = model.parts || { title: true, date: true, brand: true, grid: true };
  const { width: W, layout } = model;
  const M = layout.margin;
  const contentW = W - M * 2;
  const center = layout.align === "center";
  const anchorX = center ? W / 2 : M;
  const align = center ? "center" : "left";

  if (model.theme === "transparent") ctx.clearRect(0, 0, model.width, model.height); // aucun fond : canal alpha conservé
  else drawBackground(ctx, model, t);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Signature discrète + type
  if (parts.brand) {
    ctx.fillStyle = t.route;
    ctx.beginPath();
    ctx.arc(M + 9, M + 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.muted;
    ctx.font = `700 28px ${ff}`;
    put(ctx, t, "CYCLING OS", M + 30, M + 14, 28);
  }
  ctx.fillStyle = t.muted;
  ctx.font = `700 28px ${ff}`;
  ctx.textAlign = "right";
  put(ctx, t, model.typeLabel.toUpperCase(), W - M, M + 14, 28);
  ctx.textAlign = "left";

  // Titre (2 lignes max) puis date
  let titleBottom = layout.titleY;
  if (parts.title) {
    const base = Math.round(layout.titleSize * ts);
    const titleSize = fitText(ctx, model.title, contentW, base, Math.round(base * 0.7), 800, ff);
    ctx.font = `800 ${titleSize}px ${ff}`;
    const lines = wrapText(ctx, model.title, contentW, model.format === "story" ? 2 : 1);
    ctx.fillStyle = t.text;
    ctx.textAlign = align;
    lines.forEach((line, i) => put(ctx, t, line, anchorX, layout.titleY + i * (titleSize * 1.1), titleSize));
    ctx.textAlign = "left";
    titleBottom = layout.titleY + (lines.length - 1) * (titleSize * 1.1);
  }
  if (parts.date && model.dateLabel) {
    ctx.fillStyle = t.muted;
    ctx.font = `500 ${Math.round((model.format === "story" ? 34 : 30) * ts)}px ${ff}`;
    const dy = titleBottom + (parts.title ? (model.format === "story" ? 56 : 46) : 0);
    ctx.textAlign = align;
    put(ctx, t, model.dateLabel.charAt(0).toUpperCase() + model.dateLabel.slice(1), anchorX, dy, 32);
    ctx.textAlign = "left";
  }

  drawRoute(ctx, model, t);

  // Distance dominante
  if (model.distance) {
    const unit = model.distance.unit || "km";
    const want = Math.round(layout.distanceSize * ts);
    const size = fitText(ctx, model.distance.value, contentW * 0.8, want, 90, 800, ff);
    ctx.font = `800 ${size}px ${ff}`;
    const vw = ctx.measureText(model.distance.value).width;
    const unitSize = Math.round(size * 0.24);
    ctx.font = `700 ${unitSize}px ${ff}`;
    const uw = ctx.measureText(unit).width;
    const x0 = center ? (W - (vw + 18 + uw)) / 2 : M;
    ctx.fillStyle = t.text;
    ctx.font = `800 ${size}px ${ff}`;
    put(ctx, t, model.distance.value, x0, layout.distanceY, size);
    ctx.fillStyle = t.route;
    ctx.font = `700 ${unitSize}px ${ff}`;
    put(ctx, t, unit, x0 + vw + 18, layout.distanceY, unitSize);
  }

  // Statistiques secondaires, réparties à égalité (rangées de trois)
  const all = model.stats;
  if (all.length) {
    const cols = Math.min(3, all.length);
    const colW = contentW / cols;
    all.forEach((s, idx) => {
      const row = Math.floor(idx / 3);
      const i = idx % 3;
      const y = layout.statsY + row * (layout.statRowGap || 150);
      const x = M + i * colW;
      ctx.fillStyle = t.faint;
      ctx.font = `600 ${Math.round(26 * ts)}px ${ff}`;
      ctx.textAlign = center ? "center" : "left";
      put(ctx, t, s.label.toUpperCase(), center ? x + colW / 2 : x, y, 26);
      ctx.textAlign = "left";
      const size = fitText(ctx, s.value, colW - 24, Math.round(70 * ts), 36, 700, ff);
      ctx.font = `700 ${size}px ${ff}`;
      const w = ctx.measureText(s.value).width;
      ctx.font = `600 ${Math.round(28 * ts)}px ${ff}`;
      const uw = s.unit ? ctx.measureText(s.unit).width + 8 : 0;
      const vx = center ? x + colW / 2 - (w + uw) / 2 : x;
      ctx.fillStyle = t.text;
      ctx.font = `700 ${size}px ${ff}`;
      put(ctx, t, s.value, vx, y + 78, size);
      if (s.unit) {
        ctx.fillStyle = t.muted;
        ctx.font = `600 ${Math.round(28 * ts)}px ${ff}`;
        put(ctx, t, s.unit, vx + w + 8, y + 78, 28);
      }
    });
  }

  drawProfile(ctx, model, t);
}

/** Dimensionne le canvas à la résolution réelle du format puis dessine. */
export function renderShareCard(canvas, model) {
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  drawShareCard(ctx, model);
  return true;
}

/** @returns {Promise<Blob>} PNG de la carte, rendu hors écran à la résolution exacte du format. */
export function exportShareCardPng(model) {
  const canvas = document.createElement("canvas");
  if (!renderShareCard(canvas, model)) return Promise.reject(new Error("Canvas 2D indisponible."));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export PNG impossible."))), "image/png");
  });
}

/** Nom de fichier sûr : jamais de nom de lieu, d'identifiant ou de coordonnée. */
export function shareFileName(title, format, theme) {
  const slug = String(title || "sortie")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sortie";
  return `cycling-os-${slug}-${format}${theme === "transparent" ? "-transparent" : ""}.png`;
}

/**
 * Partage natif (feuille de partage du téléphone) si le navigateur accepte les
 * fichiers, sinon téléchargement. Une annulation par l'utilisateur n'est pas
 * une erreur et ne déclenche pas de téléchargement de secours.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareOrDownload(blob, fileName, nav = typeof navigator !== "undefined" ? navigator : null) {
  const file = typeof File === "function" ? new File([blob], fileName, { type: "image/png" }) : null;
  if (file && nav && typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Cycling OS" });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      // échec réel du partage natif : repli sur le téléchargement
    }
  }
  downloadBlob(blob, fileName);
  return "downloaded";
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
