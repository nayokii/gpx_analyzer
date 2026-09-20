import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDirectoryHandle } from "./testFsHandle.js";
import {
  saveActivity,
  listActivities,
  loadActivityDetail,
  loadActivitySourceText,
  deleteActivity,
  rebuildIndex,
  readIndex,
} from "./activityStore.js";
import { createEmptyActivity } from "../types.js";

function makeActivity(overrides = {}) {
  const a = createEmptyActivity();
  return {
    ...a,
    id: overrides.id || "abc123",
    name: "Sortie test",
    date: "2026-09-20T08:00:00.000Z",
    distance: 42.5,
    duration: 3600,
    elevationGain: 500,
    avgHeartRate: null, // pas de capteur FC sur cette sortie
    ...overrides,
  };
}

describe("activityStore", () => {
  let root;

  beforeEach(() => {
    root = new MemoryDirectoryHandle();
  });

  it("sauvegarde le fichier source original et la version JSON normalisée", async () => {
    const activity = makeActivity();
    const saved = await saveActivity(root, activity, "<gpx>...</gpx>", "gpx");

    expect(saved.source.storedFilename).toBe("2026-09-20_abc123.gpx");

    const activitiesDir = await root.getDirectoryHandle("activities");
    expect(activitiesDir.files.has("2026-09-20_abc123.gpx")).toBe(true);
    expect(activitiesDir.files.has("2026-09-20_abc123.json")).toBe(true);
    expect(activitiesDir.files.get("2026-09-20_abc123.gpx")).toBe("<gpx>...</gpx>");
  });

  it("liste les activités enregistrées avec les métriques principales", async () => {
    await saveActivity(root, makeActivity({ id: "a1" }), "gpx-a", "gpx");
    await saveActivity(root, makeActivity({ id: "a2", date: "2026-09-21T08:00:00.000Z" }), "gpx-b", "gpx");

    const list = await listActivities(root);
    expect(list).toHaveLength(2);
    // Triée du plus récent au plus ancien.
    expect(list[0].id).toBe("a2");
    expect(list[1].id).toBe("a1");
    expect(list[0].distance).toBe(42.5);
  });

  it("ne fabrique aucune donnée manquante dans le résumé de l'index", async () => {
    await saveActivity(root, makeActivity({ id: "a1", avgHeartRate: null }), "gpx-a");
    const list = await listActivities(root);
    expect(list[0].avgHeartRate).toBeNull();
  });

  it("recharge le détail complet d'une activité par son id", async () => {
    const activity = makeActivity({ id: "a1", samples: [{ timestamp: null, latitude: 1, longitude: 2, altitude: null, speed: null, heartRate: null, cadence: null, power: null }] });
    await saveActivity(root, activity, "<gpx/>");

    const detail = await loadActivityDetail(root, "a1");
    expect(detail.id).toBe("a1");
    expect(detail.samples).toHaveLength(1);
  });

  it("recharge le texte source original", async () => {
    await saveActivity(root, makeActivity({ id: "a1" }), "CONTENU-GPX-ORIGINAL");
    const text = await loadActivitySourceText(root, "a1");
    expect(text).toBe("CONTENU-GPX-ORIGINAL");
  });

  it("supprime une activité et son fichier source, et met à jour l'index", async () => {
    await saveActivity(root, makeActivity({ id: "a1" }), "gpx-a");
    await saveActivity(root, makeActivity({ id: "a2", date: "2026-09-21T08:00:00.000Z" }), "gpx-b");

    await deleteActivity(root, "a1");

    const list = await listActivities(root);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("a2");

    const activitiesDir = await root.getDirectoryHandle("activities");
    expect(activitiesDir.files.has("2026-09-20_a1.json")).toBe(false);
    expect(activitiesDir.files.has("2026-09-20_a1.gpx")).toBe(false);
  });

  it("reconstruit l'index si celui-ci est absent (cache dérivé, pas source de vérité)", async () => {
    await saveActivity(root, makeActivity({ id: "a1" }), "gpx-a");
    const activitiesDir = await root.getDirectoryHandle("activities");
    activitiesDir.files.delete("index.json");

    expect(await readIndex(activitiesDir)).toBeNull();

    const list = await listActivities(root);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("a1");
  });

  it("ignore un fichier JSON corrompu lors de la reconstruction de l'index", async () => {
    await saveActivity(root, makeActivity({ id: "a1" }), "gpx-a");
    const activitiesDir = await root.getDirectoryHandle("activities");
    activitiesDir.files.set("2026-09-19_broken.json", "{ not valid json");

    const rebuilt = await rebuildIndex(root);
    expect(rebuilt.find((e) => e.id === "a1")).toBeDefined();
    expect(rebuilt).toHaveLength(1);
  });

  it("remplace l'entrée existante dans l'index plutôt que de la dupliquer en cas de ré-enregistrement du même id", async () => {
    await saveActivity(root, makeActivity({ id: "a1", distance: 10 }), "gpx-a");
    await saveActivity(root, makeActivity({ id: "a1", distance: 20 }), "gpx-a-v2");

    const list = await listActivities(root);
    expect(list).toHaveLength(1);
    expect(list[0].distance).toBe(20);
  });
});
