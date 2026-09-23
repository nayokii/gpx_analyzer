/**
 * Adaptateur Strava → Activity : convertit une SummaryActivity + ses flux
 * (streams) Strava en objet `Activity` conforme au modèle existant (voir
 * ../types.js et ../normalize.js).
 *
 * Principe directeur (voir consigne) : cet adaptateur ne fait QUE mettre les
 * données Strava dans la même forme que les points produits par les parsers
 * GPX/FIT (`{lat, lon, ele, time, hr, cad, power, temp, distanceMeasured,
 * speedMeasured}`), puis réutilise TEL QUEL le moteur existant
 * (`computeAnalysis` + `toActivity`, voir ../analysis.js et ../normalize.js).
 * Aucune donnée n'est inventée : un flux absent de la réponse Strava laisse
 * le champ correspondant `null` sur chaque point, exactement comme un GPX
 * sans capteur de puissance laisse `power: null` (auquel cas c'est le moteur
 * EXISTANT, pas cet adaptateur, qui décide ensuite d'estimer la puissance —
 * voir analysis.js: computePowerData).
 */

import { computeAnalysis } from "../analysis.js";
import { toActivity } from "../normalize.js";
import { mapStravaSportType } from "./types.js";
import { StravaMalformedDataError } from "./errors.js";

function metersToKm(m) {
  return m != null ? m / 1000 : null;
}

function msToKmh(ms) {
  return ms != null ? ms * 3.6 : null;
}

/**
 * Convertit les streams Strava (`key_by_type: true`) en points exploitables
 * par `computeAnalysis`. Lève si `latlng` est absent : le moteur d'analyse
 * exige des positions GPS (voir ../types.js, commentaire `hasGps`) — une
 * activité Strava enregistrée sans GPS (home trainer sans capteur GPS) ne
 * peut donc pas être importée par cette voie ; c'est signalé comme erreur
 * partielle par sync.js plutôt que de fabriquer des positions.
 *
 * @param {Object} streams - réponse de getActivityStreams() (api.js)
 * @param {string} startDateIso - `start_date` (UTC) de la SummaryActivity
 * @returns {Array} points au format {lat, lon, ele, time, hr, cad, power, temp, distanceMeasured, speedMeasured}
 * @throws {StravaMalformedDataError} si le flux `latlng` est absent
 */
export function stravaStreamsToPoints(streams, startDateIso) {
  const latlng = streams?.latlng?.data;
  if (!Array.isArray(latlng) || latlng.length === 0) {
    throw new StravaMalformedDataError("Flux GPS (latlng) absent : activité non géolocalisée, non importable par cette voie.");
  }

  const n = latlng.length;
  const startMs = startDateIso ? new Date(startDateIso).getTime() : null;
  const timeData = streams?.time?.data; // secondes écoulées depuis le début, mesuré
  const altData = streams?.altitude?.data;
  const hrData = streams?.heartrate?.data;
  const cadData = streams?.cadence?.data;
  const wattsData = streams?.watts?.data;
  const tempData = streams?.temp?.data;
  const distData = streams?.distance?.data; // mètres cumulés, mesuré
  const velData = streams?.velocity_smooth?.data; // m/s, mesuré

  const points = [];
  for (let i = 0; i < n; i++) {
    const [lat, lon] = latlng[i] || [null, null];
    if (lat == null || lon == null) continue; // point sans position : ignoré plutôt qu'inventé

    const offsetSec = Array.isArray(timeData) ? timeData[i] : null;
    const time = startMs != null && offsetSec != null ? new Date(startMs + offsetSec * 1000) : null;

    points.push({
      lat,
      lon,
      ele: Array.isArray(altData) ? altData[i] ?? null : null,
      time,
      hr: Array.isArray(hrData) ? hrData[i] ?? null : null,
      cad: Array.isArray(cadData) ? cadData[i] ?? null : null,
      power: Array.isArray(wattsData) ? wattsData[i] ?? null : null,
      temp: Array.isArray(tempData) ? tempData[i] ?? null : null,
      distanceMeasured: Array.isArray(distData) ? metersToKm(distData[i]) : null,
      speedMeasured: Array.isArray(velData) ? msToKmh(velData[i]) : null,
    });
  }
  return points;
}

/**
 * Convertit une SummaryActivity + ses streams Strava en `Activity`.
 *
 * @param {Object} summary - SummaryActivity Strava (voir api.js: listAthleteActivities)
 * @param {Object} streams - réponse de getActivityStreams()
 * @param {Object} params
 * @param {string|number} params.athleteId
 * @param {Object|null} [params.userSettings] - {weight, bikeWeight, ftp} — transmis tel quel à computeAnalysis, seul l'appelant (UI) connaît ces réglages
 * @returns {import('../types.js').Activity}
 * @throws {StravaMalformedDataError} si l'activité n'est pas exploitable (pas de GPS, champs requis absents)
 */
export function stravaActivityToActivity(summary, streams, { athleteId, userSettings = null } = {}) {
  if (!summary || summary.id == null || !summary.start_date) {
    throw new StravaMalformedDataError("Champs requis absents (id / start_date) sur l'activité Strava.");
  }

  const sportType = mapStravaSportType(summary.sport_type || summary.type);
  if (!sportType) {
    throw new StravaMalformedDataError(`Type d'activité Strava non cycliste (${summary.sport_type || summary.type}) : non importable ici.`);
  }

  const points = stravaStreamsToPoints(streams, summary.start_date);
  if (points.length < 2) {
    throw new StravaMalformedDataError("Pas assez de points GPS exploitables sur cette activité Strava.");
  }

  const analysis = computeAnalysis(points, userSettings);

  const measured = {
    distanceKm: summary.distance != null ? metersToKm(summary.distance) : null,
    avgSpeedKmh: summary.average_speed != null ? msToKmh(summary.average_speed) : null,
    maxSpeedKmh: summary.max_speed != null ? msToKmh(summary.max_speed) : null,
  };

  const activity = toActivity(analysis, points, {
    name: summary.name || null,
    sportType,
    sourceType: "strava",
    originalFilename: null,
    measured,
  });

  activity.source.sourceId = String(summary.id);
  activity.source.athleteId = athleteId != null ? String(athleteId) : null;

  return activity;
}
