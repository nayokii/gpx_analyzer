import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Upload, MapPin, TrendingUp, Activity, Heart, Zap, Mountain, Clock, Gauge,
  RefreshCw, ChevronUp, ChevronDown, X, Download, Info, Flame, Timer,
  Route, Thermometer, PauseCircle, Settings2, ArrowUpRight, Wind, Compass,
  FileWarning, Sparkles, History as HistoryIcon, ChevronRight,
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
import { COLORS, CHART_TOOLTIP_STYLE } from "./lib/colors.js";
import { generateSummary, generateHighlights } from "./lib/narrative.js";
import { generateDemoPoints } from "./lib/demoData.js";
import { StatCard, SectionTitle, CustomTooltip, MetricGroup, SortControl } from "./components/UIPrimitives.jsx";
import { AnimatedValue } from "./components/AnimatedValue.jsx";
import { ElevationSilhouette } from "./components/ElevationSilhouette.jsx";
import { ActiveIndicator, useActiveIndicator } from "./components/ActiveIndicator.jsx";
import { AnalyticsView } from "./components/AnalyticsView.jsx";
import { MapView } from "./components/MapView.jsx";
import { MapLibrePrototype } from "./components/MapLibrePrototype.jsx"; // POC expérimental, voir onglet Carte
import { ProfileChart } from "./components/ProfileChart.jsx";
import { StorageSettings } from "./components/StorageSettings.jsx";
import { HistoryDashboard } from "./components/HistoryDashboard.jsx";
import { ProfileView } from "./components/ProfileView.jsx";
import { AlterEgoView } from "./components/AlterEgoView.jsx";
import { ArchetypeView } from "./components/ArchetypeView.jsx";
import { TourView } from "./components/TourView.jsx";
import { CoachView } from "./components/CoachView.jsx";
import { AppNav } from "./components/AppNav.jsx";
import { ActivityFeedView } from "./components/ActivityFeedView.jsx";
import { HomeView } from "./components/HomeView.jsx";
import { DataSourcesView } from "./components/DataSourcesView.jsx";
import { PasswordRecoveryView } from "./components/PasswordRecoveryView.jsx";
import {
  parseRecoveryHash, beginPasswordRecovery, onPasswordRecovery, clearAuthHash, CloudNotConfiguredError,
} from "./lib/cloud/index.js";
import { useActivityRepository } from "./components/useActivityRepository.js";

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
  listActivities,
} from "./lib/storage/activityStore.js";

// Import Strava (Phase 9C) — voir src/lib/strava/ pour le détail ; ce
// fichier n'utilise que l'API publique exposée par son index.js.
import {
  parseAuthCallback,
  exchangeCodeForTokens,
  assertHasActivityReadScope,
  saveStravaState,
  createEmptyStravaState,
  syncStrava,
  StravaAuthDeniedError,
  StravaInvalidCallbackError,
} from "./lib/strava/index.js";

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

/** Colonnes triables du tableau des montées (mêmes conditions de disponibilité que les en-têtes). */
function climbSortColumns(analysis) {
  return [
    ["name", "Montée"], ["startDistance", "Km"], ["lengthKm", "Longueur"], ["gain", "D+"],
    ["avgGrade", "Pente moy."], ["maxGrade", "Pente max"], ["duration", "Durée"],
    ["avgSpeed", "Vitesse moy."], ["avgHR", "FC moy."], ["avgPower", "Puiss. moy."],
  ].filter(([key]) =>
    (key !== "avgHR" || analysis.hasHR) && (key !== "avgPower" || analysis.hasPower) &&
    (key !== "duration" || analysis.hasTime) && (key !== "avgSpeed" || analysis.hasTime)
  );
}

/** Colonnes triables du tableau des splits. */
function splitSortColumns(analysis) {
  return [
    ["km", "Km"], ["time", "Temps"], ["avgSpeed", "Vitesse moy."], ["avgEle", "Altitude moy."], ["gain", "D+"],
    ["avgHR", "FC moy."], ["avgCad", "Cadence moy."], ["avgPower", "Puissance moy."],
  ].filter(([key]) =>
    (key !== "avgHR" || analysis.hasHR) && (key !== "avgCad" || analysis.hasCad) &&
    (key !== "avgPower" || analysis.hasPower) && (key !== "time" || analysis.hasTime)
  );
}

export default function GPXAnalyzer() {
  // Lien de récupération de mot de passe (e-mail Supabase) : l'URL d'arrivée porte les jetons dans son fragment.
  // On l'analyse AVANT le premier rendu pour ouvrir directement l'écran « Nouveau mot de passe » (pas de flash d'accueil).
  const [initialRecovery] = useState(() => (typeof window !== "undefined" ? parseRecoveryHash(window.location.hash) : { status: "none" }));
  const [mode, setMode] = useState(initialRecovery.status === "none" ? "home" : "recovery"); // home | dashboard | historique | profil | alterego | archetype | tour | sources | recovery
  const [recovery, setRecovery] = useState(() => {
    if (initialRecovery.status === "error") return { phase: "error", message: initialRecovery.message };
    if (initialRecovery.status === "recovery") return { phase: "checking" };
    return null;
  });
  const recoveryStartedRef = useRef(false);
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

  // Repository unifié local+cloud (Phase 11B) — voir
  // ./components/useActivityRepository.js et ./lib/storage/activityRepository.js.
  // Utilisé ici pour l'import (loadFile) et la réouverture d'une sortie
  // depuis l'historique (openActivityFromHistory), qui doivent tous deux
  // fonctionner qu'une sortie soit locale ou cloud-only.
  const { repository, cloudUser } = useActivityRepository(storage, userSettings);

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

  // Traitement du retour de callback OAuth Strava (voir src/lib/strava/auth.js
  // et docs/STRAVA_INTEGRATION.md) : à l'ouverture de l'app, si l'URL contient
  // `code`/`state`/`error` (redirection depuis Strava), on finalise la
  // connexion. Ne se déclenche qu'une fois par retour de callback (ref) et
  // seulement quand l'état du stockage local est stabilisé (les jetons sont
  // persistés dans le dossier choisi — voir strava/storage.js — donc rien à
  // faire tant qu'on ne sait pas s'il est connecté).
  const [stravaCallbackError, setStravaCallbackError] = useState(null);

  // Récupération de mot de passe : établit la session du lien (une seule fois, même en StrictMode), nettoie
  // l'URL, et écoute aussi l'événement PASSWORD_RECOVERY du SDK.
  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = onPasswordRecovery((user) => {
        setRecovery((r) => (r && r.phase === "ready" ? r : { phase: "ready", email: user ? user.email : null }));
        setMode("recovery");
      });
    } catch {
      // cloud non configuré : aucun événement à écouter
    }
    if (initialRecovery.status !== "none" && !recoveryStartedRef.current) {
      recoveryStartedRef.current = true;
      const hash = window.location.hash;
      (async () => {
        try {
          const result = await beginPasswordRecovery(hash);
          if (result.status === "ready") setRecovery({ phase: "ready", email: result.email });
          else setRecovery({ phase: "error", message: result.message || "Ce lien n'est pas valide." });
        } catch (err) {
          setRecovery({
            phase: "error",
            message: err instanceof CloudNotConfiguredError ? "Le cloud n'est pas configuré : impossible de modifier le mot de passe ici." : (err.message || "Ce lien n'est pas valide."),
          });
        } finally {
          clearAuthHash();
        }
      })();
    }
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [stravaRefreshTick, setStravaRefreshTick] = useState(0);
  const stravaCallbackHandled = useRef(false);
  useEffect(() => {
    if (stravaCallbackHandled.current) return;
    if (storage.status === "checking") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) return;
    stravaCallbackHandled.current = true;

    const expectedState = sessionStorage.getItem("gpx-strava-oauth-state");
    sessionStorage.removeItem("gpx-strava-oauth-state");
    // Nettoie l'URL immédiatement (avant même la résolution de l'échange) pour
    // qu'un rechargement de page ne retraite jamais le même code.
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      setMode("sources");
      try {
        const { code, grantedScope } = parseAuthCallback(params, expectedState);
        assertHasActivityReadScope(grantedScope);

        if (storage.status !== "connected" || !storage.rootHandle) {
          throw new Error("Connecte d'abord un dossier de stockage local, puis reconnecte Strava (la connexion n'a pas pu être finalisée).");
        }

        const tokens = await exchangeCodeForTokens({ code });
        const initialState = {
          ...createEmptyStravaState(),
          connected: true,
          tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scope: tokens.scope },
          athlete: tokens.athlete,
          connectedAt: new Date().toISOString(),
        };
        await saveStravaState(storage.rootHandle, initialState);

        // Première importation automatique (voir consigne : Connect→OAuth→import→normalise→dédoublonne→stocke).
        const existingSummaries = await listActivities(storage.rootHandle);
        await syncStrava({ rootHandle: storage.rootHandle, state: initialState, existingSummaries, userSettings });
        setStravaRefreshTick((t) => t + 1);
      } catch (err) {
        const message =
          err instanceof StravaAuthDeniedError ? "Autorisation Strava refusée."
          : err instanceof StravaInvalidCallbackError ? "Réponse Strava invalide ou expirée — reconnecte Strava."
          : err.message || "Échec de la connexion Strava.";
        setStravaCallbackError(message);
      }
    })();
  }, [storage.status, storage.rootHandle]);

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
    // uniquement si un dossier de stockage local est connecté. Le repository
    // (voir lib/storage/activityRepository.js) se charge en plus, si un
    // compte cloud est connecté, d'envoyer la sortie dans le cloud — jamais
    // au prix de la sauvegarde locale, qui reste la première garantie (voir
    // consigne Phase 11B §19 : "NE PAS perdre la sortie locale").
    //
    // La sauvegarde locale est attendue (rapide, disque), mais l'upload cloud
    // NE L'EST PAS (voir consigne Phase 11C §10 : "l'import ne doit pas être
    // rendu inutilement lent par le réseau") — `cloudSyncPromise` se résout en
    // arrière-plan, et met à jour le message affiché une fois le résultat connu.
    if (storage.status === "connected" && storage.rootHandle) {
      try {
        const freshAnalysis = computeAnalysis(points, userSettings);
        const activity = toActivity(freshAnalysis, points, { name, sourceType: format, originalFilename: file.name, measured });
        const sourceContent = format === "fit" ? sourceArrayBuffer : sourceText;
        const { activity: saved, cloudSyncPromise } = await repository.saveActivity(activity, sourceContent, format);
        setActiveActivityId(saved.id);
        if (!cloudUser) {
          setSaveStatus({ ok: true, message: "Sortie enregistrée dans l'historique." });
        } else {
          setSaveStatus({ ok: true, message: "Sortie importée. ☁ Synchronisation…" });
          cloudSyncPromise.then(({ cloudSynced, cloudError }) => {
            setSaveStatus({
              ok: true,
              message: cloudSynced
                ? "✓ Sortie synchronisée."
                : "Sortie enregistrée localement. ◌ Synchronisation en attente" + (cloudError ? ` (${cloudError})` : "") + ".",
            });
          });
        }
      } catch (err) {
        setSaveStatus({ ok: false, message: "Sortie analysée mais non enregistrée : " + (err.message || err) });
      }
    } else if (storage.status === "needs-permission") {
      setSaveStatus({ ok: false, message: "Sortie analysée mais non enregistrée : reconnecte le dossier de stockage dans Paramètres." });
    }
  }, [storage, userSettings, repository, cloudUser]);

  // Reconstruit les points exploitables par le dashboard directement depuis
  // les `samples` déjà normalisés d'une Activity — voir plus bas : c'est
  // exactement ce que fait déjà la branche "strava" ci-dessous (pas de
  // fichier source à reparser), généralisé ici au cas cloud-only (Phase
  // 11B) : une fois matérialisée par le repository, une activité cloud n'a
  // pas non plus besoin d'être reparsée une seconde fois.
  function pointsFromSamples(detail) {
    return detail.samples.map((s) => ({
      lat: s.latitude,
      lon: s.longitude,
      ele: s.altitude,
      time: s.timestamp ? new Date(s.timestamp) : null,
      hr: s.heartRate,
      cad: s.cadence,
      // Puissance estimée par NOTRE moteur : jamais réinjectée comme donnée
      // d'entrée, sous peine d'être prise pour une mesure réelle au recalcul
      // — voir analysis.js: hasPower.
      power: detail.flags.powerEstimated ? null : s.power,
      temp: s.temperature,
      distanceMeasured: s.distanceMeasured,
      speedMeasured: s.speedMeasured,
    }));
  }

  async function openActivityFromHistory(id) {
    setError(null);
    setSaveStatus(null);
    try {
      // D'abord le stockage local (comportement inchangé, voir consigne §4) :
      // reparse le fichier ORIGINAL, pas les samples déjà normalisés, pour
      // rester fidèle au comportement d'avant cette phase.
      let detail = null;
      if (storage.rootHandle) {
        try {
          detail = await loadActivityDetail(storage.rootHandle, id);
        } catch {
          detail = null; // absente localement : peut-être une sortie cloud-only, voir ci-dessous
        }
      }

      let name, points;
      if (detail && detail.source.type === "fit") {
        const arrayBuffer = await loadActivitySourceArrayBuffer(storage.rootHandle, id);
        ({ name, points } = await parseFITArrayBuffer(arrayBuffer));
      } else if (detail && detail.source.type === "strava") {
        // Pas de fichier source à reparser (voir src/lib/strava/adapter.js).
        name = detail.name;
        points = pointsFromSamples(detail);
      } else if (detail) {
        const sourceText = await loadActivitySourceText(storage.rootHandle, id);
        ({ name, points } = parseGPXString(sourceText));
      } else {
        // Absente du stockage local (ou aucun dossier connecté) : le
        // repository la matérialise depuis le cloud (voir consigne §13,
        // ../lib/storage/activityRepository.js) — déjà une Activity complète
        // avec samples, jamais besoin de reparser quoi que ce soit ici.
        detail = await repository.loadActivityDetail(id);
        name = detail.name;
        points = pointsFromSamples(detail);
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
      setMode("home");
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
    setMode("home");
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

  // Regroupe les handlers d'import pour les transmettre tels quels à HomeView
  // (état/logique d'import restent possédés ici, comme pour le reste de l'app —
  // HomeView ne fait qu'afficher, voir HomeView.jsx).
  const uploadProps = {
    dragOver,
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
    onBrowseClick: () => fileInputRef.current && fileInputRef.current.click(),
    fileInputRef,
    onFileInputChange: handleInputChange,
    acceptString: getAcceptString(),
    error,
  };

  // Navigation principale (voir AppNav.jsx) : "rides" est l'entrée globale
  // vers Sorties (toujours l'historique) — le contexte "une sortie est
  // ouverte" reste distinct, affiché par la bande contextuelle en mode
  // "dashboard" (voir plus bas), jamais confondu avec cette navigation.
  function navigateToSection(key) {
    if (key === "rides") setMode("historique");
    else setMode(key);
  }

  const activeNavSection = mode === "dashboard" || mode === "historique" ? "rides" : mode;

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
  // Contrôle mobile : choisir un critère repart en croissant ; le bouton inverse seulement le sens.
  const sortKeyFor = (setState) => (key) => setState({ key, dir: 1 });
  const sortDirFor = (setState) => () => setState((s) => ({ ...s, dir: -s.dir }));

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

  // Indicateur d'état actif des onglets de sortie (même règle que la nav principale, voir ActiveIndicator.jsx).
  const tabsIndicator = useActiveIndicator(activeTab);

  return (
    <div className="gpx-app">

      <AppNav active={activeNavSection} onNavigate={navigateToSection} onImport={() => fileInputRef.current && fileInputRef.current.click()} />
      <input ref={fileInputRef} type="file" accept={getAcceptString()} style={{ display: "none" }} onChange={handleInputChange} />

      {mode === "dashboard" && (
        <div className="gpx-context-strip">
          <button className="gpx-link-btn" onClick={() => setMode("historique")}>Sorties</button>
          <ChevronRight size={13} />
          <span className="gpx-context-strip-active">Analyse — {rideName || "Sortie vélo"}</span>
        </div>
      )}

      {mode === "home" && (
        <HomeView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onNavigate={navigateToSection}
          onOpenActivity={openActivityFromHistory}
          onLoadDemo={loadDemo}
          upload={uploadProps}
          onOpenSources={() => setMode("sources")}
        />
      )}

      {mode === "dashboard" && analysis && (
        <div className="gpx-dashboard gpx-view-analyse">
          {isDemo && (
            <div className="gpx-demo-banner">
              <Sparkles size={14} /> Données de démonstration — fictives, générées uniquement pour illustrer l'interface.
            </div>
          )}
          <header className={"gpx-hero" + (analysis.hasEle ? " has-relief" : "")}>
            <ElevationSilhouette points={chartData} />
            <div className="gpx-hero-top">
              <div className="gpx-hero-eyebrow">
                {analysis.startTime && <span>{fmtDateFull(analysis.startTime)}</span>}
                {analysis.startTime && <span>{fmtClock(analysis.startTime)}{analysis.endTime ? ` → ${fmtClock(analysis.endTime)}` : ""}</span>}
              </div>
              <div className="gpx-header-actions">
                <button className="gpx-icon-btn" title="Exporter (PDF)" aria-label="Exporter en PDF" onClick={exportPDF}><Download size={17} /></button>
                <button className="gpx-btn-ghost" onClick={resetAll}><RefreshCw size={15} /> <span>Nouvelle sortie</span></button>
              </div>
            </div>
            <h1 className="gpx-ride-name">{rideName || "Sortie vélo"}</h1>
            <div className="gpx-hero-badges" aria-label="Source et capteurs">
              <span className={"gpx-hero-badge" + (isDemo ? " is-demo" : "")}>{isDemo ? "Démonstration" : "Sortie importée"}</span>
              {fileName && fileName.includes(".") && <span className="gpx-hero-badge">{fileName.split(".").pop().toUpperCase()}</span>}
              {analysis.hasEle && <span className="gpx-hero-badge" style={{ "--badge-accent": COLORS.climb }}><i />Altitude</span>}
              {analysis.hasHR && <span className="gpx-hero-badge" style={{ "--badge-accent": COLORS.effort }}><i />Fréquence cardiaque</span>}
              {analysis.hasCad && <span className="gpx-hero-badge" style={{ "--badge-accent": COLORS.info }}><i />Cadence</span>}
              {analysis.hasPower && <span className="gpx-hero-badge" style={{ "--badge-accent": COLORS.info }}><i />Puissance</span>}
              {saveStatus && saveStatus.ok && <span className="gpx-hero-badge is-ok">Enregistrée</span>}
            </div>
            <div className="gpx-hero-metrics">
              <div className="gpx-hero-metric" style={{ "--metric-accent": COLORS.speed }}>
                <div className="gpx-hero-metric-label"><i />Distance</div>
                <div className="gpx-hero-metric-value"><AnimatedValue value={fmt1(analysis.totalDistanceKm)} /><span className="gpx-hero-metric-unit">km</span></div>
              </div>
              <div className="gpx-hero-metric" style={{ "--metric-accent": COLORS.info }}>
                <div className="gpx-hero-metric-label"><i />Durée</div>
                <div className="gpx-hero-metric-value"><AnimatedValue value={fmtDuration(analysis.totalTimeSec)} /></div>
              </div>
              {analysis.hasEle && (
                <div className="gpx-hero-metric" style={{ "--metric-accent": COLORS.climb }}>
                  <div className="gpx-hero-metric-label"><i />Dénivelé +</div>
                  <div className="gpx-hero-metric-value"><AnimatedValue value={fmtInt(analysis.elevGain)} /><span className="gpx-hero-metric-unit">m</span></div>
                </div>
              )}
              {analysis.hasTime && (
                <div className="gpx-hero-metric" style={{ "--metric-accent": COLORS.speed }}>
                  <div className="gpx-hero-metric-label"><i />Vitesse moy.</div>
                  <div className="gpx-hero-metric-value"><AnimatedValue value={fmt1(analysis.avgSpeedKmh)} /><span className="gpx-hero-metric-unit">km/h</span></div>
                </div>
              )}
            </div>
          </header>

          {saveStatus && (
            <div className={"gpx-save-banner" + (saveStatus.ok ? "" : " gpx-save-banner-error")}>
              <Info size={14} /> {saveStatus.message}
            </div>
          )}

          <div className="gpx-nav gpx-has-indicator" ref={tabsIndicator.ref}>
            {TABS.map((t) => (
              <button key={t.key} className={"gpx-tab" + (activeTab === t.key ? " active" : "")} disabled={t.disabled} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </button>
            ))}
            <ActiveIndicator style={tabsIndicator.style} ready={tabsIndicator.ready} />
          </div>

          {/* ---------------- RÉSUMÉ ---------------- */}
          {activeTab === "resume" && (
            <>
              <section className="gpx-panel gpx-stage">
                <SectionTitle icon={MapPin}>Tracé</SectionTitle>
                <MapView
                  analysis={analysis}
                  colorMode={mapColorMode}
                  setColorMode={setMapColorMode}
                  selectedClimb={selectedClimb}
                  height="clamp(300px, 46vh, 460px)"
                  decimated={chartData}
                  hoverIdx={hoverIdx}
                  onHoverIndex={setHoverIdx}
                />
                <div className="gpx-stage-profile">
                  <ProfileChart
                    analysis={analysis}
                    decimated={chartData}
                    metric={profileMetric}
                    setMetric={setProfileMetric}
                    hoverIdx={hoverIdx}
                    setHoverIdx={setHoverIdx}
                    selectedClimb={selectedClimb}
                    onSelectClimb={setSelectedClimb}
                    height={190}
                  />
                </div>
              </section>

              <div className="gpx-panel">
                <div className="gpx-metric-groups">
                  <MetricGroup
                    title="Vitesse" accent={COLORS.speed}
                    hero={{ value: fmt1(analysis.avgSpeedKmh), unit: "km/h" }}
                    rows={[{ label: "Maximale", value: fmt1(analysis.maxSpeedKmh), unit: "km/h" }]}
                  />
                  <MetricGroup
                    title="Dénivelé" accent={COLORS.climb}
                    hero={{ value: analysis.hasEle ? "+" + fmtInt(analysis.elevGain) : "—", unit: "m" }}
                    rows={[
                      { label: "Négatif", value: analysis.hasEle ? "-" + fmtInt(analysis.elevLoss) : "—", unit: "m" },
                      { label: "Altitude maximale", value: analysis.hasEle ? fmtInt(analysis.maxEle) : "—", unit: "m" },
                      { label: "Altitude minimale", value: analysis.hasEle ? fmtInt(analysis.minEle) : "—", unit: "m" },
                    ]}
                  />
                  <MetricGroup
                    title="Temps" accent={COLORS.info}
                    hero={{ value: fmtDuration(analysis.totalTimeSec) }}
                    rows={[
                      { label: "En mouvement", value: fmtDuration(analysis.movingTimeSec) },
                      { label: "Distance", value: fmt1(analysis.totalDistanceKm), unit: "km" },
                    ]}
                  />
                </div>
              </div>

              <div className="gpx-panel">
                <SectionTitle icon={Sparkles}>Lecture de la sortie</SectionTitle>
                <p className="gpx-summary-text">{summaryText}</p>
                <div className="gpx-highlight-grid">
                  <div className="gpx-highlight-col is-strong">
                    <div className="gpx-highlight-col-title"><TrendingUp size={15} color="var(--speed-ink)" /> Points forts</div>
                    {highlights.strengths.length ? (
                      <ul className="gpx-highlight-list">{highlights.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    ) : <div className="gpx-empty-note">Pas assez de données pour dégager des points forts.</div>}
                  </div>
                  <div className="gpx-highlight-col is-notable">
                    <div className="gpx-highlight-col-title"><Flame size={15} color="var(--climb-ink)" /> Points remarquables</div>
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
                                  <div className="gpx-grade-bar"><div style={{ width: `${distPct}%` }} /></div>
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
                  <div className="gpx-stats-grid gpx-stats-grid-5">
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
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_TOOLTIP_STYLE} />
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
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_TOOLTIP_STYLE} />
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
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_TOOLTIP_STYLE} />
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
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={CHART_TOOLTIP_STYLE} />
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
                <SortControl
                  label="Trier les montées" columns={climbSortColumns(analysis)} sort={climbSort}
                  onSortKey={sortKeyFor(setClimbSort)} onToggleDir={sortDirFor(setClimbSort)}
                />
                <div className="gpx-table-wrap">
                  <table className="gpx-table gpx-table--stack">
                    <thead>
                      <tr>
                        {climbSortColumns(analysis).map(([key, label]) => (
                          <th key={key} onClick={() => toggleSort(climbSort, setClimbSort, key)}>
                            {label} {climbSort.key === key ? (climbSort.dir === 1 ? "↑" : "↓") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(analysis.climbs, climbSort).map((c) => (
                        <tr key={c.id} className={"gpx-row-clickable" + (selectedClimb && selectedClimb.id === c.id ? " gpx-row-selected" : "")} onClick={() => setSelectedClimb(selectedClimb && selectedClimb.id === c.id ? null : c)}>
                          <td>{c.name}</td>
                          <td data-label="Km">{fmt1(c.startDistance)}</td>
                          <td data-label="Longueur">{fmt1(c.lengthKm)} km</td>
                          <td data-label="D+">+{fmtInt(c.gain)} m</td>
                          <td data-label="Pente moy.">{fmt1(c.avgGrade)}%</td>
                          <td data-label="Pente max">{fmt1(c.maxGrade)}%</td>
                          {analysis.hasTime && <td data-label="Durée">{fmtDuration(c.duration)}</td>}
                          {analysis.hasTime && <td data-label="Vitesse moy.">{fmt1(c.avgSpeed)} km/h</td>}
                          {analysis.hasHR && <td data-label="FC moy.">{fmtInt(c.avgHR)} bpm</td>}
                          {analysis.hasPower && <td data-label="Puiss. moy.">{fmtInt(c.avgPower)} W</td>}
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
                      <Brush dataKey="distance" height={22} stroke="var(--borderStrong)" fill={COLORS.surface2} tickFormatter={(v) => fmt1(v)} travellerWidth={8} />
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
                      <Brush dataKey="distance" height={22} stroke="var(--borderStrong)" fill={COLORS.surface2} tickFormatter={(v) => fmt1(v)} travellerWidth={8} />
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
                            contentStyle={CHART_TOOLTIP_STYLE}
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
              {analysis.splits.length > 0 && (
                <SortControl
                  label="Trier les splits" columns={splitSortColumns(analysis)} sort={splitSort}
                  onSortKey={sortKeyFor(setSplitSort)} onToggleDir={sortDirFor(setSplitSort)}
                />
              )}
              <div className="gpx-splits-container gpx-table-wrap">
                {analysis.splits.length > 0 ? (
                  <table className="gpx-table gpx-table--stack gpx-table--labeled">
                    <thead>
                      <tr>
                        {splitSortColumns(analysis).map(([key, label]) => (
                          <th key={key} onClick={() => toggleSort(splitSort, setSplitSort, key)}>
                            {label} {splitSort.key === key ? (splitSort.dir === 1 ? "↑" : "↓") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortRows(analysis.splits, splitSort).map((s, i) => (
                        <tr key={i} className="gpx-row-clickable">
                          <td data-label="Km">{fmt1(s.km)}</td>
                          {analysis.hasTime && <td data-label="Temps">{fmtDuration(s.time)}</td>}
                          <td data-label="Vitesse moy.">{fmt1(s.avgSpeed)} km/h</td>
                          <td data-label="Altitude moy.">{fmtInt(s.avgEle)} m</td>
                          <td data-label="D+">+{fmtInt(s.gain)} m</td>
                          {analysis.hasHR && <td data-label="FC moy.">{fmtInt(s.avgHR)} bpm</td>}
                          {analysis.hasCad && <td data-label="Cadence moy.">{fmtInt(s.avgCad)} rpm</td>}
                          {analysis.hasPower && <td data-label="Puissance moy.">{fmtInt(s.avgPower)} W</td>}
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
              <button className="gpx-link-btn" style={{ marginTop: 10 }} onClick={() => setMode("sources")}>
                Gérer les sources de données (Strava…)
              </button>
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
          onBack={() => setMode(points ? "dashboard" : "home")}
          ftp={userSettings.ftp}
          maxHR={maxHR}
          userSettings={userSettings}
        />
      )}

      {mode === "feed" && (
        <ActivityFeedView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "profil" && (
        <ProfileView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "alterego" && (
        <AlterEgoView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onViewArchetype={() => setMode("archetype")}
          onViewProfile={() => setMode("profil")}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "archetype" && (
        <ArchetypeView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "tour" && (
        <TourView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onViewProfile={() => setMode("profil")}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "coach" && (
        <CoachView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onOpen={openActivityFromHistory}
          onBack={() => setMode(points ? "dashboard" : "home")}
          userSettings={userSettings}
        />
      )}

      {mode === "recovery" && recovery && (
        <PasswordRecoveryView
          phase={recovery.phase}
          email={recovery.email}
          error={recovery.message}
          onDone={() => { setRecovery(null); setMode("home"); }}
        />
      )}

      {mode === "sources" && (
        <DataSourcesView
          storage={storage}
          onConnect={connectStorage}
          onReconnect={reconnectStorage}
          onDisconnectStorage={disconnectStorage}
          onBack={() => setMode(points ? "dashboard" : "home")}
          isDemo={isDemo}
          userSettings={userSettings}
          callbackNotice={stravaCallbackError}
          refreshSignal={stravaRefreshTick}
        />
      )}
    </div>
  );
}