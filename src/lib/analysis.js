/**
 * Analyse complète d'une activité cycliste
 *
 * Ce module calcule toutes les métriques, détecte les montées, arrêts,
 * et génère les données dérivées à partir des points GPS bruts.
 */

import { haversine, smoothArray, avg } from './utils.js';
import { estimatePower, computeBestPowerEfforts, computeNormalizedPower } from './power.js';

/**
 * Analyse complète d'une activité à partir des points GPS
 *
 * @param {Array} points - Points GPS bruts avec {lat, lon, ele?, time?, hr?, cad?, power?, temp?}
 * @param {Object} [userSettings] - Paramètres utilisateur (weight, bikeWeight, ftp)
 * @returns {Object} Résultat d'analyse complet
 */
export function computeAnalysis(points, userSettings = null) {
  const n = points.length;
  const hasEle = points.some((p) => p.ele != null);
  const timeCount = points.filter((p) => p.time != null).length;
  const hasTime = timeCount >= n * 0.9 && n > 1;
  const hasHR = points.some((p) => p.hr != null);
  const hasCad = points.some((p) => p.cad != null);
  let hasPower = points.some((p) => p.power != null);
  const hasTemp = points.some((p) => p.temp != null);

  // ---- distance cumulée (Haversine) ----
  const dist = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    dist[i] = dist[i - 1] + (isFinite(d) ? d : 0);
  }
  const totalDistanceKm = dist[n - 1] / 1000;

  // ---- altitude lissée + dénivelé ----
  let smoothEle = null,
    elevGain = 0,
    elevLoss = 0,
    maxEle = null,
    minEle = null;
  if (hasEle) {
    const rawEle = points.map((p) => p.ele);
    smoothEle = smoothArray(rawEle, 7);
    const validEle = smoothEle.filter((v) => v != null);
    maxEle = validEle.length ? Math.max(...validEle) : null;
    minEle = validEle.length ? Math.min(...validEle) : null;
    for (let i = 1; i < n; i++) {
      if (smoothEle[i] == null || smoothEle[i - 1] == null) continue;
      const d = smoothEle[i] - smoothEle[i - 1];
      if (d > 0) elevGain += d;
      else elevLoss += -d;
    }
  }

  // ---- temps écoulé + vitesse ----
  let timeSec = new Array(n).fill(null);
  let speed = new Array(n).fill(null);
  if (hasTime) {
    let t0 = null;
    for (let i = 0; i < n; i++) {
      if (points[i].time) {
        if (t0 == null) t0 = points[i].time.getTime();
        timeSec[i] = (points[i].time.getTime() - t0) / 1000;
      } else {
        timeSec[i] = i > 0 ? timeSec[i - 1] : 0;
      }
    }
    speed[0] = 0;
    for (let i = 1; i < n; i++) {
      const dt = timeSec[i] - timeSec[i - 1];
      const dd = dist[i] - dist[i - 1];
      speed[i] = dt > 0 ? (dd / dt) * 3.6 : 0;
    }
    speed = smoothArray(speed, 5);
  }

  // ---- pente locale ----
  let grade = new Array(n).fill(null);
  if (hasEle) {
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - 3),
        hi = Math.min(n - 1, i + 3);
      const dd = dist[hi] - dist[lo];
      const de = smoothEle[hi] != null && smoothEle[lo] != null ? smoothEle[hi] - smoothEle[lo] : null;
      grade[i] = dd > 4 && de != null ? (de / dd) * 100 : i > 0 ? grade[i - 1] : 0;
    }
  }

  // ---- série unifiée ----
  const series = points.map((p, i) => ({
    idx: i,
    lat: p.lat,
    lon: p.lon,
    distance: dist[i] / 1000,
    ele: hasEle ? smoothEle[i] : null,
    speed: hasTime ? speed[i] : null,
    grade: hasEle ? grade[i] : null,
    time: p.time,
    elapsed: hasTime ? timeSec[i] : null,
    hr: p.hr,
    cad: p.cad,
    power: p.power,
    temp: p.temp,
    // Valeurs mesurées par le device source (ex. FIT), distinctes des valeurs
    // calculées ci-dessus (`distance`, `speed`) — jamais fabriquées si absentes.
    distanceMeasured: p.distanceMeasured != null ? p.distanceMeasured : null,
    speedMeasured: p.speedMeasured != null ? p.speedMeasured : null,
  }));

  // ---- arrêts / temps en mouvement ----
  let stops = [],
    movingTimeSec = null,
    stoppedTimeSec = null,
    totalTimeSec = null;
  if (hasTime) {
    totalTimeSec = timeSec[n - 1];
    const STOP_SPEED = 2.2;
    const MIN_STOP_DUR = 20;
    let i = 0,
      stoppedAcc = 0;
    while (i < n) {
      if (speed[i] != null && speed[i] < STOP_SPEED) {
        let j = i;
        while (j < n && speed[j] != null && speed[j] < STOP_SPEED) j++;
        const dur = timeSec[j - 1] - timeSec[i];
        if (dur >= MIN_STOP_DUR) {
          stops.push({
            startIdx: i,
            endIdx: j - 1,
            duration: dur,
            distance: dist[i] / 1000,
            lat: points[i].lat,
            lon: points[i].lon,
          });
          stoppedAcc += dur;
        }
        i = j;
      } else i++;
    }
    stoppedTimeSec = stoppedAcc;
    movingTimeSec = totalTimeSec - stoppedAcc;
  }
  const avgSpeedKmh = hasTime && movingTimeSec > 0 ? totalDistanceKm / (movingTimeSec / 3600) : null;
  const maxSpeedKmh = hasTime ? Math.max(...speed.filter((v) => v != null)) : null;

  // ---- splits par kilomètre ----
  const splits = [];
  if (totalDistanceKm >= 1) {
    const nKm = Math.floor(totalDistanceKm);
    let lastIdx = 0;
    for (let k = 1; k <= nKm; k++) {
      let idx = lastIdx;
      while (idx < n - 1 && series[idx].distance < k) idx++;
      const segStart = lastIdx,
        segEnd = idx;
      const pts = series.slice(segStart, segEnd + 1);
      const segTime = hasTime ? series[segEnd].elapsed - series[segStart].elapsed : null;
      const avgSp = segTime && segTime > 0 ? 1 / (segTime / 3600) : null;
      let segGain = 0;
      if (hasEle) {
        for (let m = segStart + 1; m <= segEnd; m++) {
          if (series[m].ele != null && series[m - 1].ele != null) {
            const d = series[m].ele - series[m - 1].ele;
            if (d > 0) segGain += d;
          }
        }
      }
      splits.push({
        km: k,
        time: segTime,
        avgSpeed: avgSp,
        avgEle: hasEle ? avg(pts.map((p) => p.ele)) : null,
        gain: hasEle ? segGain : null,
        avgHR: hasHR ? avg(pts.map((p) => p.hr)) : null,
        avgCad: hasCad ? avg(pts.map((p) => p.cad)) : null,
        avgPower: hasPower ? avg(pts.map((p) => p.power)) : null,
      });
      lastIdx = idx;
    }
  }

  // ---- détection des montées ----
  const climbs = detectClimbs(series, dist, hasEle, hasTime, hasHR, hasPower);

  // ---- meilleurs efforts (segments performance) ----
  const bestEfforts = computeBestEfforts(series, hasTime, totalDistanceKm, n);

  // ---- puissance (mesurée ou estimée) ----
  const powerResult = computePowerData(series, hasTime, hasEle, hasPower, userSettings, n);
  const powerStats = powerResult.powerStats;
  const isEstimatedPower = powerResult.isEstimatedPower;
  hasPower = powerResult.hasPower;

  // ---- stats FC, cadence, température ----
  const hrStats = hasHR
    ? { avg: avg(series.map((p) => p.hr)), max: Math.max(...series.map((p) => p.hr).filter((v) => v != null)) }
    : null;
  const cadStats = hasCad
    ? { avg: avg(series.map((p) => p.cad)), max: Math.max(...series.map((p) => p.cad).filter((v) => v != null)) }
    : null;
  const tempStats = hasTemp
    ? {
        avg: avg(series.map((p) => p.temp)),
        max: Math.max(...series.map((p) => p.temp).filter((v) => v != null)),
        min: Math.min(...series.map((p) => p.temp).filter((v) => v != null)),
      }
    : null;

  // ---- puissance moyenne par montée (après estimation/mesure) ----
  if (hasPower) {
    for (const cl of climbs) {
      const slice = series.slice(cl.startIdx, cl.endIdx + 1);
      cl.avgPower = avg(slice.map((p) => p.power));
    }
  }

  // ---- meilleurs efforts de puissance ----
  let bestPowerEfforts = null;
  if (hasPower && hasTime && powerStats) {
    bestPowerEfforts = computeBestPowerEfforts(series, [5, 30, 60, 300, 600, 1200, 1800, 3600]);
  }

  return {
    n, hasEle, hasTime, hasHR, hasCad, hasPower, hasTemp,
    series, dist, totalDistanceKm,
    elevGain: hasEle ? elevGain : null,
    elevLoss: hasEle ? elevLoss : null,
    maxEle, minEle,
    totalTimeSec, movingTimeSec, stoppedTimeSec, stops,
    avgSpeedKmh, maxSpeedKmh,
    splits, climbs, bestEfforts, powerStats, hrStats, cadStats, tempStats,
    startTime: points[0].time || null,
    endTime: points[n - 1].time || null,
    isEstimatedPower,
    bestPowerEfforts,
  };
}

/**
 * Détecte les montées significatives dans un parcours
 *
 * @param {Array} series - Série temporelle
 * @param {Array} dist - Distances cumulées en mètres
 * @param {boolean} hasEle - Présence de données d'altitude
 * @param {boolean} hasTime - Présence de données temporelles
 * @param {boolean} hasHR - Présence de données FC
 * @param {boolean} hasPower - Présence de données de puissance
 * @returns {Array} Liste des montées détectées
 */
function detectClimbs(series, dist, hasEle, hasTime, hasHR, hasPower) {
  const climbs = [];
  if (!hasEle) return climbs;

  const n = series.length;
  const MIN_GRADE = 2.5;
  const MIN_GAIN = 25;
  const MIN_LEN = 300;
  const MERGE_GAP = 150;

  const candidates = [];
  let i = 1;
  while (i < n) {
    if (series[i].grade != null && series[i].grade >= MIN_GRADE) {
      let j = i;
      while (j < n) {
        if (series[j].grade != null && series[j].grade < -1) break;
        j++;
      }
      const startIdx = i - 1,
        endIdx = Math.min(j, n - 1);
      const gain = series[endIdx].ele - series[startIdx].ele;
      const length = dist[endIdx] - dist[startIdx];
      if (gain >= MIN_GAIN && length >= MIN_LEN) candidates.push({ startIdx, endIdx });
      i = endIdx + 1;
    } else i++;
  }

  const merged = [];
  for (const c of candidates) {
    if (merged.length && dist[c.startIdx] - dist[merged[merged.length - 1].endIdx] < MERGE_GAP) {
      merged[merged.length - 1].endIdx = c.endIdx;
    } else merged.push({ ...c });
  }

  merged.forEach((c, idx) => {
    const s = series[c.startIdx],
      e = series[c.endIdx];
    const lengthKm = (dist[c.endIdx] - dist[c.startIdx]) / 1000;
    const gain = e.ele - s.ele;
    if (gain < MIN_GAIN || lengthKm * 1000 < MIN_LEN) return;
    const avgGrade = lengthKm > 0 ? (gain / (lengthKm * 1000)) * 100 : 0;
    let maxGrade = -Infinity;
    for (let m = c.startIdx; m <= c.endIdx; m++) {
      if (series[m].grade != null) maxGrade = Math.max(maxGrade, series[m].grade);
    }
    const duration = hasTime ? series[c.endIdx].elapsed - series[c.startIdx].elapsed : null;
    const avgSpeed = duration && duration > 0 ? lengthKm / (duration / 3600) : null;
    const slice = series.slice(c.startIdx, c.endIdx + 1);
    climbs.push({
      id: idx + 1,
      name: `Montée ${idx + 1}`,
      startDistance: dist[c.startIdx] / 1000,
      endDistance: dist[c.endIdx] / 1000,
      lengthKm,
      gain,
      avgGrade,
      maxGrade: isFinite(maxGrade) ? maxGrade : avgGrade,
      startEle: s.ele,
      endEle: e.ele,
      duration,
      avgSpeed,
      avgHR: hasHR ? avg(slice.map((p) => p.hr)) : null,
      avgPower: hasPower ? avg(slice.map((p) => p.power)) : null,
      startIdx: c.startIdx,
      endIdx: c.endIdx,
    });
  });

  return climbs;
}

/**
 * Calcule les meilleurs efforts pour différentes distances
 *
 * @param {Array} series - Série temporelle
 * @param {boolean} hasTime - Présence de données temporelles
 * @param {number} totalDistanceKm - Distance totale en km
 * @param {number} n - Nombre de points
 * @returns {Object|null} Meilleurs efforts ou null
 */
function computeBestEfforts(series, hasTime, totalDistanceKm, n) {
  if (!hasTime) return null;

  function bestEffort(targetKm) {
    if (totalDistanceKm < targetKm) return null;
    let best = Infinity,
      bestStart = null;
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (j < i) j = i;
      while (j < n && series[j].distance - series[i].distance < targetKm) j++;
      if (j >= n) break;
      const targetDist = series[i].distance + targetKm;
      const a = series[j - 1] || series[i],
        b = series[j];
      let tAtTarget;
      if (b.distance === a.distance) tAtTarget = b.elapsed;
      else {
        const frac = (targetDist - a.distance) / (b.distance - a.distance);
        tAtTarget = a.elapsed + frac * (b.elapsed - a.elapsed);
      }
      const dur = tAtTarget - series[i].elapsed;
      if (dur > 0 && dur < best) {
        best = dur;
        bestStart = i;
      }
    }
    return isFinite(best) && bestStart != null
      ? { duration: best, startDistance: series[bestStart].distance, avgSpeed: targetKm / (best / 3600) }
      : null;
  }

  return {
    k1: bestEffort(1),
    k5: bestEffort(5),
    k10: bestEffort(10),
    k20: bestEffort(20)
  };
}

/**
 * Calcule les données de puissance (mesurée ou estimée)
 *
 * @param {Array} series - Série temporelle (modifiée en place si estimation)
 * @param {boolean} hasTime - Présence de données temporelles
 * @param {boolean} hasEle - Présence de données d'altitude
 * @param {boolean} hasPower - Présence de données de puissance
 * @param {Object} userSettings - Paramètres utilisateur
 * @param {number} n - Nombre de points
 * @returns {Object} {powerStats, isEstimatedPower, hasPower}
 */
function computePowerData(series, hasTime, hasEle, hasPower, userSettings, n) {
  let powerStats = null;
  let isEstimatedPower = false;

  if (hasPower) {
    // Puissance mesurée dans le fichier
    const powVals = series.map((p) => p.power).filter((v) => v != null);
    const np = hasTime && powVals.length > 60 ? computeNormalizedPower(series) : null;
    powerStats = { avg: avg(powVals), max: Math.max(...powVals), np };
  } else if (hasTime && hasEle) {
    // Estimation automatique de puissance (modèle physique)
    isEstimatedPower = true;
    const weight = (userSettings && userSettings.weight) || 75;
    const bikeWeight = (userSettings && userSettings.bikeWeight) || 8;

    // Pré-calcul de l'accélération (m/s²) à partir des différences de vitesse
    const accel = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      if (series[i].speed != null && series[i - 1].speed != null &&
          series[i].elapsed != null && series[i - 1].elapsed != null) {
        const dt = series[i].elapsed - series[i - 1].elapsed;
        if (dt > 0) {
          const dvMs = (series[i].speed - series[i - 1].speed) / 3.6; // km/h → m/s
          accel[i] = dvMs / dt;
        }
      }
    }
    // Lissage 3 points (centre mobile)
    for (let i = 1; i < n - 1; i++) {
      accel[i] = (accel[i - 1] + accel[i] + accel[i + 1]) / 3;
    }

    // Estimer la puissance pour chaque point
    for (let i = 0; i < n; i++) {
      if (series[i].speed != null && series[i].grade != null) {
        series[i].power = estimatePower(series[i].speed, series[i].grade, weight, bikeWeight, 0, accel[i]);
      }
    }

    const powVals = series.map((p) => p.power).filter((v) => v != null);
    if (powVals.length > 0) {
      const np = hasTime && powVals.length > 60 ? computeNormalizedPower(series) : null;
      powerStats = { avg: avg(powVals), max: Math.max(...powVals), np };
      hasPower = true; // Activer l'affichage de puissance
    }
  }

  return { powerStats, isEstimatedPower, hasPower };
}

/**
 * Calcule les zones de fréquence cardiaque
 *
 * @param {Object} analysis - Résultat d'analyse
 * @param {number} maxHR - FC max en bpm
 * @param {Array} bounds - Définition des zones avec {name, min, max, color}
 * @returns {Array|null} Zones avec temps passé
 */
export function computeHRZones(analysis, maxHR, bounds) {
  if (!analysis.hasHR || !analysis.hasTime) return null;

  const zones = bounds.map((z) => ({ ...z, time: 0 }));
  const s = analysis.series;

  for (let i = 1; i < s.length; i++) {
    if (s[i].hr == null) continue;
    const dt = s[i].elapsed - s[i - 1].elapsed;
    if (dt <= 0) continue;
    const pct = (s[i].hr / maxHR) * 100;
    for (const z of zones) {
      if (pct >= z.min && pct < z.max) {
        z.time += dt;
        break;
      }
    }
  }

  return zones;
}
