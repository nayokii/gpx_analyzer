import { describe, it, expect } from "vitest";
import { simulateTour } from "./simulation.js";
import { createGenericTour, createStage } from "./stages.js";
import { STAGE_TYPE_DIMENSIONS } from "./stageTypes.js";
import { computeCyclistProfile } from "../profile/profile.js";
import { toActivity } from "../normalize.js";
import { computeAnalysis } from "../analysis.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function dim(value, confidence, confidenceLabel = "medium") {
  return { value, confidence: value == null ? null : confidence, confidenceLabel: value == null ? "insufficient_data" : confidenceLabel };
}
function makeProfile(overrides = {}) {
  const dims = {};
  for (const d of STAGE_TYPE_DIMENSIONS) dims[d] = d in overrides ? overrides[d] : dim(null, null);
  dims.consistency = dim(70, 0.6);
  return { activityCount: 6, dimensions: dims };
}

const documentedProfile = makeProfile({
  endurance: dim(70, 0.7, "high"),
  climbing: dim(60, 0.5, "medium"),
  punch: dim(65, 0.3, "low"),
  timeTrial: dim(55, 0.5, "medium"),
});

describe("simulateTour — seed obligatoire", () => {
  it("lève une erreur explicite si seed est absent", () => {
    expect(() => simulateTour({ profile: documentedProfile, stages: createGenericTour() })).toThrow(/seed/i);
  });

  it("lève une erreur explicite si stages est vide ou absent", () => {
    expect(() => simulateTour({ profile: documentedProfile, stages: [], seed: 1 })).toThrow();
    expect(() => simulateTour({ profile: documentedProfile, seed: 1 })).toThrow();
  });

  it("rejette une étape invalide plutôt que de produire un résultat silencieusement faux", () => {
    expect(() => simulateTour({ profile: documentedProfile, stages: [{ id: "bad" }], seed: 1 })).toThrow();
  });
});

describe("simulateTour — déterminisme (même seed = même résultat)", () => {
  it("deux appels avec le même seed produisent EXACTEMENT le même résultat", () => {
    const stages = createGenericTour();
    const r1 = simulateTour({ profile: documentedProfile, stages, seed: 42 });
    const r2 = simulateTour({ profile: documentedProfile, stages, seed: 42 });
    expect(r1).toEqual(r2);
  });

  it("un seed différent peut produire un résultat différent (la variance du jour n'est pas neutralisée)", () => {
    const stages = createGenericTour();
    const r1 = simulateTour({ profile: documentedProfile, stages, seed: 1 });
    const r2 = simulateTour({ profile: documentedProfile, stages, seed: 2 });
    // Pas une garantie stricte (deux seeds pourraient coïncider), mais vérifie
    // qu'au moins un score ajusté diffère sur ce jeu de données.
    const differs = r1.stageResults.some((s, i) => s.adjustedScore !== r2.stageResults[i].adjustedScore);
    expect(differs).toBe(true);
  });

  it("accepte un seed sous forme de chaîne, tout aussi déterministe", () => {
    const stages = createGenericTour();
    const r1 = simulateTour({ profile: documentedProfile, stages, seed: "mon-seed" });
    const r2 = simulateTour({ profile: documentedProfile, stages, seed: "mon-seed" });
    expect(r1).toEqual(r2);
  });
});

describe("simulateTour — ordre et cohérence des étapes", () => {
  it("les résultats sont dans le même ordre que les étapes fournies", () => {
    const stages = createGenericTour();
    const result = simulateTour({ profile: documentedProfile, stages, seed: 7 });
    expect(result.stageResults.map((r) => r.stageId)).toEqual(stages.map((s) => s.id));
  });

  it("la fatigue s'accumule globalement sur l'enchaînement (fin de Tour >= début, hors forte récupération)", () => {
    const stages = createGenericTour(); // contient plusieurs étapes difficiles enchaînées
    const result = simulateTour({ profile: documentedProfile, stages, seed: 7 });
    expect(result.stageResults[0].fatigueBefore).toBe(0);
    expect(result.stageResults[result.stageResults.length - 1].fatigueBefore).toBeGreaterThan(0);
  });
});

describe("simulateTour — profil incomplet accepté", () => {
  it("un profil avec seulement quelques dimensions documentées ne plante jamais", () => {
    const stages = createGenericTour();
    expect(() => simulateTour({ profile: documentedProfile, stages, seed: 1 })).not.toThrow();
    const result = simulateTour({ profile: documentedProfile, stages, seed: 1 });
    expect(result.stageResults).toHaveLength(6);
  });

  it("un profil totalement vide produit des étapes 'données insuffisantes', jamais une exception", () => {
    const stages = createGenericTour();
    const empty = makeProfile();
    const result = simulateTour({ profile: empty, stages, seed: 1 });
    expect(result.stageResults.every((r) => r.affinity === null)).toBe(true);
    expect(result.stageResults.every((r) => r.performanceBand === "insufficient_data")).toBe(true);
  });

  it("un profil null ne plante jamais", () => {
    const stages = createGenericTour();
    expect(() => simulateTour({ profile: null, stages, seed: 1 })).not.toThrow();
  });

  it("identifie précisément les dimensions peu documentées du Tour (consigne §12)", () => {
    const stages = createGenericTour();
    const result = simulateTour({ profile: documentedProfile, stages, seed: 1 });
    const dims = result.overall.documentationGaps.map((g) => g.dimension);
    expect(dims).toContain("sprint");
    expect(dims).toContain("technical");
  });
});

describe("simulateTour — aucune valeur NaN ou infinie", () => {
  it("sur un Tour complet avec un profil partiel", () => {
    const stages = createGenericTour();
    const result = simulateTour({ profile: documentedProfile, stages, seed: 99 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/NaN/);
    expect(serialized).not.toMatch(/Infinity/);
  });

  it("sur un Tour avec un profil totalement vide", () => {
    const stages = createGenericTour();
    const result = simulateTour({ profile: makeProfile(), stages, seed: 99 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/NaN/);
    expect(serialized).not.toMatch(/Infinity/);
  });

  it("sur un Tour très long (enchaînement de nombreuses étapes difficiles)", () => {
    const longTour = Array.from({ length: 21 }, (_, i) =>
      createStage({ id: `s${i}`, name: `Étape ${i}`, type: i % 3 === 0 ? "highMountain" : "mountain", distanceKm: 180 })
    );
    const result = simulateTour({ profile: documentedProfile, stages: longTour, seed: 1 });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(result.stageResults[20].fatigueBefore).toBeLessThanOrEqual(1);
  });
});

describe("simulateTour — intégration avec un profil réel du projet", () => {
  it("fonctionne avec le profil dérivé de la vraie fixture FIT, sans jamais modifier le profil pour faire passer le test", async () => {
    const buf = fs.readFileSync(FIXTURE_PATH);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });

    // Profil réel, calculé par le VRAI moteur (Phase 6A), jamais falsifié.
    const realProfile = computeCyclistProfile([activity]);

    const stages = createGenericTour();
    expect(() => simulateTour({ profile: realProfile, stages, seed: 123 })).not.toThrow();
    const result = simulateTour({ profile: realProfile, stages, seed: 123 });

    expect(result.stageResults).toHaveLength(6);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);

    // Sprint et technical sont insuffisants sur cette vraie sortie (voir
    // profileIntegration.test.js) -> doivent apparaître dans les lacunes de
    // documentation du Tour, jamais silencieusement ignorés.
    expect(realProfile.dimensions.sprint.value).toBeNull();
    expect(realProfile.dimensions.technical.value).toBeNull();
    const gapDims = result.overall.documentationGaps.map((g) => g.dimension);
    expect(gapDims).toContain("sprint");
    expect(gapDims).toContain("technical");

    // Déterminisme avec le vrai profil aussi.
    const result2 = simulateTour({ profile: realProfile, stages, seed: 123 });
    expect(result).toEqual(result2);
  });
});

describe("simulateTour — performance (pas de recalcul coûteux)", () => {
  it("ne déclenche aucune propriété `samples`/GPS : le résultat ne dépend que du profil et des étapes", () => {
    const stages = createGenericTour();
    // Un "profil" qui ressemble au vrai format mais sans AUCUNE activité/sample
    // sous-jacente doit produire un résultat strictement identique à un appel
    // avec le même objet dimensions — preuve que le moteur ne va jamais
    // chercher au-delà de `profile.dimensions`.
    const r1 = simulateTour({ profile: documentedProfile, stages, seed: 5 });
    const strippedProfile = { dimensions: documentedProfile.dimensions };
    const r2 = simulateTour({ profile: strippedProfile, stages, seed: 5 });
    expect(r1.stageResults).toEqual(r2.stageResults);
  });
});
