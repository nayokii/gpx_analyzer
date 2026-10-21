import { describe, it, expect } from "vitest";
import { buildCoachExport } from "./exportLog.js";
import { buildCoachContext } from "./context.js";
import { analyzeCoachContext } from "./analysis.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";

function ride(seed) {
  const gpx = `<?xml version="1.0"?><gpx><trk><name>Sortie | ${seed}</name><trkseg>
<trkpt lat="45.0${seed}0" lon="5.0${seed}0"><ele>200</ele><time>2026-09-2${seed}T08:00:00Z</time></trkpt>
<trkpt lat="45.0${seed}5" lon="5.0${seed}5"><ele>230</ele><time>2026-09-2${seed}T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>`;
  const { points } = parseGPXString(gpx);
  return toActivity(computeAnalysis(points, null), points, { name: `Sortie | ${seed}`, sourceType: "gpx", originalFilename: "a.gpx" });
}

describe("buildCoachExport", () => {
  const activities = [ride(1), ride(2), ride(3)];
  const context = buildCoachContext(activities, { recentCount: 5 });
  const analysis = analyzeCoachContext(context);
  const now = new Date("2026-10-21T10:00:00Z");

  it("produit un Markdown autonome : consigne de coaching, tableau de toutes les sorties, contexte, analyse", () => {
    const { filename, text, rideCount } = buildCoachExport({ context, analysis, activities, now });
    expect(filename).toBe("cycling-os-coaching-2026-10-21.md");
    expect(rideCount).toBe(3);
    expect(text).toContain("Tu es mon coach cycliste");
    expect(text).toContain("3 pistes d'amélioration PRIORISÉES");
    expect(text).toContain("## Toutes mes sorties");
    expect(text.match(/^\| 2026-09-2\d /gm)).toHaveLength(3);
    expect(text).toContain("=== Contexte coach");
    expect(text).toContain("Limites des données");
  });

  it("n'inclut aucune coordonnée GPS et n'invente pas les données absentes (n/d)", () => {
    const { text } = buildCoachExport({ context, analysis, activities, now });
    expect(text).not.toMatch(/45\.0\d+/);
    expect(text).toContain("n/d"); // pas de puissance/FC/cadence dans ces GPX
  });

  it("échappe le caractère | dans les noms pour ne pas casser le tableau", () => {
    const { text } = buildCoachExport({ context, analysis, activities, now });
    expect(text).toContain("Sortie / 1");
  });

  it("fonctionne sans analyse et avec zéro sortie", () => {
    const empty = buildCoachContext([], { recentCount: 5 });
    const { text, rideCount } = buildCoachExport({ context: empty, analysis: null, activities: [], now });
    expect(rideCount).toBe(0);
    expect(text).toContain("0 sortie(s)");
  });
});
