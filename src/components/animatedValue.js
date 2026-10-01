/**
 * Logique pure d'AnimatedValue : analyse d'une valeur DÉJÀ FORMATÉE pour l'affichage
 * ("18,6", "+405", "1 234", "1h09", "12:45", "1 h 23 min"), interpolation entre deux
 * affichages de même structure, et reformatage au format d'origine.
 *
 * Principe : on n'invente jamais de format. On repère les nombres dans la chaîne, on
 * garde tout le reste (signes, unités, séparateurs) tel quel, et on ne réinterpole que
 * si l'ancienne et la nouvelle valeur ont exactement la même structure. Sinon l'appelant
 * affiche directement la nouvelle valeur (aucune animation).
 */

// Nombre fr-FR : groupes de milliers séparés par espace insécable (fine ou non), virgule décimale.
const NUM_RE = /(\d{1,3}(?:[  ]\d{3})+|\d+)(,\d+)?/g;

/** Durées composites ("1h09", "12:45", "1 h 23 min", "5 min 3 s") : unité de chaque nombre, en secondes, ou null. */
function detectTimeUnits(lits, count) {
  if (count < 2) return null;
  const units = [];
  for (let i = 0; i < count; i++) {
    const suffix = lits[i + 1];
    let u = null;
    if (/^\s*h/.test(suffix)) u = 3600;
    else if (/^\s*min/.test(suffix)) u = 60;
    else if (/^\s*s(\s|$)/.test(suffix)) u = 1;
    else if (/^:/.test(suffix)) u = 60;
    else if (suffix === "" && i > 0) u = units[i - 1] === 3600 ? 60 : units[i - 1] === 60 ? 1 : null;
    if (u == null) return null;
    units.push(u);
  }
  for (let i = 1; i < units.length; i++) if (units[i] >= units[i - 1]) return null;
  return units;
}

/**
 * @param {string} text - valeur formatée telle qu'affichée
 * @returns {{text:string, lits:string[], nums:{decimals:number,pad:number}[], units:number[]|null, vector:number[], sig:string}}
 */
export function parseDisplay(text) {
  const lits = [];
  const nums = [];
  const values = [];
  let last = 0;
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(text)) !== null) {
    lits.push(text.slice(last, m.index));
    const intDigits = m[1].replace(/[  ]/g, "");
    const frac = m[2] ? m[2].slice(1) : "";
    values.push(parseFloat(frac ? intDigits + "." + frac : intDigits));
    nums.push({ decimals: frac.length, pad: intDigits.length > 1 && intDigits[0] === "0" ? intDigits.length : 0 });
    last = m.index + m[0].length;
  }
  lits.push(text.slice(last));
  const units = detectTimeUnits(lits, nums.length);
  const vector = units ? [values.reduce((s, v, i) => s + v * units[i], 0)] : values;
  const sig = JSON.stringify([lits, nums.map((n) => n.decimals), units]);
  return { text, lits, nums, units, vector, sig };
}

/** Deux affichages sont interpolables s'ils ont la même structure et au moins un nombre. */
export function isCompatible(a, b) {
  return a.nums.length > 0 && a.sig === b.sig;
}

/** Reformate un vecteur de valeurs dans le format de `parsed`. */
export function formatDisplay(parsed, vector) {
  const { lits, nums, units } = parsed;
  let parts;
  if (units) {
    let rest = Math.max(0, Math.round(vector[0]));
    parts = units.map((u, i) => {
      const v = Math.floor(rest / u);
      rest -= v * u;
      const s = String(v);
      return i > 0 && nums[i].pad ? s.padStart(nums[i].pad, "0") : s;
    });
  } else {
    parts = nums.map((n, i) => {
      const v = vector[i];
      const s =
        n.decimals === 0
          ? Math.round(v).toLocaleString("fr-FR")
          : v.toLocaleString("fr-FR", { minimumFractionDigits: n.decimals, maximumFractionDigits: n.decimals });
      return n.pad ? s.padStart(n.pad, "0") : s;
    });
  }
  let out = lits[0];
  for (let i = 0; i < parts.length; i++) out += parts[i] + lits[i + 1];
  return out;
}

/** Courbe de Bézier cubique CSS (même définition que --ease). */
export function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const MAX_DURATION_MS = 400;
const DEFAULT_DURATION_MS = 250;

/** Lit --dur-base (borné à 400 ms). Sous prefers-reduced-motion, les tokens valent ~0 : l'appelant affiche alors directement. */
export function readDurationMs() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-base").trim();
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Math.min(MAX_DURATION_MS, parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1));
  } catch (e) {
    /* hors navigateur : valeur par défaut */
  }
  return DEFAULT_DURATION_MS;
}

/** Lit --ease (cubic-bezier) ; repli sur un ease-out. */
export function readEasing() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--ease");
    const m = /cubic-bezier\(([^)]+)\)/.exec(raw);
    if (m) {
      const n = m[1].split(",").map((s) => parseFloat(s));
      if (n.length === 4 && n.every((v) => !isNaN(v))) return makeBezier(n[0], n[1], n[2], n[3]);
    }
  } catch (e) {
    /* hors navigateur : repli */
  }
  return easeOutCubic;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
