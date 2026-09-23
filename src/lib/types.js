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
 * @property {'gpx'|'fit'|'demo'|'strava'} type - Type de fichier source
 * @property {string|null} originalFilename - Nom du fichier tel qu'importé par l'utilisateur (`null` pour Strava : pas de fichier local)
 * @property {string|null} storedFilename - Nom du fichier original conservé dans data/activities/ (`null` pour Strava)
 * @property {string|null} sourceId - Identifiant de l'activité chez le fournisseur distant (ex. id d'activité Strava) ; `null` pour gpx/fit/demo
 * @property {string|null} athleteId - Identifiant de l'athlète chez le fournisseur distant (ex. id athlète Strava) ; `null` pour gpx/fit/demo
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
 * @property {boolean} hasMeasuredDistance - true si une distance mesurée par le device
 *   (ex. FIT) est disponible en plus de la distance recalculée par notre moteur
 * @property {boolean} hasMeasuredSpeed - true si une vitesse mesurée par le device
 *   (ex. FIT) est disponible en plus de la vitesse recalculée par notre moteur
 */

/**
 * @typedef {Object} ActivitySample
 * @property {string|null} timestamp - Horodatage ISO 8601 (mesuré)
 * @property {number} latitude - Latitude en degrés (mesuré)
 * @property {number} longitude - Longitude en degrés (mesuré)
 * @property {number|null} altitude - Altitude en mètres, lissée (mesuré)
 * @property {number|null} speed - Vitesse en km/h, recalculée par notre moteur à partir
 *   des positions/horodatages (calculé — voir aussi `speedMeasured`)
 * @property {number|null} heartRate - Fréquence cardiaque en bpm (mesuré)
 * @property {number|null} cadence - Cadence en rpm (mesuré)
 * @property {number|null} power - Puissance en watts (mesuré ou estimé — voir flags.powerEstimated)
 * @property {number|null} temperature - Température en °C (mesuré)
 * @property {number|null} distanceMeasured - Distance cumulée en km telle que mesurée par
 *   le device source (ex. FIT `record.distance`) ; `null` si la source ne la fournit pas
 *   (ex. GPX). Ne remplace jamais la distance recalculée — voir `Activity.distance`.
 * @property {number|null} speedMeasured - Vitesse instantanée en km/h telle que mesurée
 *   par le device source (ex. FIT `record.speed`) ; `null` si la source ne la fournit pas.
 */

/**
 * @typedef {Object} Activity
 * @property {string} id - Identifiant unique de l'activité
 * @property {string|null} name - Nom de l'activité (issu du fichier ou renommé par l'utilisateur)
 * @property {string|null} date - Date/heure de début en ISO 8601 (mesuré ; null si le fichier source n'a pas d'horodatage)
 * @property {'cycling'|'mtb'|'gravel'|'other'} sportType - Type de pratique
 * @property {ActivitySource} source - Informations sur la source des données
 * @property {number} analysisVersion - Version du moteur d'analyse utilisée
 * @property {number} distance - Distance totale en km, recalculée par notre moteur (calculé ;
 *   voir aussi `distanceMeasured` quand la source fournit sa propre mesure)
 * @property {number|null} distanceMeasured - Distance totale en km telle que mesurée par le
 *   device source (ex. total FIT `session.total_distance`) ; `null` si absente de la source
 *   (ex. GPX). Ne remplace jamais `distance` : les deux coexistent pour comparaison.
 * @property {number|null} duration - Durée totale en secondes (calculé)
 * @property {number|null} movingTime - Temps en mouvement en secondes (calculé)
 * @property {number|null} elevationGain - Dénivelé positif en mètres (calculé)
 * @property {number|null} elevationLoss - Dénivelé négatif en mètres (calculé)
 * @property {number|null} avgSpeed - Vitesse moyenne en km/h, recalculée par notre moteur (calculé)
 * @property {number|null} maxSpeed - Vitesse maximale en km/h, recalculée par notre moteur (calculé)
 * @property {number|null} avgSpeedMeasured - Vitesse moyenne en km/h mesurée par le device
 *   source (ex. FIT `session.avg_speed`) ; `null` si absente de la source
 * @property {number|null} maxSpeedMeasured - Vitesse maximale en km/h mesurée par le device
 *   source (ex. FIT `session.max_speed`) ; `null` si absente de la source
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
      sourceId: null,
      athleteId: null,
    },
    analysisVersion: ANALYSIS_VERSION,

    distance: 0,
    distanceMeasured: null,
    duration: null,
    movingTime: null,
    elevationGain: null,
    elevationLoss: null,
    avgSpeed: null,
    maxSpeed: null,
    avgSpeedMeasured: null,
    maxSpeedMeasured: null,
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
      hasMeasuredDistance: false,
      hasMeasuredSpeed: false,
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
