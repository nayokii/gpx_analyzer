import { describe, it, expect } from "vitest";
import { computeActivityXp, newlyCrossedTiers, XP_AMOUNTS, DISTANCE_MILESTONES_KM } from "./xp.js";
import { createEmptyActivity } from "../types.js";

function activity(overrides = {}) {
  const a = createEmptyActivity();
  return { ...a, ...overrides, flags: { ...a.flags, ...(overrides.flags || {}) } };
}

describe("newlyCrossedTiers", () => {
  it("retourne un tableau vide sans valeur", () => {
    expect(newlyCrossedTiers(null, null, [20, 40])).toEqual([]);
  });

  it("retourne tous les paliers atteints quand priorBest est absent (première activité)", () => {
    expect(newlyCrossedTiers(45, null, [20, 40, 50])).toEqual([20, 40]);
  });

  it("ne retourne que les paliers AU-DELÀ du meilleur déjà connu", () => {
    expect(newlyCrossedTiers(45, 20, [20, 40, 50])).toEqual([40]);
  });

  it("retourne un tableau vide si aucun nouveau palier n'est franchi", () => {
    expect(newlyCrossedTiers(25, 30, [20, 40])).toEqual([]);
  });
});

describe("computeActivityXp — activité simple", () => {
  it("attribue toujours l'XP de base 'sortie enregistrée'", () => {
    const result = computeActivityXp(activity({ distance: 5 }), {});
    const base = result.events.find((e) => e.type === "activity_completed");
    expect(base.xp).toBe(XP_AMOUNTS.ACTIVITY_COMPLETED);
    expect(base.reason).toBe("Sortie enregistrée");
  });

  it("la toute première activité déverrouille FIRST_RIDE", () => {
    const result = computeActivityXp(activity({ distance: 5 }), { isFirstActivityEver: true });
    const base = result.events.find((e) => e.type === "activity_completed");
    expect(base.achievementId).toBe("FIRST_RIDE");
    expect(base.reason).toBe("Première sortie enregistrée");
  });
});

describe("computeActivityXp — milestone distance", () => {
  it("franchit un palier de distance pour la première fois", () => {
    const result = computeActivityXp(activity({ distance: 25 }), { priorBestDistanceKm: null });
    const milestone = result.events.find((e) => e.type === "distance_milestone");
    expect(milestone.tier).toBe(20);
    expect(milestone.xp).toBe(XP_AMOUNTS.DISTANCE_MILESTONE);
    expect(milestone.achievementId).toBe("FIRST_20KM");
  });

  it("franchit plusieurs paliers d'un coup sur une sortie exceptionnelle", () => {
    const result = computeActivityXp(activity({ distance: 120 }), { priorBestDistanceKm: null });
    const tiers = result.events.filter((e) => e.type === "distance_milestone").map((e) => e.tier);
    expect(tiers).toEqual([20, 40, 50, 100]);
  });

  it("ne refranchit jamais un palier déjà atteint lors d'une activité précédente", () => {
    const result = computeActivityXp(activity({ distance: 25 }), { priorBestDistanceKm: 30 });
    expect(result.events.some((e) => e.type === "distance_milestone")).toBe(false);
  });

  it("un nouveau record de distance sans franchir de palier rond génère un new_best", () => {
    const result = computeActivityXp(activity({ distance: 35 }), { priorBestDistanceKm: 30 });
    expect(result.events.some((e) => e.type === "distance_milestone")).toBe(false);
    const best = result.events.find((e) => e.type === "new_best" && e.metric === "distance");
    expect(best).toBeTruthy();
    expect(best.xp).toBe(XP_AMOUNTS.NEW_BEST);
  });

  it("aucun new_best si la distance n'améliore pas le record", () => {
    const result = computeActivityXp(activity({ distance: 20 }), { priorBestDistanceKm: 30 });
    expect(result.events.some((e) => e.type === "new_best" && e.metric === "distance")).toBe(false);
  });
});

describe("computeActivityXp — milestone D+", () => {
  it("franchit un palier de D+", () => {
    const result = computeActivityXp(activity({ elevationGain: 600 }), { priorBestElevationGainM: null });
    const milestone = result.events.find((e) => e.type === "elevation_milestone" && e.tier === 500);
    expect(milestone).toBeTruthy();
    expect(milestone.achievementId).toBe("FIRST_500M_CLIMB");
  });
});

describe("computeActivityXp — milestone durée", () => {
  it("franchit le palier 2h en utilisant movingTime en priorité", () => {
    const result = computeActivityXp(activity({ movingTime: 7300, duration: 9000 }), { priorLongestDurationSec: null });
    const milestone = result.events.find((e) => e.type === "duration_milestone" && e.tier === 7200);
    expect(milestone).toBeTruthy();
    expect(milestone.achievementId).toBe("FIRST_2H_RIDE");
  });
});

describe("computeActivityXp — données insuffisantes", () => {
  it("aucun événement de milestone sans distance/D+/durée connus", () => {
    const result = computeActivityXp(activity({ distance: null, elevationGain: null, movingTime: null, duration: null }), {});
    const types = result.events.map((e) => e.type);
    expect(types).not.toContain("distance_milestone");
    expect(types).not.toContain("elevation_milestone");
    expect(types).not.toContain("duration_milestone");
    // La sortie reste enregistrée malgré tout : c'est un fait réel indépendant des autres métriques.
    expect(types).toContain("activity_completed");
  });
});

describe("computeActivityXp — puissance mesurée vs estimée", () => {
  it("puissance MESURÉE et jamais vue avant : déverrouille FIRST_MEASURED_POWER", () => {
    const result = computeActivityXp(activity({ flags: { hasPower: true, powerEstimated: false } }), { priorHasMeasuredPower: false });
    const e = result.events.find((e) => e.achievementId === "FIRST_MEASURED_POWER");
    expect(e).toBeTruthy();
  });

  it("puissance ESTIMÉE ne déclenche JAMAIS FIRST_MEASURED_POWER", () => {
    const result = computeActivityXp(activity({ flags: { hasPower: true, powerEstimated: true } }), { priorHasMeasuredPower: false });
    expect(result.events.some((e) => e.achievementId === "FIRST_MEASURED_POWER")).toBe(false);
  });

  it("puissance mesurée déjà vue avant : pas de nouveau déclenchement", () => {
    const result = computeActivityXp(activity({ flags: { hasPower: true, powerEstimated: false } }), { priorHasMeasuredPower: true });
    expect(result.events.some((e) => e.achievementId === "FIRST_MEASURED_POWER")).toBe(false);
  });
});

describe("computeActivityXp — absence de FC", () => {
  it("aucune récompense HR si hasHeartRate est faux", () => {
    const result = computeActivityXp(activity({ flags: { hasHeartRate: false } }), { priorHasHeartRate: false });
    expect(result.events.some((e) => e.achievementId === "FIRST_HEART_RATE_DATA")).toBe(false);
  });

  it("récompense HR une seule fois (première sortie avec FC)", () => {
    const result = computeActivityXp(activity({ flags: { hasHeartRate: true } }), { priorHasHeartRate: false });
    expect(result.events.some((e) => e.achievementId === "FIRST_HEART_RATE_DATA")).toBe(true);
    const again = computeActivityXp(activity({ flags: { hasHeartRate: true } }), { priorHasHeartRate: true });
    expect(again.events.some((e) => e.achievementId === "FIRST_HEART_RATE_DATA")).toBe(false);
  });
});

describe("computeActivityXp — VTT/gravel", () => {
  it("première sortie mtb déverrouille FIRST_MTB_RIDE", () => {
    const result = computeActivityXp(activity({ sportType: "mtb" }), { priorHasMtb: false });
    expect(result.events.some((e) => e.achievementId === "FIRST_MTB_RIDE")).toBe(true);
  });

  it("le cyclisme route ne déclenche jamais FIRST_MTB_RIDE", () => {
    const result = computeActivityXp(activity({ sportType: "cycling" }), { priorHasMtb: false });
    expect(result.events.some((e) => e.achievementId === "FIRST_MTB_RIDE")).toBe(false);
  });
});

describe("computeActivityXp — streak hebdomadaire", () => {
  it("ne produit un événement que si newWeeklyStreak est explicitement fourni par l'appelant", () => {
    const without = computeActivityXp(activity(), {});
    expect(without.events.some((e) => e.type === "weekly_streak_milestone")).toBe(false);

    const withStreak = computeActivityXp(activity(), { newWeeklyStreak: 2 });
    const e = withStreak.events.find((e) => e.type === "weekly_streak_milestone");
    expect(e).toBeTruthy();
    expect(e.achievementId).toBe("FIRST_WEEK_STREAK");
  });

  it("n'attribue FIRST_WEEK_STREAK qu'à la valeur 2, pas aux streaks suivants", () => {
    const result = computeActivityXp(activity(), { newWeeklyStreak: 4 });
    const e = result.events.find((e) => e.type === "weekly_streak_milestone");
    expect(e.achievementId).toBeNull();
  });
});

describe("computeActivityXp — total cohérent", () => {
  it("total = somme des xp de chaque événement", () => {
    const result = computeActivityXp(activity({ distance: 45, elevationGain: 600 }), { priorBestDistanceKm: null, priorBestElevationGainM: null });
    const sum = result.events.reduce((s, e) => s + e.xp, 0);
    expect(result.total).toBe(sum);
  });
});

describe("DISTANCE_MILESTONES_KM", () => {
  it("est trié en ordre croissant (garantit l'ordre des événements)", () => {
    const sorted = [...DISTANCE_MILESTONES_KM].sort((a, b) => a - b);
    expect(DISTANCE_MILESTONES_KM).toEqual(sorted);
  });
});
