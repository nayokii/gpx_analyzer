import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getBrowserStoreRoot, isBrowserStoreSupported } from "./browserStore.js";
import { saveActivity, listActivities, loadActivityDetail, deleteActivity, loadActivitySourceText } from "./activityStore.js";
import { writeTextFile, readTextFile } from "./activityStore.js";

function root() {
  return getBrowserStoreRoot({ dbName: "t", idb: new IDBFactory() });
}

describe("browserStore (IndexedDB)", () => {
  it("détecte le support", () => {
    expect(isBrowserStoreSupported(new IDBFactory())).toBe(true);
    expect(isBrowserStoreSupported(undefined)).toBe(false);
  });

  it("écrit/relit texte et binaire, liste, supprime", async () => {
    const r = root();
    const dir = await r.getDirectoryHandle("activities", { create: true });
    await writeTextFile(dir, "a.json", '{"x":1}');
    const fh = await dir.getFileHandle("b.fit", { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array([1, 2, 3]).buffer);
    await w.close();

    expect(await readTextFile(dir, "a.json")).toBe('{"x":1}');
    expect([...new Uint8Array(await (await fh.getFile()).arrayBuffer())]).toEqual([1, 2, 3]);
    const names = [];
    for await (const [name] of dir) names.push(name);
    expect(names.sort()).toEqual(["a.json", "b.fit"]);

    await dir.removeEntry("a.json");
    await expect(dir.getFileHandle("a.json")).rejects.toThrow(/NotFound/);
    await expect(dir.removeEntry("a.json")).rejects.toThrow(/NotFound/);
  });

  it("fait tourner activityStore tel quel (save / list / detail / delete)", async () => {
    const r = root();
    const activity = { id: "x1", name: "N", date: "2026-09-20T08:00:00Z", distance: 10, source: { type: "gpx" }, samples: [] };
    await saveActivity(r, activity, "<gpx/>", "gpx");
    expect((await listActivities(r)).map((e) => e.id)).toEqual(["x1"]);
    expect((await loadActivityDetail(r, "x1")).name).toBe("N");
    expect(await loadActivitySourceText(r, "x1")).toBe("<gpx/>");
    await deleteActivity(r, "x1");
    expect(await listActivities(r)).toEqual([]);
  });

  it("les données survivent à une « réouverture » de la base (même fabrique)", async () => {
    const idb = new IDBFactory();
    const a = getBrowserStoreRoot({ dbName: "persist", idb });
    await writeTextFile(await a.getDirectoryHandle("d"), "f.txt", "durable");
    const b = getBrowserStoreRoot({ dbName: "persist-bis", idb: new IDBFactory() });
    expect(b).not.toBe(a);
    const reopened = getBrowserStoreRoot({ dbName: "persist", idb });
    expect(await readTextFile(await reopened.getDirectoryHandle("d"), "f.txt")).toBe("durable");
  });
});
