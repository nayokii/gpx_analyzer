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

/** @returns {Array<{name: string, startLat: number, startLon: number, endLat: number, endLon: number}>} */
export function loadClimbNames() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.name && e.startLat != null && e.endLat != null) : [];
  } catch {
    return [];
  }
}

export function findClimbName(names, group) {
  const hit = names.find((e) => sameClimb(e, group));
  return hit ? hit.name : null;
}

/**
 * Nomme (ou, pour un nom vide, désigne comme non nommée) une montée.
 * @returns {Array} la nouvelle liste complète (même si l'écriture échoue)
 */
export function saveClimbName(names, group, rawName) {
  const name = sanitizeName(rawName);
  const next = names.filter((e) => !sameClimb(e, group));
  if (name) {
    next.push({ name, startLat: group.startLat, startLon: group.startLon, endLat: group.endLat, endLon: group.endLon });
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // stockage indisponible (navigation privée…) : le nom reste valable pour la session
  }
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
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && e.name && e.startLat != null && e.startLon != null && e.endLat != null && e.endLon != null)
      : [];
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
