import { describe, it, expect } from "vitest";
import { computeAnalysis, computeHRZones } from "./analysis.js";

function point(lat, lon, { ele = null, t = null, hr = null, cad = null, power = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad, power, temp: null };
}

describe("computeAnalysis", () => {
  it("calcule distance, vitesse et flags sur un trajet simple avec temps", () => {
    // 5 points alignés sur un méridien, écartés de ~0.001° (~111 m), 60 s d'intervalle.
    const points = [0, 1, 2, 3, 4].map((i) => point(i * 0.001, 0, { t: i * 60 }));
    const a = computeAnalysis(points);

    expect(a.hasTime).toBe(true);
    expect(a.hasEle).toBe(false);
    expect(a.hasHR).toBe(false);
    expect(a.n).toBe(5);
    expect(a.totalDistanceKm).toBeGreaterThan(0);
    expect(a.totalTimeSec).toBe(240);
    // Pas d'arrêt : vitesse constante et raisonnable pour ~0.444 km en 4 min.
    expect(a.avgSpeedKmh).toBeGreaterThan(0);
    expect(a.stops).toEqual([]);
  });

  it("calcule le dénivelé positif/négatif quand l'altitude est présente", () => {
    const eles = [100, 110, 120, 115, 105];
    const points = eles.map((e, i) => point(i * 0.001, 0, { ele: e, t: i * 30 }));
    const a = computeAnalysis(points);

    expect(a.hasEle).toBe(true);
    expect(a.elevGain).toBeGreaterThan(0);
    expect(a.elevLoss).toBeGreaterThan(0);
    expect(a.maxEle).not.toBeNull();
    expect(a.minEle).not.toBeNull();
  });

  it("détecte un arrêt prolongé (vitesse quasi nulle > 20 s)", () => {
    const points = [];
    // Roulage
    for (let i = 0; i < 5; i++) points.push(point(i * 0.002, 0, { t: i * 10 }));
    // Arrêt : même position pendant 80 s (assez long pour absorber le lissage aux bords).
    const last = points[points.length - 1];
    for (let i = 1; i <= 8; i++) points.push(point(last.lat, last.lon, { t: last.time.getTime() / 1000 + i * 10 }));
    const a = computeAnalysis(points);

    expect(a.stops.length).toBeGreaterThan(0);
    expect(a.stoppedTimeSec).toBeGreaterThan(0);
  });

  it("détecte une montée significative (pente et dénivelé suffisants)", () => {
    const points = [];
    // 40 points sur ~1.2 km avec un dénivelé de 60 m (~5 % de moyenne).
    for (let i = 0; i <= 40; i++) {
      const distFrac = i / 40;
      points.push(
        point(distFrac * 0.011, 0, {
          ele: 100 + distFrac * 60,
          t: i * 15,
        })
      );
    }
    const a = computeAnalysis(points);

    expect(a.climbs.length).toBeGreaterThan(0);
    expect(a.climbs[0].gain).toBeGreaterThan(25);
    expect(a.climbs[0].avgGrade).toBeGreaterThan(2.5);
  });

  it("estime la puissance à partir de la vitesse/pente quand aucun capteur n'est présent", () => {
    const points = [];
    for (let i = 0; i <= 20; i++) {
      points.push(point(i * 0.001, 0, { ele: 100 + i, t: i * 10 }));
    }
    const a = computeAnalysis(points, { weight: 75, bikeWeight: 8 });

    expect(a.hasPower).toBe(true);
    expect(a.isEstimatedPower).toBe(true);
    expect(a.powerStats.avg).toBeGreaterThan(0);
  });

  it("ne fabrique aucune donnée manquante (FC/cadence restent null si absentes)", () => {
    const points = [0, 1, 2].map((i) => point(i * 0.001, 0, { t: i * 30 }));
    const a = computeAnalysis(points);

    expect(a.hasHR).toBe(false);
    expect(a.hrStats).toBeNull();
    expect(a.hasCad).toBe(false);
    expect(a.cadStats).toBeNull();
  });
});

describe("computeHRZones", () => {
  it("retourne null sans FC ou sans temps", () => {
    const points = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 30 }));
    const a = computeAnalysis(points);
    expect(computeHRZones(a, 190, [])).toBeNull();
  });

  it("répartit le temps dans les bonnes zones de FC", () => {
    const bounds = [
      { name: "Z1", min: 0, max: 60 },
      { name: "Z2", min: 60, max: 100 },
    ];
    // FC à 50 % de maxHR (Z1) pendant 30 s, puis 80 % (Z2) pendant 30 s.
    const points = [
      point(0, 0, { t: 0, hr: 95 }),
      point(0.0003, 0, { t: 30, hr: 95 }),
      point(0.0006, 0, { t: 60, hr: 152 }),
    ];
    const a = computeAnalysis(points);
    const zones = computeHRZones(a, 190, bounds);

    expect(zones.find((z) => z.name === "Z1").time).toBeCloseTo(30, 6);
    expect(zones.find((z) => z.name === "Z2").time).toBeCloseTo(30, 6);
  });
});
