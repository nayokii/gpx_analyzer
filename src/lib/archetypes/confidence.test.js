import { describe, it, expect } from "vitest";
import { computeMatchConfidence } from "./confidence.js";
import { buildMatchingVector } from "./archetypeProfile.js";

function dim(value, confidence = 0.5, confidenceLabel = "medium") {
  return { value, confidence: value == null ? null : confidence, confidenceLabel: value == null ? "insufficient_data" : confidenceLabel };
}

function makeProfile(dimensions) {
  return { dimensions: { consistency: dim(80, 0.9, "high"), ...dimensions } };
}

describe("computeMatchConfidence", () => {
  it("aucune dimension disponible : insufficient_data, value null", () => {
    const vector = buildMatchingVector(null);
    const result = computeMatchConfidence(vector);
    expect(result.value).toBeNull();
    expect(result.label).toBe("insufficient_data");
    expect(result.availableCount).toBe(0);
  });

  it("une seule dimension disponible, même à confiance élevée, plafonne la confiance globale (couverture faible)", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.95, "high"),
      climbing: dim(null),
      punch: dim(null),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const result = computeMatchConfidence(buildMatchingVector(profile));
    // 1/6 de couverture × 0.95 de confiance ≈ 0.158 -> largement sous le seuil "élevée"
    expect(result.value).toBeLessThan(0.35);
    expect(result.label).not.toBe("high");
  });

  it("toutes les dimensions disponibles à confiance élevée : confiance globale élevée", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.9, "high"),
      climbing: dim(43, 0.85, "high"),
      punch: dim(67, 0.8, "high"),
      sprint: dim(50, 0.9, "high"),
      timeTrial: dim(40, 0.85, "high"),
      technical: dim(30, 0.9, "high"),
    });
    const result = computeMatchConfidence(buildMatchingVector(profile));
    expect(result.label).toBe("high");
    expect(result.availableCount).toBe(6);
  });

  it("plus de dimensions disponibles à confiance égale augmente la confiance globale", () => {
    const few = computeMatchConfidence(
      buildMatchingVector(makeProfile({ endurance: dim(61, 0.5), climbing: dim(null), punch: dim(null), sprint: dim(null), timeTrial: dim(null), technical: dim(null) }))
    );
    const many = computeMatchConfidence(
      buildMatchingVector(
        makeProfile({ endurance: dim(61, 0.5), climbing: dim(43, 0.5), punch: dim(67, 0.5), sprint: dim(50, 0.5), timeTrial: dim(40, 0.5), technical: dim(30, 0.5) })
      )
    );
    expect(many.value).toBeGreaterThan(few.value);
  });
});
