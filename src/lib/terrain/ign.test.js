/**
 * Source IGN BD TOPO : conversion des champs, couverture, chargement (cache, concurrence, erreurs, pagination).
 * Conversion validée sur des ÉCHANTILLONS RÉELS de la Géoplateforme (tests/ign-real-samples.json : Guadeloupe, Alpes, Paris,
 * relevés le 2026-10-10). Le réseau est entièrement simulé : aucun test n'interroge un vrai serveur.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertIgnFeature, parseIgnResponse, ignHighway, ignWayId, IGN_NATURE_TO_HIGHWAY } from "./ignConvert.js";
import { classifyWay } from "./classify.js";
import { isIgnEligible, ignRegionForCell, IGN_REGIONS } from "./coverage.js";
import { cellKey, cellBounds } from "./geo.js";
import {
  loadIgnCells, buildIgnUrl, ignCacheKey, IGN_WFS_URL, IGN_LAYER, IGN_PROPERTIES, IGN_CONCURRENCY, IGN_MAX_FAILED_CELLS,
  IGN_CACHE_TTL_MS, IGN_REQUEST_TIMEOUT_MS, IGN_PAGE_SIZE, IGN_MAX_PAGES, IGN_ATTRIBUTION,
} from "./ign.js";
import { MAX_NETWORK_CELLS } from "./osm.js";
import { memoryStore } from "./store.js";

const SAMPLES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "tests", "ign-real-samples.json"), "utf8")).samples;
const noSleep = async () => {};
const feat = (nature, { cleabs, urbain = false, coords = [[5.78, 45.34], [5.781, 45.341]], fictif = false, etat = "En service", type = "LineString" } = {}) => ({
  type: "Feature", id: "troncon_de_route.1", geometry: { type, coordinates: coords },
  properties: { cleabs: cleabs || "TRONROUT0000000000000001", nature, urbain, fictif, etat_de_l_objet: etat },
});
const ok = (features, extra = {}) => ({ ok: true, status: 200, json: async () => ({ type: "FeatureCollection", features, numberMatched: features.length, ...extra }) });
const failing = (status) => vi.fn(async () => ({ ok: false, status, json: async () => ({}) }));
const keysN = (n) => Array.from({ length: n }, (_, i) => `2250:${290 + i}`);
const load = (over) => loadIgnCells({ cellKeys: keysN(3), store: memoryStore(), allowNetwork: true, sleep: noSleep, minIntervalMs: 0, ...over });

describe("conversion des champs IGN (échantillons réels)", () => {
  const allWays = Object.values(SAMPLES).flatMap((s) => parseIgnResponse({ features: s.features, numberMatched: s.features.length }).ways);

  it("les échantillons contiennent bien les natures réellement observées", () => {
    const natures = new Set(Object.values(SAMPLES).flatMap((s) => Object.keys(s.natures)));
    for (const n of ["Route à 1 chaussée", "Route à 2 chaussées", "Rond-point", "Route empierrée", "Chemin", "Sentier", "Escalier"]) expect(natures.has(n), n).toBe(true);
  });

  it("convertit [lon, lat, altitude] en [lat, lon] arrondis à 5 décimales, sans altitude", () => {
    const r = convertIgnFeature(feat("Chemin", { coords: [[-61.634901142, 16.204400591, 60.8], [-61.6351, 16.2046, 61.2]] }));
    expect(r.ways).toHaveLength(1);
    expect(r.ways[0].geom).toEqual([[16.2044, -61.63490], [16.2046, -61.6351]]);
    expect(r.ways[0].geom.every((p) => p.length === 2)).toBe(true);
  });

  it("table nature → highway : voies de circulation « road », chemin « track », sentier « path », piste cyclable « cycleway »", () => {
    expect(ignHighway("Route à 1 chaussée", false)).toBe("road");
    expect(ignHighway("Route à 2 chaussées", false)).toBe("road");
    expect(ignHighway("Rond-point", false)).toBe("road");
    expect(ignHighway("Route empierrée", false)).toBe("road");
    expect(ignHighway("Chemin", false)).toBe("track");
    expect(ignHighway("Sentier", false)).toBe("path");
    expect(ignHighway("Piste cyclable", false)).toBe("cycleway");
    expect(ignHighway("Escalier", false)).toBe("steps");
    expect(ignHighway("Autoroute", false)).toBe("motorway");
    expect(ignHighway("Bac ou liaison maritime", false)).toBeNull();
    expect(ignHighway("Nature inconnue", false)).toBeUndefined();
    expect(Object.keys(IGN_NATURE_TO_HIGHWAY)).toContain("Route empierrée");
  });

  it("un « Sentier » en zone urbaine est un cheminement piéton : footway (non classé), jamais un sentier VTT", () => {
    expect(ignHighway("Sentier", true)).toBe("footway");
    const paris = parseIgnResponse({ features: SAMPLES.paris.features, numberMatched: 18 }).ways;
    const sentiers = paris.filter((w) => w.tags["ign:nature"] === "Sentier");
    expect(sentiers.length).toBeGreaterThan(0);
    expect(sentiers.every((w) => w.tags.highway === "footway" && classifyWay(w.tags) === null)).toBe(true);
  });

  it("NE FABRIQUE AUCUN tag absent de la source : jamais surface, smoothness, tracktype, mtb:scale, sac_scale, trail_visibility", () => {
    expect(allWays.length).toBeGreaterThan(30);
    for (const w of allWays) {
      expect(Object.keys(w.tags).sort()).toEqual(["highway", "ign:nature"]);
      for (const forbidden of ["surface", "smoothness", "tracktype", "mtb:scale", "sac_scale", "trail_visibility"]) expect(w.tags[forbidden]).toBeUndefined();
      expect(w.src).toBe("ign");
    }
  });

  it("classement des natures IGN réelles : route, piste (chemin, route empierrée), sentier ; escalier ignoré", () => {
    const cls = (nature, urbain = false) => classifyWay(convertIgnFeature(feat(nature, { urbain })).ways[0]?.tags || {});
    expect(cls("Route à 1 chaussée")).toBe("road");
    expect(cls("Rond-point")).toBe("road");
    expect(cls("Chemin")).toBe("track");
    expect(cls("Route empierrée")).toBe("track");
    expect(cls("Sentier", false)).toBe("trail");
    expect(cls("Sentier", true)).toBeNull();
    expect(cls("Escalier")).toBeNull();
    expect(cls("Piste cyclable")).toBe("road");
  });

  it("une surface OpenStreetMap explicite l'emporte sur l'interprétation de « Route empierrée »", () => {
    const base = convertIgnFeature(feat("Route empierrée")).ways[0].tags;
    expect(classifyWay(base)).toBe("track");
    expect(classifyWay({ ...base, surface: "asphalt" })).toBe("road");
    expect(classifyWay({ ...base, surface: "gravel" })).toBe("track");
  });

  it("identifiants : numériques négatifs (jamais en collision avec un id OSM), uniques, stables", () => {
    const ids = allWays.map((w) => w.id);
    expect(ids.every((id) => Number.isInteger(id) && id < 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ignWayId("TRONROUT0000001170141851")).toBe(ignWayId("TRONROUT0000001170141851"));
    expect(ignWayId("TRONROUT0000001170141851")).toBe(-11701418510);
    expect(ignWayId("")).toBeNull();
  });

  it("écarte et COMPTE ce qui n'est pas exploitable : fictif, hors service, nature inconnue, sans géométrie", () => {
    const r = parseIgnResponse({
      numberMatched: 6,
      features: [
        feat("Chemin", { fictif: true, cleabs: "T1" }), feat("Chemin", { etat: "En projet", cleabs: "T2" }),
        feat("Chemin d'un autre monde", { cleabs: "T3" }), feat("Bac ou liaison maritime", { cleabs: "T4" }),
        { ...feat("Chemin", { cleabs: "T5" }), geometry: null }, feat("Chemin", { cleabs: "T6" }),
      ],
    });
    expect(r.ways).toHaveLength(1);
    expect(r.dropped.fictif).toBe(1);
    expect(r.dropped.inactive).toBe(1);
    expect(r.dropped.nature).toEqual({ "Chemin d'un autre monde": 1, "Bac ou liaison maritime": 1 });
    expect(r.dropped.geometry).toBe(1);
  });

  it("MultiLineString : une voie par partie, identifiants distincts", () => {
    const r = convertIgnFeature(feat("Sentier", { type: "MultiLineString", coords: [[[5.1, 45.1], [5.2, 45.2]], [[5.3, 45.3], [5.4, 45.4]]] }));
    expect(r.ways).toHaveLength(2);
    expect(new Set(r.ways.map((w) => w.id)).size).toBe(2);
  });

  it("réponse inattendue : erreur explicite (jamais de donnée inventée)", () => {
    expect(() => parseIgnResponse({ remark: "ExceptionReport" })).toThrow(/IGN/);
    expect(() => parseIgnResponse(null)).toThrow();
  });

  it("numberMatched est lu pour détecter une troncature", () => {
    expect(parseIgnResponse({ features: [feat("Chemin")], numberMatched: 9 })).toMatchObject({ matched: 9, returned: 1 });
  });
});

describe("couverture géographique IGN — filtre grossier, jamais une preuve de couverture", () => {
  const cell = (lat, lon) => cellKey(lat, lon);
  it("territoires couverts : métropole, Corse, Guadeloupe, Réunion, Martinique, Guyane, Mayotte", () => {
    for (const [label, lat, lon] of [["Alpes", 45.35, 5.77], ["Paris", 48.85, 2.34], ["Corse", 42.16, 9.11], ["Guadeloupe", 16.19, -61.65], ["Réunion", -21.14, 55.51], ["Martinique", 14.6, -61.05], ["Guyane", 4.0, -52.8], ["Mayotte", -12.8, 45.17]]) {
      expect(isIgnEligible(cell(lat, lon)), label).toBe(true);
    }
    expect(ignRegionForCell(cell(16.19, -61.65))).toMatchObject({ id: "guadeloupe", label: "Guadeloupe" });
    expect(IGN_REGIONS.map((r) => r.id)).toEqual(["metropole", "guadeloupe", "martinique", "guyane", "reunion", "mayotte"]);
  });

  it("hors territoire : Londres, Lisbonne, Montréal, Tokyo, Casablanca ne sont PAS présentés comme couverts par l'IGN", () => {
    for (const [label, lat, lon] of [["Londres", 51.5, -0.12], ["Lisbonne", 38.72, -9.14], ["Montréal", 45.5, -73.57], ["Tokyo", 35.68, 139.69], ["Casablanca", 33.57, -7.59], ["Guadeloupe hors boîte", 17.5, -62.0]]) {
      expect(isIgnEligible(cell(lat, lon)), label).toBe(false);
    }
  });

  it("la boîte métropolitaine déborde sur des pays voisins : la couverture réelle vient de la réponse (zone « empty »)", async () => {
    const barcelone = cell(41.39, 2.17); // dans la boîte, mais pas en France : l'IGN renverra 0 tronçon
    expect(isIgnEligible(barcelone)).toBe(true);
    const fetchImpl = vi.fn(async () => ok([]));
    const r = await loadIgnCells({ cellKeys: [barcelone], store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(r.cells[barcelone]).toBe("network");
    expect(r.empty[barcelone]).toBe(true); // jamais présenté comme couvert
    expect(r.ways).toEqual([]);
  });
});

describe("requête IGN — confidentialité et forme", () => {
  const key = cell0();
  function cell0() { return cellKey(16.19, -61.65); }

  it("l'URL ne contient que les 4 bornes de la zone fixe et les paramètres WFS : aucune coordonnée du tracé", () => {
    const url = buildIgnUrl(key);
    const decoded = decodeURIComponent(url);
    expect(url.startsWith(IGN_WFS_URL)).toBe(true);
    expect(decoded).toContain(`TYPENAMES=${IGN_LAYER}`);
    expect(decoded).toContain(`PROPERTYNAME=${IGN_PROPERTIES.join(",")}`);
    expect(decoded).toContain("SORTBY=cleabs");
    const b = cellBounds(key);
    const nums = decoded.match(/BBOX=([^&]+)/)[1].split(",urn:")[0].split(",").map(Number);
    expect(nums).toEqual([b.south, b.west, b.north, b.east].map((v) => Number(v.toFixed(5))));
    expect(decoded.match(/-?\d+\.\d{5}/g)).toHaveLength(4); // aucun autre nombre géographique
    expect(decoded).not.toMatch(/gpx|\.fit|heart|power|timestamp|athlete|activity/i);
  });

  it("requête GET simple : aucun corps, aucun en-tête personnalisé, aucun cookie", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await loadIgnCells({ cellKeys: [key], store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.startsWith(IGN_WFS_URL)).toBe(true);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBeUndefined();
  });

  it("paramètres de page : COUNT et STARTINDEX", () => {
    expect(decodeURIComponent(buildIgnUrl(key))).toContain(`COUNT=${IGN_PAGE_SIZE}`);
    expect(buildIgnUrl(key)).not.toContain("STARTINDEX");
    expect(buildIgnUrl(key, 5000)).toContain("STARTINDEX=5000");
  });

  it("l'attribution IGN est définie", () => {
    expect(IGN_ATTRIBUTION).toMatch(/IGN/);
    expect(IGN_ATTRIBUTION).toMatch(/BD TOPO/);
    expect(IGN_ATTRIBUTION).toMatch(/Licence Ouverte/);
  });
});

describe("chargement IGN — cache", () => {
  it("sans consentement : aucune requête ; le cache est utilisé, le reste « missing »", async () => {
    const store = memoryStore({ [ignCacheKey("2250:290")]: { fetchedAt: Date.now(), ways: [{ id: -1, tags: { highway: "track" }, geom: [[45, 5], [45.1, 5.1]], src: "ign" }] } });
    const fetchImpl = vi.fn();
    const r = await load({ fetchImpl, store, allowNetwork: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.cells).toEqual({ "2250:290": "cache", "2250:291": "missing", "2250:292": "missing" });
    expect(r.ways).toHaveLength(1);
  });

  it("avec consentement : télécharge les zones absentes, les met en cache sous `ign:<zone>`, ne les redemande pas", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ok([feat("Chemin")]));
    const r1 = await load({ fetchImpl, store });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(Object.values(r1.cells)).toEqual(["network", "network", "network"]);
    expect(await store.get(ignCacheKey("2250:290"))).toMatchObject({ ways: expect.any(Array), matched: 1, truncated: false });
    const r2 = await load({ fetchImpl, store });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(Object.values(r2.cells)).toEqual(["cache", "cache", "cache"]);
    expect(r2.requests).toBe(0);
  });

  it("le cache IGN est distinct du cache OpenStreetMap (préfixe `ign:`)", async () => {
    const store = memoryStore({ "2250:290": { fetchedAt: Date.now(), ways: [{ id: 5, tags: { highway: "path" }, geom: [[45, 5], [45.1, 5.1]] }] } });
    const fetchImpl = vi.fn(async () => ok([]));
    await load({ fetchImpl, store, cellKeys: ["2250:290"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // le cache OSM de la même zone ne dispense pas de la requête IGN
  });

  it("cache périmé (> 90 jours) : redemandé ; si le réseau échoue, l'ancienne copie est conservée (« stale »)", async () => {
    const old = { fetchedAt: Date.now() - IGN_CACHE_TTL_MS - 1000, ways: [{ id: -9, tags: { highway: "track" }, geom: [[45, 5], [45.1, 5.1]], src: "ign" }] };
    const store = memoryStore({ [ignCacheKey("2250:290")]: old });
    const r = await load({ fetchImpl: failing(503), store, cellKeys: ["2250:290"] });
    expect(r.cells["2250:290"]).toBe("stale");
    expect(r.ways).toHaveLength(1);
  });

  it("cache périmé hors consentement : utilisé tel quel, aucune requête", async () => {
    const store = memoryStore({ [ignCacheKey("2250:290")]: { fetchedAt: 0, ways: [{ id: -9, tags: { highway: "track" }, geom: [[45, 5], [45.1, 5.1]] }] } });
    const fetchImpl = vi.fn();
    const r = await load({ fetchImpl, store, allowNetwork: false, cellKeys: ["2250:290"] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.cells["2250:290"]).toBe("stale");
  });

  it("une zone vide est mise en cache comme vide (pas redemandée) et signalée", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ok([]));
    const r1 = await load({ fetchImpl, store, cellKeys: ["2250:290"] });
    expect(r1.empty["2250:290"]).toBe(true);
    const r2 = await load({ fetchImpl, store, cellKeys: ["2250:290"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r2.empty["2250:290"]).toBe(true);
  });

  it("dédoublonne : un tronçon renvoyé par deux zones voisines n'est gardé qu'une fois", async () => {
    const fetchImpl = vi.fn(async () => ok([feat("Chemin", { cleabs: "TRONROUT0000000000000042" })]));
    const r = await load({ fetchImpl });
    expect(r.ways).toHaveLength(1);
  });

  it("tracé trop étendu : aucune requête, « tooLarge »", async () => {
    const keys = Array.from({ length: MAX_NETWORK_CELLS + 1 }, (_, i) => `2250:${i}`);
    const fetchImpl = vi.fn();
    const r = await load({ fetchImpl, cellKeys: keys });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.tooLarge).toBe(true);
    expect(Object.values(r.cells).every((s) => s === "missing")).toBe(true);
  });
});

describe("chargement IGN — concurrence, délais et erreurs réseau", () => {
  it("concurrence bornée : jamais plus de IGN_CONCURRENCY requêtes simultanées", async () => {
    let inflight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return ok([]);
    });
    await load({ fetchImpl, cellKeys: keysN(8) });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(peak).toBeLessThanOrEqual(IGN_CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // la concurrence est réellement utilisée
  });

  it("espace les départs d'au moins minIntervalMs : créneaux successifs séparés de 250 ms", async () => {
    const sleep = vi.fn(async () => {}); // l'horloge n'avance pas : les attentes cumulées révèlent les créneaux
    await loadIgnCells({ cellKeys: keysN(4), store: memoryStore(), allowNetwork: true, fetchImpl: vi.fn(async () => ok([])), sleep, minIntervalMs: 250, concurrency: 1 });
    const waits = sleep.mock.calls.map(([ms]) => ms);
    expect(waits).toHaveLength(3); // la première zone part sans attente
    waits.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(250 * (i + 1) - 5));
    expect(waits[2] - waits[0]).toBeGreaterThanOrEqual(2 * 250 - 10);
  });

  it("HTTP 429 : arrêt IMMÉDIAT, zones restantes différées, rateLimited, aucun nouvel essai", async () => {
    const fetchImpl = failing(429);
    const r = await load({ fetchImpl, cellKeys: keysN(10), concurrency: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.rateLimited).toBe(true);
    expect(r.unavailable).toBe(true);
    expect(Object.values(r.cells).filter((s) => s === "error")).toHaveLength(1);
    expect(Object.values(r.cells).filter((s) => s === "deferred")).toHaveLength(9);
  });

  for (const status of [500, 502, 503, 504, 400, 403]) {
    it(`HTTP ${status} sur deux zones consécutives : disjoncteur, zones restantes différées, aucune exception`, async () => {
      const fetchImpl = failing(status);
      const r = await load({ fetchImpl, cellKeys: keysN(8), concurrency: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(IGN_MAX_FAILED_CELLS);
      expect(r.unavailable).toBe(true);
      expect(r.rateLimited).toBe(false);
      expect(Object.values(r.cells).filter((s) => s === "deferred")).toHaveLength(6);
      expect(r.errors).toHaveLength(2);
    });
  }

  it("erreur réseau (TypeError) et réponse illisible (XML) : zone en erreur, jamais de donnée inventée", async () => {
    const net = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const xml = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
    for (const fetchImpl of [net, xml]) {
      const r = await load({ fetchImpl, cellKeys: ["2250:290"] });
      expect(r.cells["2250:290"]).toBe("error");
      expect(r.ways).toEqual([]);
      expect(r.errors).toHaveLength(1);
    }
    const bad = vi.fn(async () => ok(null, { features: undefined }));
    expect((await load({ fetchImpl: bad, cellKeys: ["2250:290"] })).cells["2250:290"]).toBe("error");
  });

  it("délai dépassé : la requête est interrompue après IGN_REQUEST_TIMEOUT_MS, la zone passe en erreur", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((url, init) => new Promise((_, reject) => { init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); }); }));
      const pending = load({ fetchImpl, cellKeys: ["2250:290"] });
      await vi.advanceTimersByTimeAsync(IGN_REQUEST_TIMEOUT_MS + 10);
      const r = await pending;
      expect(r.cells["2250:290"]).toBe("error");
      expect(r.errors[0]).toMatch(/Délai dépassé/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un échec isolé n'interrompt pas les autres zones", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => { n += 1; return n === 1 ? { ok: false, status: 503 } : ok([feat("Chemin", { cleabs: `TRONROUT00000000000000${n}` })]); });
    const r = await load({ fetchImpl, concurrency: 1 });
    expect(Object.values(r.cells)).toEqual(["error", "network", "network"]);
    expect(r.unavailable).toBe(false);
  });

  it("plafond de requêtes de l'exécution : le reste est différé (capped, pas unavailable)", async () => {
    const r = await load({ fetchImpl: vi.fn(async () => ok([])), cellKeys: keysN(6), maxRequests: 4, concurrency: 1 });
    expect(r.requests).toBe(4);
    expect(Object.values(r.cells).filter((s) => s === "deferred")).toHaveLength(2);
    expect(r.capped).toBe(true);
    expect(r.unavailable).toBe(false);
  });

  it("annulation : AbortError propagée", async () => {
    const fetchImpl = vi.fn(async () => { const e = new Error("abort"); e.name = "AbortError"; throw e; });
    await expect(load({ fetchImpl, cellKeys: ["2250:290"] })).rejects.toThrow("abort");
  });

  it("progression : une notification par zone, jusqu'au total", async () => {
    const seen = [];
    await load({ fetchImpl: vi.fn(async () => ok([])), concurrency: 1, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});

describe("chargement IGN — pagination", () => {
  const page = (n, matched) => ok(Array.from({ length: n }, (_, i) => feat("Chemin", { cleabs: `TRONROUT${String(Math.random()).slice(2, 14).padEnd(12, "0")}${i}` })), { numberMatched: matched });

  it("zone dépassant une page : pages suivantes demandées avec STARTINDEX, sans dépasser le plafond de pages", async () => {
    const sizes = [5, 5, 2];
    let call = 0;
    const urls = [];
    const fetchImpl = vi.fn(async (url) => { urls.push(url); return page(sizes[call++], 12); });
    const r = await load({ fetchImpl, cellKeys: ["2250:290"] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(urls.map((u) => (u.match(/STARTINDEX=(\d+)/) || [0, "0"])[1])).toEqual(["0", "5", "10"]);
    expect(r.requests).toBe(3);
    expect(r.meta.truncatedCells).toEqual([]);
  });

  it("troncature : au-delà de IGN_MAX_PAGES pages, la zone est signalée « tronquée » (jamais présentée comme complète)", async () => {
    const fetchImpl = vi.fn(async () => page(5, 50));
    const r = await load({ fetchImpl, cellKeys: ["2250:290"] });
    expect(fetchImpl).toHaveBeenCalledTimes(IGN_MAX_PAGES);
    expect(r.meta.truncatedCells).toEqual(["2250:290"]);
  });
});

describe("mention de la source IGN : date de dernière modification des tronçons", () => {
  const dated = (d, cleabs) => ({ ...feat("Chemin", { cleabs }), properties: { ...feat("Chemin", { cleabs }).properties, date_modification: d } });
  it("la date la plus récente des tronçons est relevée, mise en cache et restituée (aussi depuis le cache)", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => ok([dated("2023-08-22T17:03:13.445Z", "TRONROUT0000000000000011"), dated("2025-12-15T08:00:00.000Z", "TRONROUT0000000000000012"), dated("2021-01-01T00:00:00Z", "TRONROUT0000000000000013")]));
    const r1 = await load({ fetchImpl, store, cellKeys: ["2250:290"] });
    expect(r1.meta.latestModification).toBe("2025-12-15T08:00:00.000Z");
    const r2 = await load({ fetchImpl: vi.fn(), store, allowNetwork: false, cellKeys: ["2250:290"] });
    expect(r2.meta.latestModification).toBe("2025-12-15T08:00:00.000Z");
  });
  it("le champ date_modification est demandé à l'IGN ; son absence ne casse rien", async () => {
    expect(IGN_PROPERTIES).toContain("date_modification");
    const r = await load({ fetchImpl: vi.fn(async () => ok([feat("Chemin")])), cellKeys: ["2250:290"] });
    expect(r.meta.latestModification).toBeNull();
  });
});
