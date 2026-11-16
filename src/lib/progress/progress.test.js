import { describe, it, expect } from "vitest";
import {
  periodStart, shiftPeriod, periodBounds, filterBySport, aggregate, buildSeries, delta, avgHoursPerWeek,
  monthlyComparison, weekStreak, dayCells, totalsForPeriod,
} from "./progress.js";

// Dates locales (midi) : pas de dérive de fuseau dans les assertions.
const ride = (y, m, d, distance, movingTime, elevationGain, sportType = "cycling") => ({
  date: new Date(y, m - 1, d, 12).toISOString(), distance, movingTime, elevationGain, sportType,
});

describe("périodes", () => {
  it("la semaine commence le lundi (dimanche 8 nov. 2026 → lundi 2 nov.)", () => {
    const s = periodStart("week", new Date(2026, 10, 8, 20));
    expect([s.getFullYear(), s.getMonth(), s.getDate()]).toEqual([2026, 10, 2]);
  });
  it("décale d'une semaine / d'un mois / d'une année, y compris à cheval sur l'année", () => {
    expect(shiftPeriod("week", new Date(2026, 0, 5), -1)).toEqual(new Date(2025, 11, 29));
    expect(shiftPeriod("month", new Date(2026, 0, 1), -1)).toEqual(new Date(2025, 11, 1));
    expect(shiftPeriod("year", new Date(2026, 0, 1), 1)).toEqual(new Date(2027, 0, 1));
  });
  it("la fin est exclusive : une sortie du lundi suivant n'est pas dans la semaine", () => {
    const acts = [ride(2026, 11, 8, 10, 1000, 0), ride(2026, 11, 9, 99, 1000, 0)];
    expect(totalsForPeriod(acts, "week", new Date(2026, 10, 2)).distanceKm).toBe(10);
    expect(periodBounds("week", new Date(2026, 10, 2)).end).toEqual(new Date(2026, 10, 9));
  });
});

describe("agrégats", () => {
  it("somme distance, temps, D+ et pondère la vitesse par le temps en mouvement", () => {
    const t = aggregate([ride(2026, 11, 2, 30, 3600, 100), ride(2026, 11, 3, 10, 3600, 50)]);
    expect(t).toMatchObject({ count: 2, distanceKm: 40, movingTimeSec: 7200, elevationGainM: 150 });
    expect(t.avgSpeedKmh).toBeCloseTo(20);
  });
  it("tolère les champs absents sans NaN", () => {
    const t = aggregate([{ date: new Date(2026, 10, 2).toISOString() }]);
    expect(t).toMatchObject({ count: 1, distanceKm: 0, movingTimeSec: 0, elevationGainM: 0, avgSpeedKmh: null });
  });
  it("filtre par type, l'index sans type compte comme « other »", () => {
    const acts = [ride(2026, 11, 2, 1, 1, 1, "gravel"), { ...ride(2026, 11, 2, 1, 1, 1), sportType: null }];
    expect(filterBySport(acts, "gravel")).toHaveLength(1);
    expect(filterBySport(acts, "other")).toHaveLength(1);
    expect(filterBySport(acts, "all")).toHaveLength(2);
  });
});

describe("séries et comparaisons", () => {
  const acts = [ride(2026, 11, 3, 40, 7200, 400), ride(2026, 10, 27, 20, 3600, 100)];
  it("12 semaines, zéros compris, la dernière est la semaine courante", () => {
    const s = buildSeries(acts, "week", new Date(2026, 10, 2));
    expect(s).toHaveLength(12);
    expect(s[11].distanceKm).toBe(40);
    expect(s[10].distanceKm).toBe(20);
    expect(s[0].distanceKm).toBe(0);
  });
  it("delta : absolu et relatif, pct nul si base nulle", () => {
    expect(delta({ distanceKm: 60 }, { distanceKm: 40 }, "distanceKm")).toEqual({ diff: 20, pct: 50 });
    expect(delta({ distanceKm: 60 }, { distanceKm: 0 }, "distanceKm")).toEqual({ diff: 60, pct: null });
  });
  it("heures par semaine : un mois entier = jours/7", () => {
    const totals = { movingTimeSec: 30 * 3600 };
    expect(avgHoursPerWeek(totals, "month", new Date(2026, 8, 1), new Date(2026, 11, 1))).toBeCloseTo(30 / (30 / 7));
  });
  it("heures par semaine : période en cours ramenée aux jours écoulés", () => {
    const totals = { movingTimeSec: 7 * 3600 };
    expect(avgHoursPerWeek(totals, "week", new Date(2026, 10, 2), new Date(2026, 10, 4, 12))).toBeGreaterThan(7 / (7 / 7) - 0.001);
  });
  it("comparatif mensuel : année en cours contre précédente", () => {
    const rows = monthlyComparison([ride(2026, 3, 5, 50, 1, 1), ride(2025, 3, 9, 30, 1, 1)], 2026);
    expect(rows).toHaveLength(12);
    expect(rows[2].current.distanceKm).toBe(50);
    expect(rows[2].previous.distanceKm).toBe(30);
    expect(rows[0].current.count).toBe(0);
  });
});

describe("série de semaines", () => {
  it("compte les semaines consécutives, la semaine en cours vide n'interrompt pas la série", () => {
    const acts = [ride(2026, 10, 20, 1, 1, 1), ride(2026, 10, 27, 1, 1, 1)];
    expect(weekStreak(acts, new Date(2026, 10, 4))).toBe(2); // semaine du 2 nov. encore vide
    expect(weekStreak([...acts, ride(2026, 11, 3, 1, 1, 1)], new Date(2026, 10, 4))).toBe(3);
  });
  it("une semaine sans sortie rompt la série", () => {
    expect(weekStreak([ride(2026, 10, 12, 1, 1, 1), ride(2026, 10, 27, 1, 1, 1)], new Date(2026, 10, 4))).toBe(1);
  });
  it("aucune sortie → 0", () => expect(weekStreak([], new Date())).toBe(0));
});

describe("grille calendrier", () => {
  it("un jour par case, jours futurs marqués", () => {
    const cells = dayCells([ride(2026, 11, 3, 1, 1, 1)], "week", new Date(2026, 10, 2), new Date(2026, 10, 4, 9));
    expect(cells).toHaveLength(7);
    expect(cells[1].count).toBe(1);
    expect(cells[2].future).toBe(false);
    expect(cells[6].future).toBe(true);
  });
});
