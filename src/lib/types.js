/**
 * Modèle de données normalisé pour les activités cyclistes
 *
 * Ce modèle unifie les données provenant de différentes sources (GPX, FIT, etc.)
 * et sépare clairement quatre catégories d'information :
 *
 * - MESURÉ    : vient directement d'un capteur du fichier source (fréquence
 *               cardiaque, cadence, puissance si un capteur est présent,
 *               altitude, position GPS, horodatage).
 * - CALCULÉ   : dérivé mathématiquement de données mesurées (distance,
 *               dénivelé, vitesse, durée, puissance normalisée...).
 * - ESTIMÉ    : approximé faute de mesure directe (typiquement la puissance,
 *               modélisée physiquement quand aucun capteur n'est présent).
 *               Toujours signalé via `flags.powerEstimated`, jamais confondu
 *               avec une mesure réelle.
 * - (INTERPRÉTATION : conclusions en langage naturel tirées de ces données —
 *               ne fait pas partie de ce modèle, voir src/lib/narrative.js et,
 *               plus tard, l'analyse par Claude.)
 *
 * Règle absolue : une donnée absente du fichier source ne doit JAMAIS être
 * inventée. Le champ correspondant reste `null`.
 */

/** Version du schéma d'analyse ayant produit une Activity — permet de savoir,
 * des mois plus tard, si une sortie doit être recalculée avec un moteur
 * d'analyse plus récent. */
export const ANALYSIS_VERSION = 1;

/**
 * @typedef {Object} ActivitySource
 * @property {'gpx'|'fit'|'demo'} type - Type de fichier source
 * @property {string|null} originalFilename - Nom du fichier tel qu'importé par l'utilisateur
 * @property {string|null} storedFilename - Nom du fichier original conservé dans data/activities/
 */

/**
 * @typedef {Object} ActivityFlags
 * @property {boolean} hasGps - Présence de coordonnées GPS
 * @property {boolean} hasElevation - Présence de données d'altitude
 * @property {boolean} hasTime - Présence d'horodatage
 * @property {boolean} hasHeartRate - Présence de données de fréquence cardiaque
 * @property {boolean} hasCadence - Présence de données de cadence
 * @property {boolean} hasPower - Présence de données de puissance (mesurée ou estimée)
 * @property {boolean} hasTemperature - Présence de données de température
 * @property {boolean} powerEstimated - true si avgPower/maxPower/normalizedPower proviennent
 *   du modèle physique d'estimation plutôt que d'un capteur de puissance réel
 */

/**
 * @typedef {Object} ActivitySample
 * @property {string|null} timestamp - Horodatage ISO 8601 (mesuré)
 * @property {number} latitude - Latitude en degrés (mesuré)
 * @property {number} longitude - Longitude en degrés (mesuré)
 * @property {number|null} altitude - Altitude en mètres, lissée (mesuré)
 * @property {number|null} speed - Vitesse en km/h (calculé)
 * @property {number|null} heartRate - Fréquence cardiaque en bpm (mesuré)
 * @property {number|null} cadence - Cadence en rpm (mesuré)
 * @property {number|null} power - Puissance en watts (mesuré ou estimé — voir flags.powerEstimated)
 */

/**
 * @typedef {Object} Activity
 * @property {string} id - Identifiant unique de l'activité
 * @property {string|null} name - Nom de l'activité (issu du fichier ou renommé par l'utilisateur)
 * @property {string|null} date - Date/heure de début en ISO 8601 (mesuré ; null si le fichier source n'a pas d'horodatage)
 * @property {'cycling'|'mtb'|'gravel'|'other'} sportType - Type de pratique
 * @property {ActivitySource} source - Informations sur la source des données
 * @property {number} analysisVersion - Version du moteur d'analyse utilisée
 * @property {number} distance - Distance totale en km (calculé)
 * @property {number|null} duration - Durée totale en secondes (calculé)
 * @property {number|null} movingTime - Temps en mouvement en secondes (calculé)
 * @property {number|null} elevationGain - Dénivelé positif en mètres (calculé)
 * @property {number|null} elevationLoss - Dénivelé négatif en mètres (calculé)
 * @property {number|null} avgSpeed - Vitesse moyenne en km/h (calculé)
 * @property {number|null} maxSpeed - Vitesse maximale en km/h (calculé)
 * @property {number|null} avgHeartRate - FC moyenne en bpm (mesuré)
 * @property {number|null} maxHeartRate - FC maximale en bpm (mesuré)
 * @property {number|null} avgCadence - Cadence moyenne en rpm (mesuré)
 * @property {number|null} maxCadence - Cadence maximale en rpm (mesuré)
 * @property {number|null} avgPower - Puissance moyenne en watts (mesuré ou estimé)
 * @property {number|null} maxPower - Puissance maximale en watts (mesuré ou estimé)
 * @property {number|null} normalizedPower - Puissance normalisée en watts (calculé)
 * @property {ActivityFlags} flags - Disponibilité des données + distinction mesuré/estimé
 * @property {{lat: number, lon: number}[]} gpsTrack - Trace GPS brute (rendu carte léger)
 * @property {ActivitySample[]} samples - Série temporelle complète
 */

/**
 * Crée un objet Activity vide avec des valeurs par défaut sûres (aucune
 * donnée inventée : tout ce qui n'est pas encore connu est `null`/vide).
 * @returns {Activity}
 */
export function createEmptyActivity() {
  return {
    id: generateId(),
    name: null,
    date: null,
    sportType: "cycling",
    source: {
      type: "gpx",
      originalFilename: null,
      storedFilename: null,
    },
    analysisVersion: ANALYSIS_VERSION,

    distance: 0,
    duration: null,
    movingTime: null,
    elevationGain: null,
    elevationLoss: null,
    avgSpeed: null,
    maxSpeed: null,
    avgHeartRate: null,
    maxHeartRate: null,
    avgCadence: null,
    maxCadence: null,
    avgPower: null,
    maxPower: null,
    normalizedPower: null,

    flags: {
      hasGps: false,
      hasElevation: false,
      hasTime: false,
      hasHeartRate: false,
      hasCadence: false,
      hasPower: false,
      hasTemperature: false,
      powerEstimated: false,
    },

    gpsTrack: [],
    samples: [],
  };
}

/**
 * Génère un identifiant unique pour une activité.
 * Format : timestamp-random
 * @returns {string}
 */
export function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}

/**
 * Valide qu'un objet correspond au modèle Activity
 * @param {any} obj - Objet à valider
 * @returns {boolean}
 */
export function isValidActivity(obj) {
  if (!obj || typeof obj !== "object") return false;

  return (
    typeof obj.id === "string" &&
    typeof obj.sportType === "string" &&
    obj.source && typeof obj.source === "object" &&
    obj.flags && typeof obj.flags === "object" &&
    Array.isArray(obj.gpsTrack) &&
    Array.isArray(obj.samples)
  );
}
