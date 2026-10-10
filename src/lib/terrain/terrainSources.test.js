/**
 * IGN (principal) + OpenStreetMap (complément) : fusion sans double comptage, provenance, secours, hors France, cache.
 * Réseau entièrement simulé : un routeur répond au WFS IGN (GET) et à Overpass (POST) selon l'URL.
 */
import { describe, it, expect, vi } from "vitest";

import { mergeSources, ENRICH_KEYS } from "./merge.js";
import { runTerrainAnalysis, planTerrainCells, analyzeTerrain } from "./index.js";
import { IGN_WFS_URL } from "./ign.js";
import { cellKey } from "./geo.js";
import { memoryStore } from "./store.js";
import { classifyWay } from "./classify.js";
import { makeTrack, makeWay, overpassResponse, lonAt } from "./tests/fixtures.js";

const noSleep = async () => {};
const ROAD = { highway: "residential", surface: "asphalt" };

/** Voie OSM de tests → tronçon IGN GeoJSON ([lon, lat, altitude]). */
let seq = 0;
function ignFeature(way, nature, { urbain = false } = {}) {
  seq += 1;
  return {
    type: "Feature", id: `troncon_de_route.${seq}`,
    geometry: { type: "LineString", coordinates: way.geom.map(([lat, lon]) => [lon, lat, 0]) },
    properties: { cleabs: `TRONROUT${String(1000000 + seq).padStart(16, "0")}`, nature, urbain, fictif: false, etat_de_l_objet: "En service" },
  };
}
const ign = (...entries) => entries.map(([fromM, toM, nature, opts]) => ignFeature(makeWay(0, {}, { fromM, toM }), nature, opts));
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const wfs = (features) => ok({ type: "FeatureCollection", features, numberMatched: features.length });
const down = (status) => ({ ok: false, status, headers: { get: () => null } });

/** Routeur : GET → IGN, POST → Overpass ; compte les appels par service. */
function router({ ignHandler, osmHandler }) {
  const calls = { ign: 0, osm: 0, urls: [], bodies: [] };
  const fetchImpl = vi.fn(async (url, init) => {
    if (String(url).startsWith(IGN_WFS_URL)) { calls.ign += 1; calls.urls.push(String(url)); return ignHandler(url); }
    calls.osm += 1;
    calls.bodies.push(decodeURIComponent((init && init.body) || ""));
    return osmHandler(url, init);
  });
  return { fetchImpl, calls };
}
const osmOk = (ways) => () => ok(overpassResponse(ways));
const ignOk = (features) => () => wfs(features);

const TRACK = makeTrack({ toM: 3000, grade: 8 });
const IGN_MIXED = ign([0, 1000, "Route à 1 chaussée"], [1000, 2000, "Chemin"], [2000, 3000, "Sentier"]);
const OSM_ENRICH = [
  makeWay(7001, { highway: "path", "mtb:scale": "2", smoothness: "bad", surface: "dirt" }, { fromM: 2000, toM: 3000, offsetM: 3 }),
  makeWay(7002, { highway: "track", tracktype: "grade3", surface: "gravel" }, { fromM: 1000, toM: 2000, offsetM: 2 }),
];
const analyze = (over) => runTerrainAnalysis({ points: TRACK, store: memoryStore(), allowNetwork: true, sleep: noSleep, minIntervalMs: 0, ...over });
const km = (r) => Object.fromEntries(Object.entries(r.result.summary.distancesM).map(([k, v]) => [k, Math.round(v / 100) / 10]));

describe("mergeSources — fusion sans double comptage", () => {
  const ignWays = [
    { id: -1, tags: { highway: "track", "ign:nature": "Chemin" }, geom: makeWay(0, {}, { fromM: 0, toM: 1000 }).geom, src: "ign" },
    { id: -2, tags: { highway: "path", "ign:nature": "Sentier" }, geom: makeWay(0, {}, { fromM: 1000, toM: 2000 }).geom, src: "ign" },
  ];

  it("sans OSM : les chemins IGN sont renvoyés tels quels ; sans IGN : OSM seul, marqué src « osm »", () => {
    expect(mergeSources(ignWays, []).ways).toBe(ignWays);
    const only = mergeSources([], [makeWay(5, ROAD)]);
    expect(only.ways[0].src).toBe("osm");
    expect(only.stats.osmOnly).toBe(1);
  });

  it("un chemin OSM sur le même tracé qu'un tronçon IGN = même voie : il l'enrichit et n'est PAS ajouté", () => {
    const osm = [makeWay(10, { highway: "track", tracktype: "grade2", surface: "gravel", name: "x" }, { fromM: 0, toM: 1000, offsetM: 4 })];
    const r = mergeSources(ignWays, osm);
    expect(r.ways).toHaveLength(2);
    expect(r.stats).toMatchObject({ osmDuplicates: 1, osmOnly: 0, enrichedWays: 1 });
    const enriched = r.ways.find((w) => w.id === -1);
    expect(enriched.tags).toMatchObject({ highway: "track", "ign:nature": "Chemin", tracktype: "grade2", surface: "gravel" });
    expect(enriched.tags.name).toBeUndefined(); // seuls surface et technicité sont copiés
    expect(enriched.enrichedKeys.sort()).toEqual(["surface", "tracktype"]);
    expect(enriched.enrichedBy).toEqual([10]);
  });

  it("seuls les tags de surface et de technicité sont copiés (ENRICH_KEYS) ; highway et name restent ceux de l'IGN", () => {
    expect(ENRICH_KEYS).toEqual(["surface", "tracktype", "smoothness", "sac_scale", "trail_visibility", "mtb:scale", "mtb:scale:uphill"]);
    const osm = [makeWay(11, { highway: "path", "mtb:scale": "3", smoothness: "horrible", sac_scale: "hiking", trail_visibility: "bad", bicycle: "yes" }, { fromM: 1000, toM: 2000, offsetM: 1 })];
    const w = mergeSources(ignWays, osm).ways.find((x) => x.id === -2);
    expect(w.tags.highway).toBe("path");
    expect(w.tags).toMatchObject({ "mtb:scale": "3", smoothness: "horrible", sac_scale: "hiking", trail_visibility: "bad" });
    expect(w.tags.bicycle).toBeUndefined();
  });

  it("un chemin OSM sans équivalent IGN (voie absente de la BD TOPO) est conservé tel quel", () => {
    const osm = [makeWay(12, { highway: "path" }, { fromM: 2000, toM: 2800 })];
    const r = mergeSources(ignWays, osm);
    expect(r.ways).toHaveLength(3);
    expect(r.ways[2]).toMatchObject({ id: 12, src: "osm" });
    expect(r.stats.osmOnly).toBe(1);
  });

  it("seuil de recouvrement : moins de 60 % des points proches d'un tronçon IGN → voie distincte", () => {
    const partial = makeWay(13, { highway: "track", surface: "gravel" }, { fromM: 500, toM: 1900 }); // ~1/3 sur le tronçon IGN -1, le reste en hors tronçon proche
    const r = mergeSources([ignWays[0]], [partial]);
    expect(r.stats.osmOnly + r.stats.osmDuplicates).toBe(1);
    expect(r.stats.osmOnly).toBe(1);
  });

  it("n'altère jamais ses entrées (les caches restent intacts) : les voies enrichies sont des copies", () => {
    const before = JSON.stringify(ignWays);
    const osm = [makeWay(14, { highway: "track", surface: "gravel" }, { fromM: 0, toM: 1000, offsetM: 2 })];
    const osmBefore = JSON.stringify(osm);
    const r = mergeSources(ignWays, osm);
    expect(JSON.stringify(ignWays)).toBe(before);
    expect(JSON.stringify(osm)).toBe(osmBefore);
    expect(r.ways.find((w) => w.id === -1)).not.toBe(ignWays[0]);
  });

  it("deux chemins OSM contradictoires sur le même tronçon : le premier (id le plus bas) est retenu, le conflit est compté", () => {
    const osm = [
      makeWay(21, { highway: "track", surface: "gravel" }, { fromM: 0, toM: 1000, offsetM: 1 }),
      makeWay(22, { highway: "track", surface: "sand" }, { fromM: 0, toM: 1000, offsetM: 2 }),
    ];
    const r = mergeSources(ignWays, osm);
    expect(r.ways.find((w) => w.id === -1).tags.surface).toBe("gravel");
    expect(r.stats.conflicts).toBe(1);
  });

  it("surface OSM revêtue sur un « Chemin » IGN : OpenStreetMap, donnée observée, l'emporte au classement", () => {
    const r = mergeSources(ignWays, [makeWay(15, { highway: "track", surface: "asphalt" }, { fromM: 0, toM: 1000, offsetM: 1 })]);
    expect(classifyWay(r.ways.find((w) => w.id === -1).tags)).toBe("road");
  });
});

describe("runTerrainAnalysis — IGN principal, OSM en complément", () => {
  it("IGN seul : route / piste / sentier, couverture complète, AUCUN tag technique, confiance faible — rapportés séparément", async () => {
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk([]) });
    const r = await analyze({ fetchImpl, sources: { osmEnrichment: "off" } });
    expect(calls.osm).toBe(0);
    expect(km(r)).toMatchObject({ road: 1, track: 1, trail: 1, unclassified: 0 });
    expect(r.result.summary.type).toBe("mixed");
    const p = r.result.provenance;
    expect(p.matchedM.ign).toBeGreaterThan(2900);
    expect(p.matchedM.osm).toBe(0);
    expect(p.technicalM).toBe(0);
    expect(p.technicalShare).toBe(0);
    // la DIFFICULTÉ est une estimation : voies identifiées ≠ difficulté fiable
    expect(r.result.difficulty.status).toBe("ok");
    expect(r.result.difficulty.confidence.label).toBe("low");
    expect(r.result.difficulty.factors.some((f) => f.key === "sparse")).toBe(true);
    expect(r.sources.ign).toMatchObject({ eligibleCells: planTerrainCells(TRACK).count, loaded: planTerrainCells(TRACK).count });
  });

  it("avec le complément OSM : mêmes distances (pas de double comptage), tags techniques ajoutés, confiance relevée", async () => {
    const base = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk([]) });
    const without = await analyze({ fetchImpl: base.fetchImpl, sources: { osmEnrichment: "off" } });
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) });
    const withOsm = await analyze({ fetchImpl });
    expect(calls.osm).toBeGreaterThan(0);
    expect(withOsm.result.summary.distancesM.road).toBeCloseTo(without.result.summary.distancesM.road, 0);
    expect(withOsm.result.summary.distancesM.track).toBeCloseTo(without.result.summary.distancesM.track, 0);
    expect(withOsm.result.summary.distancesM.trail).toBeCloseTo(without.result.summary.distancesM.trail, 0);
    expect(withOsm.merge).toMatchObject({ osmDuplicates: 2, osmOnly: 0, enrichedWays: 2 });
    const p = withOsm.result.provenance;
    expect(p.technicalShare).toBeGreaterThan(0.95);
    expect(p.enrichedM).toBeGreaterThan(1900);
    expect(p.matchedM.osm).toBe(0); // toujours rattaché aux tronçons IGN : la source du chemin reste l'IGN
    expect(withOsm.result.difficulty.confidence.label).toBe("high");
    expect(withOsm.result.difficulty.score).toBeGreaterThan(without.result.difficulty.score);
  });

  it("OpenStreetMap comble un trou de l'IGN (voie absente de la BD TOPO) sans doubler le reste", async () => {
    const holey = ign([0, 1000, "Route à 1 chaussée"], [1000, 2000, "Chemin"], [2000, 2500, "Sentier"]);
    const osm = [makeWay(8001, { highway: "path", "mtb:scale": "1" }, { fromM: 2500, toM: 3000 }), ...OSM_ENRICH.slice(1)];
    const { fetchImpl } = router({ ignHandler: ignOk(holey), osmHandler: osmOk(osm) });
    const r = await analyze({ fetchImpl });
    expect(km(r)).toMatchObject({ road: 1, track: 1, trail: 1, unclassified: 0 });
    expect(r.result.provenance.matchedM.osm).toBeGreaterThan(450);
    expect(r.merge.osmOnly).toBe(1);
    const onlyIgn = await analyze({ fetchImpl: router({ ignHandler: ignOk(holey), osmHandler: osmOk([]) }).fetchImpl, sources: { osmEnrichment: "off" } });
    expect(onlyIgn.result.summary.coverage).toBeLessThan(0.9); // sans OSM, 500 m restent non classifiés
  });

  it("« Route empierrée » IGN : classée piste et rapportée à part ; une surface OSM revêtue la reclasse en route", async () => {
    const feats = ign([0, 3000, "Route empierrée"]);
    const plain = await analyze({ fetchImpl: router({ ignHandler: ignOk(feats), osmHandler: osmOk([]) }).fetchImpl, sources: { osmEnrichment: "off" } });
    expect(km(plain).track).toBe(3);
    expect(plain.result.provenance.ignEmpierreeM).toBeGreaterThan(2900);
    expect(plain.result.provenance.ignEmpierreeShare).toBeCloseTo(1, 1);

    const paved = await analyze({ fetchImpl: router({ ignHandler: ignOk(feats), osmHandler: osmOk([makeWay(9001, { highway: "residential", surface: "asphalt" }, { toM: 3000, offsetM: 2 })]) }).fetchImpl });
    expect(km(paved)).toMatchObject({ road: 3, track: 0 });
    expect(paved.result.provenance.ignEmpierreeM).toBe(0);
  });

  it("aucun tag n'est fabriqué : sans OSM, aucune voie de l'analyse ne porte surface, smoothness, mtb:scale…", async () => {
    const { fetchImpl } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk([]) });
    const store = memoryStore();
    await analyze({ fetchImpl, store, sources: { osmEnrichment: "off" } });
    for (const [key, record] of store._map) {
      if (!key.startsWith("ign:")) continue;
      for (const w of record.ways) for (const forbidden of ["surface", "smoothness", "tracktype", "mtb:scale", "sac_scale", "trail_visibility"]) expect(w.tags[forbidden]).toBeUndefined();
    }
  });

  it("un « Sentier » IGN en zone urbaine n'est pas compté comme sentier VTT", async () => {
    const urban = ign([0, 3000, "Sentier", { urbain: true }]);
    const { fetchImpl } = router({ ignHandler: ignOk(urban), osmHandler: osmOk([]) });
    const r = await analyze({ fetchImpl, sources: { osmEnrichment: "off" } });
    expect(km(r)).toMatchObject({ trail: 0, track: 0, road: 0, unclassified: 3 });
    expect(r.result.summary.type).toBe("unknown");
  });
});

describe("runTerrainAnalysis — hors France, zones vides, secours et pannes", () => {
  const lisbon = (toM = 3000) => makeTrack({ toM, grade: 4 }).map((p) => ({ ...p, lat: 38.72, lon: -9.14 + (p.lon - 6) }));
  const lisbonWays = [{ id: 31, tags: { highway: "residential", surface: "asphalt" }, geom: [[38.72, -9.14], [38.72, -9.12]] }];

  it("hors territoire IGN : l'IGN n'est JAMAIS interrogé ; OpenStreetMap est la source principale ; aucune couverture IGN annoncée", async () => {
    const points = lisbon();
    const { fetchImpl, calls } = router({ ignHandler: ignOk([]), osmHandler: osmOk(lisbonWays) });
    const r = await runTerrainAnalysis({ points, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(planTerrainCells(points)).toMatchObject({ ignCount: 0, osmOnlyCount: planTerrainCells(points).count });
    expect(calls.ign).toBe(0);
    expect(calls.osm).toBeGreaterThan(0);
    expect(r.sources.ign).toBeNull();
    expect(r.cellCounts.noIgnData).toBe(0);
    expect(r.result.provenance.matchedM.ign).toBe(0);
  });

  it("zone dans la boîte IGN mais sans aucun tronçon (Barcelone) : signalée « sans données IGN », OpenStreetMap en secours", async () => {
    const points = makeTrack({ toM: 800, grade: 2 }).map((p) => ({ ...p, lat: 41.39, lon: 2.17 + (p.lon - 6) }));
    const keys = planTerrainCells(points).cellKeys;
    expect(keys.every((k) => k)).toBe(true);
    const osm = [{ id: 41, tags: { highway: "residential" }, geom: [[41.39, 2.17], [41.39, 2.19]] }];
    const { fetchImpl, calls } = router({ ignHandler: ignOk([]), osmHandler: osmOk(osm) });
    const r = await runTerrainAnalysis({ points, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    expect(calls.ign).toBeGreaterThan(0);
    expect(calls.osm).toBeGreaterThan(0); // secours : sans données IGN, OSM devient la source
    expect(r.cellCounts.noIgnData).toBe(keys.length);
    expect(r.sources.ign.emptyCells).toBe(keys.length);
    expect(r.sources.ign.loaded).toBe(0); // jamais présenté comme couvert
    expect(r.result.provenance.matchedM.ign).toBe(0);
  });

  it("IGN en panne : OpenStreetMap prend le relais ; l'analyse aboutit et n'est pas déclarée indisponible", async () => {
    const { fetchImpl, calls } = router({ ignHandler: () => down(503), osmHandler: osmOk([makeWay(51, { highway: "track", tracktype: "grade2" }, { toM: 3000 })]) });
    const r = await analyze({ fetchImpl });
    expect(calls.ign).toBeGreaterThan(0);
    expect(calls.ign).toBeLessThanOrEqual(planTerrainCells(TRACK).count);
    expect(r.sources.ign.unavailable).toBe(true);
    expect(r.load.unavailable).toBe(false);
    expect(r.cellCounts.available).toBe(r.cellCounts.total);
    expect(km(r).track).toBe(3);
    expect(r.result.provenance.matchedM.osm).toBeGreaterThan(2900);
  });

  it("IGN et OpenStreetMap indisponibles : « indisponible », zones non classifiées, aucune exception, rien d'inventé", async () => {
    const { fetchImpl } = router({ ignHandler: () => down(503), osmHandler: () => down(503) });
    const r = await analyze({ fetchImpl });
    expect(r.status).toBe("done");
    expect(r.load.unavailable).toBe(true);
    expect(r.cellCounts.available).toBe(0);
    expect(r.result.summary.type).toBe("unknown");
    expect(r.result.difficulty.status).toBe("insufficient");
  });

  it("HTTP 429 de l'IGN : rateLimited remonté pour le délai d'attente, requêtes arrêtées", async () => {
    const { fetchImpl, calls } = router({ ignHandler: () => down(429), osmHandler: osmOk([]) });
    const r = await analyze({ fetchImpl, sources: { osm: false }, ignOptions: { concurrency: 1 } });
    expect(r.load.rateLimited).toBe(true);
    expect(r.load.unavailable).toBe(true);
    expect(calls.ign).toBe(1);
  });

  it("échec du seul COMPLÉMENT OpenStreetMap : l'analyse IGN n'est ni bloquée ni déclarée indisponible", async () => {
    const withoutOsm = await analyze({ fetchImpl: router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk([]) }).fetchImpl, sources: { osmEnrichment: "off" } });
    const { fetchImpl } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: () => down(503) });
    const r = await analyze({ fetchImpl });
    expect(r.load.unavailable).toBe(false);
    expect(r.load.rateLimited).toBe(false);
    expect(r.cellCounts.available).toBe(r.cellCounts.total);
    expect(r.sources.enrichment).toMatchObject({ failed: true, loaded: 0 });
    expect(r.result.summary.distancesM).toEqual(withoutOsm.result.summary.distancesM);
  });

  it("429 du seul complément OSM : signalé dans sources.enrichment, jamais dans l'état principal", async () => {
    const { fetchImpl } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: () => down(429) });
    const r = await analyze({ fetchImpl });
    expect(r.sources.enrichment).toMatchObject({ failed: true, rateLimited: true });
    expect(r.load.rateLimited).toBe(false);
    expect(r.load.unavailable).toBe(false);
  });

  it("complément en mode « cache » : aucune requête OSM, mais le cache OSM existant est utilisé pour enrichir", async () => {
    const store = memoryStore();
    await analyze({ fetchImpl: router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) }).fetchImpl, store });
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk([]) });
    const r = await analyze({ fetchImpl, store, sources: { osmEnrichment: "cache" } });
    expect(calls.osm).toBe(0);
    expect(calls.ign).toBe(0); // IGN en cache lui aussi
    expect(r.result.provenance.technicalShare).toBeGreaterThan(0.95);
  });

  it("complément désactivé (« off ») : le cache OSM des zones IGN est ignoré (choix de l'utilisateur)", async () => {
    const store = memoryStore();
    await analyze({ fetchImpl: router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) }).fetchImpl, store });
    const r = await analyze({ fetchImpl: vi.fn(), store, allowNetwork: false, sources: { osmEnrichment: "off" } });
    expect(r.result.provenance.technicalM).toBe(0);
  });

  it("sources.ign = false : l'IGN n'est jamais interrogé (mode OpenStreetMap seul)", async () => {
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) });
    await analyze({ fetchImpl, sources: { ign: false } });
    expect(calls.ign).toBe(0);
    expect(calls.osm).toBeGreaterThan(0);
  });
});

describe("consentement, cache et confidentialité de bout en bout", () => {
  it("sans consentement (allowNetwork = false) : AUCUNE requête vers l'IGN ni vers OpenStreetMap", async () => {
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) });
    const r = await analyze({ fetchImpl, allowNetwork: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls.ign + calls.osm).toBe(0);
    expect(r.cellCounts.available).toBe(0);
    expect(r.result.summary.type).toBe("unknown");
  });

  it("rejouable hors ligne : après un chargement autorisé, le même résultat sort du cache sans aucune requête", async () => {
    const store = memoryStore();
    const online = await analyze({ fetchImpl: router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) }).fetchImpl, store });
    const offlineFetch = vi.fn();
    const offline = await analyze({ fetchImpl: offlineFetch, store, allowNetwork: false });
    expect(offlineFetch).not.toHaveBeenCalled();
    expect(offline.result.summary.distancesM).toEqual(online.result.summary.distancesM);
    expect(offline.result.provenance.technicalM).toBeCloseTo(online.result.provenance.technicalM, 0);
  });

  it("zones déjà en cache : jamais redemandées, ni à l'IGN ni à OpenStreetMap", async () => {
    const store = memoryStore();
    await analyze({ fetchImpl: router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) }).fetchImpl, store });
    const { fetchImpl, calls } = router({ ignHandler: ignOk(IGN_MIXED), osmHandler: osmOk(OSM_ENRICH) });
    await analyze({ fetchImpl, store });
    expect(calls.ign + calls.osm).toBe(0);
  });

  it("confidentialité : les requêtes IGN et OSM ne contiennent que des bornes de zones fixes, jamais un point du tracé ni une donnée personnelle", async () => {
    const POINTS = [
      { lat: 45.123457, lon: 6.054321 }, { lat: 45.123981, lon: 6.058765 }, { lat: 45.124403, lon: 6.063219 },
      { lat: 45.125117, lon: 6.067842 }, { lat: 45.125998, lon: 6.072456 },
    ].map((p, i) => ({ ...p, time: new Date(Date.UTC(2031, 6, 4, 10, 0, i)), hr: 151 + i, power: 233 + i, name: "Jean Dupont" }));
    const { fetchImpl, calls } = router({ ignHandler: ignOk([]), osmHandler: osmOk([]) });
    const r = await runTerrainAnalysis({ points: POINTS, store: memoryStore(), allowNetwork: true, fetchImpl, sleep: noSleep, minIntervalMs: 0 });
    const cells = Object.keys(r.load.cells);
    const allowed = new Set(cells.flatMap((k) => { const [i, j] = k.split(":").map(Number); return [i, j, i + 1, j + 1].map((v) => (v * 0.02).toFixed(5)); }));
    for (const text of [...calls.urls.map(decodeURIComponent), ...calls.bodies]) {
      for (const p of POINTS) { expect(text).not.toContain(String(p.lat)); expect(text).not.toContain(String(p.lon)); }
      expect(text).not.toMatch(/Jean|Dupont|2031|233|151|poly:|around/);
      for (const n of text.match(/-?\d+\.\d{5}/g) || []) expect(allowed.has(n)).toBe(true);
    }
    expect(calls.urls.length).toBeGreaterThan(0);
    expect(calls.bodies.length).toBeGreaterThan(0);
  });

  it("analyzeTerrain n'altère pas les points GPS ni les chemins fournis", () => {
    const points = makeTrack({ toM: 500 });
    const ways = [{ id: -1, tags: { highway: "track", "ign:nature": "Chemin" }, geom: makeWay(0, {}, { toM: 500 }).geom, src: "ign" }];
    const snap = JSON.stringify([points, ways]);
    analyzeTerrain(points, ways);
    expect(JSON.stringify([points, ways])).toBe(snap);
  });
});

describe("planTerrainCells — zones IGN et zones OpenStreetMap seul", () => {
  it("répartit les zones d'un tracé à cheval sur la frontière du territoire couvert", () => {
    const border = makeTrack({ toM: 3000 }).map((p) => ({ ...p, lat: 51.28 + (p.lon - 6) * 0, lon: 2 + (p.lon - 6) * 4 }));
    const plan = planTerrainCells(border);
    expect(plan.ignCount + plan.osmOnlyCount).toBe(plan.count);
    expect(plan.ignCount).toBeGreaterThan(0);
    expect(cellKey(51.28, 2)).toBeTruthy();
  });
});
