import { describe, it, expect } from "vitest";
import {
  buildShareModel, drawShareCard, SHARE_STYLES, SHARE_FONTS, SHARE_BACKGROUNDS, SHARE_THEMES, SHARE_ADJUST, SHARE_ACCENTS,
} from "./shareCard.js";
import { loggingCtx } from "./testCanvas.js";
import { loopRoute } from "./testRoutes.js";

const RAW = loopRoute(500);
const activity = {
  id: "a1", name: "Boucle du matin", date: "2026-09-20T08:00:00Z", sportType: "gravel",
  distance: 63.4, movingTime: 8700, duration: 9800, avgSpeed: 26.2, elevationGain: 812,
  avgHeartRate: 148, maxHeartRate: 175, avgPower: 210, avgCadence: 88,
  gpsTrack: RAW, samples: RAW.map((p, i) => ({ latitude: p.lat, longitude: p.lon, altitude: 200 + 80 * Math.sin(i / 40) })),
  flags: { hasElevation: true },
};
const draw = (options) => { const c = loggingCtx(); drawShareCard(c, buildShareModel(activity, options)); return c.log; };
const texts = (log) => log.filter((l) => l[0] === "fillText").map((l) => l[1]);
const fonts = (log) => log.filter((l) => l[0] === "set" && l[1] === "font").map((l) => l[2]);

describe("catalogues", () => {
  it("propose plusieurs mises en page, polices et fonds, tous reconnus par le modèle", () => {
    expect(SHARE_STYLES.length).toBeGreaterThanOrEqual(4);
    expect(SHARE_FONTS.length).toBeGreaterThanOrEqual(5);
    expect(SHARE_BACKGROUNDS.length).toBeGreaterThanOrEqual(6);
    for (const b of SHARE_BACKGROUNDS) expect(SHARE_THEMES[b.key], b.key).toBeTruthy();
    for (const s of SHARE_STYLES) expect(buildShareModel(activity, { style: s.key }).style).toBe(s.key);
  });
});

describe("mise en page", () => {
  it("un style inconnu retombe sur classique", () => {
    expect(buildShareModel(activity, { style: "nope" }).style).toBe("classic");
  });
  it("chaque style garde le tracé dans le canvas, dans les trois formats", () => {
    for (const style of SHARE_STYLES.map((s) => s.key)) {
      for (const format of ["story", "square", "sticker"]) {
        const m = buildShareModel(activity, { style, format });
        const r = m.layout.route;
        expect(r.x + r.w, `${style} ${format}`).toBeLessThanOrEqual(m.width);
        expect(r.y + r.h, `${style} ${format}`).toBeLessThanOrEqual(m.height);
        expect(m.layout.statsY + 78 + 10, `${style} ${format}`).toBeLessThanOrEqual(m.height);
      }
    }
  });
  it("« centré » ancre les textes au centre de l'image", () => {
    const m = buildShareModel(activity, { style: "centered", format: "square" });
    expect(m.layout.align).toBe("center");
    const l = draw({ style: "centered", format: "square" });
    expect(l.some((c) => c[0] === "set" && c[1] === "textAlign" && c[2] === "center")).toBe(true);
    expect(l.filter((c) => c[0] === "fillText" && c[1] === "Boucle du matin").every((c) => Number(c[2]) === 540)).toBe(true);
  });
});

describe("polices", () => {
  it("applique la pile choisie à tous les textes, jamais la police système", () => {
    const serif = SHARE_FONTS.find((f) => f.key === "serif").stack;
    const f = fonts(draw({ font: "serif" }));
    expect(f.length).toBeGreaterThan(5);
    expect(f.every((x) => x.endsWith(serif))).toBe(true);
  });
  it("police inconnue : retour à la police moderne", () => {
    expect(buildShareModel(activity, { font: "comic" }).fontStack).toBe(SHARE_FONTS[0].stack);
  });
});

describe("couleur d'accent", () => {
  it("accepte un hexadécimal à 6 chiffres et l'applique au tracé", () => {
    const l = draw({ accent: "#fc4c02" });
    expect(l.some((c) => c[0] === "set" && c[1] === "strokeStyle" && c[2] === "#fc4c02")).toBe(true);
  });
  it("ignore une valeur invalide (jamais de style CSS arbitraire dans le canvas)", () => {
    expect(buildShareModel(activity, { accent: "red; alert(1)" }).accent).toBeNull();
    expect(buildShareModel(activity, { accent: "#12" }).accent).toBeNull();
    for (const a of SHARE_ACCENTS) expect(buildShareModel(activity, { accent: a }).accent).toBe(a);
  });
});

describe("éléments retirables", () => {
  it("masque titre, date, signature et grille à la demande", () => {
    const base = texts(draw({}));
    expect(base).toContain("Boucle du matin");
    expect(base).toContain("CYCLING OS");
    const none = texts(draw({ hiddenParts: ["title", "date", "brand"] }));
    expect(none).not.toContain("Boucle du matin");
    expect(none).not.toContain("CYCLING OS");
    expect(none.some((t) => /septembre/i.test(t))).toBe(false);
    expect(draw({ hiddenParts: ["grid"] }).filter((c) => c[0] === "stroke").length).toBeLessThan(draw({}).filter((c) => c[0] === "stroke").length);
  });
  it("masque le profil d'altitude", () => {
    expect(buildShareModel(activity, {}).profile).not.toBeNull();
    expect(buildShareModel(activity, { hiddenParts: ["profile"] }).profile).toBeNull();
  });
});

describe("chiffres supplémentaires", () => {
  it("ajoute FC, puissance et cadence quand elles existent, et libère la place du profil", () => {
    const m = buildShareModel(activity, { extra: ["heartRate", "power", "cadence"] });
    expect(m.stats.map((s) => s.key)).toEqual(["movingTime", "avgSpeed", "elevationGain", "heartRate", "power", "cadence"]);
    expect(m.profile).toBeNull(); // deux rangées : plus de place pour le profil
  });
  it("n'affiche que la moyenne (pas « · max ») pour tenir dans une colonne", () => {
    const m = buildShareModel(activity, { extra: ["heartRate", "power"] });
    expect(m.stats.find((x) => x.key === "heartRate").value).toBe("148");
    expect(m.stats.find((x) => x.key === "power").value).toBe("210");
  });
  it("ignore un chiffre absent de la sortie sans rien inventer", () => {
    const m = buildShareModel({ ...activity, avgPower: null }, { extra: ["power"] });
    expect(m.stats.some((s) => s.key === "power")).toBe(false);
  });
  it("deux rangées de chiffres restent dans l'image, quel que soit le format et le style", () => {
    for (const style of SHARE_STYLES.map((x) => x.key)) {
      for (const format of ["story", "square", "sticker"]) {
        const m = buildShareModel(activity, { style, format, extra: ["heartRate", "power", "cadence"] });
        const lastRowBottom = m.layout.statsY + m.layout.statRowGap + 78;
        expect(lastRowBottom, `${style} ${format}`).toBeLessThanOrEqual(m.height);
        expect(m.layout.route.h, `${style} ${format}`).toBeGreaterThanOrEqual(200);
        expect(m.layout.distanceY, `${style} ${format}`).toBeLessThan(m.layout.statsY);
      }
    }
  });
  it("jamais plus de six chiffres", () => {
    expect(buildShareModel(activity, { extra: ["heartRate", "power", "cadence", "elapsed"] }).stats.length).toBeLessThanOrEqual(6);
  });
});

describe("réglages manuels", () => {
  it("borne chaque réglage à sa plage (valeurs absurdes ou non numériques incluses)", () => {
    const m = buildShareModel(activity, { textScale: 9, routeScale: -3, routeX: 1e6, routeY: "x", routeWidth: NaN });
    expect(m.adjust.textScale).toBe(SHARE_ADJUST.textScale.max);
    expect(m.adjust.routeScale).toBe(SHARE_ADJUST.routeScale.min);
    expect(m.adjust.routeX).toBe(SHARE_ADJUST.routeX.max);
    expect(m.adjust.routeY).toBe(0);
    expect(m.adjust.routeWidth).toBe(SHARE_ADJUST.routeWidth.def);
  });
  it("la taille du texte suit le curseur", () => {
    const size = (ts) => Math.max(...fonts(draw({ textScale: ts })).map((f) => parseInt(f.split(" ")[1], 10)));
    expect(size(1.25)).toBeGreaterThan(size(0.8));
  });
  it("échelle et décalage du tracé : transformation appliquée puis restaurée", () => {
    const l = draw({ routeScale: 0.8, routeX: 40, routeY: -20 });
    const ops = l.map((c) => c[0]);
    expect(ops).toContain("translate");
    expect(ops).toContain("scale");
    expect(ops.filter((o) => o === "save").length).toBe(ops.filter((o) => o === "restore").length);
  });
  it("épaisseur du tracé réglable, indépendante de l'échelle", () => {
    const widths = (o) => draw(o).filter((c) => c[0] === "set" && c[1] === "lineWidth").map((c) => Number(c[2]));
    expect(Math.max(...widths({ routeWidth: 20 }))).toBeGreaterThan(Math.max(...widths({ routeWidth: 6 })));
    expect(widths({ routeWidth: 12, routeScale: 0.5 })).toContain(24); // 12 / 0,5 : épaisseur finale constante à l'écran
  });
});

describe("confidentialité", () => {
  it("aucune coordonnée GPS dans le modèle, quels que soient les réglages", () => {
    const json = JSON.stringify(buildShareModel(activity, { style: "route", extra: ["heartRate"], routeScale: 1.4, hidePlaces: false }));
    for (const p of RAW.slice(0, 60)) { expect(json).not.toContain(p.lat.toFixed(4)); expect(json).not.toContain(p.lon.toFixed(4)); }
  });
});
