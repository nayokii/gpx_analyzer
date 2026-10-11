import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAnalysis } from "./analysis.js";
import { toActivity } from "./normalize.js";
import { parseFITArrayBuffer } from "./parsers/fitParser.js";
import { parseGPXString } from "./parsers/gpxParser.js";
import { buildStats } from "./feed/feedModel.js";
import { buildShareModel } from "./feed/shareCard.js";
import { summarizeRide } from "./coach/context.js";
import { deriveActivitySignals } from "./profile/activitySignals.js";
import { displayAvgSpeedKmh, SPEED_MODEL_VERSION } from "./speed.js";
import { MemoryDirectoryHandle } from "./storage/testFsHandle.js";
import { saveActivity, listActivities, loadActivityDetail } from "./storage/activityStore.js";
import { migrateStoredSpeeds } from "./storage/speedMigration.js";
import { createEmptyActivity } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIT_PATH = path.join(__dirname, "parsers", "__fixtures__", "ride-2026-09-20.fit");
const fitBuffer = () => {
  const buf = fs.readFileSync(FIT_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const num = (s) => Number(String(s).replace(",", "."));

/** Points à 1 Hz roulant à `speedMs`, avec une pause de `pauseSec` (aucun point enregistré) au milieu. */
function ridePoints({ rideSec = 600, pauseSec = 0, speedMs = 6 } = {}) {
  const t0 = Date.UTC(2026, 8, 1, 8, 0, 0);
  const mPerDegLat = 111195;
  const pts = [];
  let lat = 45;
  const push = (sec) => pts.push({ lat, lon: 4, ele: 200, time: new Date(t0 + sec * 1000), hr: null, cad: null, power: null, temp: null });
  for (let s = 0; s <= rideSec; s++) { push(s); lat += speedMs / mPerDegLat; }
  lat -= speedMs / mPerDegLat;
  const resume = rideSec + pauseSec;
  for (let s = resume; s <= resume + rideSec; s++) { push(s); lat += speedMs / mPerDegLat; }
  return pts;
}

describe("GPX / points sans statistiques de session", () => {
  it("sans pause : vitesse en mouvement == vitesse sur durée écoulée", () => {
    const a = computeAnalysis(ridePoints({ rideSec: 600, pauseSec: 1 }));
    expect(a.avgSpeedKmh).toBeCloseTo(21.6, 0);
    expect(a.avgSpeedElapsedKmh).toBeCloseTo(a.avgSpeedKmh, 0);
    expect(a.avgSpeedSource).toBe("derived");
  });

  it("pause sans point enregistré (trou) : comptée hors mouvement", () => {
    const a = computeAnalysis(ridePoints({ rideSec: 600, pauseSec: 600 }));
    expect(a.totalTimeSec).toBe(1800);
    expect(a.stoppedTimeSec).toBeGreaterThanOrEqual(599);
    expect(a.movingTimeSec).toBeCloseTo(1200, -1);
    expect(a.avgSpeedKmh).toBeCloseTo(21.6, 0);
    // la métrique sur durée écoulée reste distincte (pauses incluses)
    expect(a.avgSpeedElapsedKmh).toBeCloseTo(14.4, 0);
    expect(a.avgSpeedKmh).toBeGreaterThan(a.avgSpeedElapsedKmh + 5);
  });

  it("un trou parcouru à vitesse normale (perte GPS) n'est PAS un arrêt", () => {
    const pts = ridePoints({ rideSec: 300, pauseSec: 1 });
    pts.splice(100, 60);
    const a = computeAnalysis(pts);
    expect(a.stoppedTimeSec).toBe(0);
    expect(a.avgSpeedKmh).toBeCloseTo(21.6, 0);
  });

  it("GPX sans horodatage : aucune vitesse moyenne inventée", () => {
    const a = computeAnalysis(ridePoints().map((p) => ({ ...p, time: null })));
    expect(a.avgSpeedKmh).toBeNull();
    expect(a.avgSpeedElapsedKmh).toBeNull();
    expect(a.avgSpeedSource).toBeNull();
  });

  it("GPX : aucune valeur 'officielle' n'est prétendue", () => {
    const body = ridePoints({ rideSec: 100, pauseSec: 1 })
      .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>200</ele><time>${p.time.toISOString()}</time></trkpt>`).join("");
    const { points } = parseGPXString(`<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><name>x</name><trkseg>${body}</trkseg></trk></gpx>`);
    const act = toActivity(computeAnalysis(points), points, { sourceType: "gpx", measured: null });
    expect(act.avgSpeedMeasured).toBeNull();
    expect(act.avgSpeedSource).toBe("derived");
    expect(act.flags.hasMeasuredSpeed).toBe(false);
  });
});

describe("FIT avec statistiques de session — fichier réel iGPSPORT", () => {
  let points, measured;
  beforeAll(async () => {
    ({ points, measured } = await parseFITArrayBuffer(fitBuffer()));
  });

  it("extrait les champs de session aux bonnes unités", () => {
    expect(measured.distanceKm).toBeCloseTo(31.231, 3);
    expect(measured.avgSpeedKmh).toBeCloseTo(20.0088, 3); // 5,558 m/s
    expect(measured.timerSec).toBe(5619);
    expect(measured.movingSec).toBe(5619);
    expect(measured.elapsedSec).toBe(6731);
  });

  it("la vitesse enregistrée est cohérente avec distance / timer du même fichier", () => {
    expect(measured.distanceKm / (measured.timerSec / 3600)).toBeCloseTo(measured.avgSpeedKmh, 1);
  });

  it("avec session : 20 km/h (valeur device), pas 16,7 km/h (durée écoulée)", () => {
    const a = computeAnalysis(points, null, { measured });
    expect(a.avgSpeedSource).toBe("device");
    expect(a.avgSpeedKmh).toBeCloseTo(20.0088, 3);
    expect(a.movingTimeSec).toBe(5619);
    expect(a.avgSpeedElapsedKmh).toBeCloseTo(31.231 / (6731 / 3600), 2);
  });

  it("FIT sans valeur avg_speed : distance/timer officiels, même résultat", () => {
    const a = computeAnalysis(points, null, { measured: { ...measured, avgSpeedKmh: null } });
    expect(a.avgSpeedSource).toBe("derived");
    expect(a.avgSpeedKmh).toBeCloseTo(20.009, 2);
  });

  it("FIT dont avg_speed est invalide/aberrant : repli sur distance/timer", () => {
    for (const bad of [0, NaN, 9999, -4]) {
      const a = computeAnalysis(points, null, { measured: { ...measured, avgSpeedKmh: bad } });
      expect(a.avgSpeedSource).toBe("derived");
      expect(a.avgSpeedKmh).toBeCloseTo(20.009, 2);
    }
  });

  it("FIT sans session (points seuls) : les trous de pause sont détectés (≠ 16,7)", () => {
    const a = computeAnalysis(points, null);
    expect(a.avgSpeedSource).toBe("derived");
    expect(a.avgSpeedKmh).toBeGreaterThan(19);
    expect(a.avgSpeedKmh).toBeLessThan(21.5);
  });

  it("timer aberrant (> temps écoulé) : ignoré", () => {
    const a = computeAnalysis(points, null, { measured: { ...measured, timerSec: 99999, movingSec: 99999, avgSpeedKmh: null } });
    expect(a.movingTimeSec).toBeLessThanOrEqual(a.totalTimeSec);
    expect(a.avgSpeedKmh).toBeGreaterThan(15);
  });

  it("distance et D+ ne dépendent pas de la session", () => {
    const withS = toActivity(computeAnalysis(points, null, { measured }), points, { sourceType: "fit", measured });
    const without = toActivity(computeAnalysis(points), points, { sourceType: "fit", measured });
    expect(withS.distance).toBe(without.distance);
    expect(withS.elevationGain).toBe(without.elevationGain);
    expect(withS.avgSpeedMeasured).toBeCloseTo(20.0088, 3);
    expect(withS.speedModelVersion).toBe(SPEED_MODEL_VERSION);
  });

  it("tous les composants affichent la même valeur pour la même activité", () => {
    const analysis = computeAnalysis(points, null, { measured });
    const act = toActivity(analysis, points, { sourceType: "fit", measured });
    const feed = num(buildStats(act).primary.find((s) => s.key === "avgSpeed").value);
    const story = num(buildShareModel(act, { format: "story" }).stats.find((s) => s.key === "avgSpeed").value);
    const square = num(buildShareModel(act, { format: "square" }).stats.find((s) => s.key === "avgSpeed").value);
    expect(feed).toBe(20);
    expect(story).toBe(feed);
    expect(square).toBe(feed);
    // coach, profil (lecture seule), listes historique/accueil, dashboard détaillé (même analyse que l'import)
    for (const v of [summarizeRide(act).avgSpeedKmh, deriveActivitySignals(act).avgSpeedKmh, displayAvgSpeedKmh(act), analysis.avgSpeedKmh]) {
      expect(v).toBeCloseTo(act.avgSpeed, 10);
    }
  });
});

describe("anciennes activités déjà enregistrées", () => {
  // Simule un fichier source perdu : retire storedFilename de l'Activity enregistrée.
  async function patchLike(root, id) {
    const { patchActivity } = await import("./storage/activityStore.js");
    await patchActivity(root, id, () => ({ source: { type: "gpx", originalFilename: "x.gpx", storedFilename: null, sourceId: null, athleteId: null } }));
  }

  async function seedStale(root, { type = "fit", content, id, staleSpeed = 16.7 }) {
    const a = createEmptyActivity();
    Object.assign(a, {
      id, name: "ancienne", date: "2026-09-20T19:59:52.000Z", sportType: "cycling",
      distance: 31.2, duration: 6715, movingTime: 6715, avgSpeed: staleSpeed, elevationGain: 123, avgHeartRate: 140,
      source: { type, originalFilename: `x.${type}`, storedFilename: null, sourceId: null, athleteId: null },
    });
    await saveActivity(root, a, content, type === "strava" ? "gpx" : type);
  }

  it("recalcule vitesse et temps en mouvement depuis le FIT source, sans toucher aux autres champs", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { id: "old-fit", content: fitBuffer() });
    const report = await migrateStoredSpeeds(root);
    expect(report.failed).toEqual([]);
    expect(report.updated).toHaveLength(1);
    expect(report.updated[0].before.avgSpeed).toBe(16.7);

    const detail = await loadActivityDetail(root, "old-fit");
    expect(detail.avgSpeed).toBeCloseTo(20.0088, 3);
    expect(detail.movingTime).toBe(5619);
    expect(detail.avgSpeedSource).toBe("device");
    expect(detail.speedModelVersion).toBe(SPEED_MODEL_VERSION);
    expect(detail.elevationGain).toBe(123);
    expect(detail.avgHeartRate).toBe(140);
    expect(detail.distance).toBe(31.2);

    const [summary] = await listActivities(root);
    expect(summary.avgSpeed).toBeCloseTo(20.0088, 3);
  });

  it("est idempotente", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { id: "old-fit", content: fitBuffer() });
    await migrateStoredSpeeds(root);
    const second = await migrateStoredSpeeds(root);
    expect(second.updated).toEqual([]);
    expect(second.unchanged).toBe(1);
  });

  it("sorties Strava (sans fichier source) : laissées intactes et signalées", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { type: "strava", id: "old-strava", content: "", staleSpeed: 24.2 });
    const report = await migrateStoredSpeeds(root);
    expect(report.updated).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ id: "old-strava", reason: "strava" });
    const detail = await loadActivityDetail(root, "old-strava");
    expect(detail.avgSpeed).toBe(24.2);
    expect(detail.speedModelVersion).toBeNull(); // aucune écriture, pas même un marqueur
    const again = await migrateStoredSpeeds(root);
    expect(again.updated).toEqual([]);
  });

  it("une activité sans fichier source est inchangée octet pour octet", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { id: "no-src", content: "" });
    const a = await loadActivityDetail(root, "no-src");
    await patchLike(root, "no-src"); // supprime le fichier source
    const before = JSON.stringify(await loadActivityDetail(root, "no-src"));
    await migrateStoredSpeeds(root);
    expect(JSON.stringify(await loadActivityDetail(root, "no-src"))).toBe(before);
    expect(a.avgSpeed).toBe(16.7);
  });

  it("deux migrations lancées en même temps ne s'exécutent qu'une fois", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { id: "old-fit", content: fitBuffer() });
    const [r1, r2] = await Promise.all([migrateStoredSpeeds(root), migrateStoredSpeeds(root)]);
    expect(r1).toBe(r2);
    expect(r1.updated).toHaveLength(1);
  });

  it("une sortie importée avec la nouvelle règle n'est jamais re-migrée", async () => {
    const root = new MemoryDirectoryHandle();
    const { points, measured } = await parseFITArrayBuffer(fitBuffer());
    const act = toActivity(computeAnalysis(points, null, { measured }), points, { id: "fresh", sourceType: "fit", measured });
    await saveActivity(root, act, fitBuffer(), "fit");
    const report = await migrateStoredSpeeds(root);
    expect(report.updated).toEqual([]);
    expect(report.unchanged).toBe(1);
  });

  it("source illisible : échec rapporté, valeur conservée, nouvel essai possible", async () => {
    const root = new MemoryDirectoryHandle();
    await seedStale(root, { id: "broken", content: new ArrayBuffer(16) });
    const report = await migrateStoredSpeeds(root);
    expect(report.failed).toHaveLength(1);
    const detail = await loadActivityDetail(root, "broken");
    expect(detail.avgSpeed).toBe(16.7);
    expect(detail.speedModelVersion).toBeNull();
  });
});
