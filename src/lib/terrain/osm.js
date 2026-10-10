/**
 * Accès aux données OpenStreetMap (réseau routier) via l'API Overpass publique — SANS clé, SANS secret.
 *
 * Confidentialité : on n'envoie JAMAIS le fichier GPX/FIT ni le tracé. Seules des zones rectangulaires fixes
 * (≈ 2 × 2 km, voir geo.js: CELL_SIZE_DEG) traversées par le tracé sont demandées, une requête par zone, ce qui
 * limite aussi le nombre de requêtes et rend le cache réutilisable d'une sortie à l'autre. Aucune heure, fréquence
 * cardiaque, puissance ni identité n'est transmise (le serveur voit toutefois l'adresse IP, comme pour toute requête web).
 *
 * Politesse envers le service (jamais de tempête de requêtes) :
 *  - requêtes SÉQUENTIELLES espacées d'au moins `minIntervalMs` ;
 *  - au plus UNE requête par serveur et par zone (aucun nouvel essai sur un serveur déjà essayé, aucune pause de reprise),
 *    donc 2 requêtes maximum par zone (serveur principal, puis serveur de secours) ;
 *  - disjoncteur : après `MAX_FAILED_CELLS` zones consécutives en échec, les zones restantes sont DIFFÉRÉES et le service
 *    est déclaré indisponible (`unavailable`) ; plus aucune requête n'est envoyée pendant cette exécution ;
 *  - plafond absolu de `MAX_REQUESTS_PER_RUN` requêtes réseau par exécution de `loadCells` (compteur partagé par toutes
 *    les zones et les deux serveurs). Une relance est une NOUVELLE exécution, déclenchée par l'utilisateur (voir TerrainView).
 * Une zone en échec est signalée « erreur », jamais devinée.
 */
import { cellBounds } from "./geo.js";
import { KEPT_TAG_KEYS } from "./classify.js";

export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/** Au-delà, l'analyse refuse de lancer des requêtes (tracé trop étendu) : on n'utilise alors que le cache. */
export const MAX_NETWORK_CELLS = 40;
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
/** Nombre de zones CONSÉCUTIVES en échec après lequel le chargement des nouvelles zones est interrompu. */
export const MAX_FAILED_CELLS = 2;
/** Plafond absolu de requêtes réseau pour UNE exécution de loadCells (toutes zones et tous serveurs confondus). */
export const MAX_REQUESTS_PER_RUN = 6;
/** Requêtes maximum pour une seule zone (un essai par serveur, serveur de secours compris). */
export const MAX_REQUESTS_PER_CELL = 2;
const DEFAULT_MIN_INTERVAL_MS = 1200;
const EXCLUDED_HIGHWAYS = "proposed|construction|bus_stop|platform|elevator|corridor|raceway|rest_area|services|bus_guideway|escape";

/** Requête Overpass QL pour une zone. */
export function buildCellQuery(key) {
  const { south, west, north, east } = cellBounds(key);
  const bbox = [south, west, north, east].map((v) => v.toFixed(5)).join(",");
  return `[out:json][timeout:25];way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["area"!="yes"](${bbox});out tags geom;`;
}

/** Réponse Overpass → chemins allégés { id, tags, geom: [[lat, lon], …] }. Ignore tout élément mal formé. */
export function parseOverpassResponse(json) {
  if (!json || !Array.isArray(json.elements)) throw new Error("Réponse Overpass inattendue.");
  const ways = [];
  for (const el of json.elements) {
    if (el.type !== "way" || !el.tags || !el.tags.highway || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const tags = {};
    for (const k of KEPT_TAG_KEYS) if (el.tags[k] != null) tags[k] = String(el.tags[k]);
    const geom = el.geometry
      .filter((g) => g && typeof g.lat === "number" && typeof g.lon === "number")
      .map((g) => [Math.round(g.lat * 1e5) / 1e5, Math.round(g.lon * 1e5) / 1e5]);
    if (geom.length >= 2) ways.push({ id: el.id, tags, geom });
  }
  return ways;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Délai maximal d'une requête : un serveur lent ne doit jamais bloquer l'analyse indéfiniment. */
export const REQUEST_TIMEOUT_MS = 30000;

async function fetchCellOnce(fetchImpl, endpoint, key, signal) {
  // Signal combiné : annulation par l'utilisateur OU délai dépassé (les deux interrompent la requête).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener("abort", onAbort); }
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(buildCellQuery(key)),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) { const e = new Error("Délai dépassé"); e.name = "TimeoutError"; throw e; }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  if (!res.ok) {
    const err = new Error(`Overpass HTTP ${res.status}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers && res.headers.get ? res.headers.get("Retry-After") : 0) || 0;
    throw err;
  }
  return parseOverpassResponse(await res.json());
}

/**
 * Une zone : un essai par serveur (2 au plus), jamais deux sur le même serveur. Chaque requête réellement envoyée est
 * décomptée du budget PARTAGÉ de l'exécution (`budget.used`) : quand il est épuisé, plus rien n'est envoyé.
 * Toute erreur (HTTP 400/403/429/5xx, réseau, délai dépassé, réponse invalide) fait passer au serveur suivant ;
 * seule une annulation volontaire (AbortError) est propagée.
 */
async function fetchCell({ fetchImpl, key, endpoints, signal, budget }) {
  let lastError = null;
  for (const endpoint of endpoints.slice(0, MAX_REQUESTS_PER_CELL)) {
    if (budget.used >= budget.max) break;
    budget.used += 1;
    try {
      return await fetchCellOnce(fetchImpl, endpoint, key, signal);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError || Object.assign(new Error("Plafond de requêtes atteint"), { name: "BudgetError" });
}

/**
 * Charge les chemins des zones demandées : cache d'abord, réseau seulement si `allowNetwork` (consentement donné).
 *
 * @param {Object} params
 * @param {string[]} params.cellKeys
 * @param {{get: Function, put: Function}} params.store
 * @param {boolean} params.allowNetwork
 * @param {typeof fetch} [params.fetchImpl]
 * @param {string[]} [params.endpoints]
 * @param {number} [params.minIntervalMs]
 * @param {AbortSignal} [params.signal]
 * @param {(done: number, total: number) => void} [params.onProgress]
 * @param {(ms: number) => Promise<void>} [params.sleep] - injectable (tests) ; sert uniquement à espacer deux zones
 * @param {number} [params.now]
 * @param {number} [params.maxRequests] - plafond de requêtes de cette exécution (défaut MAX_REQUESTS_PER_RUN)
 * @param {number} [params.maxFailedCells] - zones consécutives en échec avant interruption (défaut MAX_FAILED_CELLS)
 * @returns {Promise<{ways: Array, cells: Object<string, "cache"|"network"|"stale"|"missing"|"deferred"|"error"|"skipped">, errors: string[], tooLarge: boolean, unavailable: boolean, capped: boolean, requests: number}>}
 *   `deferred` : zone non traitée parce que le chargement a été interrompu (service indisponible ou plafond atteint) ;
 *   `unavailable` : le service est considéré indisponible (disjoncteur déclenché, ou aucune zone n'a pu être chargée) ;
 *   `capped` : le plafond de requêtes a laissé des zones différées alors que le service répondait.
 */
export async function loadCells({
  cellKeys, store, allowNetwork, fetchImpl = typeof fetch !== "undefined" ? fetch.bind(globalThis) : null,
  endpoints = OVERPASS_ENDPOINTS, minIntervalMs = DEFAULT_MIN_INTERVAL_MS, signal, onProgress, sleep = defaultSleep, now = Date.now(),
  maxRequests = MAX_REQUESTS_PER_RUN, maxFailedCells = MAX_FAILED_CELLS,
}) {
  const cells = {};
  const errors = [];
  const byId = new Map(); // dédoublonnage : un chemin qui traverse deux zones n'est compté qu'une fois
  const addWays = (ways) => { for (const w of ways) if (!byId.has(w.id)) byId.set(w.id, w); };

  const toFetch = [];
  for (const key of cellKeys) {
    const record = await store.get(key);
    const fresh = record && now - record.fetchedAt < CACHE_TTL_MS;
    if (record && (fresh || !allowNetwork)) {
      addWays(record.ways);
      cells[key] = fresh ? "cache" : "stale";
    } else {
      toFetch.push({ key, stale: record || null });
    }
  }

  const tooLarge = toFetch.length > MAX_NETWORK_CELLS;
  const budget = { used: 0, max: maxRequests }; // compteur de l'EXÉCUTION entière (pas d'une requête ni d'une zone)
  let done = 0;
  let lastRequestAt = 0;
  let consecutiveFailures = 0;
  let failedCells = 0;
  let loadedCells = 0;
  let tripped = false; // disjoncteur : trop de zones consécutives en échec
  let capped = false; // plafond de requêtes atteint avec des zones restantes

  for (const { key, stale } of toFetch) {
    if (!allowNetwork || tooLarge || !fetchImpl) {
      cells[key] = "missing";
      continue;
    }
    if (tripped || consecutiveFailures >= maxFailedCells) {
      tripped = true;
      cells[key] = "deferred";
      continue;
    }
    if (budget.used >= budget.max) {
      capped = true;
      cells[key] = "deferred";
      continue;
    }
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (lastRequestAt && wait > 0) await sleep(wait);
    try {
      const ways = await fetchCell({ fetchImpl, key, endpoints, signal, budget });
      lastRequestAt = Date.now();
      await store.put(key, { fetchedAt: Date.now(), ways });
      addWays(ways);
      cells[key] = "network";
      consecutiveFailures = 0;
      loadedCells += 1;
    } catch (err) {
      lastRequestAt = Date.now();
      if (err.name === "AbortError") throw err;
      if (stale) { addWays(stale.ways); cells[key] = "stale"; } // réseau en échec : on garde l'ancienne copie plutôt que rien
      else cells[key] = "error";
      errors.push(`${key} : ${err.message}`);
      consecutiveFailures += 1;
      failedCells += 1;
    }
    done += 1;
    if (onProgress) onProgress(done, toFetch.length);
  }
  for (const key of cellKeys) if (!cells[key]) cells[key] = "skipped";
  const unavailable = tripped || (failedCells > 0 && loadedCells === 0);
  return { ways: [...byId.values()], cells, errors, tooLarge, unavailable, capped: capped && !unavailable, requests: budget.used };
}
