import { describe, it, expect } from "vitest";
import { computeHistoryAnalytics, filterActivitiesByPeriod } from "./historyAnalytics.js";

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    movingTime: 5000,
    elevationGain: 300,
    elevationLoss: 280,
    avgSpeed: 21.6,
    maxSpeed: 45,
    avgPower: null,
    maxPower: null,
    avgHeartRate: null,
    maxHeartRate: null,
    avgCadence: null,
    maxCadence: null,
    flags: { hasHeartRate: false, hasCadence: false, hasPower: false, powerEstimated: false },
    ...overrides,
  };
}

describe("computeHistoryAnalytics — 0/1/plusieurs activités", () => {
  it("gère une liste vide sans planter et sans fabriquer de valeur", () => {
    const r = computeHistoryAnalytics([]);
    expect(r.count).toBe(0);
    expect(r.totals.distanceKm).toBe(0);
    expect(r.totals.durationSec).toBeNull();
    expect(r.averages.speedKmh).toBeNull();
    expect(r.averages.powerW).toBeNull();
    expect(r.sensorCoverage).toEqual({ withHeartRate: 0, withCadence: 0, withRealPower: 0, withEstimatedPower: 0 });
  });

  it("gère une seule activité", () => {
    const r = computeHistoryAnalytics([activity()]);
    expect(r.count).toBe(1);
    expect(r.totals.distanceKm).toBe(30);
    expect(r.totals.durationSec).toBe(5400);
  });

  it("agrège plusieurs activités (distance, durée, D+, D-, nombre de sorties)", () => {
    const activities = [
      activity({ id: "a1", distance: 30, duration: 5400, movingTime: 5000, elevationGain: 300, elevationLoss: 280 }),
      activity({ id: "a2", distance: 50, duration: 9000, movingTime: 8500, elevationGain: 600, elevationLoss: 590 }),
    ];
    const r = computeHistoryAnalytics(activities);
    expect(r.count).toBe(2);
    expect(r.totals.distanceKm).toBe(80);
    expect(r.totals.durationSec).toBe(14400);
    expect(r.totals.movingTimeSec).toBe(13500);
    expect(r.totals.elevationGainM).toBe(900);
    expect(r.totals.elevationLossM).toBe(870);
    expect(r.volume.count).toBe(2);
    expect(r.volume.distanceKm).toBe(80);
  });
});

describe("computeHistoryAnalytics — vitesse moyenne pondérée (jamais une moyenne simple des moyennes)", () => {
  it("pondère par le temps en mouvement plutôt que de moyenner les vitesses moyennes", () => {
    // Sortie A : 10 km en 1h (36 km/h). Sortie B : 100 km en 4h (25 km/h).
    // Moyenne simple des vitesses : (36+25)/2 = 30.5 km/h — FAUX.
    // Moyenne pondérée par le temps : 110 km / 5h = 22 km/h — attendu.
    const activities = [
      activity({ id: "a1", distance: 10, movingTime: 3600, avgSpeed: 36 }),
      activity({ id: "a2", distance: 100, movingTime: 14400, avgSpeed: 25 }),
    ];
    const r = computeHistoryAnalytics(activities);
    expect(r.averages.speedKmh).toBeCloseTo(22, 6);
    expect(r.averages.speedKmh).not.toBeCloseTo(30.5, 1);
    expect(r.averages.method).toMatch(/pondér/i);
  });

  it("pondère la puissance moyenne par la durée de chaque sortie", () => {
    const activities = [
      // movingTime explicitement absent : force le repli sur `duration` pour la pondération.
      activity({ id: "a1", duration: 1200, movingTime: null, avgPower: 300, flags: { hasPower: true, powerEstimated: false } }), // 20 min à 300W
      activity({ id: "a2", duration: 3600, movingTime: null, avgPower: 150, flags: { hasPower: true, powerEstimated: false } }), // 1h à 150W
    ];
    const r = computeHistoryAnalytics(activities);
    // (300*1200 + 150*3600) / (1200+3600) = (360000+540000)/4800 = 187.5
    expect(r.averages.powerW).toBeCloseTo(187.5, 6);
  });

  it("ignore les activités sans movingTime pour la vitesse pondérée (n'invente pas de poids)", () => {
    const activities = [activity({ id: "a1", distance: 30, movingTime: null, avgSpeed: 20 })];
    const r = computeHistoryAnalytics(activities);
    expect(r.averages.speedKmh).toBeNull();
  });
});

describe("computeHistoryAnalytics — couverture des capteurs", () => {
  it("compte séparément HR, cadence, puissance mesurée et estimée", () => {
    const activities = [
      activity({ id: "a1", flags: { hasHeartRate: true, hasCadence: false, hasPower: true, powerEstimated: false } }),
      activity({ id: "a2", flags: { hasHeartRate: false, hasCadence: true, hasPower: true, powerEstimated: true } }),
      activity({ id: "a3", flags: { hasHeartRate: true, hasCadence: true, hasPower: false, powerEstimated: false } }),
    ];
    const r = computeHistoryAnalytics(activities);
    expect(r.sensorCoverage).toEqual({ withHeartRate: 2, withCadence: 2, withRealPower: 1, withEstimatedPower: 1 });
  });
});

describe("computeHistoryAnalytics / filterActivitiesByPeriod — filtres de dates", () => {
  const ref = new Date("2026-09-20T12:00:00Z");
  const activities = [
    activity({ id: "recent", date: "2026-09-18T12:00:00Z" }), // 2 jours avant ref
    activity({ id: "mid", date: "2026-08-25T12:00:00Z" }),    // ~26 jours avant ref
    activity({ id: "old", date: "2026-01-01T12:00:00Z" }),    // ~8.5 mois avant ref
  ];

  it("période 7 jours ne garde que la plus récente", () => {
    const filtered = filterActivitiesByPeriod(activities, "7d", ref);
    expect(filtered.map((a) => a.id)).toEqual(["recent"]);
  });

  it("période 30 jours garde les deux plus récentes", () => {
    const filtered = filterActivitiesByPeriod(activities, "30d", ref);
    expect(filtered.map((a) => a.id).sort()).toEqual(["mid", "recent"]);
  });

  it("période 90 jours garde toujours les deux plus récentes (old est hors plage)", () => {
    const filtered = filterActivitiesByPeriod(activities, "90d", ref);
    expect(filtered.map((a) => a.id).sort()).toEqual(["mid", "recent"]);
  });

  it("période 'year' garde toutes les activités de l'exemple", () => {
    const filtered = filterActivitiesByPeriod(activities, "year", ref);
    expect(filtered).toHaveLength(3);
  });

  it("'all' ne filtre rien", () => {
    expect(filterActivitiesByPeriod(activities, "all", ref)).toHaveLength(3);
  });

  it("computeHistoryAnalytics applique le filtre de période de bout en bout", () => {
    const r = computeHistoryAnalytics(activities, { period: "7d", referenceDate: ref });
    expect(r.count).toBe(1);
    expect(r.period.key).toBe("7d");
  });

  it("exclut les activités sans date exploitable", () => {
    const withMissingDate = [...activities, activity({ id: "no-date", date: null })];
    const filtered = filterActivitiesByPeriod(withMissingDate, "7d", ref);
    expect(filtered.map((a) => a.id)).toEqual(["recent"]);
  });
});
