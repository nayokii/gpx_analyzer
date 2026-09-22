import { describe, it, expect } from "vitest";
import { MemoryDirectoryHandle } from "../storage/testFsHandle.js";
import { loadProgressionState, saveProgressionState, computeAndPersistProgression } from "./persistence.js";
import { createEmptyProgressionState, PROGRESSION_STATE_VERSION } from "./state.js";
import { createEmptyActivity } from "../types.js";

function activity(overrides = {}) {
  const a = createEmptyActivity();
  return { ...a, id: overrides.id || "a1", date: overrides.date ?? "2026-06-01T08:00:00Z", ...overrides };
}

describe("loadProgressionState — état vide/absent", () => {
  it("retourne null si athlete.json n'existe pas encore (jamais une exception)", async () => {
    const root = new MemoryDirectoryHandle();
    const state = await loadProgressionState(root);
    expect(state).toBeNull();
  });

  it("retourne null si le fichier est corrompu", async () => {
    const root = new MemoryDirectoryHandle();
    root.files.set("athlete.json", "{ceci n'est pas du json");
    const state = await loadProgressionState(root);
    expect(state).toBeNull();
  });

  it("retourne null si le contenu ne ressemble pas à un état de progression valide", async () => {
    const root = new MemoryDirectoryHandle();
    root.files.set("athlete.json", JSON.stringify({ hello: "world" }));
    const state = await loadProgressionState(root);
    expect(state).toBeNull();
  });
});

describe("save/load — round-trip", () => {
  it("relit exactement ce qui a été sauvegardé", async () => {
    const root = new MemoryDirectoryHandle();
    const state = { ...createEmptyProgressionState(), xp: 250, level: 3 };
    await saveProgressionState(root, state);
    const reloaded = await loadProgressionState(root);
    expect(reloaded.xp).toBe(250);
    expect(reloaded.level).toBe(3);
  });

  it("athlete.json est écrit à la RACINE du dossier, pas dans activities/", async () => {
    const root = new MemoryDirectoryHandle();
    await saveProgressionState(root, createEmptyProgressionState());
    expect(root.files.has("athlete.json")).toBe(true);
  });
});

describe("migration de version", () => {
  it("un état d'une version future/inconnue est fusionné sur un état vide plutôt que rejeté aveuglément", async () => {
    const root = new MemoryDirectoryHandle();
    root.files.set("athlete.json", JSON.stringify({ version: 999, xp: 42, unlockedAchievements: [], completedChallenges: [], processedActivityIds: [] }));
    const state = await loadProgressionState(root);
    expect(state.version).toBe(PROGRESSION_STATE_VERSION);
  });
});

describe("computeAndPersistProgression", () => {
  it("calcule puis persiste, et relit le même état ensuite", async () => {
    const root = new MemoryDirectoryHandle();
    const activities = [activity({ id: "a1", distance: 25 })];
    const { progression, state } = await computeAndPersistProgression(root, activities, null);

    expect(state.xp).toBe(progression.xp);
    const reloaded = await loadProgressionState(root);
    expect(reloaded.xp).toBe(progression.xp);
    expect(reloaded.processedActivityIds).toEqual(["a1"]);
  });

  it("préserve createdAt à travers plusieurs sauvegardes successives", async () => {
    const root = new MemoryDirectoryHandle();
    const first = await computeAndPersistProgression(root, [activity({ id: "a1" })], null);
    const second = await computeAndPersistProgression(root, [activity({ id: "a1" }), activity({ id: "a2", date: "2026-06-08T08:00:00Z" })], null);
    expect(second.state.createdAt).toBe(first.state.createdAt);
  });

  it("l'XP augmente de façon cohérente quand une nouvelle activité s'ajoute, jamais doublée pour l'activité déjà connue", async () => {
    const root = new MemoryDirectoryHandle();
    const a1 = activity({ id: "a1", distance: 25 });
    const a2 = activity({ id: "a2", date: "2026-06-08T08:00:00Z", distance: 15 });

    const { progression: onlyA1 } = await computeAndPersistProgression(root, [a1], null);
    const { progression: bothReplayed } = await computeAndPersistProgression(root, [a1], null); // relecture de la même activité
    expect(bothReplayed.xp).toBe(onlyA1.xp);

    const { progression: withA2 } = await computeAndPersistProgression(root, [a1, a2], null);
    expect(withA2.xp).toBeGreaterThan(onlyA1.xp);
  });
});
