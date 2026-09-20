/**
 * Modèle de données normalisé pour les activités cyclistes
 *
 * Ce modèle unifie les données provenant de différentes sources (GPX, FIT, etc.)
 * et sépare clairement :
 * - les données mesurées (du fichier source)
 * - les données calculées (dénivelé, vitesse moyenne, etc.)
 * - les données estimées (puissance estimée, etc.)
 */

/**
 * @typedef {Object} ActivitySource
 * @property {'gpx'|'fit'|'demo'} type - Type de fichier source
 * @property {string} [filename] - Nom du fichier original
 * @property {string} [name] - Nom de l'activité (du fichier ou défini par l'utilisateur)
 */

/**
 * @typedef {Object} ActivityMetrics
 * @property {number} distance - Distance totale en km
 * @property {number|null} duration - Durée totale en secondes
 * @property {number|null} moving_time - Temps en mouvement en secondes
 * @property {number|null} stopped_time - Temps à l'arrêt en secondes
 * @property {number|null} elevation_gain - Dénivelé positif en mètres
 * @property {number|null} elevation_loss - Dénivelé négatif en mètres
 * @property {number|null} max_elevation - Altitude maximale en mètres
 * @property {number|null} min_elevation - Altitude minimale en mètres
 * @property {number|null} avg_speed - Vitesse moyenne en km/h (en mouvement)
 * @property {number|null} max_speed - Vitesse maximale en km/h
 * @property {number|null} avg_heart_rate - Fréquence cardiaque moyenne en bpm
 * @property {number|null} max_heart_rate - Fréquence cardiaque maximale en bpm
 * @property {number|null} avg_cadence - Cadence moyenne en rpm
 * @property {number|null} max_cadence - Cadence maximale en rpm
 * @property {number|null} avg_power - Puissance moyenne en watts
 * @property {number|null} max_power - Puissance maximale en watts
 * @property {number|null} normalized_power - Puissance normalisée en watts
 * @property {number|null} avg_temperature - Température moyenne en °C
 * @property {number|null} max_temperature - Température maximale en °C
 * @property {number|null} min_temperature - Température minimale en °C
 */

/**
 * @typedef {Object} ActivityFlags
 * @property {boolean} has_gps - Présence de coordonnées GPS
 * @property {boolean} has_elevation - Présence de données d'altitude
 * @property {boolean} has_time - Présence d'horodatage
 * @property {boolean} has_heart_rate - Présence de données de fréquence cardiaque
 * @property {boolean} has_cadence - Présence de données de cadence
 * @property {boolean} has_power - Présence de données de puissance
 * @property {boolean} has_temperature - Présence de données de température
 * @property {boolean} power_estimated - La puissance est estimée (non mesurée)
 */

/**
 * @typedef {Object} ActivitySample
 * @property {number} idx - Index dans la série
 * @property {number} lat - Latitude en degrés
 * @property {number} lon - Longitude en degrés
 * @property {number} distance - Distance cumulée en km
 * @property {number|null} ele - Altitude en mètres (lissée)
 * @property {number|null} speed - Vitesse en km/h
 * @property {number|null} grade - Pente en pourcentage
 * @property {Date|null} time - Horodatage
 * @property {number|null} elapsed - Temps écoulé depuis le début en secondes
 * @property {number|null} hr - Fréquence cardiaque en bpm
 * @property {number|null} cad - Cadence en rpm
 * @property {number|null} power - Puissance en watts
 * @property {number|null} temp - Température en °C
 */

/**
 * @typedef {Object} Climb
 * @property {number} id - Identifiant unique de la montée
 * @property {string} name - Nom de la montée
 * @property {number} startDistance - Distance de début en km
 * @property {number} endDistance - Distance de fin en km
 * @property {number} lengthKm - Longueur en km
 * @property {number} gain - Dénivelé positif en mètres
 * @property {number} avgGrade - Pente moyenne en %
 * @property {number} maxGrade - Pente maximale en %
 * @property {number} startEle - Altitude de départ en mètres
 * @property {number} endEle - Altitude d'arrivée en mètres
 * @property {number|null} duration - Durée en secondes
 * @property {number|null} avgSpeed - Vitesse moyenne en km/h
 * @property {number|null} avgHR - FC moyenne en bpm
 * @property {number|null} avgPower - Puissance moyenne en watts
 * @property {number} startIdx - Index du premier point
 * @property {number} endIdx - Index du dernier point
 */

/**
 * @typedef {Object} Split
 * @property {number} km - Numéro du kilomètre
 * @property {number|null} time - Temps pour ce kilomètre en secondes
 * @property {number|null} avgSpeed - Vitesse moyenne en km/h
 * @property {number|null} avgEle - Altitude moyenne en mètres
 * @property {number|null} gain - Dénivelé positif en mètres
 * @property {number|null} avgHR - FC moyenne en bpm
 * @property {number|null} avgCad - Cadence moyenne en rpm
 * @property {number|null} avgPower - Puissance moyenne en watts
 */

/**
 * @typedef {Object} Stop
 * @property {number} startIdx - Index du début de l'arrêt
 * @property {number} endIdx - Index de la fin de l'arrêt
 * @property {number} duration - Durée de l'arrêt en secondes
 * @property {number} distance - Distance où l'arrêt a eu lieu en km
 * @property {number} lat - Latitude de l'arrêt
 * @property {number} lon - Longitude de l'arrêt
 */

/**
 * @typedef {Object} BestEffort
 * @property {number} duration - Durée de l'effort en secondes
 * @property {number} startDistance - Distance de début en km
 * @property {number} avgSpeed - Vitesse moyenne en km/h
 */

/**
 * @typedef {Object} PowerZone
 * @property {string} name - Nom de la zone
 * @property {number} min - Limite inférieure en % de FTP
 * @property {number} max - Limite supérieure en % de FTP
 * @property {number} time - Temps passé dans cette zone en secondes
 * @property {string} color - Couleur pour l'affichage
 */

/**
 * @typedef {Object} HRZone
 * @property {string} name - Nom de la zone
 * @property {number} min - Limite inférieure en % de FC max
 * @property {number} max - Limite supérieure en % de FC max
 * @property {number} time - Temps passé dans cette zone en secondes
 * @property {string} color - Couleur pour l'affichage
 */

/**
 * @typedef {Object} ComputedData
 * @property {Climb[]} climbs - Montées détectées
 * @property {Split[]} splits - Splits par kilomètre
 * @property {Stop[]} stops - Arrêts détectés
 * @property {Object|null} best_efforts - Meilleurs efforts par distance
 * @property {PowerZone[]|null} power_zones - Temps par zone de puissance
 * @property {HRZone[]|null} hr_zones - Temps par zone de fréquence cardiaque
 */

/**
 * @typedef {Object} Activity
 * @property {string} id - Identifiant unique de l'activité
 * @property {Date} date - Date et heure de début de l'activité
 * @property {Date|null} end_date - Date et heure de fin de l'activité
 * @property {'cycling'|'mtb'|'gravel'|'other'} sport_type - Type de pratique
 * @property {ActivitySource} source - Informations sur la source des données
 * @property {ActivityMetrics} metrics - Métriques calculées
 * @property {ActivityFlags} flags - Indicateurs de présence de données
 * @property {ActivitySample[]} samples - Série temporelle complète
 * @property {ComputedData} computed - Données calculées (montées, splits, etc.)
 */

/**
 * Crée un objet Activity vide avec des valeurs par défaut
 * @returns {Activity}
 */
export function createEmptyActivity() {
  return {
    id: generateId(),
    date: new Date(),
    end_date: null,
    sport_type: 'cycling',
    source: {
      type: 'gpx',
      filename: null,
      name: null,
    },
    metrics: {
      distance: 0,
      duration: null,
      moving_time: null,
      stopped_time: null,
      elevation_gain: null,
      elevation_loss: null,
      max_elevation: null,
      min_elevation: null,
      avg_speed: null,
      max_speed: null,
      avg_heart_rate: null,
      max_heart_rate: null,
      avg_cadence: null,
      max_cadence: null,
      avg_power: null,
      max_power: null,
      normalized_power: null,
      avg_temperature: null,
      max_temperature: null,
      min_temperature: null,
    },
    flags: {
      has_gps: false,
      has_elevation: false,
      has_time: false,
      has_heart_rate: false,
      has_cadence: false,
      has_power: false,
      has_temperature: false,
      power_estimated: false,
    },
    samples: [],
    computed: {
      climbs: [],
      splits: [],
      stops: [],
      best_efforts: null,
      power_zones: null,
      hr_zones: null,
    },
  };
}

/**
 * Génère un identifiant unique pour une activité
 * Format : timestamp-random
 * @returns {string}
 */
function generateId() {
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
  if (!obj || typeof obj !== 'object') return false;

  return (
    typeof obj.id === 'string' &&
    obj.date instanceof Date &&
    typeof obj.sport_type === 'string' &&
    obj.source && typeof obj.source === 'object' &&
    obj.metrics && typeof obj.metrics === 'object' &&
    obj.flags && typeof obj.flags === 'object' &&
    Array.isArray(obj.samples) &&
    obj.computed && typeof obj.computed === 'object'
  );
}
