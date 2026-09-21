import { describe, it, expect } from "vitest";
import { computeAnalysis } from "../analysis.js";
import { detectEfforts } from "./efforts.js";

function point(lat, lon, { t = null, power = null, hr = null } = {}) {
  return { lat, lon, ele: null, time: t != null ? new Date(t * 1000) : null, hr, cad: null, power, temp: null };
}

describe("detectEfforts", () => {
  it("détecte un effort soutenu de puissance nettement au-dessus de la médiane", () => {
    // 100 s à 100 W (roulage tranquille) puis 90 s à 320 W (effort) puis 100 s à 100 W.
    const points = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 10) points.push(point(i * 0.0005, 0, { t, power: 100 }));
    for (let i = 0; i < 9; i++, t += 10) points.push(point(0.005 + i * 0.001, 0, { t, power: 320 }));
    for (let i = 0; i < 10; i++, t += 10) points.push(point(0.015 + i * 0.0005, 0, { t, power: 100 }));

    const analysis = computeAnalysis(points);
    const efforts = detectEfforts(analysis);

    expect(efforts.length).toBe(1);
    expect(efforts[0].durationSec).toBeGreaterThanOrEqual(60);
    expect(efforts[0].avgPowerW).toBeGreaterThan(300);
    expect(efforts[0].startTime).toBeInstanceOf(Date);
  });

  it("ignore un pic trop bref (< 60 s)", () => {
    const points = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 10) points.push(point(i * 0.0005, 0, { t, power: 100 }));
    for (let i = 0; i < 3; i++, t += 10) points.push(point(0.005 + i * 0.001, 0, { t, power: 320 })); // 30 s seulement
    for (let i = 0; i < 10; i++, t += 10) points.push(point(0.008 + i * 0.0005, 0, { t, power: 100 }));

    const analysis = computeAnalysis(points);
    expect(detectEfforts(analysis)).toEqual([]);
  });

  it("fusionne deux segments proches séparés par un court passage sous le seuil", () => {
    // Ligne de base largement majoritaire (30 points avant/après) pour que la
    // médiane reste bien la puissance de roulage tranquille (100 W), pas la
    // puissance d'effort. Échantillonnage à 7 s : un unique point de creux
    // entre les deux segments d'effort crée un écart de 14 s
    // (< MERGE_GAP_SEC = 15 s) -> fusion attendue en un seul effort.
    const points = [];
    let t = 0;
    for (let i = 0; i < 30; i++, t += 7) points.push(point(i * 0.0005, 0, { t, power: 100 }));
    for (let i = 0; i < 10; i++, t += 7) points.push(point(0.015 + i * 0.001, 0, { t, power: 320 })); // ~63 s d'effort
    for (let i = 0; i < 1; i++, t += 7) points.push(point(0.025, 0, { t, power: 100 })); // creux d'un seul point
    for (let i = 0; i < 10; i++, t += 7) points.push(point(0.026 + i * 0.001, 0, { t, power: 320 })); // ~63 s d'effort
    for (let i = 0; i < 30; i++, t += 7) points.push(point(0.036 + i * 0.0005, 0, { t, power: 100 }));

    const analysis = computeAnalysis(points);
    const efforts = detectEfforts(analysis);
    expect(efforts.length).toBe(1); // fusionnés en un seul effort continu
    expect(efforts[0].durationSec).toBeGreaterThanOrEqual(120);
  });

  it("se rabat sur la vitesse quand la puissance est absente", () => {
    const points = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 5) points.push(point(i * 0.0002, 0, { t })); // roulage lent
    for (let i = 0; i < 15; i++, t += 5) points.push(point(0.002 + i * 0.001, 0, { t })); // accélération franche et soutenue
    for (let i = 0; i < 10; i++, t += 5) points.push(point(0.017 + i * 0.0002, 0, { t }));

    const analysis = computeAnalysis(points);
    expect(analysis.hasPower).toBe(false); // pré-condition : pas de puissance
    const efforts = detectEfforts(analysis);
    expect(efforts.length).toBeGreaterThan(0);
    expect(efforts[0].avgSpeedKmh).not.toBeNull();
    expect(efforts[0].avgPowerW).toBeNull();
  });

  it("ne détecte rien sur une sortie uniforme (rien ne dépasse la médiane)", () => {
    const points = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => point(i * 0.0005, 0, { t: i * 10, power: 150 }));
    const analysis = computeAnalysis(points);
    expect(detectEfforts(analysis)).toEqual([]);
  });

  it("retourne un tableau vide sans horodatage", () => {
    const points = [
      { lat: 0, lon: 0, ele: null, time: null, hr: null, cad: null, power: 300, temp: null },
      { lat: 0.001, lon: 0, ele: null, time: null, hr: null, cad: null, power: 300, temp: null },
    ];
    const analysis = computeAnalysis(points);
    expect(detectEfforts(analysis)).toEqual([]);
  });
});
