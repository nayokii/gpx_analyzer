/**
 * DASHBOARD HISTORIQUE — couche UI au-dessus du moteur historique (Phase 5A,
 * voir src/lib/history/). Ne recalcule aucune métrique ici : chaque section
 * lit directement le résultat de computeHistoryAnalytics()/buildTimeSeries()/
 * computeTrend()/compareActivities()/computeRecords()/groupActivitiesByRoute().
 *
 * Réutilise HistoryView.jsx tel quel (header, connexion au stockage,
 * recherche, tableau des sorties, sélection) plutôt que de dupliquer ce
 * système : ce composant s'injecte dans son slot `children`, affiché entre le
 * panneau de connexion et le tableau. Un seul système d'historique, une seule
 * sélection (les cases à cocher déjà câblées dans HistoryView).
 *
 * Chargement des données (voir audit Phase 5A) :
 * - `index.json` (via listActivities) suffit pour l'aperçu, les graphiques,
 *   les tendances et la plupart des records : ces fonctions dégradent
 *   proprement les métriques absentes de l'index (voir historyAnalytics.js).
 * - La comparaison de deux sorties charge UNIQUEMENT ces deux activités
 *   complètes (loadActivityDetail), jamais tout l'historique.
 * - "Parcours répétés" a besoin de la position GPS de départ de chaque
 *   activité (absente de l'index) : le chargement complet de l'historique
 *   filtré n'est déclenché qu'à la demande explicite de l'utilisateur, avec
 *   un plafond de sécurité, jamais automatiquement.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  GitCompare, TrendingUp, TrendingDown, Minus, X, Mountain, Clock, Gauge,
  Zap, Repeat, Route, Heart,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

import { HistoryView } from "./HistoryView.jsx";
import { SectionTitle, StatCard } from "./UIPrimitives.jsx";
import { useActivityRepository } from "./useActivityRepository.js";
import { computeHistoryAnalytics, filterActivitiesByPeriod } from "../lib/history/historyAnalytics.js";
import { buildTimeSeries, computeTrend } from "../lib/history/trends.js";
import { compareActivities } from "../lib/history/comparisons.js";
import { computeRecords, computeBestAvgSpeedAmongComparable } from "../lib/history/records.js";
import { groupActivitiesByRoute } from "../lib/history/similarity.js";
import { COLORS } from "../lib/colors.js";
import { avg, fmt1, fmtInt, fmtDuration, fmtDurationLong } from "../lib/utils.js";

const PERIOD_OPTIONS = [
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
  { key: "90d", label: "90 jours" },
  { key: "year", label: "Cette année" },
  { key: "all", label: "Tout" },
  { key: "custom", label: "Personnalisé" },
];

const PERIOD_LABELS = {
  "7d": "7 derniers jours", "30d": "30 derniers jours", "90d": "90 derniers jours",
  year: "cette année", all: "toutes vos sorties", custom: "période personnalisée",
};

// Cap de sécurité avant de charger le détail complet de tout un historique
// filtré pour la détection de parcours répétés (voir section 13/14 de la
// consigne) : au-delà, on demande d'affiner la période plutôt que de charger
// silencieusement des dizaines de fichiers.
const MAX_ROUTE_ANALYSIS_ACTIVITIES = 60;

function bucketForPeriod(periodKey) {
  if (periodKey === "7d" || periodKey === "30d") return "day";
  if (periodKey === "90d" || periodKey === "year") return "week";
  return "month";
}

const BUCKET_LABELS = { day: "par jour", week: "par semaine", month: "par mois" };

/* ------------------------------------------------------------------ */
/* Filtre de période                                                   */
/* ------------------------------------------------------------------ */

function PeriodFilter({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Clock}>Période</SectionTitle>
      <div className="gpx-map-modes">
        {PERIOD_OPTIONS.map((opt) => (
          <button key={opt.key} className={"gpx-chip" + (period === opt.key ? " gpx-chip-active" : "")} onClick={() => setPeriod(opt.key)}>
            {opt.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="gpx-history-daterange" style={{ marginTop: 10 }}>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="Date de début" />
          <span>→</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="Date de fin" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vue d'ensemble                                                       */
/* ------------------------------------------------------------------ */

function OverviewSection({ historyAnalytics, periodLabel }) {
  const { count, totals, averages } = historyAnalytics;
  const stoppedTimeSec = totals.durationSec != null && totals.movingTimeSec != null ? totals.durationSec - totals.movingTimeSec : null;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Route}>{`Historique — ${periodLabel}`}</SectionTitle>
      <div className="gpx-stats-grid">
        <StatCard icon={Repeat} label="Sorties" value={fmtInt(count)} accent={COLORS.info} />
        <StatCard icon={Route} label="Distance" value={fmt1(totals.distanceKm)} unit="km" accent={COLORS.speed} />
        <StatCard icon={Clock} label="Temps en mouvement" value={fmtDuration(totals.movingTimeSec)} accent={COLORS.info} />
        <StatCard icon={Mountain} label="D+" value={fmtInt(totals.elevationGainM)} unit="m" accent={COLORS.climb} />
        <StatCard
          icon={Gauge} label="Vitesse moyenne pondérée" value={fmt1(averages.speedKmh)} unit="km/h" accent={COLORS.speed}
          sub={averages.speedKmh != null ? "Pondérée par le temps en mouvement" : null}
        />
        <StatCard icon={Clock} label="Temps arrêté" value={fmtDuration(stoppedTimeSec)} accent={COLORS.alert} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Graphiques                                                           */
/* ------------------------------------------------------------------ */

function TrendBadge({ trend, unit, formatValue = fmt1 }) {
  if (!trend || trend.direction === "insufficient_data") {
    return <span className="gpx-empty-note" style={{ fontStyle: "normal" }}>Pas assez de sorties pour une tendance</span>;
  }
  const Icon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;
  const color = trend.direction === "up" ? COLORS.speed : trend.direction === "down" ? COLORS.effort : COLORS.textMuted;
  if (trend.direction === "flat") {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color, fontWeight: 700, fontSize: 12.5 }}><Icon size={13} /> Stable sur la période</span>;
  }
  const totalChange = trend.slope * (trend.points.length - 1);
  const sign = totalChange > 0 ? "+" : "";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color, fontWeight: 700, fontSize: 12.5 }}>
      <Icon size={13} /> {sign}{formatValue(totalChange)}{unit ? ` ${unit}` : ""} sur la période
    </span>
  );
}

function MiniBarChart({ data, dataKey, color, valueFormatter, yTickFormatter }) {
  if (!data || data.length === 0) return <p className="gpx-empty-note">Pas assez de données sur cette période.</p>;
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={COLORS.border} vertical={false} />
        <XAxis dataKey="key" stroke={COLORS.textMuted} fontSize={10} />
        <YAxis stroke={COLORS.textMuted} fontSize={10} width={36} tickFormatter={yTickFormatter} />
        <Tooltip formatter={(v) => [valueFormatter(v), ""]} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
        <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SpeedTrendChart({ trend }) {
  if (!trend || trend.points.length === 0) return <p className="gpx-empty-note">Pas de données de vitesse sur cette période.</p>;
  const data = trend.points.map((p) => ({ x: p.date.slice(5, 10), value: p.value }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={COLORS.border} vertical={false} />
        <XAxis dataKey="x" stroke={COLORS.textMuted} fontSize={10} />
        <YAxis stroke={COLORS.textMuted} fontSize={10} width={36} domain={["dataMin - 1", "dataMax + 1"]} tickFormatter={(v) => fmt1(v)} />
        <Tooltip formatter={(v) => [`${fmt1(v)} km/h`, ""]} contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }} />
        <Line type="monotone" dataKey="value" stroke={COLORS.speed} dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartsSection({ series, trendDistance, trendElevationGain, trendAvgSpeed, bucket }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={TrendingUp}>{`Évolution (${BUCKET_LABELS[bucket]})`}</SectionTitle>
      <div className="gpx-effort-grid">
        <div>
          <div className="gpx-chart-card-title">Distance</div>
          <MiniBarChart data={series} dataKey="distanceKm" color={COLORS.speed} valueFormatter={(v) => `${fmt1(v)} km`} />
          <div style={{ marginTop: 6 }}><TrendBadge trend={trendDistance} unit="km" /></div>
        </div>
        <div>
          <div className="gpx-chart-card-title">Dénivelé positif</div>
          <MiniBarChart data={series} dataKey="elevationGainM" color={COLORS.climb} valueFormatter={(v) => `${fmtInt(v)} m`} />
          <div style={{ marginTop: 6 }}><TrendBadge trend={trendElevationGain} unit="m" formatValue={fmtInt} /></div>
        </div>
        <div>
          <div className="gpx-chart-card-title">Temps en mouvement</div>
          <MiniBarChart data={series} dataKey="movingTimeSec" color={COLORS.info} valueFormatter={(v) => fmtDuration(v)} yTickFormatter={(v) => fmtDuration(v)} />
        </div>
        <div>
          <div className="gpx-chart-card-title">Vitesse moyenne</div>
          <SpeedTrendChart trend={trendAvgSpeed} />
          <div style={{ marginTop: 6 }}><TrendBadge trend={trendAvgSpeed} unit="km/h" /></div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Records                                                              */
/* ------------------------------------------------------------------ */

const RECORD_META = {
  longest_distance: { label: "Plus longue sortie", format: (v) => `${fmt1(v)} km` },
  biggest_elevation_gain: { label: "Plus gros D+", format: (v) => `${fmtInt(v)} m` },
  longest_duration: { label: "Plus longue durée", format: (v) => fmtDurationLong(v) },
  highest_avg_power_measured: { label: "Meilleure puissance moyenne mesurée", format: (v) => `${fmtInt(v)} W` },
  highest_avg_speed_among_comparable: { label: "Meilleure vitesse sur parcours comparable", format: (v) => `${fmt1(v)} km/h` },
};

function RecordsSection({ records, onOpen }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Zap}>Records (toutes les sorties)</SectionTitle>
      {records.length === 0 ? (
        <p className="gpx-empty-note">Pas assez de sorties pour dégager des records.</p>
      ) : (
        <div className="gpx-best-efforts">
          {records.map((r) => {
            const meta = RECORD_META[r.type];
            if (!meta) return null;
            return (
              <div
                className="gpx-effort-card"
                key={r.type}
                style={onOpen ? { cursor: "pointer" } : undefined}
                onClick={() => onOpen && onOpen(r.activityId)}
                title={onOpen ? "Ouvrir cette sortie" : undefined}
              >
                <div className="gpx-effort-card-label">{meta.label}</div>
                <div className="gpx-effort-card-value">{meta.format(r.value)}</div>
                {r.context && <div className="gpx-effort-card-sub">{r.context}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parcours répétés (chargement complet à la demande uniquement)       */
/* ------------------------------------------------------------------ */

function SimilarRoutesSection({ activities, repository }) {
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tooMany = activities.length > MAX_ROUTE_ANALYSIS_ACTIVITIES;

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const full = await Promise.all(activities.map((a) => repository.loadActivityDetail(a.id)));
      setGroups(groupActivitiesByRoute(full));
    } catch (err) {
      setError(err.message || "Impossible de charger le détail de ces sorties.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Repeat}>Parcours répétés</SectionTitle>
      {activities.length < 2 ? (
        <p className="gpx-empty-note">Pas assez de sorties pour détecter des parcours répétés.</p>
      ) : tooMany ? (
        <p className="gpx-empty-note">
          {activities.length} sorties dans l'historique — affine la période pour analyser les parcours répétés (limite : {MAX_ROUTE_ANALYSIS_ACTIVITIES} à la fois).
        </p>
      ) : groups == null ? (
        <>
          <p className="gpx-empty-note" style={{ marginBottom: 10 }}>
            Nécessite de charger le détail complet de {activities.length} sortie{activities.length > 1 ? "s" : ""} (position de départ GPS) — non fait automatiquement.
          </p>
          <button className="gpx-btn-ghost" onClick={handleAnalyze} disabled={loading}>
            {loading ? "Analyse en cours…" : "Analyser les parcours répétés"}
          </button>
          {error && <div className="gpx-error-box" style={{ marginTop: 10 }}>{error}</div>}
        </>
      ) : groups.length === 0 ? (
        <p className="gpx-empty-note">Aucun parcours répété détecté.</p>
      ) : (
        <div className="gpx-climb-cards">
          {groups.map((group, i) => {
            const avgDistance = avg(group.map((a) => a.distance));
            const avgGain = avg(group.map((a) => a.elevationGain));
            const avgSpeed = avg(group.map((a) => a.avgSpeed));
            return (
              <div className="gpx-climb-card" key={i}>
                <div className="gpx-climb-card-head">
                  <span className="gpx-climb-card-name">{group[0].name || `Parcours ${i + 1}`}</span>
                  <span className="gpx-climb-card-grade">{group.length}×</span>
                </div>
                <div className="gpx-climb-card-meta">
                  {avgDistance != null && <span>{fmt1(avgDistance)} km moy.</span>}
                  {avgGain != null && <span>+{fmtInt(avgGain)} m moy.</span>}
                  {avgSpeed != null && <span>{fmt1(avgSpeed)} km/h moy.</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comparaison de deux sorties                                         */
/* ------------------------------------------------------------------ */

const GENERAL_ROWS = [
  { key: "distanceKm", label: "Distance", fmt: (v) => `${fmt1(v)} km` },
  { key: "elevationGainM", label: "D+", fmt: (v) => `${fmtInt(v)} m` },
  { key: "elevationLossM", label: "D-", fmt: (v) => `${fmtInt(v)} m` },
  { key: "durationSec", label: "Durée", fmt: fmtDuration },
  { key: "movingTimeSec", label: "Temps en mouvement", fmt: fmtDuration },
];
const PERFORMANCE_ROWS = [
  { key: "avgSpeedKmh", label: "Vitesse moyenne", fmt: (v) => `${fmt1(v)} km/h` },
  { key: "maxSpeedKmh", label: "Vitesse maximale", fmt: (v) => `${fmt1(v)} km/h` },
  { key: "avgHeartRateBpm", label: "FC moyenne", fmt: (v) => `${fmtInt(v)} bpm` },
  { key: "maxHeartRateBpm", label: "FC maximale", fmt: (v) => `${fmtInt(v)} bpm` },
  { key: "avgCadenceRpm", label: "Cadence moyenne", fmt: (v) => `${fmtInt(v)} rpm` },
  { key: "maxCadenceRpm", label: "Cadence maximale", fmt: (v) => `${fmtInt(v)} rpm` },
];

function MetricRow({ group, row, cmp }) {
  const metric = cmp[group][row.key];
  return (
    <tr>
      <td>{row.label}</td>
      <td>{metric.a != null ? row.fmt(metric.a) : "—"}</td>
      <td>{metric.b != null ? row.fmt(metric.b) : "—"}</td>
    </tr>
  );
}

function powerSourceLabel(source) {
  if (source === "measured") return "mesurée";
  if (source === "estimated") return "estimée";
  return "—";
}

function PowerRow({ cmp }) {
  const { avgPowerW } = cmp.performance;
  const { power } = cmp.dataQuality;
  const bothKnown = power.a !== "unavailable" && power.b !== "unavailable";
  return (
    <>
      <tr>
        <td>Puissance moyenne</td>
        <td>
          {avgPowerW.a != null ? `${fmtInt(avgPowerW.a)} W` : "—"}
          {power.a !== "unavailable" && (
            <span className={power.a === "estimated" ? "gpx-power-source-estimated" : "gpx-power-source"} style={{ marginLeft: 6 }}>
              {powerSourceLabel(power.a)}
            </span>
          )}
        </td>
        <td>
          {avgPowerW.b != null ? `${fmtInt(avgPowerW.b)} W` : "—"}
          {power.b !== "unavailable" && (
            <span className={power.b === "estimated" ? "gpx-power-source-estimated" : "gpx-power-source"} style={{ marginLeft: 6 }}>
              {powerSourceLabel(power.b)}
            </span>
          )}
        </td>
      </tr>
      {bothKnown && !power.comparable && (
        <tr>
          <td colSpan={3} style={{ color: "var(--muted)", fontSize: 12, fontStyle: "italic", whiteSpace: "normal" }}>
            Comparaison directe indisponible (une mesurée, l'autre estimée).
          </td>
        </tr>
      )}
    </>
  );
}

function ZoneCompareRows({ zonesA, zonesB }) {
  if (!zonesA.available || !zonesB.available) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {zonesA.zones.map((za, i) => {
        const zb = zonesB.zones[i];
        return (
          <div className="gpx-zone-row" key={za.name} style={{ gridTemplateColumns: "90px 1fr 1fr 50px" }}>
            <div className="gpx-zone-name">{za.name}</div>
            <div className="gpx-zone-track" title={`Sortie A : ${fmtDuration(za.seconds)}`}>
              <div className="gpx-zone-fill" style={{ width: `${za.percentage || 0}%`, background: COLORS.speed }} />
            </div>
            <div className="gpx-zone-track" title={`Sortie B : ${fmtDuration(zb.seconds)}`}>
              <div className="gpx-zone-fill" style={{ width: `${zb.percentage || 0}%`, background: COLORS.climb }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
              {(za.percentage || 0).toFixed(0)}/{(zb.percentage || 0).toFixed(0)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComparisonContent({ cmp }) {
  return (
    <>
      <div className="gpx-table-wrap">
        <table className="gpx-table">
          <thead>
            <tr><th></th><th>Sortie A</th><th>Sortie B</th></tr>
          </thead>
          <tbody>
            {GENERAL_ROWS.map((row) => <MetricRow key={row.key} group="general" row={row} cmp={cmp} />)}
            <PowerRow cmp={cmp} />
            {PERFORMANCE_ROWS.map((row) => <MetricRow key={row.key} group="performance" row={row} cmp={cmp} />)}
          </tbody>
        </table>
      </div>

      {!cmp.dataQuality.heartRate.a && !cmp.dataQuality.heartRate.b ? null : (!cmp.dataQuality.heartRate.a || !cmp.dataQuality.heartRate.b) && (
        <p className="gpx-empty-note" style={{ marginTop: 10 }}>Fréquence cardiaque absente d'une des deux sorties.</p>
      )}

      {cmp.zones.available ? (
        <div style={{ marginTop: 16 }}>
          <div className="gpx-section-title-left" style={{ color: "var(--speed)", marginBottom: 8 }}>
            <Gauge size={14} /><span style={{ color: "var(--text)" }}>Puissance par zone</span>
          </div>
          {cmp.zones.power.a.available && cmp.zones.power.b.available ? (
            <ZoneCompareRows zonesA={cmp.zones.power.a} zonesB={cmp.zones.power.b} />
          ) : (
            <p className="gpx-empty-note">Zones de puissance non calculables pour cette paire (FTP non renseignée ou puissance absente).</p>
          )}
          <div className="gpx-section-title-left" style={{ color: "var(--effort)", margin: "14px 0 8px" }}>
            <Heart size={14} /><span style={{ color: "var(--text)" }}>Fréquence cardiaque par zone</span>
          </div>
          {cmp.zones.heartRate.a.available && cmp.zones.heartRate.b.available ? (
            <ZoneCompareRows zonesA={cmp.zones.heartRate.a} zonesB={cmp.zones.heartRate.b} />
          ) : (
            <p className="gpx-empty-note">Zones FC non calculables pour cette paire (FC max non renseignée ou FC absente).</p>
          )}
        </div>
      ) : (
        <p className="gpx-empty-note" style={{ marginTop: 10 }}>{cmp.zones.reason}</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} props
 * @param {Object} props.storage - { status, rootHandle } (voir GPXAnalyzer.jsx)
 * @param {Function} props.onConnect
 * @param {Function} props.onReconnect
 * @param {Function} props.onOpen - Ouvre une activité par id (déjà utilisé par HistoryView)
 * @param {Function} props.onBack
 * @param {number} [props.ftp] - Pour les zones de puissance en comparaison
 * @param {number} [props.maxHR] - Pour les zones de FC en comparaison
 * @param {Object} [props.userSettings] - {weight, bikeWeight, ftp} (voir consigne §13 Phase 11B)
 */
export function HistoryDashboard({ storage, onConnect, onReconnect, onOpen, onBack, ftp, maxHR, userSettings }) {
  const { repository } = useActivityRepository(storage, userSettings);
  const [activities, setActivities] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);

  const [period, setPeriod] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [compareIds, setCompareIds] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState(null);

  // Prête dès qu'une source d'activités existe (local OU cloud) — voir
  // ProfileView.jsx pour la même logique et sa justification (Phase 11B §2).
  const ready = storage.status === "connected" || repository.hasCloud;

  const refresh = useCallback(() => {
    if (!ready) return; // ne renvoie jamais "0 sortie" tant qu'aucune source n'est connectée (voir HistoryView.jsx, même garde)
    setError(null);
    repository
      .listActivities()
      .then(({ items, source: src }) => { setActivities(items); setSource(src); })
      .catch((err) => setError(err.message || "Impossible de lire l'historique."));
  }, [repository, ready]);

  useEffect(() => { refresh(); }, [refresh]);

  const effectivePeriod = useMemo(() => {
    if (period !== "custom") return period;
    return { from: customFrom || null, to: customTo || null };
  }, [period, customFrom, customTo]);

  const filtered = useMemo(() => (activities ? filterActivitiesByPeriod(activities, effectivePeriod) : []), [activities, effectivePeriod]);

  const historyAnalytics = useMemo(
    () => (activities ? computeHistoryAnalytics(activities, { period: effectivePeriod }) : null),
    [activities, effectivePeriod]
  );

  const bucket = bucketForPeriod(period);
  const series = useMemo(() => buildTimeSeries(filtered, { bucket }), [filtered, bucket]);
  const trendDistance = useMemo(() => computeTrend(filtered, "distance"), [filtered]);
  const trendElevationGain = useMemo(() => computeTrend(filtered, "elevationGain"), [filtered]);
  const trendAvgSpeed = useMemo(() => computeTrend(filtered, "avgSpeed"), [filtered]);

  const records = useMemo(() => {
    if (!activities || activities.length < 2) return [];
    return [...computeRecords(activities), computeBestAvgSpeedAmongComparable(activities)].filter(Boolean);
  }, [activities]);

  const handleCompare = useCallback(async (ids) => {
    setCompareIds(ids);
    setCompareResult(null);
    setCompareError(null);
    setCompareLoading(true);
    try {
      const [a, b] = await Promise.all(ids.map((id) => repository.loadActivityDetail(id)));
      const cmp = compareActivities(a, b, { ftp, maxHR });
      setCompareResult({ a, b, cmp });
    } catch (err) {
      setCompareError(err.message || "Impossible de charger le détail de ces sorties.");
    } finally {
      setCompareLoading(false);
    }
  }, [repository, ftp, maxHR]);

  function closeComparison() {
    setCompareIds(null);
    setCompareResult(null);
    setCompareError(null);
  }

  // HistoryView affiche déjà lui-même le chargement/l'erreur/le "aucune
  // sortie" dans son propre tableau (voir la prop `activities` qu'on lui
  // transmet ci-dessous) : on ne duplique surtout pas ces messages ici, ce
  // bloc ne rend du contenu qu'une fois de vraies activités disponibles.
  const hasData = activities != null && activities.length > 0;

  return (
    <HistoryView
      storage={storage} repository={repository} onConnect={onConnect} onReconnect={onReconnect} onOpen={onOpen} onBack={onBack}
      onCompare={handleCompare} activities={activities} error={error} onRefresh={refresh} source={source}
    >
      {hasData && (
        <>
          {compareIds && (
            <div className="gpx-panel">
              <SectionTitle icon={GitCompare} right={<button className="gpx-icon-btn" onClick={closeComparison} title="Fermer la comparaison"><X size={14} /></button>}>
                Comparaison
              </SectionTitle>
              {compareLoading && <p className="gpx-empty-note">Chargement des deux sorties…</p>}
              {compareError && <div className="gpx-error-box">{compareError}</div>}
              {compareResult && <ComparisonContent cmp={compareResult.cmp} />}
            </div>
          )}

          {activities.length === 1 ? (
            <div className="gpx-panel">
              <p className="gpx-summary-text">Ton historique commence ici.<br />Une seule sortie enregistrée pour l'instant.</p>
              <p className="gpx-empty-note">Les comparaisons et tendances apparaîtront à mesure que tu accumuleras des sorties.</p>
            </div>
          ) : (
            <>
              <PeriodFilter period={period} setPeriod={setPeriod} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
              {filtered.length === 0 ? (
                <div className="gpx-panel"><p className="gpx-empty-note">Aucune sortie enregistrée pour cette période.</p></div>
              ) : (
                <>
                  <OverviewSection historyAnalytics={historyAnalytics} periodLabel={PERIOD_LABELS[period] || "période personnalisée"} />
                  <ChartsSection series={series} trendDistance={trendDistance} trendElevationGain={trendElevationGain} trendAvgSpeed={trendAvgSpeed} bucket={bucket} />
                </>
              )}
              <RecordsSection records={records} onOpen={onOpen} />
              <SimilarRoutesSection activities={activities} repository={repository} />
            </>
          )}
        </>
      )}
    </HistoryView>
  );
}
