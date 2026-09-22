import { describe, it, expect, afterEach } from "vitest";
import { parseActivityDate, localDayKey, localWeekKey, localMonthKey, periodRange, isWithinPeriod } from "./dateUtils.js";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("parseActivityDate", () => {
  it("parse la date ISO d'une activité", () => {
    const d = parseActivityDate({ date: "2026-09-20T19:59:52.000Z" });
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2026-09-20T19:59:52.000Z");
  });

  it("retourne null sans date, jamais une date inventée", () => {
    expect(parseActivityDate({ date: null })).toBeNull();
    expect(parseActivityDate(null)).toBeNull();
    expect(parseActivityDate({ date: "n'importe quoi" })).toBeNull();
  });
});

describe("localDayKey — bascule de jour UTC vs fuseau local (bug documenté en tête de dateUtils.js)", () => {
  it("une sortie stockée en UTC proche de minuit change bien de jour calendaire selon le fuseau local", () => {
    // Sortie commencée à 23h30 UTC le 20 septembre.
    const utcDate = new Date("2026-09-20T23:30:00.000Z");

    process.env.TZ = "Pacific/Kiritimati"; // UTC+14 : bascule sur le 21
    expect(localDayKey(utcDate)).toBe("2026-09-21");

    process.env.TZ = "Etc/GMT+12"; // UTC-12 : reste le 20
    expect(localDayKey(utcDate)).toBe("2026-09-20");
  });

  it("ne fabrique jamais un jour à partir d'un simple découpage de la chaîne UTC", () => {
    // Si on avait juste fait `.slice(0,10)` sur l'ISO, on aurait TOUJOURS "2026-09-20"
    // quel que soit le fuseau — ce test vérifie qu'on obtient bien un résultat
    // qui EN DÉPEND (voir test précédent), donc que ce n'est pas un slice.
    process.env.TZ = "Pacific/Kiritimati";
    const naiveSlice = "2026-09-20T23:30:00.000Z".slice(0, 10);
    const real = localDayKey(new Date("2026-09-20T23:30:00.000Z"));
    expect(real).not.toBe(naiveSlice);
  });
});

describe("localWeekKey", () => {
  it("calcule une semaine ISO-8601 cohérente (jeudi détermine l'année ISO)", () => {
    // 2026-01-01 est un jeudi -> semaine ISO 1 de 2026.
    process.env.TZ = "UTC";
    expect(localWeekKey(new Date(2026, 0, 1))).toBe("2026-W01");
    // 2025-12-29 (lundi) appartient à la même semaine ISO que le 1er janvier 2026.
    expect(localWeekKey(new Date(2025, 11, 29))).toBe("2026-W01");
  });

  it("reste dans la semaine précédente juste avant le changement de semaine local", () => {
    process.env.TZ = "UTC";
    const sunday = new Date(2026, 0, 4); // dimanche, encore semaine 1
    const monday = new Date(2026, 0, 5); // lundi, semaine 2
    expect(localWeekKey(sunday)).toBe("2026-W01");
    expect(localWeekKey(monday)).toBe("2026-W02");
  });
});

describe("localMonthKey", () => {
  it("formate année-mois local sur deux chiffres", () => {
    process.env.TZ = "UTC";
    expect(localMonthKey(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01");
    expect(localMonthKey(new Date(Date.UTC(2026, 8, 20)))).toBe("2026-09");
  });
});

describe("periodRange", () => {
  it("calcule 7/30/90 jours et année par rapport à une date de référence", () => {
    const ref = new Date("2026-09-20T12:00:00Z");
    expect(periodRange("7d", ref).from.toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(periodRange("30d", ref).from.toISOString()).toBe("2026-08-21T12:00:00.000Z");
    expect(periodRange("90d", ref).from.toISOString()).toBe("2026-06-22T12:00:00.000Z");
    expect(periodRange("year", ref).from.toISOString()).toBe("2025-09-20T12:00:00.000Z");
    expect(periodRange("7d", ref).to.toISOString()).toBe(ref.toISOString());
  });

  it("accepte une période personnalisée {from, to}", () => {
    const r = periodRange({ from: "2026-01-01", to: "2026-06-30" });
    expect(r.from.toISOString()).toBe(new Date("2026-01-01").toISOString());
    expect(r.to.toISOString()).toBe(new Date("2026-06-30").toISOString());
  });

  it("retourne {from: null, to: null} pour 'all' (aucune borne)", () => {
    expect(periodRange("all")).toEqual({ from: null, to: null });
    expect(periodRange(undefined)).toEqual({ from: null, to: null });
  });

  it("rejette une période inconnue plutôt que de l'ignorer silencieusement", () => {
    expect(() => periodRange("42d")).toThrow(/inconnue/i);
  });
});

describe("isWithinPeriod", () => {
  it("respecte les bornes incluses", () => {
    const from = new Date("2026-01-01"), to = new Date("2026-12-31");
    expect(isWithinPeriod(new Date("2026-06-15"), { from, to })).toBe(true);
    expect(isWithinPeriod(new Date("2025-12-31"), { from, to })).toBe(false);
    expect(isWithinPeriod(new Date("2027-01-01"), { from, to })).toBe(false);
    expect(isWithinPeriod(from, { from, to })).toBe(true);
  });

  it("retourne false pour une date null (jamais incluse par défaut)", () => {
    expect(isWithinPeriod(null, { from: null, to: null })).toBe(false);
  });

  it("n'applique pas de borne côté null", () => {
    expect(isWithinPeriod(new Date("2000-01-01"), { from: null, to: null })).toBe(true);
  });
});
