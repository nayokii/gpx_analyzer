/**
 * Fonctions utilitaires réutilisables
 *
 * Ce module contient des fonctions mathématiques et de traitement de données
 * utilisées dans toute l'application.
 */

/**
 * Rayon de la Terre en mètres
 */
export const R_EARTH = 6371000;

/**
 * Calcule la distance entre deux points GPS en utilisant la formule de Haversine
 *
 * @param {number} lat1 - Latitude du premier point en degrés
 * @param {number} lon1 - Longitude du premier point en degrés
 * @param {number} lat2 - Latitude du second point en degrés
 * @param {number} lon2 - Longitude du second point en degrés
 * @returns {number} Distance en mètres
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Lisse un tableau de valeurs en appliquant une moyenne mobile
 *
 * @param {Array<number|null>} arr - Tableau de valeurs à lisser
 * @param {number} windowSize - Taille de la fenêtre de lissage
 * @returns {Array<number|null>} Tableau lissé
 */
export function smoothArray(arr, windowSize) {
  const n = arr.length;
  const out = new Array(n);
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    let sum = 0,
      count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (arr[j] != null && !isNaN(arr[j])) {
        sum += arr[j];
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : null;
  }

  return out;
}

/**
 * Calcule la moyenne d'un tableau de valeurs en ignorant les valeurs null/NaN
 *
 * @param {Array<number|null>} arr - Tableau de valeurs
 * @returns {number|null} Moyenne ou null si aucune valeur valide
 */
export function avg(arr) {
  const clean = (arr || []).filter((v) => v != null && !isNaN(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/**
 * Calcule la médiane d'un tableau de valeurs
 *
 * @param {Array<number>} arr - Tableau de valeurs
 * @returns {number|null} Médiane ou null si tableau vide
 */
export function median(arr) {
  const clean = (arr || []).filter((v) => v != null && !isNaN(v));
  if (clean.length === 0) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Décime un tableau pour réduire le nombre de points
 * Utile pour optimiser l'affichage de graphiques
 *
 * @param {Array} arr - Tableau à décimer
 * @param {number} maxPoints - Nombre maximum de points souhaités
 * @returns {Array} Tableau décimé
 */
export function decimate(arr, maxPoints) {
  if (!arr || arr.length <= maxPoints) return arr || [];

  const step = arr.length / maxPoints;
  const out = [];

  for (let i = 0; i < maxPoints; i++) {
    out.push(arr[Math.floor(i * step)]);
  }

  // Toujours inclure le dernier point
  out.push(arr[arr.length - 1]);

  return out;
}

/**
 * Formate un nombre avec 1 décimale
 *
 * @param {number|null} v - Valeur à formater
 * @returns {string} Valeur formatée ou "—"
 */
export function fmt1(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Formate un nombre entier
 *
 * @param {number|null} v - Valeur à formater
 * @returns {string} Valeur formatée ou "—"
 */
export function fmtInt(v) {
  if (v == null || isNaN(v)) return "—";
  return Math.round(v).toLocaleString("fr-FR");
}

/**
 * Formate une durée en secondes au format compact (ex: 1h23 ou 12:45)
 *
 * @param {number|null} sec - Durée en secondes
 * @returns {string} Durée formatée ou "—"
 */
export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Formate une durée en secondes au format long (ex: 1 h 23 min 45 s)
 *
 * @param {number|null} sec - Durée en secondes
 * @returns {string} Durée formatée ou "—"
 */
export function fmtDurationLong(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} h`);
  if (h > 0 || m > 0) parts.push(`${m} min`);
  if (h === 0) parts.push(`${s} s`);
  return parts.join(" ");
}

/**
 * Formate une heure au format HH:MM:SS
 *
 * @param {Date|null} date - Date à formater
 * @returns {string} Heure formatée ou "—"
 */
export function fmtClock(date) {
  if (!date) return "—";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Formate une date complète (ex: lundi 20 septembre 2026)
 *
 * @param {Date|null} date - Date à formater
 * @returns {string} Date formatée ou "—"
 */
export function fmtDateFull(date) {
  if (!date) return "—";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * Calcule l'écart-type d'un tableau de valeurs
 *
 * @param {Array<number>} arr - Tableau de valeurs
 * @returns {number|null} Écart-type ou null si insuffisant
 */
export function stdDev(arr) {
  const m = avg(arr);
  if (m == null) return null;

  const clean = arr.filter((v) => v != null && !isNaN(v));
  if (clean.length < 2) return null;

  const variance = avg(clean.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * Calcule le coefficient de variation (écart-type / moyenne)
 *
 * @param {Array<number>} arr - Tableau de valeurs
 * @returns {number|null} Coefficient de variation ou null
 */
export function coefficientOfVariation(arr) {
  const m = avg(arr);
  const sd = stdDev(arr);
  if (m == null || sd == null || m === 0) return null;
  return sd / m;
}
