import { describe, it, expect } from "vitest";
import { estimateEffort, modelPowerWatts, dailyLoads, computeFitness, formStatus, effortLevel, isEstimatedSource } from "./effort.js";

const day = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const ride = (y, m, d, extra = {}) => ({ date: day(y, m, d), distance: 40, movingTime: 5400, elevationGain: 300, ...extra });

describe("effort d'une sortie", () => {
  it("fréquence cardiaque : 1 h à 80 % de la FC max ≈ 64 (intensité 0,8)", () => {
    const e = estimateEffort({ movingTime: 3600, avgHeartRate: 152 }, { maxHR: 190 });
    expect(e.source).toBe("hr");
    expect(e.intensity).toBeCloseTo(0.8, 2);
    expect(e.score).toBe(64);
  });
  it("puissance : 1 h à 226 W pour un FTP de 250 (×1,05 → intensité 0,95) → 90 ; marquée estimée si le flag l'indique", () => {
    const e = estimateEffort({ movingTime: 3600, avgPower: 226, flags: { powerEstimated: true } }, { ftp: 250 });
    expect(e.source).toBe("power-estimated");
    expect(e.score).toBe(90);
    expect(estimateEffort({ movingTime: 3600, avgPower: 226, flags: {} }, { ftp: 250 }).source).toBe("power");
  });
  it("la FC est préférée à la puissance", () => {
    expect(estimateEffort({ movingTime: 3600, avgHeartRate: 140, avgPower: 200 }, {}).source).toBe("hr");
  });
  it("sans FC ni puissance : modèle physique, marqué « model »", () => {
    const e = estimateEffort({ distance: 40, movingTime: 5400, elevationGain: 300 }, { ftp: 250, massKg: 80 });
    expect(e.source).toBe("model");
    expect(e.score).toBeGreaterThan(20);
    expect(e.score).toBeLessThan(150);
  });
  it("une sortie plus rapide ou plus vallonnée coûte plus d'effort, à durée égale", () => {
    const base = { distance: 30, movingTime: 3600, elevationGain: 100 };
    const fast = estimateEffort({ ...base, distance: 38 }, {});
    const hilly = estimateEffort({ ...base, elevationGain: 900 }, {});
    const calm = estimateEffort(base, {});
    expect(fast.score).toBeGreaterThan(calm.score);
    expect(hilly.score).toBeGreaterThan(calm.score);
  });
  it("données insuffisantes → null, jamais 0 inventé", () => {
    expect(estimateEffort({}, {})).toBeNull();
    expect(estimateEffort({ movingTime: 3600 }, {})).toBeNull();
    expect(estimateEffort(null)).toBeNull();
    expect(modelPowerWatts({ distanceKm: 0, movingTimeSec: 10 })).toBeNull();
  });
  it("estimé ou mesuré", () => {
    expect(isEstimatedSource("hr")).toBe(false);
    expect(isEstimatedSource("model")).toBe(true);
    expect(isEstimatedSource("power-estimated")).toBe(true);
  });
  it("niveaux", () => {
    expect([effortLevel(20), effortLevel(70), effortLevel(150), effortLevel(300), effortLevel(null)]).toEqual(["Facile", "Modéré", "Soutenu", "Très dur", null]);
  });
});

describe("forme / fatigue / fraîcheur", () => {
  it("additionne les sorties d'un même jour", () => {
    const loads = dailyLoads([ride(2026, 11, 3), ride(2026, 11, 3)], {});
    expect(loads.size).toBe(1);
    expect([...loads.values()][0].count).toBe(2);
  });
  it("sans sortie exploitable : série vide", () => {
    expect(computeFitness([], {}).series).toEqual([]);
    expect(computeFitness([{ date: day(2026, 1, 1) }], {}).current).toBeNull();
  });
  it("une grosse sortie fait monter la fatigue plus vite que la forme, puis la fraîcheur remonte", () => {
    const today = new Date(2026, 10, 20);
    const f = computeFitness([ride(2026, 11, 1, { movingTime: 14400, distance: 100, elevationGain: 1500 })], {}, { today });
    const s = f.series;
    const first = s.find((x) => x.load > 0);
    expect(first.atl).toBeGreaterThan(first.ctl);
    const after = s[s.indexOf(first) + 1];
    expect(after.tsb).toBeLessThan(0); // lendemain : fatigué
    expect(s[s.length - 1].tsb).toBeGreaterThan(after.tsb); // se reposer remonte la fraîcheur
  });
  it("une charge régulière installe la forme ; la fatigue la suit de près", () => {
    const acts = [];
    for (let i = 0; i < 70; i += 2) acts.push({ ...ride(2026, 9, 1), date: new Date(2026, 8, 1 + i, 12).toISOString() });
    const f = computeFitness(acts, {}, { today: new Date(2026, 10, 9) });
    expect(f.current.ctl).toBeGreaterThan(20);
    expect(f.historyDays).toBeGreaterThanOrEqual(42);
    expect(f.calibrating).toBe(false);
  });
  it("historique court : calibrage signalé", () => {
    expect(computeFitness([ride(2026, 11, 1)], {}, { today: new Date(2026, 10, 10) }).calibrating).toBe(true);
  });
  it("ne renvoie que les N derniers jours", () => {
    const f = computeFitness([ride(2026, 1, 1)], {}, { days: 30, today: new Date(2026, 10, 10) });
    expect(f.series).toHaveLength(30);
  });
  it("part d'estimations signalée", () => {
    const f = computeFitness([ride(2026, 11, 1), ride(2026, 11, 2, { avgHeartRate: 140 })], {}, { today: new Date(2026, 10, 5) });
    expect(f.estimatedShare).toBe(0.5);
    expect(f.rides).toBe(2);
  });
  it("libellés de fraîcheur", () => {
    expect([30, 10, 0, -20, -50].map((t) => formStatus(t).key)).toEqual(["rested", "fresh", "neutral", "loaded", "overload"]);
  });
});
