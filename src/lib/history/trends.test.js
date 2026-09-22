import { describe, it, expect, afterEach } from "vitest";
import { buildTimeSeries, computeTrend, TREND_METRICS } from "./trends.js";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    movingTime: 5000,
    elevationGain: 300,
    avgSpeed: 21.6,
    avgPower: null,
    ...overrides,
  };
}

describe("buildTimeSeries", () => {
  it("regroupe par jour et additionne distance/durée/D+", () => {
    process.env.TZ = "UTC";
    const activities = [
      activity({ id: "a1", date: "2026-09-20T08:00:00Z", distance: 30, duration: 5400, elevationGain: 300 }),
      activity({ id: "a2", date: "2026-09-20T18:00:00Z", distance: 10, duration: 1800, elevationGain: 50 }), // même jour
      activity({ id: "a3", date: "2026-09-21T08:00:00Z", distance: 20, duration: 3600, elevationGain: 100 }),
    ];
    const series = buildTimeSeries(activities, { bucket: "day" });
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ key: "2026-09-20", count: 2, distanceKm: 40, durationSec: 7200, elevationGainM: 350 });
    expect(series[1]).toMatchObject({ key: "2026-09-21", count: 1, distanceKm: 20 });
  });

  it("regroupe par semaine et par mois", () => {
    process.env.TZ = "UTC";
    const activities = [
      activity({ id: "a1", date: "2026-01-05T08:00:00Z" }), // lundi, semaine ISO 2
      activity({ id: "a2", date: "2026-01-06T08:00:00Z" }), // même semaine
      activity({ id: "a3", date: "2026-02-10T08:00:00Z" }), // autre mois
    ];
    const byWeek = buildTimeSeries(activities, { bucket: "week" });
    expect(byWeek.map((b) => b.key)).toEqual(["2026-W02", "2026-W07"]);
    expect(byWeek[0].count).toBe(2);

    const byMonth = buildTimeSeries(activities, { bucket: "month" });
    expect(byMonth.map((b) => b.key)).toEqual(["2026-01", "2026-02"]);
  });

  it("exclut les activités sans date exploitable plutôt que de les placer arbitrairement", () => {
    const activities = [activity({ id: "a1", date: null })];
    expect(buildTimeSeries(activities)).toEqual([]);
  });

  it("retourne un tableau vide pour un historique vide", () => {
    expect(buildTimeSeries([])).toEqual([]);
  });

  it("trie les buckets chronologiquement", () => {
    process.env.TZ = "UTC";
    const activities = [
      activity({ id: "a1", date: "2026-09-22T08:00:00Z" }),
      activity({ id: "a2", date: "2026-09-20T08:00:00Z" }),
      activity({ id: "a3", date: "2026-09-21T08:00:00Z" }),
    ];
    const series = buildTimeSeries(activities);
    expect(series.map((b) => b.key)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
  });

  it("rejette un regroupement inconnu", () => {
    expect(() => buildTimeSeries([activity()], { bucket: "fortnight" })).toThrow(/inconnu/i);
  });
});

describe("computeTrend — jamais de conclusion hâtive", () => {
  it("retourne 'insufficient_data' avec moins de 5 sorties (défaut)", () => {
    const activities = [1, 2, 3].map((i) => activity({ id: `a${i}`, date: `2026-09-${10 + i}T08:00:00Z`, distance: 20 + i }));
    const r = computeTrend(activities, "distance");
    expect(r.direction).toBe("insufficient_data");
    expect(r.slope).toBeNull();
    expect(r.points).toHaveLength(3); // les points sont quand même renvoyés
  });

  it("détecte une tendance à la hausse avec suffisamment de points", () => {
    const activities = [10, 15, 20, 25, 30, 35].map((distance, i) =>
      activity({ id: `a${i}`, date: `2026-09-${10 + i}T08:00:00Z`, distance })
    );
    const r = computeTrend(activities, "distance");
    expect(r.direction).toBe("up");
    expect(r.slope).toBeGreaterThan(0);
  });

  it("détecte une tendance à la baisse", () => {
    const activities = [35, 30, 25, 20, 15, 10].map((distance, i) =>
      activity({ id: `a${i}`, date: `2026-09-${10 + i}T08:00:00Z`, distance })
    );
    const r = computeTrend(activities, "distance");
    expect(r.direction).toBe("down");
    expect(r.slope).toBeLessThan(0);
  });

  it("détecte une tendance stable ('flat') quand la valeur ne bouge quasiment pas", () => {
    const activities = [30, 30.1, 29.9, 30.05, 29.95, 30].map((distance, i) =>
      activity({ id: `a${i}`, date: `2026-09-${10 + i}T08:00:00Z`, distance })
    );
    const r = computeTrend(activities, "distance");
    expect(r.direction).toBe("flat");
  });

  it("ordonne les points chronologiquement même si les activités sont désordonnées en entrée", () => {
    const activities = [
      activity({ id: "late", date: "2026-09-25T08:00:00Z", distance: 40 }),
      activity({ id: "early", date: "2026-09-10T08:00:00Z", distance: 10 }),
      activity({ id: "mid", date: "2026-09-18T08:00:00Z", distance: 25 }),
    ];
    const r = computeTrend(activities, "distance", { minPoints: 2 });
    expect(r.points.map((p) => p.activityId)).toEqual(["early", "mid", "late"]);
  });

  it("ignore les activités sans valeur pour la métrique demandée", () => {
    const activities = [
      activity({ id: "a1", date: "2026-09-10T08:00:00Z", avgPower: null }),
      activity({ id: "a2", date: "2026-09-11T08:00:00Z", avgPower: 200 }),
    ];
    const r = computeTrend(activities, "avgPower", { minPoints: 1 });
    expect(r.points).toHaveLength(1);
    expect(r.points[0].activityId).toBe("a2");
  });

  it("rejette une métrique inconnue", () => {
    expect(() => computeTrend([activity()], "ftpEstimate")).toThrow(/inconnue/i);
  });

  it("expose la liste des métriques supportées", () => {
    expect(TREND_METRICS).toEqual(expect.arrayContaining(["distance", "avgSpeed", "elevationGain", "avgPower", "duration"]));
  });
});
