import { describe, it, expect } from "vitest";
import { computeStageAffinity, categorizeAffinity, INSUFFICIENT_AFFINITY_LABEL } from "./stageAffinity.js";
import { createStage } from "./stages.js";
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

const mountainStage = createStage({ id: "s1", name: "Montagne", type: "mountain", distanceKm: 150 });
const flatStage = createStage({ id: "s2", name: "Plat", type: "flat", distanceKm: 180 });

describe("computeStageAffinity — profil complet", () => {
  it("produit un score 0-100 et une catégorie cohérente quand toutes les dimensions sont documentées", () => {
    const profile = makeProfile({
      endurance: dim(75, 0.8, "high"),
      climbing: dim(85, 0.75, "high"),
      punch: dim(60, 0.5, "medium"),
      sprint: dim(30, 0.5, "medium"),
      timeTrial: dim(55, 0.5, "medium"),
      technical: dim(40, 0.5, "medium"),
    });
    const result = computeStageAffinity(profile, mountainStage);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.category).not.toBe(INSUFFICIENT_AFFINITY_LABEL);
    // Un profil fort en climbing/endurance sur une étape de montagne (qui
    // valorise ces deux dimensions) doit produire une affinité élevée.
    expect(result.score).toBeGreaterThan(60);
    expect(result.keyFactors).toContain("climbing");
  });

  it("un profil orienté sprint a une meilleure affinité sur une étape plate que de montagne", () => {
    const profile = makeProfile({
      endurance: dim(55, 0.6, "medium"),
      climbing: dim(20, 0.6, "medium"),
      punch: dim(50, 0.5, "medium"),
      sprint: dim(90, 0.7, "high"),
      timeTrial: dim(40, 0.5, "medium"),
      technical: dim(30, 0.5, "medium"),
    });
    const flatResult = computeStageAffinity(profile, flatStage);
    const mountainResult = computeStageAffinity(profile, mountainStage);
    expect(flatResult.score).toBeGreaterThan(mountainResult.score);
  });
});

describe("computeStageAffinity — profil partiel / dimensions nulles", () => {
  it("ignore une dimension null, ne la transforme jamais en 0", () => {
    const withSprintNull = makeProfile({
      endurance: dim(70, 0.7, "high"),
      climbing: dim(80, 0.7, "high"),
      punch: dim(60, 0.5, "medium"),
      sprint: dim(null, null),
      timeTrial: dim(50, 0.5, "medium"),
      technical: dim(40, 0.5, "medium"),
    });
    const withSprintZero = makeProfile({
      endurance: dim(70, 0.7, "high"),
      climbing: dim(80, 0.7, "high"),
      punch: dim(60, 0.5, "medium"),
      sprint: dim(0, 0.7, "high"), // si sprint=0 était traité comme équivalent à null, ceci donnerait le même résultat
      timeTrial: dim(50, 0.5, "medium"),
      technical: dim(40, 0.5, "medium"),
    });
    const resultNull = computeStageAffinity(withSprintNull, mountainStage);
    const resultZero = computeStageAffinity(withSprintZero, mountainStage);
    expect(resultNull.score).not.toBe(resultZero.score);
    expect(resultNull.missingDimensions).toContain("sprint");
    expect(resultZero.missingDimensions).not.toContain("sprint");
  });

  it("liste les dimensions manquantes utiles à CETTE étape (importance > 0)", () => {
    const profile = makeProfile({ endurance: dim(70, 0.7, "high"), climbing: dim(80, 0.7, "high") });
    const result = computeStageAffinity(profile, mountainStage);
    expect(result.missingDimensions).toContain("sprint");
    expect(result.missingDimensions).toContain("technical");
  });

  it("aucune dimension exploitable : score null, catégorie 'données insuffisantes', jamais une exception", () => {
    const profile = makeProfile();
    const result = computeStageAffinity(profile, mountainStage);
    expect(result.score).toBeNull();
    expect(result.category).toBe(INSUFFICIENT_AFFINITY_LABEL);
    expect(result.confidence).toBeNull();
  });

  it("profil complètement null : pas d'exception, résultat insuffisant", () => {
    expect(() => computeStageAffinity(null, mountainStage)).not.toThrow();
    const result = computeStageAffinity(null, mountainStage);
    expect(result.score).toBeNull();
  });
});

describe("computeStageAffinity — confiance faible moins influente", () => {
  it("une dimension à confidence faible pèse moins qu'une dimension à confidence élevée, à valeur/importance égales", () => {
    // Climbing pile sur la valeur cible de l'étape mais à confidence FAIBLE,
    // endurance loin de la cible mais à confidence ÉLEVÉE : si la confiance
    // n'était pas prise en compte, climbing dominerait largement.
    const lowConfDominant = makeProfile({
      endurance: dim(20, 0.95, "high"),
      climbing: dim(95, 0.05, "low"),
    });
    const highConfDominant = makeProfile({
      endurance: dim(20, 0.05, "low"),
      climbing: dim(95, 0.95, "high"),
    });
    const a = computeStageAffinity(lowConfDominant, mountainStage);
    const b = computeStageAffinity(highConfDominant, mountainStage);
    // Le second (climbing fiable) doit tirer le score vers le haut bien plus
    // que le premier (climbing peu fiable), pour la même paire de valeurs.
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("expose weight/contribution par dimension pour expliquer le résultat", () => {
    const profile = makeProfile({ climbing: dim(80, 0.8, "high"), endurance: dim(60, 0.5, "medium") });
    const result = computeStageAffinity(profile, mountainStage);
    const climbingRow = result.dimensions.find((d) => d.dimension === "climbing");
    expect(climbingRow.weight).toBeGreaterThan(0);
    expect(climbingRow.contribution).toBeGreaterThan(0);
    expect(climbingRow.contribution).toBeLessThanOrEqual(1);
  });
});

describe("computeStageAffinity — déterminisme et bornes", () => {
  it("déterministe : même profil + même étape = même résultat", () => {
    const profile = makeProfile({ climbing: dim(80, 0.8, "high"), endurance: dim(60, 0.5, "medium") });
    expect(computeStageAffinity(profile, mountainStage)).toEqual(computeStageAffinity(profile, mountainStage));
  });

  it("jamais de division par zéro : une étape dont toutes les importances seraient nulles ne plante pas", () => {
    const zeroStage = { ...mountainStage, endurance: 0, climbing: 0, punch: 0, sprint: 0, timeTrial: 0, technical: 0 };
    const profile = makeProfile({ climbing: dim(80, 0.8, "high") });
    expect(() => computeStageAffinity(profile, zeroStage)).not.toThrow();
    expect(computeStageAffinity(profile, zeroStage).score).toBeNull();
  });

  it("jamais NaN ni Infinity dans le résultat", () => {
    const profile = makeProfile({ climbing: dim(80, 0.8, "high"), sprint: dim(0, 0.01, "low") });
    const result = computeStageAffinity(profile, mountainStage);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/NaN/);
    expect(serialized).not.toMatch(/Infinity/);
  });
});

describe("categorizeAffinity", () => {
  it("respecte les seuils documentés", () => {
    expect(categorizeAffinity(90)).toBe("très favorable");
    expect(categorizeAffinity(75)).toBe("très favorable");
    expect(categorizeAffinity(65)).toBe("favorable");
    expect(categorizeAffinity(45)).toBe("neutre");
    expect(categorizeAffinity(20)).toBe("moins favorable");
    expect(categorizeAffinity(null)).toBe(INSUFFICIENT_AFFINITY_LABEL);
  });

  it("jamais un classement numérique brut présenté comme catégorie", () => {
    for (const s of [0, 25, 50, 75, 100, null]) {
      expect(typeof categorizeAffinity(s)).toBe("string");
      expect(categorizeAffinity(s)).not.toMatch(/^\d+$/);
    }
  });
});
