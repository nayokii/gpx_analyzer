/**
 * Noms donnés par l'utilisateur aux montées détectées. Comme pour les noms de
 * sorties (../feed/nameOverrides.js), ce n'est qu'une surcharge d'affichage
 * dans le stockage du navigateur : aucune donnée de sortie n'est modifiée.
 *
 * Chaque entrée garde la position de la montée ; un groupe retrouve son nom
 * en la recoupant (sameClimb), si bien qu'un léger décalage de détection
 * d'une sortie à l'autre ne fait pas perdre le nom.
 */
import { sameClimb } from "./climbRegistry.js";
import { readTextFile, writeTextFile } from "../storage/activityStore.js";

export const STORAGE_KEY = "cyclingos.climbs.names.v1";
const KEY = STORAGE_KEY;
const FILE = "climbs.json"; // à la racine du dossier choisi, à côté de athlete.json
export const MAX_NAME_LENGTH = 80;

export function sanitizeName(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Une entrée garde la position de la montée, le nom saisi par l'utilisateur
 * (`name`, peut être vide) et, si elle a été rapprochée d'un segment Strava,
 * `strava: {id, name, category}`. Le nom saisi prime toujours sur celui de Strava.
 */
function isValidEntry(e) {
  return !!e && !!(e.name || (e.strava && e.strava.id)) && e.startLat != null && e.startLon != null && e.endLat != null && e.endLon != null;
}

function persist(next) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // stockage indisponible (navigation privée…) : le nom reste valable pour la session
  }
}

/** @returns {Array<{name: string, strava?: {id: number|string, name: string, category: number|null}, startLat: number, startLon: number, endLat: number, endLon: number}>} */
export function loadClimbNames() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

/** @returns {string|null} nom saisi par l'utilisateur, sinon nom du segment Strava lié, sinon null */
export function findClimbName(names, group) {
  const hit = names.find((e) => sameClimb(e, group));
  return hit ? hit.name || (hit.strava && hit.strava.name) || null : null;
}

/** @returns {{id: number|string, name: string, category: number|null}|null} segment Strava lié à cette montée */
export function findClimbStrava(names, group) {
  const hit = names.find((e) => sameClimb(e, group));
  return hit && hit.strava ? hit.strava : null;
}

/**
 * Nomme (ou, pour un nom vide, désigne comme non nommée) une montée.
 * @returns {Array} la nouvelle liste complète (même si l'écriture échoue)
 */
export function saveClimbName(names, group, rawName) {
  const name = sanitizeName(rawName);
  const existing = names.find((e) => sameClimb(e, group));
  const next = names.filter((e) => !sameClimb(e, group));
  const strava = existing && existing.strava ? existing.strava : null; // renommer ne casse jamais le lien Strava
  if (name || strava) {
    next.push({ name, ...(strava ? { strava } : {}), startLat: group.startLat, startLon: group.startLon, endLat: group.endLat, endLon: group.endLon });
  }
  persist(next);
  return next;
}

/**
 * Enregistre les segments Strava rapprochés de montées. Les noms saisis par
 * l'utilisateur sont conservés tels quels.
 * @param {Array} names
 * @param {Array<{group: Object, segment: {id: number|string, name: string, category: number|null}}>} links
 * @returns {Array} la nouvelle liste complète
 */
export function saveStravaLinks(names, links) {
  let next = names;
  for (const { group, segment } of links) {
    const existing = next.find((e) => sameClimb(e, group));
    next = next.filter((e) => !sameClimb(e, group));
    next.push({
      name: existing ? existing.name : "",
      strava: { id: segment.id, name: segment.name, category: segment.category ?? null },
      startLat: group.startLat, startLon: group.startLon, endLat: group.endLat, endLon: group.endLon,
    });
  }
  persist(next);
  return next;
}

/** Union de deux listes de noms ; pour une même montée, l'entrée de `preferred` l'emporte. */
export function mergeClimbNames(base, preferred) {
  const kept = (base || []).filter((e) => !(preferred || []).some((p) => sameClimb(p, e)));
  return [...kept, ...(preferred || [])];
}

/**
 * Noms enregistrés dans le dossier de sorties (ils suivent le dossier d'un
 * appareil à l'autre). Jamais d'exception : absent ou illisible = aucun nom.
 */
export async function readClimbNamesFile(rootHandle) {
  if (!rootHandle) return [];
  try {
    const parsed = JSON.parse(await readTextFile(rootHandle, FILE));
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

/** @returns {Promise<boolean>} true si l'écriture a réussi */
export async function writeClimbNamesFile(rootHandle, names) {
  if (!rootHandle) return false;
  try {
    await writeTextFile(rootHandle, FILE, JSON.stringify(names, null, 2));
    return true;
  } catch {
    return false;
  }
}
