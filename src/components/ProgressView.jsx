/**
 * PROGRÈS — totaux par semaine / mois / année, comparaison avec la période précédente, série de semaines et
 * comparatif mois par mois (inspiré de l'onglet « Progrès » de Strava). Ne lit que l'index léger des sorties
 * (date, distance, temps, D+, type) : aucun fichier de sortie n'est chargé. Les calculs sont dans lib/progress/.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Flame, TrendingUp, TrendingDown, Minus, Share2 } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

import { StorageSettings } from "./StorageSettings.jsx";
import { RecapShareDialog } from "./RecapShareDialog.jsx";
import { FitnessPanel } from "./FitnessPanel.jsx";
import { ZonesPanel } from "./ZonesPanel.jsx";
import { HeatmapPanel } from "./HeatmapPanel.jsx";
import { PageHead, SectionTitle } from "./UIPrimitives.jsx";
import { useActivityRepository, useUnifiedActivities } from "./useActivityRepository.js";
import {
  PERIOD_KINDS, periodStart, shiftPeriod, periodLabel, sportKeys, filterBySport, buildSeries, totalsForPeriod,
  delta, avgHoursPerWeek, formatHours, monthlyComparison, weekStreak, dayCells,
} from "../lib/progress/progress.js";
import { activityTypeLabel } from "../lib/feed/feedModel.js";
import { COLORS, CHART_TOOLTIP_STYLE, CHART_AXIS } from "../lib/colors.js";
import { fmt1, fmtInt } from "../lib/utils.js";

const hoursLabel = formatHours;

/** Métriques affichables dans les graphiques : valeur numérique, formatage, couleur. */
const METRICS = {
  distance: { label: "Distance", field: "distanceKm", unit: "km", color: COLORS.speed, value: (t) => t.distanceKm, format: (v) => fmt1(v), tick: (v) => fmtInt(v) },
  time: { label: "Temps", field: "movingTimeSec", unit: "h", color: COLORS.info, value: (t) => t.movingTimeSec / 3600, format: (v) => hoursLabel(v * 3600), tick: (v) => `${fmtInt(v)} h` },
  elevation: { label: "Dénivelé", field: "elevationGainM", unit: "m", color: COLORS.climb, value: (t) => t.elevationGainM, format: (v) => fmtInt(v), tick: (v) => fmtInt(v) },
  count: { label: "Sorties", field: "count", unit: "", color: COLORS.effort, value: (t) => t.count, format: (v) => fmtInt(v), tick: (v) => fmtInt(v) },
};

function DeltaBadge({ current, previous, metric, label }) {
  const { diff, pct } = delta(current, previous, metric);
  if (diff == null || (current[metric] === 0 && previous[metric] === 0)) return <span className="gpx-progress-delta is-flat"><Minus size={12} aria-hidden="true" /> {label} : —</span>;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const cls = diff > 0 ? "is-up" : diff < 0 ? "is-down" : "is-flat";
  const text = pct == null ? "nouveau" : `${diff > 0 ? "+" : ""}${Math.round(pct)} %`;
  return <span className={"gpx-progress-delta " + cls}><Icon size={12} aria-hidden="true" /> {label} : {text}</span>;
}

function Headline({ kind, start, totals, previous }) {
  const hrs = avgHoursPerWeek(totals, kind, start);
  return (
    <>
      <div className="gpx-progress-headline">
        <div><span>Distance</span><strong>{fmt1(totals.distanceKm)} <small>km</small></strong><DeltaBadge current={totals} previous={previous} metric="distanceKm" label="vs préc." /></div>
        <div><span>Dénivelé</span><strong>{fmtInt(totals.elevationGainM)} <small>m</small></strong><DeltaBadge current={totals} previous={previous} metric="elevationGainM" label="vs préc." /></div>
        <div><span>Temps</span><strong>{hoursLabel(totals.movingTimeSec)}</strong><DeltaBadge current={totals} previous={previous} metric="movingTimeSec" label="vs préc." /></div>
      </div>
      <dl className="gpx-progress-minor">
        <div><dt>Sorties</dt><dd>{fmtInt(totals.count)}</dd></div>
        <div><dt>Heures / semaine</dt><dd>{kind === "week" ? hoursLabel(totals.movingTimeSec) : `${hoursLabel(hrs * 3600)}`}</dd></div>
        <div><dt>Vitesse moy.</dt><dd>{totals.avgSpeedKmh != null ? `${fmt1(totals.avgSpeedKmh)} km/h` : "—"}</dd></div>
      </dl>
    </>
  );
}

function SeriesChart({ series, metric, selectedStart, onSelect }) {
  const m = METRICS[metric];
  const data = series.map((s) => ({ ...s, v: m.value(s), isSelected: s.start.getTime() === selectedStart.getTime() }));
  const gradId = "gpx-progress-grad-" + metric;
  return (
    <div className="gpx-progress-chart" role="img" aria-label={`${m.label} sur les ${series.length} dernières périodes`}>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}
          onClick={(e) => { if (e && e.activeIndex != null && data[e.activeIndex]) onSelect(data[e.activeIndex].start); }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={m.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={m.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--separator)" />
          <XAxis dataKey="shortLabel" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...CHART_AXIS} width={44} tickFormatter={m.tick} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelFormatter={(_, p) => (p && p[0] ? p[0].payload.label : "")}
            formatter={(v) => [`${m.format(v)} ${m.unit === "h" ? "" : m.unit}`.trim(), m.label]}
          />
          <Area type="monotone" dataKey="v" stroke={m.color} strokeWidth={2.5} fill={`url(#${gradId})`}
            dot={(p) => (p.payload.isSelected
              ? <circle key={p.index} cx={p.cx} cy={p.cy} r={6} fill={m.color} stroke="var(--surface)" strokeWidth={2} />
              : <circle key={p.index} cx={p.cx} cy={p.cy} r={3} fill="var(--surface)" stroke={m.color} strokeWidth={2} />)}
            activeDot={{ r: 6 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StreakCard({ activities }) {
  const today = new Date();
  const streak = weekStreak(activities, today);
  const cells = dayCells(activities, "month", periodStart("month", today), today);
  const lead = (cells[0].date.getDay() + 6) % 7; // colonnes vides avant le 1er (semaine du lundi)
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Flame}>Série</SectionTitle>
      <div className="gpx-progress-streak">
        <div className="gpx-progress-flame" aria-label={`${streak} semaine${streak > 1 ? "s" : ""} consécutive${streak > 1 ? "s" : ""}`}>
          <Flame size={44} aria-hidden="true" /><b>{streak}</b>
          <span>semaine{streak > 1 ? "s" : ""}</span>
        </div>
        <div>
          <p className="gpx-progress-cal-title">Ce mois-ci</p>
          <div className="gpx-progress-cal" role="img" aria-label="Jours avec sortie ce mois-ci">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <i key={i} className="gpx-progress-cal-h">{d}</i>)}
            {Array.from({ length: lead }, (_, i) => <i key={"l" + i} className="gpx-progress-dot is-blank" />)}
            {cells.map((c) => (
              <i key={c.date.getTime()} className={"gpx-progress-dot" + (c.count ? " is-on" : "") + (c.future ? " is-future" : "")}
                title={`${c.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}${c.count ? ` : ${c.count} sortie${c.count > 1 ? "s" : ""}` : ""}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthlyComparison({ activities, metric, setMetric }) {
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const set = new Set([thisYear]);
    for (const a of activities) { const d = new Date(a.date); if (!isNaN(d.getTime())) set.add(d.getFullYear()); }
    return [...set].sort((a, b) => b - a);
  }, [activities, thisYear]);
  const [year, setYear] = useState(thisYear);
  const m = METRICS[metric];
  const rows = useMemo(() => monthlyComparison(activities, year), [activities, year]);
  const data = rows.map((r) => ({ label: r.label, cur: m.value(r.current), prev: m.value(r.previous), curT: r.current, prevT: r.previous }));
  const sumCur = rows.reduce((s, r) => s + m.value(r.current), 0);
  const sumPrev = rows.reduce((s, r) => s + m.value(r.previous), 0);
  const unit = m.unit === "h" ? "" : ` ${m.unit}`;

  return (
    <div className="gpx-panel">
      <SectionTitle icon={TrendingUp}>Mois par mois</SectionTitle>
      <div className="gpx-progress-toolbar">
        <div className="gpx-map-modes" role="group" aria-label="Métrique du comparatif">
          {Object.entries(METRICS).map(([k, v]) => (
            <button key={k} className={"gpx-chip" + (metric === k ? " gpx-chip-active" : "")} aria-pressed={metric === k} onClick={() => setMetric(k)}>{v.label}</button>
          ))}
        </div>
        <label className="gpx-progress-year">Année
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p className="gpx-progress-legend">
        <span><i style={{ background: m.color }} /> {year} — {m.format(sumCur)}{unit}</span>
        <span><i style={{ background: "var(--faint)" }} /> {year - 1} — {m.format(sumPrev)}{unit}</span>
      </p>
      <div className="gpx-progress-chart" role="img" aria-label={`${m.label} par mois, ${year} contre ${year - 1}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--separator)" />
            <XAxis dataKey="label" {...CHART_AXIS} interval={0} />
            <YAxis {...CHART_AXIS} width={44} tickFormatter={m.tick} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--surface2)" }}
              formatter={(v, name) => [`${m.format(v)}${unit}`, name === "cur" ? String(year) : String(year - 1)]} />
            <Bar dataKey="prev" fill="var(--faint)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="cur" fill={m.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="gpx-progress-table-wrap">
        <table className="gpx-progress-table">
          <thead><tr><th>Mois</th><th>{year}</th><th>{year - 1}</th><th>Écart</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const { diff, pct } = delta(r.current, r.previous, m.field);
              const cur = m.value(r.current), prev = m.value(r.previous);
              const cls = diff == null || (cur === 0 && prev === 0) ? "" : diff > 0 ? "is-up" : diff < 0 ? "is-down" : "";
              return (
                <tr key={r.month}>
                  <th scope="row">{r.label}</th>
                  <td>{cur ? m.format(cur) : "—"}</td>
                  <td>{prev ? m.format(prev) : "—"}</td>
                  <td className={cls}>{cur === 0 && prev === 0 ? "" : pct == null ? "nouveau" : `${diff > 0 ? "+" : ""}${Math.round(pct)} %`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SECTIONS = [
  { key: "bilan", label: "Bilan" },
  { key: "forme", label: "Forme" },
  { key: "zones", label: "Zones" },
  { key: "carte", label: "Carte" },
];
/** Nombre de sorties complètes (échantillons, tracés) chargées pour les zones et la carte — les plus récentes. */
const MAX_FULL_ACTIVITIES = 150;

export function ProgressView({ storage, onConnect, onReconnect, onOpen, onBack, userSettings, maxHR = 190 }) {
  const { repository } = useActivityRepository(storage, userSettings);
  const [section, setSection] = useState("bilan");
  const [fullWanted, setFullWanted] = useState(false); // les sorties complètes ne sont chargées qu'à la première visite de Zones ou Carte
  const { summaries, summariesError, fullActivities, failedCount } = useUnifiedActivities(repository, { max: fullWanted ? MAX_FULL_ACTIVITIES : 0 });
  const ready = storage.status === "connected" || repository.hasCloud;
  const fullLoading = fullActivities == null || (fullActivities.length === 0 && failedCount === 0 && summaries != null && summaries.length > 0);
  const fullLimit = summaries && summaries.length > MAX_FULL_ACTIVITIES ? MAX_FULL_ACTIVITIES : null;
  const goSection = (key) => { if (key === "zones" || key === "carte") setFullWanted(true); setSection(key); };

  const [sport, setSport] = useState("all");
  const [kind, setKind] = useState("week");
  const [metric, setMetric] = useState("distance");
  const [anchor, setAnchor] = useState(() => new Date());
  const [recapOpen, setRecapOpen] = useState(false);

  const all = summaries || [];
  const sports = useMemo(() => sportKeys(all), [all]);
  const activities = useMemo(() => filterBySport(all, sport), [all, sport]);

  const start = periodStart(kind, anchor);
  const prevStart = shiftPeriod(kind, start, -1);
  const isCurrent = start.getTime() === periodStart(kind, new Date()).getTime();
  const totals = useMemo(() => totalsForPeriod(activities, kind, start), [activities, kind, start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const previous = useMemo(() => totalsForPeriod(activities, kind, prevStart), [activities, kind, prevStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => buildSeries(activities, kind, start), [activities, kind, start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gpx-dashboard gpx-ds gpx-progress">
      <PageHead
        title="Progrès"
        meta={summaries ? <span>{summaries.length} sortie{summaries.length > 1 ? "s" : ""} analysée{summaries.length > 1 ? "s" : ""}</span> : ready ? <span>Chargement…</span> : null}
        actions={<button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={15} /> <span>Retour</span></button>}
      />
      <div className="gpx-statusline">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} />
      </div>

      {ready && summariesError && <div className="gpx-error-box" style={{ marginBottom: 14 }}>{summariesError}</div>}
      {ready && summaries == null && <div className="gpx-panel"><p className="gpx-empty-note">Chargement de ton historique…</p></div>}
      {ready && summaries && summaries.length === 0 && (
        <div className="gpx-panel">
          <p className="gpx-summary-text">Aucune sortie pour l'instant.</p>
          <p className="gpx-empty-note">Importe une sortie : tes stats par semaine, mois et année apparaîtront ici.</p>
        </div>
      )}

      {ready && summaries && summaries.length > 0 && (
        <div className="gpx-progress-sections" role="tablist" aria-label="Sections">
          {SECTIONS.map((x) => (
            <button key={x.key} role="tab" aria-selected={section === x.key} className={"gpx-progress-tab" + (section === x.key ? " active" : "")} onClick={() => goSection(x.key)}>{x.label}</button>
          ))}
        </div>
      )}

      {ready && summaries && summaries.length > 0 && section === "forme" && (
        <FitnessPanel activities={summaries} userSettings={userSettings} maxHR={maxHR} onOpen={onOpen ? (a) => onOpen(a.id) : undefined} />
      )}
      {ready && summaries && summaries.length > 0 && section === "zones" && (
        <ZonesPanel activities={fullActivities} loading={fullLoading} limit={fullLimit} userSettings={userSettings} maxHR={maxHR} />
      )}
      {ready && summaries && summaries.length > 0 && section === "carte" && (
        <HeatmapPanel activities={fullActivities} loading={fullLoading} limit={fullLimit} />
      )}

      {ready && summaries && summaries.length > 0 && section === "bilan" && (
        <>
          <div className="gpx-panel">
            <div className="gpx-progress-toolbar">
              <div className="gpx-map-modes" role="group" aria-label="Type de sortie">
                <button className={"gpx-chip" + (sport === "all" ? " gpx-chip-active" : "")} aria-pressed={sport === "all"} onClick={() => setSport("all")}>Toutes les sorties</button>
                {sports.length > 1 && sports.map((s) => (
                  <button key={s} className={"gpx-chip" + (sport === s ? " gpx-chip-active" : "")} aria-pressed={sport === s} onClick={() => setSport(s)}>{activityTypeLabel(s)}</button>
                ))}
              </div>
            </div>

            <div className="gpx-progress-periods" role="tablist" aria-label="Échelle de temps">
              {PERIOD_KINDS.map((p) => (
                <button key={p.key} role="tab" aria-selected={kind === p.key} className={"gpx-progress-tab" + (kind === p.key ? " active" : "")}
                  onClick={() => { setKind(p.key); setAnchor(new Date()); }}>{p.label}</button>
              ))}
            </div>

            <div className="gpx-progress-nav">
              <button className="gpx-icon-btn" aria-label="Période précédente" onClick={() => setAnchor(shiftPeriod(kind, start, -1))}><ChevronLeft size={18} /></button>
              <h2 className="gpx-progress-label">{periodLabel(kind, start)}</h2>
              <button className="gpx-icon-btn" aria-label="Période suivante" disabled={isCurrent} onClick={() => setAnchor(shiftPeriod(kind, start, 1))}><ChevronRight size={18} /></button>
            </div>

            <button className="gpx-btn-ghost gpx-progress-share" onClick={() => setRecapOpen(true)}>
              <Share2 size={15} aria-hidden="true" /> <span>Partager le récap</span>
            </button>

            <Headline kind={kind} start={start} totals={totals} previous={previous} />

            <div className="gpx-map-modes gpx-progress-metrics" role="group" aria-label="Métrique du graphique">
              {Object.entries(METRICS).map(([k, v]) => (
                <button key={k} className={"gpx-chip" + (metric === k ? " gpx-chip-active" : "")} aria-pressed={metric === k} onClick={() => setMetric(k)}>{v.label}</button>
              ))}
            </div>
            <p className="gpx-progress-sub">{series.length} dernières {kind === "week" ? "semaines" : kind === "month" ? "mois" : "années"} — touche un point pour le détail</p>
            <SeriesChart series={series} metric={metric} selectedStart={start} onSelect={setAnchor} />
          </div>

          {recapOpen && <RecapShareDialog activities={activities} kind={kind} start={start} sportLabel={sport === "all" ? null : activityTypeLabel(sport)} onClose={() => setRecapOpen(false)} />}
          <StreakCard activities={activities} />
          <MonthlyComparison activities={activities} metric={metric} setMetric={setMetric} />
        </>
      )}
    </div>
  );
}
