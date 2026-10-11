import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryDirectoryHandle } from "./storage/testFsHandle.js";
import { saveActivity, listActivities, loadActivityDetail, patchActivity, deleteActivity, readIndex } from "./storage/activityStore.js";
import { migrateStoredSpeeds } from "./storage/speedMigration.js";
import { SPEED_MODEL_VERSION } from "./speed.js";
import { createEmptyActivity } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fitBuffer = () => {
  const buf = fs.readFileSync(path.join(__dirname, "parsers", "__fixtures__", "ride-2026-09-20.fit"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

function stale(id, overrides = {}) {
  return {
    ...createEmptyActivity(), id, name: id, date: "2026-09-12T08:00:00.000Z", sportType: "cycling",
    distance: 31.2, duration: 6715, movingTime: 6715, avgSpeed: 16.7, elevationGain: 100,
    source: { type: "fit", originalFilename: "x.fit", storedFilename: null, sourceId: null, athleteId: null },
    ...overrides,
  };
}

/** Fait échouer l'écriture des fichiers dont le nom satisfait `shouldFail(name)` ; renvoie la fonction de rétablissement. */
async function failWrites(root, shouldFail) {
  const dir = await root.getDirectoryHandle("activities");
  const original = dir.getFileHandle.bind(dir);
  dir.getFileHandle = async (name, opts) => {
    const h = await original(name, opts);
    if (!shouldFail(name)) return h;
    return {
      kind: "file", name,
      getFile: () => h.getFile(),
      createWritable: async () => { throw new Error("disque plein (simule)"); },
    };
  };
  return () => { dir.getFileHandle = original; };
}

const dump = (dir) => JSON.stringify([...dir.files.entries()].map(([k, v]) => [k, typeof v === "string" ? v : Array.from(new Uint8Array(v))]));

describe("migration : ecritures concurrentes sur index.json", () => {
  it("imports, suppression et migration simultanes : aucune entree d'index perdue", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("old-1"), fitBuffer(), "fit");
    await saveActivity(root, stale("doomed"), fitBuffer(), "fit");

    const imports = ["new-a", "new-b", "new-c", "new-d", "new-e"].map((id) =>
      saveActivity(root, { ...stale(id), speedModelVersion: SPEED_MODEL_VERSION, avgSpeed: 20 }, fitBuffer(), "fit")
    );
    await Promise.all([migrateStoredSpeeds(root), deleteActivity(root, "doomed"), ...imports]);

    const index = await readIndex(await root.getDirectoryHandle("activities"));
    expect(index.map((e) => e.id).sort()).toEqual(["new-a", "new-b", "new-c", "new-d", "new-e", "old-1"]);
    expect(index.find((e) => e.id === "old-1").avgSpeed).toBeCloseTo(20.0088, 3);
    for (const e of index) expect((await loadActivityDetail(root, e.id)).avgSpeed).toBe(e.avgSpeed);
  });

  it("patchActivity renonce sans rien ecrire quand compute() renvoie null", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("keep"), fitBuffer(), "fit");
    const dir = await root.getDirectoryHandle("activities");
    const before = dump(dir);
    expect(await patchActivity(root, "keep", () => null)).toBeNull();
    expect(dump(dir)).toBe(before);
  });

  it("ne remplace pas une sortie reimportee entre la lecture et l'ecriture", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("race"), fitBuffer(), "fit");
    await saveActivity(root, { ...stale("race"), avgSpeed: 20.01, speedModelVersion: SPEED_MODEL_VERSION }, fitBuffer(), "fit");
    const out = await patchActivity(root, "race", (cur) => ((cur.speedModelVersion || 0) < SPEED_MODEL_VERSION ? { avgSpeed: 1 } : null));
    expect(out).toBeNull();
    expect((await loadActivityDetail(root, "race")).avgSpeed).toBe(20.01);
  });
});

describe("migration : echecs, redemarrage, marquage", () => {
  it("ecriture du JSON en echec : jamais marquee migree, rapportee, rejouee ensuite, puis stable", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("flaky"), fitBuffer(), "fit");
    const restore = await failWrites(root, (n) => n.endsWith("_flaky.json"));

    const failed = await migrateStoredSpeeds(root);
    expect(failed.updated).toEqual([]);
    expect(failed.failed).toHaveLength(1);
    restore();
    const detail = await loadActivityDetail(root, "flaky");
    expect(detail.speedModelVersion).toBeNull();
    expect(detail.avgSpeed).toBe(16.7);

    // "redemarrage" : nouvel appel, disque retabli
    const ok = await migrateStoredSpeeds(root);
    expect(ok.updated).toHaveLength(1);
    expect((await loadActivityDetail(root, "flaky")).speedModelVersion).toBe(SPEED_MODEL_VERSION);
    const third = await migrateStoredSpeeds(root);
    expect(third.updated).toEqual([]);
    expect(third.unchanged).toBe(1);
  });

  it("ecriture de l'index en echec : le JSON n'est pas marque non plus", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("idx"), fitBuffer(), "fit");
    const restore = await failWrites(root, (n) => n === "index.json");
    const report = await migrateStoredSpeeds(root);
    restore();
    expect(report.failed).toHaveLength(1);
    expect((await loadActivityDetail(root, "idx")).speedModelVersion).toBeNull();
    expect((await migrateStoredSpeeds(root)).updated).toHaveLength(1);
  });

  it("fichier source illisible puis repare : rejoue au passage suivant", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("broken"), new ArrayBuffer(16), "fit");
    expect((await migrateStoredSpeeds(root)).failed).toHaveLength(1);
    const dir = await root.getDirectoryHandle("activities");
    const fitName = [...dir.files.keys()].find((k) => k.endsWith(".fit"));
    dir.files.set(fitName, fitBuffer());
    expect((await migrateStoredSpeeds(root)).updated).toHaveLength(1);
    expect((await migrateStoredSpeeds(root)).updated).toEqual([]);
  });

  it("sortie Strava : dossier entier strictement identique octet pour octet apres deux passages", async () => {
    const root = new MemoryDirectoryHandle();
    const strava = stale("strava-1", { source: { type: "strava", originalFilename: null, storedFilename: null, sourceId: "9", athleteId: null }, avgSpeed: 24.2 });
    await saveActivity(root, strava, "", "gpx");
    const dir = await root.getDirectoryHandle("activities");
    const before = dump(dir);
    await migrateStoredSpeeds(root);
    await migrateStoredSpeeds(root);
    expect(dump(dir)).toBe(before);
    expect((await listActivities(root))[0].avgSpeed).toBe(24.2);
  });

  it("sortie dont le fichier source a ete perdu : intacte octet pour octet", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, stale("nosrc", { source: { type: "gpx", originalFilename: "x.gpx", storedFilename: null, sourceId: null, athleteId: null } }), "<gpx/>", "gpx");
    // retire le champ storedFilename comme si l'Activity n'avait jamais eu de fichier source
    await patchActivity(root, "nosrc", () => ({ source: { type: "gpx", originalFilename: "x.gpx", storedFilename: null, sourceId: null, athleteId: null } }));
    const dir = await root.getDirectoryHandle("activities");
    const before = dump(dir);
    const report = await migrateStoredSpeeds(root);
    expect(report.skipped[0]).toMatchObject({ id: "nosrc", reason: "source-missing" });
    expect(dump(dir)).toBe(before);
  });
});
