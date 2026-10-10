/**
 * Regroupement des zones en une requête (union de rectangles), 429 et serveurs défaillants.
 * Réseau entièrement simulé : aucun test n'interroge un vrai serveur Overpass.
 */
import { describe, it, expect, vi } from "vitest";

import { buildCellQuery, loadCells, waysForCell, CELLS_PER_REQUEST, MAX_REQUESTS_PER_RUN } from "./osm.js";
import { cellBounds, cellKey } from "./geo.js";
import { runTerrainAnalysis, planTerrainCells } from "./index.js";
import { memoryStore } from "./store.js";
import { makeTrack, overpassResponse } from "./tests/fixtures.js";

const noSleep = async () => {};
const ROAD = { highway: "residential", surface: "asphalt" };
/** Chemin synthétique à latitude/longitudes explicites (en degrés). */
const way = (id, lat, lons) => ({ id, tags: ROAD, geom: lons.map((lon) => [lat, lon]) });
const ok = (ways = []) => ({ ok: true, status: 200, json: async () => overpassResponse(ways) });
const failing = (status, retryAfter = null) => vi.fn(async () => ({ ok: false, status, headers: { get: (h) => (h === "Retry-After" ? retryAfter : null) } }));
const keysN = (n) => Array.from({ length: n }, (_, i) => `2250:${290 + i}`);
const run = (over) => loadCells({ cellKeys: keysN(7), store: memoryStore(), allowNetwork: true, endpoints: ["https://a", "https://b"], sleep: noSleep, minIntervalMs: 0, ...over });
const bodyOf = (call) => decodeURIComponent(call[1].body);
const numbersOf = (body) => body.match(/-?\d+\.\d{5}/g) || [];
const boundsNumbers = (keys) => keys.flatMap((k) => { const b = cellBounds(k); return [b.south, b.west, b.north, b.east].map((v) => v.toFixed(5)); });

describe("requête groupée — union de rectangles", () => {
  it("par défaut 3 zones par requête", () => {
    expect(CELLS_PER_REQUEST).toBe(3);
  });

  it("une zone : requête simple inchangée ; plusieurs zones : union d'autant de rectangles, sans boîte englobante", () => {
    const single = buildCellQuery("2250:290");
    expect(single).not.toContain("(way");
    expect(single.match(/way\["highway"\]/g)).toHaveLength(1);

    const keys = ["2250:290", "2250:293", "2251:296"]; // volontairement NON adjacentes
    const union = buildCellQuery(keys);
    expect(union.match(/way\["highway"\]/g)).toHaveLength(3);
    expect(union.startsWith("[out:json][timeout:25];(")).toBe(true);
    expect(union.endsWith(");out tags geom;")).toBe(true);
    // exactement les 12 bornes des 3 zones : la surface demandée est la somme des zones, jamais plus large
    expect(numbersOf(union)).toEqual(boundsNumbers(keys));
  });

  it("7 zones sans cache → 3 requêtes (3 + 3 + 1), chacune limitée aux bornes de ses propres zones", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const keys = keysN(7);
    const r = await run({ fetchImpl, cellKeys: keys });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.requests).toBe(3);
    expect(Object.values(r.cells).every((s) => s === "network")).toBe(true);
    const groups = [keys.slice(0, 3), keys.slice(3, 6), keys.slice(6)];
    fetchImpl.mock.calls.forEach((call, i) => expect(numbersOf(bodyOf(call))).toEqual(boundsNumbers(groups[i])));
    expect(bodyOf(fetchImpl.mock.calls[2])).not.toContain("(way"); // dernière zone seule : requête simple
  });

  it("le regroupement divise le nombre de requêtes d'un tracé de 22 zones par 3 (8 au lieu de 22), plafond de 6 requêtes → 18 zones", async () => {
    const points = makeTrack({ toM: 15000, stepM: 50 });
    const total = planTerrainCells(points).count;
    expect(total).toBe(22);
    const fetchImpl = vi.fn(async () => ok());
    const r = await runTerrainAnalysis({ sources: { ign: false }, points, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(Math.ceil(total / CELLS_PER_REQUEST)).toBe(8);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REQUESTS_PER_RUN);
    expect(r.cellCounts).toMatchObject({ total: 22, available: 18, deferred: 4 });
    expect(r.load.capped).toBe(true);
    expect(r.load.unavailable).toBe(false);
    // la relance ne redemande que les 4 zones restantes, en 2 requêtes (3 + 1)
    const store = memoryStore();
    await runTerrainAnalysis({ sources: { ign: false }, points, store, allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const again = vi.fn(async () => ok());
    await runTerrainAnalysis({ sources: { ign: false }, points, store, allowNetwork: true, fetchImpl: again, sleep: noSleep, minIntervalMs: 0 });
    expect(again).toHaveBeenCalledTimes(2);
  });

  it("les zones déjà en cache ne sont pas redemandées : seules les zones manquantes sont regroupées", async () => {
    const fresh = { fetchedAt: Date.now(), ways: [] };
    const keys = keysN(5);
    const store = memoryStore({ [keys[0]]: fresh, [keys[2]]: fresh });
    const fetchImpl = vi.fn(async () => ok());
    const r = await run({ fetchImpl, store, cellKeys: keys });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 3 zones manquantes → une seule requête
    expect(numbersOf(bodyOf(fetchImpl.mock.calls[0]))).toEqual(boundsNumbers([keys[1], keys[3], keys[4]]));
    expect(r.cells[keys[0]]).toBe("cache");
    expect(r.cells[keys[2]]).toBe("cache");
  });
});

describe("requête groupée — cache zone par zone", () => {
  // Zones 2250:299 (lon 5,98–6,00) et 2250:300 (lon 6,00–6,02), latitude 45,00–45,02
  const K1 = "2250:299";
  const K2 = "2250:300";
  const A = way(1, 45.01, [5.985, 5.995]); // zone 1 seulement
  const B = way(2, 45.01, [6.005, 6.015]); // zone 2 seulement
  const C = way(3, 45.012, [5.99, 6.01]); // traverse les deux zones

  it("waysForCell attribue chaque chemin aux zones que son emprise rencontre", () => {
    expect(waysForCell([A, B, C], K1).map((w) => w.id)).toEqual([1, 3]);
    expect(waysForCell([A, B, C], K2).map((w) => w.id)).toEqual([2, 3]);
    expect(waysForCell([A, B, C], "2251:299")).toEqual([]);
  });

  it("chaque zone est mise en cache avec SES chemins ; un chemin à cheval est dans les deux, compté une fois au total", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ok([A, B, C]));
    const r = await run({ fetchImpl, store, cellKeys: [K1, K2] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await store.get(K1)).ways.map((w) => w.id)).toEqual([1, 3]);
    expect((await store.get(K2)).ways.map((w) => w.id)).toEqual([2, 3]);
    expect(r.ways.map((w) => w.id).sort()).toEqual([1, 2, 3]);

    // les zones sont ensuite servies par le cache, individuellement, sans réseau
    const again = vi.fn();
    const r2 = await run({ fetchImpl: again, store, cellKeys: [K1, K2] });
    expect(again).not.toHaveBeenCalled();
    expect(r2.cells).toEqual({ [K1]: "cache", [K2]: "cache" });
    expect(r2.ways).toHaveLength(3);
  });

  it("cellKey/cellBounds restent cohérents avec les zones utilisées ci-dessus", () => {
    expect(cellKey(45.01, 5.985)).toBe(K1);
    expect(cellKey(45.01, 6.005)).toBe(K2);
  });
});

describe("requête groupée — échecs, 429 et serveurs défaillants", () => {
  it("dix zones en 503 : un groupe en échec = 3 zones en erreur ; arrêt après 2 groupes (4 appels), le reste différé", async () => {
    const fetchImpl = failing(503);
    const r = await run({ fetchImpl, cellKeys: keysN(10) });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(r.unavailable).toBe(true);
    const states = Object.values(r.cells);
    expect(states.filter((s) => s === "error")).toHaveLength(6);
    expect(states.filter((s) => s === "deferred")).toHaveLength(4);
  });

  it("429 : arrêt immédiat après le premier groupe, retryAfterMs lu, aucune autre requête", async () => {
    const fetchImpl = failing(429, "50");
    const r = await run({ fetchImpl, cellKeys: keysN(10) });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // principal puis secours pour CE groupe, puis plus rien
    expect(r.rateLimited).toBe(true);
    expect(r.retryAfterMs).toBe(50000);
    expect(r.unavailable).toBe(true);
    expect(Object.values(r.cells).filter((s) => s === "deferred")).toHaveLength(7);
  });

  it("500 : pas de limite de débit signalée", async () => {
    const r = await run({ fetchImpl: failing(500), cellKeys: keysN(4) });
    expect(r.rateLimited).toBe(false);
    expect(r.retryAfterMs).toBe(0);
  });

  it("groupe en échec avec copies périmées : elles sont conservées (« stale ») et réutilisées", async () => {
    const keys = keysN(3);
    const old = { fetchedAt: 0, ways: [way(9, 45.01, [5.5, 5.6])] };
    const store = memoryStore({ [keys[0]]: old, [keys[1]]: { fetchedAt: 0, ways: [way(10, 45.01, [5.7, 5.8])] } });
    const r = await run({ fetchImpl: failing(503), store, cellKeys: keys });
    expect(r.cells[keys[0]]).toBe("stale");
    expect(r.cells[keys[1]]).toBe("stale");
    expect(r.cells[keys[2]]).toBe("error");
    expect(r.ways.map((w) => w.id).sort()).toEqual([10, 9].sort());
  });

  it("serveur de secours en panne (type kumi : 500 sans CORS → erreur réseau) : écarté après 2 échecs, plus aucune requête perdue", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === "https://b") throw new TypeError("Failed to fetch"); // réponse sans en-têtes CORS : erreur réseau côté navigateur
      return { ok: false, status: 504, headers: { get: () => null } };
    });
    await run({ fetchImpl, cellKeys: keysN(9), maxFailedCells: 99, maxRequests: 99 });
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === "https://b")).toHaveLength(2);
    expect(urls.filter((u) => u === "https://a")).toHaveLength(2);
  });

  it("un succès remet à zéro les échecs consécutifs d'un serveur : un serveur intermittent n'est pas écarté", async () => {
    const seq = [504, "ok", 504, "ok", 504, "ok"];
    let i = 0;
    const fetchImpl = vi.fn(async () => { const s = seq[i++]; return s === "ok" ? ok() : { ok: false, status: s, headers: { get: () => null } }; });
    const r = await run({ fetchImpl, cellKeys: keysN(6), endpoints: ["https://a"], cellsPerRequest: 1, maxFailedCells: 99, maxRequests: 99 });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(Object.values(r.cells)).toEqual(["error", "network", "error", "network", "error", "network"]);
  });

  it("confidentialité : seules les bornes des zones demandées partent, aucune coordonnée du tracé, y compris en requête groupée", async () => {
    const POINTS = [
      { lat: 45.123457, lon: 6.054321 }, { lat: 45.123981, lon: 6.058765 }, { lat: 45.124403, lon: 6.063219 },
      { lat: 45.125117, lon: 6.067842 }, { lat: 45.125998, lon: 6.072456 },
    ];
    const fetchImpl = vi.fn(async () => ok());
    const rich = POINTS.map((p, i) => ({ ...p, time: new Date(Date.UTC(2031, 6, 4, 10, 0, i)), hr: 151 + i, power: 233 + i }));
    const r = await runTerrainAnalysis({ sources: { ign: false }, points: rich, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const keys = Object.keys(r.load.cells);
    expect(fetchImpl.mock.calls.length).toBe(Math.ceil(keys.length / CELLS_PER_REQUEST));
    const allowed = new Set(boundsNumbers(keys));
    for (const call of fetchImpl.mock.calls) {
      const body = bodyOf(call);
      for (const p of POINTS) { expect(body).not.toContain(String(p.lat)); expect(body).not.toContain(String(p.lon)); }
      expect(body).not.toMatch(/poly:|around|2031|233|151/);
      for (const n of numbersOf(body)) expect(allowed.has(n)).toBe(true);
    }
  });

  it("progression : le compteur avance de la taille de chaque groupe, jusqu'au total", async () => {
    const seen = [];
    await run({ fetchImpl: vi.fn(async () => ok()), cellKeys: keysN(7), onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[3, 7], [6, 7], [7, 7]]);
  });
});
