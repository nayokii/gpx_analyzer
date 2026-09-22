import { describe, it, expect } from "vitest";
import { computeSprint } from "./sprint.js";

function signal(id, { powerSource = "measured", s5 = 800, s30 = 500 } = {}) {
  return {
    activityId: id,
    powerSource,
    bestPowerEfforts: powerSource === "measured" ? { s5: { power: s5, duration: 5 }, s30: { power: s30, duration: 30 } } : null,
  };
}

describe("computeSprint", () => {
  it("liste vide : insufficient_data", () => {
    expect(computeSprint([]).value).toBeNull();
  });

  it("aucune puissance mesurée disponible : insufficient_data, jamais de repli sur la vitesse", () => {
    const result = computeSprint([signal("a", { powerSource: "none" }), signal("b", { powerSource: "estimated" })]);
    expect(result.value).toBeNull();
    expect(result.confidenceLabel).toBe("insufficient_data");
    expect(result.signals.reason).toBeTruthy();
  });

  it("ignore les activités à puissance ESTIMÉE même si bestPowerEfforts existait par erreur", () => {
    const estimatedWithData = { activityId: "a", powerSource: "estimated", bestPowerEfforts: { s5: { power: 900, duration: 5 } } };
    const result = computeSprint([estimatedWithData]);
    expect(result.value).toBeNull();
  });

  it("une seule sortie à puissance mesurée (cold start) : value définie, confiance faible", () => {
    const result = computeSprint([signal("a", { s5: 700 })]);
    expect(result.value).not.toBeNull();
    expect(result.confidence).toBeLessThan(0.35);
    expect(result.dataQuality).toBe("measured");
  });

  it("se rabat sur s30 quand s5 est indisponible", () => {
    const signalNoS5 = { activityId: "a", powerSource: "measured", bestPowerEfforts: { s30: { power: 450, duration: 30 } } };
    const result = computeSprint([signalNoS5]);
    expect(result.value).not.toBeNull();
    expect(result.evidence[0].metric).toBe("bestPower30s");
  });

  it("un pic isolé plus élevé fait monter value mais reste amorti par le percentile 90 avec l'historique", () => {
    const consistent = computeSprint(Array.from({ length: 10 }, (_, i) => signal(`a${i}`, { s5: 600 })));
    const withOneSpike = computeSprint([
      ...Array.from({ length: 9 }, (_, i) => signal(`a${i}`, { s5: 600 })),
      signal("spike", { s5: 1500 }),
    ]);
    expect(withOneSpike.value).toBeGreaterThanOrEqual(consistent.value);
  });

  it("la confiance augmente avec le nombre de sorties à puissance mesurée", () => {
    const one = computeSprint([signal("a")]);
    const many = computeSprint(Array.from({ length: 8 }, (_, i) => signal(`a${i}`)));
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });
});
