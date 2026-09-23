import { describe, it, expect, vi } from "vitest";
import { getCachedActivityDetail, loadCachedActivityDetails, invalidateActivityCache } from "./activityCache.js";
import { saveActivity, loadActivityDetail } from "./activityStore.js";
import { MemoryDirectoryHandle } from "./testFsHandle.js";
import { createEmptyActivity } from "../types.js";

function makeActivity(id, overrides = {}) {
  const a = createEmptyActivity();
  return { ...a, id, name: `Sortie ${id}`, date: "2026-06-01T08:00:00Z", distance: 20, ...overrides };
}

describe("getCachedActivityDetail", () => {
  it("retourne le même contenu que loadActivityDetail() directement", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1"), "<gpx/>", "gpx");

    const direct = await loadActivityDetail(root, "a1");
    const cached = await getCachedActivityDetail(root, "a1");
    expect(cached).toEqual(direct);
  });

  it("ne lit le fichier qu'une seule fois pour plusieurs appels au même id (partage la promesse en vol)", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1"), "<gpx/>", "gpx");

    const getFileHandleSpy = vi.spyOn(root, "getDirectoryHandle");
    const [r1, r2, r3] = await Promise.all([
      getCachedActivityDetail(root, "a1"),
      getCachedActivityDetail(root, "a1"),
      getCachedActivityDetail(root, "a1"),
    ]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    // Un seul accès réel au dossier d'activités malgré 3 appels concurrents
    // (le deuxième et le troisième réutilisent la même promesse en vol).
    expect(getFileHandleSpy.mock.calls.length).toBeLessThanOrEqual(2); // getActivitiesDir + éventuel accès index, jamais 3x le travail complet
  });

  it("un cache pour un rootHandle n'affecte jamais un autre rootHandle (aucune activité oubliée entre dossiers) — test 3", async () => {
    const rootA = new MemoryDirectoryHandle();
    const rootB = new MemoryDirectoryHandle();
    await saveActivity(rootA, makeActivity("shared-id", { name: "Dans A" }), "<gpx/>", "gpx");
    await saveActivity(rootB, makeActivity("shared-id", { name: "Dans B" }), "<gpx/>", "gpx");

    const a = await getCachedActivityDetail(rootA, "shared-id");
    const b = await getCachedActivityDetail(rootB, "shared-id");
    expect(a.name).toBe("Dans A");
    expect(b.name).toBe("Dans B");
  });

  it("un échec n'est jamais mis en cache : la tentative suivante peut réussir (ex. permission temporairement refusée)", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1"), "<gpx/>", "gpx");

    const realGetDir = root.getDirectoryHandle.bind(root);
    let failNext = true;
    root.getDirectoryHandle = async (...args) => {
      if (failNext) {
        failNext = false;
        throw new Error("panne disque simulée");
      }
      return realGetDir(...args);
    };

    await expect(getCachedActivityDetail(root, "a1")).rejects.toThrow("panne disque simulée");
    const result = await getCachedActivityDetail(root, "a1"); // nouvelle tentative : doit réussir, pas rester bloquée sur l'échec précédent
    expect(result.id).toBe("a1");
  });
});

describe("loadCachedActivityDetails — tolérance aux échecs partiels (Promise.allSettled)", () => {
  it("charge toutes les activités demandées, aucune oubliée — test 3", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1"), "<gpx/>", "gpx");
    await saveActivity(root, makeActivity("a2"), "<gpx/>", "gpx");
    await saveActivity(root, makeActivity("a3"), "<gpx/>", "gpx");

    const results = await loadCachedActivityDetails(root, [{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.map((r) => r.value.id).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("une activité manquante/illisible n'empêche pas les autres de charger", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1"), "<gpx/>", "gpx");

    const results = await loadCachedActivityDetails(root, [{ id: "a1" }, { id: "introuvable" }]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });
});

describe("invalidateActivityCache — test 2 (cache invalidé quand une activité change)", () => {
  it("après invalidation, un nouvel appel relit le fichier au lieu de servir l'ancienne valeur en cache", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1", { name: "Avant" }), "<gpx/>", "gpx");
    const before = await getCachedActivityDetail(root, "a1");
    expect(before.name).toBe("Avant");

    // Simule une modification du fichier stocké (ex. resauvegarde) — dans la
    // vraie appli ceci correspond à une suppression suivie d'un nouvel id,
    // mais ce test vérifie directement le contrat d'invalidation.
    invalidateActivityCache(root, "a1");
    await saveActivity(root, makeActivity("a1", { name: "Après" }), "<gpx/>", "gpx");

    const after = await getCachedActivityDetail(root, "a1");
    expect(after.name).toBe("Après");
    expect(after).not.toBe(before);
  });

  it("sans invalidation, l'ancienne entrée resterait servie (démontre pourquoi l'invalidation est nécessaire)", async () => {
    const root = new MemoryDirectoryHandle();
    await saveActivity(root, makeActivity("a1", { name: "V1" }), "<gpx/>", "gpx");
    await getCachedActivityDetail(root, "a1"); // peuple le cache

    await saveActivity(root, makeActivity("a1", { name: "V2" }), "<gpx/>", "gpx");
    const stillCached = await getCachedActivityDetail(root, "a1");
    expect(stillCached.name).toBe("V1"); // comportement attendu du cache tant qu'il n'est pas invalidé
  });
});
