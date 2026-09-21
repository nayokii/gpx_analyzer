import { describe, it, expect } from "vitest";
import { computeAnalysis } from "../analysis.js";
import { computeClimbs } from "./climbs.js";

function point(lat, lon, ele, t) {
  return { lat, lon, ele, time: new Date(t * 1000), hr: null, cad: null, power: null, temp: null };
}

describe("computeClimbs", () => {
  it("adapte analysis.climbs (une montée) sans réinventer la détection", () => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      points.push(point(f * 0.011, 0, 100 + f * 60, i * 15)); // ~1.2 km, +60 m
    }
    const analysis = computeAnalysis(points);
    expect(analysis.climbs.length).toBeGreaterThan(0); // pré-condition

    const climbs = computeClimbs(analysis);
    expect(climbs).toHaveLength(analysis.climbs.length);
    const c = climbs[0];
    const raw = analysis.climbs[0];
    expect(c.gainM).toBe(raw.gain);
    expect(c.avgGrade).toBe(raw.avgGrade);
    expect(c.maxGrade).toBe(raw.maxGrade);
    expect(c.distanceM).toBeCloseTo(raw.lengthKm * 1000, 6);
    expect(c.durationSec).toBe(raw.duration);
    expect(c.startTime).toBeInstanceOf(Date);
    expect(c.endTime).toBeInstanceOf(Date);
    expect(c.endTime.getTime()).toBeGreaterThan(c.startTime.getTime());
  });

  it("détecte plusieurs montées séparées sur un profil vallonné", () => {
    const points = [];
    let lon = 0;
    let t = 0;

    function climb(gainM, nPoints) {
      const startEle = 100;
      for (let i = 0; i <= nPoints; i++) {
        const f = i / nPoints;
        lon += 0.011 / nPoints;
        t += 15;
        points.push(point(lon, 0, startEle + f * gainM, t));
      }
    }
    function descendAndFlatten(dropM, nPoints) {
      const base = points[points.length - 1].ele;
      for (let i = 0; i <= nPoints; i++) {
        const f = i / nPoints;
        lon += 0.02 / nPoints; // grande distance pour ne pas fusionner avec la montée suivante (> 150 m)
        t += 15;
        points.push(point(lon, 0, base - f * dropM, t));
      }
    }

    points.push(point(0, 0, 100, 0));
    climb(60, 40);
    descendAndFlatten(60, 15);
    climb(50, 35);
    descendAndFlatten(50, 15);
    climb(70, 45);

    const analysis = computeAnalysis(points);
    expect(analysis.climbs.length).toBeGreaterThanOrEqual(2); // pré-condition : profil bien vallonné

    const climbs = computeClimbs(analysis);
    expect(climbs).toHaveLength(analysis.climbs.length);
    // Les montées doivent être ordonnées chronologiquement et ne pas se chevaucher.
    for (let i = 1; i < climbs.length; i++) {
      expect(climbs[i].startTime.getTime()).toBeGreaterThanOrEqual(climbs[i - 1].endTime.getTime());
    }
  });

  it("retourne un tableau vide sans altitude", () => {
    const points = [point(0, 0, null, 0), point(0.001, 0, null, 10)];
    // computeAnalysis lira ele=null -> hasEle=false -> pas de montées possibles
    const analysis = computeAnalysis(points.map((p) => ({ ...p, ele: null })));
    expect(computeClimbs(analysis)).toEqual([]);
  });
});
