import { describe, it, expect } from "vitest";
import { computeAnalysis } from "./analysis.js";
import { toActivity } from "./normalize.js";

function point(lat, lon, { ele = null, t = null, hr = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad: null, power: null, temp: null };
}

describe("toActivity", () => {
  it("copie les métriques calculées et laisse null ce qui n'est pas mesuré", () => {
    const points = [0, 1, 2, 3].map((i) => point(i * 0.001, 0, { ele: 100 + i, t: i * 30 }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points, { name: "Sortie test", originalFilename: "sortie.gpx" });

    expect(activity.name).toBe("Sortie test");
    expect(activity.source.originalFilename).toBe("sortie.gpx");
    expect(activity.source.type).toBe("gpx");
    expect(activity.distance).toBe(analysis.totalDistanceKm);
    expect(activity.elevationGain).toBe(analysis.elevGain);

    // Aucune FC dans le fichier source : ne doit jamais être inventée.
    expect(activity.avgHeartRate).toBeNull();
    expect(activity.maxHeartRate).toBeNull();
    expect(activity.flags.hasHeartRate).toBe(false);
  });

  it("distingue puissance mesurée et estimée via flags.powerEstimated", () => {
    const points = [0, 1, 2, 3, 4].map((i) => point(i * 0.001, 0, { ele: 100 + i * 2, t: i * 10 }));
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points);

    expect(activity.flags.hasPower).toBe(true);
    expect(activity.flags.powerEstimated).toBe(true);
    expect(activity.avgPower).toBeGreaterThan(0);
  });

  it("conserve un id fourni explicitement (recalcul d'une sortie existante)", () => {
    const points = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 30 }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points, { id: "fixed-id-123" });
    expect(activity.id).toBe("fixed-id-123");
  });

  it("construit gpsTrack et samples avec la même longueur que les points sources", () => {
    const points = [0, 1, 2].map((i) => point(i * 0.001, 0, { ele: 50 + i, t: i * 20, hr: 130 + i }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points);

    expect(activity.gpsTrack).toHaveLength(points.length);
    expect(activity.samples).toHaveLength(points.length);
    expect(activity.samples[0].latitude).toBe(points[0].lat);
    expect(activity.samples[0].heartRate).toBe(130);
  });

  it("laisse date=null quand le fichier source n'a pas d'horodatage", () => {
    const points = [point(0, 0, { ele: 10 }), point(0.001, 0, { ele: 12 })];
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points);
    expect(activity.date).toBeNull();
  });
});
