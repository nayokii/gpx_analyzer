/**
 * Interface unifiée pour l'import d'activités
 *
 * Ce module expose une API commune pour importer des activités depuis
 * différents formats (GPX, FIT, etc.) et les convertir en objets Activity normalisés.
 */

import { parseGPXString, isGPXFile, extractGPXMetadata } from './gpxParser.js';

/**
 * Formats de fichiers supportés
 */
export const SUPPORTED_FORMATS = {
  GPX: 'gpx',
  FIT: 'fit', // Préparé pour le futur, pas encore implémenté
};

/**
 * Détecte automatiquement le format d'un fichier
 *
 * @param {string} content - Contenu du fichier
 * @param {string} [filename] - Nom du fichier (optionnel, aide à la détection)
 * @returns {string|null} Format détecté ('gpx', 'fit') ou null si non reconnu
 */
export function detectFormat(content, filename = null) {
  // Détection par extension si disponible
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'gpx' && isGPXFile(content)) return SUPPORTED_FORMATS.GPX;
    if (ext === 'fit') return SUPPORTED_FORMATS.FIT;
  }

  // Détection par contenu
  if (isGPXFile(content)) return SUPPORTED_FORMATS.GPX;

  // FIT est un format binaire, vérification par signature (à implémenter)
  // if (isFITFile(content)) return SUPPORTED_FORMATS.FIT;

  return null;
}

/**
 * Parse un fichier d'activité et retourne les points bruts
 *
 * @param {string} content - Contenu du fichier
 * @param {string} format - Format du fichier ('gpx', 'fit')
 * @returns {{name: string|null, points: Array}} Nom et points de l'activité
 * @throws {Error} Si le format n'est pas supporté ou si le parsing échoue
 */
export function parseActivityFile(content, format) {
  switch (format) {
    case SUPPORTED_FORMATS.GPX:
      return parseGPXString(content);

    case SUPPORTED_FORMATS.FIT:
      throw new Error(
        'Le format FIT n\'est pas encore supporté. ' +
        'Veuillez fournir un fichier GPX ou attendre l\'implémentation du support FIT.'
      );

    default:
      throw new Error(`Format non supporté : ${format}`);
  }
}

/**
 * Extrait les métadonnées d'un fichier sans le parser complètement
 * Utile pour afficher un aperçu avant l'import complet
 *
 * @param {string} content - Contenu du fichier
 * @param {string} format - Format du fichier
 * @returns {{name: string|null, pointCount: number, hasTime: boolean}}
 */
export function extractMetadata(content, format) {
  switch (format) {
    case SUPPORTED_FORMATS.GPX:
      return extractGPXMetadata(content);

    case SUPPORTED_FORMATS.FIT:
      return { name: null, pointCount: 0, hasTime: false };

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
