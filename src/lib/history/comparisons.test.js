import { describe, it, expect } from "vitest";
import { compareActivities } from "./comparisons.js";

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
    samples: [],
    ...overrides,
  };
}

describe("compareActivities — deux sorties comparables", () => {
  it("calcule les deltas absolus et relatifs sur les métriques générales", () => {
    const a = activity({ id: "a", distance: 30, duration: 5400, movingTime: 5000, elevationGain: 300, elevationLoss: 280 });
    const b = activity({ id: "b", distance: 40, duration: 7200, movingTime: 6800, elevationGain: 450, elevationLoss: 420 });
    const cmp = compareActivities(a, b);

    expect(cmp.activityIds).toEqual({ a: "a", b: "b" });
    expect(cmp.general.distanceKm.available).toBe(true);
    expect(cmp.general.distanceKm.deltaAbs).toBe(10);
    expect(cmp.general.distanceKm.deltaPct).toBeCloseTo((10 / 30) * 100, 6);
    expect(cmp.general.elevationGainM.deltaAbs).toBe(150);
  });

  it("compare vitesse/puissance/FC/cadence", () => {
    const a = activity({ id: "a", avgSpeed: 20, maxSpeed: 40, avgPower: 180, maxPower: 400, avgHeartRate: 140, maxHeartRate: 175, avgCadence: 85, maxCadence: 100 });
    const b = activity({ id: "b", avgSpeed: 22, maxSpeed: 42, avgPower: 190, maxPower: 420, avgHeartRate: 145, maxHeartRate: 180, avgCadence: 88, maxCadence: 102 });
    const cmp = compareActivities(a, b);
    expect(cmp.performance.avgSpeedKmh.deltaAbs).toBeCloseTo(2, 6);
    expect(cmp.performance.avgPowerW.deltaAbs).toBe(10);
    expect(cmp.performance.avgHeartRateBpm.deltaAbs).toBe(5);
    expect(cmp.performance.avgCadenceRpm.deltaAbs).toBe(3);
  });
});

describe("compareActivities — métriques absentes", () => {
  it("marque available=false plutôt que d'inventer une comparaison", () => {
    const a = activity({ id: "a", avgPower: null });
    const b = activity({ id: "b", avgPower: 200 });
    const cmp = compareActivities(a, b);
    expect(cmp.performance.avgPowerW.available).toBe(false);
    expect(cmp.performance.avgPowerW.deltaAbs).toBeNull();
    expect(cmp.performance.avgPowerW.deltaPct).toBeNull();
    expect(cmp.performance.avgPowerW.a).toBeNull();
    expect(cmp.performance.avgPowerW.b).toBe(200);
  });

  it("indique la FC absente d'une des deux sorties via dataQuality, sans planter", () => {
    const a = activity({ id: "a", avgHeartRate: null, flags: { hasHeartRate: false } });
    const b = activity({ id: "b", avgHeartRate: 150, flags: { hasHeartRate: true } });
    const cmp = compareActivities(a, b);
    expect(cmp.dataQuality.heartRate).toEqual({ a: false, b: true });
    expect(cmp.performance.avgHeartRateBpm.available).toBe(false);
  });
});

describe("compareActivities — puissance mesurée vs estimée", () => {
  it("ne présente pas une comparaison mesurée/estimée comme équivalente", () => {
    const a = activity({ id: "a", avgPower: 200, flags: { hasPower: true, powerEstimated: false } });
    const b = activity({ id: "b", avgPower: 210, flags: { hasPower: true, powerEstimated: true } });
    const cmp = compareActivities(a, b);
    expect(cmp.dataQuality.power.a).toBe("measured");
    expect(cmp.dataQuality.power.b).toBe("estimated");
    expect(cmp.dataQuality.power.comparable).toBe(false);
    // Le delta numérique est quand même calculé (donnée dispo des deux côtés)...
    expect(cmp.performance.avgPowerW.available).toBe(true);
    // ...mais dataQuality.power.comparable=false signale explicitement de ne pas les traiter comme équivalentes.
  });

  it("indique comparable=true quand les deux sorties ont la puissance mesurée", () => {
    const a = activity({ id: "a", avgPower: 200, flags: { hasPower: true, powerEstimated: false } });
    const b = activity({ id: "b", avgPower: 210, flags: { hasPower: true, powerEstimated: false } });
    const cmp = compareActivities(a, b);
    expect(cmp.dataQuality.power.comparable).toBe(true);
  });

  it("indique comparable=false quand la puissance est absente d'un côté", () => {
    const a = activity({ id: "a", avgPower: null, flags: { hasPower: false } });
    const b = activity({ id: "b", avgPower: 210, flags: { hasPower: true, powerEstimated: false } });
    const cmp = compareActivities(a, b);
    expect(cmp.dataQuality.power.a).toBe("unavailable");
    expect(cmp.dataQuality.power.comparable).toBe(false);
  });
});

describe("compareActivities — zones", () => {
  it("marque les zones indisponibles sans samples complets (résumé d'index)", () => {
    const a = activity({ id: "a", samples: [] });
    const b = activity({ id: "b", samples: [] });
    const cmp = compareActivities(a, b, { ftp: 250 });
    expect(cmp.zones.available).toBe(false);
  });

  it("marque les zones indisponibles sans FTP ni FC max fournies", () => {
    const samples = [
      { timestamp: "2026-09-20T08:00:00Z", power: 200, heartRate: 140 },
      { timestamp: "2026-09-20T08:00:10Z", power: 210, heartRate: 142 },
    ];
    const a = activity({ id: "a", samples, flags: { hasPower: true, hasHeartRate: true } });
    const b = activity({ id: "b", samples, flags: { hasPower: true, hasHeartRate: true } });
    const cmp = compareActivities(a, b, {});
    expect(cmp.zones.available).toBe(false);
  });

  it("calcule les zones de puissance à partir des samples déjà stockés (sans reparser le fichier source)", () => {
    // Zones de puissance (power.js) : fraction = power/ftp. Avec ftp=200,
    // 150 W -> 0.75 (Z3 Tempo, [0.75-0.90[) et 195 W -> 0.975 (Z4 Seuil, [0.90-1.05[).
    const samplesA = Array.from({ length: 120 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 8, 20, 8, 0, i)).toISOString(),
      power: i < 60 ? 150 : 195, // moitié en Z3, moitié en Z4
      heartRate: null,
    }));
    const samplesB = samplesA.map((s) => ({ ...s, power: 150 })); // tout en dessous du seuil
    const a = activity({ id: "a", samples: samplesA, flags: { hasPower: true, powerEstimated: false, hasHeartRate: false } });
    const b = activity({ id: "b", samples: samplesB, flags: { hasPower: true, powerEstimated: false, hasHeartRate: false } });

    const cmp = compareActivities(a, b, { ftp: 200 });
    expect(cmp.zones.available).toBe(true);
    expect(cmp.zones.power.a.available).toBe(true);
    expect(cmp.zones.power.b.available).toBe(true);
    const z4A = cmp.zones.power.a.zones.find((z) => z.name === "Z4 Seuil");
    expect(z4A.seconds).toBeGreaterThan(0);
    const z4B = cmp.zones.power.b.zones.find((z) => z.name === "Z4 Seuil");
    expect(z4B.seconds).toBe(0);
  });
});
