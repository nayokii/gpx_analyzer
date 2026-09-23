import { describe, it, expect } from "vitest";
import { buildMatchingVector, availableDimensions, missingDimensions, matchingWeight, matchingInfluenceLabel } from "./archetypeProfile.js";
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

  // Phase 9D : `weight` n'est plus une copie directe de `confidence` (voir
  // archetypeProfile.js pour la justification) — c'est désormais
  // `matchingWeight(confidence)`, une transformation convexe. On vérifie donc
  // la RELATION (déterministe, testée dans matchingWeight() elle-même)
  // plutôt qu'un nombre en dur qui encoderait l'ancienne hypothèse 1:1.
  it("le poids d'une dimension disponible dérive de sa confidence 6A via matchingWeight(), jamais un recalcul depuis les données brutes", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.42),
      climbing: dim(null),
      punch: dim(null),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const vector = buildMatchingVector(profile);
    expect(vector.endurance.weight).toBe(matchingWeight(0.42));
    expect(vector.endurance.weight).toBeLessThan(0.42); // la transformation est strictement dégressive sur ]0,1[
  });

  it("expose matchingInfluence, un libellé qualitatif dérivé du même confidenceLabel qu'ailleurs dans l'app", () => {
    const profile = makeProfile({
      endurance: dim(61, 0.9, "high"),
      climbing: dim(50, 0.5, "medium"),
      punch: dim(82, 0.2, "low"),
      sprint: dim(null),
      timeTrial: dim(null),
      technical: dim(null),
    });
    const vector = buildMatchingVector(profile);
    expect(vector.endurance.matchingInfluence).toBe("forte influence");
    expect(vector.climbing.matchingInfluence).toBe("influence moyenne");
    expect(vector.punch.matchingInfluence).toBe("influence faible");
    expect(vector.sprint.matchingInfluence).toBe("données insuffisantes");
  });
});

describe("matchingWeight — Phase 9D, fiabilité du matching (tests 1-4)", () => {
  it("confidence 'high' (>=0.7) : influence quasi normale, proche de la confidence brute", () => {
    const w = matchingWeight(0.9);
    expect(w).toBeCloseTo(0.81, 5);
    expect(w / 0.9).toBeGreaterThan(0.85); // réduction < 15%
  });

  it("confidence 'medium' (0.35-0.7) : influence réduite, mais pas écrasée", () => {
    const w = matchingWeight(0.5);
    expect(w).toBeCloseTo(0.25, 5);
    const reduction = 1 - w / 0.5;
    expect(reduction).toBeGreaterThan(0.3);
    expect(reduction).toBeLessThan(0.7);
  });

  it("confidence 'low' (<0.35) : influence très faible", () => {
    const w = matchingWeight(0.2);
    expect(w).toBeCloseTo(0.04, 5);
    expect(w / 0.2).toBeLessThan(0.3); // réduction > 70%
  });

  it("confidence null/0 (insufficient_data) : influence nulle", () => {
    expect(matchingWeight(null)).toBe(0);
    expect(matchingWeight(0)).toBe(0);
  });

  it("transformation strictement monotone : une confidence plus élevée ne produit jamais un poids plus faible", () => {
    const samples = [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1];
    for (let i = 1; i < samples.length; i++) {
      expect(matchingWeight(samples[i])).toBeGreaterThanOrEqual(matchingWeight(samples[i - 1]));
    }
  });

  it("jamais de poids hors de [0,1], quelle que soit l'entrée", () => {
    for (const c of [-1, 0, 0.3, 0.99, 1, 1.5, null]) {
      const w = matchingWeight(c);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe("matchingInfluenceLabel", () => {
  it("mappe chaque confidenceLabel connu vers un libellé stable", () => {
    expect(matchingInfluenceLabel("high")).toBe("forte influence");
    expect(matchingInfluenceLabel("medium")).toBe("influence moyenne");
    expect(matchingInfluenceLabel("low")).toBe("influence faible");
    expect(matchingInfluenceLabel("insufficient_data")).toBe("données insuffisantes");
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
