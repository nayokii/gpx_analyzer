/**
 * Normalisation : transforme le résultat de computeAnalysis() (+ les points
 * bruts et des métadonnées de source) en un objet Activity conforme au
 * modèle défini dans ./types.js.
 *
 * Voir types.js pour la distinction mesuré / calculé / estimé. Cette fonction
 * ne fait que recopier les valeurs déjà produites par analysis.js : elle
 * n'invente jamais de donnée absente (un champ non disponible reste `null`).
 */

import { createEmptyActivity } from "./types.js";

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @param {Array} points - Points bruts ayant servi à l'analyse (avec lat/lon)
 * @param {Object} [meta] - Métadonnées de source
 * @param {string|null} [meta.id] - Identifiant à réutiliser (ex: recalcul d'une sortie existante)
 * @param {string|null} [meta.name] - Nom de l'activité
 * @param {'cycling'|'mtb'|'gravel'|'other'} [meta.sportType]
 * @param {'gpx'|'fit'|'demo'|'strava'} [meta.sourceType]
 * @param {string|null} [meta.originalFilename]
 * @param {{distanceKm: number|null, avgSpeedKmh: number|null, maxSpeedKmh: number|null}|null} [meta.measured] -
 *   Totaux mesurés par le device source (ex. session FIT), quand disponibles. `null`/absent
 *   pour une source qui ne les fournit pas (ex. GPX) — jamais recalculés ici.
 * @returns {import('./types.js').Activity}
 */
export function toActivity(analysis, points, meta = {}) {
  const activity = createEmptyActivity();

  if (meta.id) activity.id = meta.id;
  activity.name = meta.name || null;
  activity.date = analysis.startTime ? analysis.startTime.toISOString() : null;
  activity.sportType = meta.sportType || "cycling";
  activity.source = {
    type: meta.sourceType || "gpx",
    originalFilename: meta.originalFilename || null,
    storedFilename: null, // renseigné par le module de stockage au moment de la sauvegarde
    sourceId: null, // renseigné par l'adaptateur source le cas échéant (ex. strava/adapter.js)
    athleteId: null,
  };

  activity.distance = analysis.totalDistanceKm;
  activity.distanceMeasured = meta.measured && meta.measured.distanceKm != null ? meta.measured.distanceKm : null;
  activity.duration = analysis.totalTimeSec;
  activity.movingTime = analysis.movingTimeSec;
  activity.elevationGain = analysis.elevGain;
  activity.elevationLoss = analysis.elevLoss;
  activity.avgSpeed = analysis.avgSpeedKmh;
  activity.maxSpeed = analysis.maxSpeedKmh;
  activity.avgSpeedMeasured = meta.measured && meta.measured.avgSpeedKmh != null ? meta.measured.avgSpeedKmh : null;
  activity.maxSpeedMeasured = meta.measured && meta.measured.maxSpeedKmh != null ? meta.measured.maxSpeedKmh : null;
  activity.avgHeartRate = analysis.hrStats ? analysis.hrStats.avg : null;
  activity.maxHeartRate = analysis.hrStats ? analysis.hrStats.max : null;
  activity.avgCadence = analysis.cadStats ? analysis.cadStats.avg : null;
  activity.maxCadence = analysis.cadStats ? analysis.cadStats.max : null;
  activity.avgPower = analysis.powerStats ? analysis.powerStats.avg : null;
  activity.maxPower = analysis.powerStats ? analysis.powerStats.max : null;
  activity.normalizedPower = analysis.powerStats ? analysis.powerStats.np : null;

  activity.flags = {
    hasGps: true, // computeAnalysis exige déjà des points GPS valides en entrée
    hasElevation: analysis.hasEle,
    hasTime: analysis.hasTime,
    hasHeartRate: analysis.hasHR,
    hasCadence: analysis.hasCad,
    hasPower: analysis.hasPower,
    hasTemperature: analysis.hasTemp,
    powerEstimated: !!analysis.isEstimatedPower,
    hasMeasuredDistance: activity.distanceMeasured != null,
    hasMeasuredSpeed: activity.avgSpeedMeasured != null || activity.maxSpeedMeasured != null,
  };

  activity.gpsTrack = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  activity.samples = analysis.series.map((p) => ({
    timestamp: p.time ? p.time.toISOString() : null,
    latitude: p.lat,
    longitude: p.lon,
    altitude: p.ele,
    speed: p.speed,
    heartRate: p.hr,
    cadence: p.cad,
    power: p.power,
    temperature: p.temp,
    distanceMeasured: p.distanceMeasured,
    speedMeasured: p.speedMeasured,
  }));

  return activity;
}
