import { describe, it, expect } from "vitest";
import { computeAnalysis } from "./analysis.js";
import { toActivity } from "./normalize.js";

function point(lat, lon, { ele = null, t = null, hr = null, temp = null, distanceMeasured, speedMeasured } = {}) {
  return {
    lat, lon, ele,
    time: t != null ? new Date(t * 1000) : null,
    hr, cad: null, power: null, temp,
    distanceMeasured, speedMeasured,
  };
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

  it("copie la température dans les samples quand la source la fournit (ex. FIT)", () => {
    const points = [0, 1, 2].map((i) => point(i * 0.001, 0, { t: i * 10, temp: 25 }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points);

    expect(activity.flags.hasTemperature).toBe(true);
    expect(activity.samples.every((s) => s.temperature === 25)).toBe(true);
  });

  it("laisse temperature=null quand la source ne la fournit pas (GPX sans capteur)", () => {
    const points = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 10 }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points);

    expect(activity.flags.hasTemperature).toBe(false);
    expect(activity.samples.every((s) => s.temperature === null)).toBe(true);
  });

  it("distingue distance/vitesse mesurées (device) et calculées (notre moteur) sans jamais remplacer l'une par l'autre", () => {
    const points = [0, 1, 2].map((i) =>
      point(i * 0.001, 0, { t: i * 10, distanceMeasured: i * 0.1, speedMeasured: 20 + i })
    );
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points, {
      measured: { distanceKm: 0.2, avgSpeedKmh: 21, maxSpeedKmh: 22 },
    });

    // Les totaux calculés par notre moteur restent présents et inchangés.
    expect(activity.distance).toBe(analysis.totalDistanceKm);
    expect(activity.avgSpeed).toBe(analysis.avgSpeedKmh);

    // Les totaux mesurés par le device coexistent, sans écraser les calculés.
    expect(activity.distanceMeasured).toBe(0.2);
    expect(activity.avgSpeedMeasured).toBe(21);
    expect(activity.maxSpeedMeasured).toBe(22);
    expect(activity.flags.hasMeasuredDistance).toBe(true);
    expect(activity.flags.hasMeasuredSpeed).toBe(true);

    // Idem au niveau de chaque sample.
    expect(activity.samples[1].distanceMeasured).toBe(0.1);
    expect(activity.samples[1].speedMeasured).toBe(21);
    expect(activity.samples[1].speed).not.toBe(activity.samples[1].speedMeasured);
  });

  it("laisse les champs mesurés à null quand la source ne les fournit pas (GPX)", () => {
    const points = [0, 1].map((i) => point(i * 0.001, 0, { t: i * 10 }));
    const analysis = computeAnalysis(points);
    const activity = toActivity(analysis, points);

    expect(activity.distanceMeasured).toBeNull();
    expect(activity.avgSpeedMeasured).toBeNull();
    expect(activity.maxSpeedMeasured).toBeNull();
    expect(activity.flags.hasMeasuredDistance).toBe(false);
    expect(activity.flags.hasMeasuredSpeed).toBe(false);
    expect(activity.samples.every((s) => s.distanceMeasured === null && s.speedMeasured === null)).toBe(true);
  });
});
