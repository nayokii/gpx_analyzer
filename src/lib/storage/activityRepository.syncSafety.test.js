/**
 * Régressions de sécurité des données — correctifs M1 à M5 de l'audit de
 * synchronisation mobile. Chaque test reproduit le scénario fautif décrit dans
 * l'audit ; il échouerait sur le code d'avant correction. Backend Supabase
 * SIMULÉ : ces tests valident la logique, pas les policies RLS réelles.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { getBrowserStoreRoot } from "./browserStore.js";
import { listActivities as localList, loadActivityDetail as localDetail, patchActivity } from "./activityStore.js";
import { createActivityRepository, __resetSyncCoordinatorForTests } from "./activityRepository.js";
import { listQueuedOperations, listQueuedDeletes, enqueueDelete, clearQueue } from "./syncQueue.js";
import { __setSupabaseClientForTests } from "../cloud/client.js";
import { createFakeSupabaseBackend } from "../cloud/tests/fakeSupabase.js";
import { listCloudActivities, CloudIncompleteListError } from "../cloud/index.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";

function gpx(seed) {
  return `<?xml version="1.0"?><gpx><trk><name>ride-${seed}</name><trkseg>
<trkpt lat="45.0${seed}0" lon="5.0${seed}0"><ele>200</ele><time>2026-09-2${seed}T08:00:00Z</time></trkpt>
<trkpt lat="45.0${seed}5" lon="5.0${seed}5"><ele>230</ele><time>2026-09-2${seed}T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>`;
}
function activityFrom(content) {
  const { points } = parseGPXString(content);
  return toActivity(computeAnalysis(points, null), points, { name: "ride", sourceType: "gpx", originalFilename: "ride.gpx" });
}
const newDevice = () => getBrowserStoreRoot({ dbName: "safety", idb: new IDBFactory() });

async function importSynced(repo, seed) {
  const content = gpx(seed);
  const saved = await repo.saveActivity(activityFrom(content), content, "gpx");
  expect((await saved.cloudSyncPromise).state).toBe("synced");
  return { saved, content };
}

/** Fait échouer UNIQUEMENT les suppressions de lignes (la lecture reste possible) : échec partiel. */
function breakCloudDeletes(backend) {
  const realFrom = backend.client.from;
  backend.client.from = (table) => {
    const builder = realFrom(table);
    const realDelete = builder.delete;
    builder.delete = () => {
      const b = realDelete.call(builder);
      b.eq = () => ({ then: (resolve) => resolve({ data: null, error: { message: "delete failed" } }) });
      return b;
    };
    return builder;
  };
  return () => { backend.client.from = realFrom; };
}

let backend;
let user;

beforeEach(async () => {
  clearQueue();
  __resetSyncCoordinatorForTests();
  backend = createFakeSupabaseBackend();
  __setSupabaseClientForTests(backend.client);
  user = await backend.signUpAndLogin("safety@example.com");
});
afterEach(() => {
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
});

describe("M1 — le cooldown ne bloque jamais la reprise d'une file", () => {
  it("synchro réussie, import en panne réseau quelques secondes après, retour du réseau : sync() NON forcé renvoie l'envoi en attente", async () => {
    const repo = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await repo.sync({ force: true }); // cycle réussi : le cooldown de 10 s est armé
    backend.setNetworkDown(true);
    const content = gpx(1);
    const saved = await repo.saveActivity(activityFrom(content), content, "gpx");
    expect((await saved.cloudSyncPromise).state).toBe("error");
    expect(listQueuedOperations()).toHaveLength(1);

    backend.setNetworkDown(false); // évènement « online » : sync() sans force
    const r = await repo.sync();
    expect(r.uploaded).toBe(1);
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect(listQueuedOperations()).toEqual([]);
  });

  it("un cycle ÉCHOUÉ n'est jamais resservi depuis le cache", async () => {
    const repo = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await repo.sync({ force: true });
    backend.setNetworkDown(true);
    await expect(repo.sync({ force: true })).rejects.toThrow();
    backend.setNetworkDown(false);
    const content = gpx(2);
    backend.setNetworkDown(true);
    await (await repo.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    backend.setNetworkDown(false);
    expect((await repo.sync()).uploaded).toBe(1);
  });

  it("le cooldown continue d'absorber une rafale quand tout est propre", async () => {
    const repo = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    const first = await repo.sync({ force: true });
    expect(await repo.sync()).toBe(first); // même objet : pas de second cycle
  });
});

describe("M2 — une suppression en attente ne fait pas re-télécharger la sortie", () => {
  it("échec partiel (lecture OK, suppression KO) : la sortie n'est ni re-téléchargée ni affichée, la suppression reste en file", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const { saved } = await importSynced(repo, 1);
    await importSynced(repo, 2);

    backend.setNetworkDown(true);
    await repo.deleteActivity(saved.activity.id); // hors ligne : suppression locale + mise en file
    backend.setNetworkDown(false);
    expect(listQueuedDeletes()).toHaveLength(1);

    const restore = breakCloudDeletes(backend);
    __resetSyncCoordinatorForTests();
    const r = await repo.sync({ force: true });
    expect(r.downloaded).toBe(0);
    expect(await localList(root)).toHaveLength(1); // pas de résurrection
    expect(listQueuedDeletes()).toHaveLength(1); // toujours à rejouer
    expect((await repo.listActivities()).items).toHaveLength(1); // et masquée dans la liste
    restore();

    __resetSyncCoordinatorForTests();
    await repo.sync({ force: true });
    expect(backend._debug.activitiesTable).toHaveLength(1);
    expect(listQueuedDeletes()).toEqual([]);
  });
});

describe("M3 — une réimportation volontaire neutralise l'ancienne suppression en attente", () => {
  it("réimport EN LIGNE (doublon adopté) : la suppression en file est annulée, la sortie survit", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const { saved, content } = await importSynced(repo, 1);
    await importSynced(repo, 2);

    backend.setNetworkDown(true);
    await repo.deleteActivity(saved.activity.id);
    backend.setNetworkDown(false);
    expect(listQueuedDeletes()).toHaveLength(1);

    const again = await repo.saveActivity(activityFrom(content), content, "gpx"); // même fichier, autre id local
    expect((await again.cloudSyncPromise).state).toBe("synced");
    expect(listQueuedDeletes()).toEqual([]);

    __resetSyncCoordinatorForTests();
    const r = await repo.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(backend._debug.activitiesTable).toHaveLength(2);
    expect(await localList(root)).toHaveLength(2);
  });

  it("seconde ligne de défense : une suppression en file périmée n'efface pas une ligne utilisée par une copie locale vivante", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const { saved } = await importSynced(repo, 1);
    await importSynced(repo, 2);
    const row = backend._debug.activitiesTable.find((r) => r.local_id === saved.activity.id);
    // File périmée pour une AUTRE copie locale de la même ligne (ex. ancien id supprimé).
    enqueueDelete({ activityId: "ancien-id-supprime", cloudId: row.id });

    const r = await repo.sync({ force: true });
    expect(r.deletesProcessed).toBe(1); // la file est vidée…
    expect(backend._debug.activitiesTable).toHaveLength(2); // …sans supprimer la ligne
    expect(listQueuedDeletes()).toEqual([]);
    expect(await localList(root)).toHaveLength(2);
  });

  it("réimport HORS LIGNE : suppression rejouée d'abord, puis nouvel envoi — une seule ligne, une seule copie", async () => {
    const root = newDevice();
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    const { saved, content } = await importSynced(repo, 1);
    await importSynced(repo, 2);

    backend.setNetworkDown(true);
    await repo.deleteActivity(saved.activity.id);
    await (await repo.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    backend.setNetworkDown(false);

    __resetSyncCoordinatorForTests();
    const r = await repo.sync({ force: true });
    expect(r.errors).toEqual([]);
    expect(backend._debug.activitiesTable).toHaveLength(2);
    expect(await localList(root)).toHaveLength(2);
    expect(listQueuedOperations()).toEqual([]);
  });
});

describe("M4 — liste cloud paginée et complète, jamais une preuve de suppression si elle est partielle", () => {
  async function fiveSynced(root) {
    const repo = createActivityRepository({ rootHandle: root, cloudUser: user });
    for (const seed of [1, 2, 3, 4, 5]) await importSynced(repo, seed);
    return repo;
  }

  it("pagine au-delà du plafond serveur (max_rows) et renvoie TOUTES les lignes", async () => {
    await fiveSynced(newDevice());
    backend.setMaxRows(2);
    expect(await listCloudActivities()).toHaveLength(5);
  });

  it("page en échec en cours de route : erreur, aucune suppression locale", async () => {
    const root = newDevice();
    const repo = await fiveSynced(root);
    backend.setMaxRows(2);
    backend.setListPageHook(({ from }) => (from > 0 ? { error: { message: "Failed to fetch" } } : null));
    __resetSyncCoordinatorForTests();
    await expect(repo.sync({ force: true })).rejects.toThrow();
    expect(await localList(root)).toHaveLength(5);
    const { source } = await repo.listActivities();
    expect(["error", "offline"]).toContain(source); // repli sur le local, jamais « synchronisé »
  });

  it("réponse tronquée (total annoncé > lignes reçues) : liste déclarée incomplète, rien n'est supprimé", async () => {
    const root = newDevice();
    const repo = await fiveSynced(root);
    backend.setListPageHook(({ from, total }) => (from > 0 ? { data: [], count: total } : { data: [], count: total }));
    await expect(listCloudActivities()).rejects.toBeInstanceOf(CloudIncompleteListError);
    __resetSyncCoordinatorForTests();
    await expect(repo.sync({ force: true })).rejects.toBeInstanceOf(CloudIncompleteListError);
    expect(await localList(root)).toHaveLength(5);
  });

  it("liste partielle MAIS cohérente en apparence (total mensonger) : l'accès direct à chaque ligne empêche toute suppression", async () => {
    const root = newDevice();
    const repo = await fiveSynced(root);
    backend.setListPageHook(({ page }) => ({ data: page.slice(0, 2), count: 2 })); // ne montre que 2 sorties sur 5
    __resetSyncCoordinatorForTests();
    const r = await repo.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(r.uncertain.filter((u) => u.code === "deletion-not-confirmed")).toHaveLength(3);
    expect(await localList(root)).toHaveLength(5);
  });

  it("échec de la vérification directe : copie locale conservée et incertitude signalée", async () => {
    const root = newDevice();
    const repo = await fiveSynced(root);
    backend._debug.activitiesTable.splice(0, 2); // deux sorties réellement supprimées ailleurs
    const realFrom = backend.client.from;
    backend.client.from = (table) => {
      const b = realFrom(table);
      const maybe = b.maybeSingle;
      b.maybeSingle = () => Promise.resolve({ data: null, error: { message: "Failed to fetch" } });
      void maybe;
      return b;
    };
    __resetSyncCoordinatorForTests();
    const r = await repo.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(r.uncertain.map((u) => u.code)).toContain("deletion-check-failed");
    expect(await localList(root)).toHaveLength(5);
  });
});

describe("M5 — activité legacy sans propriétaire connu", () => {
  async function legacyOnSharedDevice() {
    const root = newDevice();
    const repoA = createActivityRepository({ rootHandle: root, cloudUser: user });
    const { saved } = await importSynced(repoA, 1);
    // Simule une copie écrite AVANT l'ajout de `cloudUserId` : sourceId présent, propriétaire absent.
    await patchActivity(root, saved.activity.id, (a) => ({ source: { ...a.source, cloudUserId: undefined } }));
    expect((await localDetail(root, saved.activity.id)).source.cloudUserId).toBeUndefined();
    return { root, id: saved.activity.id };
  }

  it("un autre compte ne la supprime pas, ne l'envoie pas dans son cloud, ne se la voit pas attribuer", async () => {
    const { root, id } = await legacyOnSharedDevice();
    const userB = await backend.signUpAndLogin("autre@example.com");
    const repoB = createActivityRepository({ rootHandle: root, cloudUser: userB });

    const listed = (await repoB.listActivities()).items;
    expect(listed.find((i) => i.id === id).syncStatus).toBe("owner-unknown");

    const r = await repoB.sync({ force: true });
    expect(r).toMatchObject({ uploaded: 0, deletedLocally: 0 });
    expect(r.uncertain).toContainEqual({ activityId: id, code: "owner-unknown" });
    expect(await localList(root)).toHaveLength(1);
    expect(backend._debug.activitiesTable.filter((row) => row.user_id === userB.id)).toHaveLength(0);
  });

  it("même absente du cloud de son vrai compte, une legacy n'est jamais supprimée automatiquement", async () => {
    const { root } = await legacyOnSharedDevice();
    backend._debug.activitiesTable.length = 0;
    const repoA = createActivityRepository({ rootHandle: root, cloudUser: user });
    const r = await repoA.sync({ force: true });
    expect(r.deletedLocally).toBe(0);
    expect(await localList(root)).toHaveLength(1);
  });

  it("revenue sur son compte, elle est reconnue (rattachée par sourceId) et reçoit enfin son propriétaire", async () => {
    const { root, id } = await legacyOnSharedDevice();
    const repoA = createActivityRepository({ rootHandle: root, cloudUser: user });
    const r = await repoA.sync({ force: true });
    expect(r).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocally: 0 });
    expect((await localDetail(root, id)).source.cloudUserId).toBe(user.id);
    expect(backend._debug.activitiesTable).toHaveLength(1);
  });
});

describe("isolation et doublons (non-régression)", () => {
  it("deux comptes importent le même fichier : deux lignes, chacun ne voit que la sienne, aucun doublon par compte", async () => {
    const content = gpx(1);
    const repoA = createActivityRepository({ rootHandle: newDevice(), cloudUser: user });
    await (await repoA.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;
    const userB = await backend.signUpAndLogin("b@example.com");
    const repoB = createActivityRepository({ rootHandle: newDevice(), cloudUser: userB });
    await (await repoB.saveActivity(activityFrom(content), content, "gpx")).cloudSyncPromise;

    expect(backend._debug.activitiesTable).toHaveLength(2);
    expect((await repoB.listActivities()).items).toHaveLength(1);
    await repoB.sync({ force: true });
    await repoB.sync({ force: true });
    expect(backend._debug.activitiesTable.filter((r) => r.user_id === userB.id)).toHaveLength(1);
    backend.setSessionUser(user);
    __resetSyncCoordinatorForTests();
    expect((await repoA.listActivities()).items).toHaveLength(1);
  });
});
