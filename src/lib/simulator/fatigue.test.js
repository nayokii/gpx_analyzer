import { describe, it, expect } from "vitest";
import { createInitialFatigueState, computeStageFatigue, applyRecovery, fatiguePenalty } from "./fatigue.js";
import { createStage } from "./stages.js";

const easyStage = createStage({ id: "e", name: "Facile", type: "flat", distanceKm: 100, difficulty: 0.2 });
const hardStage = createStage({ id: "h", name: "Dur", type: "highMountain", distanceKm: 180, difficulty: 0.9 });

describe("createInitialFatigueState", () => {
  it("part de zéro", () => {
    expect(createInitialFatigueState()).toEqual({ fatigue: 0, consecutiveDifficultDays: 0 });
  });
});

describe("computeStageFatigue — la fatigue augmente après une étape", () => {
  it("depuis un état frais, une étape difficile augmente la fatigue au-dessus de 0", () => {
    const result = computeStageFatigue(hardStage, createInitialFatigueState());
    expect(result.fatigue).toBeGreaterThan(0);
  });

  it("une étape plus difficile augmente davantage la fatigue qu'une étape facile, à état de départ égal", () => {
    const afterEasy = computeStageFatigue(easyStage, createInitialFatigueState());
    const afterHard = computeStageFatigue(hardStage, createInitialFatigueState());
    expect(afterHard.fatigue).toBeGreaterThan(afterEasy.fatigue);
  });

  it("compte les étapes difficiles consécutives, remet le compteur à zéro sur une étape facile", () => {
    let state = createInitialFatigueState();
    state = computeStageFatigue(hardStage, state);
    expect(state.consecutiveDifficultDays).toBe(1);
    state = computeStageFatigue(hardStage, state);
    expect(state.consecutiveDifficultDays).toBe(2);
    state = computeStageFatigue(easyStage, state);
    expect(state.consecutiveDifficultDays).toBe(0);
  });

  it("le compteur de jours consécutifs est plafonné (borne documentée)", () => {
    let state = createInitialFatigueState();
    for (let i = 0; i < 20; i++) state = computeStageFatigue(hardStage, state);
    expect(state.consecutiveDifficultDays).toBeLessThanOrEqual(4);
  });
});

describe("computeStageFatigue — bornes respectées", () => {
  it("la fatigue reste toujours dans [0,1], même après de nombreuses étapes très difficiles d'affilée", () => {
    let state = createInitialFatigueState();
    for (let i = 0; i < 30; i++) {
      state = computeStageFatigue(hardStage, state);
      expect(state.fatigue).toBeGreaterThanOrEqual(0);
      expect(state.fatigue).toBeLessThanOrEqual(1);
    }
  });

  it("gère un état précédent absent/invalide sans planter", () => {
    expect(() => computeStageFatigue(hardStage, null)).not.toThrow();
    expect(() => computeStageFatigue(hardStage, undefined)).not.toThrow();
  });
});

describe("computeStageFatigue — déterminisme", () => {
  it("mêmes entrées, même résultat", () => {
    const state = { fatigue: 0.4, consecutiveDifficultDays: 2 };
    expect(computeStageFatigue(hardStage, state)).toEqual(computeStageFatigue(hardStage, state));
  });
});

describe("applyRecovery — réduit la fatigue", () => {
  it("réduit strictement une fatigue positive", () => {
    const state = { fatigue: 0.6, consecutiveDifficultDays: 2 };
    const recovered = applyRecovery(state);
    expect(recovered.fatigue).toBeLessThan(state.fatigue);
    expect(recovered.fatigue).toBeGreaterThanOrEqual(0);
  });

  it("ne rend jamais la fatigue négative", () => {
    expect(applyRecovery({ fatigue: 0, consecutiveDifficultDays: 0 }).fatigue).toBe(0);
  });

  it("ne remet PAS le compteur de jours consécutifs à zéro (voir doc : seule une étape facile le fait)", () => {
    const state = { fatigue: 0.5, consecutiveDifficultDays: 3 };
    expect(applyRecovery(state).consecutiveDifficultDays).toBe(3);
  });

  it("gère un état absent sans planter", () => {
    expect(() => applyRecovery(null)).not.toThrow();
  });
});

describe("fatiguePenalty", () => {
  it("nulle sans fatigue", () => {
    expect(fatiguePenalty({ fatigue: 0 })).toBe(0);
  });

  it("croît avec la fatigue, mais reste bornée (la fatigue nuance, n'écrase jamais)", () => {
    const low = fatiguePenalty({ fatigue: 0.2 });
    const high = fatiguePenalty({ fatigue: 0.9 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(0.3); // jamais plus de ~25% de pénalité
  });

  it("gère un état null", () => {
    expect(fatiguePenalty(null)).toBe(0);
  });
});
