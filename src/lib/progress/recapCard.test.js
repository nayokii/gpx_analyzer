import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { buildRecapModel, drawRecapCard, renderRecapCard, recapFileName, RECAP_PARTS } from "./recapCard.js";
import { loggingCtx } from "../feed/testCanvas.js";

const ride = (y, m, d, distance, movingTime, elevationGain) => ({ date: new Date(y, m - 1, d, 12).toISOString(), distance, movingTime, elevationGain, sportType: "cycling" });
const acts = [
  ride(2026, 11, 3, 40, 7200, 400), ride(2026, 11, 8, 30, 5400, 300), // semaine du 2 nov.
  ride(2026, 10, 27, 50, 9000, 500), // semaine précédente
  ride(2026, 10, 20, 20, 3600, 100),
];
const TODAY = new Date(2026, 10, 8, 20);
const model = (o = {}) => buildRecapModel(acts, { kind: "week", today: TODAY, ...o });
const texts = (m) => { const c = loggingCtx(); drawRecapCard(c, m); return c.log.filter((l) => l[0] === "fillText").map((l) => l[1]); };

describe("modèle de récap", () => {
  it("totaux de la semaine et chiffre vedette", () => {
    const m = model();
    expect(m.hero).toMatchObject({ label: "Distance", value: "70,0", unit: "km" });
    expect(m.count).toBe(2);
    expect(m.stats.map((s) => s.label)).toEqual(["Temps", "Dénivelé", "Sorties", "Vitesse moy."]);
    expect(m.stats[0].value).toBe("3 h 30");
    expect(m.stats[1].value).toBe("700");
  });
  it("variation par rapport à la semaine précédente", () => {
    expect(model().delta).toMatchObject({ text: "+40 %", tone: "up", vs: "vs semaine précédente" });
    expect(model({ metric: "elevation" }).delta.text).toBe("+40 %");
  });
  it("baisse : signe négatif et ton « down »", () => {
    const m = buildRecapModel([ride(2026, 11, 3, 10, 1000, 0), ride(2026, 10, 27, 40, 1000, 0)], { kind: "week", today: TODAY });
    expect(m.delta).toMatchObject({ text: "-75 %", tone: "down" });
  });
  it("base nulle : « Nouveau » ; deux périodes vides : aucune variation", () => {
    expect(buildRecapModel([ride(2026, 11, 3, 10, 1000, 0)], { kind: "week", today: TODAY }).delta.text).toBe("Nouveau");
    expect(buildRecapModel([], { kind: "week", today: TODAY }).delta).toBeNull();
  });
  it("la métrique change le chiffre vedette et retire cette métrique des autres chiffres", () => {
    const m = model({ metric: "time" });
    expect(m.hero).toMatchObject({ label: "Temps", value: "3 h 30", unit: "" });
    expect(m.stats.map((s) => s.label)).toEqual(["Distance", "Dénivelé", "Sorties", "Vitesse moy."]);
  });
  it("diagramme : 7 jours pour une semaine, un mois par barre pour l'année, jours du mois pour un mois", () => {
    const w = model().bars;
    expect(w.map((b) => b.label).join("")).toBe("LMMJVSD");
    expect(w[1].value).toBe(40); // mardi 3
    expect(w[6].value).toBe(30); // dimanche 8
    expect(buildRecapModel(acts, { kind: "year", today: TODAY }).bars).toHaveLength(12);
    expect(buildRecapModel(acts, { kind: "month", today: TODAY }).bars).toHaveLength(30);
  });
  it("série de semaines", () => {
    expect(model().streak).toBe(3);
  });
  it("aucune coordonnée ni nom de sortie dans le modèle", () => {
    const json = JSON.stringify(buildRecapModel([{ ...ride(2026, 11, 3, 10, 1000, 0), name: "Secret", gpsTrack: [{ lat: 45.1234, lon: 6.5678 }] }], { today: TODAY }));
    expect(json).not.toContain("Secret");
    expect(json).not.toContain("45.1234");
  });
  it("accent invalide, police inconnue, réglages bornés", () => {
    const m = model({ accent: "red", font: "nope", textScale: 99 });
    expect(m.accent).toBeNull();
    expect(m.adjust.textScale).toBeLessThanOrEqual(1.25);
  });
});

describe("dessin", () => {
  it("écrit la période, le chiffre vedette et la variation", () => {
    const t = texts(model());
    expect(t).toContain("70,0");
    expect(t).toContain("+40 %");
    expect(t).toContain("CYCLING OS");
    expect(t.some((x) => /semaines? d'affilée/.test(x))).toBe(true);
  });
  it("les éléments se masquent à la demande", () => {
    const t = texts(model({ hiddenParts: RECAP_PARTS.map((p) => p.key) }));
    expect(t).not.toContain("CYCLING OS");
    expect(t).not.toContain("+40 %");
    expect(t.some((x) => /d'affilée/.test(x))).toBe(false);
  });
  it("tous les formats et fonds se dessinent à la bonne taille, transparent sans fond plein", () => {
    for (const format of ["story", "square", "sticker"]) {
      for (const theme of ["dark", "light", "sunset", "transparent"]) {
        const m = model({ format, theme });
        const canvas = createCanvas(10, 10);
        expect(renderRecapCard(canvas, m)).toBe(true);
        expect([canvas.width, canvas.height]).toEqual([m.width, m.height]);
        const c = loggingCtx(); drawRecapCard(c, m);
        expect(c.log.some((l) => l[0] === "clearRect")).toBe(theme === "transparent");
      }
    }
  });
  it("tout reste dans l'image (graduations et blocs)", () => {
    for (const format of ["story", "square", "sticker"]) {
      const m = model({ format });
      const l = m.layout;
      expect(l.chart.y + l.chart.h).toBeLessThanOrEqual(l.streakY - 20);
      expect(l.streakY).toBeLessThanOrEqual(m.height - 20);
      expect(l.statsY + l.rowGap * (Math.ceil(m.stats.length / l.cols) - 1) + 100).toBeLessThan(l.chart.y + 30);
    }
  });
});

describe("nom de fichier", () => {
  it("période, date de début et format", () => {
    expect(recapFileName("week", new Date(2026, 10, 2), "story", "dark")).toBe("cycling-os-recap-week-2026-11-02-story.png");
    expect(recapFileName("month", new Date(2026, 10, 1), "square", "transparent")).toBe("cycling-os-recap-month-2026-11-01-square-transparent.png");
  });
});
