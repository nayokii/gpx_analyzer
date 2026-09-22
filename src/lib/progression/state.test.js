import { describe, it, expect } from "vitest";
import { createEmptyProgressionState, progressionToState, isValidProgressionState, PROGRESSION_STATE_VERSION } from "./state.js";
import { computeProgression } from "./progression.js";
import { createEmptyActivity } from "../types.js";

function activity(overrides = {}) {
  const a = createEmptyActivity();
  return { ...a, id: overrides.id || "a1", date: overrides.date ?? "2026-06-01T08:00:00Z", ...overrides };
}

describe("createEmptyProgressionState", () => {
  it("XP 0, aucune activité traitée, version courante", () => {
    const state = createEmptyProgressionState();
    expect(state.xp).toBe(0);
    expect(state.level).toBe(1);
    expect(state.processedActivityIds).toEqual([]);
    expect(state.unlockedAchievements).toEqual([]);
    expect(state.version).toBe(PROGRESSION_STATE_VERSION);
  });

  it("est valide selon isValidProgressionState", () => {
    expect(isValidProgressionState(createEmptyProgressionState())).toBe(true);
  });
});

describe("isValidProgressionState", () => {
  it("rejette null/undefined/un objet quelconque", () => {
    expect(isValidProgressionState(null)).toBe(false);
    expect(isValidProgressionState(undefined)).toBe(false);
    expect(isValidProgressionState({})).toBe(false);
    expect(isValidProgressionState({ version: 1 })).toBe(false);
  });
});

describe("progressionToState", () => {
  it("projette fidèlement xp/level/achievements/processedActivityIds depuis computeProgression", () => {
    const activities = [activity({ id: "a1", distance: 25 })];
    const progression = computeProgression(activities, null);
    const state = progressionToState(progression);

    expect(state.xp).toBe(progression.xp);
    expect(state.level).toBe(progression.level);
    expect(state.processedActivityIds).toEqual(["a1"]);
    expect(state.unlockedAchievements.some((a) => a.id === "FIRST_RIDE")).toBe(true);
  });

  it("préserve createdAt de l'état précédent, mais met à jour updatedAt", () => {
    const previous = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    const progression = computeProgression([activity()], null);
    const state = progressionToState(progression, previous);
    expect(state.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(state.updatedAt).not.toBe(previous.updatedAt);
  });

  it("sans état précédent, createdAt est fixé à maintenant", () => {
    const progression = computeProgression([activity()], null);
    const state = progressionToState(progression, null);
    expect(state.createdAt).toBeTruthy();
  });

  it("le résultat est toujours valide selon isValidProgressionState", () => {
    const progression = computeProgression([activity()], null);
    expect(isValidProgressionState(progressionToState(progression))).toBe(true);
  });
});
