import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Upload, MapPin, TrendingUp, Activity, Heart, Zap, Mountain, Clock, Gauge,
  RefreshCw, ChevronUp, ChevronDown, X, Download, Info, Flame, Timer,
  Route, Thermometer, PauseCircle, Settings2, ArrowUpRight, Wind, Compass,
  FileWarning, Sparkles, History as HistoryIcon, UserRound,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, Brush, ScatterChart, Scatter, ZAxis,
  BarChart, Bar, Cell,
} from "recharts";

// Modules extraits
import { parseGPXString } from "./lib/parsers/gpxParser.js";
import { parseFITArrayBuffer } from "./lib/parsers/fitParser.js";
import { parseActivityFileAuto, getAcceptString } from "./lib/parsers/index.js";
import { computeAnalysis, computeHRZones } from "./lib/analysis.js";
import { computePowerZones, computeBestPowerEfforts } from "./lib/power.js";
import { computeActivityAnalytics } from "./lib/analytics/analytics.js";
import {
  avg,
  decimate,
  fmt1,
  fmtInt,
  fmtDuration,
  fmtDurationLong,
  fmtClock,
  fmtDateFull,
} from "./lib/utils.js";
import { COLORS, MAP_TILE_FILTER } from "./lib/colors.js";
import { generateSummary, generateHighlights } from "./lib/narrative.js";
import { generateDemoPoints } from "./lib/demoData.js";
import { StatCard, SectionTitle, CustomTooltip } from "./components/UIPrimitives.jsx";
import { AnalyticsView } from "./components/AnalyticsView.jsx";
import { MapView } from "./components/MapView.jsx";
import { MapLibrePrototype } from "./components/MapLibrePrototype.jsx"; // POC expérimental, voir onglet Carte
import { ProfileChart } from "./components/ProfileChart.jsx";
import { StorageSettings } from "./components/StorageSettings.jsx";
import { HistoryDashboard } from "./components/HistoryDashboard.jsx";
import { ProfileView } from "./components/ProfileView.jsx";

// Stockage local durable (Phase 2)
import { toActivity } from "./lib/normalize.js";
import {
  isFileSystemAccessSupported,
  pickDataDirectory,
  getStoredDirectoryHandle,
  verifyPermission,
  forgetDataDirectory,
} from "./lib/storage/directoryAccess.js";
import {
  saveActivity,
  loadActivityDetail,
  loadActivitySourceText,
  loadActivitySourceArrayBuffer,
} from "./lib/storage/activityStore.js";

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
  const [mode, setMode] = useState("landing"); // landing | dashboard | historique | profil
  const [isDemo, setIsDemo] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [rideName, setRideName] = useState(null);
  const [points, setPoints] = useState(null);
  const [activeActivityId, setActiveActivityId] = useState(null); // id de la sortie ouverte depuis l'historique, si applicable

  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // Stockage local durable (Phase 2) : status = "checking" | "unsupported" | "disconnected" | "needs-permission" | "connected"
  const [storage, setStorage] = useState({ status: "checking", rootHandle: null, dirName: null });
  const [saveStatus, setSaveStatus] = useState(null); // { ok: boolean, message: string } | null

  const [activeTab, setActiveTab] = useState("resume");
  const [mapColorMode, setMapColorMode] = useState("speed");
  const [mapEngine, setMapEngine] = useState("leaflet"); // "leaflet" | "maplibre" — POC de comparaison, voir onglet Carte
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

  // Reconnexion silencieuse au dossier de stockage local mémorisé (si permission déjà accordée).
  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setStorage({ status: "unsupported", rootHandle: null, dirName: null });
      return;
    }
    let cancelled = false;
    getStoredDirectoryHandle().then(async (handle) => {
      if (cancelled) return;
      if (!handle) {
        setStorage({ status: "disconnected", rootHandle: null, dirName: null });
        return;
      }
      const granted = await verifyPermission(handle, { request: false });
      if (cancelled) return;
      setStorage({ status: granted ? "connected" : "needs-permission", rootHandle: handle, dirName: handle.name });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function connectStorage() {
    try {
      const handle = await pickDataDirectory();
      setStorage({ status: "connected", rootHandle: handle, dirName: handle.name });
    } catch (err) {
      if (err && err.name === "AbortError") return; // l'utilisateur a annulé le sélecteur
      setError("Impossible de connecter le dossier de stockage : " + (err.message || err));
    }
  }

  async function reconnectStorage() {
    if (!storage.rootHandle) return connectStorage();
    const granted = await verifyPermission(storage.rootHandle, { request: true });
    setStorage((s) => ({ ...s, status: granted ? "connected" : "needs-permission" }));
  }

  async function disconnectStorage() {
    await forgetDataDirectory();
    setStorage({ status: "disconnected", rootHandle: null, dirName: null });
  }

  const analysis = useMemo(() => (points ? computeAnalysis(points, userSettings) : null), [points, userSettings]);
  // Moteur d'analyse avancée (Phase 4A) — indépendant de l'UI, calculé ici pour
  // être disponible dans le flux de l'app ; pas encore branché sur le rendu
  // (l'interface actuelle continue de lire `analysis` directement).
  const activityAnalytics = useMemo(
    () => (analysis ? computeActivityAnalytics(analysis, { ftp: userSettings.ftp, maxHR, hrZoneBounds: hrZones }) : null),
    [analysis, userSettings.ftp, maxHR, hrZones]
  );
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

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setSaveStatus(null);

    let format, name, points, measured, sourceText, sourceArrayBuffer;
    try {
      ({ format, name, points, measured, sourceText, sourceArrayBuffer } = await parseActivityFileAuto(file));
    } catch (err) {
      setError(err.message || "Impossible de lire ce fichier.");
      return;
    }

    setPoints(points);
    setRideName(name);
    setFileName(file.name);
    setIsDemo(false);
    setActiveActivityId(null);
    setMode("dashboard");
    setActiveTab("resume");
    setSelectedClimb(null);

    // Sauvegarde automatique et durable (fichier original + version normalisée),
    // uniquement si un dossier de stockage local est connecté.
    if (storage.status === "connected" && storage.rootHandle) {
      try {
        const freshAnalysis = computeAnalysis(points, userSettings);
        const activity = toActivity(freshAnalysis, points, { name, sourceType: format, originalFilename: file.name, measured });
        const sourceContent = format === "fit" ? sourceArrayBuffer : sourceText;
        const saved = await saveActivity(storage.rootHandle, activity, sourceContent, format);
        setActiveActivityId(saved.id);
        setSaveStatus({ ok: true, message: "Sortie enregistrée dans l'historique." });
      } catch (err) {
        setSaveStatus({ ok: false, message: "Sortie analysée mais non enregistrée : " + (err.message || err) });
      }
    } else if (storage.status === "needs-permission") {
      setSaveStatus({ ok: false, message: "Sortie analysée mais non enregistrée : reconnecte le dossier de stockage dans Paramètres." });
    }
  }, [storage, userSettings]);

  async function openActivityFromHistory(id) {
    if (!storage.rootHandle) return;
    setError(null);
    setSaveStatus(null);
    try {
      const detail = await loadActivityDetail(storage.rootHandle, id);
      let name, points;
      if (detail.source.type === "fit") {
        const arrayBuffer = await loadActivitySourceArrayBuffer(storage.rootHandle, id);
        ({ name, points } = await parseFITArrayBuffer(arrayBuffer));
      } else {
        const sourceText = await loadActivitySourceText(storage.rootHandle, id);
        ({ name, points } = parseGPXString(sourceText));
      }
      setPoints(points);
      setRideName(detail.name || name);
      setFileName(detail.source.originalFilename || detail.source.storedFilename);
      setIsDemo(false);
      setActiveActivityId(id);
      setMode("dashboard");
      setActiveTab("resume");
      setSelectedClimb(null);
    } catch (err) {
      setError(err.message || "Impossible de rouvrir cette sortie depuis l'historique.");
      setMode("landing");
    }
  }

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
    setActiveActivityId(null);
    setSaveStatus(null);
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
    { key: "analytique", label: "Analytique" },
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
        .gpx-save-banner {
          display: flex; align-items: center; gap: 8px;
          background: rgba(77,217,192,0.12); border: 1px solid rgba(77,217,192,0.35);
          color: var(--speed); font-size: 12.5px; font-weight: 600;
          padding: 9px 14px; border-radius: 12px; margin-bottom: 14px;
        }
        .gpx-save-banner-error {
          background: rgba(232,84,58,0.1); border-color: rgba(232,84,58,0.3); color: #ffb3a5;
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
        .gpx-map-engine-toggle { display: inline-flex; gap: 4px; }
        .gpx-leaflet-container {
          position: relative; border-radius: 16px; overflow: hidden; background: var(--bgAlt);
          border: 1px solid var(--border);
        }
        .gpx-leaflet-container .leaflet-container { background: var(--bgAlt); font-family: inherit; }
        .gpx-leaflet-container .leaflet-tile-pane { filter: ${MAP_TILE_FILTER}; }
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

        /* ---------- Stockage local & historique ---------- */
        .gpx-storage-box {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 13px; color: var(--muted);
          background: var(--surface2); border: 1px solid var(--border); border-radius: 12px;
          padding: 12px 14px;
        }
        .gpx-storage-box svg { flex-shrink: 0; color: var(--info); }
        .gpx-storage-box.gpx-storage-ok svg { color: var(--speed); }
        .gpx-storage-box.gpx-storage-warn { border-color: rgba(244,183,64,0.35); background: rgba(244,183,64,0.08); }
        .gpx-storage-box.gpx-storage-warn svg { color: var(--climb); }
        .gpx-storage-box .gpx-btn-ghost, .gpx-storage-box .gpx-link-btn { margin-left: auto; }

        .gpx-history-toolbar { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
        .gpx-history-search {
          display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px;
          background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px;
          color: var(--faint);
        }
        .gpx-history-search input { background: none; border: none; color: var(--text); font-size: 13px; width: 100%; outline: none; }
        .gpx-history-daterange { display: flex; align-items: center; gap: 8px; color: var(--faint); font-size: 12px; }
        .gpx-history-daterange input {
          background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
          padding: 6px 8px; color: var(--text); font-size: 12.5px;
        }
        .gpx-history-selection-bar {
          display: flex; align-items: center; gap: 14px; margin-top: 16px; padding: 10px 14px;
          background: rgba(244,183,64,0.08); border: 1px solid rgba(244,183,64,0.3); border-radius: 10px;
          font-size: 13px; color: var(--text); flex-wrap: wrap;
        }

        /* ---------- Profil cycliste ---------- */
        .gpx-profile-banner {
          display: flex; align-items: center; gap: 8px;
          background: rgba(111,156,242,0.12); border: 1px solid rgba(111,156,242,0.3);
          color: var(--info); font-size: 12.5px; font-weight: 600;
          padding: 9px 14px; border-radius: 12px; margin-bottom: 14px;
        }
        .gpx-profile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
        .gpx-profile-card {
          background: var(--surface2); border: 1px solid var(--border); border-radius: 16px; padding: 16px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .gpx-profile-card-head {
          display: flex; align-items: center; gap: 7px; color: var(--muted);
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        }
        .gpx-profile-card-value { font-size: 32px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; margin-top: 2px; }
        .gpx-profile-card-value-empty { color: var(--faint); }
        .gpx-profile-card-value-scale { font-size: 13px; font-weight: 600; color: var(--faint); margin-left: 2px; }
        .gpx-profile-card-bar { height: 8px; border-radius: 6px; background: var(--bg); overflow: hidden; margin-top: 2px; }
        .gpx-profile-card-bar-fill { height: 100%; border-radius: 6px; background: var(--speed); }
        .gpx-profile-card-status { font-size: 12.5px; color: var(--muted); font-weight: 600; }
        .gpx-profile-card-hint { font-size: 11px; color: var(--faint); font-style: italic; }
        .gpx-profile-card-confidence { font-size: 12px; color: var(--muted); }
        .gpx-profile-card-confidence b.gpx-confidence-low { color: var(--climb); }
        .gpx-profile-card-confidence b.gpx-confidence-medium { color: var(--info); }
        .gpx-profile-card-confidence b.gpx-confidence-high { color: var(--speed); }
        .gpx-profile-card-meta { font-size: 11.5px; color: var(--faint); }
        .gpx-profile-evidence-toggle { margin-top: 2px; text-align: left; }
        .gpx-profile-evidence-list { list-style: none; padding: 0; margin: 8px 0 0 0; display: flex; flex-direction: column; gap: 6px; }
        .gpx-profile-evidence-list li { font-size: 12px; color: var(--muted); padding-left: 14px; position: relative; line-height: 1.5; }
        .gpx-profile-evidence-list li::before { content: "•"; position: absolute; left: 0; color: var(--faint); }
        .gpx-profile-evidence-list li.gpx-row-clickable:hover { color: var(--text); cursor: pointer; }
        .gpx-profile-dataquality-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
        .gpx-profile-dataquality-row {
          display: flex; justify-content: space-between; align-items: center; font-size: 13px;
          background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px;
        }
        .gpx-profile-dq-ok { color: var(--speed); font-weight: 700; }
        .gpx-profile-dq-missing { color: var(--faint); }
        .gpx-profile-dq-note { color: var(--climb); font-weight: 600; }
        .gpx-profile-dimension-select {
          background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
          color: var(--text); font-size: 12.5px; padding: 6px 10px;
        }
        .gpx-profile-about { font-size: 13px; color: var(--muted); line-height: 1.7; }

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
            <h1 className="gpx-landing-title">Importez votre sortie<br /><span>GPX ou FIT</span></h1>
            <p className="gpx-landing-sub">
              Glissez un fichier GPX ou FIT pour obtenir un tableau de bord complet — carte, montées, splits, effort —
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
              <div className="gpx-upload-title">Glissez-déposez votre fichier .gpx ou .fit ici</div>
              <div className="gpx-upload-sub">ou cliquez pour parcourir vos fichiers</div>
              <button className="gpx-btn-primary" onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}>
                <Upload size={15} /> Importer une sortie
              </button>
              <input ref={fileInputRef} type="file" accept={getAcceptString()} style={{ display: "none" }} onChange={handleInputChange} />
            </div>
            {error && (
              <div className="gpx-error-box"><FileWarning size={15} /> {error}</div>
            )}
            <div className="gpx-landing-demo">
              <button className="gpx-link-btn" onClick={loadDemo}>Voir un exemple avec des données de démonstration (fictives)</button>
              {" · "}
              <button className="gpx-link-btn" onClick={() => setMode("historique")}>Voir mon historique</button>
              {" · "}
              <button className="gpx-link-btn" onClick={() => setMode("profil")}>Voir mon profil</button>
            </div>
            <div className="gpx-panel" style={{ marginTop: 24, textAlign: "left" }}>
              <StorageSettings storage={storage} onConnect={connectStorage} onReconnect={reconnectStorage} compact />
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
              <button className="gpx-icon-btn" title="Historique des sorties" onClick={() => setMode("historique")}><HistoryIcon size={15} /></button>
              <button className="gpx-icon-btn" title="Mon profil cycliste" onClick={() => setMode("profil")}><UserRound size={15} /></button>
              <button className="gpx-icon-btn" title="Exporter (PDF)" onClick={exportPDF}><Download size={15} /></button>
              <button className="gpx-btn-ghost" onClick={resetAll}><RefreshCw size={14} /> Nouvelle sortie</button>
            </div>
          </div>

          {saveStatus && (
            <div className={"gpx-save-banner" + (saveStatus.ok ? "" : " gpx-save-banner-error")}>
              <Info size={14} /> {saveStatus.message}
            </div>
          )}

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

          {/* ---------------- ANALYTIQUE ---------------- */}
          {activeTab === "analytique" && (
            <AnalyticsView
              analytics={activityAnalytics}
              analysis={analysis}
              chartData={chartData}
              hoverIdx={hoverIdx}
              setHoverIdx={setHoverIdx}
              profileMetric={profileMetric}
              setProfileMetric={setProfileMetric}
              selectedClimb={selectedClimb}
              setSelectedClimb={setSelectedClimb}
            />
          )}

          {/* ---------------- CARTE ---------------- */}
          {activeTab === "carte" && (
            <div className="gpx-panel">
              <SectionTitle
                icon={MapPin}
                right={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 500, textTransform: "none" }}>
                    {mapEngine === "leaflet" && <span style={{ fontSize: 11, color: COLORS.textFaint }}>Survolez le profil ou le tracé — les deux restent synchronisés</span>}
                    <span className="gpx-map-engine-toggle" title="Test expérimental : compare le rendu Leaflet (production) et MapLibre (prototype). N'affecte aucune autre fonctionnalité.">
                      <button className={"gpx-chip" + (mapEngine === "leaflet" ? " gpx-chip-active" : "")} onClick={() => setMapEngine("leaflet")}>Leaflet</button>
                      <button className={"gpx-chip" + (mapEngine === "maplibre" ? " gpx-chip-active" : "")} onClick={() => setMapEngine("maplibre")}>MapLibre (test)</button>
                    </span>
                  </span>
                }
              >
                Carte & profil synchronisés
              </SectionTitle>
              {mapEngine === "maplibre" ? (
                <MapLibrePrototype analysis={analysis} height={480} />
              ) : (
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
              )}
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
            <>
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

            <div className="gpx-panel">
              <SectionTitle icon={HistoryIcon}>Stockage local & historique</SectionTitle>
              <StorageSettings storage={storage} onConnect={connectStorage} onReconnect={reconnectStorage} onDisconnect={disconnectStorage} />
              {storage.status === "connected" && (
                <p className="gpx-params-hint" style={{ marginTop: 10 }}>
                  Le fichier GPX original et une version JSON normalisée sont conservés dans « {storage.dirName} / activities ».
                </p>
              )}
            </div>
            </>
          )}
        </div>
      )}

      {mode === "historique" && (
        <HistoryDashboard
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onBack={() => setMode(points ? "dashboard" : "landing")}
          ftp={userSettings.ftp}
          maxHR={maxHR}
        />
      )}

      {mode === "profil" && (
        <ProfileView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onBack={() => setMode(points ? "dashboard" : "landing")}
        />
      )}
    </div>
  );
}