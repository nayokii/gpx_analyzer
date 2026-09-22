import { describe, it, expect } from "vitest";
import { computeRecords, computeBestAvgSpeedAmongComparable } from "./records.js";

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    distance: 30,
    elevationGain: 300,
    duration: 5400,
    avgSpeed: 21.6,
    avgPower: null,
    flags: { hasPower: false, powerEstimated: false },
    gpsTrack: [],
    samples: [],
    ...overrides,
  };
}

describe("computeRecords", () => {
  it("retourne un tableau vide sans activités", () => {
    expect(computeRecords([])).toEqual([]);
  });

  it("trouve la plus longue distance, le plus gros D+ et la plus longue durée", () => {
    const activities = [
      activity({ id: "short", distance: 20, elevationGain: 100, duration: 3600 }),
      activity({ id: "long", distance: 120, elevationGain: 400, duration: 21600 }),
      activity({ id: "hilly", distance: 50, elevationGain: 2000, duration: 10800 }),
    ];
    const records = computeRecords(activities);
    expect(records.find((r) => r.type === "longest_distance")).toEqual({ type: "longest_distance", value: 120, activityId: "long" });
    expect(records.find((r) => r.type === "biggest_elevation_gain")).toEqual({ type: "biggest_elevation_gain", value: 2000, activityId: "hilly" });
    expect(records.find((r) => r.type === "longest_duration")).toEqual({ type: "longest_duration", value: 21600, activityId: "long" });
  });

  it("ne compare la puissance moyenne qu'entre sorties à puissance MESURÉE (jamais mélangée à l'estimée)", () => {
    const activities = [
      activity({ id: "measured-low", avgPower: 180, flags: { hasPower: true, powerEstimated: false } }),
      activity({ id: "measured-high", avgPower: 220, flags: { hasPower: true, powerEstimated: false } }),
      activity({ id: "estimated-huge", avgPower: 500, flags: { hasPower: true, powerEstimated: true } }), // ne doit jamais gagner
    ];
    const record = computeRecords(activities).find((r) => r.type === "highest_avg_power_measured");
    expect(record.activityId).toBe("measured-high");
    expect(record.value).toBe(220);
    expect(record.context).toMatch(/mesur/i);
  });

  it("n'inclut pas de record de puissance si aucune sortie n'a de puissance mesurée", () => {
    const activities = [activity({ id: "a", avgPower: 300, flags: { hasPower: true, powerEstimated: true } })];
    const records = computeRecords(activities);
    expect(records.find((r) => r.type === "highest_avg_power_measured")).toBeUndefined();
  });

  it("ignore une métrique absente plutôt que de la traiter comme 0", () => {
    const activities = [activity({ id: "a", elevationGain: null })];
    const records = computeRecords(activities);
    expect(records.find((r) => r.type === "biggest_elevation_gain")).toBeUndefined();
    expect(records.find((r) => r.type === "longest_distance")).toBeDefined();
  });
});

describe("computeBestAvgSpeedAmongComparable", () => {
  it("ne compare pas une vitesse moyenne sur courte distance à une vitesse moyenne sur longue distance", () => {
    // Deux groupes bien distincts : sorties courtes rapides vs sorties longues plus lentes en moyenne.
    const shortFast1 = activity({ id: "s1", distance: 15, elevationGain: 100, duration: 1800, avgSpeed: 30 });
    const shortFast2 = activity({ id: "s2", distance: 16, elevationGain: 110, duration: 1900, avgSpeed: 30.3 });
    const longSlow1 = activity({ id: "l1", distance: 150, elevationGain: 1000, duration: 21600, avgSpeed: 25 });
    const longSlow2 = activity({ id: "l2", distance: 155, elevationGain: 1050, duration: 22000, avgSpeed: 25.4 });

    const result = computeBestAvgSpeedAmongComparable([shortFast1, shortFast2, longSlow1, longSlow2]);
    // Le record ne doit pas être une comparaison brute (30.3 serait le max global de toute façon ici,
    // donc on vérifie surtout que le contexte reflète bien un groupe restreint, pas tout l'historique).
    expect(result.activityId).toBe("s2");
    expect(result.context).toMatch(/similaires/i);
  });

  it("retourne null sans activités exploitables", () => {
    expect(computeBestAvgSpeedAmongComparable([])).toBeNull();
    expect(computeBestAvgSpeedAmongComparable([activity({ id: "a", avgSpeed: null })])).toBeNull();
  });
});
