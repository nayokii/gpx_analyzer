import { describe, it, expect } from "vitest";
import { sampleWeight, dataQualityWeight, computeConfidence, confidenceLabel, insufficientData } from "./confidence.js";

describe("sampleWeight", () => {
  it("est 0 sans preuve", () => {
    expect(sampleWeight(0)).toBe(0);
  });

  it("croît avec le nombre de preuves mais sature (rendements décroissants)", () => {
    const w1 = sampleWeight(1);
    const w6 = sampleWeight(6);
    const w50 = sampleWeight(50);
    expect(w6).toBeGreaterThan(w1);
    expect(w50).toBeGreaterThan(w6);
    expect(w50).toBeLessThan(1);
    // Le gain marginal diminue : 1->6 apporte plus que 6->50 (par unité)
    const gainPerUnitEarly = (w6 - w1) / 5;
    const gainPerUnitLate = (w50 - w6) / 44;
    expect(gainPerUnitEarly).toBeGreaterThan(gainPerUnitLate);
  });
});

describe("dataQualityWeight", () => {
  it("classe mesuré > mixte > estimé > vitesse", () => {
    expect(dataQualityWeight("measured")).toBeGreaterThan(dataQualityWeight("mixed"));
    expect(dataQualityWeight("mixed")).toBeGreaterThan(dataQualityWeight("estimated"));
    expect(dataQualityWeight("estimated")).toBeGreaterThan(dataQualityWeight("speed"));
  });

  it("a une valeur de repli raisonnable pour un type inconnu", () => {
    expect(dataQualityWeight("unknown")).toBeGreaterThan(0);
    expect(dataQualityWeight("unknown")).toBeLessThan(1);
  });
});

describe("computeConfidence", () => {
  it("une confiance faible avec peu de preuves est acceptable, jamais élevée avec très peu de preuves", () => {
    const twoActivitiesMeasured = computeConfidence({ contributingActivities: 2, dataQuality: "measured" });
    expect(twoActivitiesMeasured).toBeGreaterThan(0);
    expect(twoActivitiesMeasured).toBeLessThan(0.7); // ne doit jamais atteindre "high" avec seulement 2 preuves
  });

  it("la puissance estimée dégrade la confiance à nombre de preuves égal", () => {
    const measured = computeConfidence({ contributingActivities: 10, dataQuality: "measured" });
    const estimated = computeConfidence({ contributingActivities: 10, dataQuality: "estimated" });
    expect(estimated).toBeLessThan(measured);
  });

  it("reste borné à [0, 1] même avec un très grand nombre de preuves", () => {
    const c = computeConfidence({ contributingActivities: 10000, dataQuality: "measured" });
    expect(c).toBeLessThanOrEqual(1);
  });
});

describe("confidenceLabel", () => {
  it("mappe null sur insufficient_data", () => {
    expect(confidenceLabel(null)).toBe("insufficient_data");
  });

  it("mappe les seuils dans l'ordre croissant", () => {
    expect(confidenceLabel(0.1)).toBe("low");
    expect(confidenceLabel(0.5)).toBe("medium");
    expect(confidenceLabel(0.9)).toBe("high");
  });
});

describe("insufficientData", () => {
  it("ne renvoie jamais de value numérique", () => {
    const result = insufficientData();
    expect(result.value).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.confidenceLabel).toBe("insufficient_data");
    expect(result.evidenceCount).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it("permet de fusionner des champs additionnels sans casser la structure de base", () => {
    const result = insufficientData({ signals: { reason: "test" } });
    expect(result.signals.reason).toBe("test");
    expect(result.value).toBeNull();
  });
});
