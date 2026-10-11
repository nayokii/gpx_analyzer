/**
 * Lecture/écriture durable des activités dans le dossier local choisi par
 * l'utilisateur (voir directoryAccess.js). Structure sur disque :
 *
 *   <dossier choisi>/
 *   ├── activities/
 *   │   ├── index.json              cache dérivé, reconstructible, pour lister vite
 *   │   ├── 2026-09-20_<id>.gpx     fichier original TOUJOURS conservé
 *   │   └── 2026-09-20_<id>.json    Activity normalisée (voir ../types.js)
 *   └── athlete.json                (Phase 7)
 *
 * `index.json` n'est qu'un cache : s'il est absent ou corrompu, il est
 * reconstruit en relisant chaque fichier .json d'activité — jamais traité
 * comme source de vérité.
 *
 * Ce module ne connaît que l'interface minimale d'un FileSystemDirectoryHandle
 * (getDirectoryHandle / getFileHandle / removeEntry / itération async), ce qui
 * le rend testable avec un faux dossier en mémoire (voir activityStore.test.js)
 * sans dépendre du navigateur.
 */

const ACTIVITIES_DIR = "activities";
const INDEX_FILE = "index.json";

async function getActivitiesDir(rootHandle, { create = true } = {}) {
  return rootHandle.getDirectoryHandle(ACTIVITIES_DIR, { create });
}

// Exportées : réutilisées telles quelles par src/lib/progression/persistence.js
// pour lire/écrire athlete.json à la racine du dossier choisi (voir le
// commentaire "athlete.json (Phase 7)" en tête de fichier) — même API
// FileSystemDirectoryHandle, pas de deuxième mécanisme de fichiers.
export async function writeTextFile(dirHandle, filename, content) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function readTextFile(dirHandle, filename) {
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return file.text();
}

async function writeBinaryFile(dirHandle, filename, arrayBuffer) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(arrayBuffer);
  await writable.close();
}

async function readBinaryFile(dirHandle, filename) {
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

function baseFilename(activity) {
  // Le préfixe de date n'est utilisé que pour trier/organiser les fichiers :
  // si la sortie n'a pas d'horodatage source (activity.date === null), on
  // retombe sur la date du jour sans jamais écrire cette valeur inventée
  // dans le champ `date` de l'Activity elle-même.
  const datePart = activity.date ? activity.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${datePart}_${activity.id}`;
}

function summaryFromActivity(activity, files) {
  return {
    id: activity.id,
    name: activity.name,
    date: activity.date,
    sportType: activity.sportType,
    distance: activity.distance,
    duration: activity.duration,
    // movingTime/elevationLoss/avgPower : ajoutés en Phase 5B pour le dashboard
    // historique (computeHistoryAnalytics/records — voir src/lib/history/),
    // qui a besoin de ces agrégats sans recharger chaque activité complète.
    // Ce sont trois nombres déjà calculés, pas de nouveau traitement ; un
    // index.json antérieur à ce changement les aura simplement absents
    // (traité comme donnée manquante, jamais comme 0) jusqu'à reconstruction.
    movingTime: activity.movingTime,
    elevationGain: activity.elevationGain,
    elevationLoss: activity.elevationLoss,
    avgSpeed: activity.avgSpeed,
    avgPower: activity.avgPower,
    avgHeartRate: activity.avgHeartRate,
    avgCadence: activity.avgCadence,
    flags: activity.flags,
    source: activity.source,
    files,
  };
}

/**
 * Lit index.json. Retourne `null` (et non []) s'il est absent ou corrompu,
 * pour distinguer "index vide" de "index à reconstruire".
 */
export async function readIndex(dirHandle) {
  try {
    const text = await readTextFile(dirHandle, INDEX_FILE);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Sérialise TOUTES les écritures de ce module (saveActivity, deleteActivity,
// patchActivity, rebuildIndex) par dossier : chacune fait un lire-modifier-écrire
// sur index.json. Le verrou du repository (activityRepository.js) ne couvre que
// ses propres appels ; celui-ci protège aussi la sync Strava et la migration de
// vitesse, qui appellent ce module directement. Les fonctions publiques prennent
// le verrou ; les variantes `*Unlocked` sont réservées à l'intérieur d'une section
// verrouillée (verrou non réentrant).
const storeLocks = new WeakMap();
function withStoreLock(rootHandle, fn) {
  const tail = storeLocks.get(rootHandle) || Promise.resolve();
  const result = tail.then(fn, fn);
  storeLocks.set(rootHandle, result.then(() => {}, () => {}));
  return result;
}

async function writeIndex(dirHandle, entries) {
  const sorted = [...entries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  await writeTextFile(dirHandle, INDEX_FILE, JSON.stringify(sorted, null, 2));
  return sorted;
}

/**
 * Reconstruit l'index en relisant chaque fichier .json d'activité présent
 * dans le dossier. Les fichiers illisibles/corrompus sont ignorés plutôt que
 * de faire échouer toute la liste.
 */
export function rebuildIndex(rootHandle) {
  return withStoreLock(rootHandle, () => rebuildIndexUnlocked(rootHandle));
}

async function rebuildIndexUnlocked(rootHandle) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const entries = [];
  for await (const [name, handle] of dirHandle) {
    if (handle.kind !== "file" || name === INDEX_FILE || !name.endsWith(".json")) continue;
    try {
      const text = await (await handle.getFile()).text();
      const activity = JSON.parse(text);
      entries.push(summaryFromActivity(activity, { json: name, original: activity.source?.storedFilename || null }));
    } catch {
      // fichier illisible ou corrompu : ignoré silencieusement lors de la reconstruction
    }
  }
  return writeIndex(dirHandle, entries);
}

/** Liste les activités (métadonnées légères) triées de la plus récente à la plus ancienne. */
export async function listActivities(rootHandle) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const index = await readIndex(dirHandle);
  if (index) return index;
  return rebuildIndex(rootHandle);
}

async function listActivitiesUnlocked(rootHandle) {
  const dirHandle = await getActivitiesDir(rootHandle);
  return (await readIndex(dirHandle)) || rebuildIndexUnlocked(rootHandle);
}

async function loadActivityDetailUnlocked(rootHandle, id) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const entry = (await listActivitiesUnlocked(rootHandle)).find((e) => e.id === id);
  if (!entry) throw new Error(`Sortie introuvable (id ${id}).`);
  return JSON.parse(await readTextFile(dirHandle, entry.files.json));
}

/**
 * Sauvegarde une activité : conserve le fichier source original tel quel et
 * écrit la version JSON normalisée, puis met à jour l'index.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {import('../types.js').Activity} activity
 * @param {string|ArrayBuffer} sourceFileContent - contenu brut du fichier original :
 *   texte pour un GPX, ArrayBuffer pour un FIT (jamais l'inverse — un FIT reste binaire).
 * @param {string} [sourceExt] - extension du fichier source (sans le point) : "gpx" ou "fit"
 * @returns {Promise<import('../types.js').Activity>} l'activité telle qu'enregistrée (avec source.storedFilename renseigné)
 */
export function saveActivity(rootHandle, activity, sourceFileContent, sourceExt = "gpx") {
  return withStoreLock(rootHandle, () => saveActivityUnlocked(rootHandle, activity, sourceFileContent, sourceExt));
}

async function saveActivityUnlocked(rootHandle, activity, sourceFileContent, sourceExt) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const base = baseFilename(activity);
  const originalFilename = `${base}.${sourceExt}`;
  const jsonFilename = `${base}.json`;

  const toSave = { ...activity, source: { ...activity.source, storedFilename: originalFilename } };

  if (sourceExt === "fit") {
    await writeBinaryFile(dirHandle, originalFilename, sourceFileContent);
  } else {
    await writeTextFile(dirHandle, originalFilename, sourceFileContent);
  }
  await writeTextFile(dirHandle, jsonFilename, JSON.stringify(toSave, null, 2));

  const index = (await readIndex(dirHandle)) || (await rebuildIndexUnlocked(rootHandle));
  const withoutExisting = index.filter((e) => e.id !== activity.id);
  withoutExisting.push(summaryFromActivity(toSave, { json: jsonFilename, original: originalFilename }));
  await writeIndex(dirHandle, withoutExisting);

  return toSave;
}

/** Charge le détail complet (avec samples) d'une activité par son id. */
export async function loadActivityDetail(rootHandle, id) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const index = await listActivities(rootHandle);
  const entry = index.find((e) => e.id === id);
  if (!entry) throw new Error(`Sortie introuvable (id ${id}).`);
  const text = await readTextFile(dirHandle, entry.files.json);
  return JSON.parse(text);
}

/** Charge le texte brut du fichier source original (GPX) d'une activité. */
export async function loadActivitySourceText(rootHandle, id) {
  const activity = await loadActivityDetail(rootHandle, id);
  if (!activity.source.storedFilename) {
    throw new Error("Fichier source original introuvable pour cette sortie.");
  }
  const dirHandle = await getActivitiesDir(rootHandle);
  return readTextFile(dirHandle, activity.source.storedFilename);
}

/** Charge le contenu binaire brut du fichier source original (FIT) d'une activité. */
export async function loadActivitySourceArrayBuffer(rootHandle, id) {
  const activity = await loadActivityDetail(rootHandle, id);
  if (!activity.source.storedFilename) {
    throw new Error("Fichier source original introuvable pour cette sortie.");
  }
  const dirHandle = await getActivitiesDir(rootHandle);
  return readBinaryFile(dirHandle, activity.source.storedFilename);
}

/**
 * Met à jour une Activity déjà enregistrée, sous le verrou d'écriture. `compute`
 * reçoit l'Activity COURANTE (relue sous verrou, donc jamais périmée si elle a été
 * réimportée entre-temps) et renvoie les champs à fusionner, ou `null` pour ne rien
 * écrire. Le fichier source et les autres champs ne sont pas touchés.
 *
 * Ordre d'écriture : index d'abord, JSON ensuite. Le JSON porte les marqueurs
 * (ex. speedModelVersion) : s'il n'a pas été écrit, rien n'est jamais considéré
 * comme fait, et l'opération est simplement rejouée au prochain passage.
 * Utilisé par la migration de vitesse moyenne (voir speedMigration.js).
 * @returns {Promise<Object|null>} l'Activity mise à jour, ou `null` si `compute` a renoncé
 */
export function patchActivity(rootHandle, id, compute) {
  return withStoreLock(rootHandle, async () => {
    const dirHandle = await getActivitiesDir(rootHandle);
    const activity = await loadActivityDetailUnlocked(rootHandle, id);
    const patch = compute(activity);
    if (!patch) return null;
    const patched = { ...activity, ...patch };
    const index = await listActivitiesUnlocked(rootHandle);
    const existing = index.find((e) => e.id === id);
    const files = existing ? existing.files : { json: `${baseFilename(activity)}.json`, original: activity.source?.storedFilename || null };
    await writeIndex(dirHandle, [...index.filter((e) => e.id !== id), summaryFromActivity(patched, files)]);
    await writeTextFile(dirHandle, files.json, JSON.stringify(patched, null, 2));
    return patched;
  });
}

/** Supprime une activité (fichier source + JSON) et met à jour l'index. */
export function deleteActivity(rootHandle, id) {
  return withStoreLock(rootHandle, () => deleteActivityUnlocked(rootHandle, id));
}

async function deleteActivityUnlocked(rootHandle, id) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const activity = await loadActivityDetailUnlocked(rootHandle, id);
  const base = baseFilename(activity);

  await dirHandle.removeEntry(`${base}.json`).catch(() => {});
  if (activity.source.storedFilename) {
    await dirHandle.removeEntry(activity.source.storedFilename).catch(() => {});
  }

  const index = (await readIndex(dirHandle)) || [];
  await writeIndex(dirHandle, index.filter((e) => e.id !== id));
}
