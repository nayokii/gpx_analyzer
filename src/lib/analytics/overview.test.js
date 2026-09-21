import { describe, it, expect } from "vitest";
import { computeAnalysis } from "../analysis.js";
import { computeOverview } from "./overview.js";

function point(lat, lon, { ele = null, t = null, temp = null, distanceMeasured, speedMeasured } = {}) {
  return {
    lat, lon, ele,
    time: t != null ? new Date(t * 1000) : null,
    hr: null, cad: null, power: null, temp,
    distanceMeasured, speedMeasured,
  };
}

describe("computeOverview", () => {
  it("calcule distance/durée/vitesse/altitude sur une sortie normale", () => {
    const eles = [100, 110, 120, 115, 105];
    const points = eles.map((e, i) => point(i * 0.001, 0, { ele: e, t: i * 60 }));
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis);

    expect(o.distance.calculatedKm).toBe(analysis.totalDistanceKm);
    expect(o.distance.measuredKm).toBeNull(); // GPX : jamais fourni par la source
    expect(o.duration.totalSec).toBe(240);
    expect(o.speed.avgMovingKmh).toBe(analysis.avgSpeedKmh);
    expect(o.speed.maxKmh).toBe(analysis.maxSpeedKmh);
    expect(o.elevation.available).toBe(true);
    expect(o.elevation.gainM).toBeGreaterThan(0);
    expect(o.elevation.lossM).toBeGreaterThan(0);
  });

  it("distingue vitesse moyenne totale (arrêts inclus) et vitesse moyenne en mouvement", () => {
    // Roulage puis longue pause : la moyenne "totale" doit être nettement
    // inférieure à la moyenne "en mouvement".
    const points = [];
    for (let i = 0; i < 5; i++) points.push(point(i * 0.002, 0, { t: i * 10 }));
    const last = points[points.length - 1];
    for (let i = 1; i <= 10; i++) points.push(point(last.lat, last.lon, { t: last.time.getTime() / 1000 + i * 10 }));
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis);

    expect(o.speed.avgTotalKmh).toBeLessThan(o.speed.avgMovingKmh);
  });

  it("dérive distance/vitesse mesurées depuis les points quand la source les fournit (FIT)", () => {
    const points = [0, 1, 2, 3].map((i) =>
      point(i * 0.001, 0, { t: i * 10, distanceMeasured: i * 0.1, speedMeasured: 18 + i })
    );
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis);

    expect(o.distance.measuredKm).toBeCloseTo(0.3, 6); // dernière valeur cumulée
    expect(o.speed.avgMeasuredKmh).toBeCloseTo((18 + 19 + 20 + 21) / 4, 6);
    expect(o.speed.maxMeasuredKmh).toBe(21);
  });

  it("priorise les totaux mesurés explicites (ex. session FIT) sur la dérivation par point", () => {
    const points = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 10, distanceMeasured: i * 0.1, speedMeasured: 20 }));
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis, { measured: { distanceKm: 31.23099, avgSpeedKmh: 20.0088, maxSpeedKmh: 55.4364 } });

    expect(o.distance.measuredKm).toBe(31.23099);
    expect(o.speed.avgMeasuredKmh).toBe(20.0088);
    expect(o.speed.maxMeasuredKmh).toBe(55.4364);
  });

  it("laisse la durée/vitesse à null sans horodatage", () => {
    const points = [point(0, 0, { ele: 10 }), point(0.001, 0, { ele: 12 })];
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis);

    expect(o.duration.totalSec).toBeNull();
    expect(o.duration.movingSec).toBeNull();
    expect(o.speed.avgTotalKmh).toBeNull();
    expect(o.speed.avgMovingKmh).toBeNull();
  });

  it("laisse l'altitude à null/indisponible sans données d'altitude", () => {
    const points = [0, 1, 2].map((i) => point(i * 0.001, 0, { t: i * 10 }));
    const analysis = computeAnalysis(points);
    const o = computeOverview(analysis);

    expect(o.elevation.available).toBe(false);
    expect(o.elevation.gainM).toBeNull();
    expect(o.elevation.minM).toBeNull();
  });

  it("expose la température seulement si présente dans la source", () => {
    const withTemp = [0, 1, 2].map((i) => point(i * 0.001, 0, { t: i * 10, temp: 20 + i }));
    const oWith = computeOverview(computeAnalysis(withTemp));
    expect(oWith.temperature.available).toBe(true);
    expect(oWith.temperature.avgC).toBeCloseTo(21, 6);
    expect(oWith.temperature.minC).toBe(20);
    expect(oWith.temperature.maxC).toBe(22);

    const withoutTemp = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 10 }));
    const oWithout = computeOverview(computeAnalysis(withoutTemp));
    expect(oWithout.temperature.available).toBe(false);
    expect(oWithout.temperature.avgC).toBeNull();
  });
});
