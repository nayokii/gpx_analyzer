/**
 * Zones de puissance et de fréquence cardiaque.
 *
 * Réutilise entièrement les moteurs existants :
 * - `computePowerZones` (power.js) pour les 7 zones de puissance standard du
 *   projet (<55 %, 55-75 %, 75-90 %, 90-105 %, 105-120 %, 120-150 %, 150 %+),
 *   inchangées ici — seule la forme du résultat est adaptée.
 * - `computeHRZones` (analysis.js) pour les zones de FC, avec des bornes par
 *   défaut si l'appelant n'en fournit pas (nécessaires pour que le moteur
 *   reste testable seul, indépendamment des réglages UI).
 *
 * Ne présente JAMAIS une puissance estimée comme mesurée : `power.source`
 * reflète `analysis.isEstimatedPower`.
 */

import { computePowerZones } from "../power.js";
import { computeHRZones } from "../analysis.js";

/** Bornes de zones FC par défaut (% de FC max), reprises de celles déjà
 * utilisées dans l'UI (GPXAnalyzer.jsx) — dupliquées ici volontairement pour
 * que le moteur ait un comportement par défaut sans dépendre de l'UI. */
export const DEFAULT_HR_ZONE_BOUNDS = [
  { name: "Z1 Récup", min: 0, max: 60 },
  { name: "Z2 Endurance", min: 60, max: 70 },
  { name: "Z3 Tempo", min: 70, max: 80 },
  { name: "Z4 Seuil", min: 80, max: 90 },
  { name: "Z5 VO2max", min: 90, max: 999 },
];

function withPercentages(zones, totalSec) {
  return zones.map((z) => ({
    name: z.name,
    min: z.min,
    max: z.max,
    seconds: z.time,
    percentage: totalSec > 0 ? (z.time / totalSec) * 100 : null,
  }));
}

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @param {Object} [options]
 * @param {number} [options.ftp] - FTP en watts, requis pour les zones de puissance
 * @param {number} [options.maxHR] - FC max en bpm, requise pour les zones de FC
 * @param {{name: string, min: number, max: number}[]} [options.hrZoneBounds] - Bornes de zones FC (% maxHR)
 * @returns {{power: Object, heartRate: Object}}
 */
export function computeZones(analysis, options = {}) {
  const power = (() => {
    if (!analysis.hasPower || !options.ftp || options.ftp <= 0) {
      return { available: false, source: null, ftp: null, zones: [] };
    }
    const rawZones = computePowerZones(analysis.series, options.ftp);
    if (!rawZones) return { available: false, source: null, ftp: null, zones: [] };
    const totalSec = rawZones.reduce((a, z) => a + z.time, 0);
    return {
      available: true,
      source: analysis.isEstimatedPower ? "estimated" : "measured",
      ftp: options.ftp,
      zones: withPercentages(rawZones, totalSec),
    };
  })();

  const heartRate = (() => {
    if (!analysis.hasHR || !analysis.hasTime || !options.maxHR || options.maxHR <= 0) {
      return { available: false, maxHR: null, zones: [] };
    }
    const bounds = options.hrZoneBounds || DEFAULT_HR_ZONE_BOUNDS;
    const rawZones = computeHRZones(analysis, options.maxHR, bounds);
    if (!rawZones) return { available: false, maxHR: null, zones: [] };
    const totalSec = rawZones.reduce((a, z) => a + z.time, 0);
    return {
      available: true,
      maxHR: options.maxHR,
      zones: withPercentages(rawZones, totalSec),
    };
  })();

  return { power, heartRate };
}
