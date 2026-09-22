import { describe, it, expect } from "vitest";
import { computeChallenges } from "./challenges.js";
import { createEmptyActivity } from "../types.js";

const NOW = new Date("2026-06-15T12:00:00Z");

function activity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "a1",
    date: overrides.date ?? "2026-06-01T08:00:00Z",
    distance: overrides.distance ?? null,
    elevationGain: overrides.elevationGain ?? null,
    movingTime: overrides.movingTime ?? null,
    duration: overrides.duration ?? null,
    samples: overrides.samples ?? [],
    ...overrides,
  };
}

function findChallenge(challenges, id) {
  return challenges.find((c) => c.id === id);
}

// Points synthétiques produisant un effort "punch" détectable (repris du
// motif déjà validé dans analytics/efforts.test.js et profile/activitySignals.test.js) :
// roulage tranquille à 100 W, effort de ~90 s à 320 W, retour au calme.
function punchyRideSamples() {
  const points = [];
  let t = 0;
  for (let i = 0; i < 10; i++, t += 10) points.push({ t, lat: i * 0.0005, lon: 0, power: 100 });
  for (let i = 0; i < 9; i++, t += 10) points.push({ t, lat: 0.005 + i * 0.001, lon: 0, power: 320 });
  for (let i = 0; i < 10; i++, t += 10) points.push({ t, lat: 0.015 + i * 0.0005, lon: 0, power: 100 });
  return points.map((p) => ({
    timestamp: new Date(p.t * 1000).toISOString(),
    latitude: p.lat,
    longitude: p.lon,
    altitude: null,
    heartRate: null,
    cadence: null,
    power: p.power,
    temperature: null,
    distanceMeasured: null,
    speedMeasured: null,
  }));
}

describe("computeChallenges — historique vide", () => {
  it("propose le premier palier de chaque catégorie, current à 0", () => {
    const challenges = computeChallenges([], { now: NOW });
    expect(findChallenge(challenges, "distance")).toMatchObject({ target: 20, current: 0 });
    expect(findChallenge(challenges, "elevation")).toMatchObject({ target: 300, current: 0 });
    expect(findChallenge(challenges, "endurance")).toMatchObject({ target: 7200, current: 0 });
    expect(findChallenge(challenges, "consistency")).toMatchObject({ target: 2, current: 0 });
    expect(findChallenge(challenges, "climb_accumulation")).toMatchObject({ target: 300, current: 0 });
    expect(findChallenge(challenges, "punch_effort")).toMatchObject({ target: 3, current: 0 });
  });
});

describe("computeChallenges — progression", () => {
  it("current reflète le meilleur déjà réalisé, plafonné au palier visé", () => {
    const challenges = computeChallenges([activity({ distance: 25 })], { now: NOW });
    expect(findChallenge(challenges, "distance")).toMatchObject({ target: 40, current: 25 });
  });

  it("passe au palier suivant une fois un palier dépassé", () => {
    const challenges = computeChallenges([activity({ distance: 45 })], { now: NOW });
    expect(findChallenge(challenges, "distance")).toMatchObject({ target: 50, current: 45 });
  });

  it("ne propose plus de challenge de distance une fois tous les paliers dépassés", () => {
    const challenges = computeChallenges([activity({ distance: 250 })], { now: NOW });
    expect(findChallenge(challenges, "distance")).toBeUndefined();
  });

  it("l'endurance disparaît une fois la barre des 2h dépassée", () => {
    const under = computeChallenges([activity({ movingTime: 5000 })], { now: NOW });
    expect(findChallenge(under, "endurance")).toBeTruthy();
    const over = computeChallenges([activity({ movingTime: 7300 })], { now: NOW });
    expect(findChallenge(over, "endurance")).toBeUndefined();
  });
});

describe("computeChallenges — régularité (mois en cours)", () => {
  it("compte les semaines distinctes du mois en cours uniquement", () => {
    const challenges = computeChallenges(
      [
        activity({ id: "a", date: "2026-06-01T08:00:00Z" }), // semaine 1
        activity({ id: "b", date: "2026-06-10T08:00:00Z" }), // semaine 2
        activity({ id: "c", date: "2026-05-01T08:00:00Z" }), // mois précédent, ignoré
      ],
      { now: NOW }
    );
    expect(findChallenge(challenges, "consistency")).toMatchObject({ target: 3, current: 2 });
  });
});

describe("computeChallenges — grimpe accumulée (personnalisé, 30 jours)", () => {
  it("somme le D+ des sorties récentes uniquement", () => {
    const challenges = computeChallenges(
      [
        activity({ id: "recent", date: "2026-06-10T08:00:00Z", elevationGain: 200 }),
        activity({ id: "old", date: "2026-01-01T08:00:00Z", elevationGain: 1000 }), // hors fenêtre de 30 jours
      ],
      { now: NOW }
    );
    const c = findChallenge(challenges, "climb_accumulation");
    expect(c.current).toBe(200);
    expect(c.target).toBe(300);
    expect(c.personalized).toBe(true);
  });

  it("n'utilise PAS le score de la dimension climbing (volume, pas rythme de montée)", () => {
    const challenges = computeChallenges([activity({ date: "2026-06-10T08:00:00Z", elevationGain: 250 })], { now: NOW });
    // Le challenge doit refléter le D+ brut (250), jamais un indice climbing recalculé séparément.
    expect(findChallenge(challenges, "climb_accumulation").current).toBe(250);
  });
});

describe("computeChallenges — punch (personnalisé, réutilise activitySignals)", () => {
  it("compte les efforts courts détectés sur les sorties récentes", () => {
    const challenges = computeChallenges(
      [activity({ id: "punchy", date: "2026-06-10T08:00:00Z", samples: punchyRideSamples() })],
      { now: NOW }
    );
    const c = findChallenge(challenges, "punch_effort");
    expect(c.current).toBeGreaterThanOrEqual(1);
    expect(c.personalized).toBe(true);
  });

  it("ignore les efforts hors de la fenêtre de 30 jours", () => {
    const challenges = computeChallenges(
      [activity({ id: "old-punchy", date: "2026-01-01T08:00:00Z", samples: punchyRideSamples() })],
      { now: NOW }
    );
    expect(findChallenge(challenges, "punch_effort").current).toBe(0);
  });
});

describe("computeChallenges — déterminisme (idempotence)", () => {
  it("le même historique produit exactement les mêmes challenges à chaque appel", () => {
    const activities = [activity({ distance: 25, elevationGain: 350 })];
    const a = computeChallenges(activities, { now: NOW });
    const b = computeChallenges(activities, { now: NOW });
    expect(a).toEqual(b);
  });
});
