import { describe, it, expect } from "vitest";
import { computeAchievements, ACHIEVEMENT_CATALOG } from "./achievements.js";

function event(achievementId, activityId = "a1", date = "2026-06-01T08:00:00Z") {
  return { achievementId, activityId, date };
}

describe("computeAchievements", () => {
  it("retourne tous les achievements du catalogue, verrouillés, sans événement", () => {
    const result = computeAchievements([]);
    expect(result.length).toBe(Object.keys(ACHIEVEMENT_CATALOG).length);
    expect(result.every((a) => a.unlocked === false)).toBe(true);
    expect(result.every((a) => a.unlockedAt === null)).toBe(true);
  });

  it("déverrouille un achievement quand un événement porte son id", () => {
    const result = computeAchievements([event("FIRST_RIDE", "act-1", "2026-06-01T08:00:00Z")]);
    const first = result.find((a) => a.id === "FIRST_RIDE");
    expect(first.unlocked).toBe(true);
    expect(first.unlockedAt).toBe("2026-06-01T08:00:00Z");
    expect(first.activityId).toBe("act-1");
  });

  it("ignore les événements sans achievementId", () => {
    const result = computeAchievements([{ achievementId: null, activityId: "a1", date: "2026-06-01" }]);
    expect(result.every((a) => !a.unlocked)).toBe(true);
  });

  it("conserve la PREMIÈRE occurrence si un même achievement apparaît deux fois (idempotence)", () => {
    const result = computeAchievements([
      event("FIRST_RIDE", "act-1", "2026-06-01T08:00:00Z"),
      event("FIRST_RIDE", "act-99", "2027-01-01T08:00:00Z"),
    ]);
    const first = result.find((a) => a.id === "FIRST_RIDE");
    expect(first.activityId).toBe("act-1");
    expect(first.unlockedAt).toBe("2026-06-01T08:00:00Z");
  });

  it("chaque entrée du catalogue a un label et une description", () => {
    for (const meta of Object.values(ACHIEVEMENT_CATALOG)) {
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.description).toBe("string");
    }
  });
});
