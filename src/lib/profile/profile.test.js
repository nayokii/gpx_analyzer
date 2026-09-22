import { describe, it, expect } from "vitest";
import { computeCyclistProfile, buildProfileTimeline, PROFILE_VERSION } from "./profile.js";

function point(lat, lon, { ele = null, t = null, power = null, hr = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad: null, power, temp: null };
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
  const distanceKm = overrides.distance ?? null;
  return {
    id: overrides.id || `activity-${Math.random().toString(36).slice(2)}`,
    date: overrides.date ?? (points[0].time ? points[0].time.toISOString() : null),
    sportType: overrides.sportType || "cycling",
    distance: distanceKm,
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
      hasCadence: false,
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

function longRide({ id, dateIso, hours = 2 }) {
  const points = [];
  const n = 200;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    points.push(point(f * 0.3, 0, { t: f * hours * 3600 }));
  }
  const startTime = new Date(dateIso).getTime() / 1000;
  const shifted = points.map((p) => ({ ...p, time: new Date((startTime + (p.time ? p.time.getTime() / 1000 : 0)) * 1000) }));
  return activityFromPoints(shifted, { id, date: dateIso, movingTime: hours * 3600, duration: hours * 3600 });
}

describe("computeCyclistProfile", () => {
  it("fonctionne avec un historique vide, sans erreur", () => {
    const profile = computeCyclistProfile([]);
    expect(profile.activityCount).toBe(0);
    expect(profile.version).toBe(PROFILE_VERSION);
    for (const dim of Object.values(profile.dimensions)) {
      expect(dim.value).toBeNull();
      expect(dim.confidenceLabel).toBe("insufficient_data");
    }
    expect(profile.overallConfidence).toBeNull();
  });

  it("fonctionne avec une seule activité (cold start) sans exception", () => {
    const activity = longRide({ id: "a", dateIso: "2026-06-01T08:00:00.000Z", hours: 1.5 });
    const profile = computeCyclistProfile([activity]);
    expect(profile.activityCount).toBe(1);
    expect(profile.dimensions.endurance.value).not.toBeNull();
    expect(profile.dimensions.endurance.confidenceLabel).not.toBe("high");
    // Pas de puissance mesurée dans cette activité synthétique -> sprint reste insuffisant.
    expect(profile.dimensions.sprint.value).toBeNull();
  });

  it("le profil est sérialisable en JSON sans perte (pas de undefined/fonctions résiduelles)", () => {
    const activity = longRide({ id: "a", dateIso: "2026-06-01T08:00:00.000Z", hours: 1 });
    const profile = computeCyclistProfile([activity]);
    const roundTripped = JSON.parse(JSON.stringify(profile));
    expect(roundTripped.dimensions.endurance.value).toBe(profile.dimensions.endurance.value);
  });

  it("dataAvailability reflète fidèlement measured/estimated/absent", () => {
    const measured = longRide({ id: "m", dateIso: "2026-06-01T08:00:00.000Z" });
    measured.flags.hasPower = true;
    measured.flags.powerEstimated = false;
    const estimated = longRide({ id: "e", dateIso: "2026-06-08T08:00:00.000Z" });
    estimated.flags.hasPower = true;
    estimated.flags.powerEstimated = true;

    const profile = computeCyclistProfile([measured, estimated]);
    expect(profile.dataAvailability.withMeasuredPower).toBe(1);
    expect(profile.dataAvailability.withEstimatedPower).toBe(1);
  });

  it("plus d'historique augmente généralement la confiance globale (pas garanti mécaniquement, mais vérifié ici)", () => {
    const one = computeCyclistProfile([longRide({ id: "a", dateIso: "2026-06-01T08:00:00.000Z" })]);
    const many = computeCyclistProfile(
      Array.from({ length: 10 }, (_, i) =>
        longRide({ id: `a${i}`, dateIso: `2026-0${(i % 9) + 1}-0${(i % 8) + 1}T08:00:00.000Z` })
      )
    );
    expect(many.overallConfidence).toBeGreaterThan(one.overallConfidence);
  });
});

describe("buildProfileTimeline", () => {
  it("retourne un tableau vide sans activité datée", () => {
    expect(buildProfileTimeline([])).toEqual([]);
  });

  it("produit un point par mois calendaire couvert, trié chronologiquement", () => {
    const activities = [
      longRide({ id: "a", dateIso: "2026-06-05T08:00:00.000Z" }),
      longRide({ id: "b", dateIso: "2026-07-10T08:00:00.000Z" }),
      longRide({ id: "c", dateIso: "2026-09-20T08:00:00.000Z" }),
    ];
    const timeline = buildProfileTimeline(activities, { bucket: "month" });
    expect(timeline.map((t) => t.date)).toEqual(["2026-06", "2026-07", "2026-09"]);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].date > timeline[i - 1].date).toBe(true);
    }
  });

  it("est cumulatif par défaut : le nombre d'activités croît à chaque point", () => {
    const activities = [
      longRide({ id: "a", dateIso: "2026-06-05T08:00:00.000Z" }),
      longRide({ id: "b", dateIso: "2026-07-10T08:00:00.000Z" }),
      longRide({ id: "c", dateIso: "2026-08-20T08:00:00.000Z" }),
    ];
    const timeline = buildProfileTimeline(activities);
    expect(timeline.map((t) => t.activityCountAtPoint)).toEqual([1, 2, 3]);
  });

  it("cumulative: false isole les activités de chaque bucket", () => {
    const activities = [
      longRide({ id: "a", dateIso: "2026-06-05T08:00:00.000Z" }),
      longRide({ id: "b", dateIso: "2026-07-10T08:00:00.000Z" }),
    ];
    const timeline = buildProfileTimeline(activities, { cumulative: false });
    expect(timeline.map((t) => t.activityCountAtPoint)).toEqual([1, 1]);
  });
});
