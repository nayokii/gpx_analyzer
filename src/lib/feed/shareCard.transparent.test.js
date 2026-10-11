/**
 * Fond transparent de la carte partageable.
 *
 * Ces tests utilisent un VRAI moteur de canvas (@napi-rs/canvas, dépendance de développement) : le PNG est réellement
 * encodé puis relu, ce qui permet de vérifier le canal alpha pixel par pixel (jsdom n'implémente pas le canvas 2D).
 * Les assertions sur la forme des glyphes sont ignorées si aucune police système n'est disponible.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import {
  SHARE_FORMATS, SHARE_THEMES, SHARE_BACKGROUNDS, buildShareModel, drawShareCard, renderShareCard, shareFileName,
} from "./shareCard.js";
import { loggingCtx } from "./testCanvas.js";
import { loopRoute } from "./testRoutes.js";

const HAS_FONTS = GlobalFonts.families.length > 0;
const RAW = loopRoute(500);
const withGps = {
  id: "a1", name: "Boucle du matin", date: "2026-09-20T08:00:00Z", sportType: "gravel",
  distance: 63.4, movingTime: 8700, duration: 9800, avgSpeed: 26.2, elevationGain: 812,
  gpsTrack: RAW, samples: RAW.map((p, i) => ({ latitude: p.lat, longitude: p.lon, altitude: 200 + 80 * Math.sin(i / 40) })), flags: { hasElevation: true },
};
const noGps = { ...withGps, gpsTrack: [], samples: [] };

/** Rend le modèle, encode en PNG, RELIT le PNG et renvoie ses pixels RGBA. */
async function exportPng(activity, options) {
  const model = buildShareModel(activity, options);
  const canvas = createCanvas(model.width, model.height);
  expect(renderShareCard(canvas, model)).toBe(true);
  const png = canvas.toBuffer("image/png");
  const img = await loadImage(png);
  const back = createCanvas(img.width, img.height);
  back.getContext("2d").drawImage(img, 0, 0);
  const { data } = back.getContext("2d").getImageData(0, 0, img.width, img.height);
  return { model, png, width: img.width, height: img.height, data };
}
const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];
const rgbaAt = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

function stats(img) {
  const n = img.width * img.height;
  let transparent = 0, opaque = 0, partial = 0, white = 0, pink = 0;
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]];
    if (a === 0) { transparent++; continue; }
    const x = i % img.width, y = (i / img.width) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (a === 255) {
      opaque++;
      if (r > 245 && g > 245 && b > 245) white++;
      if (Math.abs(r - 214) < 6 && Math.abs(g - 17) < 6 && Math.abs(b - 107) < 6) pink++;
    } else partial++;
  }
  return { n, transparent, opaque, partial, white, pink, margins: { left: minX, top: minY, right: img.width - 1 - maxX, bottom: img.height - 1 - maxY } };
}

const luminance = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (s) => s.match(/[\d.]+/g).map(Number);
const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

describe("fond transparent — vrai PNG avec canal alpha", () => {
  for (const format of ["story", "square", "sticker"]) {
    for (const [label, activity] of [["avec tracé GPS", withGps], ["sans tracé GPS", noGps]]) {
      it(`${format}, ${label} : PNG RGBA 8 bits aux dimensions exactes, coins et fond transparents`, async () => {
        const img = await exportPng(activity, { format, theme: "transparent" });
        const f = SHARE_FORMATS[format];
        expect([img.width, img.height]).toEqual([f.width, f.height]);
        // signature PNG + IHDR : profondeur 8 bits, type de couleur 6 = RGBA (canal alpha réel)
        expect(img.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(img.png[24]).toBe(8);
        expect(img.png[25]).toBe(6);
        for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1], [img.width >> 1, 3], [3, img.height >> 1]]) {
          expect(rgbaAt(img, x, y)).toEqual([0, 0, 0, 0]);
        }
        const s = stats(img);
        expect(s.transparent / s.n).toBeGreaterThan(0.8); // le fond est transparent : seul le contenu est dessiné
        expect(s.opaque).toBeGreaterThan(1000); // et le contenu, lui, est bien là
      });
    }
  }

  it("aucun grand rectangle opaque : pas de bandeau ni de cadre derrière les éléments", async () => {
    const img = await exportPng(withGps, { format: "story", theme: "transparent" });
    const s = stats(img);
    expect(s.opaque / s.n).toBeLessThan(0.12);
    // zone du tracé (rectangle prévu pour la carte) : ses coins ne portent aucun fond ni grille
    const r = img.model.layout.route;
    for (const [x, y] of [[r.x + 3, r.y + 3], [r.x + r.w - 4, r.y + 3], [r.x + 3, r.y + r.h - 4], [r.x + r.w - 4, r.y + r.h - 4]]) {
      expect(alphaAt(img, x, y)).toBe(0);
    }
  });

  it("marges transparentes raisonnables autour du contenu (sticker plus compact, mais jamais collé au bord)", async () => {
    for (const format of ["story", "square", "sticker"]) {
      const img = await exportPng(withGps, { format, theme: "transparent" });
      const { margins } = stats(img);
      for (const side of ["left", "top", "right", "bottom"]) expect(margins[side], `${format} ${side}`).toBeGreaterThanOrEqual(20);
    }
    const sticker = await exportPng(withGps, { format: "sticker", theme: "transparent" });
    const square = await exportPng(withGps, { format: "square", theme: "transparent" });
    expect(sticker.model.layout.margin).toBeLessThan(square.model.layout.margin);
  });

  it.skipIf(!HAS_FONTS)("la transparence concerne le fond, pas les textes ni les statistiques : glyphes blancs pleinement opaques", async () => {
    const img = await exportPng(withGps, { format: "square", theme: "transparent" });
    const { layout } = img.model;
    const countWhite = (y0, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) { const [r, g, b, a] = rgbaAt(img, x, y); if (a === 255 && r > 245 && g > 245 && b > 245) n++; }
      return n;
    };
    expect(countWhite(layout.titleY - 60, layout.titleY + 10)).toBeGreaterThan(300); // titre
    expect(countWhite(layout.distanceY - 150, layout.distanceY)).toBeGreaterThan(2000); // distance dominante
    expect(countWhite(layout.statsY + 10, layout.statsY + 90)).toBeGreaterThan(500); // statistiques
  });

  it.skipIf(!HAS_FONTS)("le tracé GPS est dessiné en couleur de marque opaque avec un halo sombre semi-transparent ; sans tracé il n'y en a pas", async () => {
    const withRoute = stats(await exportPng(withGps, { format: "square", theme: "transparent" }));
    const without = stats(await exportPng(noGps, { format: "square", theme: "transparent" }));
    expect(withRoute.pink).toBeGreaterThan(1500);
    expect(withRoute.partial).toBeGreaterThan(without.partial);
    expect(without.pink).toBeLessThan(withRoute.pink / 10); // sans tracé : plus que la signature/unités teintées
  });

  it("états du modèle : sans tracé GPS, le message de remplacement est dessiné, jamais un tracé", async () => {
    const model = buildShareModel(noGps, { format: "story", theme: "transparent" });
    expect(model.route).toBeNull();
    const ctx = loggingCtx();
    drawShareCard(ctx, model);
    expect(ctx.log.some((c) => c[0] === "fillText" && /indisponible/.test(c[1]))).toBe(true);
  });

  it("options conservées : chiffres masqués et lieux masqués fonctionnent aussi en transparent", () => {
    const hidden = buildShareModel(withGps, { theme: "transparent", hidden: ["distance", "elevationGain"] });
    expect(hidden.distance).toBeNull();
    expect(hidden.stats.map((s) => s.key)).toEqual(["movingTime", "avgSpeed"]);
    const arcs = (opts) => { const ctx = loggingCtx(); drawShareCard(ctx, buildShareModel(withGps, { theme: "transparent", simplify: false, ...opts })); return ctx.log.filter((c) => c[0] === "arc").length; };
    expect(arcs({ hidePlaces: false })).toBe(arcs({ hidePlaces: true }) + 4);
  });

  it("aucune donnée inventée ni modifiée : l'activité est intacte et le texte est celui des autres fonds", () => {
    const before = JSON.stringify(withGps);
    const texts = (theme) => { const c = loggingCtx(); drawShareCard(c, buildShareModel(withGps, { format: "story", theme })); return c.log.filter((l) => l[0] === "fillText").map((l) => l[1]); };
    expect(texts("transparent")).toEqual(texts("dark"));
    expect(JSON.stringify(withGps)).toBe(before);
  });

  it("aucune coordonnée GPS brute dans le rendu transparent (mêmes garanties que les autres fonds)", () => {
    const json = JSON.stringify(buildShareModel(withGps, { theme: "transparent" }));
    for (const p of RAW.slice(0, 60)) { expect(json).not.toContain(p.lat.toFixed(4)); expect(json).not.toContain(p.lon.toFixed(4)); }
  });
});

describe("fond transparent — instructions de dessin", () => {
  const log = (theme, format = "story") => { const ctx = loggingCtx(); drawShareCard(ctx, buildShareModel(withGps, { format, theme })); return ctx.log; };

  it("efface le canvas et ne dessine aucun fond (ni dégradé, ni fillRect, ni grille)", () => {
    const l = log("transparent");
    expect(l.some((c) => c[0] === "clearRect")).toBe(true);
    expect(l.some((c) => c[0] === "fillRect")).toBe(false);
    expect(l.some((c) => c[0] === "gradient")).toBe(false);
    expect(l.some((c) => c[0] === "clip")).toBe(false);
  });

  it("les thèmes clair et sombre dessinent toujours un fond plein (dégradé + fillRect), sans clearRect", () => {
    for (const theme of ["dark", "light"]) {
      const l = log(theme);
      expect(l.some((c) => c[0] === "fillRect")).toBe(true);
      expect(l.some((c) => c[0] === "gradient")).toBe(true);
      expect(l.some((c) => c[0] === "clearRect")).toBe(false);
      expect(l.some((c) => c[0] === "strokeText")).toBe(false); // pas de contour de texte hors transparent
    }
  });

  it("chaque texte du fond transparent est contouré (strokeText) avant d'être rempli", () => {
    const l = log("transparent");
    const fills = l.filter((c) => c[0] === "fillText").length;
    expect(l.filter((c) => c[0] === "strokeText").length).toBe(fills);
  });
});

describe("clair et sombre : rendus inchangés par l'ajout du fond transparent", () => {
  // Empreintes (journal complet des instructions de dessin, propriétés et dégradés compris). Mises à jour pour le tracé rose de marque : seul le nom de couleur change (même nombre d'instructions).
  const BASELINE = {
    "gps-story-dark": "61cdd857e4c18f45:578", "gps-story-light": "3e72a125656eb9e8:578",
    "gps-square-dark": "e7d9320e7c570c96:377", "gps-square-light": "2f2e4a78f435754b:377",
    "nogps-story-dark": "12fcb1c6cee71554:124", "nogps-story-light": "376226a1757c1a6a:124",
    "nogps-square-dark": "b3ef1710ade66a9a:114", "nogps-square-light": "9e3bc60ccf365d57:114",
  };
  for (const [key, expected] of Object.entries(BASELINE)) {
    it(`${key} : même suite d'instructions de dessin qu'avant`, () => {
      const [label, format, theme] = key.split("-");
      const ctx = loggingCtx();
      drawShareCard(ctx, buildShareModel(label === "gps" ? withGps : noGps, { format, theme }));
      const got = createHash("sha256").update(JSON.stringify(ctx.log)).digest("hex").slice(0, 16) + ":" + ctx.log.length;
      expect(got).toBe(expected);
    });
  }

  it("les exports clair et sombre restent entièrement opaques (aucune transparence)", async () => {
    for (const theme of ["dark", "light"]) {
      for (const format of ["story", "square"]) {
        const img = await exportPng(withGps, { format, theme });
        const s = stats(img);
        expect(s.transparent, `${theme} ${format}`).toBe(0);
        expect(alphaAt(img, 0, 0)).toBe(255);
        expect(alphaAt(img, img.width - 1, img.height - 1)).toBe(255);
      }
    }
  });

  it("les palettes clair et sombre sont inchangées et le fond transparent est un troisième choix", () => {
    expect(SHARE_THEMES.dark.bg0).toBe("#0b100e");
    expect(SHARE_THEMES.light.bg0).toBe("#f4f7f5");
    expect(SHARE_BACKGROUNDS.map((b) => b.key)).toEqual(["dark", "light", "transparent"]);
    expect([SHARE_FORMATS.story.width, SHARE_FORMATS.story.height]).toEqual([1080, 1920]);
    expect([SHARE_FORMATS.square.width, SHARE_FORMATS.square.height]).toEqual([1080, 1080]);
  });
});

describe("fond transparent — contraste et nom de fichier", () => {
  const T = SHARE_THEMES.transparent;
  const outlineRgba = rgba(T.outline);
  const haloRgba = rgba(T.halo);

  it("texte blanc lisible sur n'importe quel fond : contour sombre ≥ 4,5:1 même sur une photo blanche", () => {
    const outlineOverWhite = over(outlineRgba.slice(0, 3), outlineRgba[3], [255, 255, 255]);
    expect(contrast([255, 255, 255], outlineOverWhite)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeGreaterThanOrEqual(4.5); // et bien sûr sur noir
  });

  it("tracé et marqueurs : couleur de marque ≥ 3:1 contre son halo sombre, même sur fond blanc", () => {
    const haloOverWhite = over(haloRgba.slice(0, 3), haloRgba[3], [255, 255, 255]);
    expect(contrast(hex(T.route), haloOverWhite)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(T.endFill), haloOverWhite)).toBeGreaterThanOrEqual(4.5);
  });

  it("le nom de fichier signale le fond transparent ; inchangé pour clair et sombre", () => {
    expect(shareFileName("Col d'Aubisque", "story", "transparent")).toBe("cycling-os-col-d-aubisque-story-transparent.png");
    expect(shareFileName("Col d'Aubisque", "story", "dark")).toBe("cycling-os-col-d-aubisque-story.png");
    expect(shareFileName("Col d'Aubisque", "square")).toBe("cycling-os-col-d-aubisque-square.png");
    expect(shareFileName("Col", "sticker", "transparent")).toBe("cycling-os-col-sticker-transparent.png");
  });
});
