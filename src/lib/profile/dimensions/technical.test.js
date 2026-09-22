import { describe, it, expect } from "vitest";
import { computeTechnical } from "./technical.js";

function signal(id, { sportType = "mtb", hasSamples = true, gradeVariability = null, speedVariability = null } = {}) {
  return { activityId: id, sportType, hasSamples, gradeVariability, speedVariability };
}

describe("computeTechnical", () => {
  it("liste vide : insufficient_data", () => {
    expect(computeTechnical([]).value).toBeNull();
  });

  it("aucune sortie mtb/gravel : insufficient_data même avec beaucoup de variabilité de vitesse sur du 'cycling'", () => {
    const result = computeTechnical([signal("a", { sportType: "cycling", speedVariability: 0.9 })]);
    expect(result.value).toBeNull();
    expect(result.signals.reason).toBeTruthy();
  });

  it("sportType mtb/gravel mais sans samples : insufficient_data", () => {
    const result = computeTechnical([signal("a", { hasSamples: false })]);
    expect(result.value).toBeNull();
  });

  it("mtb avec samples mais sans altitude ni vitesse exploitable : insufficient_data", () => {
    const result = computeTechnical([signal("a", { gradeVariability: null, speedVariability: null })]);
    expect(result.value).toBeNull();
  });

  it("utilise gradeVariability en priorité quand disponible", () => {
    const result = computeTechnical([signal("a", { gradeVariability: 6, speedVariability: 0.5 })]);
    expect(result.signals.signalUsed).toBe("gradeVariability");
    expect(result.dataQuality).toBe("measured");
  });

  it("se rabat sur speedVariability quand l'altitude est indisponible", () => {
    const result = computeTechnical([signal("a", { gradeVariability: null, speedVariability: 0.5 })]);
    expect(result.signals.signalUsed).toBe("speedVariability");
    expect(result.dataQuality).toBe("speed");
  });

  it("accepte gravel comme mtb", () => {
    const result = computeTechnical([signal("a", { sportType: "gravel", gradeVariability: 5 })]);
    expect(result.value).not.toBeNull();
  });

  it("une seule sortie (cold start) : confiance faible", () => {
    const result = computeTechnical([signal("a", { gradeVariability: 5 })]);
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("ignore les sorties non-mtb/gravel même si elles ont de la variabilité", () => {
    const result = computeTechnical([
      signal("a", { sportType: "mtb", gradeVariability: 5 }),
      signal("b", { sportType: "cycling", gradeVariability: 20 }),
    ]);
    expect(result.evidenceCount).toBe(1);
  });
});
