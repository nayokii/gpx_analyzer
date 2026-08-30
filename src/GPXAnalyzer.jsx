import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Upload, MapPin, TrendingUp, Activity, Heart, Zap, Mountain, Clock, Gauge,
  RefreshCw, ChevronUp, ChevronDown, X, Download, Info, Flame, Timer,
  Route, Thermometer, PauseCircle, Settings2, ArrowUpRight, Wind, Compass,
  FileWarning, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, Brush, ScatterChart, Scatter, ZAxis,
  BarChart, Bar, Cell,
} from "recharts";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ============================================================================
   DESIGN TOKENS
   Palette inspirée d'une montée nocturne sur un ordinateur de bord de vélo : près du
   noir basaltique, avec un fond vert foncé stylisant le relief guadeloupéen et un
   accent bleu-vert pour la vitesse/motion, un jaune doux pour la montée, un corail
   chaud pour l'effort (FC/puissance).
   =========================================================================== */

const COLORS = {
  bg: "#0a0d0c",
  bgAlt: "#0e1211",
  surface: "#141917",
  surface2: "#1a201d",
  border: "rgba(237, 239, 236, 0.08)",
  borderStrong: "rgba(237, 239, 236, 0.16)",
  text: "#eef1ee",
  textMuted: "#8b948e",
  textFaint: "#5c645f",
  speed: "#4dd9c0",
  speedDim: "#2a5c53",
  climb: "#f4b740",
  climbDim: "#5c4a20",
  effort: "#e8543a",
  effortDim: "#5c2c22",
  alert: "#ff5470",
  info: "#6f9cf2",
};

const SPEED_SCALE = ["#2e5eaa", "#4dd9c0", "#c8e86a", "#f4b740", "#e8543a"];
const GRADE_SCALE = ["#2e5eaa", "#4dd9c0", "#8b948e", "#f4b740", "#e8543a"];
const HR_SCALE = ["#4dd9c0", "#c8e86a", "#f4b740", "#e8543a", "#c22b1c"];
const ELE_SCALE = ["#1c2a24", "#2f5c4b", "#7fae5e", "#f4b740", "#c96b3a"];

function lerpColor(hexA, hexB, t) {
  if (hexA == null || hexB == null) return COLORS.textFaint;
  const a = hexA.match(/\w\w/g);
  const b = hexB.match(/\w\w/g);
  if (a == null || b == null) return COLORS.textFaint;
  const ai = a.map((x) => parseInt(x, 16));
  const bi = b.map((x) => parseInt(x, 16));
  const c = ai.map((v, i) => Math.round(v + (bi[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function scaleColor(t, stops) {
  if (t == null || isNaN(t)) return COLORS.textFaint;
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const seg = t * n;
  const i = Math.min(n - 1, Math.floor(seg));
  const localT = seg - i;
  return lerpColor(stops[i], stops[i + 1], localT);
}

/* ============================================================================
   UTILITIES
   ========================================================================== */

const R_EARTH = 6371000;
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
function smoothArray(arr, windowSize) {
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
function avg(arr) {
  const clean = (arr || []).filter((v) => v != null && !isNaN(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}
function fmt1(v) {
  if (v == null || isNaN(v)) return "—";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtInt(v) {
  if (v == null || isNaN(v)) return "—";
  return Math.round(v).toLocaleString("fr-FR");
}
function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDurationLong(sec) {
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
function fmtClock(date) {
  if (!date) return "—";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDateFull(date) {
  if (!date) return "—";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function decimate(arr, maxPoints) {
  if (!arr || arr.length <= maxPoints) return arr || [];
  const step = arr.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

/* ============================================================================
   GPX PARSING
   ========================================================================== */

function parseGPXString(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Ce fichier n'est pas un GPX valide (erreur de lecture XML).");
  }
  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  if (trkpts.length === 0) {
    throw new Error("Aucun point GPS (trkpt) trouvé dans ce fichier GPX.");
  }
  const nameEl = doc.getElementsByTagName("name")[0];
  const name = nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : null;

  const points = trkpts
    .map((pt) => {
      const lat = parseFloat(pt.getAttribute("lat"));
      const lon = parseFloat(pt.getAttribute("lon"));
      let ele = null,
        time = null,
        hr = null,
        cad = null,
        power = null,
        temp = null;

      const eleEl = pt.getElementsByTagName("ele")[0];
      if (eleEl && eleEl.textContent) {
        const v = parseFloat(eleEl.textContent);
        if (!isNaN(v)) ele = v;
      }
      const timeEl = pt.getElementsByTagName("time")[0];
      if (timeEl && timeEl.textContent) {
        const t = new Date(timeEl.textContent);
        if (!isNaN(t.getTime())) time = t;
      }
      const directPower = Array.from(pt.children).find(
        (c) => ((c.localName || c.tagName).toLowerCase()) === "power"
      );
      if (directPower) {
        const v = parseFloat(directPower.textContent);
        if (!isNaN(v)) power = v;
      }
      const extEl = pt.getElementsByTagName("extensions")[0];
      if (extEl) {
        const all = extEl.getElementsByTagName("*");
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          const ln = (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
          const val = parseFloat(el.textContent);
          if (isNaN(val)) continue;
          if ((ln === "hr" || ln === "heartrate") && hr === null) hr = val;
          else if ((ln === "cad" || ln === "cadence") && cad === null) cad = val;
          else if ((ln === "power" && power === null)) power = val;
          else if ((ln === "atemp" || ln === "temp" || ln === "temperature") && temp === null) temp = val;
        }
      }
      return { lat, lon, ele, time, hr, cad, power, temp };
    })
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  if (points.length < 2) {
    throw new Error("Ce fichier GPX ne contient pas assez de points GPS valides pour une analyse.");
  }
  return { name, points };
}

/* ============================================================================
   DEMO / FICTIONAL DATA GENERATOR
   ========================================================================== */

function generateDemoPoints() {
  const n = 520;
  const pts = [];
  const centerLat = 16.05,
    centerLon = -61.75; // zone fictive, style Guadeloupe
  const start = new Date();
  start.setHours(start.getHours() - 3);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const angle = p * 2.05 * Math.PI;
    const radius = 0.028 + 0.006 * Math.sin(p * 9);
    const lat = centerLat + radius * Math.sin(angle) * 0.7 + 0.004 * Math.sin(p * 30);
    const lon = centerLon + radius * Math.cos(angle) + 0.003 * Math.cos(p * 22);
    const baseEle =
      60 +
      140 * Math.max(0, Math.sin(p * Math.PI * 1.4)) +
      70 * Math.max(0, Math.sin((p - 0.15) * Math.PI * 3.1)) +
      25 * Math.sin(p * 40);
    const noise = (Math.sin(i * 12.9) * 0.5 + 0.5) * 2;
    const ele = Math.max(2, baseEle + noise);
    const speed = 14 + 12 * (1 - Math.min(1, Math.max(0, (ele - 40) / 200))) + Math.sin(i * 3) * 2;
    const dtSec = 8 + Math.sin(i * 5) * 1.5;
    t += Math.max(3, dtSec);
    const time = new Date(start.getTime() + t * 1000);
    const hr = 118 + 40 * Math.min(1, Math.max(0, (ele - 20) / 220)) + Math.sin(i * 2) * 6;
    const cad = 68 + 18 * Math.sin(i * 0.7) + (speed < 10 ? -15 : 0);
    pts.push({
      lat,
      lon,
      ele,
      time,
      hr: Math.round(hr),
      cad: Math.max(0, Math.round(cad)),
      power: null,
      temp: 27 + Math.sin(p * 6) * 2,
    });
  }
  // pause fictive au 2/3 du parcours
  const pauseIdx = Math.floor(n * 0.63);
  for (let k = 0; k < 6; k++) {
    const base = pts[pauseIdx];
    pts.splice(pauseIdx + k, 0, {
      ...base,
      time: new Date(base.time.getTime() + k * 30000),
    });
  }
  return { name: "Sortie de démonstration", points: pts };
}

/* ============================================================================
   POWER ESTIMATION — Modèle physique pour estimer la puissance mécanique
   ========================================================================== */

function estimatePower(speed, grade, weight, bikeWeight, windSpeed = 0, acceleration = 0) {
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
function computeBestPowerEfforts(series, durations) {
  // durations en secondes : [5, 30, 60, 300, 600, 1200, 1800, 3600]
  const results = {};

  for (const dur of durations) {
    let best = -Infinity;
    let bestStart = null;

    for (let i = 0; i < series.length; i++) {
      if (series[i].elapsed == null || series[i].power == null) continue;

      let j = i;
      while (j < series.length && series[j].elapsed - series[i].elapsed < dur) {
        j++;
      }

      if (j >= series.length) break;

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
function computePowerZones(series, ftp) {
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

/* ============================================================================
   CORE ANALYSIS
   ========================================================================== */

function computeAnalysis(points, userSettings = null) {
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
  const climbs = [];
  if (hasEle) {
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
      for (let m = c.startIdx; m <= c.endIdx; m++) if (series[m].grade != null) maxGrade = Math.max(maxGrade, series[m].grade);
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
  }

  // ---- meilleurs efforts (segments performance) ----
  function bestEffort(targetKm) {
    if (!hasTime || totalDistanceKm < targetKm) return null;
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
  const bestEfforts = hasTime
    ? { k1: bestEffort(1), k5: bestEffort(5), k10: bestEffort(10), k20: bestEffort(20) }
    : null;

  // ---- puissance (mesurée ou estimée) ----
  let powerStats = null;
  let isEstimatedPower = false;

  if (hasPower) {
    // Puissance mesurée dans le GPX
    const powVals = series.map((p) => p.power).filter((v) => v != null);
    let np = null;
    if (hasTime && powVals.length > 60) {
      const dts = [];
      for (let i = 1; i < n; i++) {
        const dt = series[i].elapsed - series[i - 1].elapsed;
        if (dt > 0) dts.push(dt);
      }
      const avgDt = avg(dts) || 1;
      const windowCount = Math.max(1, Math.round(30 / avgDt));
      const powSeries = series.map((p) => p.power);
      const rolling = [];
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - windowCount + 1);
        const slice = powSeries.slice(lo, i + 1).filter((v) => v != null);
        if (slice.length) rolling.push(avg(slice));
      }
      if (rolling.length > windowCount) {
        const p4 = rolling.map((v) => Math.pow(v, 4));
        np = Math.pow(avg(p4), 0.25);
      }
    }
    powerStats = { avg: avg(powVals), max: Math.max(...powVals), np };
  } else if (hasTime && hasEle) {
    // Estimation automatique de puissance (modèle physique)
    isEstimatedPower = true;
    const weight = (userSettings && userSettings.weight) || 75;
    const bikeWeight = (userSettings && userSettings.bikeWeight) || 8;

    // Pré-calcul de l'accélération (m/s²) à partir des différences de vitesse
    // Lissage simple sur 3 points pour limiter le bruit du GPS.
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

    for (let i = 0; i < n; i++) {
      if (series[i].speed != null && series[i].grade != null) {
        series[i].power = estimatePower(series[i].speed, series[i].grade, weight, bikeWeight, 0, accel[i]);
      }
    }

    const powVals = series.map((p) => p.power).filter((v) => v != null);
    if (powVals.length > 0) {
      let np = null;
      if (hasTime && powVals.length > 60) {
        const dts = [];
        for (let i = 1; i < n; i++) {
          const dt = series[i].elapsed - series[i - 1].elapsed;
          if (dt > 0) dts.push(dt);
        }
        const avgDt = avg(dts) || 1;
        const windowCount = Math.max(1, Math.round(30 / avgDt));
        const powSeries = series.map((p) => p.power);
        const rolling = [];
        for (let i = 0; i < n; i++) {
          const lo = Math.max(0, i - windowCount + 1);
          const slice = powSeries.slice(lo, i + 1).filter((v) => v != null);
          if (slice.length) rolling.push(avg(slice));
        }
        if (rolling.length > windowCount) {
          const p4 = rolling.map((v) => Math.pow(v, 4));
          np = Math.pow(avg(p4), 0.25);
        }
      }
      powerStats = { avg: avg(powVals), max: Math.max(...powVals), np };
      hasPower = true; // Activer l'affichage de puissance
    }
  }

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
  // Les objets `climbs` ont été construits avant la branche puissance
  // (mesurée ou estimée) ; on réinjecte avgPower à partir de series[i].power
  // qui contient maintenant la puissance réellement disponible.
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

function computeHRZones(a, maxHR, bounds) {
  if (!a.hasHR || !a.hasTime) return null;
  const zones = bounds.map((z) => ({ ...z, time: 0 }));
  const s = a.series;
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

function generateSummary(a) {
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

function generateHighlights(a) {
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

/* ============================================================================
   SMALL UI PRIMITIVES
   ========================================================================== */

function StatCard({ icon: Icon, label, value, unit, accent = COLORS.speed, sub }) {
  if (value == null) return null;
  return (
    <div className="gpx-stat-card">
      <div className="gpx-stat-icon" style={{ color: accent, background: accent + "1a" }}>
        <Icon size={16} strokeWidth={2.2} />
      </div>
      <div className="gpx-stat-body">
        <div className="gpx-stat-label">{label}</div>
        <div className="gpx-stat-value">
          {value}
          {unit && <span className="gpx-stat-unit">{unit}</span>}
        </div>
        {sub && <div className="gpx-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="gpx-section-title">
      <div className="gpx-section-title-left">
        {Icon && <Icon size={15} strokeWidth={2.2} />}
        <span>{children}</span>
      </div>
      {right}
    </div>
  );
}

function CustomTooltip({ active, payload, hasHR, hasCad, hasPower }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="gpx-tooltip">
      <div className="gpx-tooltip-row gpx-tooltip-main">{fmt1(d.distance)} km</div>
      {d.ele != null && <div className="gpx-tooltip-row"><span>Altitude</span><b>{fmtInt(d.ele)} m</b></div>}
      {d.speed != null && <div className="gpx-tooltip-row"><span>Vitesse</span><b>{fmt1(d.speed)} km/h</b></div>}
      {hasHR && d.hr != null && <div className="gpx-tooltip-row"><span>FC</span><b>{fmtInt(d.hr)} bpm</b></div>}
      {hasCad && d.cad != null && <div className="gpx-tooltip-row"><span>Cadence</span><b>{fmtInt(d.cad)} rpm</b></div>}
      {hasPower && d.power != null && <div className="gpx-tooltip-row"><span>Puissance</span><b>{fmtInt(d.power)} W</b></div>}
      {d.time && <div className="gpx-tooltip-row"><span>Heure</span><b>{fmtClock(d.time)}</b></div>}
    </div>
  );
}

/* ============================================================================
   MAP VIEW — vraie carte Leaflet + OpenStreetMap, via le vrai module npm
   "leaflet" (fonctionne normalement en local, tuiles réelles avec rues,
   routes, villes/villages). Le tracé, le départ, l'arrivée et les montées
   sont posés sur cette carte à leurs coordonnées GPS réelles.
   ========================================================================== */

function nearestIdxByLatLng(pts, lat, lon) {
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dLat = pts[i].lat - lat,
      dLon = pts[i].lon - lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const MAP_MODES = [
  { key: "track", label: "Parcours" },
  { key: "speed", label: "Vitesse" },
  { key: "altitude", label: "Altitude" },
  { key: "hr", label: "Fréq. cardiaque" },
  { key: "grade", label: "Pente" },
];

function MapView({
  analysis,
  colorMode,
  setColorMode,
  selectedClimb,
  height = 460,
  decimated: decimatedProp,
  hoverIdx,
  onHoverIndex,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerGroupRef = useRef(null);
  const cursorRef = useRef(null);
  const boundsRef = useRef(null);

  const ownDecimated = useMemo(() => decimate(analysis.series, 700), [analysis.series]);
  const decimated = decimatedProp || ownDecimated;

  const availableModes = MAP_MODES.filter((m) => {
    if (m.key === "hr") return analysis.hasHR;
    if (m.key === "grade" || m.key === "altitude") return analysis.hasEle;
    if (m.key === "speed") return analysis.hasTime;
    return true;
  });

  const metricRange = useMemo(() => {
    if (colorMode === "speed" && analysis.hasTime) {
      const vals = decimated.map((p) => p.speed).filter((v) => v != null);
      return [Math.min(...vals), Math.max(...vals)];
    }
    if (colorMode === "altitude" && analysis.hasEle) return [analysis.minEle, analysis.maxEle];
    if (colorMode === "hr" && analysis.hasHR) {
      const vals = decimated.map((p) => p.hr).filter((v) => v != null);
      return [Math.min(...vals), Math.max(...vals)];
    }
    if (colorMode === "grade" && analysis.hasEle) return [-8, 12];
    return [0, 1];
  }, [colorMode, decimated, analysis]);

  function segColor(p) {
    if (colorMode === "track") return COLORS.speed;
    const [lo, hi] = metricRange;
    const val = colorMode === "speed" ? p.speed : colorMode === "altitude" ? p.ele : colorMode === "hr" ? p.hr : p.grade;
    if (val == null || hi === lo) return COLORS.speed;
    const t = (val - lo) / (hi - lo);
    const stops = colorMode === "speed" ? SPEED_SCALE : colorMode === "altitude" ? ELE_SCALE : colorMode === "hr" ? HR_SCALE : GRADE_SCALE;
    return scaleColor(t, stops);
  }

  // Initialise la carte Leaflet une seule fois (module npm réel : tuiles
  // fonctionnelles ici, contrairement à l'aperçu Claude qui bloque ces requêtes).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const first = decimated[0];
    map.setView([first.lat, first.lon], 13);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dessine / redessine le tracé, les marqueurs et ajuste le zoom sur le parcours.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerGroupRef.current) layerGroupRef.current.remove();
    const group = L.layerGroup().addTo(map);
    layerGroupRef.current = group;

    // Ligne large invisible : sert de zone de survol pour synchroniser le profil.
    if (onHoverIndex) {
      const hitLine = L.polyline(decimated.map((p) => [p.lat, p.lon]), {
        color: "#000",
        weight: 20,
        opacity: 0.001,
      }).addTo(group);
      hitLine.on("mousemove", (e) => onHoverIndex(nearestIdxByLatLng(decimated, e.latlng.lat, e.latlng.lng)));
      hitLine.on("mouseout", () => onHoverIndex(null));
    }

    if (colorMode === "track") {
      L.polyline(decimated.map((p) => [p.lat, p.lon]), {
        color: COLORS.speed,
        weight: 4,
        opacity: 0.9,
        lineJoin: "round",
      }).addTo(group);
    } else {
      for (let i = 1; i < decimated.length; i++) {
        L.polyline(
          [
            [decimated[i - 1].lat, decimated[i - 1].lon],
            [decimated[i].lat, decimated[i].lon],
          ],
          { color: segColor(decimated[i]), weight: 4, opacity: 0.9 }
        ).addTo(group);
      }
    }

    if (selectedClimb) {
      const seg = analysis.series.slice(selectedClimb.startIdx, selectedClimb.endIdx + 1);
      L.polyline(seg.map((p) => [p.lat, p.lon]), {
        color: COLORS.climb,
        weight: 6,
        opacity: 0.95,
        lineJoin: "round",
      }).addTo(group);
      const bounds = L.latLngBounds(seg.map((p) => [p.lat, p.lon]));
      map.flyToBounds(bounds, { padding: [40, 40], duration: 0.6 });
    }

    (analysis.climbs || []).forEach((c) => {
      const p = analysis.series[c.startIdx];
      L.circleMarker([p.lat, p.lon], {
        radius: 6,
        color: "#0a0d0c",
        weight: 2,
        fillColor: COLORS.climb,
        fillOpacity: 1,
      })
        .addTo(group)
        .bindPopup(`<b>${c.name}</b><br/>${fmt1(c.lengthKm)} km · +${fmtInt(c.gain)} m · ${fmt1(c.avgGrade)} %`);
    });

    const start = decimated[0],
      end = decimated[decimated.length - 1];
    L.circleMarker([start.lat, start.lon], { radius: 7, color: "#0a0d0c", weight: 2, fillColor: "#4dd9c0", fillOpacity: 1 })
      .addTo(group)
      .bindPopup("Départ");
    L.circleMarker([end.lat, end.lon], { radius: 7, color: "#0a0d0c", weight: 2, fillColor: "#e8543a", fillOpacity: 1 })
      .addTo(group)
      .bindPopup("Arrivée");

    if (!selectedClimb) {
      const bounds = L.latLngBounds(decimated.map((p) => [p.lat, p.lon]));
      boundsRef.current = bounds;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [28, 28] });
    }
  }, [analysis, colorMode, decimated, selectedClimb]);

  // Marqueur curseur : suit le survol du profil d'altitude (synchronisation graphique → carte).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hoverIdx == null || !decimated[hoverIdx]) {
      if (cursorRef.current) {
        cursorRef.current.remove();
        cursorRef.current = null;
      }
      return;
    }
    const p = decimated[hoverIdx];
    if (!cursorRef.current) {
      cursorRef.current = L.circleMarker([p.lat, p.lon], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: COLORS.climb,
        fillOpacity: 1,
      }).addTo(map);
    } else {
      cursorRef.current.setLatLng([p.lat, p.lon]);
    }
  }, [hoverIdx, decimated]);

  function recenter() {
    const map = mapRef.current;
    if (map && boundsRef.current) map.fitBounds(boundsRef.current, { padding: [28, 28] });
  }

  return (
    <div className="gpx-map-block">
      <div className="gpx-map-toolbar">
        <div className="gpx-map-modes">
          {availableModes.map((m) => (
            <button
              key={m.key}
              className={"gpx-chip" + (colorMode === m.key ? " gpx-chip-active" : "")}
              onClick={() => setColorMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="gpx-icon-btn" onClick={recenter} title="Recentrer sur le parcours">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="gpx-leaflet-container" style={{ height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
      {colorMode !== "track" && (
        <div className="gpx-map-scale">
          <div
            className="gpx-map-scale-bar"
            style={{
              background: `linear-gradient(90deg, ${(colorMode === "speed" ? SPEED_SCALE : colorMode === "altitude" ? ELE_SCALE : colorMode === "hr" ? HR_SCALE : GRADE_SCALE).join(",")})`,
            }}
          />
          <div className="gpx-map-scale-labels">
            <span>{colorMode === "grade" ? "-8 %" : fmtInt(metricRange[0])}</span>
            <span>{colorMode === "grade" ? "+12 %" : fmtInt(metricRange[1])}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   PROFILE CHART — profil (altitude / pente / vitesse / FC / cadence / puissance)
   synchronisé avec la carte dans les deux sens : survol/glisser ici déplace le
   marqueur sur la carte, et survoler le tracé sur la carte déplace le curseur
   ici. Rendu en <canvas> pour rester fluide même avec beaucoup de points.
   ========================================================================== */

function availableProfileMetrics(analysis) {
  const list = [];
  if (analysis.hasEle) list.push({ key: "altitude", label: "Altitude", dataKey: "ele" });
  if (analysis.hasEle) list.push({ key: "pente", label: "Pente", dataKey: "grade" });
  if (analysis.hasTime) list.push({ key: "vitesse", label: "Vitesse", dataKey: "speed" });
  if (analysis.hasHR) list.push({ key: "fc", label: "FC", dataKey: "hr" });
  if (analysis.hasCad) list.push({ key: "cadence", label: "Cadence", dataKey: "cad" });
  if (analysis.hasPower) list.push({ key: "puissance", label: "Puissance", dataKey: "power" });
  return list;
}
function fmtAxisVal(metric, v) {
  if (v == null || isNaN(v)) return "—";
  if (metric === "altitude") return fmtInt(v) + " m";
  if (metric === "pente") return fmt1(v) + " %";
  if (metric === "vitesse") return fmt1(v) + " km/h";
  if (metric === "fc") return fmtInt(v) + " bpm";
  if (metric === "cadence") return fmtInt(v) + " rpm";
  if (metric === "puissance") return fmtInt(v) + " W";
  return fmt1(v);
}

function ProfileChart({ analysis, decimated, metric, setMetric, hoverIdx, setHoverIdx, selectedClimb, onSelectClimb, height = 200 }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);
  const metrics = useMemo(() => availableProfileMetrics(analysis), [analysis]);
  const activeMetric = metrics.find((m) => m.key === metric) || metrics[0];

  useEffect(() => {
    function onResize() {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const dataKey = activeMetric ? activeMetric.dataKey : "ele";
  const values = decimated.map((p) => p[dataKey]).filter((v) => v != null);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const distMin = decimated[0] ? decimated[0].distance : 0;
  const distMax = decimated[decimated.length - 1] ? decimated[decimated.length - 1].distance : 1;

  const padL = 44,
    padR = 12,
    padT = 14,
    padB = 22;
  function xForDist(d) {
    return padL + ((d - distMin) / (distMax - distMin || 1)) * (width - padL - padR);
  }
  function yForVal(v) {
    const h = height - padT - padB;
    return padT + h - ((v - minV) / (maxV - minV || 1)) * h;
  }
  function distForX(x) {
    return distMin + ((x - padL) / (width - padL - padR || 1)) * (distMax - distMin);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeMetric) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    (analysis.climbs || []).forEach((c) => {
      const x1 = xForDist(c.startDistance),
        x2 = xForDist(c.endDistance);
      ctx.fillStyle = selectedClimb && selectedClimb.id === c.id ? "rgba(244,183,64,0.22)" : "rgba(244,183,64,0.08)";
      ctx.fillRect(x1, padT, x2 - x1, height - padT - padB);
    });

    ctx.strokeStyle = "rgba(237,239,236,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (height - padT - padB);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

    const accentMap = { altitude: COLORS.climb, pente: COLORS.climb, vitesse: COLORS.speed, fc: COLORS.effort, cadence: COLORS.info, puissance: COLORS.info };
    const stroke = accentMap[metric] || COLORS.speed;
    ctx.beginPath();
    let started = false;
    decimated.forEach((p) => {
      const v = p[dataKey];
      if (v == null) {
        started = false;
        return;
      }
      const x = xForDist(p.distance),
        y = yForVal(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(xForDist(distMax), yForVal(minV));
    ctx.lineTo(xForDist(distMin), yForVal(minV));
    ctx.closePath();
    ctx.fillStyle = stroke + "22";
    ctx.fill();

    ctx.fillStyle = "rgba(139,148,142,0.9)";
    ctx.font = "10.5px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(fmtAxisVal(metric, maxV), 2, padT + 8);
    ctx.fillText(fmtAxisVal(metric, minV), 2, height - padB);
    ctx.fillStyle = "rgba(139,148,142,0.7)";
    ctx.fillText(fmt1(distMin) + " km", padL + 2, height - 6);
    ctx.textAlign = "right";
    ctx.fillText(fmt1(distMax) + " km", width - padR, height - 6);

    if (hoverIdx != null && decimated[hoverIdx]) {
      const p = decimated[hoverIdx];
      const x = xForDist(p.distance);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, height - padB);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const v = p[dataKey];
      if (v != null) {
        const y = yForVal(v);
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.strokeStyle = "#0a0d0c";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, decimated, metric, hoverIdx, selectedClimb, analysis]);

  function idxFromClientX(clientX) {
    const rect = canvasRef.current.getBoundingClientRect();
    const d = distForX(clientX - rect.left);
    let lo = 0,
      hi = decimated.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (decimated[mid].distance < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function handleMove(clientX) {
    setHoverIdx(idxFromClientX(clientX));
  }
  function handleClick(clientX) {
    const idx = idxFromClientX(clientX);
    const p = decimated[idx];
    const c = (analysis.climbs || []).find((cl) => p.distance >= cl.startDistance && p.distance <= cl.endDistance);
    if (c) onSelectClimb(selectedClimb && selectedClimb.id === c.id ? null : c);
  }

  const hoverPoint = hoverIdx != null ? decimated[hoverIdx] : null;
  if (!activeMetric) return null;

  return (
    <div ref={wrapRef} className="gpx-profile-wrap">
      <div className="gpx-map-modes" style={{ marginBottom: 10 }}>
        {metrics.map((m) => (
          <button key={m.key} className={"gpx-chip" + (metric === m.key ? " gpx-chip-active" : "")} onClick={() => setMetric(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => handleMove(e.clientX)}
          onMouseLeave={() => setHoverIdx(null)}
          onClick={(e) => handleClick(e.clientX)}
          onTouchStart={(e) => handleMove(e.touches[0].clientX)}
          onTouchMove={(e) => {
            e.preventDefault();
            handleMove(e.touches[0].clientX);
          }}
          style={{ display: "block", cursor: "crosshair", touchAction: "none", borderRadius: 12 }}
        />
        {hoverPoint && (
          <div className="gpx-tooltip" style={{ position: "absolute", top: 6, left: Math.min(width - 175, Math.max(0, xForDist(hoverPoint.distance) + 10)), pointerEvents: "none" }}>
            <div className="gpx-tooltip-row gpx-tooltip-main">{fmt1(hoverPoint.distance)} km</div>
            {hoverPoint.ele != null && <div className="gpx-tooltip-row"><span>Altitude</span><b>{fmtInt(hoverPoint.ele)} m</b></div>}
            {hoverPoint.grade != null && <div className="gpx-tooltip-row"><span>Pente</span><b>{fmt1(hoverPoint.grade)} %</b></div>}
            {hoverPoint.speed != null && <div className="gpx-tooltip-row"><span>Vitesse</span><b>{fmt1(hoverPoint.speed)} km/h</b></div>}
            {hoverPoint.hr != null && <div className="gpx-tooltip-row"><span>FC</span><b>{fmtInt(hoverPoint.hr)} bpm</b></div>}
            {hoverPoint.cad != null && <div className="gpx-tooltip-row"><span>Cadence</span><b>{fmtInt(hoverPoint.cad)} rpm</b></div>}
            {hoverPoint.power != null && <div className="gpx-tooltip-row"><span>Puissance</span><b>{fmtInt(hoverPoint.power)} W</b></div>}
            {hoverPoint.time && <div className="gpx-tooltip-row"><span>Heure</span><b>{fmtClock(hoverPoint.time)}</b></div>}
          </div>
        )}
      </div>
      {selectedClimb && (
        <div className="gpx-climb-inline-stats">
          <b>{selectedClimb.name}</b>
          <span>{fmt1(selectedClimb.lengthKm)} km</span>
          <span>+{fmtInt(selectedClimb.gain)} m</span>
          <span>{fmt1(selectedClimb.avgGrade)}% moy.</span>
          <span>{fmt1(selectedClimb.maxGrade)}% max</span>
          <button className="gpx-icon-btn" onClick={() => onSelectClimb(null)}><X size={13} /></button>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   MAIN APP
   ========================================================================== */

const DEFAULT_HR_ZONES = [
  { name: "Z1 Récup", min: 0, max: 60, color: "#4dd9c0" },
  { name: "Z2 Endurance", min: 60, max: 70, color: "#8fd66a" },
  { name: "Z3 Tempo", min: 70, max: 80, color: "#f4b740" },
  { name: "Z4 Seuil", min: 80, max: 90, color: "#e8834a" },
  { name: "Z5 VO2max", min: 90, max: 999, color: "#e8543a" },
];

export default function GPXAnalyzer() {
  const [mode, setMode] = useState("landing"); // landing | dashboard
  const [isDemo, setIsDemo] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [rideName, setRideName] = useState(null);
  const [points, setPoints] = useState(null);

  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const [activeTab, setActiveTab] = useState("resume");
  const [mapColorMode, setMapColorMode] = useState("speed");
  const [hoverIdx, setHoverIdx] = useState(null);
  const [profileMetric, setProfileMetric] = useState("altitude");
  const [selectedClimb, setSelectedClimb] = useState(null);
  const [splitSort, setSplitSort] = useState({ key: "km", dir: 1 });
  const [climbSort, setClimbSort] = useState({ key: "id", dir: 1 });
  const [maxHR, setMaxHR] = useState(190);
  const [hrZones, setHrZones] = useState(DEFAULT_HR_ZONES);
  const [showSettings, setShowSettings] = useState(false);
  const [excludeStopsFromCharts, setExcludeStopsFromCharts] = useState(false);

  // Paramètres utilisateur pour la puissance
  const [userSettings, setUserSettings] = useState(() => {
    const saved = localStorage.getItem("gpx-user-settings");
    return saved ? JSON.parse(saved) : {
      weight: 75,
      bikeWeight: 8,
      ftp: 250,
      estimatePower: false,
    };
  });

  const fileInputRef = useRef(null);

  // Sauvegarder les paramètres quand ils changent
  useEffect(() => {
    localStorage.setItem("gpx-user-settings", JSON.stringify(userSettings));
  }, [userSettings]);

  const analysis = useMemo(() => (points ? computeAnalysis(points, userSettings) : null), [points, userSettings]);
  const powerZones = useMemo(
    () => (analysis && analysis.hasPower && userSettings.ftp ? computePowerZones(analysis.series, userSettings.ftp) : null),
    [analysis, userSettings.ftp]
  );
  const hrZoneStats = useMemo(
    () => (analysis && analysis.hasHR ? computeHRZones(analysis, maxHR, hrZones) : null),
    [analysis, maxHR, hrZones]
  );
  const summaryText = useMemo(() => (analysis ? generateSummary(analysis) : ""), [analysis]);
  const highlights = useMemo(() => (analysis ? generateHighlights(analysis) : { strengths: [], notable: [] }), [analysis]);
  // Set des indices appartenant à un arrêt (utilisé pour filtrer chartData)
  const stopIndexSet = useMemo(() => {
    if (!analysis || !analysis.stops) return new Set();
    const set = new Set();
    for (const st of analysis.stops) {
      for (let i = st.startIdx; i <= st.endIdx; i++) set.add(i);
    }
    return set;
  }, [analysis]);

  const chartData = useMemo(() => {
    if (!analysis) return [];
    const decimated = decimate(analysis.series, 900);
    if (excludeStopsFromCharts && stopIndexSet.size > 0) {
      return decimated.filter((p) => !stopIndexSet.has(p.idx));
    }
    return decimated;
  }, [analysis, excludeStopsFromCharts, stopIndexSet]);
  const powerCurve = useMemo(
    () => (analysis && analysis.hasPower && analysis.hasTime
      ? computeBestPowerEfforts(analysis.series, [5, 10, 30, 60, 300, 600, 1200, 1800, 3600])
      : null),
    [analysis]
  );

  // Analyse de puissance — uniquement à partir de données réellement présentes
  const powerAnalysis = useMemo(() => {
    if (!analysis || !analysis.hasPower || !analysis.hasTime) return null;
    const series = analysis.series;
    const ftp = userSettings.ftp;
    // 1. Zone dominante (si FTP connue et powerZones calculé via useMemo suivant)
    //    On calcule ici nous-mêmes pour ne pas dépendre de l'ordre d'évaluation.
    let dominant = null;
    if (ftp > 0) {
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
          if (pct >= z.min && pct < z.max) { z.time += dt; break; }
        }
      }
      let best = null;
      for (const z of zones) {
        if (z.time <= 0) continue;
        if (!best || z.time > best.time) best = { name: z.name, time: z.time, color: z.color };
      }
      dominant = best;
    }

    // 2. Passages au-dessus de FTP (segments contigus >= 10 s, agrégés)
    let aboveSegments = null;
    if (ftp > 0) {
      const segments = [];
      let curStart = null, curSum = 0, curN = 0;
      for (let i = 0; i < series.length; i++) {
        if (series[i].power == null || series[i].elapsed == null) { if (curStart != null) { segments.push({ startIdx: curStart, endIdx: i - 1, sum: curSum, n: curN }); curStart = null; curSum = 0; curN = 0; } continue; }
        const isOver = series[i].power > ftp;
        if (isOver) {
          if (curStart == null) { curStart = i; curSum = 0; curN = 0; }
          curSum += series[i].power; curN += 1;
        } else if (curStart != null) {
          segments.push({ startIdx: curStart, endIdx: i - 1, sum: curSum, n: curN });
          curStart = null; curSum = 0; curN = 0;
        }
      }
      if (curStart != null) segments.push({ startIdx: curStart, endIdx: series.length - 1, sum: curSum, n: curN });
      // durée = elapsed[end] - elapsed[start]
      const real = segments
        .map((s) => ({ ...s, dur: series[s.endIdx].elapsed - series[s.startIdx].elapsed, avgW: s.sum / s.n }))
        .filter((s) => s.dur >= 10);
      const totalDur = real.reduce((a, s) => a + s.dur, 0);
      const totalCount = real.length;
      aboveSegments = { count: totalCount, totalDur, longest: real.length ? real.reduce((a, b) => (b.dur > a.dur ? b : a)) : null };
    }

    // 3. Régularité : CV (écart-type / moyenne) sur les watts en mouvement
    let variability = null;
    {
      const vals = series.filter((p) => p.power != null && p.speed != null && p.speed > 0.5).map((p) => p.power);
      if (vals.length >= 10) {
        const m = avg(vals);
        const variance = avg(vals.map((v) => (v - m) ** 2));
        const sd = Math.sqrt(variance);
        if (m > 0) variability = { mean: m, sd, cv: sd / m };
      }
    }

    // 4. Meilleures périodes : top 3 intervalles contigus les plus longs où puissance moy > 75% FTP
    let bestPeriods = null;
    if (ftp > 0) {
      const threshold = 0.75 * ftp;
      const segments = [];
      let curStart = null, curSum = 0, curN = 0;
      for (let i = 0; i < series.length; i++) {
        if (series[i].power == null || series[i].elapsed == null) { if (curStart != null) { segments.push({ startIdx: curStart, endIdx: i - 1, sum: curSum, n: curN }); curStart = null; curSum = 0; curN = 0; } continue; }
        const ok = series[i].power >= threshold;
        if (ok) {
          if (curStart == null) { curStart = i; curSum = 0; curN = 0; }
          curSum += series[i].power; curN += 1;
        } else if (curStart != null) {
          segments.push({ startIdx: curStart, endIdx: i - 1, sum: curSum, n: curN });
          curStart = null; curSum = 0; curN = 0;
        }
      }
      if (curStart != null) segments.push({ startIdx: curStart, endIdx: series.length - 1, sum: curSum, n: curN });
      const real = segments
        .map((s) => ({ ...s, dur: series[s.endIdx].elapsed - series[s.startIdx].elapsed, avgW: s.sum / s.n }))
        .filter((s) => s.dur >= 20); // au moins 20 s
      real.sort((a, b) => b.dur - a.dur);
      bestPeriods = real.slice(0, 3).map((s) => ({
        dur: s.dur,
        avgW: s.avgW,
        startElapsed: series[s.startIdx].elapsed,
        endElapsed: series[s.endIdx].elapsed,
      }));
    }

  return { dominant, aboveSegments, variability, bestPeriods };
}, [analysis, userSettings.ftp]);

  // Distribution de pente — distance / temps / puissance moyenne par catégorie
  const gradeDistribution = useMemo(() => {
    if (!analysis || !analysis.hasEle || !analysis.hasTime) return null;
    const cats = [
      { key: "<0",     label: "< 0 %",   test: (g) => g < 0 },
      { key: "0-3",    label: "0–3 %",   test: (g) => g >= 0  && g < 3 },
      { key: "3-6",    label: "3–6 %",   test: (g) => g >= 3  && g < 6 },
      { key: "6-9",    label: "6–9 %",   test: (g) => g >= 6  && g < 9 },
      { key: "9-12",   label: "9–12 %",  test: (g) => g >= 9  && g < 12 },
      { key: "12-15",  label: "12–15 %", test: (g) => g >= 12 && g < 15 },
      { key: ">15",    label: "> 15 %",  test: (g) => g >= 15 },
    ];
    const buckets = cats.map((c) => ({ ...c, distance: 0, time: 0, powerSum: 0, powerN: 0 }));
    const s = analysis.series;
    for (let i = 1; i < s.length; i++) {
      if (s[i].grade == null || s[i].elapsed == null) continue;
      const dt = s[i].elapsed - s[i - 1].elapsed;
      if (dt <= 0) continue;
      const dd = s[i].distance - s[i - 1].distance; // km
      if (dd < 0) continue;
      const b = buckets.find((b) => b.test(s[i].grade));
      if (!b) continue;
      b.distance += dd;
      b.time += dt;
      if (s[i].power != null) { b.powerSum += s[i].power; b.powerN += 1; }
    }
    return buckets;
  }, [analysis]);

  const loadFile = useCallback((file) => {
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { name, points } = parseGPXString(e.target.result);
        setPoints(points);
        setRideName(name);
        setFileName(file.name);
        setIsDemo(false);
        setMode("dashboard");
        setActiveTab("resume");
        setSelectedClimb(null);
      } catch (err) {
        setError(err.message || "Impossible de lire ce fichier GPX.");
      }
    };
    reader.onerror = () => setError("Erreur de lecture du fichier.");
    reader.readAsText(file);
  }, []);

  function handleInputChange(e) {
    const file = e.target.files && e.target.files[0];
    loadFile(file);
    e.target.value = "";
  }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  }
  function loadDemo() {
    const { name, points } = generateDemoPoints();
    setPoints(points);
    setRideName(name);
    setFileName(null);
    setIsDemo(true);
    setError(null);
    setMode("dashboard");
    setActiveTab("resume");
    setSelectedClimb(null);
  }
  function resetAll() {
    setPoints(null);
    setSelectedClimb(null);
    setActiveTab("resume");
    setMode("landing");
    setError(null);
    setIsDemo(false);
    setFileName(null);
    setRideName(null);
  }
  function exportPDF() {
    window.print();
  }

  function sortRows(rows, sortState) {
    const { key, dir } = sortState;
    return [...rows].sort((a, b) => {
      const va = a[key],
        vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va > vb ? dir : va < vb ? -dir : 0;
    });
  }
  function toggleSort(state, setState, key) {
    setState((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  const TABS = [
    { key: "resume", label: "Résumé" },
    { key: "carte", label: "Carte" },
    { key: "performance", label: "Performance" },
    { key: "montees", label: "Montées", disabled: analysis && analysis.climbs.length === 0 },
    { key: "graphiques", label: "Graphiques" },
    { key: "splits", label: "Splits" },
    { key: "parametres", label: "Paramètres" },
  ];

  return (
    <div className="gpx-app">
      <style>{`
        .gpx-app {
          --bg:#0a0d0c; --bgAlt:#0e1211; --surface:#141917; --surface2:#1a201d;
          --border:rgba(237,239,236,0.08); --borderStrong:rgba(237,239,236,0.16);
          --text:#eef1ee; --muted:#8b948e; --faint:#5c645f;
          --speed:#4dd9c0; --climb:#f4b740; --effort:#e8543a; --alert:#ff5470; --info:#6f9cf2;
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
          position: relative;
          isolation: isolate;
        }
        .gpx-app * { box-sizing: border-box; }
        .gpx-app button { font-family: inherit; cursor: pointer; }
        .gpx-app ::selection { background: var(--speed); color: #06110e; }

        /* ---------- Landing ---------- */
        .gpx-landing {
          min-height: 100vh;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 32px 20px;
          background:
            radial-gradient(ellipse 900px 500px at 20% -10%, rgba(77,217,192,0.10), transparent 60%),
            radial-gradient(ellipse 700px 500px at 100% 110%, rgba(244,183,64,0.08), transparent 60%),
            var(--bg);
        }
        .gpx-landing-inner { max-width: 620px; width: 100%; text-align: center; }
        .gpx-landing-eyebrow {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--speed); font-weight: 700; margin-bottom: 18px;
        }
        .gpx-landing-title {
          font-size: 40px; line-height: 1.08; font-weight: 800; letter-spacing: -0.02em;
          margin: 0 0 12px 0;
        }
        .gpx-landing-title span { color: var(--speed); }
        .gpx-landing-sub {
          color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 460px; margin: 0 auto 34px auto;
        }
        .gpx-upload-zone {
          border: 1.5px dashed var(--borderStrong);
          border-radius: 20px;
          padding: 44px 24px;
          background: rgba(255,255,255,0.015);
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .gpx-upload-zone.drag { border-color: var(--speed); background: rgba(77,217,192,0.06); }
        .gpx-upload-icon {
          width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 18px auto;
          display: flex; align-items: center; justify-content: center;
          background: rgba(77,217,192,0.12); color: var(--speed);
        }
        .gpx-upload-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
        .gpx-upload-sub { font-size: 13px; color: var(--muted); margin-bottom: 20px; }
        .gpx-btn-primary {
          background: var(--speed); color: #06140f; border: none; border-radius: 12px;
          padding: 12px 22px; font-weight: 700; font-size: 14px;
          display: inline-flex; align-items: center; gap: 8px;
          transition: transform 0.15s ease, filter 0.15s ease;
        }
        .gpx-btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
        .gpx-landing-demo { margin-top: 22px; }
        .gpx-link-btn {
          background: none; border: none; color: var(--muted); font-size: 13px;
          text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--faint);
        }
        .gpx-link-btn:hover { color: var(--text); }
        .gpx-error-box {
          margin-top: 18px; padding: 12px 16px; border-radius: 12px;
          background: rgba(232,84,58,0.1); border: 1px solid rgba(232,84,58,0.3);
          color: #ffb3a5; font-size: 13px; display: flex; align-items: center; gap: 8px; text-align: left;
        }
        .gpx-landing-features {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 40px;
        }
        .gpx-landing-feature {
          padding: 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border);
          font-size: 12px; color: var(--muted); text-align: left;
        }
        .gpx-landing-feature b { display: block; color: var(--text); font-size: 13px; margin-bottom: 3px; }

        /* ---------- Dashboard shell ---------- */
        .gpx-dashboard { max-width: 1180px; margin: 0 auto; padding: 20px 20px 80px 20px; }
        .gpx-header {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
          padding: 20px 22px; border-radius: 20px; margin-bottom: 16px;
          background: linear-gradient(135deg, var(--surface), var(--bgAlt));
          border: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .gpx-demo-banner {
          display: flex; align-items: center; gap: 8px;
          background: rgba(244,183,64,0.12); border: 1px solid rgba(244,183,64,0.35);
          color: var(--climb); font-size: 12.5px; font-weight: 600;
          padding: 9px 14px; border-radius: 12px; margin-bottom: 14px;
        }
        .gpx-header-left { min-width: 0; }
        .gpx-ride-name { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 4px 0; word-break: break-word; }
        .gpx-ride-meta { color: var(--muted); font-size: 13px; display: flex; gap: 14px; flex-wrap: wrap; }
        .gpx-header-quickstats { display: flex; gap: 22px; flex-wrap: wrap; }
        .gpx-qs { text-align: right; }
        .gpx-qs-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--faint); margin-bottom: 3px; }
        .gpx-qs-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .gpx-header-actions { display: flex; gap: 8px; align-items: center; }
        .gpx-icon-btn {
          width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--border);
          background: var(--surface2); color: var(--muted);
          display: flex; align-items: center; justify-content: center;
        }
        .gpx-icon-btn:hover { color: var(--text); border-color: var(--borderStrong); }
        .gpx-btn-ghost {
          border: 1px solid var(--border); background: var(--surface2); color: var(--text);
          border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .gpx-btn-ghost:hover { border-color: var(--borderStrong); }

        /* ---------- Nav tabs ---------- */
        .gpx-nav {
          display: flex; gap: 4px; margin-bottom: 20px; overflow-x: auto;
          border-bottom: 1px solid var(--border); padding-bottom: 0;
        }
        .gpx-tab {
          border: none; background: none; color: var(--muted); font-size: 13.5px; font-weight: 600;
          padding: 11px 16px; border-bottom: 2px solid transparent; white-space: nowrap;
          transition: color 0.15s ease;
        }
        .gpx-tab:hover:not(:disabled) { color: var(--text); }
        .gpx-tab.active { color: var(--speed); border-bottom-color: var(--speed); }
        .gpx-tab:disabled { opacity: 0.35; cursor: not-allowed; }

        /* ---------- Stats grid ---------- */
        .gpx-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
        .gpx-stat-card {
          display: flex; gap: 12px; align-items: flex-start;
          background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px;
        }
        .gpx-stat-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gpx-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
        .gpx-stat-value { font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .gpx-stat-unit { font-size: 12px; font-weight: 600; color: var(--muted); margin-left: 3px; }
        .gpx-stat-sub { font-size: 11px; color: var(--faint); margin-top: 3px; }

        /* ---------- Panels ---------- */
        .gpx-panel {
          background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
          padding: 18px 20px; margin-bottom: 16px;
        }
        .gpx-section-title {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--text); margin-bottom: 14px;
        }
        .gpx-section-title-left { display: flex; align-items: center; gap: 7px; color: var(--speed); }
        .gpx-section-title-left span { color: var(--text); }

        /* ---------- Map (Leaflet) ---------- */
        .gpx-map-block { position: relative; }
        .gpx-map-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
        .gpx-map-modes { display: flex; gap: 6px; flex-wrap: wrap; }
        .gpx-chip {
          border: 1px solid var(--border); background: var(--surface2); color: var(--muted);
          border-radius: 100px; padding: 6px 12px; font-size: 12px; font-weight: 600;
        }
        .gpx-chip-active { background: rgba(77,217,192,0.15); border-color: var(--speed); color: var(--speed); }
        .gpx-leaflet-container {
          position: relative; border-radius: 16px; overflow: hidden; background: var(--bgAlt);
          border: 1px solid var(--border);
        }
        .gpx-leaflet-container .leaflet-container { background: var(--bgAlt); font-family: inherit; }
        .gpx-leaflet-container .leaflet-popup-content-wrapper { background: #0e1211; color: var(--text); border-radius: 10px; }
        .gpx-leaflet-container .leaflet-popup-content { font-size: 12.5px; }
        .gpx-leaflet-container .leaflet-popup-tip { background: #0e1211; }
        .gpx-leaflet-container a.leaflet-popup-close-button { color: var(--muted); }
        .gpx-map-loading {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          color: var(--muted); font-size: 13px; z-index: 500; background: var(--bgAlt);
        }
        .gpx-map-tile-warning {
          position: absolute; bottom: 10px; left: 10px; z-index: 500;
          background: rgba(10,13,12,0.85); border: 1px solid var(--borderStrong); border-radius: 8px;
          padding: 6px 10px; font-size: 11px; color: var(--muted);
        }
        .gpx-map-scale { margin-top: 10px; }
        .gpx-map-scale-bar { height: 6px; border-radius: 6px; }
        .gpx-map-scale-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--faint); margin-top: 4px; }
        .gpx-profile-wrap { background: var(--surface2); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
        .gpx-climb-inline-stats {
          display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 8px 12px;
          background: rgba(244,183,64,0.08); border: 1px solid rgba(244,183,64,0.3); border-radius: 10px;
          font-size: 12.5px; color: var(--muted); flex-wrap: wrap;
        }
        .gpx-climb-inline-stats b { color: var(--climb); }
        .gpx-climb-inline-stats .gpx-icon-btn { margin-left: auto; width: 26px; height: 26px; }

        /* ---------- Tooltip ---------- */
        .gpx-tooltip {
          background: #0e1211; border: 1px solid var(--borderStrong); border-radius: 10px;
          padding: 10px 12px; font-size: 12px; min-width: 130px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        .gpx-tooltip-main { font-weight: 800; margin-bottom: 6px; color: var(--speed); }
        .gpx-tooltip-row { display: flex; justify-content: space-between; gap: 14px; color: var(--muted); padding: 1px 0; }
        .gpx-tooltip-row b { color: var(--text); font-variant-numeric: tabular-nums; }

        /* ---------- Tables ---------- */
        .gpx-table-wrap { overflow-x: auto; }
        .gpx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .gpx-table th {
          text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em;
          color: var(--faint); padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; cursor: pointer;
          user-select: none;
        }
        .gpx-table th:hover { color: var(--muted); }
        .gpx-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .gpx-table tr:last-child td { border-bottom: none; }
        .gpx-table tr.gpx-row-clickable:hover { background: rgba(255,255,255,0.02); cursor: pointer; }
        .gpx-table tr.gpx-row-selected { background: rgba(244,183,64,0.08); }
        .gpx-badge-best { background: rgba(77,217,192,0.15); color: var(--speed); border-radius: 6px; padding: 2px 6px; font-size: 10.5px; font-weight: 700; margin-left: 6px; }
        .gpx-badge-worst { background: rgba(232,84,58,0.15); color: var(--effort); border-radius: 6px; padding: 2px 6px; font-size: 10.5px; font-weight: 700; margin-left: 6px; }
        .gpx-badge-climb { background: rgba(244,183,64,0.15); color: var(--climb); border-radius: 6px; padding: 2px 6px; font-size: 10.5px; font-weight: 700; margin-left: 6px; }

        /* ---------- Summary ---------- */
        .gpx-summary-text { font-size: 15px; line-height: 1.65; color: var(--text); margin-bottom: 18px; }

        .gpx-highlight-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .gpx-highlight-col-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
        .gpx-highlight-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .gpx-highlight-list li { font-size: 13px; color: var(--muted); padding-left: 16px; position: relative; line-height: 1.5; }
        .gpx-highlight-list li::before { content: "—"; position: absolute; left: 0; color: var(--faint); }

        /* ---------- Grid layouts ---------- */
        .gpx-two-col { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; }
        .gpx-climb-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .gpx-climb-card {
          background: var(--surface2); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .gpx-climb-card:hover { border-color: var(--borderStrong); }
        .gpx-climb-card.selected { border-color: var(--climb); background: rgba(244,183,64,0.07); }
        .gpx-climb-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .gpx-climb-card-name { font-weight: 800; font-size: 14px; }
        .gpx-climb-card-grade { font-size: 18px; font-weight: 800; color: var(--climb); font-variant-numeric: tabular-nums; }
        .gpx-climb-card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }

        .gpx-zone-bar-wrap { display: flex; flex-direction: column; gap: 8px; }
        .gpx-zone-row { display: grid; grid-template-columns: 110px 1fr 60px; align-items: center; gap: 10px; font-size: 12px; }
        .gpx-zone-name { color: var(--muted); }
        .gpx-zone-track { height: 10px; border-radius: 6px; background: var(--surface2); overflow: hidden; }
        .gpx-zone-fill { height: 100%; border-radius: 6px; }
        .gpx-zone-time { text-align: right; font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }

        .gpx-power-zone-row { display: grid; grid-template-columns: 150px 90px 1fr 90px 50px; align-items: center; gap: 10px; font-size: 12px; }
        .gpx-power-zone-name { color: var(--text); font-weight: 600; }
        .gpx-power-zone-watts { color: var(--muted); font-variant-numeric: tabular-nums; }
        .gpx-power-zone-time { text-align: right; font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
        .gpx-power-zone-pct { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 11px; }
        .gpx-power-efforts { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .gpx-power-source { display: inline-flex; align-items: center; gap: 4px; background: rgba(111,156,242,0.15); color: var(--info); border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; text-transform: none; letter-spacing: 0; }
        .gpx-power-source-estimated { display: inline-flex; align-items: center; gap: 4px; background: rgba(244,183,64,0.18); color: var(--climb); border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; text-transform: none; letter-spacing: 0; }

        .gpx-hr-config { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); }
        .gpx-hr-config input { width: 60px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; color: var(--text); font-size: 12px; }

        /* ---------- User settings ---------- */
        .gpx-params-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 18px; }
        .gpx-param-row {
          display: flex; align-items: center; justify-content: space-between; gap: 14px;
          background: var(--surface2); border: 1px solid var(--border); border-radius: 12px;
          padding: 12px 16px;
        }
        .gpx-param-label { font-size: 13px; font-weight: 600; color: var(--text); }
        .gpx-param-control { display: inline-flex; align-items: center; gap: 8px; }
        .gpx-param-control input {
          width: 90px; text-align: right;
          background: var(--bg); border: 1px solid var(--border);
          border-radius: 8px; padding: 7px 10px; color: var(--text); font-size: 13px;
          font-variant-numeric: tabular-nums; font-weight: 700;
        }
        .gpx-param-control input:focus { outline: none; border-color: var(--speed); }
        .gpx-param-unit { font-size: 12px; color: var(--muted); min-width: 18px; }
        .gpx-params-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .gpx-params-hint { font-size: 12px; color: var(--faint); font-style: italic; }

        .gpx-effort-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }

        .gpx-best-efforts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .gpx-effort-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 14px; padding: 14px; text-align: center; }
        .gpx-effort-card-label { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
        .gpx-effort-card-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .gpx-effort-card-sub { font-size: 11px; color: var(--muted); margin-top: 3px; }

        .gpx-stop-list { display: flex; flex-direction: column; gap: 8px; }
        .gpx-stop-item { display: flex; justify-content: space-between; font-size: 13px; padding: 8px 10px; background: var(--surface2); border-radius: 10px; }
        .gpx-stop-item span { color: var(--muted); }

        .gpx-chart-card-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
        .gpx-chart-card-stats { display: flex; gap: 16px; font-size: 12px; color: var(--muted); margin-bottom: 12px; }
        .gpx-chart-card-stats b { color: var(--text); }

        .gpx-empty-note { font-size: 12.5px; color: var(--faint); font-style: italic; }

        @media (max-width: 860px) {
          .gpx-stats-grid { grid-template-columns: repeat(2, 1fr); }
          .gpx-two-col { grid-template-columns: 1fr; }
          .gpx-highlight-grid { grid-template-columns: 1fr; }
          .gpx-effort-grid { grid-template-columns: 1fr; }
          .gpx-header { flex-direction: column; }
          .gpx-header-quickstats { width: 100%; justify-content: space-between; gap: 10px; }
          .gpx-landing-title { font-size: 30px; }
          .gpx-landing-features { grid-template-columns: 1fr; }
        }
        @media print {
          .gpx-nav, .gpx-header-actions { display: none !important; }
        }
      `}</style>

      {mode === "landing" && (
        <div className="gpx-landing">
          <div className="gpx-landing-inner">
            <div className="gpx-landing-eyebrow"><Mountain size={13} /> Analyse de sortie vélo</div>
            <h1 className="gpx-landing-title">Importez votre sortie<br /><span>GPX</span></h1>
            <p className="gpx-landing-sub">
              Glissez un fichier GPX pour obtenir un tableau de bord complet — carte, montées, splits, effort —
              calculé entièrement dans votre navigateur, sans compte ni serveur.
            </p>
            <div
              className={"gpx-upload-zone" + (dragOver ? " drag" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
            >
              <div className="gpx-upload-icon"><Upload size={24} /></div>
              <div className="gpx-upload-title">Glissez-déposez votre fichier .gpx ici</div>
              <div className="gpx-upload-sub">ou cliquez pour parcourir vos fichiers</div>
              <button className="gpx-btn-primary" onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}>
                <Upload size={15} /> Importer un GPX
              </button>
              <input ref={fileInputRef} type="file" accept=".gpx" style={{ display: "none" }} onChange={handleInputChange} />
            </div>
            {error && (
              <div className="gpx-error-box"><FileWarning size={15} /> {error}</div>
            )}
            <div className="gpx-landing-demo">
              <button className="gpx-link-btn" onClick={loadDemo}>Voir un exemple avec des données de démonstration (fictives)</button>
            </div>
            <div className="gpx-landing-features">
              <div className="gpx-landing-feature"><b>100% local</b>Aucune donnée n'est envoyée à un serveur.</div>
              <div className="gpx-landing-feature"><b>Détection auto</b>Montées, arrêts et meilleurs efforts calculés automatiquement.</div>
              <div className="gpx-landing-feature"><b>Adapté aux données dispo</b>FC, cadence, puissance affichées seulement si présentes.</div>
            </div>
          </div>
        </div>
      )}

      {mode === "dashboard" && analysis && (
        <div className="gpx-dashboard">
          {isDemo && (
            <div className="gpx-demo-banner">
              <Sparkles size={14} /> Données de démonstration — fictives, générées uniquement pour illustrer l'interface.
            </div>
          )}
          <div className="gpx-header">
            <div className="gpx-header-left">
              <h1 className="gpx-ride-name">{rideName || "Sortie vélo"}</h1>
              <div className="gpx-ride-meta">
                {analysis.startTime && <span>{fmtDateFull(analysis.startTime)}</span>}
                {analysis.startTime && <span>{fmtClock(analysis.startTime)}{analysis.endTime ? ` → ${fmtClock(analysis.endTime)}` : ""}</span>}
                {fileName && <span>{fileName}</span>}
              </div>
            </div>
            <div className="gpx-header-quickstats">
              <div className="gpx-qs"><div className="gpx-qs-label">Distance</div><div className="gpx-qs-value">{fmt1(analysis.totalDistanceKm)} km</div></div>
              <div className="gpx-qs"><div className="gpx-qs-label">Durée</div><div className="gpx-qs-value">{fmtDuration(analysis.totalTimeSec)}</div></div>
              {analysis.hasEle && <div className="gpx-qs"><div className="gpx-qs-label">D+</div><div className="gpx-qs-value">{fmtInt(analysis.elevGain)} m</div></div>}
            </div>
            <div className="gpx-header-actions">
              <button className="gpx-icon-btn" title="Exporter (PDF)" onClick={exportPDF}><Download size={15} /></button>
              <button className="gpx-btn-ghost" onClick={resetAll}><RefreshCw size={14} /> Nouvelle sortie</button>
            </div>
          </div>

          <div className="gpx-nav">
            {TABS.map((t) => (
              <button key={t.key} className={"gpx-tab" + (activeTab === t.key ? " active" : "")} disabled={t.disabled} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ---------------- RÉSUMÉ ---------------- */}
          {activeTab === "resume" && (
            <>
              <div className="gpx-stats-grid">
                <StatCard icon={Route} label="Distance" value={fmt1(analysis.totalDistanceKm)} unit="km" accent={COLORS.speed} />
                <StatCard icon={Clock} label="Temps total" value={fmtDuration(analysis.totalTimeSec)} accent={COLORS.info} />
                <StatCard icon={Timer} label="Temps en mouvement" value={fmtDuration(analysis.movingTimeSec)} accent={COLORS.info} />
                <StatCard icon={Gauge} label="Vitesse moyenne" value={fmt1(analysis.avgSpeedKmh)} unit="km/h" accent={COLORS.speed} />
                <StatCard icon={Zap} label="Vitesse maximale" value={fmt1(analysis.maxSpeedKmh)} unit="km/h" accent={COLORS.speed} />
                <StatCard icon={TrendingUp} label="Dénivelé positif" value={"+" + fmtInt(analysis.elevGain)} unit="m" accent={COLORS.climb} />
                <StatCard icon={TrendingUp} label="Dénivelé négatif" value={"-" + fmtInt(analysis.elevLoss)} unit="m" accent={COLORS.climb} />
                <StatCard icon={Mountain} label="Altitude maximale" value={fmtInt(analysis.maxEle)} unit="m" accent={COLORS.climb} />
                <StatCard icon={Mountain} label="Altitude minimale" value={fmtInt(analysis.minEle)} unit="m" accent={COLORS.climb} />
              </div>

              <div className="gpx-panel">
                <SectionTitle icon={MapPin}>Tracé</SectionTitle>
                <MapView analysis={analysis} colorMode={mapColorMode} setColorMode={setMapColorMode} selectedClimb={selectedClimb} height={380} />
              </div>

              <div className="gpx-panel">
                <SectionTitle icon={Sparkles}>Analyse de la sortie</SectionTitle>
                <p className="gpx-summary-text">{summaryText}</p>
                <div className="gpx-highlight-grid">
                  <div>
                    <div className="gpx-highlight-col-title" style={{ color: COLORS.speed }}><TrendingUp size={13} /> Points forts</div>
                    {highlights.strengths.length ? (
                      <ul className="gpx-highlight-list">{highlights.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    ) : <div className="gpx-empty-note">Pas assez de données pour dégager des points forts.</div>}
                  </div>
                  <div>
                    <div className="gpx-highlight-col-title" style={{ color: COLORS.climb }}><Flame size={13} /> Points remarquables</div>
                    {highlights.notable.length ? (
                      <ul className="gpx-highlight-list">{highlights.notable.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    ) : <div className="gpx-empty-note">Rien de particulier détecté sur cette sortie.</div>}
                  </div>
                </div>
              </div>

              {gradeDistribution && (
                <div className="gpx-panel">
                  <SectionTitle icon={Mountain}>Distribution de pente</SectionTitle>
                  <div className="gpx-table-wrap">
                    <table className="gpx-table">
                      <thead>
                        <tr>
                          <th>Pente</th>
                          <th>Distance</th>
                          <th>Temps</th>
                          <th>% temps</th>
                          {analysis.hasPower && <th>W moy.</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const totalKm = gradeDistribution.reduce((a, b) => a + b.distance, 0);
                          return gradeDistribution.map((b) => {
                            const distPct = totalKm > 0 ? (b.distance / totalKm) * 100 : 0;
                            const timePct = analysis.totalTimeSec ? (b.time / analysis.totalTimeSec) * 100 : 0;
                            return (
                              <tr key={b.key}>
                                <td><b>{b.label}</b></td>
                                <td>
                                  {fmt1(b.distance)} km
                                  <div style={{ height: 4, borderRadius: 2, background: "var(--surface2)", marginTop: 4, overflow: "hidden" }}>
                                    <div style={{ width: `${distPct}%`, height: "100%", background: "var(--climb)" }} />
                                  </div>
                                </td>
                                <td>{fmtDuration(b.time)}</td>
                                <td>{timePct.toFixed(1)} %</td>
                                {analysis.hasPower && <td>{b.powerN > 0 ? `${fmtInt(b.powerSum / b.powerN)} W` : "—"}</td>}
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------- CARTE ---------------- */}
          {activeTab === "carte" && (
            <div className="gpx-panel">
              <SectionTitle icon={MapPin} right={<span style={{ fontSize: 11, color: COLORS.textFaint, fontWeight: 500, textTransform: "none" }}>Survolez le profil ou le tracé — les deux restent synchronisés</span>}>
                Carte & profil synchronisés
              </SectionTitle>
              <MapView
                analysis={analysis}
                colorMode={mapColorMode}
                setColorMode={setMapColorMode}
                selectedClimb={selectedClimb}
                height={480}
                decimated={chartData}
                hoverIdx={hoverIdx}
                onHoverIndex={setHoverIdx}
              />
              <div style={{ marginTop: 16 }}>
                <ProfileChart
                  analysis={analysis}
                  decimated={chartData}
                  metric={profileMetric}
                  setMetric={setProfileMetric}
                  hoverIdx={hoverIdx}
                  setHoverIdx={setHoverIdx}
                  selectedClimb={selectedClimb}
                  onSelectClimb={setSelectedClimb}
                  height={200}
                />
              </div>
            </div>
          )}

          {/* ---------------- PERFORMANCE ---------------- */}
          {activeTab === "performance" && (
            <>
              {analysis.bestEfforts && (
                <div className="gpx-panel">
                  <SectionTitle icon={Zap}>Meilleurs efforts</SectionTitle>
                  <div className="gpx-best-efforts">
                    {[
                      { key: "k1", label: "1 km" },
                      { key: "k5", label: "5 km" },
                      { key: "k10", label: "10 km" },
                      { key: "k20", label: "20 km" },
                    ].map(({ key, label }) => {
                      const e = analysis.bestEfforts[key];
                      if (!e) return null;
                      return (
                        <div className="gpx-effort-card" key={key}>
                          <div className="gpx-effort-card-label">{label}</div>
                          <div className="gpx-effort-card-value">{fmtDuration(e.duration)}</div>
                          <div className="gpx-effort-card-sub">{fmt1(e.avgSpeed)} km/h · km {fmt1(e.startDistance)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {analysis.hasTime && (
                <div className="gpx-panel">
                  <SectionTitle icon={PauseCircle}>Arrêts & pauses</SectionTitle>
                  <div className="gpx-stats-grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
                    <StatCard icon={Clock} label="Temps total" value={fmtDurationLong(analysis.totalTimeSec)} accent={COLORS.info} />
                    <StatCard icon={Activity} label="Temps en mouvement" value={fmtDurationLong(analysis.movingTimeSec)} accent={COLORS.speed} />
                    <StatCard icon={PauseCircle} label="Temps arrêté" value={fmtDurationLong(analysis.stoppedTimeSec)} accent={COLORS.alert} />
                    <StatCard icon={PauseCircle} label="Nombre d'arrêts" value={fmtInt(analysis.stops.length)} accent={COLORS.alert} />
                    <StatCard icon={Timer} label="Plus long arrêt" value={analysis.stops.length ? fmtDurationLong(Math.max(...analysis.stops.map((s) => s.duration))) : "—"} accent={COLORS.alert} />
                  </div>
                  {analysis.stops.length > 0 && (
                    <label
                      className="gpx-toggle-row"
                      title="Masque les périodes d'arrêt dans les graphiques (altitude, vitesse, FC, puissance, etc.). Les données originales du GPX ne sont jamais modifiées."
                      style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--text)", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        checked={excludeStopsFromCharts}
                        onChange={(e) => setExcludeStopsFromCharts(e.target.checked)}
                      />
                      <span>Exclure les pauses des graphiques</span>
                    </label>
                  )}
                  {analysis.stops.length > 0 ? (
                    <div className="gpx-stop-list" style={{ marginTop: 12 }}>
                      {analysis.stops.map((s, i) => (
                        <div className="gpx-stop-item" key={i}>
                          <span>Arrêt {i + 1} · km {fmt1(s.distance)}</span>
                          <b>{fmtDurationLong(s.duration)}</b>
                        </div>
                      ))}
                    </div>
                  ) : <div className="gpx-empty-note" style={{ marginTop: 10 }}>Aucun arrêt significatif détecté.</div>}
                </div>
              )}

              {(analysis.hasHR || analysis.hasPower) && analysis.hasTime && (
                <div className="gpx-panel">
                  <SectionTitle icon={Activity}>Analyse de l'effort</SectionTitle>
                  <div className="gpx-effort-grid">
                    {analysis.hasHR && (
                      <div>
                        <div className="gpx-chart-card-title">Vitesse ↔ Fréquence cardiaque</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                            <CartesianGrid stroke={COLORS.border} />
                            <XAxis type="number" dataKey="speed" name="Vitesse" unit=" km/h" stroke={COLORS.textMuted} fontSize={11} />
                            <YAxis type="number" dataKey="hr" name="FC" unit=" bpm" stroke={COLORS.textMuted} fontSize={11} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
                            <Scatter data={chartData.filter((d) => d.speed != null && d.hr != null)} fill={COLORS.effort} opacity={0.55} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {analysis.hasHR && analysis.hasEle && (
                      <div>
                        <div className="gpx-chart-card-title">Altitude ↔ Fréquence cardiaque</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                            <CartesianGrid stroke={COLORS.border} />
                            <XAxis type="number" dataKey="ele" name="Altitude" unit=" m" stroke={COLORS.textMuted} fontSize={11} />
                            <YAxis type="number" dataKey="hr" name="FC" unit=" bpm" stroke={COLORS.textMuted} fontSize={11} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
                            <Scatter data={chartData.filter((d) => d.ele != null && d.hr != null)} fill={COLORS.climb} opacity={0.55} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {analysis.hasPower && analysis.hasHR && (
                      <div>
                        <div className="gpx-chart-card-title">Puissance ↔ Fréquence cardiaque</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                            <CartesianGrid stroke={COLORS.border} />
                            <XAxis type="number" dataKey="power" name="Puissance" unit=" W" stroke={COLORS.textMuted} fontSize={11} />
                            <YAxis type="number" dataKey="hr" name="FC" unit=" bpm" stroke={COLORS.textMuted} fontSize={11} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
                            <Scatter data={chartData.filter((d) => d.power != null && d.hr != null)} fill={COLORS.info} opacity={0.55} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    {analysis.hasPower && (
                      <div>
                        <div className="gpx-chart-card-title">Puissance ↔ Vitesse</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                            <CartesianGrid stroke={COLORS.border} />
                            <XAxis type="number" dataKey="power" name="Puissance" unit=" W" stroke={COLORS.textMuted} fontSize={11} />
                            <YAxis type="number" dataKey="speed" name="Vitesse" unit=" km/h" stroke={COLORS.textMuted} fontSize={11} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
                            <Scatter data={chartData.filter((d) => d.power != null && d.speed != null)} fill={COLORS.speed} opacity={0.55} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------- MONTÉES ---------------- */}
          {activeTab === "montees" && (
            <>
              <div className="gpx-panel">
                <SectionTitle icon={Mountain}>Profil — cliquez sur une montée</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} onClick={(e) => {
                    if (!e || e.activeLabel == null) return;
                    const d = parseFloat(e.activeLabel);
                    const c = analysis.climbs.find((cl) => d >= cl.startDistance && d <= cl.endDistance);
                    if (c) setSelectedClimb(c);
                  }}>
                    <defs>
                      <linearGradient id="gpxCliffGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.climb} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={COLORS.climb} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={COLORS.border} vertical={false} />
                    <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                    <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} />
                    <Tooltip content={<CustomTooltip hasHR={analysis.hasHR} hasCad={analysis.hasCad} hasPower={analysis.hasPower} />} />
                    <Area type="monotone" dataKey="ele" stroke={COLORS.climb} fill="url(#gpxCliffGrad)" strokeWidth={2} isAnimationActive={false} />
                    {analysis.climbs.map((c) => (
                      <ReferenceArea key={c.id} x1={c.startDistance} x2={c.endDistance} strokeOpacity={0} fill={selectedClimb && selectedClimb.id === c.id ? COLORS.climb : COLORS.climb} fillOpacity={selectedClimb && selectedClimb.id === c.id ? 0.22 : 0.08} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="gpx-climb-cards">
                {analysis.climbs.map((c) => (
                  <div key={c.id} className={"gpx-climb-card" + (selectedClimb && selectedClimb.id === c.id ? " selected" : "")} onClick={() => setSelectedClimb(selectedClimb && selectedClimb.id === c.id ? null : c)}>
                    <div className="gpx-climb-card-head">
                      <span className="gpx-climb-card-name">{c.name}</span>
                      <span className="gpx-climb-card-grade">{fmt1(c.avgGrade)}%</span>
                    </div>
                    <div className="gpx-climb-card-meta">
                      <span>{fmt1(c.lengthKm)} km</span>
                      <span>+{fmtInt(c.gain)} m</span>
                      <span>km {fmt1(c.startDistance)}</span>
                      {c.duration != null && <span>{fmtDuration(c.duration)}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="gpx-panel">
                <SectionTitle icon={Mountain} right={<span style={{ fontSize: 11, color: COLORS.textFaint, fontWeight: 500, textTransform: "none" }}>Cliquez sur une ligne pour la localiser</span>}>Tableau des montées</SectionTitle>
                <div className="gpx-table-wrap">
                  <table className="gpx-table">
                    <thead>
                      <tr>
                        {[
                          ["name", "Montée"], ["startDistance", "Km"], ["lengthKm", "Longueur"], ["gain", "D+"],
                          ["avgGrade", "Pente moy."], ["maxGrade", "Pente max"], ["duration", "Durée"],
                          ["avgSpeed", "Vitesse moy."], ["avgHR", "FC moy."], ["avgPower", "Puiss. moy."],
                        ].map(([key, label]) => (
                          (key !== "avgHR" || analysis.hasHR) && (key !== "avgPower" || analysis.hasPower) && (key !== "duration" || analysis.hasTime) && (key !== "avgSpeed" || analysis.hasTime) ? (
                            <th key={key} onClick={() => toggleSort(climbSort, setClimbSort, key)}>
                              {label} {climbSort.key === key ? (climbSort.dir === 1 ? "↑" : "↓") : ""}
                            </th>
                          ) : null
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(analysis.climbs, climbSort).map((c) => (
                        <tr key={c.id} className={"gpx-row-clickable" + (selectedClimb && selectedClimb.id === c.id ? " gpx-row-selected" : "")} onClick={() => setSelectedClimb(selectedClimb && selectedClimb.id === c.id ? null : c)}>
                          <td>{c.name}</td>
                          <td>{fmt1(c.startDistance)}</td>
                          <td>{fmt1(c.lengthKm)} km</td>
                          <td>+{fmtInt(c.gain)} m</td>
                          <td>{fmt1(c.avgGrade)}%</td>
                          <td>{fmt1(c.maxGrade)}%</td>
                          {analysis.hasTime && <td>{fmtDuration(c.duration)}</td>}
                          {analysis.hasTime && <td>{fmt1(c.avgSpeed)} km/h</td>}
                          {analysis.hasHR && <td>{fmtInt(c.avgHR)} bpm</td>}
                          {analysis.hasPower && <td>{fmtInt(c.avgPower)} W</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ---------------- GRAPHIQUES ---------------- */}
          {activeTab === "graphiques" && (
            <>
              {analysis.hasEle && (
                <div className="gpx-panel">
                  <SectionTitle icon={Mountain}>Altitude</SectionTitle>
                  <div className="gpx-chart-card-stats">
                    <span>Min <b>{fmtInt(analysis.minEle)} m</b></span>
                    <span>Max <b>{fmtInt(analysis.maxEle)} m</b></span>
                    <span>D+ <b>{fmtInt(analysis.elevGain)} m</b></span>
                    <span>D- <b>{fmtInt(analysis.elevLoss)} m</b></span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gpxEleGrad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.climb} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={COLORS.climb} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                      <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} />
                      <Tooltip content={<CustomTooltip hasHR={analysis.hasHR} hasCad={analysis.hasCad} hasPower={analysis.hasPower} />} />
                      <Area type="monotone" dataKey="ele" stroke={COLORS.climb} fill="url(#gpxEleGrad2)" strokeWidth={2} isAnimationActive={false} />
                      <Brush dataKey="distance" height={22} stroke={COLORS.climb} fill={COLORS.surface2} tickFormatter={(v) => fmt1(v)} travellerWidth={8} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {analysis.hasTime && (
                <div className="gpx-panel">
                  <SectionTitle icon={Gauge}>Vitesse</SectionTitle>
                  <div className="gpx-chart-card-stats">
                    <span>Moyenne <b>{fmt1(analysis.avgSpeedKmh)} km/h</b></span>
                    <span>Max <b>{fmt1(analysis.maxSpeedKmh)} km/h</b></span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="gpxSpeedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.speed} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={COLORS.speed} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                      <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} />
                      <Tooltip content={<CustomTooltip hasHR={analysis.hasHR} hasCad={analysis.hasCad} hasPower={analysis.hasPower} />} />
                      <Area type="monotone" dataKey="speed" stroke={COLORS.speed} fill="url(#gpxSpeedGrad)" strokeWidth={2} isAnimationActive={false} />
                      <Brush dataKey="distance" height={22} stroke={COLORS.speed} fill={COLORS.surface2} tickFormatter={(v) => fmt1(v)} travellerWidth={8} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {analysis.hasHR && analysis.hasTime && (
                <div className="gpx-panel">
                  <SectionTitle icon={Heart} right={
                    <div className="gpx-hr-config">
                      FC max
                      <input type="number" value={maxHR} onChange={(e) => setMaxHR(Math.max(100, parseInt(e.target.value) || 190))} />
                      bpm
                    </div>
                  }>Fréquence cardiaque</SectionTitle>
                  <div className="gpx-chart-card-stats">
                    <span>Moyenne <b>{fmtInt(analysis.hrStats.avg)} bpm</b></span>
                    <span>Max <b>{fmtInt(analysis.hrStats.max)} bpm</b></span>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                      <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} domain={["dataMin - 5", "dataMax + 5"]} />
                      <Tooltip content={<CustomTooltip hasHR hasCad={analysis.hasCad} hasPower={analysis.hasPower} />} />
                      <Line type="monotone" dataKey="hr" stroke={COLORS.effort} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  {hrZoneStats && (
                    <div className="gpx-zone-bar-wrap" style={{ marginTop: 16 }}>
                      {hrZoneStats.map((z, i) => {
                        const pct = analysis.movingTimeSec ? (z.time / analysis.totalTimeSec) * 100 : 0;
                        return (
                          <div className="gpx-zone-row" key={i}>
                            <div className="gpx-zone-name">{z.name}</div>
                            <div className="gpx-zone-track"><div className="gpx-zone-fill" style={{ width: `${pct}%`, background: z.color }} /></div>
                            <div className="gpx-zone-time">{fmtDuration(z.time)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {analysis.hasCad && (
                <div className="gpx-panel">
                  <SectionTitle icon={RefreshCw}>Cadence</SectionTitle>
                  <div className="gpx-chart-card-stats">
                    <span>Moyenne <b>{fmtInt(analysis.cadStats.avg)} rpm</b></span>
                    <span>Max <b>{fmtInt(analysis.cadStats.max)} rpm</b></span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                      <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} />
                      <Tooltip content={<CustomTooltip hasHR={analysis.hasHR} hasCad hasPower={analysis.hasPower} />} />
                      <Line type="monotone" dataKey="cad" stroke={COLORS.info} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {analysis.hasPower && (
                <div className="gpx-panel">
                  <SectionTitle icon={Zap} right={analysis.isEstimatedPower ? <span className="gpx-power-source-estimated">Puissance estimée</span> : <span className="gpx-power-source">Puissance mesurée</span>}>Puissance</SectionTitle>
                  <div className="gpx-chart-card-stats">
                    <span>Moyenne <b>{fmtInt(analysis.powerStats.avg)} W</b></span>
                    <span>Max <b>{fmtInt(analysis.powerStats.max)} W</b></span>
                    {analysis.powerStats.np != null && <span title="Puissance normalisée — estimation de la puissance que vous pourriez maintenir en endurance sur la sortie (moyenne de la puissance^4 à la puissance 1/4).">Puissance normalisée <b>{fmtInt(analysis.powerStats.np)} W</b></span>}
                    {analysis.powerStats.np != null && <span title="Variability Index — rapport entre la puissance normalisée et la puissance moyenne. Une valeur proche de 1 indique un effort régulier, une valeur plus élevée indique un effort variable avec des pics.">VI <b>{(analysis.powerStats.np / analysis.powerStats.avg).toFixed(2)}</b></span>}
                    {analysis.powerStats.np != null && userSettings.ftp > 0 && <span title="Intensity Factor — rapport entre la puissance normalisée et la FTP. Une valeur de 0.75 correspond à un seuil d'endurance, 1.0 au seuil FTP.">IF <b>{(analysis.powerStats.np / userSettings.ftp).toFixed(2)}</b></span>}
                    {analysis.powerStats.np != null && <span title="Normalized Power — puissance normalisée, exprimée ici de manière compacte.">NP <b>{fmtInt(analysis.powerStats.np)} W</b></span>}
                    {userSettings.ftp > 0 && <span title="Functional Threshold Power — puissance maximale soutenable sur environ une heure. Paramètre défini dans les paramètres utilisateur.">FTP <b>{fmtInt(userSettings.ftp)} W</b></span>}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke={COLORS.border} vertical={false} />
                      <XAxis dataKey="distance" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmt1(v)} stroke={COLORS.textMuted} fontSize={11} />
                      <YAxis stroke={COLORS.textMuted} fontSize={11} width={40} />
                      <Tooltip content={<CustomTooltip hasHR={analysis.hasHR} hasCad={analysis.hasCad} hasPower />} />
                      <Line type="monotone" dataKey="power" stroke={COLORS.info} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  {analysis.bestPowerEfforts && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Meilleurs efforts de puissance</div>
                      <div className="gpx-power-efforts">
                        {[
                          { key: "s5", label: "5 s" },
                          { key: "s30", label: "30 s" },
                          { key: "s60", label: "1 min" },
                          { key: "s300", label: "5 min" },
                          { key: "s600", label: "10 min" },
                          { key: "s1200", label: "20 min" },
                          { key: "s1800", label: "30 min" },
                          { key: "s3600", label: "60 min" },
                        ].map(({ key, label }) => {
                          const e = analysis.bestPowerEfforts[key];
                          if (!e) return null;
                          return (
                            <div className="gpx-effort-card" key={key}>
                              <div className="gpx-effort-card-label">{label}</div>
                              <div className="gpx-effort-card-value">{fmtInt(e.power)} W</div>
                              <div className="gpx-effort-card-sub">{userSettings.ftp > 0 ? `${fmtInt((e.power / userSettings.ftp) * 100)} % FTP` : "—"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {analysis.bestPowerEfforts && (userSettings.weight > 0) && (() => {
                    const w = userSettings.weight;
                    const avg = analysis.powerStats && analysis.powerStats.avg;
                    const max = analysis.powerStats && analysis.powerStats.max;
                    const e5 = analysis.bestPowerEfforts["s300"];
                    const e20 = analysis.bestPowerEfforts["s1200"];
                    const items = [
                      { label: "Moyenne", wkg: avg },
                      { label: "Max", wkg: max },
                      { label: "5 min", wkg: e5 ? e5.power : null },
                      { label: "20 min", wkg: e20 ? e20.power : null },
                    ];
                    return (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Puissance relative ({fmtInt(w)} kg)</div>
                        <div className="gpx-power-efforts">
                          {items.map((it, i) => (
                            <div className="gpx-effort-card" key={i}>
                              <div className="gpx-effort-card-label">{it.label}</div>
                              <div className="gpx-effort-card-value">{it.wkg != null && isFinite(it.wkg) ? `${(it.wkg / w).toFixed(2)} W/kg` : "—"}</div>
                              <div className="gpx-effort-card-sub">{it.wkg != null && isFinite(it.wkg) ? `${fmtInt(it.wkg)} W` : "Sortie trop courte"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {powerCurve && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Courbe de puissance (meilleure puissance moyenne glissante)</div>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={[
                          { label: "5 s",  dur: 5,    power: powerCurve["s5"]    ? powerCurve["s5"].power    : null },
                          { label: "10 s", dur: 10,   power: powerCurve["s10"]   ? powerCurve["s10"].power   : null },
                          { label: "30 s", dur: 30,   power: powerCurve["s30"]   ? powerCurve["s30"].power   : null },
                          { label: "1 min",dur: 60,   power: powerCurve["s60"]   ? powerCurve["s60"].power   : null },
                          { label: "5 min",dur: 300,  power: powerCurve["s300"]  ? powerCurve["s300"].power  : null },
                          { label: "10 min",dur:600,  power: powerCurve["s600"]  ? powerCurve["s600"].power  : null },
                          { label: "20 min",dur:1200, power: powerCurve["s1200"] ? powerCurve["s1200"].power : null },
                          { label: "30 min",dur:1800, power: powerCurve["s1800"] ? powerCurve["s1800"].power : null },
                          { label: "60 min",dur:3600, power: powerCurve["s3600"] ? powerCurve["s3600"].power : null },
                        ]} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                          <CartesianGrid stroke={COLORS.border} vertical={false} />
                          <XAxis dataKey="label" stroke={COLORS.textMuted} fontSize={11} interval={0} />
                          <YAxis stroke={COLORS.textMuted} fontSize={11} width={50} />
                          <Tooltip
                            contentStyle={{ background: "#0e1211", border: "1px solid " + COLORS.borderStrong, borderRadius: 10, fontSize: 12 }}
                            formatter={(v) => v == null ? "—" : [`${fmtInt(v)} W`, "Puissance"]}
                            labelFormatter={(l) => "Durée : " + l}
                          />
                          <Line type="monotone" dataKey="power" stroke={COLORS.info} strokeWidth={2} dot={{ r: 4, fill: COLORS.info }} connectNulls={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {powerZones && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Zones de puissance (FTP {fmtInt(userSettings.ftp)} W)</div>
                      <div className="gpx-zone-bar-wrap">
                        {powerZones.map((z, i) => {
                          const pct = analysis.movingTimeSec ? (z.time / analysis.totalTimeSec) * 100 : 0;
                          const wMin = z.min === 0 ? 0 : Math.round(z.min * userSettings.ftp);
                          const wMax = z.max >= 999 ? "∞" : Math.round(z.max * userSettings.ftp);
                          return (
                            <div className="gpx-power-zone-row" key={i}>
                              <div className="gpx-power-zone-name">{z.name}</div>
                              <div className="gpx-power-zone-watts">{wMin === wMax ? `${wMin} W` : `${wMin}–${wMax} W`}</div>
                              <div className="gpx-zone-track"><div className="gpx-zone-fill" style={{ width: `${pct}%`, background: z.color }} /></div>
                              <div className="gpx-power-zone-time">{fmtDuration(z.time)}</div>
                              <div className="gpx-power-zone-pct">{pct.toFixed(1)} %</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {powerAnalysis && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 8 }}>Analyse de puissance</div>
                      <ul className="gpx-highlight-list">
                        {powerAnalysis.dominant && (
                          <li>
                            Zone dominante : <b style={{ color: powerAnalysis.dominant.color }}>{powerAnalysis.dominant.name}</b>
                            {" — "}{fmtDuration(powerAnalysis.dominant.time)} ({analysis.totalTimeSec ? ((powerAnalysis.dominant.time / analysis.totalTimeSec) * 100).toFixed(1) : "0.0"} % du temps).
                          </li>
                        )}
                        {powerAnalysis.aboveSegments && userSettings.ftp > 0 && (
                          <li>
                            Au-dessus de FTP : <b>{powerAnalysis.aboveSegments.count} passage{powerAnalysis.aboveSegments.count > 1 ? "s" : ""}</b>
                            {powerAnalysis.aboveSegments.totalDur > 0 ? ` pour ${fmtDuration(powerAnalysis.aboveSegments.totalDur)} au total` : ""}
                            {powerAnalysis.aboveSegments.longest ? ` — plus long : ${fmtDuration(powerAnalysis.aboveSegments.longest.dur)} à ${fmtInt(powerAnalysis.aboveSegments.longest.avgW)} W` : ""}.
                          </li>
                        )}
                        {powerAnalysis.variability && (
                          <li>
                            Régularité : CV <b>{(powerAnalysis.variability.cv * 100).toFixed(0)} %</b>
                            {" "}(écart-type {fmtInt(powerAnalysis.variability.sd)} W, moyenne {fmtInt(powerAnalysis.variability.mean)} W sur les périodes en mouvement).
                          </li>
                        )}
                        {powerAnalysis.bestPeriods && powerAnalysis.bestPeriods.length > 0 && (
                          <li>
                            Meilleures périodes (puissance ≥ 75 % FTP, ≥ 20 s) :
                            <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                              {powerAnalysis.bestPeriods.map((p, i) => (
                                <li key={i}>
                                  {fmtDuration(p.dur)} à <b>{fmtInt(p.avgW)} W</b> ({userSettings.ftp > 0 ? Math.round((p.avgW / userSettings.ftp) * 100) : 0} % FTP)
                                  {analysis.startTime ? `, à ${fmtClock(new Date(analysis.startTime.getTime() + p.startElapsed * 1000))}` : ""}
                                </li>
                              ))}
                            </ol>
                          </li>
                        )}
                        {!powerAnalysis.dominant && !powerAnalysis.aboveSegments && !powerAnalysis.variability && !powerAnalysis.bestPeriods && (
                          <li>Renseignez votre FTP dans les paramètres utilisateur pour une analyse complète.</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!analysis.hasEle && !analysis.hasTime && (
                <div className="gpx-panel"><div className="gpx-empty-note">Ce GPX ne contient ni altitude ni horodatage exploitable : peu de graphiques disponibles.</div></div>
              )}
            </>
          )}

          {activeTab === "splits" && (
            <div className="gpx-panel">
              <SectionTitle icon={Clock}>Splits</SectionTitle>
              <div className="gpx-splits-container">
                {analysis.splits.length > 0 ? (
                  <table className="gpx-table">
                    <thead>
                      <tr>
                        {[
                          ["km", "Km"],
                          ["time", "Temps"],
                          ["avgSpeed", "Vitesse moy."],
                          ["avgEle", "Altitude moy."],
                          ["gain", "D+"],
                          ["avgHR", "FC moy."],
                          ["avgCad", "Cadence moy."],
                          ["avgPower", "Puissance moy."],
                        ].map(([key, label]) => (
                          (key !== "avgHR" || analysis.hasHR) &&
                          (key !== "avgCad" || analysis.hasCad) &&
                          (key !== "avgPower" || analysis.hasPower) &&
                          (key !== "time" || analysis.hasTime) ? (
                            <th key={key} onClick={() => toggleSort(splitSort, setSplitSort, key)}>
                              {label} {splitSort.key === key ? (splitSort.dir === 1 ? "↑" : "↓") : ""}
                            </th>
                          ) : null
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(analysis.splits, splitSort).map((s, i) => (
                        <tr key={i} className="gpx-row-clickable">
                          <td>{fmt1(s.km)}</td>
                          {analysis.hasTime && <td>{fmtDuration(s.time)}</td>}
                          <td>{fmt1(s.avgSpeed)} km/h</td>
                          <td>{fmtInt(s.avgEle)} m</td>
                          <td>+{fmtInt(s.gain)} m</td>
                          {analysis.hasHR && <td>{fmtInt(s.avgHR)} bpm</td>}
                          {analysis.hasCad && <td>{fmtInt(s.avgCad)} rpm</td>}
                          {analysis.hasPower && <td>{fmtInt(s.avgPower)} W</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="gpx-empty-note">Pas de splits disponibles.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "parametres" && (
            <div className="gpx-panel">
              <SectionTitle icon={Settings2}>Paramètres utilisateur</SectionTitle>
              <div className="gpx-params-grid">
                <label className="gpx-param-row">
                  <span className="gpx-param-label">Poids cycliste</span>
                  <span className="gpx-param-control">
                    <input
                      type="number"
                      min="30"
                      max="200"
                      step="0.5"
                      value={userSettings.weight}
                      onChange={(e) => setUserSettings((s) => ({ ...s, weight: parseFloat(e.target.value) || 0 }))}
                    />
                    <span className="gpx-param-unit">kg</span>
                  </span>
                </label>
                <label className="gpx-param-row">
                  <span className="gpx-param-label">Poids vélo</span>
                  <span className="gpx-param-control">
                    <input
                      type="number"
                      min="3"
                      max="30"
                      step="0.1"
                      value={userSettings.bikeWeight}
                      onChange={(e) => setUserSettings((s) => ({ ...s, bikeWeight: parseFloat(e.target.value) || 0 }))}
                    />
                    <span className="gpx-param-unit">kg</span>
                  </span>
                </label>
                <label className="gpx-param-row">
                  <span className="gpx-param-label">FTP</span>
                  <span className="gpx-param-control">
                    <input
                      type="number"
                      min="50"
                      max="600"
                      step="5"
                      value={userSettings.ftp}
                      onChange={(e) => setUserSettings((s) => ({ ...s, ftp: parseFloat(e.target.value) || 0 }))}
                    />
                    <span className="gpx-param-unit">W</span>
                  </span>
                </label>
              </div>
              <div className="gpx-params-actions">
                <button
                  className="gpx-btn-ghost"
                  onClick={() => setUserSettings((s) => ({ ...s, weight: 75, bikeWeight: 8, ftp: 250 }))}
                >
                  <RefreshCw size={14} /> Réinitialiser
                </button>
                <span className="gpx-params-hint">Valeurs sauvegardées automatiquement dans le navigateur.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}