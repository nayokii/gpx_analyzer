import { describe, it, expect, vi } from "vitest";

import { classifyWay, hasTechnicalTags } from "./classify.js";
import { cellsForTrack, cellKey, cellBounds, CELL_SIZE_DEG, distanceM } from "./geo.js";
import { matchTrack } from "./matching.js";
import { summarizeTerrain, terrainStrip } from "./profile.js";
import { estimateDifficulty, segmentTechnicalPoints, difficultyLevel } from "./difficulty.js";
import { analyzeTerrain, runTerrainAnalysis, planTerrainCells } from "./index.js";
import {
  buildCellQuery, parseOverpassResponse, loadCells, MAX_NETWORK_CELLS, CACHE_TTL_MS, REQUEST_TIMEOUT_MS,
  MAX_FAILED_CELLS, MAX_REQUESTS_PER_RUN, MAX_REQUESTS_PER_CELL, OVERPASS_ENDPOINTS,
} from "./osm.js";
import { memoryStore } from "./store.js";
import { makeTrack, makeWay, overpassResponse, lonAt } from "./tests/fixtures.js";

const ROAD = { highway: "residential", surface: "asphalt" };
const TRACK = { highway: "track", tracktype: "grade3", surface: "gravel" };
const PATH = { highway: "path", "mtb:scale": "2", smoothness: "bad" };

describe("classifyWay — catégories de terrain", () => {
  it("route, piste et sentier de base", () => {
    expect(classifyWay({ highway: "tertiary" })).toBe("road");
    expect(classifyWay({ highway: "track" })).toBe("track");
    expect(classifyWay({ highway: "path" })).toBe("trail");
    expect(classifyWay({ highway: "bridleway" })).toBe("trail");
  });

  it("une surface revêtue l'emporte : un chemin goudronné n'est pas un sentier VTT", () => {
    expect(classifyWay({ highway: "path", surface: "asphalt" })).toBe("road");
    expect(classifyWay({ highway: "footway", surface: "paving_stones" })).toBe("road");
    expect(classifyWay({ highway: "track", surface: "concrete" })).toBe("road");
  });

  it("une voie de circulation non revêtue devient une piste ; sans surface elle reste une route", () => {
    expect(classifyWay({ highway: "residential", surface: "gravel" })).toBe("track");
    expect(classifyWay({ highway: "service" })).toBe("road");
    expect(classifyWay({ highway: "cycleway" })).toBe("road");
    expect(classifyWay({ highway: "cycleway", surface: "compacted" })).toBe("track");
  });

  it("ne devine pas : type de voie inconnu ou absent → null ; la forêt n'a aucun effet", () => {
    expect(classifyWay({ highway: "raceway" })).toBeNull();
    expect(classifyWay({})).toBeNull();
    expect(classifyWay({ highway: "track", landuse: "forest", natural: "wood" })).toBe("track");
    expect(classifyWay({ highway: "path", landuse: "forest" })).toBe("trail");
  });

  it("hasTechnicalTags repère les tags techniques explicites", () => {
    expect(hasTechnicalTags({ highway: "path" })).toBe(false);
    expect(hasTechnicalTags({ highway: "path", "mtb:scale": "1" })).toBe(true);
  });
});

describe("geo — zones de requête (confidentialité)", () => {
  it("n'envoie que des zones de ~2 km, jamais des points du tracé", () => {
    const track = makeTrack({ toM: 1000 });
    const cells = cellsForTrack(track);
    expect(cells.length).toBeGreaterThanOrEqual(1);
    // le tracé de test longe une limite de zone : la marge de 30 m peut ajouter la zone voisine, rien de plus
    expect(cells.length).toBeLessThanOrEqual(4);
    for (const key of cells) {
      const b = cellBounds(key);
      expect(b.north - b.south).toBeCloseTo(CELL_SIZE_DEG, 6);
      expect(b.east - b.west).toBeCloseTo(CELL_SIZE_DEG, 6);
    }
    // la requête ne contient que le rectangle
    const q = buildCellQuery(cells[0]);
    expect(q).toContain("out tags geom");
    expect(q).not.toMatch(/around|poly:/);
  });

  it("un tracé long traverse plusieurs zones, sans doublons", () => {
    const cells = cellsForTrack(makeTrack({ toM: 9000 }));
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.length).toBeGreaterThan(2);
  });

  it("distanceM est cohérente avec la géométrie des tests", () => {
    expect(distanceM(45, lonAt(0), 45, lonAt(1000))).toBeCloseTo(1000, 0);
    expect(cellKey(45.01, 6.01)).toBe(cellKey(45.0105, 6.0105));
  });
});

describe("matchTrack + summarizeTerrain — distances et pourcentages", () => {
  it("tracé 100 % routier : ~100 % route, type Route", () => {
    const track = makeTrack({ toM: 2000 });
    const { segments, totalM } = matchTrack(track, [makeWay(1, ROAD, { toM: 2000 })]);
    const s = summarizeTerrain(segments);
    expect(totalM).toBeCloseTo(2000, 0);
    expect(s.distancesM.road).toBeCloseTo(2000, 0);
    expect(s.pctOfTotal.road).toBeCloseTo(100, 5);
    expect(s.coverage).toBeCloseTo(1, 5);
    expect(s.type).toBe("road");
  });

  it("tracé forestier sur une piste : VTT chemins/pistes (la forêt seule ne change rien)", () => {
    const s = summarizeTerrain(matchTrack(makeTrack({ toM: 3000 }), [makeWay(2, { ...TRACK, landuse: "forest" }, { toM: 3000 })]).segments);
    expect(s.distancesM.track).toBeCloseTo(3000, 0);
    expect(s.type).toBe("mtb_tracks");
  });

  it("tracé sur sentiers : VTT sentiers", () => {
    const s = summarizeTerrain(matchTrack(makeTrack({ toM: 2000 }), [makeWay(3, PATH, { toM: 2000 })]).segments);
    expect(s.distancesM.trail).toBeCloseTo(2000, 0);
    expect(s.type).toBe("mtb_trails");
  });

  it("sortie mixte : 1 km de route + 1 km de piste + 1 km de sentier, chaque part exacte", () => {
    const ways = [
      makeWay(10, ROAD, { fromM: 0, toM: 1000 }),
      makeWay(11, TRACK, { fromM: 1000, toM: 2000 }),
      makeWay(12, PATH, { fromM: 2000, toM: 3000 }),
    ];
    const { segments } = matchTrack(makeTrack({ toM: 3000 }), ways);
    const s = summarizeTerrain(segments);
    expect(s.distancesM.road).toBeCloseTo(1000, -1);
    expect(s.distancesM.track).toBeCloseTo(1000, -1);
    expect(s.distancesM.trail).toBeCloseTo(1000, -1);
    expect(s.pctOfTotal.road + s.pctOfTotal.track + s.pctOfTotal.trail + s.pctOfTotal.unclassified).toBeCloseTo(100, 6);
    expect(s.type).toBe("mixed");
  });

  it("portions non couvertes : « non classifié », jamais devinées ; pourcentages sur la distance totale", () => {
    const { segments } = matchTrack(makeTrack({ toM: 2000 }), [makeWay(20, ROAD, { fromM: 0, toM: 1000 })]);
    const s = summarizeTerrain(segments);
    // la tolérance de rattachement (20 m) déborde légèrement au-delà de la fin du chemin
    expect(s.pctOfTotal.road).toBeGreaterThan(48);
    expect(s.pctOfTotal.road).toBeLessThan(53);
    expect(s.pctOfTotal.road + s.pctOfTotal.unclassified).toBeCloseTo(100, 6);
    expect(s.coverage).toBeCloseTo(0.5, 1);
  });

  it("chemins superposés : chaque mètre n'est compté qu'une fois", () => {
    const ways = [makeWay(30, PATH, { toM: 1000 }), makeWay(31, { highway: "footway" }, { toM: 1000, offsetM: 3 }), makeWay(32, TRACK, { toM: 1000, offsetM: 8 })];
    const { segments, totalM } = matchTrack(makeTrack({ toM: 1000 }), ways);
    const s = summarizeTerrain(segments);
    expect(s.classifiedM).toBeCloseTo(totalM, 6); // jamais 2 ou 3 × la distance
    expect(s.distancesM.trail).toBeCloseTo(1000, 0); // le plus proche l'emporte (path à 0 m)
    expect(s.distancesM.track).toBe(0);
  });

  it("un chemin à plus de 20 m n'est pas rattaché", () => {
    const { segments } = matchTrack(makeTrack({ toM: 500 }), [makeWay(40, ROAD, { toM: 500, offsetM: 60 })]);
    expect(summarizeTerrain(segments).classifiedM).toBe(0);
  });

  it("aucune donnée cartographique : tout non classifié, type Indéterminé", () => {
    const { segments } = matchTrack(makeTrack({ toM: 1000 }), []);
    const s = summarizeTerrain(segments);
    expect(s.coverage).toBe(0);
    expect(s.pctOfTotal.unclassified).toBeCloseTo(100, 6);
    expect(s.type).toBe("unknown");
  });

  it("couverture insuffisante (30 %) : type Indéterminé même si la part couverte est routière", () => {
    const { segments } = matchTrack(makeTrack({ toM: 1000 }), [makeWay(50, ROAD, { toM: 300 })]);
    const s = summarizeTerrain(segments);
    expect(s.coverage).toBeLessThan(0.5);
    expect(s.type).toBe("unknown");
  });

  it("la bande de terrain restitue l'ordre des portions", () => {
    const { segments } = matchTrack(makeTrack({ toM: 2000 }), [makeWay(60, ROAD, { toM: 1000 }), makeWay(61, PATH, { fromM: 1000, toM: 2000 })]);
    const strip = terrainStrip(segments, 10);
    expect(strip).toHaveLength(10);
    expect(strip[0].category).toBe("road");
    expect(strip[9].category).toBe("trail");
  });

  it("ignore les points sans coordonnées et les tracés trop courts", () => {
    expect(matchTrack([{ lat: 45, lon: 6 }], []).segments).toEqual([]);
    expect(matchTrack([{ lat: null, lon: null }, { lat: 45, lon: 6 }], []).totalM).toBe(0);
  });
});

describe("estimateDifficulty — estimation, confiance, états", () => {
  function difficultyFor(ways, track) {
    const { segments } = matchTrack(track, ways);
    return estimateDifficulty(segments, summarizeTerrain(segments));
  }

  it("couverture insuffisante → « données insuffisantes », aucune note", () => {
    const d = difficultyFor([makeWay(1, PATH, { toM: 200 })], makeTrack({ toM: 2000 }));
    expect(d.status).toBe("insufficient");
    expect(d.score).toBeUndefined();
  });

  it("sortie routière → non applicable (pas de note de difficulté VTT)", () => {
    const d = difficultyFor([makeWay(1, ROAD, { toM: 3000 })], makeTrack({ toM: 3000 }));
    expect(d.status).toBe("not_applicable");
  });

  it("hors-route trop court → non applicable", () => {
    const d = difficultyFor([makeWay(1, ROAD, { toM: 3000 }), makeWay(2, PATH, { fromM: 3000, toM: 3300 })], makeTrack({ toM: 3300 }));
    expect(d.status).toBe("not_applicable");
  });

  it("piste simple sans pente : note faible, niveau Facile, confiance renseignée", () => {
    const track = makeTrack({ toM: 3000, grade: 1 });
    const d = difficultyFor([makeWay(1, { highway: "track", tracktype: "grade1", surface: "compacted" }, { toM: 3000 })], track);
    expect(d.status).toBe("ok");
    expect(d.level).toBe("easy");
    expect(d.score).toBeLessThan(30);
    expect(["low", "medium", "high"]).toContain(d.confidence.label);
  });

  it("sentier mtb:scale=3, smoothness très mauvaise : note élevée, facteurs explicites, confiance haute", () => {
    const tags = { highway: "path", "mtb:scale": "3", smoothness: "very_bad", trail_visibility: "bad", surface: "rock" };
    const d = difficultyFor([makeWay(1, tags, { toM: 3000 })], makeTrack({ toM: 3000, grade: 12 }));
    expect(d.status).toBe("ok");
    expect(d.level).toBe("hard");
    expect(d.score).toBeGreaterThanOrEqual(55);
    expect(d.confidence.label).toBe("high");
    const keys = d.factors.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["mtb", "smoothness", "visibility", "surface", "slope"]));
    expect(d.factors.find((f) => f.key === "mtb").label).toMatch(/niveau maximal 3/);
  });

  it("sentier sans aucun tag technique : note modeste, confiance faible, limite signalée", () => {
    const d = difficultyFor([makeWay(1, { highway: "path" }, { toM: 3000 })], makeTrack({ toM: 3000, grade: 2 }));
    expect(d.status).toBe("ok");
    expect(d.confidence.label).toBe("low");
    expect(d.factors.map((f) => f.key)).toContain("sparse");
    expect(d.score).toBeLessThan(55);
  });

  it("le dénivelé seul ne fait pas la difficulté : même piste, pente douce vs forte → écart borné à 15 points", () => {
    const way = [makeWay(1, TRACK, { toM: 3000 })];
    const flat = difficultyFor(way, makeTrack({ toM: 3000, grade: 1 })).score;
    const steep = difficultyFor(way, makeTrack({ toM: 3000, grade: 15 })).score;
    expect(steep - flat).toBeGreaterThan(0);
    expect(steep - flat).toBeLessThanOrEqual(15);
  });

  it("sans altitude : pas de composante de pente, confiance plafonnée à « moyen »", () => {
    const tags = { highway: "path", "mtb:scale": "2", smoothness: "bad" };
    const d = difficultyFor([makeWay(1, tags, { toM: 3000 })], makeTrack({ toM: 3000, grade: null }));
    expect(d.status).toBe("ok");
    expect(d.components.slope).toBe(0);
    expect(d.confidence.label).not.toBe("high");
  });

  it("les virages serrés ajoutent des points (borné à 10) ; un tracé rectiligne n'en ajoute pas", () => {
    const straight = difficultyFor([makeWay(1, PATH, { toM: 2000 })], makeTrack({ toM: 2000 }));
    expect(straight.components.turns).toBe(0);
    // lacets : zigzag nord-sud tous les 50 m le long d'un chemin large (tolérance de rattachement respectée)
    const zig = [];
    for (let x = 0; x <= 2000; x += 10) zig.push({ lat: 45 + (Math.floor(x / 50) % 2 === 0 ? 0 : 14) / 110540, lon: lonAt(x), grade: 0 });
    const way = makeWay(2, PATH, { toM: 2000, offsetM: 7 });
    const d = estimateDifficulty(matchTrack(zig, [way]).segments, summarizeTerrain(matchTrack(zig, [way]).segments));
    expect(d.components.turns).toBeGreaterThan(0);
    expect(d.components.turns).toBeLessThanOrEqual(10);
  });

  it("points techniques d'un tronçon : plafonnés, croissants avec les tags", () => {
    expect(segmentTechnicalPoints("trail", {})).toBeLessThan(segmentTechnicalPoints("trail", { "mtb:scale": "3" }));
    expect(segmentTechnicalPoints("trail", { "mtb:scale": "6", smoothness: "impassable", trail_visibility: "no", surface: "scree" })).toBe(75);
    expect(segmentTechnicalPoints("track", { highway: "track", tracktype: "grade1" })).toBeLessThan(segmentTechnicalPoints("track", { highway: "track", tracktype: "grade5" }));
  });

  it("seuils de niveau", () => {
    expect(difficultyLevel(29)).toBe("easy");
    expect(difficultyLevel(30)).toBe("moderate");
    expect(difficultyLevel(55)).toBe("hard");
  });
});

describe("parseOverpassResponse", () => {
  it("allège les chemins et ignore les éléments mal formés", () => {
    const ways = parseOverpassResponse({
      elements: [
        { type: "way", id: 1, tags: { highway: "path", name: "secret", surface: "dirt" }, geometry: [{ lat: 45.00001234, lon: 6.0 }, { lat: 45.0002, lon: 6.0001 }] },
        { type: "node", id: 2 },
        { type: "way", id: 3, tags: { highway: "path" }, geometry: [{ lat: 45, lon: 6 }] },
        { type: "way", id: 4, tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
      ],
    });
    expect(ways).toHaveLength(1);
    expect(ways[0].tags).toEqual({ highway: "path", surface: "dirt" }); // le nom n'est pas conservé
    expect(ways[0].geom[0]).toEqual([45.00001, 6]);
  });

  it("rejette une réponse inattendue", () => {
    expect(() => parseOverpassResponse({})).toThrow();
    expect(() => parseOverpassResponse(null)).toThrow();
  });
});

describe("loadCells — cache, consentement, erreurs réseau", () => {
  const okFetch = (ways) => vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse(ways) }));
  const noSleep = vi.fn(async () => {});
  const KEYS = ["10:20", "10:21"];

  it("sans consentement (allowNetwork=false) : aucun appel réseau ; utilise le cache, marque le reste « missing »", async () => {
    const store = memoryStore({ "10:20": { fetchedAt: Date.now(), ways: [makeWay(1, ROAD)] } });
    const fetchImpl = vi.fn();
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store, allowNetwork: false, fetchImpl, sleep: noSleep });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.cells).toEqual({ "10:20": "cache", "10:21": "missing" });
    expect(r.ways).toHaveLength(1);
  });

  it("avec consentement : télécharge les zones absentes, les met en cache, ne retélécharge pas les zones fraîches", async () => {
    const store = memoryStore();
    const fetchImpl = okFetch([makeWay(1, ROAD)]);
    const r1 = await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store, allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r1.cells).toEqual({ "10:20": "network", "10:21": "network" });
    const r2 = await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store, allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // cache réutilisé
    expect(r2.cells).toEqual({ "10:20": "cache", "10:21": "cache" });
  });

  it("un même chemin présent dans deux zones n'est compté qu'une fois", async () => {
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store: memoryStore(), allowNetwork: true, fetchImpl: okFetch([makeWay(7, ROAD)]), sleep: noSleep, minIntervalMs: 0 });
    expect(r.ways).toHaveLength(1);
  });

  it("envoie uniquement la requête de la zone (POST, pas de tracé), sans en-tête d'identité", async () => {
    const fetchImpl = okFetch([]);
    await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
    expect(decodeURIComponent(init.body)).toContain("way[\"highway\"]");
  });

  it("espace les requêtes (pause entre deux zones)", async () => {
    const sleep = vi.fn(async () => {});
    await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store: memoryStore(), allowNetwork: true, fetchImpl: okFetch([]), sleep, minIntervalMs: 5000 });
    expect(sleep).toHaveBeenCalled();
  });

  it("erreur réseau sur une zone : zone « error », les autres restent utilisables, aucune exception", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, json: async () => overpassResponse([makeWay(1, ROAD)]) };
    });
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: KEYS, store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep: noSleep, minIntervalMs: 0 });
    expect(r.cells["10:20"]).toBe("error");
    expect(r.cells["10:21"]).toBe("network");
    expect(r.errors).toHaveLength(1);
    expect(r.ways).toHaveLength(1);
  });

  it("429 : AUCUN nouvel essai sur le même serveur ni pause de reprise ; la zone passe en erreur", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, headers: { get: () => "3" } }));
    const sleep = vi.fn(async () => {});
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep, minIntervalMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled(); // plus de pause de 2 à 10 s, Retry-After n'est pas attendu
    expect(r.cells["10:20"]).toBe("error");
  });

  it("bascule sur le second serveur si le premier échoue (un seul essai par serveur)", async () => {
    const fetchImpl = vi.fn(async (url) => (url === "https://a" ? { ok: false, status: 500, headers: { get: () => null } } : { ok: true, status: 200, json: async () => overpassResponse([makeWay(1, ROAD)]) }));
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a", "https://b"], sleep: noSleep, minIntervalMs: 0 });
    expect(r.cells["10:20"]).toBe("network");
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://a", "https://b"]);
  });

  it("réponse invalide (JSON inattendu) : zone « error », jamais de donnée inventée", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ remark: "runtime error" }) }));
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep: noSleep, minIntervalMs: 0 });
    expect(r.cells["10:20"]).toBe("error");
    expect(r.ways).toEqual([]);
  });

  it("cache périmé + réseau en échec : on garde l'ancienne copie (« stale ») plutôt que rien", async () => {
    const old = { fetchedAt: Date.now() - CACHE_TTL_MS - 1000, ways: [makeWay(5, ROAD)] };
    const fetchImpl = vi.fn(async () => { throw new TypeError("offline"); });
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore({ "10:20": old }), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep: noSleep, minIntervalMs: 0 });
    expect(r.cells["10:20"]).toBe("stale");
    expect(r.ways).toHaveLength(1);
  });

  it("cache périmé hors consentement : utilisé tel quel, aucun appel réseau", async () => {
    const old = { fetchedAt: 0, ways: [makeWay(5, ROAD)] };
    const fetchImpl = vi.fn();
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore({ "10:20": old }), allowNetwork: false, fetchImpl, sleep: noSleep });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.cells["10:20"]).toBe("stale");
  });

  it("tracé trop étendu : aucune requête, « tooLarge »", async () => {
    const keys = Array.from({ length: MAX_NETWORK_CELLS + 1 }, (_, i) => `1:${i}`);
    const fetchImpl = vi.fn();
    const r = await loadCells({ cellsPerRequest: 1, cellKeys: keys, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.tooLarge).toBe(true);
    expect(Object.values(r.cells).every((s) => s === "missing")).toBe(true);
  });

  it("serveur qui ne répond pas : la requête est interrompue après le délai, la zone passe en erreur", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((url, init) => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
      }));
      const pending = loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep: async () => {}, minIntervalMs: 0 });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
      const r = await pending;
      expect(r.cells["10:20"]).toBe("error");
      expect(r.errors[0]).toMatch(/Délai dépassé/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("annulation : propage AbortError", async () => {
    const fetchImpl = vi.fn(async () => { const e = new Error("abort"); e.name = "AbortError"; throw e; });
    await expect(loadCells({ cellsPerRequest: 1, cellKeys: ["10:20"], store: memoryStore(), allowNetwork: true, fetchImpl, endpoints: ["https://a"], sleep: noSleep })).rejects.toThrow("abort");
  });
});

describe("loadCells — résilience Overpass (arrêt anticipé, plafond, relance)", () => {
  const noSleep = async () => {};
  const failing = (status) => vi.fn(async () => ({ ok: false, status, headers: { get: () => null } }));
  const ok = (ways = []) => ({ ok: true, status: 200, json: async () => overpassResponse(ways) });
  const keysN = (n) => Array.from({ length: n }, (_, i) => `10:${20 + i}`);
  const run = (over) => loadCells({ cellsPerRequest: 1, cellKeys: keysN(10), store: memoryStore(), allowNetwork: true, endpoints: ["https://a", "https://b"], sleep: noSleep, minIntervalMs: 0, ...over });
  const count = (r, status) => Object.values(r.cells).filter((s) => s === status).length;

  it("constantes : 2 zones consécutives, 6 requêtes par exécution, 2 requêtes par zone", () => {
    expect([MAX_FAILED_CELLS, MAX_REQUESTS_PER_RUN, MAX_REQUESTS_PER_CELL]).toEqual([2, 6, 2]);
  });

  it("dix zones en erreur 503 : arrêt après 2 zones en échec, au plus 4 appels, unavailable, 8 zones différées", async () => {
    const fetchImpl = failing(503);
    const r = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 2 zones × (serveur principal + secours)
    expect(r.unavailable).toBe(true);
    expect(r.capped).toBe(false);
    expect(r.rateLimited).toBe(false);
    expect(count(r, "error")).toBe(MAX_FAILED_CELLS);
    expect(count(r, "deferred")).toBe(8);
    expect(r.requests).toBe(4);
    expect(r.ways).toEqual([]);
  });

  it("dix zones en erreur 429 : arrêt IMMÉDIAT après la première zone en échec (2 appels : principal + secours), rateLimited", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, headers: { get: (h) => (h === "Retry-After" ? "45" : null) } }));
    const r = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.unavailable).toBe(true);
    expect(r.rateLimited).toBe(true);
    expect(r.retryAfterMs).toBe(45000); // Retry-After lu quand le serveur l'expose
    expect(count(r, "error")).toBe(1);
    expect(count(r, "deferred")).toBe(9);
  });

  it("429 avec réponse du serveur de secours : le groupe est chargé mais plus AUCUN nouveau groupe n'est demandé", async () => {
    const fetchImpl = vi.fn(async (url) => (url === "https://a" ? { ok: false, status: 429, headers: { get: () => null } } : ok([makeWay(1, ROAD)])));
    const r = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.cells["10:20"]).toBe("network");
    expect(count(r, "deferred")).toBe(9);
    expect(r.rateLimited).toBe(true);
    expect(r.retryAfterMs).toBe(0);
  });

  it("avec les serveurs par défaut, le scénario reste borné (jamais plus de 4 appels)", async () => {
    const fetchImpl = failing(503);
    await run({ fetchImpl, endpoints: OVERPASS_ENDPOINTS });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("tous les types d'échec sont traités sans exception : 400, 403, 429, 500, 503, réseau, réponse invalide", async () => {
    const cases = [
      failing(400), failing(403), failing(429), failing(500), failing(503),
      vi.fn(async () => { throw new TypeError("Failed to fetch"); }),
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ remark: "runtime error: Query timed out" }) })),
    ];
    for (const fetchImpl of cases) {
      const r = await run({ fetchImpl, cellKeys: ["10:20"] });
      expect(r.cells["10:20"]).toBe("error");
      expect(r.errors).toHaveLength(1);
      expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_CELL);
      expect(r.ways).toEqual([]);
    }
  });

  it("délai dépassé : compté comme un échec, aucun nouvel essai sur ce serveur, zones suivantes différées", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((url, init) => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
      }));
      const pending = run({ fetchImpl, endpoints: ["https://a"], cellKeys: keysN(5) });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3);
      const r = await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(2); // une seule requête par zone (un seul serveur), 2 zones puis arrêt
      expect(r.unavailable).toBe(true);
      expect(count(r, "deferred")).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un échec isolé n'interrompt pas les autres zones", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => { n += 1; return n <= 2 ? { ok: false, status: 500, headers: { get: () => null } } : ok([makeWay(n, ROAD)]); });
    const r = await run({ fetchImpl, cellKeys: keysN(3) });
    expect(r.cells).toEqual({ "10:20": "error", "10:21": "network", "10:22": "network" });
    expect(r.unavailable).toBe(false);
    expect(count(r, "deferred")).toBe(0);
    expect(r.ways).toHaveLength(2);
  });

  it("un succès remet le compteur d'échecs consécutifs à zéro (échec, succès, échec, succès : pas d'arrêt)", async () => {
    const seq = [500, 500, "ok", 500, 500, "ok"];
    let i = 0;
    const fetchImpl = vi.fn(async () => { const s = seq[i++]; return s === "ok" ? ok([]) : { ok: false, status: s, headers: { get: () => null } }; });
    const r = await run({ fetchImpl, cellKeys: keysN(4) });
    expect(r.unavailable).toBe(false);
    expect(Object.values(r.cells)).toEqual(["error", "network", "error", "network"]);
  });

  it("plafond de 6 requêtes par exécution, zones saines : 6 zones chargées, le reste différé (capped, pas unavailable)", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    const r = await run({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_REQUESTS_PER_RUN);
    expect(r.requests).toBe(MAX_REQUESTS_PER_RUN);
    expect(count(r, "network")).toBe(6);
    expect(count(r, "deferred")).toBe(4);
    expect(r.capped).toBe(true);
    expect(r.unavailable).toBe(false);
  });

  it("le plafond est celui de l'EXÉCUTION : serveur de secours et zones multiples ne le dépassent jamais", async () => {
    // serveur principal toujours en panne (jamais écarté ici), secours sain : chaque zone coûte 2 requêtes → 3 zones, puis plafond
    const fetchImpl = vi.fn(async (url) => (url === "https://a" ? { ok: false, status: 503, headers: { get: () => null } } : ok([])));
    const r = await run({ fetchImpl, maxEndpointFailures: 99 });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(count(r, "network")).toBe(3);
    expect(count(r, "deferred")).toBe(7);
  });

  it("un serveur en panne est écarté après 2 échecs consécutifs : les zones suivantes ne lui coûtent plus de requête", async () => {
    const fetchImpl = vi.fn(async (url) => (url === "https://a" ? { ok: false, status: 503, headers: { get: () => null } } : ok([])));
    const r = await run({ fetchImpl });
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls.filter((u) => u === "https://a")).toHaveLength(2); // 2 essais, puis plus jamais
    expect(urls.filter((u) => u === "https://b")).toHaveLength(4); // zones 1-2 en secours, zones 3-4 directement
    expect(count(r, "network")).toBe(4);
    expect(r.requests).toBe(6);
  });

  it("si tous les serveurs sont écartés, la zone passe en erreur sans aucune requête supplémentaire", async () => {
    const fetchImpl = failing(500);
    const r = await run({ fetchImpl, maxFailedCells: 99, cellKeys: keysN(4) });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 2 serveurs × 2 échecs, puis plus rien
    expect(count(r, "error")).toBe(4);
  });

  it("plafond atteint en plein milieu d'une zone : le serveur de secours n'est PAS sollicité", async () => {
    const seq = [500, 500, "ok", 500, 500, 500]; // zone 1 échec (2), zone 2 ok (1), zone 3 échec (2), zone 4 : 6e requête puis plafond
    let i = 0;
    const fetchImpl = vi.fn(async () => { const s = seq[i++]; return s === "ok" ? ok([]) : { ok: false, status: s, headers: { get: () => null } }; });
    const r = await run({ fetchImpl, cellKeys: keysN(8), maxEndpointFailures: 99 });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(r.requests).toBe(6);
    expect(r.cells["10:23"]).toBe("error");
    expect(count(r, "deferred")).toBe(4);
  });

  it("jamais plus de 2 requêtes pour une zone, même avec plus de 2 serveurs configurés", async () => {
    const fetchImpl = failing(500);
    await run({ fetchImpl, cellKeys: ["10:20"], endpoints: ["https://a", "https://b", "https://c"] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bascule sur le 2e serveur : chaque serveur est essayé une seule fois par zone", async () => {
    const fetchImpl = vi.fn(async (url) => (url === "https://a" ? { ok: false, status: 500, headers: { get: () => null } } : ok([])));
    await run({ fetchImpl, cellKeys: keysN(2) });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://a", "https://b", "https://a", "https://b"]);
  });

  it("aucune pause de reprise : seul l'espacement normal entre zones est appliqué", async () => {
    const sleep = vi.fn(async () => {});
    await run({ fetchImpl: failing(429), sleep, minIntervalMs: 1200 });
    for (const [ms] of sleep.mock.calls) expect(ms).toBeLessThanOrEqual(1200);
  });

  it("aucune requête pour les zones déjà en cache (fraîches), qui ne consomment pas le budget", async () => {
    const fresh = { fetchedAt: Date.now(), ways: [makeWay(1, ROAD)] };
    const store = memoryStore({ "10:20": fresh, "10:21": fresh });
    const fetchImpl = vi.fn(async () => ok([]));
    const r = await run({ fetchImpl, store, cellKeys: keysN(3) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.cells).toMatchObject({ "10:20": "cache", "10:21": "cache", "10:22": "network" });
    expect(r.requests).toBe(1);
  });

  it("cache périmé : conservé (« stale ») quand le service est indisponible, les zones suivantes sont différées", async () => {
    const store = memoryStore({ "10:20": { fetchedAt: 0, ways: [makeWay(5, ROAD)] }, "10:21": { fetchedAt: 0, ways: [makeWay(6, ROAD)] } });
    const r = await run({ fetchImpl: failing(503), store, cellKeys: keysN(4) });
    expect(r.cells).toEqual({ "10:20": "stale", "10:21": "stale", "10:22": "deferred", "10:23": "deferred" });
    expect(r.ways).toHaveLength(2);
    expect(r.unavailable).toBe(true);
  });

  it("zones différées ou en échec : relançables, et seules elles sont redemandées (le reste vient du cache)", async () => {
    const store = memoryStore();
    const first = await run({ fetchImpl: failing(503), store, cellKeys: keysN(5) });
    expect(first.cells).toEqual({ "10:20": "error", "10:21": "error", "10:22": "deferred", "10:23": "deferred", "10:24": "deferred" });

    const fetchImpl = vi.fn(async () => ok([makeWay(1, ROAD)]));
    const second = await run({ fetchImpl, store, cellKeys: keysN(5) });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(second.unavailable).toBe(false);
    expect(Object.values(second.cells).every((s) => s === "network")).toBe(true);

    const third = await run({ fetchImpl, store, cellKeys: keysN(5) });
    expect(fetchImpl).toHaveBeenCalledTimes(5); // rien de plus : tout est en cache
    expect(Object.values(third.cells).every((s) => s === "cache")).toBe(true);
  });

  it("une relance repart avec un budget neuf : les zones différées par le plafond sont chargées sans redemander les 6 premières", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ok([]));
    await run({ fetchImpl, store });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const r2 = await run({ fetchImpl, store });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(r2.capped).toBe(false);
  });

  it("sans consentement : aucune requête et zones « missing » (pas « deferred »), même si les serveurs sont en panne", async () => {
    const fetchImpl = failing(503);
    const r = await run({ fetchImpl, allowNetwork: false, cellKeys: keysN(4) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(Object.values(r.cells).every((s) => s === "missing")).toBe(true);
    expect(r.unavailable).toBe(false);
  });

  it("annulation : AbortError propagée, aucune requête supplémentaire", async () => {
    const fetchImpl = vi.fn(async () => { const e = new Error("abort"); e.name = "AbortError"; throw e; });
    await expect(run({ fetchImpl })).rejects.toThrow("abort");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("confidentialité des requêtes Overpass", () => {
  const POINTS = [
    { lat: 45.123457, lon: 6.054321 }, { lat: 45.123981, lon: 6.058765 }, { lat: 45.124403, lon: 6.063219 },
    { lat: 45.125117, lon: 6.067842 }, { lat: 45.125998, lon: 6.072456 },
  ];
  const send = async (points = POINTS) => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse([]) }));
    const r = await runTerrainAnalysis({ sources: { ign: false }, cellsPerRequest: 1, points, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    return { calls: fetchImpl.mock.calls, bodies: fetchImpl.mock.calls.map(([, init]) => decodeURIComponent(init.body)), cellKeys: Object.keys(r.load.cells) };
  };

  it("chaque requête ne contient que la boîte englobante de sa zone : aucune coordonnée du tracé", async () => {
    const { bodies, cellKeys } = await send();
    expect(bodies.length).toBe(cellKeys.length);
    for (const body of bodies) {
      for (const p of POINTS) {
        expect(body).not.toContain(p.lat.toFixed(6));
        expect(body).not.toContain(p.lon.toFixed(6));
        expect(body).not.toContain(String(p.lat));
        expect(body).not.toContain(String(p.lon));
      }
      expect(body).not.toMatch(/poly:|around/);
    }
    // les seuls nombres géographiques envoyés sont les 4 bornes de la zone (multiples de la taille de zone)
    const allowed = new Set();
    for (const k of cellKeys) { const b = cellBounds(k); [b.south, b.west, b.north, b.east].forEach((v) => allowed.add(v.toFixed(5))); }
    for (const body of bodies) {
      const nums = body.match(/-?\d+\.\d{5}/g) || [];
      expect(nums).toHaveLength(4);
      for (const n of nums) expect(allowed.has(n)).toBe(true);
    }
  });

  it("la requête est un POST sans en-tête d'identité ni cookie", async () => {
    const { calls } = await send();
    for (const [url, init] of calls) {
      expect(OVERPASS_ENDPOINTS).toContain(url);
      expect(init.method).toBe("POST");
      expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
      expect(init.credentials).toBeUndefined();
      expect(init.body.startsWith("data=")).toBe(true);
    }
  });

  it("aucune heure, fréquence cardiaque, puissance ni nom dans le corps, même si les points en portent", async () => {
    const rich = POINTS.map((p, i) => ({ ...p, time: new Date(Date.UTC(2031, 6, 4, 10, 0, i)), hr: 151 + i, power: 233 + i, name: "Jean Dupont" }));
    const { bodies } = await send(rich);
    for (const body of bodies) expect(body).not.toMatch(/Jean|Dupont|2031|233|151|power|heart/i);
  });
});


describe("runTerrainAnalysis — bout en bout", () => {
  it("sans GPS : état « no_gps »", async () => {
    expect((await runTerrainAnalysis({ sources: { ign: false }, points: [], store: memoryStore(), allowNetwork: false })).status).toBe("no_gps");
    expect((await runTerrainAnalysis({ sources: { ign: false }, points: [{ lat: null, lon: null }], store: memoryStore(), allowNetwork: false })).status).toBe("no_gps");
  });

  it("hors ligne et sans cache : résultat « indéterminé », couverture 0, zones manquantes comptées", async () => {
    const track = makeTrack({ toM: 2000 });
    const r = await runTerrainAnalysis({ sources: { ign: false }, points: track, store: memoryStore(), allowNetwork: false });
    expect(r.status).toBe("done");
    expect(r.result.summary.type).toBe("unknown");
    expect(r.result.summary.coverage).toBe(0);
    expect(r.cellCounts.available).toBe(0);
    expect(r.cellCounts.missing).toBe(r.cellCounts.total);
  });

  it("tracé mixte avec données réseau mises en cache : résultat complet, puis identique hors ligne", async () => {
    const track = makeTrack({ toM: 3000 });
    const ways = [makeWay(1, ROAD, { toM: 1000 }), makeWay(2, TRACK, { fromM: 1000, toM: 2000 }), makeWay(3, PATH, { fromM: 2000, toM: 3000 })];
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => overpassResponse(ways) }));
    const online = await runTerrainAnalysis({ sources: { ign: false }, points: track, store, allowNetwork: true, fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    expect(online.result.summary.type).toBe("mixed");
    expect(online.result.summary.coverage).toBeGreaterThan(0.95);

    const offline = await runTerrainAnalysis({ sources: { ign: false }, points: track, store, allowNetwork: false, fetchImpl: vi.fn() });
    expect(offline.result.summary.distancesM).toEqual(online.result.summary.distancesM);
    expect(planTerrainCells(track).count).toBe(online.cellCounts.total);
  });

  it("erreur réseau totale : analyse « indéterminée » mais sans exception, erreurs rapportées", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const r = await runTerrainAnalysis({ sources: { ign: false }, points: makeTrack({ toM: 1000 }), store: memoryStore(), allowNetwork: true, fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    expect(r.status).toBe("done");
    expect(r.cellCounts.error).toBeGreaterThan(0);
    expect(r.result.summary.type).toBe("unknown");
    expect(r.result.difficulty.status).toBe("insufficient");
  });

  it("service indisponible sur un long tracé : zones différées comptées parmi les manquantes, unavailable, analyse sans exception", async () => {
    const points = makeTrack({ toM: 15000, stepM: 50 });
    const total = planTerrainCells(points).count;
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null } }));
    const r = await runTerrainAnalysis({ sources: { ign: false }, cellsPerRequest: 1, points, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    expect(r.status).toBe("done");
    expect(r.load.unavailable).toBe(true);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
    expect(r.cellCounts).toMatchObject({ total, available: 0, error: 2, deferred: total - 2, missing: total - 2 });
    expect(r.result.summary.type).toBe("unknown");
  });

  it("analyzeTerrain ne modifie pas les points GPS d'origine", () => {
    const track = makeTrack({ toM: 500 });
    const snapshot = JSON.stringify(track);
    analyzeTerrain(track, [makeWay(1, PATH, { toM: 500 })]);
    expect(JSON.stringify(track)).toBe(snapshot);
  });
});

describe("audit — calcul exact de la difficulté (valeurs vérifiées à la main)", () => {
  const seg = (len, category, tags, grade = null, heading = 90) => ({ len, category, way: { tags }, grade, heading });
  const many = (n, len, category, tags, grade) => Array.from({ length: n }, () => seg(len, category, tags, grade));

  it("sentier mtb:scale 2 + smoothness bad, 3 km à 12 % : terrain 59 + pente 15 + virages 0 = 74", () => {
    const segs = many(120, 25, "trail", { highway: "path", "mtb:scale": "2", smoothness: "bad" }, 12);
    const d = estimateDifficulty(segs, { coverage: 1, classifiedM: 3000 });
    expect(d.components).toEqual({ terrain: 59, slope: 15, turns: 0 });
    expect(d.score).toBe(74);
    expect(d.level).toBe("hard");
  });

  it("2 km de sentier sans tag + 2 km de piste grade3, sans altitude : terrain (25×2+14×2)/4 = 19,5 → 20, confiance moyenne et facteur « altitude absente »", () => {
    const segs = [...many(80, 25, "trail", { highway: "path" }, null), ...many(80, 25, "track", { highway: "track", tracktype: "grade3" }, null)];
    const d = estimateDifficulty(segs, { coverage: 1, classifiedM: 4000 });
    expect(d.components.terrain).toBe(19.5);
    expect(d.components.slope).toBe(0);
    expect(d.score).toBe(20);
    expect(d.confidence.label).toBe("medium");
    expect(d.factors.some((f) => f.key === "no_elevation")).toBe(true);
  });

  it("pas de double comptage : mtb:scale:uphill ignoré, smoothness+surface = max, mtb+sac = max", () => {
    expect(segmentTechnicalPoints("trail", { highway: "path", "mtb:scale:uphill": "5" })).toBe(25);
    expect(segmentTechnicalPoints("trail", { highway: "path", smoothness: "bad", surface: "sand" })).toBe(35); // 25 + max(10, 8)
    expect(segmentTechnicalPoints("trail", { highway: "path", "mtb:scale": "1", sac_scale: "mountain_hiking" })).toBe(39); // 25 + max(14, 8)
  });

  it("un sentier dont le seul tag est `surface` n'a pas de confiance élevée (richesse 0)", () => {
    const segs = many(80, 25, "trail", { highway: "path", surface: "dirt" }, 3);
    const d = estimateDifficulty(segs, { coverage: 1, classifiedM: 2000 });
    expect(d.confidence.tagRichness).toBe(0);
    expect(d.confidence.label).toBe("low");
  });

  it("frontière : 999 m hors-route → non applicable ; 1000 m (20 % du classé) → note calculée", () => {
    const road = (m) => many(m / 25, 25, "road", { highway: "residential" });
    const off = (m) => many(m / 25, 25, "trail", { highway: "path" });
    expect(estimateDifficulty([...off(975), ...road(4000)], { coverage: 1, classifiedM: 4975 }).status).toBe("not_applicable");
    expect(estimateDifficulty([...off(1000), ...road(4000)], { coverage: 1, classifiedM: 5000 }).status).toBe("ok");
    expect(estimateDifficulty([...off(1000), ...road(4025)], { coverage: 1, classifiedM: 5025 }).status).toBe("not_applicable"); // < 20 %
  });

  it("trottoirs, passages piétons, escaliers et footway sans surface ne deviennent pas des sentiers", () => {
    expect(classifyWay({ highway: "footway", footway: "sidewalk" })).toBeNull();
    expect(classifyWay({ highway: "footway", footway: "crossing", surface: "dirt" })).toBeNull();
    expect(classifyWay({ highway: "steps" })).toBeNull();
    expect(classifyWay({ highway: "footway" })).toBeNull();
    expect(classifyWay({ highway: "footway", surface: "ground" })).toBe("trail");
  });
});
