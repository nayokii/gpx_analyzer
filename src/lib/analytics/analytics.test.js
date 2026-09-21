import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAnalysis } from "../analysis.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeActivityAnalytics } from "./analytics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function point(lat, lon, { ele = null, t = null, hr = null, cad = null, power = null } = {}) {
  return { lat, lon, ele, time: t != null ? new Date(t * 1000) : null, hr, cad, power, temp: null };
}

describe("computeActivityAnalytics — fixture FIT réelle (iGPSPORT BSC200C, sans capteurs)", () => {
  let analytics;

  beforeAll(async () => {
    const { points, measured } = await parseFITArrayBuffer(loadFixtureArrayBuffer());
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190, measured });
  });

  it("distance ≈ 31.23 km (calculée et mesurée)", () => {
    expect(analytics.overview.distance.calculatedKm).toBeCloseTo(31.23, 1);
    expect(analytics.overview.distance.measuredKm).toBeCloseTo(31.23, 1);
  });

  it("vitesse moyenne mesurée ≈ 20 km/h (totaux de session FIT)", () => {
    expect(analytics.speed.avgMeasuredKmh).toBeCloseTo(20.0, 1);
  });

  it("température disponible", () => {
    expect(analytics.temperature.available).toBe(true);
    expect(analytics.temperature.avgC).toBeGreaterThan(20);
  });

  it("FC absente : aucune fabrication", () => {
    expect(analytics.heartRate.available).toBe(false);
    expect(analytics.dataAvailability.heartRate.available).toBe(false);
  });

  it("cadence absente : aucune fabrication", () => {
    expect(analytics.cadence.available).toBe(false);
    expect(analytics.dataAvailability.cadence.available).toBe(false);
  });

  it("puissance réelle absente, puissance estimée disponible et jamais présentée comme mesurée", () => {
    expect(analytics.power.available).toBe(true);
    expect(analytics.power.source).toBe("estimated");
    expect(analytics.dataAvailability.power.source).toBe("estimated");
  });

  it("les pauses détectées sont cohérentes (positives, plausibles)", () => {
    // Note : le device a son propre compteur d'auto-pause (total_elapsed_time -
    // total_timer_time = 1112 s dans le fichier réel), mais ce n'est pas ce que
    // ce bloc mesure. `pauses` est RECALCULÉ à partir des points enregistrés
    // (vitesse GPS < seuil pendant ≥ 20 s) ; pendant une auto-pause, le device
    // arrête d'enregistrer des points, donc ce recalcul ne "voit" pas ce temps
    // (un seul point à vitesse quasi nulle entoure le grand saut d'horodatage,
    // pas une série de points lents) — mesuré et calculé divergent ici
    // légitimement, exactement la distinction que ce projet préserve toujours.
    expect(analytics.pauses.available).toBe(true);
    expect(analytics.pauses.totalSec).toBeGreaterThanOrEqual(0);
    expect(analytics.pauses.totalSec).toBeLessThan(analytics.overview.duration.totalSec);
    for (const p of analytics.pauses.list) {
      expect(p.durationSec).toBeGreaterThanOrEqual(20); // seuil MIN_STOP_DUR d'analysis.js
      expect(p.startTime.getTime()).toBeLessThan(p.endTime.getTime());
    }
  });

  it("le profil d'altitude reste correct (min/max cohérents avec le fichier réel)", () => {
    expect(analytics.elevation.available).toBe(true);
    expect(analytics.elevation.minM).toBeGreaterThan(10);
    expect(analytics.elevation.minM).toBeLessThan(20);
    expect(analytics.elevation.maxM).toBeGreaterThan(75);
    expect(analytics.elevation.maxM).toBeLessThan(85);
  });

  it("les montées détectées ont une forme cohérente (pas de fabrication de puissance)", () => {
    expect(Array.isArray(analytics.climbs)).toBe(true);
    for (const c of analytics.climbs) {
      expect(c.gainM).toBeGreaterThan(0);
      expect(c.startTime).toBeInstanceOf(Date);
      // La puissance des montées vient de la même estimation que le reste : jamais "measured".
      if (c.avgPowerW != null) expect(analytics.power.source).toBe("estimated");
    }
  });

  it("dataAvailability reflète fidèlement measuredDistance/measuredSpeed", () => {
    expect(analytics.dataAvailability.measuredDistance.available).toBe(true);
    expect(analytics.dataAvailability.measuredSpeed.available).toBe(true);
  });
});

describe("computeActivityAnalytics — chemin GPX (non-régression)", () => {
  it("fonctionne sur une sortie GPX synthétique sans rien mesurer côté device", () => {
    const points = [0, 1, 2, 3, 4].map((i) => point(i * 0.001, 0, { ele: 100 + i * 2, t: i * 60, hr: 130 + i, cad: 80 }));
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190 });

    expect(analytics.overview.distance.calculatedKm).toBeGreaterThan(0);
    expect(analytics.overview.distance.measuredKm).toBeNull(); // jamais fourni par un GPX
    expect(analytics.speed.avgMeasuredKmh).toBeNull();
    expect(analytics.heartRate.available).toBe(true);
    expect(analytics.heartRate.avgBpm).toBeGreaterThan(0);
    expect(analytics.cadence.available).toBe(true);
    expect(analytics.dataAvailability.measuredDistance.available).toBe(false);
  });
});

describe("computeActivityAnalytics — cas limites", () => {
  it("petite sortie (quelques points) ne casse rien", () => {
    const points = [point(0, 0, { t: 0, ele: 10 }), point(0.0005, 0, { t: 30, ele: 12 })];
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, {});
    expect(analytics.overview.distance.calculatedKm).toBeGreaterThan(0);
    expect(analytics.climbs).toEqual([]);
    expect(analytics.efforts).toEqual([]);
  });

  it("données quasiment absentes (pas de temps, pas d'altitude) : tout reste indisponible plutôt qu'inventé", () => {
    const points = [point(0, 0), point(0.001, 0)];
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, { ftp: 250, maxHR: 190 });

    expect(analytics.overview.duration.totalSec).toBeNull();
    expect(analytics.elevation.available).toBe(false);
    expect(analytics.power.available).toBe(false);
    expect(analytics.heartRate.available).toBe(false);
    expect(analytics.cadence.available).toBe(false);
    expect(analytics.pauses.available).toBe(false);
    expect(analytics.zones.power.available).toBe(false);
    expect(analytics.zones.heartRate.available).toBe(false);
    expect(analytics.efforts).toEqual([]);
    expect(analytics.climbs).toEqual([]);
  });

  it("horodatages irréguliers (dérivés du vrai fichier FIT) restent gérés sans erreur", async () => {
    const { points } = await parseFITArrayBuffer(loadFixtureArrayBuffer());
    const analysis = computeAnalysis(points);
    expect(() => computeActivityAnalytics(analysis, {})).not.toThrow();
  });

  it("altitude bruitée ne génère pas un nombre déraisonnable de fausses montées", () => {
    // Bruit GPS/altitude aléatoire mais borné (±2 m) autour d'une ligne plate : ne doit produire aucune montée.
    let seed = 42;
    function rand() {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    }
    const points = [];
    for (let i = 0; i < 100; i++) {
      points.push(point(i * 0.0005, 0, { t: i * 5, ele: 100 + (rand() - 0.5) * 4 }));
    }
    const analysis = computeAnalysis(points);
    const analytics = computeActivityAnalytics(analysis, {});
    expect(analytics.climbs.length).toBe(0);
  });
});
