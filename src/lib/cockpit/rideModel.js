/**
 * Modèle de lecture du cockpit : transforme une `Activity` déjà normalisée en ce dont les panneaux ont besoin
 * (analyse pour la carte/le profil, cellules de télémétrie, lignes de synthèse) — SANS aucun calcul métier nouveau.
 *
 * Règles :
 *  - Les agrégats (distance, durées, vitesses, D+, FC/cadence/puissance moyennes et max) sont LUS sur l'Activity,
 *    qui les a produits via analysis.js / speed.js à l'import : le cockpit affiche les mêmes valeurs que le fil,
 *    l'historique et l'analyse détaillée.
 *  - La série point par point (carte, profil, valeur sous le curseur) vient de `computeAnalysis` appliqué aux
 *    `samples` — même reconstruction que GPXAnalyzer.jsx pour une sortie Strava / cloud (voir `activityToPoints`).
 *  - Une donnée absente n'est JAMAIS convertie en 0 : elle sort `value: null`, `provenance: "unavailable"`.
 *  - Chaque valeur porte sa provenance : mesurée (capteur/appareil), calculée (par nos moteurs), estimée (modèle
 *    physique de puissance) ou indisponible.
 */
import { computeAnalysis } from "../analysis.js";
import { decimate, fmt1, fmtInt, fmtDuration } from "../utils.js";

/** Points maximum envoyés à la carte et aux graphiques (identique au dashboard d'analyse). */
export const COCKPIT_CHART_POINTS = 900;
/** En dessous de cette amplitude (m), l'altitude est considérée comme inexploitable pour un profil. */
export const MIN_USABLE_ELEVATION_RANGE_M = 1;

export const PROVENANCE_LABELS = {
  measured: "mesurée",
  calculated: "calculée",
  estimated: "estimée",
  unavailable: "indisponible",
};
/** Abréviations affichées dans les pastilles (le libellé complet reste dans l'aria-label et le title). */
export const PROVENANCE_SHORT = {
  measured: "MES.",
  calculated: "CALC.",
  estimated: "EST.",
  unavailable: "N/D",
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Reconstruit les points exploitables par `computeAnalysis` depuis les `samples` d'une Activity.
 * Les échantillons sans coordonnées valides sont ignorés (ils fausseraient la distance cumulée).
 * Une puissance ESTIMÉE n'est jamais réinjectée en entrée : elle serait relue comme une mesure (cf. GPXAnalyzer.jsx).
 * @param {import('../types.js').Activity} activity
 * @returns {Array<Object>}
 */
export function activityToPoints(activity) {
  const samples = (activity && activity.samples) || [];
  const estimated = !!(activity && activity.flags && activity.flags.powerEstimated);
  const points = [];
  for (const s of samples) {
    if (!isNum(s.latitude) || !isNum(s.longitude)) continue;
    let time = null;
    if (s.timestamp) {
      const d = new Date(s.timestamp);
      time = Number.isNaN(d.getTime()) ? null : d;
    }
    points.push({
      lat: s.latitude,
      lon: s.longitude,
      ele: s.altitude ?? null,
      time,
      hr: s.heartRate ?? null,
      cad: s.cadence ?? null,
      power: estimated ? null : s.power ?? null,
      temp: s.temperature ?? null,
      distanceMeasured: s.distanceMeasured ?? null,
      speedMeasured: s.speedMeasured ?? null,
    });
  }
  return points;
}

/**
 * Altitude exploitable pour un profil ? (présente ET avec un relief mesurable)
 * @returns {{usable: boolean, reason: "missing"|"flat"|null}}
 */
export function assessElevation(analysis) {
  if (!analysis || !analysis.hasEle || !isNum(analysis.minEle) || !isNum(analysis.maxEle)) return { usable: false, reason: "missing" };
  if (analysis.maxEle - analysis.minEle < MIN_USABLE_ELEVATION_RANGE_M) return { usable: false, reason: "flat" };
  return { usable: true, reason: null };
}

/** Dénivelé positif cumulé à chaque indice de la série — même règle que analysis.js (somme des hausses de l'altitude lissée). */
export function cumulativeGain(series) {
  const out = new Array(series.length).fill(null);
  let acc = 0;
  for (let i = 0; i < series.length; i++) {
    if (i > 0 && isNum(series[i].ele) && isNum(series[i - 1].ele)) {
      const d = series[i].ele - series[i - 1].ele;
      if (d > 0) acc += d;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * @param {import('../types.js').Activity|null} activity
 * @param {Object|null} userSettings - paramètres de puissance (poids, FTP, estimation) de l'app
 * @param {{points: Array, measured: Object|null, source: "file"|"samples"}} [inputs] - voir rideSource.js ; par défaut, les `samples`
 * @returns {{status: "none"}|{status: "no-track"}|{status: "error", message: string}|{status: "ready", analysis: Object, chartData: Array, elevation: Object, cumGain: Array, source: string}}
 */
export function buildRideModel(activity, userSettings = null, inputs = null) {
  if (!activity) return { status: "none" };
  try {
    const points = inputs ? inputs.points : activityToPoints(activity);
    if (!points || points.length < 2) return { status: "no-track" };
    const analysis = computeAnalysis(points, userSettings, { measured: inputs ? inputs.measured : null });
    return {
      status: "ready",
      analysis,
      chartData: decimate(analysis.series, COCKPIT_CHART_POINTS),
      elevation: assessElevation(analysis),
      cumGain: cumulativeGain(analysis.series),
      source: inputs ? inputs.source : "samples",
    };
  } catch (err) {
    return { status: "error", message: (err && err.message) || "Analyse impossible." };
  }
}

/** Capteurs / signaux absents de cette sortie (pour le bandeau « données partielles »). */
export function missingSignals(activity) {
  if (!activity || !activity.flags) return [];
  const f = activity.flags;
  const missing = [];
  if (!f.hasTime) missing.push("horodatage");
  if (!f.hasElevation) missing.push("altitude");
  if (!f.hasHeartRate) missing.push("fréquence cardiaque");
  if (!f.hasCadence) missing.push("cadence");
  if (!f.hasPower) missing.push("puissance");
  return missing;
}

function powerProvenance(activity) {
  const f = (activity && activity.flags) || {};
  if (!f.hasPower) return "unavailable";
  return f.powerEstimated ? "estimated" : "measured";
}

function mk(key, label, unit, qualifier, value, text, provenance) {
  const available = value != null && provenance !== "unavailable";
  return { key, label, unit, qualifier, value: available ? value : null, text: available ? text : "—", provenance: available ? provenance : "unavailable" };
}

/**
 * Cellules du panneau de télémétrie.
 *  - sans `point` : portée « sortie » → moyennes de l'Activity (altitude : max) ;
 *  - avec `point` (curseur sur la carte / le profil) : valeurs instantanées à cette position.
 * @param {import('../types.js').Activity} activity
 * @param {{analysis: Object, cumGain: Array, elevation: Object}|null} model - modèle `ready`, ou null si pas de trace
 * @param {Object|null} point - élément de `chartData` sous le curseur
 */
export function buildTelemetryCells(activity, model, point = null) {
  const f = (activity && activity.flags) || {};
  const pProv = powerProvenance(activity);
  const eleUsable = !!(model && model.elevation && model.elevation.usable);

  if (point && model) {
    const gain = model.cumGain ? model.cumGain[point.idx] : null;
    return [
      mk("speed", "Vitesse", "km/h", "instant.", isNum(point.speed) ? point.speed : null, fmt1(point.speed), "calculated"),
      mk("distance", "Distance", "km", "cumulée", isNum(point.distance) ? point.distance : null, fmt1(point.distance), "calculated"),
      mk("duration", "Durée", "", "écoulée", isNum(point.elapsed) ? point.elapsed : null, fmtDuration(point.elapsed), "calculated"),
      mk("elevGain", "Dénivelé +", "m", "cumulé", eleUsable && isNum(gain) ? gain : null, "+" + fmtInt(gain), "calculated"),
      mk("hr", "Fréq. cardiaque", "bpm", "instant.", f.hasHeartRate && isNum(point.hr) ? point.hr : null, fmtInt(point.hr), "measured"),
      mk("cadence", "Cadence", "rpm", "instant.", f.hasCadence && isNum(point.cad) ? point.cad : null, fmtInt(point.cad), "measured"),
      mk("power", "Puissance", "W", "instant.", isNum(point.power) ? point.power : null, fmtInt(point.power), pProv),
      mk("altitude", "Altitude", "m", "instant.", eleUsable && isNum(point.ele) ? point.ele : null, fmtInt(point.ele), "measured"),
    ];
  }

  const speedProv = activity.avgSpeedSource === "device" ? "measured" : "calculated";
  const maxEle = model && model.analysis ? model.analysis.maxEle : null;
  return [
    mk("speed", "Vitesse", "km/h", "moy.", isNum(activity.avgSpeed) ? activity.avgSpeed : null, fmt1(activity.avgSpeed), speedProv),
    mk("distance", "Distance", "km", "totale", isNum(activity.distance) && activity.distance > 0 ? activity.distance : null, fmt1(activity.distance), "calculated"),
    mk("duration", "Durée", "", "écoulée", f.hasTime && isNum(activity.duration) ? activity.duration : null, fmtDuration(activity.duration), "calculated"),
    mk("elevGain", "Dénivelé +", "m", "total", f.hasElevation && isNum(activity.elevationGain) ? activity.elevationGain : null, "+" + fmtInt(activity.elevationGain), "calculated"),
    mk("hr", "Fréq. cardiaque", "bpm", "moy.", f.hasHeartRate && isNum(activity.avgHeartRate) ? activity.avgHeartRate : null, fmtInt(activity.avgHeartRate), "measured"),
    mk("cadence", "Cadence", "rpm", "moy.", f.hasCadence && isNum(activity.avgCadence) ? activity.avgCadence : null, fmtInt(activity.avgCadence), "measured"),
    mk("power", "Puissance", "W", "moy.", f.hasPower && isNum(activity.avgPower) ? activity.avgPower : null, fmtInt(activity.avgPower), pProv),
    mk("altitude", "Altitude", "m", "max.", eleUsable && isNum(maxEle) ? maxEle : null, fmtInt(maxEle), "measured"),
  ];
}

/**
 * Lignes du panneau « Résumé de la sortie ». Chaque ligne : {key, label, unit, text, provenance, note?}.
 * Vitesse moyenne = EN MOUVEMENT (règle de speed.js) ; vitesse max = pointe instantanée lissée ; durée écoulée ≠ temps en mouvement.
 * @param {import('../types.js').Activity} activity
 */
export function buildSummaryRows(activity) {
  const f = (activity && activity.flags) || {};
  const pProv = powerProvenance(activity);
  const hasBothTimes = f.hasTime && isNum(activity.duration) && isNum(activity.movingTime);
  const row = (key, label, unit, value, text, provenance, note) => ({ ...mk(key, label, unit, null, value, text, provenance), note: note || null });

  return [
    row("distance", "Distance totale", "km", isNum(activity.distance) && activity.distance > 0 ? activity.distance : null, fmt1(activity.distance), "calculated"),
    row("elapsed", "Temps écoulé", "", f.hasTime && isNum(activity.duration) ? activity.duration : null, fmtDuration(activity.duration), "calculated"),
    row("moving", "Temps en mouvement", "", hasBothTimes ? activity.movingTime : null, fmtDuration(activity.movingTime), "calculated"),
    row(
      "avgSpeed", "Vitesse moyenne", "km/h", isNum(activity.avgSpeed) ? activity.avgSpeed : null, fmt1(activity.avgSpeed),
      activity.avgSpeedSource === "device" ? "measured" : "calculated", "en mouvement"
    ),
    row("maxSpeed", "Vitesse maximale", "km/h", f.hasTime && isNum(activity.maxSpeed) ? activity.maxSpeed : null, fmt1(activity.maxSpeed), "calculated", "pointe lissée"),
    row("elevGain", "Dénivelé positif", "m", f.hasElevation && isNum(activity.elevationGain) ? activity.elevationGain : null, "+" + fmtInt(activity.elevationGain), "calculated"),
    row("avgHr", "FC moyenne", "bpm", f.hasHeartRate && isNum(activity.avgHeartRate) ? activity.avgHeartRate : null, fmtInt(activity.avgHeartRate), "measured"),
    row("maxHr", "FC maximale", "bpm", f.hasHeartRate && isNum(activity.maxHeartRate) ? activity.maxHeartRate : null, fmtInt(activity.maxHeartRate), "measured"),
    row("avgCad", "Cadence moyenne", "rpm", f.hasCadence && isNum(activity.avgCadence) ? activity.avgCadence : null, fmtInt(activity.avgCadence), "measured"),
    row("avgPower", "Puissance moyenne", "W", f.hasPower && isNum(activity.avgPower) ? activity.avgPower : null, fmtInt(activity.avgPower), pProv),
    row("maxPower", "Puissance maximale", "W", f.hasPower && isNum(activity.maxPower) ? activity.maxPower : null, fmtInt(activity.maxPower), pProv),
  ];
}

/**
 * Part du temps dans chaque zone de FC (0..1), pour l'affichage des barres. `zones` = sortie de computeHRZones.
 * @returns {Array<{name: string, color: string, time: number, share: number}>|null}
 */
export function zoneShares(zones) {
  if (!zones) return null;
  const total = zones.reduce((s, z) => s + z.time, 0);
  if (!(total > 0)) return null;
  return zones.map((z) => ({ name: z.name, color: z.color, min: z.min, max: z.max, time: z.time, share: z.time / total }));
}
