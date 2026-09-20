/**
 * Génération de résumés en langage naturel à partir d'une analyse
 *
 * Ce module transforme les métriques calculées (computeAnalysis) en phrases
 * lisibles pour l'onglet "Résumé" de l'application.
 */

import { avg } from './utils.js';
import { fmt1, fmtInt, fmtDurationLong, fmtDuration } from './utils.js';

/**
 * Génère un court résumé textuel de la sortie
 *
 * @param {Object} a - Résultat de computeAnalysis
 * @returns {string} Résumé en une à quatre phrases
 */
export function generateSummary(a) {
  const sentences = [];
  let s1 = `Sortie de ${fmt1(a.totalDistanceKm)} km`;
  if (a.hasEle && a.elevGain != null) s1 += ` avec ${fmtInt(a.elevGain)} m de dénivelé positif`;
  s1 += ".";
  sentences.push(s1);
  if (a.avgSpeedKmh != null) {
    let s2 = `La vitesse moyenne en mouvement était de ${fmt1(a.avgSpeedKmh)} km/h`;
    if (a.maxSpeedKmh != null) s2 += `, avec une pointe à ${fmt1(a.maxSpeedKmh)} km/h`;
    s2 += ".";
    sentences.push(s2);
  }
  if (a.climbs && a.climbs.length > 0) {
    const longest = [...a.climbs].sort((x, y) => y.lengthKm - x.lengthKm)[0];
    sentences.push(
      `Le parcours comportait ${a.climbs.length} montée${a.climbs.length > 1 ? "s" : ""} principale${
        a.climbs.length > 1 ? "s" : ""
      }, dont une de ${fmt1(longest.lengthKm)} km à ${fmt1(longest.avgGrade)} % de moyenne.`
    );
  }
  if (a.stops && a.stops.length > 0) {
    sentences.push(
      `${a.stops.length} arrêt${a.stops.length > 1 ? "s" : ""} détecté${
        a.stops.length > 1 ? "s" : ""
      }, pour un total de ${fmtDurationLong(a.stoppedTimeSec)} passé${a.stops.length > 1 ? "s" : ""} à l'arrêt.`
    );
  }
  return sentences.join(" ");
}

/**
 * Détecte des points forts et des faits notables dans une analyse
 *
 * @param {Object} a - Résultat de computeAnalysis
 * @returns {{strengths: string[], notable: string[]}}
 */
export function generateHighlights(a) {
  const strengths = [];
  const notable = [];
  if (a.maxSpeedKmh != null) strengths.push(`Vitesse de pointe atteinte : ${fmt1(a.maxSpeedKmh)} km/h.`);
  if (a.climbs && a.climbs.length > 0) {
    const best = [...a.climbs].sort((x, y) => y.avgGrade - x.avgGrade)[0];
    strengths.push(`Montée la plus soutenue : ${best.name}, ${fmt1(best.avgGrade)} % sur ${fmt1(best.lengthKm)} km.`);
  }
  if (a.bestEfforts && a.bestEfforts.k5) {
    strengths.push(`Meilleur 5 km : ${fmtDuration(a.bestEfforts.k5.duration)} (${fmt1(a.bestEfforts.k5.avgSpeed)} km/h).`);
  }
  if (a.hrStats && a.hrStats.max) strengths.push(`Fréquence cardiaque maximale relevée : ${fmtInt(a.hrStats.max)} bpm.`);
  if (a.splits && a.splits.length > 2) {
    const speeds = a.splits.map((s) => s.avgSpeed).filter((v) => v != null);
    if (speeds.length > 2) {
      const m = avg(speeds);
      const variance = avg(speeds.map((v) => (v - m) ** 2));
      const cv = Math.sqrt(variance) / m;
      if (cv < 0.12) strengths.push("Rythme très régulier sur l'ensemble du parcours (faible variation de vitesse entre les kilomètres).");
    }
  }

  if (a.climbs && a.climbs.length > 0) {
    const steepest = [...a.climbs].sort((x, y) => y.maxGrade - x.maxGrade)[0];
    if (steepest.maxGrade > 10) notable.push(`Passage très raide sur ${steepest.name}, pointe à ${fmt1(steepest.maxGrade)} %.`);
  }
  if (a.stops && a.stops.length > 0) {
    const longest = [...a.stops].sort((x, y) => y.duration - x.duration)[0];
    if (longest.duration > 180) notable.push(`Arrêt prolongé de ${fmtDurationLong(longest.duration)} vers le km ${fmt1(longest.distance)}.`);
  }
  if (a.hasEle && a.elevLoss != null && a.maxSpeedKmh != null && a.maxSpeedKmh > 45) {
    notable.push(`Descente rapide détectée, vitesse maximale de ${fmt1(a.maxSpeedKmh)} km/h.`);
  }
  if (a.splits && a.splits.length > 1) {
    let maxDrop = 0;
    for (let i = 1; i < a.splits.length; i++) {
      const s1 = a.splits[i - 1].avgSpeed,
        s2 = a.splits[i].avgSpeed;
      if (s1 != null && s2 != null) maxDrop = Math.max(maxDrop, s1 - s2);
    }
    if (maxDrop > 8) notable.push("Forte variation de vitesse observée entre deux kilomètres consécutifs.");
  }
  return { strengths, notable };
}
