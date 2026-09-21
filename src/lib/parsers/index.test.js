import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// jsdom (environnement de test) fournit un File/Blob global incomplet, sans
// arrayBuffer()/text() — on utilise l'implémentation Node native, conforme à
// la spec, pour construire de vrais File exploitables dans ces tests.
import { File } from "node:buffer";
import { detectFileFormat, parseActivityFileAuto, getAcceptString, SUPPORTED_FORMATS } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "__fixtures__", "ride-2026-09-20.fit");

function fitFixtureFile(filename = "ride-2026-09-20.fit") {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return new File([buf], filename, { type: "application/octet-stream" });
}

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk><name>Sortie test</name><trkseg>
<trkpt lat="48.8566" lon="2.3522"><ele>35.0</ele><time>2026-09-20T08:00:00Z</time></trkpt>
<trkpt lat="48.8570" lon="2.3530"><ele>37.5</ele><time>2026-09-20T08:00:10Z</time></trkpt>
</trkseg></trk></gpx>`;

function gpxFixtureFile(filename = "sortie.gpx") {
  return new File([SAMPLE_GPX], filename, { type: "application/gpx+xml" });
}

describe("detectFileFormat", () => {
  it("détecte un FIT par signature binaire, même avec une extension trompeuse", async () => {
    const file = fitFixtureFile("ride.bin"); // extension volontairement non-.fit
    expect(await detectFileFormat(file)).toBe(SUPPORTED_FORMATS.FIT);
  });

  it("détecte un GPX par contenu XML", async () => {
    const file = gpxFixtureFile();
    expect(await detectFileFormat(file)).toBe(SUPPORTED_FORMATS.GPX);
  });

  it("retombe sur l'extension si aucune signature n'est reconnue", async () => {
    const file = new File(["contenu quelconque"], "mystere.fit", { type: "text/plain" });
    expect(await detectFileFormat(file)).toBe(SUPPORTED_FORMATS.FIT);
  });

  it("retourne null si rien n'est reconnaissable", async () => {
    const file = new File(["contenu quelconque"], "mystere.xyz", { type: "text/plain" });
    expect(await detectFileFormat(file)).toBeNull();
  });
});

describe("parseActivityFileAuto", () => {
  it("parse un vrai fichier FIT via ArrayBuffer et retourne les données mesurées", async () => {
    const result = await parseActivityFileAuto(fitFixtureFile());
    expect(result.format).toBe(SUPPORTED_FORMATS.FIT);
    expect(result.points).toHaveLength(883);
    expect(result.sourceText).toBeNull();
    // `instanceof ArrayBuffer` n'est pas fiable ici : le File vient de
    // node:buffer tandis que jsdom (environnement de test) fournit son propre
    // global ArrayBuffer, dans une réalité JS différente.
    expect(typeof result.sourceArrayBuffer.byteLength).toBe("number");
    expect(result.sourceArrayBuffer.byteLength).toBe(33007);
    expect(result.measured.distanceKm).toBeCloseTo(31.23099, 3);
  });

  it("parse un GPX via texte et measured reste null", async () => {
    const result = await parseActivityFileAuto(gpxFixtureFile());
    expect(result.format).toBe(SUPPORTED_FORMATS.GPX);
    expect(result.points).toHaveLength(2);
    expect(result.sourceArrayBuffer).toBeNull();
    expect(result.sourceText).toBe(SAMPLE_GPX);
    expect(result.measured).toBeNull();
  });

  it("rejette un format non reconnu", async () => {
    const file = new File(["n'importe quoi"], "mystere.xyz");
    await expect(parseActivityFileAuto(file)).rejects.toThrow(/non reconnu/i);
  });
});

describe("getAcceptString", () => {
  it("inclut .gpx et .fit", () => {
    expect(getAcceptString()).toBe(".gpx,.fit");
  });
});
