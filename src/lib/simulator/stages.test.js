import { describe, it, expect } from "vitest";
import { createStage, isValidStage, createGenericTour, computeDifficulty } from "./stages.js";
import { STAGE_TYPE_DIMENSIONS } from "./stageTypes.js";

describe("createStage", () => {
  it("construit une étape valide à partir d'un type connu", () => {
    const stage = createStage({ id: "s1", name: "Test", type: "mountain", distanceKm: 150 });
    expect(isValidStage(stage)).toBe(true);
    expect(stage.type).toBe("mountain");
    expect(stage.climbing).toBeGreaterThan(0.5); // hérité du type mountain
  });

  it("lève une erreur pour un type inconnu, jamais une étape invalide silencieuse", () => {
    expect(() => createStage({ id: "s1", name: "Test", type: "inexistant", distanceKm: 100 })).toThrow();
  });

  it("lève une erreur sans id/name/distance positive", () => {
    expect(() => createStage({ name: "Test", type: "flat", distanceKm: 100 })).toThrow();
    expect(() => createStage({ id: "s1", type: "flat", distanceKm: 100 })).toThrow();
    expect(() => createStage({ id: "s1", name: "Test", type: "flat", distanceKm: 0 })).toThrow();
    expect(() => createStage({ id: "s1", name: "Test", type: "flat", distanceKm: -5 })).toThrow();
  });

  it("permet de surcharger une dimension ponctuellement sans affecter les autres", () => {
    const base = createStage({ id: "s1", name: "Test", type: "hilly", distanceKm: 150 });
    const overridden = createStage({ id: "s1", name: "Test", type: "hilly", distanceKm: 150, dimensionOverrides: { climbing: 0.95 } });
    expect(overridden.climbing).toBe(0.95);
    expect(overridden.punch).toBe(base.punch); // inchangé
  });

  it("borne toute valeur surchargée à [0,1]", () => {
    const stage = createStage({ id: "s1", name: "Test", type: "flat", distanceKm: 100, dimensionOverrides: { sprint: 1.5, climbing: -0.3 } });
    expect(stage.sprint).toBe(1);
    expect(stage.climbing).toBe(0);
  });

  it("permet de fixer explicitement la difficulté", () => {
    const stage = createStage({ id: "s1", name: "Test", type: "flat", distanceKm: 100, difficulty: 0.9 });
    expect(stage.difficulty).toBe(0.9);
  });
});

describe("computeDifficulty", () => {
  it("reste dans [0,1] quelle que soit la distance", () => {
    expect(computeDifficulty("flat", 0)).toBeGreaterThanOrEqual(0);
    expect(computeDifficulty("flat", 0)).toBeLessThanOrEqual(1);
    expect(computeDifficulty("highMountain", 10000)).toBeLessThanOrEqual(1);
  });

  it("une étape plus longue du même type est au moins aussi difficile", () => {
    expect(computeDifficulty("mountain", 200)).toBeGreaterThanOrEqual(computeDifficulty("mountain", 100));
  });

  it("highMountain est plus difficile que flat à distance égale", () => {
    expect(computeDifficulty("highMountain", 150)).toBeGreaterThan(computeDifficulty("flat", 150));
  });

  it("type inconnu : ne plante pas, valeur de repli raisonnable", () => {
    expect(() => computeDifficulty("inexistant", 100)).not.toThrow();
  });
});

describe("isValidStage", () => {
  it("rejette une étape sans dimensions valides, jamais une exception", () => {
    expect(isValidStage(null)).toBe(false);
    expect(isValidStage({})).toBe(false);
    expect(isValidStage({ id: "s1", name: "x", type: "flat", distanceKm: 100 })).toBe(false); // dimensions manquantes
  });

  it("rejette une dimension hors [0,1]", () => {
    const stage = createStage({ id: "s1", name: "x", type: "flat", distanceKm: 100 });
    const broken = { ...stage, climbing: 1.2 };
    expect(isValidStage(broken)).toBe(false);
  });

  it("rejette un type inconnu", () => {
    const stage = createStage({ id: "s1", name: "x", type: "flat", distanceKm: 100 });
    expect(isValidStage({ ...stage, type: "inexistant" })).toBe(false);
  });

  it("accepte une étape correctement construite", () => {
    expect(isValidStage(createStage({ id: "s1", name: "x", type: "highMountain", distanceKm: 140 }))).toBe(true);
  });
});

describe("createGenericTour", () => {
  it("produit 6 étapes valides, jamais les données d'un Grand Tour réel", () => {
    const tour = createGenericTour();
    expect(tour).toHaveLength(6);
    for (const stage of tour) expect(isValidStage(stage)).toBe(true);
  });

  it("couvre plusieurs types de terrain (pas juste des répétitions du même type)", () => {
    const tour = createGenericTour();
    const types = new Set(tour.map((s) => s.type));
    expect(types.size).toBeGreaterThanOrEqual(4);
  });

  it("déterministe : deux appels produisent le même résultat", () => {
    expect(createGenericTour()).toEqual(createGenericTour());
  });

  it("chaque étape a un id unique", () => {
    const ids = createGenericTour().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
