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

async function writeTextFile(dirHandle, filename, content) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFile(dirHandle, filename) {
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
    elevationGain: activity.elevationGain,
    avgSpeed: activity.avgSpeed,
    avgHeartRate: activity.avgHeartRate,
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
export async function rebuildIndex(rootHandle) {
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
export async function saveActivity(rootHandle, activity, sourceFileContent, sourceExt = "gpx") {
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

  const index = (await readIndex(dirHandle)) || (await rebuildIndex(rootHandle));
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

/** Supprime une activité (fichier source + JSON) et met à jour l'index. */
export async function deleteActivity(rootHandle, id) {
  const dirHandle = await getActivitiesDir(rootHandle);
  const activity = await loadActivityDetail(rootHandle, id);
  const base = baseFilename(activity);

  await dirHandle.removeEntry(`${base}.json`).catch(() => {});
  if (activity.source.storedFilename) {
    await dirHandle.removeEntry(activity.source.storedFilename).catch(() => {});
  }

  const index = (await readIndex(dirHandle)) || [];
  await writeIndex(dirHandle, index.filter((e) => e.id !== id));
}
