import { describe, it, expect } from "vitest";
import { mergeClimbNames, readClimbNamesFile, writeClimbNamesFile, findClimbName } from "./climbNames.js";

const pos = { startLat: 45, startLon: 6, endLat: 45.01, endLon: 6 };
const entry = (name, d = 0) => ({ name, ...pos, startLat: 45 + d });

// Faux dossier : l'interface minimale utilisée par readTextFile/writeTextFile.
function fakeRoot() {
  const files = new Map();
  return {
    files,
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name) && !create) throw new Error("NotFound");
      return {
        async getFile() { return { text: async () => files.get(name) }; },
        async createWritable() { let buf = ""; return { write: async (c) => { buf = c; }, close: async () => { files.set(name, buf); } }; },
      };
    },
  };
}

describe("noms de montées dans le dossier", () => {
  it("écrit puis relit les noms", async () => {
    const root = fakeRoot();
    expect(await writeClimbNamesFile(root, [entry("Col du Test")])).toBe(true);
    const back = await readClimbNamesFile(root);
    expect(findClimbName(back, pos)).toBe("Col du Test");
  });

  it("fichier absent ou corrompu : aucun nom, sans exception", async () => {
    const root = fakeRoot();
    expect(await readClimbNamesFile(root)).toEqual([]);
    root.files.set("climbs.json", "{pas du json");
    expect(await readClimbNamesFile(root)).toEqual([]);
    expect(await readClimbNamesFile(null)).toEqual([]);
  });

  it("fusion : l'entrée préférée l'emporte pour la même montée, les autres sont conservées", () => {
    const merged = mergeClimbNames([entry("Ancien"), { ...entry("Autre"), startLat: 47, endLat: 47.01 }], [entry("Nouveau")]);
    expect(merged).toHaveLength(2);
    expect(findClimbName(merged, pos)).toBe("Nouveau");
  });
});
