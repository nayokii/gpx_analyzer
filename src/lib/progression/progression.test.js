import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeProgression, rebuildProgression, computeXpTimeline, PROGRESSION_VERSION } from "./progression.js";
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
    flags: { ...a.flags, ...(overrides.flags || {}) },
    samples: overrides.samples ?? [],
    ...overrides,
  };
}

describe("computeProgression — historique vide", () => {
  it("fonctionne sans exception, XP 0, niveau 1", () => {
    const progression = computeProgression([], null);
    expect(progression.xp).toBe(0);
    expect(progression.level).toBe(1);
    expect(progression.title).toBe("Rookie");
    expect(progression.achievements.every((a) => !a.unlocked)).toBe(true);
    expect(progression.version).toBe(PROGRESSION_VERSION);
  });
});

describe("computeProgression — profil 6A passé par l'appelant", () => {
  it("profileSnapshot est exactement l'objet profil fourni, jamais recalculé", () => {
    const activities = [activity({ distance: 25 })];
    const profile = computeCyclistProfile(activities);
    const progression = computeProgression(activities, profile);
    expect(progression.profileSnapshot).toBe(profile);
  });

  it("profileSnapshot est null si aucun profil n'est fourni", () => {
    const progression = computeProgression([activity()], null);
    expect(progression.profileSnapshot).toBeNull();
  });
});

describe("computeProgression — idempotence", () => {
  it("le même historique donne exactement la même XP à chaque appel", () => {
    const activities = [activity({ id: "a1", distance: 45, elevationGain: 600 }), activity({ id: "a2", date: "2026-06-08T08:00:00Z", distance: 30 })];
    const first = computeProgression(activities, null);
    const second = computeProgression(activities, null);
    expect(second.xp).toBe(first.xp);
    expect(second.achievements).toEqual(first.achievements);
  });

  it("dupliquer une même activité dans le tableau ne fait PAS planter le calcul (voir README : l'idempotence vient de l'architecture, pas d'un verrou)", () => {
    const a = activity({ id: "dup", distance: 25 });
    expect(() => computeProgression([a, a], null)).not.toThrow();
  });
});

describe("computeProgression — milestones distance/D+ sur plusieurs sorties", () => {
  it("chaque palier n'est crédité qu'à la sortie qui le franchit en premier, chronologiquement", () => {
    const activities = [
      activity({ id: "a1", date: "2026-06-01T08:00:00Z", distance: 25 }),
      activity({ id: "a2", date: "2026-06-08T08:00:00Z", distance: 45 }),
      activity({ id: "a3", date: "2026-06-15T08:00:00Z", distance: 22 }), // repasse sous 45 : ne refranchit rien
    ];
    const timeline = computeXpTimeline(activities);
    const milestones = timeline.filter((e) => e.type === "distance_milestone");
    expect(milestones.map((m) => ({ tier: m.tier, activityId: m.activityId }))).toEqual([
      { tier: 20, activityId: "a1" },
      { tier: 40, activityId: "a2" },
    ]);
  });

  it("l'ordre des activités dans le tableau d'entrée n'a pas d'importance (tri chronologique interne)", () => {
    const chrono = [activity({ id: "a1", date: "2026-06-01T08:00:00Z", distance: 25 }), activity({ id: "a2", date: "2026-06-08T08:00:00Z", distance: 45 })];
    const reversed = [chrono[1], chrono[0]];
    const p1 = computeProgression(chrono, null);
    const p2 = computeProgression(reversed, null);
    expect(p2.xp).toBe(p1.xp);
    expect(p2.achievements).toEqual(p1.achievements);
  });
});

describe("computeProgression — streak hebdomadaire", () => {
  it("2 semaines consécutives déverrouille FIRST_WEEK_STREAK", () => {
    const activities = [
      activity({ id: "a1", date: "2026-06-01T08:00:00Z" }), // lundi semaine 1
      activity({ id: "a2", date: "2026-06-08T08:00:00Z" }), // lundi semaine 2
    ];
    const progression = computeProgression(activities, null);
    const streak = progression.achievements.find((a) => a.id === "FIRST_WEEK_STREAK");
    expect(streak.unlocked).toBe(true);
  });

  it("une interruption de plusieurs semaines ne déverrouille rien", () => {
    const activities = [
      activity({ id: "a1", date: "2026-06-01T08:00:00Z" }),
      activity({ id: "a2", date: "2026-08-01T08:00:00Z" }),
    ];
    const progression = computeProgression(activities, null);
    const streak = progression.achievements.find((a) => a.id === "FIRST_WEEK_STREAK");
    expect(streak.unlocked).toBe(false);
  });
});

describe("computeProgression — confiance faible / dimension null du profil (transmis tel quel)", () => {
  it("n'échoue jamais même si le profil contient des dimensions insuffisantes", () => {
    const activities = [activity({ distance: 10 })];
    const profile = computeCyclistProfile(activities);
    expect(profile.dimensions.sprint.value).toBeNull();
    const progression = computeProgression(activities, profile);
    expect(progression.profileSnapshot.dimensions.sprint.value).toBeNull();
  });
});

describe("rebuildProgression", () => {
  it("recalcule aussi le profil et donne un résultat identique à un appel manuel équivalent", () => {
    const activities = [activity({ distance: 45, elevationGain: 400 })];
    const profile = computeCyclistProfile(activities);
    const manual = computeProgression(activities, profile);
    const rebuilt = rebuildProgression(activities);
    expect(rebuilt.xp).toBe(manual.xp);
    expect(rebuilt.profileSnapshot.dimensions.endurance.value).toBe(manual.profileSnapshot.dimensions.endurance.value);
  });

  it("reconstruit un état vide identique depuis un historique vide", () => {
    const rebuilt = rebuildProgression([]);
    expect(rebuilt.xp).toBe(0);
    expect(rebuilt.level).toBe(1);
  });
});

describe("progression — intégration avec le vrai fichier FIT (cold start)", () => {
  let activity1, progression;

  beforeAll(async () => {
    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    activity1 = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
    const profile = computeCyclistProfile([activity1]);
    progression = computeProgression([activity1], profile);
  });

  it("attribue de l'XP à partir de faits réels, sans planter sur une seule vraie sortie", () => {
    expect(progression.xp).toBeGreaterThan(0);
    expect(progression.activityCount).toBe(1);
  });

  it("ne déverrouille jamais FIRST_MEASURED_POWER (puissance estimée sur cette sortie réelle)", () => {
    expect(activity1.flags.powerEstimated).toBe(true);
    const achievement = progression.achievements.find((a) => a.id === "FIRST_MEASURED_POWER");
    expect(achievement.unlocked).toBe(false);
  });

  it("ne déverrouille jamais FIRST_HEART_RATE_DATA (pas de FC sur cette sortie réelle)", () => {
    expect(activity1.flags.hasHeartRate).toBe(false);
    const achievement = progression.achievements.find((a) => a.id === "FIRST_HEART_RATE_DATA");
    expect(achievement.unlocked).toBe(false);
  });

  it("déverrouille FIRST_RIDE (fait réel : c'est la seule/première sortie)", () => {
    const achievement = progression.achievements.find((a) => a.id === "FIRST_RIDE");
    expect(achievement.unlocked).toBe(true);
    expect(achievement.activityId).toBe(activity1.id);
  });

  it("les challenges actifs reflètent la vraie distance parcourue (~31 km)", () => {
    const distanceChallenge = progression.challenges.find((c) => c.id === "distance");
    expect(distanceChallenge.target).toBe(40);
    expect(distanceChallenge.current).toBeCloseTo(activity1.distance, 1);
  });
});
