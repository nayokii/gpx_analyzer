/**
 * Calculs et analyses liés à la puissance
 *
 * Ce module contient :
 * - L'estimation de puissance mécanique à partir des données GPS/altitude
 * - Le calcul de la puissance normalisée
 * - Les meilleurs efforts de puissance
 * - L'analyse des zones de puissance
 */

import { avg } from './utils.js';

/**
 * Estime la puissance mécanique développée à partir des paramètres physiques
 *
 * Modèle basé sur :
 * - Résistance gravitationnelle (montée/descente)
 * - Résistance au roulement
 * - Résistance aérodynamique
 * - Force d'inertie (accélération)
 *
 * @param {number} speed - Vitesse en km/h
 * @param {number} grade - Pente en pourcentage
 * @param {number} weight - Poids du cycliste en kg
 * @param {number} bikeWeight - Poids du vélo en kg
 * @param {number} [windSpeed=0] - Vitesse du vent en km/h (positif = vent de face)
 * @param {number} [acceleration=0] - Accélération en m/s²
 * @returns {number} Puissance estimée en watts
 */
export function estimatePower(speed, grade, weight, bikeWeight, windSpeed = 0, acceleration = 0) {
  // Constantes physiques
  const g = 9.81; // gravité m/s²
  const rho = 1.225; // densité de l'air kg/m³
  const Cd = 0.88; // coefficient de traînée (position route)
  const A = 0.445; // surface frontale m²
  const Crr = 0.004; // coefficient de résistance au roulement (route lisse)

  const speedMs = speed / 3.6; // km/h → m/s
  const totalWeight = weight + bikeWeight;
  const gradeRad = Math.atan(grade / 100);

  // Force gravitationnelle (montée/descente)
  const Fg = totalWeight * g * Math.sin(gradeRad);

  // Force de résistance au roulement
  const Fr = totalWeight * g * Math.cos(gradeRad) * Crr;

  // Force de traînée aérodynamique (relative au vent)
  const windMs = windSpeed / 3.6;
  const relativeSpeed = speedMs + windMs;
  const Fa = 0.5 * Cd * A * rho * relativeSpeed * relativeSpeed;

  // Force d'inertie (accélération linéaire, m/s²)
  // Inclut un facteur pour la masse effective des roues en rotation (~1.05).
  const inertFactor = 1.05;
  const Fi = totalWeight * inertFactor * (isFinite(acceleration) ? acceleration : 0);

  // Puissance totale (W) = Force totale × vitesse
  const totalForce = Fg + Fr + Fa + Fi;
  const power = totalForce * speedMs;

  // Retourner puissance en watts (min 0)
  return Math.max(0, power);
}

/**
 * Calcule les meilleurs efforts de puissance pour différentes durées
 *
 * @param {Array} series - Série temporelle avec {elapsed, power}
 * @param {number[]} durations - Durées en secondes (ex: [5, 30, 60, 300, 600, 1200, 3600])
 * @returns {Object} Objet avec clés "s{duration}" contenant {duration, power, startIdx}
 */
export function computeBestPowerEfforts(series, durations) {
  const results = {};

  for (const dur of durations) {
    let best = -Infinity;
    let bestStart = null;

    for (let i = 0; i < series.length; i++) {
      if (series[i].elapsed == null || series[i].power == null) continue;

      // Trouver l'index de fin pour cette durée
      let j = i;
      while (j < series.length && series[j].elapsed - series[i].elapsed < dur) {
        j++;
      }

      if (j >= series.length) break;

      // Calculer la puissance moyenne sur cet intervalle
      const slice = series.slice(i, j).filter(p => p.power != null);
      if (slice.length === 0) continue;

      const avgPower = avg(slice.map(p => p.power));
      if (avgPower > best) {
        best = avgPower;
        bestStart = i;
      }
    }

    if (isFinite(best) && best > 0) {
      results[`s${dur}`] = {
        duration: dur,
        power: best,
        startIdx: bestStart
      };
    }
  }

  return results;
}

/**
 * Calcule le temps passé dans chaque zone de puissance
 *
 * @param {Array} series - Série temporelle avec {elapsed, power}
 * @param {number} ftp - FTP (Functional Threshold Power) en watts
 * @returns {Array|null} Zones avec temps passé, ou null si FTP invalide
 */
export function computePowerZones(series, ftp) {
  if (!ftp || ftp <= 0) return null;

  const zones = [
    { name: "Z1 Récup", min: 0, max: 0.55, time: 0, color: "#4dd9c0" },
    { name: "Z2 Endurance", min: 0.55, max: 0.75, time: 0, color: "#8fd66a" },
    { name: "Z3 Tempo", min: 0.75, max: 0.90, time: 0, color: "#f4b740" },
    { name: "Z4 Seuil", min: 0.90, max: 1.05, time: 0, color: "#e8834a" },
    { name: "Z5 VO2max", min: 1.05, max: 1.20, time: 0, color: "#e8543a" },
    { name: "Z6 Anaérobie", min: 1.20, max: 1.50, time: 0, color: "#c22b1c" },
    { name: "Z7 Sprint", min: 1.50, max: 999, time: 0, color: "#8b1a1a" },
  ];

  for (let i = 1; i < series.length; i++) {
    if (series[i].power == null || series[i].elapsed == null) continue;

    const dt = series[i].elapsed - series[i - 1].elapsed;
    if (dt <= 0) continue;

    const pct = series[i].power / ftp;

    for (const z of zones) {
      if (pct >= z.min && pct < z.max) {
        z.time += dt;
        break;
      }
    }
  }

  return zones;
}

/**
 * Calcule la puissance normalisée (Normalized Power)
 *
 * La puissance normalisée est une estimation de la puissance que vous pourriez
 * maintenir en endurance pour produire le même effet physiologique.
 * Calculée comme la racine 4e de la moyenne des puissances^4 sur 30 secondes.
 *
 * @param {Array} series - Série temporelle avec {elapsed, power}
 * @returns {number|null} Puissance normalisée en watts, ou null si insuffisant
 */
export function computeNormalizedPower(series) {
  const n = series.length;
  if (n < 60) return null; // Besoin d'au moins 60 points

  // Calculer l'intervalle de temps moyen entre les points
  const dts = [];
  for (let i = 1; i < n; i++) {
    const dt = series[i].elapsed - series[i - 1].elapsed;
    if (dt > 0) dts.push(dt);
  }
  const avgDt = avg(dts) || 1;

  // Nombre de points pour une fenêtre de 30 secondes
  const windowCount = Math.max(1, Math.round(30 / avgDt));

  // Calculer la moyenne glissante sur 30 secondes
  const powSeries = series.map((p) => p.power);
  const rolling = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - windowCount + 1);
    const slice = powSeries.slice(lo, i + 1).filter((v) => v != null);
    if (slice.length) rolling.push(avg(slice));
  }

  if (rolling.length <= windowCount) return null;

  // Calculer la moyenne de la puissance^4, puis racine 4e
  const p4 = rolling.map((v) => Math.pow(v, 4));
  const np = Math.pow(avg(p4), 0.25);

  return np;
}

/**
 * Calcule le Variability Index (VI)
 * VI = Normalized Power / Average Power
 * Une valeur proche de 1 indique un effort régulier
 *
 * @param {number} normalizedPower - Puissance normalisée
 * @param {number} avgPower - Puissance moyenne
 * @returns {number|null}
 */
export function computeVariabilityIndex(normalizedPower, avgPower) {
  if (!normalizedPower || !avgPower || avgPower === 0) return null;
  return normalizedPower / avgPower;
}

/**
 * Calcule l'Intensity Factor (IF)
 * IF = Normalized Power / FTP
 * Mesure l'intensité relative de l'effort
 *
 * @param {number} normalizedPower - Puissance normalisée
 * @param {number} ftp - FTP en watts
 * @returns {number|null}
 */
export function computeIntensityFactor(normalizedPower, ftp) {
  if (!normalizedPower || !ftp || ftp === 0) return null;
  return normalizedPower / ftp;
}

/**
 * Calcule le Training Stress Score (TSS)
 * TSS = (durée_sec × NP × IF) / (FTP × 3600) × 100
 *
 * @param {number} durationSec - Durée en secondes
 * @param {number} normalizedPower - Puissance normalisée
 * @param {number} ftp - FTP en watts
 * @returns {number|null}
 */
export function computeTSS(durationSec, normalizedPower, ftp) {
  if (!durationSec || !normalizedPower || !ftp || ftp === 0) return null;
  const intensityFactor = computeIntensityFactor(normalizedPower, ftp);
  if (!intensityFactor) return null;
  return (durationSec * normalizedPower * intensityFactor) / (ftp * 3600) * 100;
}
