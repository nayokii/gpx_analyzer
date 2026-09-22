import { describe, it, expect } from "vitest";
import { xpThresholdForLevel, getLevelFromXp, getXpProgress, getXpToNextLevel, getTitleForLevel } from "./levels.js";

describe("xpThresholdForLevel", () => {
  it("correspond à l'exemple de la consigne (0, 100, 250, 450)", () => {
    expect(xpThresholdForLevel(1)).toBe(0);
    expect(xpThresholdForLevel(2)).toBe(100);
    expect(xpThresholdForLevel(3)).toBe(250);
    expect(xpThresholdForLevel(4)).toBe(450);
  });

  it("chaque palier coûte 50 XP de plus que le précédent", () => {
    const deltas = [2, 3, 4, 5, 6].map((n) => xpThresholdForLevel(n) - xpThresholdForLevel(n - 1));
    expect(deltas).toEqual([100, 150, 200, 250, 300]);
  });

  it("est strictement croissant", () => {
    for (let n = 1; n < 20; n++) {
      expect(xpThresholdForLevel(n + 1)).toBeGreaterThan(xpThresholdForLevel(n));
    }
  });
});

describe("getLevelFromXp", () => {
  it("niveau 1 avec 0 XP", () => {
    expect(getLevelFromXp(0)).toBe(1);
  });

  it("reste au niveau courant juste avant un seuil exact", () => {
    expect(getLevelFromXp(99)).toBe(1);
    expect(getLevelFromXp(249)).toBe(2);
  });

  it("monte de niveau exactement au seuil", () => {
    expect(getLevelFromXp(100)).toBe(2);
    expect(getLevelFromXp(250)).toBe(3);
    expect(getLevelFromXp(450)).toBe(4);
  });

  it("entre deux niveaux reste au niveau inférieur", () => {
    expect(getLevelFromXp(180)).toBe(2);
  });

  it("un très gros total d'XP ne casse pas le calcul", () => {
    const level = getLevelFromXp(1_000_000);
    expect(Number.isFinite(level)).toBe(true);
    expect(level).toBeGreaterThan(1);
  });

  it("un total négatif ne casse pas le calcul (traité comme 0)", () => {
    expect(getLevelFromXp(-50)).toBe(1);
  });
});

describe("getXpProgress", () => {
  it("0 XP : progress 0, niveau 1", () => {
    const p = getXpProgress(0);
    expect(p.level).toBe(1);
    expect(p.progress).toBe(0);
    expect(p.levelXp).toBe(100);
  });

  it("juste avant un seuil : progress proche de 1", () => {
    const p = getXpProgress(99);
    expect(p.level).toBe(1);
    expect(p.progress).toBeCloseTo(0.99, 2);
    expect(p.remaining).toBe(1);
  });

  it("exactement au seuil : progress 0 pour le nouveau niveau", () => {
    const p = getXpProgress(100);
    expect(p.level).toBe(2);
    expect(p.progress).toBe(0);
    expect(p.levelFloorXp).toBe(100);
    expect(p.levelXp).toBe(250);
  });

  it("progress toujours borné à [0,1]", () => {
    for (const xp of [0, 50, 100, 3000, 999999]) {
      const p = getXpProgress(xp);
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("getXpToNextLevel", () => {
  it("correspond à `remaining` de getXpProgress", () => {
    expect(getXpToNextLevel(430)).toBe(getXpProgress(430).remaining);
  });
});

describe("getTitleForLevel", () => {
  it("Rookie au niveau 1", () => {
    expect(getTitleForLevel(1)).toBe("Rookie");
  });

  it("Rider au niveau 5, Explorer au niveau 10, Veteran au niveau 30", () => {
    expect(getTitleForLevel(5)).toBe("Rider");
    expect(getTitleForLevel(10)).toBe("Explorer");
    expect(getTitleForLevel(30)).toBe("Veteran");
  });

  it("garde le titre du palier précédent entre deux paliers", () => {
    expect(getTitleForLevel(7)).toBe("Rider");
    expect(getTitleForLevel(29)).toBe("Expert");
  });

  it("ne dépasse jamais Veteran au-delà du dernier palier", () => {
    expect(getTitleForLevel(100)).toBe("Veteran");
  });
});
