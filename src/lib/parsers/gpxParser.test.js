import { describe, it, expect } from "vitest";
import { parseGPXString, isGPXFile, extractGPXMetadata } from "./gpxParser.js";

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www8.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Sortie test</name>
    <trkseg>
      <trkpt lat="48.8566" lon="2.3522">
        <ele>35.0</ele>
        <time>2026-09-20T08:00:00Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>120</gpxtpx:hr>
            <gpxtpx:cad>85</gpxtpx:cad>
            <gpxtpx:atemp>22</gpxtpx:atemp>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="48.8570" lon="2.3530">
        <ele>37.5</ele>
        <time>2026-09-20T08:00:10Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>125</gpxtpx:hr>
            <gpxtpx:cad>88</gpxtpx:cad>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("parseGPXString", () => {
  it("extrait le nom de l'activité et les points avec leurs capteurs", () => {
    const { name, points } = parseGPXString(SAMPLE_GPX);

    expect(name).toBe("Sortie test");
    expect(points).toHaveLength(2);

    expect(points[0].lat).toBeCloseTo(48.8566, 6);
    expect(points[0].lon).toBeCloseTo(2.3522, 6);
    expect(points[0].ele).toBe(35.0);
    expect(points[0].hr).toBe(120);
    expect(points[0].cad).toBe(85);
    expect(points[0].temp).toBe(22);
    expect(points[0].time.toISOString()).toBe("2026-09-20T08:00:00.000Z");

    // Pas de température sur le second point : ne doit pas être inventée.
    expect(points[1].temp).toBeNull();
    expect(points[1].power).toBeNull();
  });

  it("rejette un fichier XML invalide", () => {
    expect(() => parseGPXString("<not-xml")).toThrow();
  });

  it("rejette un GPX sans point de trace", () => {
    expect(() => parseGPXString('<gpx><trk><trkseg></trkseg></trk></gpx>')).toThrow(/trkpt/i);
  });

  it("filtre les points aux coordonnées GPS invalides", () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="48.85" lon="2.35"><ele>10</ele></trkpt>
      <trkpt lat="999" lon="2.35"><ele>10</ele></trkpt>
    </trkseg></trk></gpx>`;
    // Un seul point valide restant : sous le minimum de 2 requis.
    expect(() => parseGPXString(gpx)).toThrow(/pas assez de points/i);
  });
});

describe("isGPXFile", () => {
  it("reconnaît un contenu GPX valide", () => {
    expect(isGPXFile(SAMPLE_GPX)).toBe(true);
  });

  it("rejette un contenu non-GPX", () => {
    expect(isGPXFile("<html></html>")).toBe(false);
    expect(isGPXFile("")).toBe(false);
    expect(isGPXFile(null)).toBe(false);
  });
});

describe("extractGPXMetadata", () => {
  it("retourne le nom, le nombre de points et la présence d'horodatage sans tout parser", () => {
    const meta = extractGPXMetadata(SAMPLE_GPX);
    expect(meta.name).toBe("Sortie test");
    expect(meta.pointCount).toBe(2);
    expect(meta.hasTime).toBe(true);
  });
});
