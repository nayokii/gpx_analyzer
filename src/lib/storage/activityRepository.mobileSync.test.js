/**
 * Synchronisation cloud autonome sur mobile — appareil SANS dossier local.
 *
 * Chaque « appareil » a son propre stockage IndexedDB (fake-indexeddb, une
 * fabrique distincte par appareil) et partage un backend Supabase SIMULÉ
 * (voir cloud/tests/fakeSupabase.js). Ces tests valident la LOGIQUE de
 * synchronisation ; ils ne prouvent PAS les policies RLS réelles ni le
 * comportement d'un vrai navigateur mobile (voir docs/CLOUD_ARCHITECTURE.md).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { getBrowserStoreRoot } from "./browserStore.js";
import {
  listActivities as localList,
  loadActivityDetail as localDetail,
  loadActivitySourceArrayBuffer,
} from "./activityStore.js";
import { createActivityRepository, __resetSyncCoordinatorForTests } from "./activityRepository.js";
import { listQueuedOperations, clearQueue } from "./syncQueue.js";
import { __setSupabaseClientForTests } from "../cloud/client.js";
import { createFakeSupabaseBackend } from "../cloud/tests/fakeSupabase.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";

function gpx(seed) {
  return `<?xml version="1.0"?><gpx><trk><name>ride-${seed}</name><trkseg>
<trkpt lat="45.0${seed}0" lon="5.0${seed}0"><ele>200</ele><time>2026-09-2${seed}T08:00:00Z</time></trkpt>
<trkpt lat="45.0${seed}5" lon="5.0${seed}5"><ele>230</ele><time>2026-09-2${seed}T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>`;
}

function activityFrom(content, name = "ride") {
  const { points } = parseGPXString(content);
  return toActivity(computeAnalysis(points, null), points, { name, sourceType: "gpx", originalFilename: `${name}.gpx` });
}

/** Un « téléphone » : stockage IndexedDB neuf et indépendant. */
function newDevice() {
  return getBrowserStoreRoot({ dbName: "cycling-os-test", idb: new IDBFactory() });
}

let backend;
let user;

beforeEach(async () => {
  clearQueue();
  __resetSyncCoordinatorForTests();
  backend = createFakeSupabaseBackend();
  __setSupabaseClientForTests(backend.client);
  user = await backend.signUpAndLogin("mobile@example.com");
});

afterEach(() => {
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
});

describe("import mobile sans dossier local", () => {
  it("1+2) enregistre en local (IndexedDB) puis ne dit « synced » qu'après confirmation du serveur", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(1);

    const { activity, cloudSyncPromise } = await repo.saveActivity(activityFrom(content), content, "gpx");
    expect((await localList(root)).map((e) => e.id)).toEqual([activity.id]); // copie locale durable immédiate

    const outcome = await cloudSyncPromise;
    expect(outcome).toMatchObject({ state: "synced", cloudSynced: true });
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect([...backend._debug.storageObjects.keys()]).toHaveLength(1); // ligne ET fichier présents
    expect((await localDetail(root, activity.id)).source.sourceId).toBe(backend._debug.activitiesTable[0].id);
  });

  it("FIT : le binaire est conservé tel quel dans IndexedDB", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: null });
    const bytes = new Uint8Array([14, 16, 0, 0, 1, 2, 3, 250, 251, 252]).buffer;
    const base = activityFrom(gpx(2));
    const { activity } = await repo.saveActivity({ ...base, source: { ...base.source, type: "fit", originalFilename: "a.fit" } }, bytes, "fit");
    const back = await loadActivitySourceArrayBuffer(root, activity.id);
    expect([...new Uint8Array(back)]).toEqual([14, 16, 0, 0, 1, 2, 3, 250, 251, 252]);
  });

  it("3) après rechargement, les sorties reviennent du cloud — et du cache si le cloud est injoignable", async () => {
    const root = newDevice();
    const first = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(3);
    const { activity, cloudSyncPromise } = await first.saveActivity(activityFrom(content), content, "gpx");
    await cloudSyncPromise;

    __resetSyncCoordinatorForTests();
    const reloaded = createActivityRepository({ rootHandle: root, cloudUser: user });
    const online = await reloaded.listActivities();
    expect(online.source).toBe("cloud");
    expect(online.items).toHaveLength(1);
    expect(online.items[0].syncStatus).toBe("synced");

    backend.setNetworkDown(true); // PC éteint ET cloud injoignable : le cache de l'appareil suffit
    const offline = await reloaded.listActivities();
    expect(["error", "offline"]).toContain(offline.source);
    expect(offline.items.map((i) => i.id)).toEqual([activity.id]);
    expect((await reloaded.loadActivityDetail(activity.id)).samples.length).toBeGreaterThan(0);
  });

  it("4) synchronisations répétées : aucun doublon", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(4);
    await (await repo.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;

    for (let i = 0; i < 3; i++) {
      const r = await repo.sync({ force: true });
      expect(r.errors).toEqual([]);
      expect(r.uploaded).toBe(0);
    }
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect(await localList(root)).toHaveLength(1);
  });

  it("5) échec réseau : copie locale gardée, jamais « synced », file d'attente, puis nouvelle tentative", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(5);

    backend.setNetworkDown(true);
    const { activity, cloudSyncPromise } = await repo.saveActivity(activityFrom(content), content, "gpx");
    const outcome = await cloudSyncPromise;
    expect(outcome.state).toBe("error");
    expect(outcome.cloudSynced).toBe(false);
    expect(await localList(root)).toHaveLength(1);
    expect(listQueuedOperations().map((q) => q.activityId)).toEqual([activity.id]);
    expect(backend._debug.activitiesTable).toHaveLength(0);

    backend.setNetworkDown(false);
    const retry = await repo.sync({ force: true });
    expect(retry.errors).toEqual([]);
    expect(retry.uploaded).toBe(1);
    expect(listQueuedOperations()).toEqual([]);
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });

  it("5b) échec du téléversement du fichier : aucune ligne cloud ne reste, la sortie reste en attente", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(5);
    const realUpload = backend.client.storage.from;
    backend.client.storage.from = (bucket) => ({ ...realUpload(bucket), upload: async () => ({ data: null, error: { message: "Payload too large" } }) });

    const { cloudSyncPromise } = await repo.saveActivity(activityFrom(content), content, "gpx");
    expect((await cloudSyncPromise).state).toBe("error");
    expect(backend._debug.activitiesTable).toHaveLength(0);
    expect(listQueuedOperations()).toHaveLength(1);
    backend.client.storage.from = realUpload;
  });

  it("6) compte non connecté : enregistré en local seulement, envoyé à la connexion", async () => {
    const root = newDevice();
    const anon = createActivityRepository({ rootHandle: root, cloudUser: null });
    const content = gpx(6);
    const { cloudSyncPromise } = await anon.saveActivity(activityFrom(content), content, "gpx");
    expect(await cloudSyncPromise).toMatchObject({ state: "local", cloudSynced: false });
    expect(backend._debug.activitiesTable).toHaveLength(0);

    const logged = createActivityRepository({ rootHandle: root, cloudUser: user });
    const result = await logged.sync({ force: true }); // « données locales présentes mais absentes du cloud »
    expect(result.uploaded).toBe(1);
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });

  it("hors ligne déclaré par le navigateur : pas de tentative, état « offline », rejoué ensuite", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(1);
    const spy = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      const { cloudSyncPromise } = await repo.saveActivity(activityFrom(content), content, "gpx");
      expect((await cloudSyncPromise).state).toBe("offline");
      expect(backend._debug.activitiesTable).toHaveLength(0);
    } finally {
      delete navigator.onLine;
      if (spy) Object.defineProperty(Navigator.prototype, "onLine", spy);
    }
    expect((await repo.sync({ force: true })).uploaded).toBe(1);
  });
});

describe("plusieurs comptes et plusieurs appareils", () => {
  it("7) isolation : un autre compte ne voit ni ne touche les sorties du premier (cloud ET cache partagé)", async () => {
    const root = newDevice();
    const repoA = createActivityRepository({ rootHandle: root, cloudUser: user });
    const content = gpx(1);
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;

    const userB = await backend.signUpAndLogin("autre@example.com");
    const repoB = createActivityRepository({ rootHandle: root, cloudUser: userB }); // même téléphone
    const list = await repoB.listActivities();
    expect(list.items).toHaveLength(0);
    const r = await repoB.sync({ force: true });
    expect(r).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocally: 0 });
    expect(await localList(root)).toHaveLength(1); // la copie du compte A est intacte
    expect(backend._debug.activitiesTable.filter((row) => row.user_id === userB.id)).toHaveLength(0);

    // Un second téléphone, compte B : cloud vide, rien de A.
    const phoneB = createActivityRepository({ rootHandle: newDevice(), cloudUser: userB });
    expect((await phoneB.sync({ force: true })).downloaded).toBe(0);

    backend.setSessionUser(user); // retour sur A : tout est encore là
    __resetSyncCoordinatorForTests();
    expect((await repoA.listActivities()).items).toHaveLength(1);
  });

  it("8) deux appareils importent le MÊME fichier : une seule sortie, aucune fausse suppression", async () => {
    const content = gpx(1);
    const rootA = newDevice();
    const rootB = newDevice();
    const repoA = createActivityRepository({ rootHandle: rootA, cloudUser: user });
    const repoB = createActivityRepository({ rootHandle: rootB, cloudUser: user });

    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    const savedB = await repoB.saveActivity(activityFrom(content), content, "gpx"); // autre id local, même empreinte
    expect((await savedB.cloudSyncPromise).state).toBe("synced");
    expect(backend._debug.activitiesTable).toHaveLength(1);

    const listB = await repoB.listActivities();
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0]).toMatchObject({ id: savedB.activity.id, syncStatus: "synced" }); // pas « cloud-deleted »

    const syncB = await repoB.sync({ force: true });
    expect(syncB).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocally: 0 });
    expect(await localList(rootB)).toHaveLength(1);
    __resetSyncCoordinatorForTests();
    const syncA = await repoA.sync({ force: true });
    expect(syncA).toMatchObject({ downloaded: 0, deletedLocally: 0 });
    expect(await localList(rootA)).toHaveLength(1);
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });

  it("8b) B a le fichier en local-only alors que A l'a déjà envoyé : un seul exemplaire après sync()", async () => {
    const content = gpx(1);
    const rootB = newDevice();
    const offlineB = createActivityRepository({ rootHandle: rootB, cloudUser: null });
    await offlineB.saveActivity(activityFrom(content), content, "gpx"); // importé sans compte

    const repoA = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;

    const repoB = createActivityRepository({ rootHandle: rootB, cloudUser: user });
    const r = await repoB.sync({ force: true });
    expect(r.errors).toEqual([]);
    expect(r.downloaded).toBe(0); // pas de seconde copie téléchargée
    expect(await localList(rootB)).toHaveLength(1);
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });

  it("10) cloud présent sans copie locale : un appareil neuf récupère et met en cache", async () => {
    const content = gpx(1);
    const repoA = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;

    const phone = newDevice();
    const repoNew = createActivityRepository({ rootHandle: phone, cloudUser: user });
    const r = await repoNew.sync({ force: true });
    expect(r).toMatchObject({ downloaded: 1, uploaded: 0 });
    expect(await localList(phone)).toHaveLength(1);
    backend.setNetworkDown(true); // PC éteint, réseau coupé : disponible depuis le cache
    const items = (await repoNew.listActivities()).items;
    expect((await repoNew.loadActivityDetail(items[0].id)).samples.length).toBeGreaterThan(0);
  });

  it("une suppression faite sur un autre appareil est propagée quand le cloud (complet, non vide) et un accès direct la confirment", async () => {
    const rootA = newDevice();
    const repoA = createActivityRepository({ rootHandle: rootA, cloudUser: user });
    for (const seed of [1, 2]) {
      const content = gpx(seed);
      await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    }
    const repoB = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await repoB.sync({ force: true });
    const items = (await repoB.listActivities()).items;
    await repoB.deleteActivity(items[0].id);
    expect(backend._debug.activitiesTable).toHaveLength(1);
    __resetSyncCoordinatorForTests();
    const r = await repoA.sync({ force: true });
    expect(r.deletedLocally).toBe(1);
    expect(await localList(rootA)).toHaveLength(1);
  });

  it("la DERNIÈRE sortie supprimée ailleurs n'est pas effacée automatiquement (cloud vide = doute) : conservée et signalée", async () => {
    const rootA = newDevice();
    const repoA = createActivityRepository({ rootHandle: rootA, cloudUser: user });
    const content = gpx(1);
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    backend._debug.activitiesTable.length = 0; // supprimée ailleurs (ou cloud vide à tort : indiscernable)
    const r = await repoA.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(r.uncertain.map((u) => u.code)).toEqual(["cloud-empty-uncertain"]);
    expect(r.errors.map((e) => e.code)).toContain("cloud-empty-uncertain");
    expect(await localList(rootA)).toHaveLength(1);
  });

  it("garde-fou : un cloud qui répond vide n'efface JAMAIS les sorties locales synchronisées", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    for (const seed of [1, 2]) {
      const content = gpx(seed);
      await (await repo.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    }
    backend._debug.activitiesTable.length = 0;
    const r = await repo.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(r.errors.map((e) => e.code)).toContain("cloud-empty-uncertain");
    expect(await localList(root)).toHaveLength(2);
  });
});

describe("lignes cloud orphelines (fichier manquant)", () => {
  it("sont détectées et signalées sans rien supprimer, puis réparées depuis une copie locale identique", async () => {
    const content = gpx(1);
    const repoA = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    backend._debug.storageObjects.clear(); // le fichier disparaît, la ligne reste

    __resetSyncCoordinatorForTests();
    const phone = newDevice();
    const repoPhone = createActivityRepository({ rootHandle: phone, cloudUser: user });
    const r = await repoPhone.sync({ force: true });
    expect(r.orphans).toHaveLength(1);
    expect(r.errors.map((e) => e.code)).toContain("cloud-file-missing");
    expect(backend._debug.activitiesTable).toHaveLength(1); // rien supprimé

    // Un appareil qui possède le fichier d'origine le réimporte : réparation, pas de doublon.
    const owner = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    const saved = await owner.saveActivity(activityFrom(content), content, "gpx");
    expect((await saved.cloudSyncPromise).state).toBe("synced");
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect(backend._debug.storageObjects.size).toBe(1);
  });
});
