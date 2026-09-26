/**
 * Scénario d'intégration critique — Phase 11C, consigne §25 :
 *
 *  1. Device A connecté           13. C reste locale + queue
 *  2. Import activity A           14. Device A online
 *  3. Cloud upload                15. C uploadée
 *  4. Device B connecté           16. Device B sync
 *  5. Automatic sync              17. A + B + C visibles
 *  6. Activity A visible          18. Device B supprime B offline
 *  7. Device B import activity B  19. delete queued
 *  8. Cloud upload                20. Device B online
 *  9. Device A reconnecte/sync    21. suppression cloud
 * 10. A + B visibles              22. Device A sync
 * 11. Device A offline            23. B absente
 * 12. Import activity C
 *
 * "Offline" est simulé en neutralisant le client Supabase simulé
 * (`__setSupabaseClientForTests(null)`) pendant les actions concernées :
 * chaque appel cloud échoue alors avec CloudNotConfiguredError, exactement
 * comme le ferait une vraie coupure réseau du point de vue du repository
 * (voir activityRepository.js : peu importe la CAUSE de l'échec, le
 * comportement — enregistrement local, mise en file d'attente — est
 * identique). Un seul client simulé existe (module-level), donc les
 * étapes restent volontairement séquentielles — jamais deux appareils
 * "en même temps" au sens process, ce que l'énoncé n'exige pas non plus.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { MemoryDirectoryHandle } from "./testFsHandle.js";
import { createActivityRepository, __resetSyncCoordinatorForTests } from "./activityRepository.js";
import { isQueued, listQueuedOperations, clearQueue } from "./syncQueue.js";
import { __setSupabaseClientForTests } from "../cloud/client.js";
import { createFakeSupabaseBackend } from "../cloud/tests/fakeSupabase.js";
import { parseGPXString } from "../parsers/gpxParser.js";
import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";

function gpx(seed) {
  return `<?xml version="1.0"?><gpx><trk><name>${seed}</name><trkseg>
<trkpt lat="45.0${seed}0" lon="5.0${seed}0"><ele>200</ele><time>2026-09-2${seed}T08:00:00Z</time></trkpt>
<trkpt lat="45.0${seed}5" lon="5.0${seed}5"><ele>230</ele><time>2026-09-2${seed}T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>`;
}

function activityFromGpx(id, gpxContent) {
  const { name, points } = parseGPXString(gpxContent);
  const analysis = computeAnalysis(points, null);
  return toActivity(analysis, points, { id, name: name || id, sourceType: "gpx", originalFilename: `${id}.gpx` });
}

beforeEach(() => {
  clearQueue();
  __resetSyncCoordinatorForTests();
});

afterEach(() => {
  __setSupabaseClientForTests(null);
  __resetSyncCoordinatorForTests();
});

describe("Scénario critique §25 — multi-appareils, hors-ligne et suppression en attente", () => {
  it("reproduit les 23 étapes sans perte ni doublon", async () => {
    const backend = createFakeSupabaseBackend();
    __setSupabaseClientForTests(backend.client);

    // 1) Device A connecté.
    const user = await backend.signUpAndLogin("multi@example.com");
    const rootA = new MemoryDirectoryHandle();
    const repoA = createActivityRepository({ rootHandle: rootA, cloudUser: user });

    // 2-3) Import activity A sur Device A, upload cloud.
    const gpxA = gpx(0);
    const { cloudSyncPromise: syncA } = await repoA.saveActivity(activityFromGpx("A", gpxA), gpxA, "gpx");
    const resultA = await syncA;
    expect(resultA.cloudSynced).toBe(true);

    // 4) Device B connecté (même compte, dossier local totalement neuf).
    const rootB = new MemoryDirectoryHandle();
    const repoB = createActivityRepository({ rootHandle: rootB, cloudUser: user });

    // 5-6) Synchronisation automatique sur Device B : A doit apparaître.
    const syncResultB1 = await repoB.sync({ force: true });
    expect(syncResultB1.downloaded).toBe(1);
    expect(await repoB.hasActivity("A")).toBe(true);

    // 7-8) Device B importe l'activité B, upload cloud.
    const gpxB = gpx(1);
    const { cloudSyncPromise: syncB } = await repoB.saveActivity(activityFromGpx("B", gpxB), gpxB, "gpx");
    expect((await syncB).cloudSynced).toBe(true);

    // 9-10) Device A se resynchronise : A (déjà là) + B doivent être visibles.
    const syncResultA2 = await repoA.sync({ force: true });
    expect(syncResultA2.downloaded).toBe(1); // B
    const idsOnA = (await repoA.listActivities()).items.map((i) => i.id).sort();
    expect(idsOnA).toEqual(["A", "B"]);

    // 11) Device A hors ligne (simulé : plus de client cloud configuré).
    __setSupabaseClientForTests(null);

    // 12-13) Import de l'activité C pendant que Device A est hors ligne :
    //         reste locale, upload mis en file d'attente, jamais perdue.
    const gpxC = gpx(2);
    const { activity: savedC, cloudSyncPromise: syncC } = await repoA.saveActivity(activityFromGpx("C", gpxC), gpxC, "gpx");
    const resultC = await syncC;
    expect(resultC.cloudSynced).toBe(false);
    expect(isQueued("C")).toBe(true);
    expect(await repoA.hasActivity("C")).toBe(true); // toujours disponible localement
    expect(savedC.id).toBe("C");

    // 14) Device A retrouve la connexion.
    __setSupabaseClientForTests(backend.client);

    // 15) La synchronisation envoie C, qui n'est plus en attente.
    const syncResultA3 = await repoA.sync({ force: true });
    expect(syncResultA3.uploaded).toBe(1); // C
    expect(isQueued("C")).toBe(false);

    // 16-17) Device B se resynchronise : A + B + C doivent être visibles.
    const syncResultB2 = await repoB.sync({ force: true });
    expect(syncResultB2.downloaded).toBe(1); // C
    const idsOnB = (await repoB.listActivities()).items.map((i) => i.id).sort();
    expect(idsOnB).toEqual(["A", "B", "C"]);

    // 18) Device B hors ligne, supprime B.
    __setSupabaseClientForTests(null);
    await repoB.deleteActivity("B");

    // 19) La suppression cloud n'a pas pu s'exécuter : mise en file d'attente.
    expect(isQueued("B")).toBe(true);
    expect(listQueuedOperations().find((o) => o.activityId === "B").type).toBe("delete");
    expect(await repoB.hasActivity("B")).toBe(false); // supprimée localement tout de suite

    // 20) Device B retrouve la connexion.
    __setSupabaseClientForTests(backend.client);

    // 21) La synchronisation rejoue la suppression en attente.
    const syncResultB3 = await repoB.sync({ force: true });
    expect(syncResultB3.deletesProcessed).toBe(1);
    expect(isQueued("B")).toBe(false);

    // 22-23) Device A se resynchronise : B doit avoir disparu, sans erreur.
    const syncResultA4 = await repoA.sync({ force: true });
    expect(syncResultA4.errors).toEqual([]);
    const finalIdsOnA = (await repoA.listActivities()).items.map((i) => i.id).sort();
    expect(finalIdsOnA).toEqual(["A", "C"]);
  });
});
