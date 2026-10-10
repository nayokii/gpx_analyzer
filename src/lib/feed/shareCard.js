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
  { key: "transparent", label: "Transparent" },
];

export const HIDEABLE_STATS = [
  { key: "distance", label: "Distance" },
  { key: "movingTime", label: "Durée" },
  { key: "avgSpeed", label: "Vitesse" },
  { key: "elevationGain", label: "Dénivelé" },
];

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif';

export const SHARE_THEMES = {
  dark: {
    bg0: "#0b100e", bg1: "#16201b", grid: "rgba(236,244,239,0.055)", glow: "rgba(52,220,189,0.16)",
    text: "#f0f4f1", muted: "#9fb0a6", faint: "#6f7f76", route: "#34dcbd", halo: "rgba(7,12,10,0.85)",
    startFill: "#34dcbd", endFill: "#f0f4f1", markerInk: "#0b100e", profile: "rgba(52,220,189,0.22)",
  },
  light: {
    bg0: "#f4f7f5", bg1: "#e4ebe7", grid: "rgba(16,28,22,0.06)", glow: "rgba(6,117,99,0.10)",
    text: "#0f1512", muted: "#56615b", faint: "#8a958f", route: "#067563", halo: "rgba(255,255,255,0.95)",
    startFill: "#067563", endFill: "#0f1512", markerInk: "#ffffff", profile: "rgba(6,117,99,0.18)",
  },
  // Fond transparent : couleurs claires + contour sombre (`outline`) pour la lisibilité sur photo ; `bg0/bg1/grid/glow` inutilisés.
  transparent: {
    bg0: null, bg1: null, grid: null, glow: null,
    text: "#ffffff", muted: "rgba(255,255,255,0.92)", faint: "rgba(255,255,255,0.82)", route: "#34dcbd", halo: "rgba(4,8,6,0.62)",
    startFill: "#34dcbd", endFill: "#ffffff", markerInk: "#04080a", profile: "rgba(255,255,255,0.13)", outline: "rgba(4,8,6,0.58)",
  },
};

/** Rectangle réservé au tracé, selon le format. */
function layoutFor(format) {
  if (format === "story") {
    return { margin: 80, route: { x: 80, y: 400, w: 920, h: 820 }, profile: { x: 80, y: 1680, w: 920, h: 110 }, statsY: 1500, distanceY: 1370, distanceSize: 250, titleSize: 80, titleY: 190 };
  }
  if (format === "sticker") {
    return { margin: 56, route: { x: 56, y: 215, w: 968, h: 560 }, profile: null, statsY: 1010, distanceY: 925, distanceSize: 170, titleSize: 58, titleY: 130 };
  }
  return { margin: 72, route: { x: 72, y: 215, w: 936, h: 450 }, profile: null, statsY: 905, distanceY: 800, distanceSize: 170, titleSize: 58, titleY: 150 };
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
  const { name, format = "story", theme = "dark", hidden = [], hidePlaces = true, simplify = true } = options;
  const fmt = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const layout = layoutFor(fmt.key);
  const hiddenSet = new Set(hidden);

  const coords = extractRoute(activity);
  let route = null;
  if (coords) {
    const shared = shareRoute(coords, { hidePlaces, simplify });
    const projected = projectRoute(shared.coords, { width: layout.route.w, height: layout.route.h, padding: 44 });
    route = projected && { points: projected.points, showEndpoints: shared.showEndpoints };
  }

  const { primary, secondary } = buildStats(activity);
  const byKey = Object.fromEntries(primary.map((s) => [s.key, s]));
  const distance = hiddenSet.has("distance") ? null : byKey.distance || null;
  const stats = ["movingTime", "avgSpeed", "elevationGain"].filter((k) => !hiddenSet.has(k) && byKey[k]).map((k) => byKey[k]);

  let profile = null;
  if (layout.profile && !hiddenSet.has("elevationGain")) {
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

function fitText(ctx, text, maxWidth, size, minSize, weight = 700) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
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
  const ox = layout.route.x;
  const oy = layout.route.y;
  if (!route) {
    ctx.fillStyle = t.faint;
    ctx.textAlign = "center";
    ctx.font = `600 38px ${FONT}`;
    put(ctx, t, "Tracé GPS indisponible", ox + layout.route.w / 2, oy + layout.route.h / 2, 38);
    ctx.textAlign = "left";
    return;
  }
  const trace = () => {
    ctx.beginPath();
    route.points.forEach((p, i) => (i === 0 ? ctx.moveTo(ox + p.x, oy + p.y) : ctx.lineTo(ox + p.x, oy + p.y)));
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = t.halo;
  ctx.lineWidth = 20;
  trace();
  ctx.stroke();
  ctx.strokeStyle = t.route;
  ctx.lineWidth = 10;
  trace();
  ctx.stroke();

  if (route.showEndpoints) {
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    const marker = (p, fill) => {
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = t.halo;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    marker(first, t.startFill);
    marker(last, t.endFill);
  }
}

function drawProfile(ctx, model, t) {
  if (!model.profile || !model.layout.profile) return;
  const { x, y, w, h } = model.layout.profile;
  const n = model.profile.length;
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
  const t = SHARE_THEMES[model.theme] || SHARE_THEMES.dark;
  const { width: W, layout } = model;
  const M = layout.margin;
  const contentW = W - M * 2;

  if (model.theme === "transparent") ctx.clearRect(0, 0, model.width, model.height); // aucun fond : canal alpha conservé
  else drawBackground(ctx, model, t);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Signature discrète + type
  ctx.fillStyle = t.route;
  ctx.beginPath();
  ctx.arc(M + 9, M + 4, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.muted;
  ctx.font = `700 28px ${FONT}`;
  put(ctx, t, "CYCLING OS", M + 30, M + 14, 28);
  ctx.textAlign = "right";
  put(ctx, t, model.typeLabel.toUpperCase(), W - M, M + 14, 28);
  ctx.textAlign = "left";

  // Titre (2 lignes max) puis date
  const titleSize = fitText(ctx, model.title, contentW, layout.titleSize, Math.round(layout.titleSize * 0.7), 800);
  ctx.font = `800 ${titleSize}px ${FONT}`;
  const lines = wrapText(ctx, model.title, contentW, model.format === "story" ? 2 : 1);
  ctx.fillStyle = t.text;
  lines.forEach((line, i) => put(ctx, t, line, M, layout.titleY + i * (titleSize * 1.1), titleSize));
  if (model.dateLabel) {
    ctx.fillStyle = t.muted;
    ctx.font = `500 ${model.format === "story" ? 34 : 30}px ${FONT}`;
    const dy = layout.titleY + (lines.length - 1) * (titleSize * 1.1) + (model.format === "story" ? 56 : 46);
    put(ctx, t, model.dateLabel.charAt(0).toUpperCase() + model.dateLabel.slice(1), M, dy, 32);
  }

  drawRoute(ctx, model, t);

  // Distance dominante
  if (model.distance) {
    ctx.fillStyle = t.text;
    ctx.font = `800 ${layout.distanceSize}px ${FONT}`;
    put(ctx, t, model.distance.value, M, layout.distanceY, layout.distanceSize);
    const vw = ctx.measureText(model.distance.value).width;
    ctx.fillStyle = t.route;
    ctx.font = `700 ${Math.round(layout.distanceSize * 0.24)}px ${FONT}`;
    put(ctx, t, model.distance.unit || "km", M + vw + 18, layout.distanceY, Math.round(layout.distanceSize * 0.24));
  }

  // Statistiques secondaires, réparties à égalité
  const n = model.stats.length;
  if (n) {
    const colW = contentW / n;
    model.stats.forEach((s, i) => {
      const x = M + i * colW;
      ctx.fillStyle = t.faint;
      ctx.font = `600 26px ${FONT}`;
      put(ctx, t, s.label.toUpperCase(), x, layout.statsY, 26);
      ctx.fillStyle = t.text;
      const size = fitText(ctx, s.value, colW - 24, 70, 44, 700);
      ctx.font = `700 ${size}px ${FONT}`;
      put(ctx, t, s.value, x, layout.statsY + 78, size);
      if (s.unit) {
        const w = ctx.measureText(s.value).width;
        ctx.fillStyle = t.muted;
        ctx.font = `600 28px ${FONT}`;
        put(ctx, t, s.unit, x + w + 8, layout.statsY + 78, 28);
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
