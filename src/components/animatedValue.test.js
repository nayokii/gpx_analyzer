import { describe, it, expect } from "vitest";
import { parseDisplay, isCompatible, formatDisplay, makeBezier } from "./animatedValue.js";

const roundTrip = (text) => {
  const p = parseDisplay(text);
  return formatDisplay(p, p.vector);
};

describe("parseDisplay / formatDisplay — formats d'affichage existants", () => {
  it.each([
    ["18,6"],
    ["+405"],
    ["-325"],
    ["1 234"],
    ["1 234,5"],
    ["1h09"],
    ["12:45"],
    ["0:05"],
    ["1 h 23 min"],
    ["12 min 5 s"],
    ["45 s"],
    ["—"],
  ])("reformate %s à l'identique", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("entier : aucune décimale ajoutée à mi-parcours", () => {
    const a = parseDisplay("177");
    const b = parseDisplay("245");
    expect(isCompatible(a, b)).toBe(true);
    expect(formatDisplay(b, [210.4])).toBe("210");
  });

  it("décimal : garde la précision et la virgule fr-FR", () => {
    const b = parseDisplay("42,7");
    expect(formatDisplay(b, [37.249])).toBe("37,2");
  });

  it("conserve le signe littéral", () => {
    const b = parseDisplay("+405");
    expect(formatDisplay(b, [310])).toBe("+310");
  });

  it("durée compacte : interpole le total (pas chaque composant) et garde le padding", () => {
    const from = parseDisplay("1h19");
    const to = parseDisplay("1h32");
    expect(isCompatible(from, to)).toBe(true);
    expect(from.vector).toEqual([4740]); // 1h19 en secondes
    expect(formatDisplay(to, [(from.vector[0] + to.vector[0]) / 2])).toBe("1h25");
    // passage d'heure : 1h59 -> 2h05, jamais "2h59" à mi-parcours
    const a = parseDisplay("1h59");
    const b = parseDisplay("2h05");
    expect(formatDisplay(b, [(a.vector[0] + b.vector[0]) / 2])).toBe("2h02");
  });

  it("durée mm:ss", () => {
    const a = parseDisplay("12:45");
    const b = parseDisplay("13:05");
    expect(formatDisplay(b, [(a.vector[0] + b.vector[0]) / 2])).toBe("12:55");
  });

  it("structures différentes : non interpolables", () => {
    expect(isCompatible(parseDisplay("—"), parseDisplay("18,6"))).toBe(false);
    expect(isCompatible(parseDisplay("59:30"), parseDisplay("1h02"))).toBe(false);
    expect(isCompatible(parseDisplay("+405"), parseDisplay("-325"))).toBe(false);
    expect(isCompatible(parseDisplay("18,6"), parseDisplay("18"))).toBe(false);
  });
});

describe("makeBezier", () => {
  it("passe par (0,0) et (1,1) et est monotone", () => {
    const e = makeBezier(0.2, 0, 0, 1);
    expect(e(0)).toBeCloseTo(0, 3);
    expect(e(1)).toBeCloseTo(1, 3);
    expect(e(0.5)).toBeGreaterThan(e(0.25));
  });
});
