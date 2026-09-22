/**
 * Test d'intégration bout-en-bout du moteur historique avec le vrai fichier
 * FIT du projet (pas une fixture synthétique) : import -> stockage ->
 * retrouvée dans l'historique -> rouverte -> incluse dans les agrégations ->
 * comparée à une seconde sortie.
 *
 * La seconde sortie utilisée pour la comparaison/tendance EST synthétique
 * (fabriquée pour le test) puisque le dépôt ne contient qu'une seule vraie
 * activité — conformément à la consigne ("si l'historique ne contient qu'une
 * seule vraie sortie, ne fabrique pas artificiellement une progression").
 * Aucune conclusion de progression n'est tirée ici : on vérifie seulement que
 * les fonctions fonctionnent bout-en-bout sur des données réelles.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryDirectoryHandle } from "../storage/testFsHandle.js";
import { saveActivity, listActivities, loadActivityDetail } from "../storage/activityStore.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { computeHistoryAnalytics } from "./historyAnalytics.js";
import { buildTimeSeries, computeTrend } from "./trends.js";
import { compareActivities } from "./comparisons.js";
import { computeRecords } from "./records.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("moteur historique — bout-en-bout avec le vrai FIT", () => {
  let root, savedId, reopened;

  beforeAll(async () => {
    root = new MemoryDirectoryHandle();
    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points, { name, sourceType: "fit", originalFilename: "ride-2026-09-20.fit", measured });

    const saved = await saveActivity(root, activity, arrayBuffer, "fit");
    savedId = saved.id;
    reopened = await loadActivityDetail(root, savedId);
  });

  it("1. importée : le parsing FIT produit une activité exploitable", () => {
    expect(reopened).toBeTruthy();
    expect(reopened.source.type).toBe("fit");
  });

  it("2. stockée : le fichier .fit original et le .json normalisé existent tous les deux", async () => {
    const list = await listActivities(root);
    const entry = list.find((a) => a.id === savedId);
    expect(entry.files.original).toMatch(/\.fit$/);
    expect(entry.files.json).toMatch(/\.json$/);
  });

  it("3. retrouvée dans l'historique via listActivities", async () => {
    const list = await listActivities(root);
    expect(list.some((a) => a.id === savedId)).toBe(true);
  });

  it("4. rouverte : loadActivityDetail restitue les données complètes (samples, mesuré/calculé)", () => {
    expect(reopened.samples.length).toBeGreaterThan(800); // 883 records dans le vrai fichier
    expect(reopened.distanceMeasured).toBeCloseTo(31.23, 1);
    expect(reopened.distance).toBeGreaterThan(0);
    expect(reopened.flags.hasHeartRate).toBe(false); // pas de HR50 apparié sur cette sortie réelle
    expect(reopened.flags.powerEstimated).toBe(true); // pas de capteur de puissance réel
  });

  it("5. incluse dans les agrégations historiques", () => {
    const r = computeHistoryAnalytics([reopened]);
    expect(r.count).toBe(1);
    expect(r.totals.distanceKm).toBeCloseTo(reopened.distance, 6);
    expect(r.sensorCoverage.withHeartRate).toBe(0);
    expect(r.sensorCoverage.withEstimatedPower).toBe(1);

    const series = buildTimeSeries([reopened], { bucket: "day" });
    expect(series).toHaveLength(1);
    expect(series[0].distanceKm).toBeCloseTo(reopened.distance, 6);
  });

  it("6. comparée à une autre sortie compatible (synthétique, pour le test uniquement)", () => {
    const syntheticActivity = {
      ...reopened,
      id: "synthetic-comparison-2026-10-04",
      date: "2026-10-04T08:00:00.000Z",
      distance: reopened.distance * 1.05,
      duration: reopened.duration * 0.98,
      movingTime: reopened.movingTime,
      avgSpeed: reopened.avgSpeed * 1.03,
      elevationGain: reopened.elevationGain,
      samples: [], // pas besoin des échantillons complets pour cette comparaison générale
    };

    const cmp = compareActivities(reopened, syntheticActivity);
    expect(cmp.general.distanceKm.available).toBe(true);
    expect(cmp.general.distanceKm.deltaAbs).toBeGreaterThan(0);
    expect(cmp.performance.avgSpeedKmh.available).toBe(true);

    const records = computeRecords([reopened, syntheticActivity]);
    expect(records.find((r) => r.type === "longest_distance").activityId).toBe(syntheticActivity.id);
  });

  it("ne fabrique pas de tendance à partir d'une seule vraie sortie", () => {
    const trend = computeTrend([reopened], "distance");
    expect(trend.direction).toBe("insufficient_data");
    expect(trend.points).toHaveLength(1);
  });
});
