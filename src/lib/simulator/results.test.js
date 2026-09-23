import { describe, it, expect } from "vitest";
import { categorizePerformanceBand, buildStageResult, buildOverallResult, INSUFFICIENT_PERFORMANCE_BAND } from "./results.js";
import { computeStageAffinity } from "./stageAffinity.js";
import { createStage } from "./stages.js";
import { createInitialFatigueState, computeStageFatigue } from "./fatigue.js";
import { STAGE_TYPE_DIMENSIONS } from "./stageTypes.js";

function dim(value, confidence, confidenceLabel = "medium") {
  return { value, confidence: value == null ? null : confidence, confidenceLabel: value == null ? "insufficient_data" : confidenceLabel };
}
function makeProfile(overrides = {}) {
  const dims = {};
  for (const d of STAGE_TYPE_DIMENSIONS) dims[d] = d in overrides ? overrides[d] : dim(null, null);
  dims.consistency = dim(70, 0.6);
  return { activityCount: 6, dimensions: dims };
}

describe("categorizePerformanceBand", () => {
  it("respecte les seuils documentés", () => {
    expect(categorizePerformanceBand(90)).toBe("very_strong");
    expect(categorizePerformanceBand(70)).toBe("strong");
    expect(categorizePerformanceBand(55)).toBe("neutral");
    expect(categorizePerformanceBand(40)).toBe("below_average");
    expect(categorizePerformanceBand(10)).toBe("struggling");
    expect(categorizePerformanceBand(null)).toBe(INSUFFICIENT_PERFORMANCE_BAND);
  });
});

describe("buildStageResult", () => {
  const stage = createStage({ id: "s1", name: "Montagne", type: "mountain", distanceKm: 150 });
  const profile = makeProfile({ climbing: dim(85, 0.8, "high"), endurance: dim(75, 0.7, "high") });
  const affinity = computeStageAffinity(profile, stage);

  it("applique la pénalité de fatigue au score brut, jamais l'inverse (fatigue avant l'étape, pas après)", () => {
    const fatigueBefore = { fatigue: 0.8, consecutiveDifficultDays: 3 };
    const fatigueAfter = computeStageFatigue(stage, fatigueBefore);
    const result = buildStageResult({ stage, affinity, fatigueBefore, fatigueAfter });
    expect(result.adjustedScore).toBeLessThanOrEqual(affinity.score);
  });

  it("sans fatigue, le score ajusté reste proche du score brut (à la variance du jour près)", () => {
    const fresh = createInitialFatigueState();
    const result = buildStageResult({ stage, affinity, fatigueBefore: fresh, fatigueAfter: computeStageFatigue(stage, fresh), dayVariance: 0 });
    expect(result.adjustedScore).toBe(affinity.score);
  });

  it("un score null (données insuffisantes) reste null après ajustement, jamais transformé en 0", () => {
    const emptyProfile = makeProfile();
    const emptyAffinity = computeStageAffinity(emptyProfile, stage);
    const fresh = createInitialFatigueState();
    const result = buildStageResult({ stage, affinity: emptyAffinity, fatigueBefore: fresh, fatigueAfter: fresh, dayVariance: 3 });
    expect(result.adjustedScore).toBeNull();
    expect(result.performanceBand).toBe(INSUFFICIENT_PERFORMANCE_BAND);
  });

  it("expose stageId/stageName/stageType/keyFactors/missingDimensions pour l'explicabilité", () => {
    const fresh = createInitialFatigueState();
    const result = buildStageResult({ stage, affinity, fatigueBefore: fresh, fatigueAfter: fresh });
    expect(result.stageId).toBe("s1");
    expect(result.stageType).toBe("mountain");
    expect(Array.isArray(result.keyFactors)).toBe(true);
    expect(Array.isArray(result.missingDimensions)).toBe(true);
  });
});

describe("buildOverallResult", () => {
  function simulatedResult({ stageType, affinityScore, adjustedScore, fatigueBefore, missingDimensions = [] }) {
    return {
      stageId: `${stageType}-x`,
      stageName: stageType,
      stageType,
      affinity: affinityScore,
      category: "favorable",
      adjustedScore,
      performanceBand: "neutral",
      fatigueBefore,
      fatigueAfter: fatigueBefore,
      keyFactors: [],
      missingDimensions,
    };
  }

  it("moyenne les affinités BRUTES par type de terrain, ignore les étapes indocumentées", () => {
    const results = [
      simulatedResult({ stageType: "mountain", affinityScore: 80, adjustedScore: 75, fatigueBefore: 0.1 }),
      simulatedResult({ stageType: "highMountain", affinityScore: 60, adjustedScore: 55, fatigueBefore: 0.3 }),
      simulatedResult({ stageType: "flat", affinityScore: null, adjustedScore: null, fatigueBefore: 0 }),
    ];
    const overall = buildOverallResult(results, makeProfile());
    expect(overall.mountainAffinity).toBe(70); // (80+60)/2
    expect(overall.flatAffinity).toBeNull(); // seule étape plate est indocumentée
  });

  it("consistency : élevée si les scores ajustés sont homogènes, plus basse s'ils varient beaucoup", () => {
    const steady = [
      simulatedResult({ stageType: "flat", affinityScore: 60, adjustedScore: 60, fatigueBefore: 0.1 }),
      simulatedResult({ stageType: "flat", affinityScore: 62, adjustedScore: 61, fatigueBefore: 0.1 }),
      simulatedResult({ stageType: "flat", affinityScore: 59, adjustedScore: 60, fatigueBefore: 0.1 }),
    ];
    const erratic = [
      simulatedResult({ stageType: "flat", affinityScore: 90, adjustedScore: 90, fatigueBefore: 0.1 }),
      simulatedResult({ stageType: "flat", affinityScore: 10, adjustedScore: 10, fatigueBefore: 0.1 }),
      simulatedResult({ stageType: "flat", affinityScore: 80, adjustedScore: 80, fatigueBefore: 0.1 }),
    ];
    const steadyOverall = buildOverallResult(steady, makeProfile());
    const erraticOverall = buildOverallResult(erratic, makeProfile());
    expect(steadyOverall.consistency).toBeGreaterThan(erraticOverall.consistency);
  });

  it("fatigueManagement : meilleur (plus élevé) quand la fatigue simulée moyenne est plus basse", () => {
    const rested = [simulatedResult({ stageType: "flat", affinityScore: 60, adjustedScore: 60, fatigueBefore: 0.1 })];
    const exhausted = [simulatedResult({ stageType: "flat", affinityScore: 60, adjustedScore: 40, fatigueBefore: 0.8 })];
    expect(buildOverallResult(rested, makeProfile()).fatigueManagement).toBeGreaterThan(buildOverallResult(exhausted, makeProfile()).fatigueManagement);
  });

  it("documentationGaps recense les dimensions manquantes et leur nombre d'étapes concernées", () => {
    const results = [
      simulatedResult({ stageType: "mountain", affinityScore: 70, adjustedScore: 70, fatigueBefore: 0, missingDimensions: ["sprint", "technical"] }),
      simulatedResult({ stageType: "flat", affinityScore: 70, adjustedScore: 70, fatigueBefore: 0, missingDimensions: ["sprint"] }),
    ];
    const overall = buildOverallResult(results, makeProfile());
    const sprintGap = overall.documentationGaps.find((g) => g.dimension === "sprint");
    expect(sprintGap.stageCount).toBe(2);
    const technicalGap = overall.documentationGaps.find((g) => g.dimension === "technical");
    expect(technicalGap.stageCount).toBe(1);
  });

  it("réutilise matchArchetypes() du moteur d'archétypes existant, ne recrée pas un second système de tendance", () => {
    const overall = buildOverallResult([], makeProfile());
    expect(overall.profileArchetype).toHaveProperty("combinedLabel");
    expect(overall.profileArchetype).toHaveProperty("primary");
  });

  it("ne produit aucun classement/position absolue dans un peloton fictif", () => {
    const overall = buildOverallResult([], makeProfile());
    expect(overall).not.toHaveProperty("rank");
    expect(overall).not.toHaveProperty("position");
  });
});
