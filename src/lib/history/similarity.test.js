import { describe, it, expect } from "vitest";
import { similarityScore, findSimilarActivities, looksLikeSameRoute, groupActivitiesByRoute } from "./similarity.js";

function activity(overrides = {}) {
  return {
    id: overrides.id || "a1",
    distance: 30,
    elevationGain: 300,
    duration: 5400,
    gpsTrack: [],
    samples: [],
    ...overrides,
  };
}

describe("similarityScore", () => {
  it("retourne un score bas (proche de 0) pour deux sorties très proches", () => {
    const a = activity({ id: "a", distance: 30, elevationGain: 300, duration: 5400, gpsTrack: [{ lat: 48.85, lon: 2.35 }] });
    const b = activity({ id: "b", distance: 31, elevationGain: 310, duration: 5460, gpsTrack: [{ lat: 48.851, lon: 2.351 }] });
    const sim = similarityScore(a, b);
    expect(sim.comparable).toBe(true);
    expect(sim.score).toBeLessThan(0.1);
  });

  it("retourne un score élevé pour deux sorties très différentes", () => {
    const a = activity({ id: "a", distance: 20, elevationGain: 100, duration: 3600, gpsTrack: [{ lat: 48.85, lon: 2.35 }] });
    const b = activity({ id: "b", distance: 120, elevationGain: 2000, duration: 21600, gpsTrack: [{ lat: 45.0, lon: 6.0 }] });
    const sim = similarityScore(a, b);
    expect(sim.comparable).toBe(true);
    expect(sim.score).toBeGreaterThan(0.5);
  });

  it("reste calculable sans données GPS (se rabat sur distance/D+/allure)", () => {
    const a = activity({ id: "a", distance: 30, elevationGain: 300, duration: 5400, gpsTrack: [], samples: [] });
    const b = activity({ id: "b", distance: 31, elevationGain: 310, duration: 5460, gpsTrack: [], samples: [] });
    const sim = similarityScore(a, b);
    expect(sim.comparable).toBe(true);
    expect(sim.startDistanceKm).toBeNull();
    expect(sim.score).toBeLessThan(0.1);
  });

  it("marque non comparable quand aucun critère n'est disponible des deux côtés", () => {
    const a = activity({ id: "a", distance: null, elevationGain: null, duration: null, gpsTrack: [], samples: [] });
    const b = activity({ id: "b", distance: null, elevationGain: null, duration: null, gpsTrack: [], samples: [] });
    const sim = similarityScore(a, b);
    expect(sim.comparable).toBe(false);
    expect(sim.score).toBeNull();
  });

  it("le score n'est pas symétrique en présentation mais la distance relative l'est", () => {
    const a = activity({ id: "a", distance: 20 });
    const b = activity({ id: "b", distance: 40 });
    expect(similarityScore(a, b).score).toBeCloseTo(similarityScore(b, a).score, 6);
  });
});

describe("findSimilarActivities", () => {
  const target = activity({ id: "target", distance: 30, elevationGain: 300, duration: 5400 });
  const close = activity({ id: "close", distance: 31, elevationGain: 305, duration: 5500 });
  const far = activity({ id: "far", distance: 100, elevationGain: 1500, duration: 18000 });

  it("retient les sorties proches et écarte les sorties trop différentes", () => {
    const results = findSimilarActivities(target, [close, far]);
    expect(results.map((r) => r.activity.id)).toEqual(["close"]);
  });

  it("s'exclut elle-même si présente dans la liste candidate", () => {
    const results = findSimilarActivities(target, [target, close]);
    expect(results.map((r) => r.activity.id)).toEqual(["close"]);
  });

  it("trie par score croissant (le plus proche en premier)", () => {
    const midway = activity({ id: "midway", distance: 35, elevationGain: 350, duration: 6200 });
    const results = findSimilarActivities(target, [midway, close], { maxScore: 1 });
    expect(results[0].activity.id).toBe("close");
  });

  it("respecte la limite de résultats", () => {
    const many = Array.from({ length: 5 }, (_, i) => activity({ id: `s${i}`, distance: 30 + i * 0.1 }));
    const results = findSimilarActivities(target, many, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("retourne un tableau vide si les données GPS/distance sont totalement absentes des deux côtés", () => {
    const emptyTarget = activity({ id: "t", distance: null, elevationGain: null, duration: null });
    const emptyCandidate = activity({ id: "c", distance: null, elevationGain: null, duration: null });
    expect(findSimilarActivities(emptyTarget, [emptyCandidate])).toEqual([]);
  });
});

describe("looksLikeSameRoute", () => {
  it("détecte un parcours probablement identique (distance/D+/départ proches)", () => {
    const a = activity({ id: "a", distance: 30, elevationGain: 300, duration: 5400, gpsTrack: [{ lat: 48.85, lon: 2.35 }] });
    const b = activity({ id: "b", distance: 30.5, elevationGain: 310, duration: 5500, gpsTrack: [{ lat: 48.851, lon: 2.3505 }] });
    expect(looksLikeSameRoute(a, b).same).toBe(true);
  });

  it("rejette si le point de départ est trop éloigné même avec distance/D+ proches", () => {
    const a = activity({ id: "a", distance: 30, elevationGain: 300, gpsTrack: [{ lat: 48.85, lon: 2.35 }] });
    const b = activity({ id: "b", distance: 30, elevationGain: 300, gpsTrack: [{ lat: 45.75, lon: 4.83 }] }); // Lyon, loin de Paris
    const result = looksLikeSameRoute(a, b);
    expect(result.same).toBe(false);
  });

  it("refuse de conclure sans position de départ connue", () => {
    const a = activity({ id: "a", distance: 30, elevationGain: 300, gpsTrack: [] });
    const b = activity({ id: "b", distance: 30, elevationGain: 300, gpsTrack: [] });
    const result = looksLikeSameRoute(a, b);
    expect(result.same).toBe(false);
    expect(result.reason).toMatch(/départ/i);
  });
});

describe("groupActivitiesByRoute", () => {
  it("regroupe les sorties répétées sur le même parcours et ignore les sorties isolées", () => {
    const routeA1 = activity({ id: "routeA-1", distance: 30, elevationGain: 300, gpsTrack: [{ lat: 48.85, lon: 2.35 }] });
    const routeA2 = activity({ id: "routeA-2", distance: 30.2, elevationGain: 305, gpsTrack: [{ lat: 48.8505, lon: 2.3502 }] });
    const routeA3 = activity({ id: "routeA-3", distance: 29.8, elevationGain: 295, gpsTrack: [{ lat: 48.8498, lon: 2.3498 }] });
    const isolated = activity({ id: "isolated", distance: 80, elevationGain: 1200, gpsTrack: [{ lat: 45.0, lon: 6.0 }] });

    const groups = groupActivitiesByRoute([routeA1, routeA2, routeA3, isolated]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((a) => a.id).sort()).toEqual(["routeA-1", "routeA-2", "routeA-3"]);
  });

  it("ne retourne aucun groupe si toutes les sorties sont différentes", () => {
    const activities = [
      activity({ id: "a", distance: 20, gpsTrack: [{ lat: 48.85, lon: 2.35 }] }),
      activity({ id: "b", distance: 60, gpsTrack: [{ lat: 45.0, lon: 6.0 }] }),
      activity({ id: "c", distance: 100, gpsTrack: [{ lat: 43.3, lon: 5.4 }] }),
    ];
    expect(groupActivitiesByRoute(activities)).toEqual([]);
  });
});
