import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchArchetypes, matchReferenceRiders, buildArchetypeTimeline, similarityLabel } from "./matching.js";
import { ARCHETYPE_DIMENSIONS } from "./archetypes.js";
import { computeCyclistProfile } from "../profile/profile.js";
import { createEmptyActivity } from "../types.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function dim(value, confidence = 0.6, confidenceLabel = "medium") {
  return { value, confidence: value == null ? null : confidence, confidenceLabel: value == null ? "insufficient_data" : confidenceLabel };
}

function makeProfile(dimensions, confidence = 0.6) {
  const full = {};
  for (const d of ARCHETYPE_DIMENSIONS) {
    full[d] = d in dimensions ? dim(dimensions[d], confidence) : dim(null);
  }
  full.consistency = dim(70, confidence);
  return { dimensions: full };
}

describe("matchArchetypes — profil vide/null", () => {
  it("profil null : Profil en construction, aucune dimension disponible", () => {
    const result = matchArchetypes(null);
    expect(result.primary).toBeNull();
    expect(result.combinedLabel).toBe("Profil en construction");
    expect(result.insufficientDimensions.sort()).toEqual([...ARCHETYPE_DIMENSIONS].sort());
  });

  it("profil avec toutes les dimensions à null : même résultat que null", () => {
    const result = matchArchetypes(makeProfile({}));
    expect(result.primary).toBeNull();
    expect(result.combinedLabel).toBe("Profil en construction");
  });
});

describe("matchArchetypes — profil partiel", () => {
  it("2 dimensions seulement : produit quand même un résultat, jamais une exception", () => {
    const result = matchArchetypes(makeProfile({ climbing: 88, endurance: 78 }));
    expect(() => result).not.toThrow();
    expect(result.insufficientDimensions).toContain("sprint");
    expect(result.insufficientDimensions).toContain("technical");
  });

  it("la confiance reste basse avec peu de dimensions disponibles", () => {
    const result = matchArchetypes(makeProfile({ climbing: 88 }, 0.9));
    expect(result.confidence.label).not.toBe("high");
  });
});

describe("matchArchetypes — profil complet, dimensions identiques à un archétype", () => {
  it("un profil calqué exactement sur l'archétype grimpeur produit une closeness proche de 1 et ce grimpeur en primaire", () => {
    const result = matchArchetypes(makeProfile({ endurance: 80, climbing: 92, punch: 50, sprint: 20, timeTrial: 50, technical: 35 }, 0.8));
    expect(result.primary.id).toBe("climber");
    expect(result.primary.closeness).toBeGreaterThan(0.95);
  });
});

describe("matchArchetypes — dimensions très différentes", () => {
  it("un profil délibérément opposé au grimpeur (sprint dominant, climbing minimal) ne matche PAS le grimpeur en primaire", () => {
    const result = matchArchetypes(makeProfile({ endurance: 20, climbing: 5, punch: 95, sprint: 98, timeTrial: 15, technical: 15 }, 0.8));
    expect(result.primary.id).not.toBe("climber");
  });

  it("un profil très proche d'un archétype a une closeness nettement supérieure à un profil éloigné de ce même archétype", () => {
    const climberLike = matchArchetypes(makeProfile({ endurance: 80, climbing: 90, punch: 50, sprint: 20, timeTrial: 50, technical: 35 }, 0.8));
    const opposite = matchArchetypes(makeProfile({ endurance: 20, climbing: 5, punch: 95, sprint: 98, timeTrial: 15, technical: 15 }, 0.8));
    const climberScoreInOpposite = opposite.allScores.find((s) => s.id === "climber").closeness;
    const climberScoreInMatch = climberLike.allScores.find((s) => s.id === "climber").closeness;
    expect(climberScoreInMatch).toBeGreaterThan(climberScoreInOpposite);
  });
});

describe("matchArchetypes — secondaire / indéterminé", () => {
  it("un profil équilibré peut ne pas déclencher de secondaire s'il n'y a pas de deuxième archétype assez proche", () => {
    const result = matchArchetypes(makeProfile({ endurance: 80, climbing: 92, punch: 50, sprint: 20, timeTrial: 50, technical: 35 }, 0.8));
    // Le climbing pur ci-dessus est loin de tous les autres archétypes -> pas de secondaire honnête.
    expect(result.secondary).toBeNull();
  });

  it("ne force jamais un secondaire artificiellement proche du primaire", () => {
    const result = matchArchetypes(makeProfile({ endurance: 61, climbing: 43, punch: 67, sprint: 30, timeTrial: 40, technical: 30 }, 0.6));
    if (result.secondary) {
      expect(result.secondary.closeness).toBeGreaterThanOrEqual(result.primary.closeness * 0.85);
    }
  });
});

describe("matchArchetypes — déterminisme", () => {
  it("le même profil produit exactement le même résultat à chaque appel", () => {
    const profile = makeProfile({ endurance: 61, climbing: 43, punch: 67 }, 0.5);
    const a = matchArchetypes(profile);
    const b = matchArchetypes(profile);
    expect(a).toEqual(b);
  });
});

describe("matchReferenceRiders — données insuffisantes", () => {
  it("aucune dimension disponible : liste vide, jamais un faux score", () => {
    expect(matchReferenceRiders(makeProfile({}))).toEqual([]);
    expect(matchReferenceRiders(null)).toEqual([]);
  });

  it("moins de dimensions communes que minMatchedDimensions : exclu des résultats", () => {
    const results = matchReferenceRiders(makeProfile({ climbing: 90 }, 0.8), { minMatchedDimensions: 2 });
    expect(results.every((r) => r.matchedDimensions.length >= 2)).toBe(true);
  });
});

describe("matchReferenceRiders — null ignorés, pas de pénalité", () => {
  it("une dimension null côté coureur n'entre jamais dans matchedDimensions", () => {
    const results = matchReferenceRiders(makeProfile({ endurance: 80, climbing: 90, technical: 50 }, 0.7));
    const quintana = results.find((r) => r.rider.id === "nairo-quintana");
    // Quintana n'a pas de dimension technical documentée (null) -> jamais comptée.
    expect(quintana.matchedDimensions).not.toContain("technical");
  });
});

describe("matchReferenceRiders / matchArchetypes — pondération par confiance faible", () => {
  it("une dimension à faible confiance pèse moins qu'une dimension à confiance élevée dans le score final", () => {
    // Comparé à l'archétype grimpeur (endurance 80, climbing 92) : endurance
    // pile juste à confiance FORTE, climbing très éloigné à confiance FAIBLE.
    const dominantGoodMatch = makeProfile({}, 0.5);
    dominantGoodMatch.dimensions.endurance = dim(80, 0.95);
    dominantGoodMatch.dimensions.climbing = dim(10, 0.05); // très éloigné de 92, mais quasiment sans poids

    // Même profil mais avec les poids inversés (climbing éloigné pèse maintenant fort).
    const dominantBadMatch = makeProfile({}, 0.5);
    dominantBadMatch.dimensions.endurance = dim(80, 0.05);
    dominantBadMatch.dimensions.climbing = dim(10, 0.95);

    // allScores n'est jamais filtré par un seuil d'affichage : comparaison directe de la pondération, sans interférence du filtre "Profil éloigné".
    const goodScore = matchArchetypes(dominantGoodMatch).allScores.find((s) => s.id === "climber").closeness;
    const badScore = matchArchetypes(dominantBadMatch).allScores.find((s) => s.id === "climber").closeness;
    expect(goodScore).toBeGreaterThan(badScore);
  });
});

describe("matchReferenceRiders — tri et déterminisme", () => {
  it("les résultats sont triés par similarité décroissante", () => {
    const results = matchReferenceRiders(makeProfile({ endurance: 90, climbing: 92, punch: 50, sprint: 20, timeTrial: 50, technical: 30 }, 0.7));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
    }
  });

  it("un profil clairement grimpeur classe des grimpeurs déclarés devant des sprinteurs déclarés", () => {
    const results = matchReferenceRiders(makeProfile({ endurance: 90, climbing: 92, punch: 50, sprint: 15, timeTrial: 45, technical: 25 }, 0.7));
    const rank = (id) => results.findIndex((r) => r.rider.id === id);
    expect(rank("jonas-vingegaard")).toBeGreaterThanOrEqual(0);
    expect(rank("mark-cavendish")).toBeGreaterThanOrEqual(0);
    expect(rank("jonas-vingegaard")).toBeLessThan(rank("mark-cavendish"));
  });

  it("le même profil produit exactement le même classement à chaque appel", () => {
    const profile = makeProfile({ endurance: 61, climbing: 43, punch: 67, sprint: 30 }, 0.5);
    const a = matchReferenceRiders(profile);
    const b = matchReferenceRiders(profile);
    expect(a).toEqual(b);
  });
});

describe("matchReferenceRiders — explication cohérente", () => {
  it("chaque résultat a une explication non vide mentionnant le nom du coureur et le rappel de non-performance", () => {
    const results = matchReferenceRiders(makeProfile({ endurance: 90, climbing: 92, punch: 50, sprint: 15, timeTrial: 45, technical: 25 }, 0.7));
    for (const r of results) {
      expect(r.explanation.length).toBeGreaterThan(0);
      expect(r.explanation.some((s) => s.includes(r.rider.name))).toBe(true);
      expect(r.explanation.some((s) => s.includes("pas sur le niveau de performance"))).toBe(true);
    }
  });
});

describe("similarityLabel — pas de fausse précision", () => {
  it("ne retourne jamais un pourcentage, seulement un libellé qualitatif", () => {
    for (const v of [0, 0.2, 0.5, 0.7, 0.9, 1]) {
      expect(similarityLabel(v)).not.toMatch(/%/);
      expect(typeof similarityLabel(v)).toBe("string");
    }
  });

  it("classe correctement les paliers", () => {
    expect(similarityLabel(0.9)).toBe("Profil très proche");
    expect(similarityLabel(0.7)).toBe("Profil proche");
    expect(similarityLabel(0.45)).toBe("Profil partiellement proche");
    expect(similarityLabel(0.1)).toBe("Profil éloigné");
    expect(similarityLabel(null)).toBe("Profil insuffisant");
  });
});

describe("buildArchetypeTimeline", () => {
  it("historique vide : tableau vide", () => {
    expect(buildArchetypeTimeline([])).toEqual([]);
  });

  function activity(overrides = {}) {
    const a = createEmptyActivity();
    return { ...a, id: overrides.id || "a1", date: overrides.date ?? "2026-06-01T08:00:00Z", ...overrides };
  }

  it("un seul point d'historique : un seul point de timeline, avec un match calculé", () => {
    const timeline = buildArchetypeTimeline([activity({ distance: 30, elevationGain: 300, movingTime: 5400 })]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].match).toBeTruthy();
    expect(timeline[0].activityCountAtPoint).toBe(1);
  });

  it("plusieurs mois : un point par mois, cumulatif", () => {
    const activities = [
      activity({ id: "a", date: "2026-06-05T08:00:00Z" }),
      activity({ id: "b", date: "2026-07-05T08:00:00Z" }),
    ];
    const timeline = buildArchetypeTimeline(activities);
    expect(timeline.length).toBe(2);
    expect(timeline[1].activityCountAtPoint).toBe(2);
  });
});

describe("archétypes/matching — intégration avec le vrai fichier FIT (cold start)", () => {
  let profile, matchResult, riderResults;

  beforeAll(async () => {
    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity1 = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
    profile = computeCyclistProfile([activity1]);
    matchResult = matchArchetypes(profile);
    riderResults = matchReferenceRiders(profile);
  });

  it("ne plante jamais sur une seule vraie sortie", () => {
    expect(() => matchArchetypes(profile)).not.toThrow();
    expect(() => matchReferenceRiders(profile)).not.toThrow();
  });

  it("la confiance du matching n'est jamais 'high' avec une seule sortie", () => {
    expect(matchResult.confidence.label).not.toBe("high");
  });

  it("les dimensions insuffisantes du profil réel (sprint, technical) apparaissent bien comme manquantes", () => {
    expect(profile.dimensions.sprint.value).toBeNull();
    expect(profile.dimensions.technical.value).toBeNull();
    expect(matchResult.insufficientDimensions).toContain("sprint");
    expect(matchResult.insufficientDimensions).toContain("technical");
  });

  it("si des coureurs de référence sont proposés, chacun a une explication et une liste de dimensions manquantes cohérente", () => {
    for (const r of riderResults) {
      expect(r.explanation.length).toBeGreaterThan(0);
      expect(Array.isArray(r.missingDimensions)).toBe(true);
    }
  });

  // Phase 9D — tests 9/10/12 (consigne §21) : sur les vraies données, jamais
  // de score hors [0,100], et une dimension estimée (voir activity.flags.powerEstimated
  // === true pour ce fixture, confirmé par profileIntegration.test.js) ne
  // devient jamais accidentellement "measured" au niveau du vecteur de matching.
  it("toutes les valeurs du vecteur de matching restent dans [0,100] (jamais 110, -5...)", () => {
    for (const d of ARCHETYPE_DIMENSIONS) {
      const v = matchResult.vector[d].value;
      if (v == null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("punch (seul signal possible sans capteur puissance sur ce fixture) n'est jamais étiqueté dataQuality='measured'", () => {
    expect(profile.dimensions.punch.value == null || profile.dimensions.punch.dataQuality !== "measured").toBe(true);
  });
});

describe("matchArchetypes — Phase 9D, garde-fou de confiance globale", () => {
  it("test 5 — Punch élevé (82) à confidence faible sur toutes les dimensions dispo : jamais un archétype affirmatif", () => {
    // Reproduit exactement l'exemple de la consigne : endurance/climbing/punch/TT
    // dispo mais tous 'low', sprint/technical absents.
    const profile = makeProfile({ endurance: 61, climbing: 43, punch: 82, timeTrial: 40 }, 0.2);
    const result = matchArchetypes(profile);
    expect(result.primary).toBeNull();
    expect(result.combinedLabel).toBe("Profil indéterminé");
    expect(result.confidence.label).toBe("low");
  });

  it("test 6 — Punch élevé à confidence haute, avec un profil globalement bien documenté : peut réellement déterminer l'archétype", () => {
    const profile = makeProfile({ endurance: 50, climbing: 65, punch: 92, sprint: 65, timeTrial: 50, technical: 50 }, 0.85);
    const result = matchArchetypes(profile);
    expect(result.primary).not.toBeNull();
    expect(result.primary.id).toBe("puncheur");
    expect(result.confidence.label).not.toBe("low");
  });

  it("test 7 — une seule dimension forte disponible, le reste insuffisant : système conservateur quelle que soit sa confidence", () => {
    // Punch seul, même à confidence ÉLEVÉE : la couverture (1/6) plafonne à elle
    // seule la confiance globale du matching sous le seuil 'low' (voir
    // archetypes/confidence.js, déjà testé indépendamment) -> jamais de primary.
    const profile = makeProfile({ punch: 95 }, 0.95);
    const result = matchArchetypes(profile);
    expect(result.primary).toBeNull();
    expect(result.combinedLabel).toBe("Profil indéterminé");
  });

  it("test 13 — l'explication du profil indéterminé mentionne les dimensions disponibles et celles manquantes, sans jamais affirmer un archétype", () => {
    const profile = makeProfile({ punch: 95 }, 0.95);
    const result = matchArchetypes(profile);
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation.some((s) => s.toLowerCase().includes("punch"))).toBe(true);
    expect(result.explanation.join(" ")).not.toMatch(/puncheur|grimpeur|sprinteur|rouleur/i);
  });

  it("test 13 — quand un archétype est affirmé, une dimension à confidence faible parmi les disponibles est explicitement signalée comme peu influente", () => {
    const profile = makeProfile({ endurance: 80, climbing: 90, punch: 50, sprint: 20, timeTrial: 50, technical: 35 }, 0.9);
    profile.dimensions.punch = dim(82, 0.15, "low"); // une dimension isolée à confidence faible parmi 6 bien documentées
    const result = matchArchetypes(profile);
    expect(result.primary).not.toBeNull();
    expect(result.explanation.some((s) => s.includes("punch") && s.toLowerCase().includes("limitée"))).toBe(true);
  });

  it("le vecteur de matching complet (avec weight/matchingInfluence) est exposé pour l'UI (\"Pourquoi ce profil ?\")", () => {
    const profile = makeProfile({ endurance: 61, climbing: 43, punch: 67 }, 0.5);
    const result = matchArchetypes(profile);
    expect(result.vector).toBeTruthy();
    expect(result.vector.endurance.weight).toBeGreaterThan(0);
    expect(typeof result.vector.endurance.matchingInfluence).toBe("string");
  });

  it("déterministe : le garde-fou de confiance globale ne casse pas l'idempotence du matching", () => {
    const profile = makeProfile({ punch: 95 }, 0.95);
    expect(matchArchetypes(profile)).toEqual(matchArchetypes(profile));
  });
});
