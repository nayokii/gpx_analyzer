/**
 * Interface unifiée pour l'import d'activités
 *
 * Ce module expose une API commune pour importer des activités depuis
 * différents formats (GPX, FIT) et les convertir en points bruts exploitables
 * par analysis.js/normalize.js, quel que soit le format source.
 */

import { parseGPXString, isGPXFile, extractGPXMetadata } from './gpxParser.js';
import { parseFITArrayBuffer, isFITFile } from './fitParser.js';

/**
 * Formats de fichiers supportés
 */
export const SUPPORTED_FORMATS = {
  GPX: 'gpx',
  FIT: 'fit',
};

/**
 * Détecte le format d'un fichier par signature binaire/contenu réel plutôt
 * que par la seule extension : vérifie d'abord la signature FIT (".FIT" aux
 * octets 8-11 du header), puis retombe sur une lecture texte pour reconnaître
 * un GPX (balises XML `<gpx>`). L'extension n'intervient qu'en dernier
 * recours, si aucune signature n'a pu être vérifiée.
 *
 * @param {File|Blob} file
 * @returns {Promise<string|null>} Format détecté ('gpx', 'fit') ou null
 */
export async function detectFileFormat(file) {
  const buffer = await file.arrayBuffer();
  if (isFITFile(buffer)) return SUPPORTED_FORMATS.FIT;

  try {
    const text = await file.text();
    if (isGPXFile(text)) return SUPPORTED_FORMATS.GPX;
  } catch {
    // Fichier non lisible comme texte (probablement binaire mais pas FIT) :
    // on retombe sur l'extension ci-dessous plutôt que d'échouer ici.
  }

  const ext = file.name ? file.name.split('.').pop()?.toLowerCase() : null;
  if (ext === 'fit') return SUPPORTED_FORMATS.FIT;
  if (ext === 'gpx') return SUPPORTED_FORMATS.GPX;
  return null;
}

/**
 * Détecte puis parse un fichier d'activité, en utilisant la méthode de
 * lecture adaptée à chaque format : `file.text()` pour GPX, `file.arrayBuffer()`
 * pour FIT (jamais l'inverse — un FIT ne doit pas être traité comme du texte).
 *
 * @param {File|Blob} file
 * @returns {Promise<{
 *   format: string,
 *   name: string|null,
 *   points: Array,
 *   measured: {distanceKm: number|null, avgSpeedKmh: number|null, maxSpeedKmh: number|null}|null,
 *   sourceText: string|null,
 *   sourceArrayBuffer: ArrayBuffer|null,
 * }>}
 * @throws {Error} Si le format n'est pas reconnu ou si le parsing échoue
 */
export async function parseActivityFileAuto(file) {
  const format = await detectFileFormat(file);

  if (format === SUPPORTED_FORMATS.FIT) {
    const arrayBuffer = await file.arrayBuffer();
    const { name, points, measured } = parseFITArrayBuffer(arrayBuffer);
    return { format, name, points, measured, sourceText: null, sourceArrayBuffer: arrayBuffer };
  }

  if (format === SUPPORTED_FORMATS.GPX) {
    const text = await file.text();
    const { name, points } = parseGPXString(text);
    return { format, name, points, measured: null, sourceText: text, sourceArrayBuffer: null };
  }

  throw new Error('Format de fichier non reconnu. Formats supportés : .gpx, .fit');
}

/**
 * Extrait les métadonnées d'un fichier sans le parser complètement
 * Utile pour afficher un aperçu avant l'import complet
 *
 * @param {string} content - Contenu du fichier (texte, GPX uniquement)
 * @param {string} format - Format du fichier
 * @returns {{name: string|null, pointCount: number, hasTime: boolean}}
 */
export function extractMetadata(content, format) {
  switch (format) {
    case SUPPORTED_FORMATS.GPX:
      return extractGPXMetadata(content);

    default:
      return { name: null, pointCount: 0, hasTime: false };
  }
}

/**
 * Vérifie si un format est supporté
 *
 * @param {string} format - Format à vérifier
 * @returns {boolean}
 */
export function isFormatSupported(format) {
  return Object.values(SUPPORTED_FORMATS).includes(format);
}

/**
 * Retourne les extensions de fichiers acceptées
 *
 * @returns {string[]} Liste des extensions (ex: ['gpx', 'fit'])
 */
export function getSupportedExtensions() {
  return Object.values(SUPPORTED_FORMATS);
}

/**
 * Retourne la chaîne d'extensions pour l'attribut "accept" d'un input file
 *
 * @returns {string} Ex: ".gpx,.fit"
 */
export function getAcceptString() {
  return getSupportedExtensions().map(ext => `.${ext}`).join(',');
}
