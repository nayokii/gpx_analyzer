import { describe, it, expect } from "vitest";
import { ARCHETYPES, ARCHETYPE_DIMENSIONS, LEVELS, getArchetypeById } from "./archetypes.js";

describe("ARCHETYPES — intégrité structurelle", () => {
  it("contient les 7 archétypes attendus", () => {
    expect(ARCHETYPES).toHaveLength(7);
    const ids = ARCHETYPES.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["climber", "puncheur", "rouleur", "sprinter", "endurance", "all_rounder", "technical_mtb"])
    );
  });

  it("chaque id est unique", () => {
    const ids = ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque archétype a un nom et une description non vides", () => {
    for (const a of ARCHETYPES) {
      expect(typeof a.name).toBe("string");
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.description).toBe("string");
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it("chaque archétype définit exactement les 6 dimensions de style, jamais consistency", () => {
    for (const a of ARCHETYPES) {
      const keys = Object.keys(a.dimensions).sort();
      expect(keys).toEqual([...ARCHETYPE_DIMENSIONS].sort());
      expect(a.dimensions.consistency).toBeUndefined();
    }
  });

  it("aucune valeur hors de l'échelle 0-100", () => {
    for (const a of ARCHETYPES) {
      for (const dim of ARCHETYPE_DIMENSIONS) {
        const v = a.dimensions[dim];
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("aucun archétype ne laisse une dimension à null (les archétypes sont des formes théoriques complètes)", () => {
    for (const a of ARCHETYPES) {
      for (const dim of ARCHETYPE_DIMENSIONS) {
        expect(a.dimensions[dim]).not.toBeNull();
      }
    }
  });

  it("le grimpeur a une dominante climbing nettement supérieure à sprint", () => {
    const climber = ARCHETYPES.find((a) => a.id === "climber");
    expect(climber.dimensions.climbing).toBeGreaterThan(climber.dimensions.sprint);
  });

  it("le sprinteur a une dominante sprint nettement supérieure à climbing", () => {
    const sprinter = ARCHETYPES.find((a) => a.id === "sprinter");
    expect(sprinter.dimensions.sprint).toBeGreaterThan(sprinter.dimensions.climbing);
  });

  it("l'all-rounder n'a pas de dominante extrême (écart borné entre dimensions)", () => {
    const allRounder = ARCHETYPES.find((a) => a.id === "all_rounder");
    const values = ARCHETYPE_DIMENSIONS.map((d) => allRounder.dimensions[d]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(LEVELS.HIGH - LEVELS.LOW);
  });

  it("technical_mtb a une dominante technique nettement supérieure aux autres archétypes sur cette dimension", () => {
    const technicalMtb = ARCHETYPES.find((a) => a.id === "technical_mtb");
    const others = ARCHETYPES.filter((a) => a.id !== "technical_mtb");
    for (const other of others) {
      expect(technicalMtb.dimensions.technical).toBeGreaterThanOrEqual(other.dimensions.technical);
    }
  });
});

describe("getArchetypeById", () => {
  it("retrouve un archétype par id", () => {
    expect(getArchetypeById("climber").name).toBe("Grimpeur");
  });

  it("retourne null pour un id inconnu", () => {
    expect(getArchetypeById("does-not-exist")).toBeNull();
  });
});
