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

describe("segments Strava liés aux montées", () => {
  const group = { startLat: 45, startLon: 6, endLat: 45.01, endLon: 6 };
  const segment = { id: 7, name: "Col du Test", category: 3 };

  it("une montée non nommée prend le nom du segment, un nom saisi le remplace sans casser le lien", async () => {
    const { saveStravaLinks, saveClimbName, findClimbName, findClimbStrava } = await import("./climbNames.js");
    let names = saveStravaLinks([], [{ group, segment }]);
    expect(findClimbName(names, group)).toBe("Col du Test");
    names = saveClimbName(names, group, "Ma bosse");
    expect(findClimbName(names, group)).toBe("Ma bosse");
    expect(findClimbStrava(names, group).id).toBe(7);
    names = saveClimbName(names, group, ""); // effacer le nom : retour au nom Strava
    expect(findClimbName(names, group)).toBe("Col du Test");
  });

  it("un lien Strava ne remplace pas un nom déjà saisi", async () => {
    const { saveStravaLinks, saveClimbName, findClimbName } = await import("./climbNames.js");
    let names = saveClimbName([], group, "Ma bosse");
    names = saveStravaLinks(names, [{ group, segment }]);
    expect(findClimbName(names, group)).toBe("Ma bosse");
  });
});
