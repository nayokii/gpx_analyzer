import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueUpload,
  enqueueDelete,
  listQueuedUploads,
  listQueuedDeletes,
  listQueuedOperations,
  dequeue,
  isQueued,
  clearQueue,
} from "./syncQueue.js";

beforeEach(() => {
  clearQueue();
});

describe("syncQueue", () => {
  it("commence vide", () => {
    expect(listQueuedOperations()).toEqual([]);
  });

  it("enqueueUpload() ajoute une entrée retrouvable par isQueued()", () => {
    enqueueUpload({ activityId: "a1", fileHash: "hash1" });
    expect(isQueued("a1")).toBe(true);
    expect(isQueued("a2")).toBe(false);
    expect(listQueuedUploads()).toHaveLength(1);
    expect(listQueuedUploads()[0]).toMatchObject({ type: "upload", activityId: "a1", fileHash: "hash1" });
  });

  it("enfiler deux fois la même activité remplace l'entrée plutôt que de la dupliquer", () => {
    enqueueUpload({ activityId: "a1", fileHash: "old-hash" });
    enqueueUpload({ activityId: "a1", fileHash: "new-hash" });
    const entries = listQueuedUploads();
    expect(entries).toHaveLength(1);
    expect(entries[0].fileHash).toBe("new-hash");
  });

  it("dequeue() retire une entrée précise sans toucher aux autres", () => {
    enqueueUpload({ activityId: "a1" });
    enqueueUpload({ activityId: "a2" });
    dequeue("a1");
    expect(isQueued("a1")).toBe(false);
    expect(isQueued("a2")).toBe(true);
  });

  it("survit à une relecture (persisté dans localStorage)", () => {
    enqueueUpload({ activityId: "a1" });
    expect(listQueuedUploads()).toHaveLength(1); // relit vraiment localStorage, ne dépend d'aucun état en mémoire
  });

  it("clearQueue() vide tout", () => {
    enqueueUpload({ activityId: "a1" });
    enqueueUpload({ activityId: "a2" });
    clearQueue();
    expect(listQueuedOperations()).toEqual([]);
  });

  describe("suppressions en attente (Phase 11C)", () => {
    it("enqueueDelete() ajoute une entrée de type 'delete'", () => {
      enqueueDelete({ activityId: "a1" });
      expect(isQueued("a1")).toBe(true);
      expect(listQueuedDeletes()).toHaveLength(1);
      expect(listQueuedDeletes()[0]).toMatchObject({ type: "delete", activityId: "a1" });
      expect(listQueuedUploads()).toHaveLength(0);
    });

    it("supprimer une sortie dont l'upload était en attente remplace l'upload par la suppression (jamais les deux)", () => {
      enqueueUpload({ activityId: "a1", fileHash: "hash1" });
      enqueueDelete({ activityId: "a1" });
      const ops = listQueuedOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe("delete");
    });

    it("listQueuedOperations() mélange uploads et suppressions sans les confondre", () => {
      enqueueUpload({ activityId: "up-1" });
      enqueueDelete({ activityId: "del-1" });
      const ops = listQueuedOperations();
      expect(ops.map((o) => o.type).sort()).toEqual(["delete", "upload"]);
    });
  });
});
