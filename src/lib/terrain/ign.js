/**
 * Source IGN (Géoplateforme, service WFS public) : tronçons de route de la BD TOPO, par zone de ~2 × 2 km.
 *
 * Pourquoi : le service Overpass public est souvent saturé ; le WFS de la Géoplateforme est public (sans clé), répond avec
 * `Access-Control-Allow-Origin: *`, et couvre la France métropolitaine et les DOM (sondes réelles : 80 à 1 466 tronçons par
 * zone en 0,15 à 0,6 s, 40 à 500 Ko). Limite d'usage publiée par l'IGN (CGU cartes.gouv.fr, version du 15/10/2024) :
 * 30 requêtes/s/IP pour le WFS, au-delà HTTP 429 pendant 5 s — très au-dessus de notre usage, que nous bornons quand même.
 *
 * Confidentialité : seule la boîte (4 bornes) d'une zone fixe part dans l'URL — jamais le GPX/FIT, le tracé, une heure,
 * une fréquence cardiaque ni une identité. Le serveur voit l'adresse IP (comme pour toute requête web).
 *
 * Résilience (mêmes principes que osm.js) : cache par zone, concurrence bornée, espacement des départs, aucun nouvel essai
 * automatique, disjoncteur après `IGN_MAX_FAILED_CELLS` zones consécutives en échec, arrêt immédiat sur HTTP 429,
 * plafond de requêtes par exécution. Une zone sans aucun tronçon (mer, hors du territoire) est mise en cache comme VIDE
 * et signalée telle quelle : ce n'est jamais présenté comme une couverture.
 */
import { cellBounds } from "./geo.js";
import { parseIgnResponse } from "./ignConvert.js";
import { MAX_NETWORK_CELLS } from "./osm.js";

export const IGN_WFS_URL = "https://data.geopf.fr/wfs/ows";
export const IGN_LAYER = "BDTOPO_V3:troncon_de_route";
/** Seuls ces champs sont demandés (le tronçon complet fait ~5× plus : 660 Ko contre 131 Ko pour la même zone). */
export const IGN_PROPERTIES = ["nature", "urbain", "etat_de_l_objet", "fictif", "cleabs", "date_modification", "geometrie"];
export const IGN_PAGE_SIZE = 5000;
export const IGN_MAX_PAGES = 3;
export const IGN_REQUEST_TIMEOUT_MS = 20000;
export const IGN_CACHE_TTL_MS = 90 * 24 * 3600 * 1000; // la BD TOPO est mise à jour par trimestre
export const IGN_CONCURRENCY = 2;
export const IGN_MIN_INTERVAL_MS = 250;
export const IGN_MAX_FAILED_CELLS = 2;
export const IGN_MAX_REQUESTS_PER_RUN = 60;
export const IGN_ATTRIBUTION = "Source : IGN — BD TOPO® (Licence Ouverte Etalab 2.0)";

export const ignCacheKey = (cell) => `ign:${cell}`;

/** URL WFS d'une zone (page `startIndex`). La zone entière est une boîte lat/lon : rien d'autre n'est transmis. */
export function buildIgnUrl(key, startIndex = 0) {
  const { south, west, north, east } = cellBounds(key);
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(",");
  const params = {
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: IGN_LAYER,
    OUTPUTFORMAT: "application/json",
    COUNT: String(IGN_PAGE_SIZE),
    SORTBY: "cleabs", // pagination déterministe
    SRSNAME: "urn:ogc:def:crs:EPSG::4326",
    BBOX: `${bbox},urn:ogc:def:crs:EPSG::4326`, // ordre latitude, longitude (EPSG:4326 en notation urn)
    PROPERTYNAME: IGN_PROPERTIES.join(","),
  };
  if (startIndex > 0) params.STARTINDEX = String(startIndex);
  return `${IGN_WFS_URL}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(fetchImpl, url, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, IGN_REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener("abort", onAbort); }
  let res;
  try {
    res = await fetchImpl(url, { method: "GET", signal: controller.signal });
  } catch (err) {
    if (timedOut) { const e = new Error("Délai dépassé"); e.name = "TimeoutError"; throw e; }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  if (!res.ok) {
    const err = new Error(`IGN HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("Réponse IGN illisible (pas du JSON)."); // typiquement un ExceptionReport XML
  }
  return parseIgnResponse(json);
}

/** Une zone, avec pagination si elle dépasse IGN_PAGE_SIZE tronçons. Chaque page consomme le budget de l'exécution. */
async function fetchIgnCell({ fetchImpl, key, signal, run }) {
  const ways = [];
  const dropped = { fictif: 0, inactive: 0, geometry: 0, id: 0, nature: {} };
  let matched = 0;
  let fetched = 0;
  let pages = 0;
  let latest = null;
  while (pages < IGN_MAX_PAGES) {
    if (run.used >= run.max) throw Object.assign(new Error("Plafond de requêtes atteint"), { name: "BudgetError" });
    run.used += 1;
    const page = await fetchPage(fetchImpl, buildIgnUrl(key, fetched), signal);
    pages += 1;
    ways.push(...page.ways);
    if (page.latest && (!latest || page.latest > latest)) latest = page.latest;
    matched = page.matched;
    fetched += page.returned;
    for (const k of ["fictif", "inactive", "geometry", "id"]) dropped[k] += page.dropped[k];
    for (const [n, c] of Object.entries(page.dropped.nature)) dropped.nature[n] = (dropped.nature[n] || 0) + c;
    if (page.returned === 0 || fetched >= matched) break;
  }
  return { ways, matched, fetched, dropped, latest, truncated: fetched < matched };
}

/**
 * Charge les tronçons IGN des zones demandées : cache d'abord, réseau seulement si `allowNetwork` (consentement donné).
 *
 * @param {Object} params
 * @param {string[]} params.cellKeys
 * @param {{get: Function, put: Function}} params.store - cache (clé `ign:<zone>`)
 * @param {boolean} params.allowNetwork
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{
 *   ways: Array, cells: Object<string, "cache"|"network"|"stale"|"missing"|"deferred"|"error"|"skipped">,
 *   empty: Object<string, true>, errors: string[], tooLarge: boolean, unavailable: boolean, capped: boolean,
 *   rateLimited: boolean, retryAfterMs: number, requests: number,
 *   meta: {dropped: Object, truncatedCells: string[], pages: number, latestModification: string|null}
 * }>}
 *   `empty` : zones où l'IGN n'a renvoyé AUCUN tronçon exploitable (mer, hors territoire, zone vide) — jamais une couverture.
 */
export async function loadIgnCells({
  cellKeys, store, allowNetwork, fetchImpl = typeof fetch !== "undefined" ? fetch.bind(globalThis) : null,
  signal, onProgress, sleep = defaultSleep, now = Date.now(),
  concurrency = IGN_CONCURRENCY, minIntervalMs = IGN_MIN_INTERVAL_MS, maxRequests = IGN_MAX_REQUESTS_PER_RUN, maxFailedCells = IGN_MAX_FAILED_CELLS,
}) {
  const cells = {};
  const empty = {};
  const errors = [];
  const byId = new Map();
  const addWays = (ways) => { for (const w of ways) if (!byId.has(w.id)) byId.set(w.id, w); };
  const meta = { dropped: { fictif: 0, inactive: 0, geometry: 0, id: 0, nature: {} }, truncatedCells: [], pages: 0, latestModification: null };
  const noteLatest = (d) => { if (d && (!meta.latestModification || d > meta.latestModification)) meta.latestModification = d; };
  const addDropped = (d) => {
    for (const k of ["fictif", "inactive", "geometry", "id"]) meta.dropped[k] += d[k] || 0;
    for (const [n, c] of Object.entries(d.nature || {})) meta.dropped.nature[n] = (meta.dropped.nature[n] || 0) + c;
  };

  const toFetch = [];
  for (const key of cellKeys) {
    const record = await store.get(ignCacheKey(key));
    const fresh = record && now - record.fetchedAt < IGN_CACHE_TTL_MS;
    if (record && (fresh || !allowNetwork)) {
      addWays(record.ways);
      cells[key] = fresh ? "cache" : "stale";
      if (record.ways.length === 0) empty[key] = true;
      if (record.truncated) meta.truncatedCells.push(key);
      noteLatest(record.latest);
    } else {
      toFetch.push({ key, stale: record || null });
    }
  }

  const tooLarge = toFetch.length > MAX_NETWORK_CELLS;
  const run = { used: 0, max: maxRequests };
  const state = { next: 0, done: 0, consecutiveFailures: 0, failedCells: 0, loadedCells: 0, tripped: false, capped: false, rateLimited: false, nextStartAt: 0 };

  async function worker() {
    for (;;) {
      const idx = state.next++;
      if (idx >= toFetch.length) return;
      const { key, stale } = toFetch[idx];
      if (!allowNetwork || tooLarge || !fetchImpl) { cells[key] = "missing"; continue; }
      if (state.tripped || state.consecutiveFailures >= maxFailedCells) { state.tripped = true; cells[key] = "deferred"; continue; }
      if (run.used >= run.max) { state.capped = true; cells[key] = "deferred"; continue; }
      // espacement des DÉPARTS entre zones (la concurrence reste bornée par le nombre de workers)
      const startAt = Math.max(Date.now(), state.nextStartAt);
      state.nextStartAt = startAt + minIntervalMs;
      const wait = startAt - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const r = await fetchIgnCell({ fetchImpl, key, signal, run });
        meta.pages += Math.max(1, Math.ceil(r.fetched / IGN_PAGE_SIZE));
        addDropped(r.dropped);
        await store.put(ignCacheKey(key), { fetchedAt: Date.now(), ways: r.ways, matched: r.matched, truncated: r.truncated, latest: r.latest });
        noteLatest(r.latest);
        addWays(r.ways);
        cells[key] = "network";
        if (r.ways.length === 0) empty[key] = true;
        if (r.truncated) meta.truncatedCells.push(key);
        state.consecutiveFailures = 0;
        state.loadedCells += 1;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (stale) { addWays(stale.ways); cells[key] = "stale"; if (stale.ways.length === 0) empty[key] = true; } else cells[key] = "error";
        errors.push(`${key} : ${err.message}`);
        state.consecutiveFailures += 1;
        state.failedCells += 1;
        if (err.status === 429) { state.rateLimited = true; state.tripped = true; } // limite de débit : plus aucun départ
      }
      state.done += 1;
      if (onProgress) onProgress(state.done, toFetch.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, toFetch.length || 1)) }, () => worker()));
  for (const key of cellKeys) if (!cells[key]) cells[key] = "skipped";
  const unavailable = state.tripped || (state.failedCells > 0 && state.loadedCells === 0);
  return {
    ways: [...byId.values()], cells, empty, errors, tooLarge, unavailable, capped: state.capped && !unavailable,
    rateLimited: state.rateLimited, retryAfterMs: state.rateLimited ? 5000 : 0, requests: run.used, meta,
  };
}
