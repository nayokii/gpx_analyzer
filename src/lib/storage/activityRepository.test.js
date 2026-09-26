import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDirectoryHandle } from "./testFsHandle.js";
import { saveActivity as localSaveActivity, listActivities as localListActivities } from "./activityStore.js";
import { createEmptyActivity } from "../types.js";
import { parseFITArrayBuffer } from "../parsers/fitParser.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { createActivityRepository, mergeActivitySummaries, resolveConflict, onSyncCompleted, __resetSyncCoordinatorForTests } from "./activityRepository.js";
import { listQueuedUploads, clearQueue } from "./syncQueue.js";
import { __setSupabaseClientForTests } from "../cloud/client.js";
import { createFakeSupabaseBackend } from "../cloud/tests/fakeSupabase.js";
import { uploadActivity as cloudUploadActivity } from "../cloud/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "parsers", "__fixtures__", "ride-2026-09-20.fit");

function loadFitFixtureArrayBuffer() {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** GPX minimal mais réellement parsable (2 trkpt datés) — `seed` varie le contenu (donc le hash) entre sorties. */
function minimalGpx(seed = "x") {
  return `<?xml version="1.0"?>
<gpx><trk><name>${seed}</name><trkseg>
<trkpt lat="45.0000" lon="5.0000"><ele>200</ele><time>2026-09-20T08:00:00Z</time></trkpt>
<trkpt lat="45.0010" lon="5.0010"><ele>210</ele><time>2026-09-20T08:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;
}

/** Construit une Activity dont les métadonnées (distance...) sont réellement cohérentes avec `gpxContent` — évite un faux conflit (voir consigne §22) quand cette activité sera plus tard reparsée depuis le cloud. */
function activityFromGpx(id, gpxContent) {
  const { name, points } = parseGPXString(gpxContent);
  const analysis = computeAnalysis(points, null);
  return toActivity(analysis, points, { id, name: name || id, sourceType: "gpx", originalFilename: `${id}.gpx` });
}

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "local-a1",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 30,
    duration: 5400,
    movingTime: 5000,
    elevationGain: 300,
    elevationLoss: 280,
    avgSpeed: 21.6,
    maxSpeed: 45,
    flags: { ...a.flags, hasGps: true },
    samples: [],
    gpsTrack: [],
    source: { type: "gpx", originalFilename: "sortie.gpx", storedFilename: null, sourceId: null, athleteId: null },
    ...overrides,
  };
}

beforeEach(() => {
  clearQueue();
  __resetSyncCoordinatorForTests();
});

afterEach(() => {
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
});

/* ------------------------------------------------------------------ */
/* mergeActivitySummaries — fonction pure                              */
/* ------------------------------------------------------------------ */

describe("mergeActivitySummaries", () => {
  it("garde une entrée locale sans équivalent cloud comme 'local-only'", () => {
    const merged = mergeActivitySummaries([{ id: "a", date: "2026-09-01", distance: 10 }], []);
    expect(merged).toEqual([expect.objectContaining({ id: "a", syncStatus: "local-only" })]);
  });

  it("expose une entrée cloud sans équivalent local comme 'cloud-only', avec l'id = local_id enregistré", () => {
    const merged = mergeActivitySummaries([], [{ id: "cloud-uuid-1", localId: "orig-local-id", distance: 10, startedAt: "2026-09-01" }]);
    expect(merged).toEqual([expect.objectContaining({ id: "orig-local-id", cloudId: "cloud-uuid-1", syncStatus: "cloud-only" })]);
  });

  it("retombe sur l'id cloud lui-même si local_id est absent (ligne cloud jamais liée à un id local connu)", () => {
    const merged = mergeActivitySummaries([], [{ id: "cloud-uuid-2", localId: null, distance: 10, startedAt: "2026-09-01" }]);
    expect(merged[0].id).toBe("cloud-uuid-2");
  });

  it("fusionne en une SEULE entrée quand local.id === cloud.local_id (jamais de doublon, voir consigne §16)", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30 }],
      [{ id: "cloud-uuid-1", localId: "a", distance: 30, startedAt: "2026-09-01" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].syncStatus).toBe("synced");
  });

  it("signale un conflit si la même clé a des distances incompatibles entre local et cloud", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30 }],
      [{ id: "cloud-uuid-1", localId: "a", distance: 55, startedAt: "2026-09-01" }]
    );
    expect(merged[0].syncStatus).toBe("conflict");
  });

  it("porte les deux versions (locale et cloud) en cas de conflit, pour une UI de résolution (consigne 11C §16)", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30, duration: 5000 }],
      [{ id: "cloud-uuid-1", localId: "a", distance: 55, duration: 6000, startedAt: "2026-09-02", sourceFormat: "gpx" }]
    );
    expect(merged[0].distance).toBe(30); // version locale au premier niveau
    expect(merged[0].cloudVersion).toMatchObject({ distance: 55, duration: 6000, date: "2026-09-02" });
  });

  it("ne porte jamais cloudVersion pour une entrée synchronisée sans conflit", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30 }],
      [{ id: "cloud-uuid-1", localId: "a", distance: 30, startedAt: "2026-09-01" }]
    );
    expect(merged[0].syncStatus).toBe("synced");
    expect(merged[0].cloudVersion).toBeUndefined();
  });

  it("(Phase 11C) marque 'cloud-deleted' — pas 'local-only' — une activité locale déjà confirmée synchronisée dont la ligne cloud a disparu", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30, source: { type: "gpx", sourceId: "cloud-uuid-ancien" } }],
      [] // la ligne cloud a été supprimée (par un autre appareil)
    );
    expect(merged[0].syncStatus).toBe("cloud-deleted");
  });

  it("(Phase 11C) reste 'local-only' pour une activité jamais synchronisée (source.sourceId absent)", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30, source: { type: "gpx", sourceId: null } }],
      []
    );
    expect(merged[0].syncStatus).toBe("local-only");
  });

  it("ne signale PAS de conflit pour un simple écart d'arrondi flottant", () => {
    const merged = mergeActivitySummaries(
      [{ id: "a", date: "2026-09-01", distance: 30.001 }],
      [{ id: "cloud-uuid-1", localId: "a", distance: 30.0009, startedAt: "2026-09-01" }]
    );
    expect(merged[0].syncStatus).toBe("synced");
  });

  it("trie du plus récent au plus ancien, quelle que soit la provenance", () => {
    const merged = mergeActivitySummaries(
      [{ id: "old", date: "2026-01-01", distance: 1 }],
      [{ id: "cloud-1", localId: "new", distance: 1, startedAt: "2026-09-01" }]
    );
    expect(merged.map((m) => m.id)).toEqual(["new", "old"]);
  });
});

/* ------------------------------------------------------------------ */
/* Mode local seul (aucun utilisateur cloud) — comportement inchangé   */
/* ------------------------------------------------------------------ */

describe("createActivityRepository — local seul (comportement 11A inchangé)", () => {
  it("listActivities()/loadActivityDetail() retombent exactement sur le stockage local", async () => {
    const root = new MemoryDirectoryHandle();
    await localSaveActivity(root, makeActivity({ id: "a1" }), "<gpx/>", "gpx");
    const repo = createActivityRepository({ rootHandle: root, cloudUser: null });

    const { items, source } = await repo.listActivities();
    expect(source).toBe("local");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("a1");
    expect(items[0].syncStatus).toBeUndefined(); // jamais annoté quand le cloud n'est pas utilisé

    const detail = await repo.loadActivityDetail("a1");
    expect(detail.id).toBe("a1");
  });

  it("saveActivity() enregistre localement sans jamais tenter d'appel cloud", async () => {
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: null });
    const { activity, cloudSyncPromise } = await repo.saveActivity(makeActivity({ id: "a2" }), "<gpx/>", "gpx");
    expect(activity.id).toBe("a2");
    const { cloudSynced, cloudError } = await cloudSyncPromise;
    expect(cloudSynced).toBe(false);
    expect(cloudError).toBeNull();
    expect(listQueuedUploads()).toHaveLength(0);
  });

  it("deleteActivity()/hasActivity() fonctionnent sans cloud", async () => {
    const root = new MemoryDirectoryHandle();
    await localSaveActivity(root, makeActivity({ id: "a3" }), "<gpx/>", "gpx");
    const repo = createActivityRepository({ rootHandle: root, cloudUser: null });
    expect(await repo.hasActivity("a3")).toBe(true);
    await repo.deleteActivity("a3");
    expect(await repo.hasActivity("a3")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Mode cloud seul (téléphone sans dossier local connecté)             */
/* ------------------------------------------------------------------ */

describe("createActivityRepository — cloud seul (aucun dossier local)", () => {
  it("liste une activité cloud-only, et loadActivityDetail() la matérialise (reparse le fichier original)", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("phone@example.com");

    const arrayBuffer = loadFitFixtureArrayBuffer();
    const { name, points, measured } = await parseFITArrayBuffer(arrayBuffer);
    const analysis = computeAnalysis(points, { weight: 75, bikeWeight: 8 });
    const activity = toActivity(analysis, points, { id: "device-a-id", name, sourceType: "fit", originalFilename: "ride.fit", measured });
    await cloudUploadActivity({ activity, originalFileContent: arrayBuffer, sourceFormat: "fit" });

    const repo = createActivityRepository({ rootHandle: null, cloudUser: user });
    const { items, source } = await repo.listActivities();
    expect(source).toBe("cloud");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("device-a-id");
    expect(items[0].syncStatus).toBe("cloud-only");

    const detail = await repo.loadActivityDetail("device-a-id");
    expect(detail.id).toBe("device-a-id");
    expect(detail.samples.length).toBeGreaterThan(0); // vraiment reparsé, pas juste les métadonnées légères
    expect(detail.distance).toBeCloseTo(activity.distance, 3);
  });

  it("sans dossier local, la matérialisation ne tente jamais d'écrire sur disque (hasLocal=false)", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("phone2@example.com");
    await cloudUploadActivity({
      activity: makeActivity({ id: "cloud-only-1" }),
      originalFileContent: minimalGpx("cloud-only-1"),
      sourceFormat: "gpx",
    });

    const repo = createActivityRepository({ rootHandle: null, cloudUser: user });
    // Ne doit pas lever, même sans rootHandle.
    const detail = await repo.loadActivityDetail("cloud-only-1");
    expect(detail.id).toBe("cloud-only-1");
  });
});

/* ------------------------------------------------------------------ */
/* Cas mixte (consigne §11) : A local-only, B/C synced, D cloud-only   */
/* ------------------------------------------------------------------ */

describe("createActivityRepository — cas mixte et sync() bidirectionnel", () => {
  it("réconcilie A(local)/B,C(synced)/D(cloud) : sync() aboutit à A,B,C,D des deux côtés", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("mixed@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    // A : locale uniquement (jamais envoyée au cloud avant sync()).
    await localSaveActivity(root, makeActivity({ id: "A", name: "A" }), minimalGpx("A"), "gpx");

    // B, C : déjà synchronisées (upload via le repository, qui écrit les deux
    // côtés — cloudSyncPromise est attendu explicitement ici : l'upload cloud
    // se fait en arrière-plan depuis la Phase 11C, voir saveActivity()).
    const b = await repo.saveActivity(makeActivity({ id: "B", name: "B" }), minimalGpx("B"), "gpx");
    await b.cloudSyncPromise;
    const c = await repo.saveActivity(makeActivity({ id: "C", name: "C" }), minimalGpx("C"), "gpx");
    await c.cloudSyncPromise;

    // D : cloud uniquement (uploadée depuis un autre appareil, jamais vue localement ici).
    await cloudUploadActivity({ activity: activityFromGpx("D", minimalGpx("D")), originalFileContent: minimalGpx("D"), sourceFormat: "gpx" });

    const before = await repo.listActivities();
    const statusById = Object.fromEntries(before.items.map((i) => [i.id, i.syncStatus]));
    expect(statusById).toEqual({ A: "local-only", B: "synced", C: "synced", D: "cloud-only" });

    const progressed = [];
    const result = await repo.sync({ onProgress: (p) => progressed.push({ ...p }) });
    expect(result.uploaded).toBe(1); // A
    expect(result.downloaded).toBe(1); // D
    expect(result.alreadySynced).toBe(2); // B, C
    expect(result.errors).toEqual([]);
    expect(progressed.length).toBeGreaterThan(0);
    expect(progressed.at(-1)).toEqual({ current: 2, total: 2 });

    const localIds = (await localListActivities(root)).map((a) => a.id).sort();
    expect(localIds).toEqual(["A", "B", "C", "D"]);

    const after = await repo.listActivities();
    const statusAfter = Object.fromEntries(after.items.map((i) => [i.id, i.syncStatus]));
    expect(statusAfter).toEqual({ A: "synced", B: "synced", C: "synced", D: "synced" });
  });
});

/* ------------------------------------------------------------------ */
/* Échec d'upload → file d'attente (consigne §21)                      */
/* ------------------------------------------------------------------ */

describe("createActivityRepository — idempotence (consigne 11C §6)", () => {
  it("uploader 3 fois le même fichier via saveActivity() ne crée qu'une seule activité cloud", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("idempotent@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    const gpx = minimalGpx("idempotent");
    const activity = activityFromGpx("A", gpx);

    for (let i = 0; i < 3; i++) {
      const { cloudSyncPromise } = await repo.saveActivity(activity, gpx, "gpx");
      const { cloudSynced } = await cloudSyncPromise;
      expect(cloudSynced).toBe(true); // succès direct ou doublon reconnu, jamais un échec
    }

    const cloudActivities = await backend.client.from("activities").select();
    expect(cloudActivities.data).toHaveLength(1);
  });

  it("rejouer sync() plusieurs fois de suite sans rien de nouveau ne produit aucun changement ni doublon", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("idempotent2@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    const gpx = minimalGpx("idempotent2");
    const { cloudSyncPromise } = await repo.saveActivity(activityFromGpx("A", gpx), gpx, "gpx");
    await cloudSyncPromise;

    const first = await repo.sync({ force: true });
    const second = await repo.sync({ force: true });
    expect(first.alreadySynced).toBe(1);
    expect(second.alreadySynced).toBe(1);
    expect(second.uploaded).toBe(0);
    expect(second.downloaded).toBe(0);

    const { items } = await repo.listActivities();
    expect(items).toHaveLength(1);
  });

  it("(consigne §12) une sync() sans rien de nouveau ne notifie jamais onSyncCompleted — jamais de recalcul pour rien", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("idempotent3@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    const gpx = minimalGpx("idempotent3");
    const { cloudSyncPromise } = await repo.saveActivity(activityFromGpx("A", gpx), gpx, "gpx");
    await cloudSyncPromise;

    const notifications = [];
    const unsubscribe = onSyncCompleted((result) => notifications.push(result));
    await repo.sync({ force: true }); // rien de nouveau : A est déjà synchronisée
    unsubscribe();

    expect(notifications).toEqual([]);
  });

  it("(consigne §12) une sync() qui télécharge une nouvelle activité notifie onSyncCompleted", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("idempotent4@example.com");
    const gpx = minimalGpx("idempotent4");
    await cloudUploadActivity({ activity: activityFromGpx("A", gpx), originalFileContent: gpx, sourceFormat: "gpx" });

    const repo = createActivityRepository({ rootHandle: new MemoryDirectoryHandle(), cloudUser: user });
    const notifications = [];
    const unsubscribe = onSyncCompleted((result) => notifications.push(result));
    await repo.sync({ force: true }); // A est cloud-only : doit être téléchargée
    unsubscribe();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].downloaded).toBe(1);
  });
});

describe("createActivityRepository — échec d'upload cloud", () => {
  it("une sortie importée reste enregistrée localement même si l'upload cloud échoue, et est mise en attente", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    // cloudUser "vu" par le repository, mais la session RÉELLE du client
    // simulé n'est jamais ouverte : simule un jeton expiré / cloud
    // momentanément inaccessible sans avoir à fabriquer une vraie panne réseau.
    const repo = createActivityRepository({ rootHandle: new MemoryDirectoryHandle(), cloudUser: { id: "ghost" } });

    const { activity, cloudSyncPromise } = await repo.saveActivity(makeActivity({ id: "offline-1" }), "<gpx/>", "gpx");
    expect(activity.id).toBe("offline-1");
    const { cloudSynced, cloudError } = await cloudSyncPromise;
    expect(cloudSynced).toBe(false);
    expect(cloudError).toBeTruthy();
    expect(listQueuedUploads().map((q) => q.activityId)).toContain("offline-1");

    // La sortie reste lisible localement (jamais perdue, voir consigne §19).
    expect(await repo.hasActivity("offline-1")).toBe(true);
  });

  it("un nouvel appel à sync() après reconnexion réussit là où l'upload immédiat avait échoué (retry)", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const root = new MemoryDirectoryHandle();

    // 1) Session cloud non ouverte au moment de l'import -> upload immédiat en échec, mis en attente.
    const offlineRepo = createActivityRepository({ rootHandle: root, cloudUser: { id: "ghost" } });
    const { cloudSyncPromise } = await offlineRepo.saveActivity(makeActivity({ id: "retry-1" }), minimalGpx("retry-1"), "gpx");
    const { cloudSynced } = await cloudSyncPromise;
    expect(cloudSynced).toBe(false);
    expect(listQueuedUploads().map((q) => q.activityId)).toContain("retry-1");

    // 2) Connexion retrouvée : un repository fraîchement construit avec la vraie session...
    const user = await backend.signUpAndLogin("retry@example.com");
    const onlineRepo = createActivityRepository({ rootHandle: root, cloudUser: user });

    // 3) ...et sync() retrouve "retry-1" comme local-only (dérivé frais, pas rejoué depuis la file) et l'envoie.
    const result = await onlineRepo.sync();
    expect(result.uploaded).toBe(1);
    expect(result.errors).toEqual([]);
    expect(listQueuedUploads().map((q) => q.activityId)).not.toContain("retry-1"); // sync() retire l'entrée en attente une fois l'upload réussi

    const { items } = await onlineRepo.listActivities();
    expect(items.find((i) => i.id === "retry-1").syncStatus).toBe("synced");
  });
});

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

describe("createActivityRepository — deleteActivity", () => {
  it("supprime la ligne cloud correspondante en plus du fichier local", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("del@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    const { cloudSyncPromise } = await repo.saveActivity(makeActivity({ id: "to-delete" }), "<gpx/>", "gpx");
    await cloudSyncPromise; // attend la fin de l'upload cloud en arrière-plan avant de tester sa suppression
    expect(await repo.hasActivity("to-delete")).toBe(true);

    await repo.deleteActivity("to-delete");
    expect(await repo.hasActivity("to-delete")).toBe(false);

    const { items } = await repo.listActivities();
    expect(items.find((i) => i.id === "to-delete")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Conflits (Phase 11C §13-16)                                          */
/* ------------------------------------------------------------------ */

describe("resolveConflict (pure, sans I/O)", () => {
  it("traduit le choix 'local' en action 'upload-local'", () => {
    expect(resolveConflict({ choice: "local" })).toEqual({ action: "upload-local" });
  });
  it("traduit le choix 'cloud' en action 'download-cloud'", () => {
    expect(resolveConflict({ choice: "cloud" })).toEqual({ action: "download-cloud" });
  });
  it("traduit 'cancel' (ou toute valeur inconnue) en 'none' — ne résout jamais par défaut", () => {
    expect(resolveConflict({ choice: "cancel" })).toEqual({ action: "none" });
    expect(resolveConflict({ choice: undefined })).toEqual({ action: "none" });
  });
});

describe("createActivityRepository — applyConflictResolution", () => {
  const CLOUD_GPX = `<?xml version="1.0"?><gpx><trk><name>cloud</name><trkseg>
<trkpt lat="46.0000" lon="6.0000"><ele>500</ele><time>2026-09-20T08:00:00Z</time></trkpt>
<trkpt lat="46.5000" lon="6.5000"><ele>900</ele><time>2026-09-20T09:00:00Z</time></trkpt>
</trkseg></trk></gpx>`; // parcours très différent du local -> distance nettement différente, garantit un conflit détecté

  async function setupConflict() {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);
    const user = await backend.signUpAndLogin("conflict@example.com");
    const root = new MemoryDirectoryHandle();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });

    const localGpx = minimalGpx("conflict-local");
    await localSaveActivity(root, activityFromGpx("conf-1", localGpx), localGpx, "gpx");

    const cloudActivity = activityFromGpx("conf-1", CLOUD_GPX);
    await cloudUploadActivity({ activity: cloudActivity, originalFileContent: CLOUD_GPX, sourceFormat: "gpx" });

    return { repo, root, user, cloudActivity };
  }

  it("détecte bien un conflit avant toute résolution (prérequis du scénario)", async () => {
    const { repo } = await setupConflict();
    const { items } = await repo.listActivities();
    expect(items.find((i) => i.id === "conf-1").syncStatus).toBe("conflict");
  });

  it("'local' : réenvoie la version locale au cloud, qui devient la version faisant foi des deux côtés", async () => {
    const { repo } = await setupConflict();
    const resolution = await repo.applyConflictResolution("conf-1", "local");
    expect(resolution.action).toBe("upload-local");

    const { items } = await repo.listActivities();
    expect(items.find((i) => i.id === "conf-1").syncStatus).toBe("synced");
  });

  it("'cloud' : retélécharge la version cloud et écrase la copie locale", async () => {
    const { repo, cloudActivity } = await setupConflict();
    const resolution = await repo.applyConflictResolution("conf-1", "cloud");
    expect(resolution.action).toBe("download-cloud");

    const { items } = await repo.listActivities();
    expect(items.find((i) => i.id === "conf-1").syncStatus).toBe("synced");

    const detail = await repo.loadActivityDetail("conf-1");
    expect(detail.distance).toBeCloseTo(cloudActivity.distance, 1);
  });

  it("'cancel' : ne modifie ni le local ni le cloud, le conflit reste signalé (jamais résolu silencieusement)", async () => {
    const { repo } = await setupConflict();
    const resolution = await repo.applyConflictResolution("conf-1", "cancel");
    expect(resolution.action).toBe("none");

    const { items } = await repo.listActivities();
    expect(items.find((i) => i.id === "conf-1").syncStatus).toBe("conflict");
  });
});
