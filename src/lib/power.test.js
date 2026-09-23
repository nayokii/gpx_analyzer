import { describe, it, expect } from "vitest";
import {
  estimatePower,
  computeBestPowerEfforts,
  computePowerZones,
  computeNormalizedPower,
  computeVariabilityIndex,
  computeIntensityFactor,
  computeTSS,
} from "./power.js";

describe("estimatePower", () => {
  it("retourne 0 à l'arrêt sans pente ni accélération", () => {
    expect(estimatePower(0, 0, 75, 8)).toBe(0);
  });

  it("augmente avec la vitesse à plat", () => {
    const p20 = estimatePower(20, 0, 75, 8);
    const p35 = estimatePower(35, 0, 75, 8);
    expect(p35).toBeGreaterThan(p20);
  });

  it("demande plus de puissance en montée qu'en descente à vitesse égale", () => {
    const uphill = estimatePower(20, 6, 75, 8);
    const downhill = estimatePower(20, -6, 75, 8);
    expect(uphill).toBeGreaterThan(downhill);
  });

  it("demande plus de puissance en accélérant qu'à vitesse stable", () => {
    const steady = estimatePower(25, 0, 75, 8, 0, 0);
    const accelerating = estimatePower(25, 0, 75, 8, 0, 1.5);
    expect(accelerating).toBeGreaterThan(steady);
  });
});

describe("computeBestPowerEfforts", () => {
  it("identifie la fenêtre de puissance moyenne maximale pour une durée donnée", () => {
    // 10 points à 1 Hz : puissance élevée entre t=3 et t=6.
    const series = [100, 100, 100, 300, 300, 300, 300, 100, 100, 100].map((power, i) => ({
      elapsed: i,
      power,
    }));
    const result = computeBestPowerEfforts(series, [3]);
    expect(result.s3).toBeDefined();
    expect(result.s3.power).toBeCloseTo(300, 6);
    expect(result.s3.startIdx).toBe(3);
  });

  it("ignore les durées trop longues pour la série fournie", () => {
    const series = [{ elapsed: 0, power: 100 }, { elapsed: 1, power: 100 }];
    const result = computeBestPowerEfforts(series, [3600]);
    expect(result.s3600).toBeUndefined();
  });
});

describe("computeBestPowerEfforts — Phase 9E (fenêtre glissante O(n), équivalence avec l'ancienne implémentation naïve)", () => {
  // Ancienne implémentation (avant Phase 9E), conservée UNIQUEMENT ici comme
  // référence de non-régression : `j` repart de `i` à chaque itération, donc
  // O(n × durée) — volontairement gardée "bête" pour servir d'oracle simple,
  // jamais utilisée ailleurs dans le code applicatif.
  function naiveReference(series, durations) {
    const results = {};
    for (const dur of durations) {
      let best = -Infinity;
      let bestStart = null;
      for (let i = 0; i < series.length; i++) {
        if (series[i].elapsed == null || series[i].power == null) continue;
        let j = i;
        while (j < series.length && series[j].elapsed - series[i].elapsed < dur) j++;
        if (j >= series.length) break;
        const slice = series.slice(i, j).filter((p) => p.power != null && !Number.isNaN(p.power));
        if (slice.length === 0) continue;
        const avgPower = slice.reduce((a, p) => a + p.power, 0) / slice.length;
        if (avgPower > best) { best = avgPower; bestStart = i; }
      }
      if (isFinite(best) && best > 0) results[`s${dur}`] = { duration: dur, power: best, startIdx: bestStart };
    }
    return results;
  }

  function expectEquivalent(series, durations) {
    const expected = naiveReference(series, durations);
    const actual = computeBestPowerEfforts(series, durations);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(actual[key].duration).toBe(expected[key].duration);
      expect(actual[key].startIdx).toBe(expected[key].startIdx);
      expect(actual[key].power).toBeCloseTo(expected[key].power, 6);
    }
  }

  it("série régulière 1Hz, pas de trou", () => {
    expectEquivalent(Array.from({ length: 200 }, (_, i) => ({ elapsed: i, power: 100 + 50 * Math.sin(i / 10) })), [5, 30, 60]);
  });

  it("puissance null par endroits", () => {
    expectEquivalent(
      Array.from({ length: 300 }, (_, i) => ({ elapsed: i, power: i % 7 === 0 ? null : 100 + (i % 50) })),
      [5, 30, 60, 120]
    );
  });

  it("échantillonnage irrégulier (1-2 s entre points)", () => {
    let t = 0;
    const series = Array.from({ length: 250 }, (_, i) => {
      t += i % 3 === 0 ? 2 : 1;
      return { elapsed: t, power: 80 + (i % 40) };
    });
    expectEquivalent(series, [5, 30, 60, 300]);
  });

  it("elapsed null par endroits", () => {
    expectEquivalent(Array.from({ length: 150 }, (_, i) => ({ elapsed: i % 11 === 0 ? null : i, power: 100 })), [5, 30]);
  });

  it("puissance NaN par endroits (départ valide, mais exclu de la moyenne — même règle que avg())", () => {
    expectEquivalent(Array.from({ length: 100 }, (_, i) => ({ elapsed: i, power: i % 13 === 0 ? NaN : 100 })), [5, 30, 60]);
  });

  it("série vide ou toute puissance null : aucun résultat, jamais une exception", () => {
    expectEquivalent([], [5, 30]);
    expectEquivalent(Array.from({ length: 50 }, (_, i) => ({ elapsed: i, power: null })), [5, 30]);
  });

  it("série courte face à des durées longues : aucune fenêtre ne se ferme, aucun résultat", () => {
    expectEquivalent(Array.from({ length: 20 }, (_, i) => ({ elapsed: i, power: 100 + i })), [5, 30, 3600]);
  });

  it("reste rapide (O(n), pas O(n×durée)) sur une longue série avec de grandes durées — non-régression Phase 9E", () => {
    // ~4h à 1 Hz avec des durées jusqu'à 1h : l'ancienne implémentation
    // (O(n×durée)) prenait plusieurs secondes ici ; la nouvelle doit rester
    // sous une fraction de seconde (voir docs/PERFORMANCE.md pour la mesure
    // complète sur une vraie activité de 15 000+ points : 12,4 s -> 38 ms).
    const series = Array.from({ length: 15000 }, (_, i) => ({ elapsed: i, power: 100 + (i % 200) }));
    const start = performance.now();
    const result = computeBestPowerEfforts(series, [5, 30, 60, 300, 600, 1200, 1800, 3600]);
    const elapsed = performance.now() - start;
    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("computePowerZones", () => {
  it("retourne null sans FTP valide", () => {
    expect(computePowerZones([{ elapsed: 0, power: 100 }], 0)).toBeNull();
    expect(computePowerZones([{ elapsed: 0, power: 100 }], null)).toBeNull();
  });

  it("répartit le temps dans la zone correspondant au ratio puissance/FTP", () => {
    const ftp = 200;
    // 100 % FTP pendant 10 s puis 65 % FTP pendant 10 s.
    const series = [
      { elapsed: 0, power: 200 },
      { elapsed: 10, power: 200 },
      { elapsed: 20, power: 130 },
    ];
    const zones = computePowerZones(series, ftp);
    const z4 = zones.find((z) => z.name === "Z4 Seuil"); // 0.90 - 1.05
    const z2 = zones.find((z) => z.name === "Z2 Endurance"); // 0.55 - 0.75
    expect(z4.time).toBeCloseTo(10, 6);
    expect(z2.time).toBeCloseTo(10, 6);
  });
});

describe("computeNormalizedPower", () => {
  it("retourne la puissance constante elle-même pour un effort parfaitement régulier", () => {
    const series = Array.from({ length: 120 }, (_, i) => ({ elapsed: i, power: 200 }));
    expect(computeNormalizedPower(series)).toBeCloseTo(200, 6);
  });

  it("retourne null si la série est trop courte", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ elapsed: i, power: 200 }));
    expect(computeNormalizedPower(series)).toBeNull();
  });
});

describe("indicateurs dérivés (VI, IF, TSS)", () => {
  it("computeVariabilityIndex retourne NP/avgPower", () => {
    expect(computeVariabilityIndex(220, 200)).toBeCloseTo(1.1, 6);
    expect(computeVariabilityIndex(null, 200)).toBeNull();
  });

  it("computeIntensityFactor retourne NP/FTP", () => {
    expect(computeIntensityFactor(190, 250)).toBeCloseTo(0.76, 6);
    expect(computeIntensityFactor(190, 0)).toBeNull();
  });

  it("computeTSS suit la formule standard (1h à IF=1.0 => TSS=100)", () => {
    const tss = computeTSS(3600, 250, 250);
    expect(tss).toBeCloseTo(100, 6);
  });
});
