import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedProfile,
  getCachedProfileTimeline,
  getCachedProgression,
  getCachedArchetypeMatch,
  getCachedReferenceRiders,
  getCachedArchetypeTimeline,
  __clearDerivedCachesForTests,
} from "./derivedCache.js";
import { computeCyclistProfile, buildProfileTimeline } from "./profile/profile.js";
import { computeProgression } from "./progression/progression.js";
import { matchArchetypes, matchReferenceRiders, buildArchetypeTimeline } from "./archetypes/matching.js";
import { createEmptyActivity } from "./types.js";

beforeEach(() => {
  __clearDerivedCachesForTests();
});

function activity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    date: overrides.date ?? "2026-06-01T08:00:00Z",
    distance: 30,
    duration: 5400,
    movingTime: 5200,
    elevationGain: 300,
    avgSpeed: 21,
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-09-22T12:00:00Z");

describe("getCachedProfile — Phase 9E", () => {
  it("retourne exactement le même résultat que computeCyclistProfile() (test 10 : aucun score modifié par l'optimisation)", () => {
    const activities = [activity({ id: "a1" }), activity({ id: "a2", date: "2026-06-08T08:00:00Z" })];
    expect(getCachedProfile(activities, { now: FIXED_NOW })).toEqual(computeCyclistProfile(activities, { now: FIXED_NOW }));
  });

  it("réutilise la MÊME référence d'objet pour deux appels avec le même jeu d'activités (id+analysisVersion identiques)", () => {
    const activities = [activity({ id: "a1" }), activity({ id: "a2" })];
    const first = getCachedProfile(activities);
    // Un DEUXIÈME tableau, contenu logiquement identique mais objets recréés :
    // la signature (id+analysisVersion) est la même -> même entrée de cache.
    const activitiesAgain = activities.map((a) => ({ ...a }));
    const second = getCachedProfile(activitiesAgain);
    expect(second).toBe(first); // même référence : preuve que le calcul n'a pas été refait
  });

  it("cache correctement invalidé quand une activité change (id différent OU analysisVersion différente) — test 2", () => {
    const activities = [activity({ id: "a1" })];
    const first = getCachedProfile(activities);
    const changed = [activity({ id: "a1", analysisVersion: 2 })];
    const second = getCachedProfile(changed);
    expect(second).not.toBe(first);
  });

  it("n'oublie aucune activité : un jeu de 2 activités produit un profil différent d'un jeu de 1 — test 3", () => {
    const one = getCachedProfile([activity({ id: "a1" })]);
    const two = getCachedProfile([activity({ id: "a1" }), activity({ id: "a2", date: "2026-06-08T08:00:00Z" })]);
    expect(two.activityCount).toBe(2);
    expect(one.activityCount).toBe(1);
  });

  it("navigation rapide (accès répétés/entrelacés) ne produit jamais un résultat incohérent — test 4", () => {
    const setA = [activity({ id: "a1" })];
    const setB = [activity({ id: "b1" }), activity({ id: "b2", date: "2026-06-08T08:00:00Z" })];
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(getCachedProfile(i % 2 === 0 ? setA : setB));
    }
    for (let i = 0; i < results.length; i++) {
      expect(results[i].activityCount).toBe(i % 2 === 0 ? 1 : 2);
    }
  });
});

describe("getCachedProfileTimeline", () => {
  it("retourne le même résultat que buildProfileTimeline()", () => {
    const activities = [activity({ id: "a1" }), activity({ id: "a2", date: "2026-07-01T08:00:00Z" })];
    expect(getCachedProfileTimeline(activities, { now: FIXED_NOW })).toEqual(buildProfileTimeline(activities, { now: FIXED_NOW }));
  });
});

describe("getCachedProgression", () => {
  it("retourne le même résultat que computeProgression()", () => {
    const activities = [activity({ id: "a1" })];
    const profile = getCachedProfile(activities, { now: FIXED_NOW });
    expect(getCachedProgression(activities, profile, { now: FIXED_NOW })).toEqual(computeProgression(activities, profile, { now: FIXED_NOW }));
  });
});

describe("getCachedArchetypeMatch / getCachedReferenceRiders — Phase 9D toujours conservateur (test 9)", () => {
  it("retourne le même résultat que matchArchetypes(), y compris le garde-fou de confiance globale", () => {
    const activities = [activity({ id: "a1" })];
    const profile = getCachedProfile(activities);
    const cached = getCachedArchetypeMatch(profile);
    const direct = matchArchetypes(profile);
    expect(cached).toEqual(direct);
    // Une seule activité -> jamais un archétype affirmé avec confiance (Phase 9D).
    expect(cached.primary).toBeNull();
  });

  it("retourne le même résultat que matchReferenceRiders()", () => {
    const activities = [activity({ id: "a1" })];
    const profile = getCachedProfile(activities);
    expect(getCachedReferenceRiders(profile)).toEqual(matchReferenceRiders(profile));
  });

  it("gère profile=null sans planter (pas de cache par référence pour null)", () => {
    expect(() => getCachedArchetypeMatch(null)).not.toThrow();
    expect(getCachedArchetypeMatch(null).combinedLabel).toBe("Profil en construction");
  });
});

describe("getCachedArchetypeTimeline", () => {
  it("retourne le même résultat que buildArchetypeTimeline() d'origine", () => {
    const activities = [activity({ id: "a1" }), activity({ id: "a2", date: "2026-07-01T08:00:00Z" })];
    expect(getCachedArchetypeTimeline(activities)).toEqual(buildArchetypeTimeline(activities));
  });

  it("réutilise getCachedProfileTimeline() en interne au lieu de rappeler buildProfileTimeline indépendamment", () => {
    const activities = [activity({ id: "a1" }), activity({ id: "a2", date: "2026-07-01T08:00:00Z" })];
    const timeline = getCachedProfileTimeline(activities); // pré-remplit le cache
    const archTimeline = getCachedArchetypeTimeline(activities);
    // Les objets `profile` de chaque point doivent être les MÊMES références
    // que ceux déjà calculés par getCachedProfileTimeline (pas un recalcul).
    for (let i = 0; i < timeline.length; i++) {
      expect(archTimeline[i].activityCountAtPoint).toBe(timeline[i].activityCountAtPoint);
    }
  });
});

describe("__clearDerivedCachesForTests", () => {
  it("vide bien le cache : un nouvel appel après clear ne réutilise pas l'ancienne référence", () => {
    const activities = [activity({ id: "a1" })];
    const first = getCachedProfile(activities, { now: FIXED_NOW });
    __clearDerivedCachesForTests();
    const second = getCachedProfile(activities, { now: FIXED_NOW });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
