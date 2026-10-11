import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "../storage/testFsHandle.js";
import { saveActivity, loadActivityDetail } from "../storage/activityStore.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { computeAnalysis, computeHRZones } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { buildRideModel, buildSummaryRows, buildTelemetryCells, zoneShares } from "./rideModel.js";
import { loadRideInputs } from "./rideSource.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");
const SETTINGS = { weight: 75, bikeWeight: 8 };

async function seededFitRide() {
  const file = fs.readFileSync(FIXTURE);
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
  const reference = computeAnalysis(points, SETTINGS, { measured });
  const activity = toActivity(reference, points, { name, sourceType: "fit", originalFilename: "ride.fit", measured });
  const root = new MemoryDirectoryHandle();
  await saveActivity(root, activity, arrayBuffer, "fit");
  const stored = await loadActivityDetail(root, activity.id); // ce que HomeView manipule (storedFilename renseigné)
  return { root, stored, reference, points, measured };
}

describe("loadRideInputs", () => {
  it("reparse le fichier FIT original : mêmes points et totaux de session que l'import", async () => {
    const { root, stored, points, measured } = await seededFitRide();
    const inputs = await loadRideInputs(root, stored);
    expect(inputs.source).toBe("file");
    expect(inputs.points).toHaveLength(points.length);
    expect(inputs.measured).toEqual(measured);
  });

  it("se replie sur les samples sans dossier, pour Strava, ou si le fichier source est illisible", async () => {
    const { root, stored } = await seededFitRide();
    expect((await loadRideInputs(null, stored)).source).toBe("samples");
    expect((await loadRideInputs(root, { ...stored, source: { ...stored.source, type: "strava" } })).source).toBe("samples");
    // Fichier source illisible : le dossier connecté ne contient plus cette sortie.
    const inputs = await loadRideInputs(new MemoryDirectoryHandle(), stored);
    expect(inputs.source).toBe("samples");
    expect(inputs.points.length).toBe(stored.samples.length);
  });
});

describe("cockpit vs moteurs de référence — vraie sortie FIT", () => {
  it("l'analyse du cockpit est identique à computeAnalysis (D+, montées, vitesses, temps, distance)", async () => {
    const { root, stored, reference } = await seededFitRide();
    const model = buildRideModel(stored, SETTINGS, await loadRideInputs(root, stored));
    const a = model.analysis;
    expect(model.source).toBe("file");
    expect(a.elevGain).toBeCloseTo(reference.elevGain, 9);
    expect(a.totalDistanceKm).toBeCloseTo(reference.totalDistanceKm, 9);
    expect(a.avgSpeedKmh).toBeCloseTo(reference.avgSpeedKmh, 9);
    expect(a.maxSpeedKmh).toBeCloseTo(reference.maxSpeedKmh, 9);
    expect(a.movingTimeSec).toBe(reference.movingTimeSec);
    expect(a.totalTimeSec).toBe(reference.totalTimeSec);
    expect(a.climbs.map((c) => [c.startIdx, c.endIdx, c.gain])).toEqual(reference.climbs.map((c) => [c.startIdx, c.endIdx, c.gain]));
  });

  it("le D+ cumulé sous le curseur se termine exactement sur le D+ du résumé", async () => {
    const { root, stored } = await seededFitRide();
    const model = buildRideModel(stored, SETTINGS, await loadRideInputs(root, stored));
    const last = model.chartData[model.chartData.length - 1];
    const cells = Object.fromEntries(buildTelemetryCells(stored, model, last).map((c) => [c.key, c]));
    const summary = Object.fromEntries(buildSummaryRows(stored).map((r) => [r.key, r]));
    expect(cells.elevGain.value).toBeCloseTo(stored.elevationGain, 9);
    expect(summary.elevGain.value).toBeCloseTo(stored.elevationGain, 9);
  });

  it("le repli sur les samples reste signalé (source) et ne casse pas l'analyse", async () => {
    const { stored } = await seededFitRide();
    const model = buildRideModel(stored, SETTINGS);
    expect(model.source).toBe("samples");
    expect(model.status).toBe("ready");
  });

  it("résumé : chaque valeur est exactement celle de l'Activity, sans arrondi caché ni recalcul", async () => {
    const { stored } = await seededFitRide();
    const rows = Object.fromEntries(buildSummaryRows(stored).map((r) => [r.key, r]));
    expect(rows.distance.value).toBe(stored.distance);
    expect(rows.avgSpeed.value).toBe(stored.avgSpeed);
    expect(rows.avgSpeed.provenance).toBe(stored.avgSpeedSource === "device" ? "measured" : "calculated");
    expect(rows.maxSpeed.value).toBe(stored.maxSpeed);
    expect(rows.elapsed.value).toBe(stored.duration);
    expect(rows.moving.value).toBe(stored.movingTime);
    expect(rows.elapsed.value).not.toBe(rows.moving.value);
  });
});

describe("zones de FC — parts cohérentes avec computeHRZones", () => {
  it("les parts sont les temps de computeHRZones normalisés", () => {
    const series = Array.from({ length: 101 }, (_, i) => ({ hr: i < 50 ? 100 : 170, elapsed: i }));
    const analysis = { hasHR: true, hasTime: true, series };
    const bounds = [{ name: "Z1", min: 0, max: 70, color: "#000" }, { name: "Z2", min: 70, max: 999, color: "#111" }];
    const zones = computeHRZones(analysis, 190, bounds);
    const shares = zoneShares(zones);
    const total = zones.reduce((s, z) => s + z.time, 0);
    shares.forEach((s, i) => expect(s.share).toBeCloseTo(zones[i].time / total, 12));
    expect(shares[0].time).toBe(zones[0].time);
  });
});
