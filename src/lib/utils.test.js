import { describe, it, expect } from "vitest";
import {
  haversine,
  smoothArray,
  avg,
  median,
  decimate,
  fmt1,
  fmtInt,
  fmtDuration,
  fmtDurationLong,
  fmtClock,
  fmtDateFull,
  stdDev,
  coefficientOfVariation,
} from "./utils.js";

describe("haversine", () => {
  it("retourne 0 pour deux points identiques", () => {
    expect(haversine(48.85, 2.35, 48.85, 2.35)).toBe(0);
  });

  it("calcule ~111.2 km pour 1° de latitude à l'équateur", () => {
    const d = haversine(0, 0, 1, 0);
    expect(d / 1000).toBeCloseTo(111.19, 0);
  });

  it("est symétrique", () => {
    const a = haversine(45.0, 5.0, 45.1, 5.2);
    const b = haversine(45.1, 5.2, 45.0, 5.0);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("smoothArray", () => {
  it("laisse une série constante inchangée", () => {
    expect(smoothArray([5, 5, 5, 5, 5], 3)).toEqual([5, 5, 5, 5, 5]);
  });

  it("ignore les valeurs null dans la fenêtre", () => {
    const out = smoothArray([10, null, 30], 3);
    expect(out[1]).toBeCloseTo(20, 6); // moyenne de 10 et 30, null ignoré
  });

  it("conserve la longueur du tableau d'entrée", () => {
    const input = [1, 2, 3, 4, 5, 6, 7];
    expect(smoothArray(input, 5)).toHaveLength(input.length);
  });
});

describe("avg", () => {
  it("calcule la moyenne en ignorant null/NaN", () => {
    expect(avg([1, null, 2, NaN, 3])).toBe(2);
  });

  it("retourne null pour un tableau vide ou sans valeur valide", () => {
    expect(avg([])).toBeNull();
    expect(avg([null, null])).toBeNull();
  });
});

describe("median", () => {
  it("calcule la médiane d'un nombre impair de valeurs", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("calcule la médiane d'un nombre pair de valeurs", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("retourne null pour un tableau vide", () => {
    expect(median([])).toBeNull();
  });
});

describe("decimate", () => {
  it("laisse un tableau plus court que maxPoints inchangé", () => {
    const arr = [1, 2, 3];
    expect(decimate(arr, 10)).toBe(arr);
  });

  it("réduit un grand tableau à environ maxPoints éléments et garde le dernier point", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const out = decimate(arr, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe("formatage", () => {
  it("fmt1 formate une décimale ou retourne le tiret cadratin", () => {
    expect(fmt1(12.345)).toBe("12,3");
    expect(fmt1(null)).toBe("—");
    expect(fmt1(NaN)).toBe("—");
  });

  it("fmtInt arrondit à l'entier", () => {
    expect(fmtInt(12.6)).toBe("13");
    expect(fmtInt(null)).toBe("—");
  });

  it("fmtDuration formate en h/min ou min:sec", () => {
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(3900)).toBe("1h05");
    expect(fmtDuration(null)).toBe("—");
  });

  it("fmtDurationLong formate en toutes lettres", () => {
    expect(fmtDurationLong(45)).toBe("45 s");
    expect(fmtDurationLong(3665)).toBe("1 h 1 min");
  });

  it("fmtClock et fmtDateFull retournent le tiret cadratin sans date", () => {
    expect(fmtClock(null)).toBe("—");
    expect(fmtDateFull(null)).toBe("—");
  });
});

describe("stdDev / coefficientOfVariation", () => {
  it("stdDev retourne 0 pour une série constante", () => {
    expect(stdDev([4, 4, 4, 4])).toBe(0);
  });

  it("coefficientOfVariation retourne null si la moyenne est nulle", () => {
    expect(coefficientOfVariation([0, 0, 0])).toBeNull();
  });

  it("coefficientOfVariation est cohérent avec stdDev/moyenne", () => {
    const arr = [10, 12, 8, 14, 6];
    const cv = coefficientOfVariation(arr);
    expect(cv).toBeCloseTo(stdDev(arr) / avg(arr), 10);
  });
});
