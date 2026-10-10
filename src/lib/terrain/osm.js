/**
 * Accès aux données OpenStreetMap (réseau routier) via l'API Overpass publique — SANS clé, SANS secret.
 *
 * Confidentialité : on n'envoie JAMAIS le fichier GPX/FIT ni le tracé. Seules des zones rectangulaires fixes
 * (≈ 2 × 2 km, voir geo.js: CELL_SIZE_DEG) traversées par le tracé sont demandées. Plusieurs zones (jusqu'à
 * `CELLS_PER_REQUEST`) peuvent partager UNE requête sous forme d'union de rectangles : la surface interrogée reste
 * exactement la somme des zones (aucune requête plus large), mais le nombre de requêtes — donc d'occasions de
 * tomber sur un service saturé — est divisé d'autant. Chaque zone est ensuite mise en cache séparément. Aucune heure,
 * fréquence cardiaque, puissance ni identité n'est transmise (le serveur voit toutefois l'adresse IP).
 *
 * Politesse envers le service (jamais de tempête de requêtes) :
 *  - requêtes SÉQUENTIELLES espacées d'au moins `minIntervalMs` ;
 *  - au plus UNE requête par serveur et par groupe de zones (2 requêtes maximum : serveur principal, puis secours),
 *    aucun nouvel essai sur un serveur déjà essayé, aucune pause de reprise ;
 *  - un serveur qui a échoué `MAX_ENDPOINT_FAILURES` fois de suite pendant l'exécution n'est plus sollicité ;
 *  - un HTTP 429 (limite de débit) arrête IMMÉDIATEMENT le chargement de nouveaux groupes (`rateLimited`) ;
 *  - disjoncteur : après `MAX_FAILED_CELLS` groupes consécutifs en échec, les zones restantes sont DIFFÉRÉES et le
 *    service est déclaré indisponible (`unavailable`) ;
 *  - plafond absolu de `MAX_REQUESTS_PER_RUN` requêtes réseau par exécution de `loadCells`.
 * Le délai avant une nouvelle tentative (≥ 30 s après un 429) est imposé par l'appelant (voir TerrainView.jsx), qui
 * relance seulement sur demande de l'utilisateur. Une zone en échec est signalée « erreur », jamais devinée.
 */
import { cellBounds } from "./geo.js";
import { KEPT_TAG_KEYS } from "./classify.js";

export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/** Au-delà, l'analyse refuse de lancer des requêtes (tracé trop étendu) : on n'utilise alors que le cache. */
export const MAX_NETWORK_CELLS = 40;
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
/** Nombre de zones à regrouper dans une même requête (union de rectangles ; jamais de rectangle plus large). */
export const CELLS_PER_REQUEST = 3;
/** Nombre de groupes de zones CONSÉCUTIFS en échec après lequel le chargement des nouveaux groupes est interrompu. */
export const MAX_FAILED_CELLS = 2;
/** Plafond absolu de requêtes réseau pour UNE exécution de loadCells (tous groupes et tous serveurs confondus). */
export const MAX_REQUESTS_PER_RUN = 6;
/** Requêtes maximum pour un même groupe de zones (un essai par serveur, serveur de secours compris). */
export const MAX_REQUESTS_PER_CELL = 2;
/** Échecs après lesquels un serveur n'est plus sollicité pendant l'exécution (ex. instance durablement en panne). */
export const MAX_ENDPOINT_FAILURES = 2;
const DEFAULT_MIN_INTERVAL_MS = 1200;
const EXCLUDED_HIGHWAYS = "proposed|construction|bus_stop|platform|elevator|corridor|raceway|rest_area|services|bus_guideway|escape";
const WAY_FILTER = `way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"]["area"!="yes"]`;

const bboxOf = (key) => {
  const { south, west, north, east } = cellBounds(key);
  return [south, west, north, east].map((v) => v.toFixed(5)).join(",");
};

/**
 * Requête Overpass QL pour une zone, ou pour une union de zones (un rectangle par zone, jamais une boîte englobante).
 * @param {string|string[]} keys
 */
export function buildCellQuery(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.length === 1) return `[out:json][timeout:25];${WAY_FILTER}(${bboxOf(list[0])});out tags geom;`;
  return `[out:json][timeout:25];(${list.map((k) => `${WAY_FILTER}(${bboxOf(k)});`).join("")});out tags geom;`;
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

/**
 * Chemins d'une zone parmi ceux d'une réponse groupée : ceux dont l'emprise rencontre le rectangle de la zone
 * (un chemin qui traverse deux zones est donc conservé dans les deux ; le dédoublonnage par id se fait plus loin).
 */
export function waysForCell(ways, key) {
  const { south, west, north, east } = cellBounds(key);
  return ways.filter((w) => {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of w.geom) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return maxLat >= south && minLat <= north && maxLon >= west && minLon <= east;
  });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Délai maximal d'une requête : un serveur lent ne doit jamais bloquer l'analyse indéfiniment. */
export const REQUEST_TIMEOUT_MS = 30000;

async function fetchOnce(fetchImpl, endpoint, keys, signal) {
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
      body: "data=" + encodeURIComponent(buildCellQuery(keys)),
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
 * Un groupe de zones : un essai par serveur (2 au plus), jamais deux sur le même serveur. Chaque requête réellement
 * envoyée est décomptée du budget PARTAGÉ de l'exécution (`run.used`) : quand il est épuisé, plus rien n'est envoyé.
 * Toute erreur (HTTP 400/403/429/5xx, réseau, délai dépassé, réponse invalide) fait passer au serveur suivant ;
 * seule une annulation volontaire (AbortError) est propagée. Un 429 est mémorisé dans `run` (rateLimited/retryAfterMs).
 */
async function fetchGroup({ fetchImpl, keys, endpoints, signal, run }) {
  let lastError = null;
  for (const endpoint of endpoints.slice(0, MAX_REQUESTS_PER_CELL)) {
    if ((run.endpointFailures.get(endpoint) || 0) >= run.maxEndpointFailures) continue; // serveur considéré en panne
    if (run.used >= run.max) break;
    run.used += 1;
    try {
      const ways = await fetchOnce(fetchImpl, endpoint, keys, signal);
      run.endpointFailures.set(endpoint, 0); // un succès remet à zéro les échecs consécutifs de ce serveur
      return ways;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      lastError = err;
      run.endpointFailures.set(endpoint, (run.endpointFailures.get(endpoint) || 0) + 1);
      if (err.status === 429) {
        run.rateLimited = true;
        run.retryAfterMs = Math.max(run.retryAfterMs, (err.retryAfter || 0) * 1000);
      }
    }
  }
  throw lastError || Object.assign(new Error("Aucun serveur cartographique disponible"), { name: "NoEndpointError" });
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

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
 * @param {(ms: number) => Promise<void>} [params.sleep] - injectable (tests) ; sert uniquement à espacer deux requêtes
 * @param {number} [params.now]
 * @param {number} [params.maxRequests] - plafond de requêtes de cette exécution (défaut MAX_REQUESTS_PER_RUN)
 * @param {number} [params.maxFailedCells] - groupes consécutifs en échec avant interruption (défaut MAX_FAILED_CELLS)
 * @param {number} [params.cellsPerRequest] - zones par requête (défaut CELLS_PER_REQUEST ; 1 = une requête par zone)
 * @param {number} [params.maxEndpointFailures] - échecs CONSÉCUTIFS après lesquels un serveur est écarté (défaut MAX_ENDPOINT_FAILURES)
 * @returns {Promise<{ways: Array, cells: Object<string, "cache"|"network"|"stale"|"missing"|"deferred"|"error"|"skipped">, errors: string[], tooLarge: boolean, unavailable: boolean, capped: boolean, rateLimited: boolean, retryAfterMs: number, requests: number}>}
 *   `deferred` : zone non traitée parce que le chargement a été interrompu (service indisponible ou plafond atteint) ;
 *   `unavailable` : le service est considéré indisponible (disjoncteur déclenché, 429, ou aucune zone n'a pu être chargée) ;
 *   `rateLimited` : au moins un HTTP 429 a été reçu (`retryAfterMs` : plus grand Retry-After lisible, 0 sinon) ;
 *   `capped` : le plafond de requêtes a laissé des zones différées alors que le service répondait.
 */
export async function loadCells({
  cellKeys, store, allowNetwork, fetchImpl = typeof fetch !== "undefined" ? fetch.bind(globalThis) : null,
  endpoints = OVERPASS_ENDPOINTS, minIntervalMs = DEFAULT_MIN_INTERVAL_MS, signal, onProgress, sleep = defaultSleep, now = Date.now(),
  maxRequests = MAX_REQUESTS_PER_RUN, maxFailedCells = MAX_FAILED_CELLS, cellsPerRequest = CELLS_PER_REQUEST,
  maxEndpointFailures = MAX_ENDPOINT_FAILURES,
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
  // État de l'EXÉCUTION entière (pas d'une requête ni d'un groupe) : budget, serveurs défaillants, limite de débit.
  const run = { used: 0, max: maxRequests, maxEndpointFailures, endpointFailures: new Map(), rateLimited: false, retryAfterMs: 0 };
  let done = 0;
  let lastRequestAt = 0;
  let consecutiveFailures = 0;
  let failedCells = 0;
  let loadedCells = 0;
  let tripped = false; // disjoncteur : trop de groupes consécutifs en échec, ou limite de débit (429)
  let capped = false; // plafond de requêtes atteint avec des zones restantes

  for (const group of chunk(toFetch, Math.max(1, cellsPerRequest))) {
    const keys = group.map((g) => g.key);
    if (!allowNetwork || tooLarge || !fetchImpl) {
      for (const k of keys) cells[k] = "missing";
      continue;
    }
    if (tripped || consecutiveFailures >= maxFailedCells) {
      tripped = true;
      for (const k of keys) cells[k] = "deferred";
      continue;
    }
    if (run.used >= run.max) {
      capped = true;
      for (const k of keys) cells[k] = "deferred";
      continue;
    }
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (lastRequestAt && wait > 0) await sleep(wait);
    try {
      const ways = await fetchGroup({ fetchImpl, keys, endpoints, signal, run });
      lastRequestAt = Date.now();
      for (const k of keys) {
        const own = keys.length === 1 ? ways : waysForCell(ways, k); // une zone = ses propres chemins en cache
        await store.put(k, { fetchedAt: Date.now(), ways: own });
        cells[k] = "network";
      }
      addWays(ways);
      consecutiveFailures = 0;
      loadedCells += keys.length;
    } catch (err) {
      lastRequestAt = Date.now();
      if (err.name === "AbortError") throw err;
      for (const { key, stale } of group) {
        if (stale) { addWays(stale.ways); cells[key] = "stale"; } // réseau en échec : on garde l'ancienne copie plutôt que rien
        else cells[key] = "error";
        errors.push(`${key} : ${err.message}`);
      }
      consecutiveFailures += 1;
      failedCells += keys.length;
    }
    if (run.rateLimited) tripped = true; // 429 (même si le serveur de secours a répondu) : plus aucun nouveau groupe pendant cette exécution
    done += keys.length;
    if (onProgress) onProgress(done, toFetch.length);
  }
  for (const key of cellKeys) if (!cells[key]) cells[key] = "skipped";
  const unavailable = tripped || (failedCells > 0 && loadedCells === 0);
  return {
    ways: [...byId.values()], cells, errors, tooLarge, unavailable, capped: capped && !unavailable,
    rateLimited: run.rateLimited, retryAfterMs: run.retryAfterMs, requests: run.used,
  };
}
