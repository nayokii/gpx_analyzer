import { describe, it, expect } from "vitest";
import {
  estimatePower,
  computeBestPowerEfforts,
  computePowerZones,
  computeNormalizedPower,
  computeVariabilityIndex,
  computeIntensityFactor,
  computeTSS,
} from "./power.js";

describe("estimatePower", () => {
  it("retourne 0 à l'arrêt sans pente ni accélération", () => {
    expect(estimatePower(0, 0, 75, 8)).toBe(0);
  });

  it("augmente avec la vitesse à plat", () => {
    const p20 = estimatePower(20, 0, 75, 8);
    const p35 = estimatePower(35, 0, 75, 8);
    expect(p35).toBeGreaterThan(p20);
  });

  it("demande plus de puissance en montée qu'en descente à vitesse égale", () => {
    const uphill = estimatePower(20, 6, 75, 8);
    const downhill = estimatePower(20, -6, 75, 8);
    expect(uphill).toBeGreaterThan(downhill);
  });

  it("demande plus de puissance en accélérant qu'à vitesse stable", () => {
    const steady = estimatePower(25, 0, 75, 8, 0, 0);
    const accelerating = estimatePower(25, 0, 75, 8, 0, 1.5);
    expect(accelerating).toBeGreaterThan(steady);
  });
});

describe("computeBestPowerEfforts", () => {
  it("identifie la fenêtre de puissance moyenne maximale pour une durée donnée", () => {
    // 10 points à 1 Hz : puissance élevée entre t=3 et t=6.
    const series = [100, 100, 100, 300, 300, 300, 300, 100, 100, 100].map((power, i) => ({
      elapsed: i,
      power,
    }));
    const result = computeBestPowerEfforts(series, [3]);
    expect(result.s3).toBeDefined();
    expect(result.s3.power).toBeCloseTo(300, 6);
    expect(result.s3.startIdx).toBe(3);
  });

  it("ignore les durées trop longues pour la série fournie", () => {
    const series = [{ elapsed: 0, power: 100 }, { elapsed: 1, power: 100 }];
    const result = computeBestPowerEfforts(series, [3600]);
    expect(result.s3600).toBeUndefined();
  });
});

describe("computePowerZones", () => {
  it("retourne null sans FTP valide", () => {
    expect(computePowerZones([{ elapsed: 0, power: 100 }], 0)).toBeNull();
    expect(computePowerZones([{ elapsed: 0, power: 100 }], null)).toBeNull();
  });

  it("répartit le temps dans la zone correspondant au ratio puissance/FTP", () => {
    const ftp = 200;
    // 100 % FTP pendant 10 s puis 65 % FTP pendant 10 s.
    const series = [
      { elapsed: 0, power: 200 },
      { elapsed: 10, power: 200 },
      { elapsed: 20, power: 130 },
    ];
    const zones = computePowerZones(series, ftp);
    const z4 = zones.find((z) => z.name === "Z4 Seuil"); // 0.90 - 1.05
    const z2 = zones.find((z) => z.name === "Z2 Endurance"); // 0.55 - 0.75
    expect(z4.time).toBeCloseTo(10, 6);
    expect(z2.time).toBeCloseTo(10, 6);
  });
});

describe("computeNormalizedPower", () => {
  it("retourne la puissance constante elle-même pour un effort parfaitement régulier", () => {
    const series = Array.from({ length: 120 }, (_, i) => ({ elapsed: i, power: 200 }));
    expect(computeNormalizedPower(series)).toBeCloseTo(200, 6);
  });

  it("retourne null si la série est trop courte", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ elapsed: i, power: 200 }));
    expect(computeNormalizedPower(series)).toBeNull();
  });
});

describe("indicateurs dérivés (VI, IF, TSS)", () => {
  it("computeVariabilityIndex retourne NP/avgPower", () => {
    expect(computeVariabilityIndex(220, 200)).toBeCloseTo(1.1, 6);
    expect(computeVariabilityIndex(null, 200)).toBeNull();
  });

  it("computeIntensityFactor retourne NP/FTP", () => {
    expect(computeIntensityFactor(190, 250)).toBeCloseTo(0.76, 6);
    expect(computeIntensityFactor(190, 0)).toBeNull();
  });

  it("computeTSS suit la formule standard (1h à IF=1.0 => TSS=100)", () => {
    const tss = computeTSS(3600, 250, 250);
    expect(tss).toBeCloseTo(100, 6);
  });
});
