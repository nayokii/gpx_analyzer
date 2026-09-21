import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFITArrayBuffer, isFITFile } from "./fitParser.js";

// Fixture RÉELLE : export brut d'un iGPSPORT BSC200C (aucune donnée synthétique).
// Toutes les valeurs attendues ci-dessous ont été vérifiées par recoupement
// manuel avant l'implémentation (voir l'inspection binaire de ce fichier) :
// distance totale des laps == distance de session, avg_speed cohérent avec
// distance/temps, altitude plausible, etc.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "ride-2026-09-20.fit");

function loadFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("isFITFile", () => {
  it("reconnaît la signature binaire FIT du fichier réel", () => {
    expect(isFITFile(loadFixtureArrayBuffer())).toBe(true);
  });

  it("rejette un buffer qui n'a pas la signature FIT", () => {
    const notFit = new TextEncoder().encode("<gpx>pas un fit</gpx>").buffer;
    expect(isFITFile(notFit)).toBe(false);
  });

  it("rejette un buffer trop court", () => {
    expect(isFITFile(new ArrayBuffer(4))).toBe(false);
  });
});

describe("parseFITArrayBuffer (fixture réelle iGPSPORT BSC200C)", () => {
  const { name, points, measured } = parseFITArrayBuffer(loadFixtureArrayBuffer());

  it("extrait le nom d'activité depuis le message sport du FIT", () => {
    expect(name).toBe("Road Cycling");
  });

  it("extrait exactement 883 points (un par message record du fichier réel)", () => {
    expect(points).toHaveLength(883);
  });

  it("décode des timestamps cohérents avec le fichier réel", () => {
    expect(points[0].time.toISOString()).toBe("2026-09-20T19:59:52.000Z");
    expect(points[points.length - 1].time.toISOString()).toBe("2026-09-20T21:51:47.000Z");
  });

  it("décode latitude/longitude dans les bornes valides et cohérentes (Guadeloupe)", () => {
    const p0 = points[0];
    expect(p0.lat).toBeCloseTo(16.4675, 3);
    expect(p0.lon).toBeCloseTo(-61.4991, 3);
    for (const p of points) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
  });

  it("décode l'altitude en mètres (échelle FIT appliquée)", () => {
    expect(points[0].ele).toBeCloseTo(24.4, 1);
  });

  it("conserve la distance mesurée par le device (km), distincte de tout recalcul", () => {
    expect(points[0].distanceMeasured).toBeCloseTo(0, 6);
    // Dernier point : distance totale mesurée par le compteur ~31.23 km.
    expect(points[points.length - 1].distanceMeasured).toBeCloseTo(31.23099, 3);
  });

  it("conserve la vitesse mesurée par le device (km/h)", () => {
    // 3.058 m/s mesurés au premier point -> 11.0088 km/h
    expect(points[0].speedMeasured).toBeCloseTo(11.0088, 2);
  });

  it("décode la température en °C (varie entre 23 et 27°C sur cette sortie réelle)", () => {
    expect(points[0].temp).toBe(25);
    for (const p of points) {
      expect(p.temp).not.toBeNull();
      expect(p.temp).toBeGreaterThanOrEqual(23);
      expect(p.temp).toBeLessThanOrEqual(27);
    }
  });

  it("ne fabrique aucune fréquence cardiaque : absente de ce fichier réel (pas de HR50 apparié)", () => {
    for (const p of points) expect(p.hr).toBeNull();
  });

  it("ne fabrique aucune cadence : absente de ce fichier réel", () => {
    for (const p of points) expect(p.cad).toBeNull();
  });

  it("ne fabrique aucune puissance : absente de ce fichier réel", () => {
    for (const p of points) expect(p.power).toBeNull();
  });

  it("expose les totaux mesurés de la session FIT (distance, vitesse moy./max)", () => {
    expect(measured.distanceKm).toBeCloseTo(31.23099, 3);
    expect(measured.avgSpeedKmh).toBeCloseTo(20.0088, 2); // 5.558 m/s
    expect(measured.maxSpeedKmh).toBeCloseTo(55.4364, 2); // 15.399 m/s
  });
});

describe("parseFITArrayBuffer — cas limites", () => {
  it("rejette un fichier sans signature FIT valide", () => {
    const notFit = new TextEncoder().encode("ceci n'est pas un fichier FIT").buffer;
    expect(() => parseFITArrayBuffer(notFit)).toThrow(/signature/i);
  });
});
