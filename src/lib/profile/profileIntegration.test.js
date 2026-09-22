/**
 * Test d'intégration bout-en-bout du moteur de profil avec le vrai fichier
 * FIT du projet (pas une fixture synthétique) : parse -> normalize ->
 * computeCyclistProfile. Vérifie que le "cold start" avec une seule vraie
 * sortie (31,23 km, 883 samples, sans FC, sans cadence, puissance estimée —
 * voir historyIntegration.test.js pour la même vérification côté historique)
 * produit un profil PARTIEL ET HONNÊTE : les dimensions qui ont un signal
 * (endurance) obtiennent une valeur à confiance faible, celles qui exigent
 * une puissance mesurée (sprint) ou un capteur/type de terrain absent
 * (technical) restent explicitement `insufficient_data` — jamais de donnée
 * fabriquée pour combler les cases vides.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { computeCyclistProfile, buildProfileTimeline } from "./profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("moteur de profil — cold start avec le vrai FIT", () => {
  let activity, profile;

  beforeAll(async () => {
    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride-2026-09-20.fit", measured });
    profile = computeCyclistProfile([activity]);
  });

  it("précondition : reprend bien les caractéristiques connues de la vraie sortie", () => {
    expect(activity.samples.length).toBeGreaterThan(800);
    expect(activity.distance).toBeCloseTo(31.23, 0);
    expect(activity.flags.hasHeartRate).toBe(false);
    expect(activity.flags.hasCadence).toBe(false);
    expect(activity.flags.powerEstimated).toBe(true);
  });

  it("produit un profil avec activityCount=1, version stable, sans exception", () => {
    expect(profile.activityCount).toBe(1);
    expect(profile.version).toBe(1);
    expect(profile.generatedAt).toBeTruthy();
  });

  it("endurance : une value existe (signal exploitable : temps en mouvement), confiance faible", () => {
    const endurance = profile.dimensions.endurance;
    expect(endurance.value).not.toBeNull();
    expect(endurance.confidenceLabel).not.toBe("high");
    expect(endurance.contributingActivities).toBe(1);
  });

  it("sprint : insufficient_data — puissance ESTIMÉE, jamais utilisée pour le sprint", () => {
    const sprint = profile.dimensions.sprint;
    expect(sprint.value).toBeNull();
    expect(sprint.confidenceLabel).toBe("insufficient_data");
  });

  it("technical : insufficient_data — sportType 'cycling', pas mtb/gravel", () => {
    expect(activity.sportType).toBe("cycling");
    const technical = profile.dimensions.technical;
    expect(technical.value).toBeNull();
    expect(technical.confidenceLabel).toBe("insufficient_data");
  });

  it("consistency : insufficient_data — une seule sortie ne peut pas révéler de régularité", () => {
    const consistency = profile.dimensions.consistency;
    expect(consistency.value).toBeNull();
  });

  it("punch : si un signal existe (efforts détectés sur puissance estimée), il est marqué dataQuality='estimated', jamais 'measured'", () => {
    const punch = profile.dimensions.punch;
    if (punch.value != null) {
      expect(["estimated", "speed", "mixed"]).toContain(punch.dataQuality);
    } else {
      expect(punch.confidenceLabel).toBe("insufficient_data");
    }
  });

  it("aucune dimension n'affiche une confiance haute avec une seule vraie sortie", () => {
    for (const [name, dim] of Object.entries(profile.dimensions)) {
      expect(dim.confidenceLabel, `${name} ne devrait pas être "high" avec 1 seule activité`).not.toBe("high");
    }
  });

  it("dataAvailability reflète fidèlement l'absence de FC/cadence et la puissance estimée", () => {
    expect(profile.dataAvailability.withHeartRate).toBe(0);
    expect(profile.dataAvailability.withCadence).toBe(0);
    expect(profile.dataAvailability.withEstimatedPower).toBe(1);
    expect(profile.dataAvailability.withMeasuredPower).toBe(0);
  });

  it("buildProfileTimeline fonctionne aussi avec cette seule vraie sortie", () => {
    const timeline = buildProfileTimeline([activity]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].activityCountAtPoint).toBe(1);
    expect(timeline[0].profile.dimensions.endurance.value).toEqual(profile.dimensions.endurance.value);
  });

  it("le profil complet est sérialisable en JSON sans perte", () => {
    expect(() => JSON.stringify(profile)).not.toThrow();
  });
});
