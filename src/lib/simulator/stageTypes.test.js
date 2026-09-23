import { describe, it, expect } from "vitest";
import { STAGE_TYPES, STAGE_TYPE_IDS, STAGE_TYPE_DIMENSIONS, getStageTypeProfile } from "./stageTypes.js";

const EXPECTED_TYPES = ["flat", "hilly", "mountain", "highMountain", "timeTrial", "mixed"];

describe("STAGE_TYPES — intégrité", () => {
  it("contient au minimum les 6 types requis par la consigne", () => {
    for (const t of EXPECTED_TYPES) expect(STAGE_TYPE_IDS).toContain(t);
  });

  it("chaque type a les 6 dimensions de style, toutes normalisées entre 0 et 1", () => {
    for (const id of STAGE_TYPE_IDS) {
      const type = STAGE_TYPES[id];
      expect(Object.keys(type.dimensions).sort()).toEqual([...STAGE_TYPE_DIMENSIONS].sort());
      for (const dim of STAGE_TYPE_DIMENSIONS) {
        const v = type.dimensions[dim];
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("chaque type a un fatigueFactor entre 0 et 1", () => {
    for (const id of STAGE_TYPE_IDS) {
      expect(STAGE_TYPES[id].fatigueFactor).toBeGreaterThanOrEqual(0);
      expect(STAGE_TYPES[id].fatigueFactor).toBeLessThanOrEqual(1);
    }
  });

  it("chaque type a un label et une description documentés (pas de valeur muette)", () => {
    for (const id of STAGE_TYPE_IDS) {
      expect(typeof STAGE_TYPES[id].label).toBe("string");
      expect(STAGE_TYPES[id].label.length).toBeGreaterThan(0);
      expect(typeof STAGE_TYPES[id].description).toBe("string");
      expect(STAGE_TYPES[id].description.length).toBeGreaterThan(0);
    }
  });

  it("flat privilégie le sprint, mountain/highMountain privilégient le climbing (cohérence qualitative documentée)", () => {
    expect(STAGE_TYPES.flat.dimensions.sprint).toBeGreaterThan(STAGE_TYPES.mountain.dimensions.sprint);
    expect(STAGE_TYPES.mountain.dimensions.climbing).toBeGreaterThan(STAGE_TYPES.flat.dimensions.climbing);
    expect(STAGE_TYPES.highMountain.dimensions.climbing).toBeGreaterThan(STAGE_TYPES.hilly.dimensions.climbing);
    expect(STAGE_TYPES.timeTrial.dimensions.timeTrial).toBeGreaterThan(STAGE_TYPES.flat.dimensions.timeTrial);
  });

  it("highMountain a le fatigueFactor le plus élevé (étape reine)", () => {
    const max = Math.max(...STAGE_TYPE_IDS.map((id) => STAGE_TYPES[id].fatigueFactor));
    expect(STAGE_TYPES.highMountain.fatigueFactor).toBe(max);
  });
});

describe("getStageTypeProfile", () => {
  it("retourne le profil pour un type connu", () => {
    expect(getStageTypeProfile("flat")).toBe(STAGE_TYPES.flat);
  });

  it("retourne null pour un type inconnu, jamais une exception", () => {
    expect(getStageTypeProfile("inexistant")).toBeNull();
  });
});
