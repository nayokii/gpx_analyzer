import { describe, it, expect } from "vitest";
import { computeAnalysis } from "../analysis.js";
import { computePauses } from "./pauses.js";

function point(lat, lon, t) {
  return { lat, lon, ele: null, time: new Date(t * 1000), hr: null, cad: null, power: null, temp: null };
}

describe("computePauses", () => {
  it("ne fabrique aucune pause quand il n'y en a pas", () => {
    const points = [0, 1, 2, 3, 4].map((i) => point(i * 0.002, 0, i * 10));
    const analysis = computeAnalysis(points);
    const p = computePauses(analysis);

    expect(p.available).toBe(true);
    expect(p.count).toBe(0);
    expect(p.list).toEqual([]);
    expect(p.totalSec).toBe(0);
    expect(p.avgSec).toBeNull();
    expect(p.longestSec).toBeNull();
  });

  it("détecte une pause significative avec des timestamps réels", () => {
    const points = [];
    for (let i = 0; i < 5; i++) points.push(point(i * 0.002, 0, i * 10));
    const last = points[points.length - 1];
    for (let i = 1; i <= 8; i++) points.push(point(last.lat, last.lon, last.time.getTime() / 1000 + i * 10));
    const analysis = computeAnalysis(points);
    const p = computePauses(analysis);

    expect(p.available).toBe(true);
    expect(p.count).toBeGreaterThan(0);
    expect(p.list[0].startTime).toBeInstanceOf(Date);
    expect(p.list[0].endTime).toBeInstanceOf(Date);
    expect(p.list[0].durationSec).toBeGreaterThan(0);
    expect(p.longestSec).toBe(Math.max(...p.list.map((x) => x.durationSec)));
    expect(p.avgSec).toBeGreaterThan(0);
    expect(p.totalSec).toBe(analysis.stoppedTimeSec);
  });

  it("ignore les micro-ralentissements (pas assez longs pour être une pause)", () => {
    // Ralentissement bref (quelques secondes) : ne doit pas être compté.
    const points = [
      point(0, 0, 0),
      point(0.002, 0, 10),
      point(0.0021, 0, 15), // petit ralentissement de 5 s seulement
      point(0.004, 0, 25),
      point(0.006, 0, 35),
    ];
    const analysis = computeAnalysis(points);
    const p = computePauses(analysis);
    expect(p.count).toBe(0);
  });

  it("retourne available=false sans horodatage", () => {
    const points = [
      { lat: 0, lon: 0, ele: 10, time: null, hr: null, cad: null, power: null, temp: null },
      { lat: 0.001, lon: 0, ele: 12, time: null, hr: null, cad: null, power: null, temp: null },
    ];
    const analysis = computeAnalysis(points);
    const p = computePauses(analysis);
    expect(p.available).toBe(false);
    expect(p.list).toEqual([]);
  });
});
