import { describe, it, expect } from "vitest";
import { buildMatchingVector, availableDimensions, missingDimensions } from "./archetypeProfile.js";
import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";

function dim(value, confidence = 0.5, confidenceLabel = "medium") {
  return { value, confidence: value == null ? null : confidence, confidenceLabel: value == null ? "insufficient_data" : confidenceLabel };
}

function makeProfile(dimensions) {
  return { dimensions: { consistency: dim(80, 0.9, "high"), ...dimensions } };
}

describe("buildMatchingVector", () => {
  it("gère un profil null sans exception, toutes dimensions absentes", () => {
    const vector = buildMatchingVector(null);
    for (const d of ARCHETYPE_DIMENSIONS) {
      expect(vector[d].value).toBeNull();
      expect(vector[d].weight).toBe(0);
    }
  });

  it("un profil complet produit un vecteur avec toutes les valeurs et poids > 0", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.3),
      climbing: dim(43, 0.2),
      punch: dim(67, 0.15),
      sprint: dim(50, 0.6),
      timeTrial: dim(40, 0.4),
      technical: dim(30, 0.5),
    });
    const vector = buildMatchingVector(profile);
    for (const d of ARCHETYPE_DIMENSIONS) {
      expect(vector[d].value).not.toBeNull();
      expect(vector[d].weight).toBeGreaterThan(0);
    }
  });

  it("une dimension à value:null a un poids de 0, jamais traitée comme 0", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.3),
      climbing: dim(null),
      punch: dim(67, 0.15),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const vector = buildMatchingVector(profile);
    expect(vector.climbing.value).toBeNull();
    expect(vector.climbing.weight).toBe(0);
    expect(vector.sprint.value).toBeNull();
  });

  it("le poids d'une dimension disponible = sa confidence 6A, pas un recalcul", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.42),
      climbing: dim(null),
      punch: dim(null),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const vector = buildMatchingVector(profile);
    expect(vector.endurance.weight).toBe(0.42);
  });
});

describe("availableDimensions / missingDimensions", () => {
  it("se complètent exactement sur les 6 dimensions de style", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.3),
      climbing: dim(null),
      punch: dim(67, 0.15),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const vector = buildMatchingVector(profile);
    const available = availableDimensions(vector);
    const missing = missingDimensions(vector);
    expect(available.sort()).toEqual(["endurance", "punch"]);
    expect([...available, ...missing].sort()).toEqual([...ARCHETYPE_DIMENSIONS].sort());
  });

  it("profil vide : aucune dimension disponible, toutes manquantes", () => {
    const vector = buildMatchingVector(null);
    expect(availableDimensions(vector)).toEqual([]);
    expect(missingDimensions(vector).sort()).toEqual([...ARCHETYPE_DIMENSIONS].sort());
  });
});
