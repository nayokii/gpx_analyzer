import { describe, it, expect, vi } from "vitest";
import { buildCoachContextFromRepository } from "./fromRepository.js";

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    name: "Sortie test",
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
    avgPower: null,
    maxPower: null,
    normalizedPower: null,
    flags: {
      hasGps: true, hasElevation: true, hasTime: true, hasHeartRate: false, hasCadence: false,
      hasPower: false, hasTemperature: false, powerEstimated: false, hasMeasuredDistance: false, hasMeasuredSpeed: false,
    },
    gpsTrack: [],
    samples: [],
    ...overrides,
  };
}

function fakeRepository({ summaries, details }) {
  return {
    listActivities: vi.fn().mockResolvedValue({ items: summaries, source: "local", cloudError: null }),
    loadActivityDetails: vi.fn().mockImplementation(async (items) =>
      items.map((s) => {
        const detail = details[s.id];
        return detail ? { status: "fulfilled", value: detail } : { status: "rejected", reason: new Error("introuvable") };
      })
    ),
  };
}

describe("buildCoachContextFromRepository", () => {
  it("charge via listActivities()+loadActivityDetails() et construit le contexte, sans jamais écrire", async () => {
    const a = activity({ id: "a" });
    const b = activity({ id: "b", date: "2026-01-01T00:00:00.000Z" });
    const repo = fakeRepository({ summaries: [{ id: "a" }, { id: "b" }], details: { a, b } });

    const ctx = await buildCoachContextFromRepository(repo);

    expect(repo.listActivities).toHaveBeenCalledTimes(1);
    expect(repo.loadActivityDetails).toHaveBeenCalledTimes(1);
    expect(ctx.activityCount).toBe(2);
    expect(ctx.lastRide.id).toBe("a");
  });

  it("ignore silencieusement une activité dont le chargement échoue, sans faire échouer les autres", async () => {
    const a = activity({ id: "a" });
    const repo = fakeRepository({ summaries: [{ id: "a" }, { id: "missing" }], details: { a } });

    const ctx = await buildCoachContextFromRepository(repo);

    expect(ctx.activityCount).toBe(1);
    expect(ctx.lastRide.id).toBe("a");
  });

  it("transmet les options (ex. recentCount) à buildCoachContext", async () => {
    const activities = Array.from({ length: 5 }, (_, i) => activity({ id: `a${i}`, date: `2026-01-0${i + 1}T00:00:00.000Z` }));
    const details = Object.fromEntries(activities.map((a) => [a.id, a]));
    const repo = fakeRepository({ summaries: activities.map((a) => ({ id: a.id })), details });

    const ctx = await buildCoachContextFromRepository(repo, { recentCount: 2 });

    expect(ctx.recentRides).toHaveLength(2);
  });
});
