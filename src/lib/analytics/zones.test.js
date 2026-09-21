import { describe, it, expect } from "vitest";
import { computeAnalysis } from "../analysis.js";
import { computeZones, DEFAULT_HR_ZONE_BOUNDS } from "./zones.js";

function point(lat, lon, { t = null, power = null, hr = null, ele = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad: null, power, temp: null };
}

describe("computeZones — puissance", () => {
  it("répartit le temps dans les 7 zones standard et marque la source 'measured'", () => {
    const ftp = 200;
    const points = [
      point(0, 0, { t: 0, power: 200 }),
      point(0.001, 0, { t: 10, power: 200 }),
      point(0.002, 0, { t: 20, power: 130 }),
    ];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, { ftp });

    expect(z.power.available).toBe(true);
    expect(z.power.source).toBe("measured");
    expect(z.power.ftp).toBe(200);
    expect(z.power.zones).toHaveLength(7);
    const z4 = z.power.zones.find((x) => x.name === "Z4 Seuil");
    expect(z4.seconds).toBeCloseTo(10, 6);
    expect(z4.percentage).toBeGreaterThan(0);
  });

  it("marque la source 'estimated' quand la puissance vient du modèle physique", () => {
    const points = [];
    for (let i = 0; i <= 20; i++) points.push(point(i * 0.001, 0, { t: i * 10, ele: 100 + i }));
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    expect(analysis.isEstimatedPower).toBe(true); // pré-condition du test

    const z = computeZones(analysis, { ftp: 200 });
    expect(z.power.available).toBe(true);
    expect(z.power.source).toBe("estimated");
  });

  it("indique available=false sans FTP", () => {
    const points = [point(0, 0, { t: 0, power: 150 }), point(0.001, 0, { t: 10, power: 150 })];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, {});
    expect(z.power.available).toBe(false);
    expect(z.power.zones).toEqual([]);
  });

  it("indique available=false sans puissance du tout", () => {
    const points = [point(0, 0, { t: 0 }), point(0.001, 0, { t: 10 })];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, { ftp: 200 });
    expect(z.power.available).toBe(false);
  });
});

describe("computeZones — fréquence cardiaque", () => {
  it("répartit le temps dans les zones FC par défaut avec maxHR fourni", () => {
    const points = [
      point(0, 0, { t: 0, hr: 95 }),   // 50 % de 190 -> Z1
      point(0.001, 0, { t: 30, hr: 95 }),
      point(0.002, 0, { t: 60, hr: 152 }), // 80 % de 190 -> Z4
    ];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, { maxHR: 190 });

    expect(z.heartRate.available).toBe(true);
    expect(z.heartRate.maxHR).toBe(190);
    expect(z.heartRate.zones.map((x) => x.name)).toEqual(DEFAULT_HR_ZONE_BOUNDS.map((b) => b.name));
    const z1 = z.heartRate.zones.find((x) => x.name === "Z1 Récup");
    expect(z1.seconds).toBeCloseTo(30, 6);
  });

  it("indique available=false sans maxHR", () => {
    const points = [point(0, 0, { t: 0, hr: 130 }), point(0.001, 0, { t: 10, hr: 135 })];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, {});
    expect(z.heartRate.available).toBe(false);
  });

  it("indique available=false sans FC (FIT sans capteur, ex.)", () => {
    const points = [point(0, 0, { t: 0 }), point(0.001, 0, { t: 10 })];
    const analysis = computeAnalysis(points);
    const z = computeZones(analysis, { maxHR: 190 });
    expect(z.heartRate.available).toBe(false);
    expect(z.heartRate.zones).toEqual([]);
  });
});
