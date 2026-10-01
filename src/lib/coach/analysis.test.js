import { describe, it, expect } from "vitest";
import { analyzeCoachContext } from "./analysis.js";
import { buildCoachContext } from "./context.js";

function dim(overrides = {}) {
  return { value: 50, confidence: 0.5, confidenceLabel: "medium", contributingActivities: 5, trend: "stable", ...overrides };
}

function ride(overrides = {}) {
  return {
    id: "last",
    name: "Sortie test",
    date: "2026-09-24T00:00:00.000Z",
    sportType: "cycling",
    sourceType: "gpx",
    distanceKm: 30,
    distanceMeasuredKm: null,
    durationSec: 5400,
    movingTimeSec: 5200,
    stoppedTimeSec: 200,
    elevationGainM: 300,
    elevationLossM: 290,
    avgSpeedKmh: 20,
    maxSpeedKmh: 45,
    avgHeartRateBpm: null,
    maxHeartRateBpm: null,
    avgCadenceRpm: null,
    maxCadenceRpm: null,
    power: { available: true, source: "estimated", avgW: 100, maxW: 500, normalizedW: 150 },
    temperature: { available: false, avgC: null },
    ...overrides,
  };
}

function comparisonMetric(lastValue, avgOfOthers) {
  const deltaPct = lastValue == null || avgOfOthers == null || avgOfOthers === 0 ? null : ((lastValue - avgOfOthers) / avgOfOthers) * 100;
  return { lastValue, avgOfOthers, deltaPct, sampleSize: 2 };
}

function baseContext(overrides = {}) {
  return {
    version: 2,
    generatedAt: "2026-09-26T00:00:00.000Z",
    activityCount: 7,
    lastRide: ride(),
    lastRideDetail: {
      available: true,
      climbs: { count: 0, list: [] },
      efforts: { count: 0, list: [] },
      pauses: { available: true, count: 2, totalSec: 120, avgSec: 60, longestSec: 90 },
    },
    recentRides: [ride(), ride({ id: "r2" }), ride({ id: "r3" })],
    comparison: {
      available: true,
      sampleSize: 2,
      distance: comparisonMetric(30, 30),
      duration: comparisonMetric(5400, 5400),
      avgSpeed: comparisonMetric(20, 20),
      elevationGain: comparisonMetric(300, 300),
    },
    profile: {
      activityCount: 7,
      overallConfidence: 0.5,
      dataAvailability: { activityCount: 7, withSamples: 7, withHeartRate: 0, withCadence: 0, withMeasuredPower: 0, withEstimatedPower: 7, withMtbOrGravel: 0 },
      dimensions: {
        endurance: dim(),
        climbing: dim(),
        punch: dim(),
        sprint: dim({ value: null, confidence: null, confidenceLabel: "insufficient_data", contributingActivities: 0, trend: "insufficient" }),
        timeTrial: dim(),
        technical: dim({ value: null, confidence: null, confidenceLabel: "insufficient_data", contributingActivities: 0, trend: "insufficient" }),
        consistency: dim(),
      },
    },
    progression: {
      level: 3,
      title: "Rookie",
      xp: 300,
      levelProgress: { level: 3, currentXp: 300, levelFloorXp: 250, levelXp: 450, progress: 0.25, remaining: 150 },
      challenges: [{ id: "distance", category: "distance", label: "Faire une sortie de 50 km", unit: "km", current: 40, target: 50, completed: false }],
    },
    records: [],
    ...overrides,
  };
}

describe("analyzeCoachContext — structure stable", () => {
  it("retourne toujours les 6 clés attendues, quel que soit le contexte", () => {
    const result = analyzeCoachContext(baseContext());
    expect(typeof result.summary).toBe("string");
    expect(Array.isArray(result.positives)).toBe(true);
    expect(Array.isArray(result.attentionPoints)).toBe(true);
    expect(Array.isArray(result.evolution)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(Array.isArray(result.dataLimits)).toBe(true);
  });

  it("ne plante jamais avec un contexte totalement vide (buildCoachContext([]))", () => {
    const ctx = buildCoachContext([]);
    const result = analyzeCoachContext(ctx);
    expect(result.summary).toMatch(/Aucune sortie/);
    expect(result.positives).toEqual([]);
  });

  it("fonction pure : ne mute jamais le contexte reçu", () => {
    const ctx = baseContext();
    const snapshot = JSON.stringify(ctx);
    analyzeCoachContext(ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it("recommandations toujours limitées à 3 maximum", () => {
    const ctx = baseContext({
      progression: {
        ...baseContext().progression,
        challenges: [
          { id: "distance", category: "distance", label: "Faire une sortie de 50 km", unit: "km", current: 48, target: 50, completed: false },
          { id: "elevation", category: "elevation", label: "Accumuler 500 m de D+", unit: "m", current: 490, target: 500, completed: false },
        ],
      },
      lastRideDetail: { available: true, climbs: { count: 0, list: [] }, efforts: { count: 0, list: [] }, pauses: { available: true, count: 8, totalSec: 900, avgSec: 112, longestSec: 300 } },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });
});

describe("1. sortie courte vs historique long", () => {
  it("signale le volume inhabituellement faible sans jamais parler de régression physique", () => {
    const ctx = baseContext({
      activityCount: 25,
      lastRide: ride({ distanceKm: 8 }),
      comparison: {
        available: true,
        sampleSize: 10,
        distance: comparisonMetric(8, 35),
        duration: comparisonMetric(1200, 6000),
        avgSpeed: comparisonMetric(18, 20),
        elevationGain: comparisonMetric(50, 300),
      },
    });
    const result = analyzeCoachContext(ctx);
    const low = result.attentionPoints.find((a) => a.type === "volume_low");
    expect(low).toBeDefined();
    expect(low.message).toMatch(/seule sortie/);
    expect(low.message).not.toMatch(/régression physique confirmée/); // jamais présentée comme telle, seulement écartée explicitement
  });
});

describe("2. sortie avec beaucoup d'arrêts", () => {
  it("génère un point d'attention ET une recommandation liés aux arrêts", () => {
    const ctx = baseContext({
      lastRideDetail: { available: true, climbs: { count: 0, list: [] }, efforts: { count: 0, list: [] }, pauses: { available: true, count: 12, totalSec: 1800, avgSec: 150, longestSec: 600 } },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.attentionPoints.some((a) => a.type === "many_stops")).toBe(true);
    expect(result.recommendations.some((r) => r.type === "review_stops")).toBe(true);
  });
});

describe("3. puissance uniquement estimée", () => {
  it("le signale comme point d'attention ET comme limite de données", () => {
    const ctx = baseContext({ lastRide: ride({ power: { available: true, source: "estimated", avgW: 100, maxW: 500, normalizedW: 150 } }) });
    const result = analyzeCoachContext(ctx);
    expect(result.attentionPoints.some((a) => a.type === "power_estimated_only")).toBe(true);
    expect(result.dataLimits.some((d) => d.type === "power_estimated_only")).toBe(true);
  });
});

describe("4. FC + puissance mesurée disponibles", () => {
  it("ne signale ni l'absence de FC ni la puissance estimée", () => {
    const ctx = baseContext({
      lastRide: ride({ avgHeartRateBpm: 150, maxHeartRateBpm: 180, power: { available: true, source: "measured", avgW: 180, maxW: 400, normalizedW: 200 } }),
      profile: {
        ...baseContext().profile,
        dataAvailability: { activityCount: 7, withSamples: 7, withHeartRate: 7, withCadence: 0, withMeasuredPower: 7, withEstimatedPower: 0, withMtbOrGravel: 0 },
      },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.recommendations.some((r) => r.type === "add_heart_rate")).toBe(false);
    expect(result.attentionPoints.some((a) => a.type === "power_estimated_only")).toBe(false);
    expect(result.dataLimits.some((d) => d.type === "power_estimated_only" || d.type === "no_heart_rate")).toBe(false);
  });
});

describe("5. profil avec confiance faible", () => {
  it("ne transforme jamais un score élevé à confiance faible en qualité physique", () => {
    const ctx = baseContext({ profile: { ...baseContext().profile, dimensions: { ...baseContext().profile.dimensions, punch: dim({ value: 93, confidenceLabel: "low", confidence: 0.32, trend: "down" }) } } });
    const result = analyzeCoachContext(ctx);
    const lowConf = result.attentionPoints.find((a) => a.type === "dimension_low_confidence");
    expect(lowConf).toBeDefined();
    expect(lowConf.message).toMatch(/FAIBLE/);
    expect(lowConf.message).not.toMatch(/explosif|preuve de qualité physique avérée réellement/i);
    // Jamais listé en positif malgré sa valeur élevée (93) : confiance insuffisante.
    expect(result.positives.some((p) => p.message.includes("Punch"))).toBe(false);
  });
});

describe("6. profil avec tendance positive", () => {
  it("liste une progression documentée quand confiance suffisante", () => {
    const ctx = baseContext({ profile: { ...baseContext().profile, dimensions: { ...baseContext().profile.dimensions, endurance: dim({ value: 71, trend: "up", confidenceLabel: "medium" }) } } });
    const result = analyzeCoachContext(ctx);
    expect(result.positives.some((p) => p.type === "profile_dimension_up" && p.message.includes("Endurance"))).toBe(true);
    const evo = result.evolution.find((e) => e.key === "endurance");
    expect(evo.status).toBe("improving");
    expect(evo.message).toMatch(/amélioration documentée/);
  });
});

describe("7. tendance négative isolée", () => {
  it("un point d'attention avec disclaimer explicite, jamais présenté comme une régression confirmée", () => {
    const ctx = baseContext({ profile: { ...baseContext().profile, dimensions: { ...baseContext().profile.dimensions, climbing: dim({ value: 50, trend: "down", confidenceLabel: "medium", contributingActivities: 2 }) } } });
    const result = analyzeCoachContext(ctx);
    const attn = result.attentionPoints.find((a) => a.type === "profile_dimension_down");
    expect(attn.message).toMatch(/pas une régression physique confirmée/);
    const evo = result.evolution.find((e) => e.key === "climbing");
    expect(evo.status).toBe("declining");
    expect(evo.message).toMatch(/pas une régression confirmée/);
  });
});

describe("8. historique insuffisant", () => {
  it("signale l'historique limité et n'invente pas de tendance de comparaison", () => {
    const ctx = baseContext({ activityCount: 2, comparison: { available: false, reason: "insufficient_history", sampleSize: 0 } });
    const result = analyzeCoachContext(ctx);
    expect(result.dataLimits.some((d) => d.type === "low_history")).toBe(true);
    expect(result.evolution.some((e) => e.type === "comparison")).toBe(false);
  });
});

describe("9. challenge presque atteint", () => {
  it("propose une recommandation concrète calculée depuis le challenge réel", () => {
    const ctx = baseContext({
      progression: { ...baseContext().progression, challenges: [{ id: "distance", category: "distance", label: "Faire une sortie de 50 km", unit: "km", current: 44, target: 50, completed: false }] },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.positives.some((p) => p.type === "challenge_near")).toBe(true);
    const rec = result.recommendations.find((r) => r.type === "complete_challenge");
    expect(rec).toBeDefined();
    expect(rec.message).toMatch(/6 km/); // 50 - 44
  });

  it("ne propose rien si aucun challenge n'est proche", () => {
    const ctx = baseContext({
      progression: { ...baseContext().progression, challenges: [{ id: "distance", category: "distance", label: "Faire une sortie de 50 km", unit: "km", current: 10, target: 50, completed: false }] },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.positives.some((p) => p.type === "challenge_near")).toBe(false);
    expect(result.recommendations.some((r) => r.type === "complete_challenge")).toBe(false);
  });
});

describe("10. absence de données facultatives", () => {
  it("ne fabrique rien et documente proprement les absences", () => {
    const ctx = baseContext({
      lastRide: ride({ avgHeartRateBpm: null, avgCadenceRpm: null, temperature: { available: false, avgC: null } }),
      profile: {
        ...baseContext().profile,
        dataAvailability: { activityCount: 7, withSamples: 7, withHeartRate: 0, withCadence: 0, withMeasuredPower: 0, withEstimatedPower: 7, withMtbOrGravel: 0 },
      },
    });
    const result = analyzeCoachContext(ctx);
    expect(result.dataLimits.some((d) => d.type === "no_heart_rate")).toBe(true);
    expect(result.dataLimits.some((d) => d.type === "no_cadence")).toBe(true);
    // Toujours présent : jamais de diagnostic de forme/récupération avec ces seules données.
    expect(result.dataLimits.some((d) => d.type === "no_physiological_diagnosis")).toBe(true);
  });
});

describe("Analyse réelle bout-en-bout (buildCoachContext -> analyzeCoachContext)", () => {
  it("produit une analyse cohérente sur un historique réaliste sans planter", () => {
    function activity(overrides = {}) {
      return {
        id: overrides.id || "a1",
        name: "Sortie",
        date: "2026-09-20T08:00:00.000Z",
        sportType: "cycling",
        source: { type: "fit" },
        distance: 30,
        duration: 5400,
        movingTime: 5200,
        elevationGain: 300,
        elevationLoss: 290,
        avgSpeed: 20,
        maxSpeed: 45,
        avgHeartRate: null,
        maxHeartRate: null,
        avgCadence: null,
        maxCadence: null,
        avgPower: 150,
        maxPower: 400,
        normalizedPower: 180,
        flags: { hasGps: true, hasElevation: true, hasTime: true, hasHeartRate: false, hasCadence: false, hasPower: true, hasTemperature: false, powerEstimated: true, hasMeasuredDistance: false, hasMeasuredSpeed: false },
        gpsTrack: [],
        samples: [],
        ...overrides,
      };
    }
    const activities = [
      activity({ id: "a", date: "2026-08-01T00:00:00.000Z", distance: 20 }),
      activity({ id: "b", date: "2026-08-15T00:00:00.000Z", distance: 80, elevationGain: 1200 }),
      activity({ id: "c", date: "2026-09-01T00:00:00.000Z", distance: 45 }),
    ];
    const ctx = buildCoachContext(activities);
    const result = analyzeCoachContext(ctx);

    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.dataLimits.some((d) => d.type === "power_estimated_only")).toBe(true);
    expect(result.dataLimits.some((d) => d.type === "no_heart_rate")).toBe(true);
  });
});
