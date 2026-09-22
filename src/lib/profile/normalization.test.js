import { describe, it, expect } from "vitest";
import { percentileRank, percentileValue, startupScale, percentileTrustWeight, blendedScale, ratioToScale } from "./normalization.js";

describe("percentileRank", () => {
  it("retourne null sans historique", () => {
    expect(percentileRank(10, [])).toBeNull();
    expect(percentileRank(null, [1, 2, 3])).toBeNull();
  });

  it("retourne 50 pour un point unique égal à value (ex-aequo avec soi-même)", () => {
    expect(percentileRank(5, [5])).toBe(50);
  });

  it("place correctement une valeur au milieu d'une distribution", () => {
    const rank = percentileRank(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rank).toBeCloseTo(45, 0); // 4 en dessous + 0.5 -> 4.5/10
  });

  it("gère les ex-aequo sans tomber à 0 ou 100", () => {
    const rank = percentileRank(5, [5, 5, 5]);
    expect(rank).toBe(50);
  });
});

describe("percentileValue", () => {
  it("retourne null pour un tableau vide", () => {
    expect(percentileValue([], 50)).toBeNull();
  });

  it("retourne la valeur elle-même avec un seul point (cold start)", () => {
    expect(percentileValue([42], 80)).toBe(42);
  });

  it("interpole entre deux points encadrants", () => {
    expect(percentileValue([0, 10], 50)).toBe(5);
  });

  it("le 80e percentile favorise le haut de distribution sans être le maximum", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p80 = percentileValue(values, 80);
    expect(p80).toBeGreaterThan(7);
    expect(p80).toBeLessThan(10);
  });
});

describe("startupScale", () => {
  it("retourne null si value est absente", () => {
    expect(startupScale(null, { min: 0, max: 10 })).toBeNull();
  });

  it("retourne 0 en dessous ou à min", () => {
    expect(startupScale(0, { min: 0, max: 10 })).toBe(0);
    expect(startupScale(-5, { min: 0, max: 10 })).toBe(0);
  });

  it("retourne 100 exactement à max", () => {
    expect(startupScale(10, { min: 0, max: 10 })).toBeCloseTo(100, 5);
  });

  it("a des rendements décroissants au-delà de max (jamais de plafond dur)", () => {
    const at2x = startupScale(20, { min: 0, max: 10 });
    const at4x = startupScale(40, { min: 0, max: 10 });
    expect(at2x).toBeGreaterThan(100);
    expect(at4x).toBeGreaterThan(at2x);
    // Rendements décroissants : doubler encore la valeur ne double pas le score
    expect(at4x / at2x).toBeLessThan(2);
  });

  it("lève une erreur pour une plage invalide", () => {
    expect(() => startupScale(5, { min: 10, max: 5 })).toThrow();
  });
});

describe("percentileTrustWeight", () => {
  it("est 0 avec 0 ou 1 valeur (percentile trivial)", () => {
    expect(percentileTrustWeight(0)).toBe(0);
    expect(percentileTrustWeight(1)).toBe(0);
  });

  it("atteint 1 à partir du seuil de pleine confiance", () => {
    expect(percentileTrustWeight(15, 15)).toBe(1);
    expect(percentileTrustWeight(30, 15)).toBe(1); // jamais > 1
  });

  it("croît progressivement entre les deux", () => {
    const w5 = percentileTrustWeight(5, 15);
    const w10 = percentileTrustWeight(10, 15);
    expect(w5).toBeGreaterThan(0);
    expect(w10).toBeGreaterThan(w5);
    expect(w10).toBeLessThan(1);
  });
});

describe("blendedScale", () => {
  const range = { min: 0, max: 5 };

  it("retourne null pour une valeur absente", () => {
    expect(blendedScale(null, [], range).value).toBeNull();
  });

  it("n'utilise QUE l'échelle de démarrage avec un seul point d'historique (cold start)", () => {
    const result = blendedScale(2.5, [2.5], range);
    expect(result.method).toBe("startup");
    expect(result.percentileWeight).toBe(0);
    expect(result.value).toBeCloseTo(startupHelper(2.5, range), 5);
  });

  it("bascule vers un mélange avec un historique suffisant", () => {
    const history = Array.from({ length: 20 }, (_, i) => i / 4); // 0 .. 4.75
    const result = blendedScale(4, history, range, { fullTrustCount: 15 });
    expect(result.method).toBe("percentile");
    expect(result.percentileWeight).toBe(1);
    expect(result.value).toBeGreaterThan(0);
    expect(result.value).toBeLessThanOrEqual(100);
  });

  function startupHelper(v, r) {
    const span = r.max - r.min;
    return Math.sqrt((v - r.min) / span) * 100;
  }
});

describe("ratioToScale", () => {
  it("borne le résultat à [0, 100]", () => {
    expect(ratioToScale(0)).toBe(0);
    expect(ratioToScale(1)).toBe(100);
    expect(ratioToScale(0.5)).toBe(50);
  });

  it("retourne null si le ratio est absent", () => {
    expect(ratioToScale(null)).toBeNull();
  });
});
