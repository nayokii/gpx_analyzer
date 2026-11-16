/**
 * Image de récap « ma semaine / mon mois / mon année » : chiffre vedette, variation par rapport à la période
 * précédente, trois autres chiffres, diagramme en barres (jours ou mois) et série de semaines.
 *
 * Réutilise le moteur de partage des sorties (formats, thèmes, polices, couleur d'accent, fond transparent) : même
 * rendu sur canvas, donc l'aperçu et le PNG exporté sont identiques. Le modèle ne contient que des totaux — ni
 * coordonnées GPS, ni nom de sortie.
 */
import {
  SHARE_FORMATS, SHARE_THEMES, SHARE_FONTS, SHARE_ADJUST, FONT, put, fitText, withAccent, drawBackground,
} from "../feed/shareCard.js";
import {
  periodStart, shiftPeriod, periodLabel, totalsForPeriod, activitiesBetween, aggregate, delta, weekStreak,
  formatHours, daysOf,
} from "./progress.js";
import { localDayKey } from "../history/dateUtils.js";
import { fmt1, fmtInt } from "../utils.js";

export const RECAP_METRICS = [
  { key: "distance", label: "Distance" },
  { key: "time", label: "Temps" },
  { key: "elevation", label: "Dénivelé" },
];

export const RECAP_PARTS = [
  { key: "title", label: "Titre" },
  { key: "brand", label: "Signature" },
  { key: "delta", label: "Variation" },
  { key: "chart", label: "Diagramme" },
  { key: "streak", label: "Série de semaines" },
];

const METRIC_DEFS = {
  distance: { label: "Distance", unit: "km", field: "distanceKm", value: (t) => t.distanceKm, text: (t) => fmt1(t.distanceKm) },
  time: { label: "Temps", unit: "", field: "movingTimeSec", value: (t) => t.movingTimeSec / 3600, text: (t) => formatHours(t.movingTimeSec) },
  elevation: { label: "Dénivelé", unit: "m", field: "elevationGainM", value: (t) => t.elevationGainM, text: (t) => fmtInt(t.elevationGainM) },
};

const KIND_LABEL = { week: "Ma semaine", month: "Mon mois", year: "Mon année" };
const VS_LABEL = { week: "vs semaine précédente", month: "vs mois précédent", year: "vs année précédente" };
const WEEK_LETTERS = "LMMJVSD";
const MONTH_LETTERS = "JFMAMJJASOND";

const clamp = (v, { min, max, def }) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

function recapLayout(format) {
  if (format === "story") {
    return { margin: 80, titleY: 240, titleSize: 84, subtitleY: 300, heroY: 640, heroSize: 290, deltaY: 725, cols: 2, statsY: 850, rowGap: 175, chart: { x: 80, y: 1190, w: 920, h: 440 }, streakY: 1790 };
  }
  if (format === "sticker") {
    return { margin: 56, titleY: 170, titleSize: 62, subtitleY: 224, heroY: 450, heroSize: 190, deltaY: 520, cols: 4, statsY: 620, rowGap: 0, chart: { x: 56, y: 760, w: 968, h: 330 }, streakY: 1160 };
  }
  return { margin: 72, titleY: 175, titleSize: 62, subtitleY: 228, heroY: 440, heroSize: 180, deltaY: 505, cols: 4, statsY: 590, rowGap: 0, chart: { x: 72, y: 720, w: 936, h: 270 }, streakY: 1045 };
}

/** Barres du diagramme : un jour par barre (semaine, mois) ou un mois par barre (année). */
function buildBars(activities, kind, start, def) {
  if (kind === "year") {
    return Array.from({ length: 12 }, (_, m) => ({ label: MONTH_LETTERS[m], value: def.value(totalsForPeriod(activities, "month", new Date(start.getFullYear(), m, 1))) }));
  }
  return daysOf(kind, start).map((d, i) => ({
    label: kind === "week" ? WEEK_LETTERS[i] : i === 0 || (i + 1) % 7 === 1 ? String(i + 1) : "",
    value: def.value(aggregate(activitiesBetween(activities, d.start, d.end))),
  }));
}

/**
 * @param {Array} activities - résumés de sorties (date, distance, movingTime, elevationGain)
 * @param {Object} options
 * @param {'week'|'month'|'year'} [options.kind]
 * @param {Date} [options.start] - début de la période (aujourd'hui par défaut)
 * @param {string} [options.sportLabel] - type de sortie filtré, affiché dans le sous-titre
 * @param {'distance'|'time'|'elevation'} [options.metric] - chiffre vedette et diagramme
 */
export function buildRecapModel(activities, options = {}) {
  const {
    kind = "week", format = "story", theme = "dark", font = "system", accent = null, hiddenParts = [], metric = "distance",
    sportLabel = null, textScale, today = new Date(),
  } = options;
  const start = options.start || periodStart(kind, today);
  const fmt = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const def = METRIC_DEFS[metric] || METRIC_DEFS.distance;
  const heroKey = METRIC_DEFS[metric] ? metric : "distance";
  const parts = new Set(hiddenParts);
  const fontDef = SHARE_FONTS.find((f) => f.key === font) || SHARE_FONTS[0];

  const totals = totalsForPeriod(activities, kind, start);
  const previous = totalsForPeriod(activities, kind, shiftPeriod(kind, start, -1));
  const d = delta(totals, previous, def.field);
  let deltaInfo = null;
  if (d.diff != null && !(totals[def.field] === 0 && previous[def.field] === 0)) {
    deltaInfo = d.pct == null
      ? { text: "Nouveau", tone: "up" }
      : { text: `${d.diff > 0 ? "+" : ""}${Math.round(d.pct)} %`, tone: d.diff >= 0 ? "up" : "down" };
    deltaInfo.vs = VS_LABEL[kind];
  }

  const others = Object.entries(METRIC_DEFS).filter(([k]) => k !== heroKey).map(([, v]) => ({ label: v.label, value: v.text(totals), unit: v.unit }));
  const stats = [
    ...others,
    { label: "Sorties", value: fmtInt(totals.count), unit: "" },
    { label: "Vitesse moy.", value: totals.avgSpeedKmh != null ? fmt1(totals.avgSpeedKmh) : "—", unit: totals.avgSpeedKmh != null ? "km/h" : "" },
  ].slice(0, 4);

  const streak = weekStreak(activities, today);
  return {
    format: fmt.key, width: fmt.width, height: fmt.height, theme,
    layout: recapLayout(fmt.key),
    fontStack: fontDef.stack,
    accent: typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent) ? accent : null,
    adjust: { textScale: clamp(textScale, SHARE_ADJUST.textScale) },
    parts: { title: !parts.has("title"), brand: !parts.has("brand"), delta: !parts.has("delta"), chart: !parts.has("chart"), streak: !parts.has("streak") },
    kind,
    title: periodLabel(kind, start),
    subtitle: `${KIND_LABEL[kind]}${sportLabel ? ` · ${sportLabel}` : ""}`,
    typeLabel: sportLabel || "Toutes sorties",
    hero: { label: def.label, value: def.text(totals), unit: def.unit },
    delta: deltaInfo,
    stats,
    bars: buildBars(activities, kind, start, def),
    streak,
    count: totals.count,
  };
}

/** Dessine le modèle sur un contexte 2D dont le canvas fait déjà model.width × model.height. */
export function drawRecapCard(ctx, model) {
  const t = withAccent(SHARE_THEMES[model.theme] || SHARE_THEMES.dark, model.accent);
  const ff = model.fontStack || FONT;
  const ts = model.adjust.textScale;
  const { width: W, height: H, layout, parts } = model;
  const M = layout.margin;
  const contentW = W - M * 2;

  if (model.theme === "transparent") ctx.clearRect(0, 0, W, H);
  else drawBackground(ctx, { width: W, height: H, layout: { route: layout.chart }, parts: { grid: parts.chart } }, t);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Signature et type
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

  // Période puis sous-titre
  if (parts.title) {
    const base = Math.round(layout.titleSize * ts);
    const size = fitText(ctx, model.title, contentW, base, Math.round(base * 0.6), 800, ff);
    ctx.font = `800 ${size}px ${ff}`;
    ctx.fillStyle = t.text;
    put(ctx, t, model.title, M, layout.titleY, size);
  }
  ctx.fillStyle = t.muted;
  ctx.font = `500 ${Math.round(32 * ts)}px ${ff}`;
  put(ctx, t, model.subtitle, M, parts.title ? layout.subtitleY : layout.titleY, 32);

  // Chiffre vedette
  const want = Math.round(layout.heroSize * ts);
  const heroSize = fitText(ctx, model.hero.value, contentW * 0.8, want, 90, 800, ff);
  ctx.fillStyle = t.faint;
  ctx.font = `600 ${Math.round(28 * ts)}px ${ff}`;
  put(ctx, t, model.hero.label.toUpperCase(), M, layout.heroY - Math.round(heroSize * 0.82) - 14, 28);
  ctx.fillStyle = t.text;
  ctx.font = `800 ${heroSize}px ${ff}`;
  put(ctx, t, model.hero.value, M, layout.heroY, heroSize);
  if (model.hero.unit) {
    const vw = ctx.measureText(model.hero.value).width;
    const us = Math.round(heroSize * 0.24);
    ctx.fillStyle = t.route;
    ctx.font = `700 ${us}px ${ff}`;
    put(ctx, t, model.hero.unit, M + vw + 18, layout.heroY, us);
  }

  // Variation par rapport à la période précédente
  if (parts.delta && model.delta) {
    const ds = Math.round(42 * ts);
    ctx.font = `800 ${ds}px ${ff}`;
    ctx.fillStyle = model.delta.tone === "up" ? t.route : t.muted;
    put(ctx, t, model.delta.text, M, layout.deltaY, ds);
    const dw = ctx.measureText(model.delta.text).width;
    ctx.fillStyle = t.muted;
    ctx.font = `500 ${Math.round(30 * ts)}px ${ff}`;
    put(ctx, t, model.delta.vs, M + dw + 16, layout.deltaY, 30);
  }

  // Autres chiffres
  const colW = contentW / layout.cols;
  model.stats.forEach((s, idx) => {
    const row = Math.floor(idx / layout.cols);
    const x = M + (idx % layout.cols) * colW;
    const y = layout.statsY + row * layout.rowGap;
    ctx.fillStyle = t.faint;
    ctx.font = `600 ${Math.round(24 * ts)}px ${ff}`;
    put(ctx, t, s.label.toUpperCase(), x, y, 24);
    const size = fitText(ctx, s.value, colW - 20, Math.round((layout.cols === 2 ? 84 : 58) * ts), 30, 700, ff);
    ctx.fillStyle = t.text;
    ctx.font = `700 ${size}px ${ff}`;
    const w = ctx.measureText(s.value).width;
    put(ctx, t, s.value, x, y + Math.round(size * 1.08), size);
    if (s.unit) {
      ctx.fillStyle = t.muted;
      ctx.font = `600 ${Math.round(26 * ts)}px ${ff}`;
      put(ctx, t, s.unit, x + w + 8, y + Math.round(size * 1.08), 26);
    }
  });

  // Diagramme en barres
  if (parts.chart && model.bars.length) {
    const { x, y, w, h } = layout.chart;
    const plotH = h - 56;
    const max = Math.max(...model.bars.map((b) => b.value), 1e-9);
    const n = model.bars.length;
    const gap = n > 12 ? 5 : 14;
    const barW = (w - gap * (n - 1)) / n;
    ctx.lineJoin = "round";
    model.bars.forEach((b, i) => {
      const bx = x + i * (barW + gap);
      const bh = b.value > 0 ? Math.max(6, (b.value / max) * plotH) : 4;
      const by = y + plotH - bh;
      if (t.outline && b.value > 0) {
        ctx.strokeStyle = t.halo;
        ctx.lineWidth = 6;
        ctx.strokeRect(bx, by, barW, bh);
      }
      ctx.fillStyle = b.value > 0 ? t.route : t.profile;
      ctx.fillRect(bx, by, barW, bh);
      if (b.label) {
        ctx.fillStyle = t.faint;
        ctx.font = `600 ${Math.round(24 * ts)}px ${ff}`;
        ctx.textAlign = "center";
        put(ctx, t, b.label, bx + barW / 2, y + h - 6, 24);
        ctx.textAlign = "left";
      }
    });
  }

  // Série de semaines
  if (parts.streak && model.streak > 0) {
    ctx.fillStyle = t.route;
    ctx.beginPath();
    ctx.arc(M + 10, layout.streakY - 11, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.muted;
    ctx.font = `700 ${Math.round(32 * ts)}px ${ff}`;
    put(ctx, t, `${model.streak} semaine${model.streak > 1 ? "s" : ""} d'affilée`, M + 32, layout.streakY, 32);
  }
}

export function renderRecapCard(canvas, model) {
  canvas.width = model.width;
  canvas.height = model.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  drawRecapCard(ctx, model);
  return true;
}

/** @returns {Promise<Blob>} PNG du récap, rendu hors écran à la résolution exacte du format. */
export function exportRecapPng(model) {
  const canvas = document.createElement("canvas");
  if (!renderRecapCard(canvas, model)) return Promise.reject(new Error("Canvas 2D indisponible."));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export PNG impossible."))), "image/png");
  });
}

/** Nom de fichier sûr : type de période, date de début, format. */
export function recapFileName(kind, start, format, theme) {
  return `cycling-os-recap-${kind}-${localDayKey(start)}-${format}${theme === "transparent" ? "-transparent" : ""}.png`;
}
