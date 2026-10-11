import { describe, it, expect } from "vitest";
import { rebuildProgression, XP_AMOUNTS } from "./progression/progression.js";
import { computeAndPersistProgression, loadProgressionState } from "./progression/persistence.js";
import { MemoryDirectoryHandle } from "./storage/testFsHandle.js";
import { createEmptyActivity } from "./types.js";

function ride(id, movingTime, extra = {}) {
  return { ...createEmptyActivity(), id, date: `2026-09-${10 + Number(id.replace(/\D/g, "") || 0)}T08:00:00Z`, distance: 31, duration: movingTime + 1100, movingTime, elevationGain: 120, ...extra };
}
const xpOf = (acts) => rebuildProgression(acts).xp;

describe("movingTime corrige et progression (aucune regle modifiee)", () => {
  it("6715 s vers 5619 s : meme palier (1 h), XP strictement identique", () => {
    expect(xpOf([ride("r1", 5619)])).toBe(xpOf([ride("r1", 6715)]));
  });

  it("franchir un palier a cause de la correction retire exactement un palier d'XP", () => {
    const before = xpOf([ride("r1", 7500)]);
    const after = xpOf([ride("r1", 6500)]);
    expect(before - after).toBe(XP_AMOUNTS.DURATION_MILESTONE);
  });

  it("le defi sortie de plus de 2 h reflete la duree corrigee", () => {
    const challenge = (acts) => rebuildProgression(acts).challenges.find((c) => c.id === "endurance");
    expect(challenge([ride("r1", 7500)])).toBeUndefined();
    expect(challenge([ride("r1", 6500)]).current).toBe(6500);
  });

  it("l'XP est reconstruite, jamais cumulee : rejouer ou migrer ne double rien", () => {
    const acts = [ride("r1", 6715), ride("r2", 3000)];
    const a = xpOf(acts);
    expect(xpOf(acts)).toBe(a);
    expect(xpOf(acts.map((x) => ({ ...x })))).toBe(a);
    expect(xpOf([ride("r1", 5619), ride("r2", 3000)])).toBe(a);
  });

  it("athlete.json (cache) : recalcul apres migration = reconstruction a neuf, ids traites inchanges", async () => {
    const root = new MemoryDirectoryHandle();
    const first = await computeAndPersistProgression(root, [ride("r1", 7500), ride("r2", 3000)]);
    const migrated = [ride("r1", 6500), ride("r2", 3000)];
    const second = await computeAndPersistProgression(root, migrated);
    expect(second.state.xp).toBe(xpOf(migrated));
    expect(second.state.processedActivityIds).toEqual(first.state.processedActivityIds);
    expect(second.state.createdAt).toBe(first.state.createdAt);
    const third = await computeAndPersistProgression(root, migrated);
    expect(third.state.xp).toBe(second.state.xp);
    expect((await loadProgressionState(root)).xp).toBe(second.state.xp);
  });
});
