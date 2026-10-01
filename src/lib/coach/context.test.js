import { describe, it, expect } from "vitest";
import { buildCoachContext, summarizeRide, formatCoachContextCompact, PROFILE_DIMENSION_KEYS } from "./context.js";

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    sportType: "cycling",
    source: { type: "fit", originalFilename: "ride.fit", storedFilename: null, sourceId: null, athleteId: null },
    analysisVersion: 1,
    distance: 30,
    distanceMeasured: null,
    duration: 5400,
    movingTime: 5200,
    elevationGain: 300,
    elevationLoss: 290,
    avgSpeed: 20,
    maxSpeed: 45,
    avgSpeedMeasured: null,
    maxSpeedMeasured: null,
    avgHeartRate: 140,
    maxHeartRate: 175,
    avgCadence: 80,
    maxCadence: 110,
    avgPower: 180,
    maxPower: 600,
    normalizedPower: 200,
    flags: {
      hasGps: true,
      hasElevation: true,
      hasTime: true,
      hasHeartRate: true,
      hasCadence: true,
      hasPower: true,
      hasTemperature: false,
      powerEstimated: false,
      hasMeasuredDistance: false,
      hasMeasuredSpeed: false,
    },
    gpsTrack: [],
    samples: [],
    ...overrides,
  };
}

describe("summarizeRide", () => {
  it("retourne null pour une activité absente", () => {
    expect(summarizeRide(null)).toBeNull();
  });

  it("recopie les champs déjà calculés sans les recalculer", () => {
    const ride = summarizeRide(activity());
    expect(ride.distanceKm).toBe(30);
    expect(ride.durationSec).toBe(5400);
    expect(ride.movingTimeSec).toBe(5200);
    expect(ride.elevationGainM).toBe(300);
    expect(ride.avgSpeedKmh).toBe(20);
    expect(ride.avgHeartRateBpm).toBe(140);
    expect(ride.avgCadenceRpm).toBe(80);
  });

  it("dérive le temps arrêté par simple soustraction (duration - movingTime)", () => {
    const ride = summarizeRide(activity({ duration: 5400, movingTime: 5200 }));
    expect(ride.stoppedTimeSec).toBe(200);
  });

  it("ne fabrique pas de temps arrêté si duration ou movingTime est absent", () => {
    expect(summarizeRide(activity({ duration: null })).stoppedTimeSec).toBeNull();
    expect(summarizeRide(activity({ movingTime: null })).stoppedTimeSec).toBeNull();
  });

  it("distingue puissance mesurée et estimée, jamais présentées comme équivalentes", () => {
    const measured = summarizeRide(activity({ flags: { ...activity().flags, hasPower: true, powerEstimated: false } }));
    expect(measured.power).toEqual({ available: true, source: "measured", avgW: 180, maxW: 600, normalizedW: 200 });

    const estimated = summarizeRide(activity({ flags: { ...activity().flags, hasPower: true, powerEstimated: true } }));
    expect(estimated.power.source).toBe("estimated");
  });

  it("ne fabrique aucune puissance quand la sortie n'en a pas", () => {
    const ride = summarizeRide(activity({ avgPower: null, maxPower: null, normalizedPower: null, flags: { ...activity().flags, hasPower: false } }));
    expect(ride.power).toEqual({ available: false, source: null, avgW: null, maxW: null, normalizedW: null });
  });

  it("calcule une température moyenne UNIQUEMENT à partir des échantillons déjà stockés (aucune donnée inventée)", () => {
    const ride = summarizeRide(
      activity({
        flags: { ...activity().flags, hasTemperature: true },
        samples: [{ temperature: 10 }, { temperature: 20 }, { temperature: null }],
      })
    );
    expect(ride.temperature).toEqual({ available: true, avgC: 15 });
  });

  it("température indisponible si le flag est faux, même avec des échantillons", () => {
    const ride = summarizeRide(activity({ flags: { ...activity().flags, hasTemperature: false }, samples: [{ temperature: 10 }] }));
    expect(ride.temperature).toEqual({ available: false, avgC: null });
  });
});

describe("buildCoachContext", () => {
  it("ne plante jamais sans activité, et ne fabrique rien", () => {
    const ctx = buildCoachContext([]);
    expect(ctx.activityCount).toBe(0);
    expect(ctx.lastRide).toBeNull();
    expect(ctx.recentRides).toEqual([]);
    expect(ctx.profile.activityCount).toBe(0);
    expect(ctx.records).toEqual([]);
  });

  it("expose la dernière sortie et les N sorties les plus récentes, triées, indépendamment de l'ordre d'entrée", () => {
    const activities = [
      activity({ id: "old", date: "2026-01-01T00:00:00.000Z" }),
      activity({ id: "newest", date: "2026-09-20T00:00:00.000Z" }),
      activity({ id: "middle", date: "2026-05-01T00:00:00.000Z" }),
    ];
    const ctx = buildCoachContext(activities, { recentCount: 2 });
    expect(ctx.lastRide.id).toBe("newest");
    expect(ctx.recentRides.map((r) => r.id)).toEqual(["newest", "middle"]);
  });

  it("relègue les activités sans date connue en fin de tri, sans jamais les traiter comme les plus récentes", () => {
    const activities = [
      activity({ id: "dated", date: "2026-01-01T00:00:00.000Z" }),
      activity({ id: "undated", date: null }),
    ];
    const ctx = buildCoachContext(activities);
    expect(ctx.lastRide.id).toBe("dated");
  });

  it("respecte recentCount (ex. 10)", () => {
    const activities = Array.from({ length: 12 }, (_, i) =>
      activity({ id: `a${i}`, date: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` })
    );
    const ctx = buildCoachContext(activities, { recentCount: 10 });
    expect(ctx.recentRides).toHaveLength(10);
  });

  it("expose les 7 dimensions du profil, jamais moins", () => {
    const ctx = buildCoachContext([activity()]);
    expect(Object.keys(ctx.profile.dimensions).sort()).toEqual([...PROFILE_DIMENSION_KEYS].sort());
  });

  it("inclut progression (niveau/titre/xp/challenges) et records sans erreur avec un historique réel", () => {
    const activities = [
      activity({ id: "a", date: "2026-01-01T00:00:00.000Z", distance: 20 }),
      activity({ id: "b", date: "2026-02-01T00:00:00.000Z", distance: 80, elevationGain: 1200 }),
    ];
    const ctx = buildCoachContext(activities);
    expect(typeof ctx.progression.level).toBe("number");
    expect(typeof ctx.progression.xp).toBe("number");
    expect(Array.isArray(ctx.progression.challenges)).toBe(true);
    expect(ctx.records.find((r) => r.type === "longest_distance")).toEqual(
      expect.objectContaining({ activityId: "b", value: 80 })
    );
  });

  it("ne mute jamais le tableau d'activités fourni en entrée", () => {
    const activities = [activity({ id: "a" }), activity({ id: "b", date: "2026-01-01T00:00:00.000Z" })];
    const snapshot = JSON.stringify(activities);
    buildCoachContext(activities);
    expect(JSON.stringify(activities)).toBe(snapshot);
  });
});

describe("buildCoachContext — V2 : lastRideDetail (montées/efforts/arrêts)", () => {
  function samplePoint(lat, lon, ele, tSec) {
    return { timestamp: new Date(tSec * 1000).toISOString(), latitude: lat, longitude: lon, altitude: ele, speed: null, heartRate: null, cadence: null, power: null, temperature: null, distanceMeasured: null, speedMeasured: null };
  }

  it("indisponible (raison explicite) quand la sortie n'a pas de samples exploitables", () => {
    const ctx = buildCoachContext([activity({ samples: [] })]);
    expect(ctx.lastRideDetail).toEqual({ available: false, reason: "insufficient_samples" });
  });

  it("détecte une montée réelle sur la dernière sortie à partir de ses samples déjà stockés", () => {
    const samples = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      samples.push(samplePoint(f * 0.011, 0, 100 + f * 60, i * 15));
    }
    const ctx = buildCoachContext([activity({ samples })]);
    expect(ctx.lastRideDetail.available).toBe(true);
    expect(ctx.lastRideDetail.climbs.count).toBeGreaterThan(0);
  });

  it("aucune activité -> lastRideDetail explicitement indisponible, jamais une liste vide silencieuse", () => {
    const ctx = buildCoachContext([]);
    expect(ctx.lastRideDetail).toEqual({ available: false, reason: "no_activity" });
  });
});

describe("buildCoachContext — V2 : comparison (dernière sortie vs récentes)", () => {
  it("indisponible avec un historique incomplet (une seule sortie)", () => {
    const ctx = buildCoachContext([activity()]);
    expect(ctx.comparison).toEqual({ available: false, reason: "insufficient_history", sampleSize: 0 });
  });

  it("compare la dernière sortie à la moyenne des sorties récentes", () => {
    const activities = [
      activity({ id: "last", date: "2026-03-01T00:00:00.000Z", distance: 60 }),
      activity({ id: "a", date: "2026-02-01T00:00:00.000Z", distance: 20 }),
      activity({ id: "b", date: "2026-01-01T00:00:00.000Z", distance: 40 }),
    ];
    const ctx = buildCoachContext(activities);
    expect(ctx.comparison.available).toBe(true);
    expect(ctx.comparison.distance.lastValue).toBe(60);
    expect(ctx.comparison.distance.avgOfOthers).toBe(30);
  });
});

describe("buildCoachContext — V2 : sortie avec données FC (rétrocompatibilité V1)", () => {
  it("expose toujours avgHeartRateBpm/maxHeartRateBpm quand elles existent", () => {
    const ctx = buildCoachContext([activity({ avgHeartRate: 155, maxHeartRate: 182, flags: { ...activity().flags, hasHeartRate: true } })]);
    expect(ctx.lastRide.avgHeartRateBpm).toBe(155);
    expect(ctx.lastRide.maxHeartRateBpm).toBe(182);
  });
});

describe("formatCoachContextCompact", () => {
  it("produit un texte compact avec les sections attendues", () => {
    const ctx = buildCoachContext([activity()]);
    const text = formatCoachContextCompact(ctx);
    expect(text).toContain("Contexte coach");
    expect(text).toContain("Dernière sortie");
    expect(text).toContain("Profil cycliste");
    expect(text).toContain("Progression");
    expect(text).toContain("Records");
  });

  it("indique explicitement les données absentes ('n/d'), jamais une valeur inventée", () => {
    const noHr = activity({ avgHeartRate: null, flags: { ...activity().flags, hasHeartRate: false } });
    const ctx = buildCoachContext([noHr]);
    const text = formatCoachContextCompact(ctx);
    expect(text).toMatch(/FC n\/d/);
  });

  it("marque explicitement une puissance estimée comme telle dans le texte", () => {
    const estimated = activity({ flags: { ...activity().flags, hasPower: true, powerEstimated: true } });
    const ctx = buildCoachContext([estimated]);
    const text = formatCoachContextCompact(ctx);
    expect(text).toMatch(/Puissance \(estimée\)/);
  });

  it("distingue clairement puissance mesurée dans le texte (jamais confondue avec estimée)", () => {
    const measured = activity({ flags: { ...activity().flags, hasPower: true, powerEstimated: false } });
    const ctx = buildCoachContext([measured]);
    const text = formatCoachContextCompact(ctx);
    expect(text).toMatch(/Puissance \(mesurée\)/);
    expect(text).not.toMatch(/Puissance \(estimée\)/);
  });

  it("V2 : indique explicitement l'indisponibilité des montées/efforts/arrêts détaillés sans samples", () => {
    const ctx = buildCoachContext([activity({ samples: [] })]);
    const text = formatCoachContextCompact(ctx);
    expect(text).toMatch(/Montées \/ efforts \/ arrêts détaillés : indisponibles/);
  });

  it("V2 : affiche la comparaison à la moyenne récente quand l'historique le permet", () => {
    const activities = [
      activity({ id: "last", date: "2026-03-01T00:00:00.000Z", distance: 60 }),
      activity({ id: "a", date: "2026-02-01T00:00:00.000Z", distance: 20 }),
    ];
    const ctx = buildCoachContext(activities);
    const text = formatCoachContextCompact(ctx);
    expect(text).toMatch(/Comparaison dernière sortie \/ récentes/);
    expect(text).toMatch(/Distance : 60,0 km vs moyenne récente 20,0 km/);
  });
});
