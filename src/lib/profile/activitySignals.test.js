import { describe, it, expect } from "vitest";
import { deriveActivitySignals, deriveAllActivitySignals } from "./activitySignals.js";

function point(lat, lon, { ele = null, t = null, power = null, hr = null, cad = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad, power, temp: null };
}

function activityFromPoints(points, overrides = {}) {
  const samples = points.map((p) => ({
    timestamp: p.time ? p.time.toISOString() : null,
    latitude: p.lat,
    longitude: p.lon,
    altitude: p.ele,
    speed: null,
    heartRate: p.hr,
    cadence: p.cad,
    power: p.power,
    temperature: p.temp,
    distanceMeasured: null,
    speedMeasured: null,
  }));
  return {
    id: overrides.id || "activity-1",
    date: points[0].time ? points[0].time.toISOString() : null,
    sportType: overrides.sportType || "cycling",
    distance: overrides.distance ?? null,
    duration: overrides.duration ?? null,
    movingTime: overrides.movingTime ?? null,
    elevationGain: overrides.elevationGain ?? null,
    avgSpeed: overrides.avgSpeed ?? null,
    avgPower: overrides.avgPower ?? null,
    normalizedPower: overrides.normalizedPower ?? null,
    flags: {
      hasGps: true,
      hasElevation: points.some((p) => p.ele != null),
      hasTime: points.every((p) => p.time != null),
      hasHeartRate: points.some((p) => p.hr != null),
      hasCadence: points.some((p) => p.cad != null),
      hasPower: points.some((p) => p.power != null),
      hasTemperature: false,
      powerEstimated: overrides.powerEstimated ?? false,
      hasMeasuredDistance: false,
      hasMeasuredSpeed: false,
    },
    samples,
    gpsTrack: points.map((p) => ({ lat: p.lat, lon: p.lon })),
  };
}

describe("deriveActivitySignals", () => {
  it("dégrade proprement sans samples (résumé léger d'index)", () => {
    const activity = {
      id: "summary-1",
      date: "2026-05-01T10:00:00Z",
      distance: 42,
      duration: 5400,
      movingTime: 5000,
      elevationGain: 300,
      avgSpeed: 28,
      avgPower: null,
      flags: { hasPower: false, powerEstimated: false, hasHeartRate: false, hasCadence: false },
    };
    const signals = deriveActivitySignals(activity);
    expect(signals.hasSamples).toBe(false);
    expect(signals.climbs).toEqual([]);
    expect(signals.efforts).toEqual([]);
    expect(signals.effortsAnalyzed).toBe(false);
    // Les agrégats déjà connus au niveau de l'activité restent disponibles.
    expect(signals.distanceKm).toBe(42);
    expect(signals.elevationGainM).toBe(300);
  });

  it("dégrade proprement avec moins de 2 points GPS exploitables", () => {
    const activity = activityFromPoints([point(45, 5, { t: 0 })]);
    const signals = deriveActivitySignals(activity);
    expect(signals.climbs).toEqual([]);
    expect(signals.efforts).toEqual([]);
  });

  it("reconstruit une montée depuis samples sans reparser de fichier source", () => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      points.push(point(f * 0.011, 0, { ele: 100 + f * 60, t: i * 15 })); // ~1.2 km, +60 m
    }
    const activity = activityFromPoints(points, { elevationGain: 60 });
    const signals = deriveActivitySignals(activity);
    expect(signals.hasSamples).toBe(true);
    expect(signals.climbs.length).toBeGreaterThan(0);
    expect(signals.climbs[0].gainM).toBeGreaterThan(25);
  });

  it("étiquette la puissance des efforts détectés comme 'estimated' quand l'activité a powerEstimated=true", () => {
    const points = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 10) points.push(point(i * 0.0005, 0, { t, power: 100 }));
    for (let i = 0; i < 9; i++, t += 10) points.push(point(0.005 + i * 0.001, 0, { t, power: 320 }));
    for (let i = 0; i < 10; i++, t += 10) points.push(point(0.015 + i * 0.0005, 0, { t, power: 100 }));

    const activity = activityFromPoints(points, { powerEstimated: true });
    const signals = deriveActivitySignals(activity);
    expect(signals.powerSource).toBe("estimated");
    expect(signals.efforts.length).toBe(1);
    expect(signals.efforts[0].powerSource).toBe("estimated");
    // Puissance estimée : jamais de meilleurs efforts de puissance (réservés au mesuré, voir dimensions/sprint.js)
    expect(signals.bestPowerEfforts).toBeNull();
  });

  it("calcule bestPowerEfforts UNIQUEMENT quand la puissance est mesurée", () => {
    const points = [];
    let t = 0;
    for (let i = 0; i < 120; i++, t += 1) points.push(point(i * 0.00003, 0, { t, power: 150 + (i % 20) * 5 }));

    const activityMeasured = activityFromPoints(points, { powerEstimated: false, id: "measured" });
    const measuredSignals = deriveActivitySignals(activityMeasured);
    expect(measuredSignals.powerSource).toBe("measured");
    expect(measuredSignals.bestPowerEfforts).not.toBeNull();
    expect(measuredSignals.bestPowerEfforts.s5).toBeDefined();

    const activityEstimated = activityFromPoints(points, { powerEstimated: true, id: "estimated" });
    const estimatedSignals = deriveActivitySignals(activityEstimated);
    expect(estimatedSignals.bestPowerEfforts).toBeNull();
  });

  it("ne plante jamais sur une série corrompue", () => {
    const activity = activityFromPoints([point(NaN, NaN, { t: 0 }), point(45, 5, { t: 10 })]);
    expect(() => deriveActivitySignals(activity)).not.toThrow();
  });
});

describe("deriveAllActivitySignals", () => {
  it("retourne un tableau vide pour une liste vide", () => {
    expect(deriveAllActivitySignals([])).toEqual([]);
    expect(deriveAllActivitySignals(undefined)).toEqual([]);
  });
});
