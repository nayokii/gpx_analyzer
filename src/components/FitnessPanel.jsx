/**
 * Forme / Fatigue / Fraîcheur et effort des dernières sorties. Calculs dans lib/progress/effort.js : l'effort vient
 * de la fréquence cardiaque quand elle existe, sinon il est ESTIMÉ (vitesse, dénivelé, poids) — l'écran le dit.
 */
import { useMemo, useState } from "react";
import { Activity, Info } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Area, Line, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";

import { SectionTitle } from "./UIPrimitives.jsx";
import { computeFitness, estimateEffort, effortLevel, isEstimatedSource } from "../lib/progress/effort.js";
import { COLORS, CHART_TOOLTIP_STYLE, CHART_AXIS } from "../lib/colors.js";
import { fmt1, fmtInt } from "../lib/utils.js";

const RANGES = [
  { key: 42, label: "6 semaines" },
  { key: 90, label: "3 mois" },
  { key: 180, label: "6 mois" },
];

const fmtDay = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");

function Gauge({ label, value, sub, accent }) {
  return (
    <div className="gpx-fit-gauge" style={{ "--fit-accent": accent }}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Array} props.activities - résumés d'index (date, distance, movingTime, avgHeartRate, avgPower…)
 * @param {Object} [props.userSettings] - { weight, bikeWeight, ftp }
 * @param {number} [props.maxHR]
 * @param {(a: Object) => void} [props.onOpen]
 */
export function FitnessPanel({ activities, userSettings, maxHR = 190, onOpen }) {
  const [range, setRange] = useState(90);
  const ftp = (userSettings && userSettings.ftp) || 250;
  const massKg = ((userSettings && userSettings.weight) || 75) + ((userSettings && userSettings.bikeWeight) || 8);
  const opts = useMemo(() => ({ ftp, maxHR, massKg }), [ftp, maxHR, massKg]);
  const fit = useMemo(() => computeFitness(activities, opts, { days: range }), [activities, opts, range]);
  const recent = useMemo(
    () => activities.slice(0, 8).map((a) => ({ a, e: estimateEffort(a, opts) })).filter((x) => x.e),
    [activities, opts]
  );

  if (!fit.current) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={Activity}>Forme</SectionTitle>
        <p className="gpx-empty-note">Pas assez de données : il faut des sorties avec durée, distance ou fréquence cardiaque.</p>
      </div>
    );
  }

  const data = fit.series.map((s) => ({ ...s, label: fmtDay(s.date), ctl: Math.round(s.ctl * 10) / 10, atl: Math.round(s.atl * 10) / 10, tsb: Math.round(s.tsb * 10) / 10 }));
  const maxScore = Math.max(...recent.map((r) => r.e.score), 1);
  const estPct = Math.round(fit.estimatedShare * 100);

  return (
    <>
      <div className="gpx-panel">
        <SectionTitle icon={Activity}>Forme, fatigue et fraîcheur</SectionTitle>
        <div className="gpx-fit-gauges">
          <Gauge label="Forme" value={fmtInt(fit.current.ctl)} sub="charge sur 6 semaines" accent={COLORS.speed} />
          <Gauge label="Fatigue" value={fmtInt(fit.current.atl)} sub="charge sur 7 jours" accent={COLORS.effort} />
          <Gauge label="Fraîcheur" value={(fit.current.tsb > 0 ? "+" : "") + fmtInt(fit.current.tsb)} sub={fit.status.label} accent={COLORS.climb} />
        </div>
        <p className="gpx-fit-status"><b>{fit.status.label}.</b> {fit.status.hint}</p>

        <div className="gpx-map-modes gpx-progress-metrics" role="group" aria-label="Période du graphique">
          {RANGES.map((r) => (
            <button key={r.key} className={"gpx-chip" + (range === r.key ? " gpx-chip-active" : "")} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </div>

        <div className="gpx-progress-chart" role="img" aria-label="Forme et fatigue au fil du temps">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="gpx-fit-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.speed} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={COLORS.speed} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--separator)" />
              <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={36} />
              <YAxis {...CHART_AXIS} width={40} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, name) => [fmt1(v), name]} />
              <Area type="monotone" dataKey="ctl" name="Forme" stroke={COLORS.speed} strokeWidth={2.5} fill="url(#gpx-fit-grad)" isAnimationActive={false} dot={false} />
              <Line type="monotone" dataKey="atl" name="Fatigue" stroke={COLORS.effort} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="gpx-progress-legend">
          <span><i style={{ background: COLORS.speed }} /> Forme</span>
          <span><i style={{ background: COLORS.effort }} /> Fatigue</span>
        </p>

        <p className="gpx-progress-sub">Fraîcheur (forme − fatigue) : au-dessus de 0, tu es reposé ; très en dessous, tu accumules de la fatigue.</p>
        <div className="gpx-progress-chart" role="img" aria-label="Fraîcheur au fil du temps">
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--separator)" />
              <XAxis dataKey="label" hide />
              <YAxis {...CHART_AXIS} width={40} />
              <ReferenceLine y={0} stroke="var(--faint)" />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [fmt1(v), "Fraîcheur"]} />
              <Area type="monotone" dataKey="tsb" name="Fraîcheur" stroke={COLORS.climb} strokeWidth={2} fill={COLORS.climb} fillOpacity={0.18} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {fit.calibrating && (
          <p className="gpx-fit-note" role="note"><Info size={14} aria-hidden="true" /> Moins de 6 semaines d'historique : la forme se construit encore, ses valeurs sont basses et peu fiables.</p>
        )}
        {estPct > 0 && (
          <p className="gpx-fit-note" role="note">
            <Info size={14} aria-hidden="true" />
            <span>
              {estPct >= 100 ? "Toutes tes sorties" : `${estPct} % de tes sorties`} ont un effort <b>estimé</b> (pas de fréquence cardiaque) à partir de la vitesse, du dénivelé et de ton poids, par rapport à un FTP de référence de {ftp} W.
              Les valeurs servent à comparer tes semaines entre elles ; elles ne valent pas une mesure.
            </span>
          </p>
        )}
      </div>

      <div className="gpx-panel">
        <SectionTitle icon={Activity}>Effort des dernières sorties</SectionTitle>
        <ul className="gpx-fit-rides">
          {recent.map(({ a, e }) => (
            <li key={a.id || a.date}>
              <button type="button" className="gpx-fit-ride" onClick={() => onOpen && onOpen(a)} disabled={!onOpen}>
                <span className="gpx-fit-ride-name">{a.name || "Sortie"}<small>{new Date(a.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {fmt1(a.distance)} km</small></span>
                <span className="gpx-fit-ride-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (e.score / maxScore) * 100)}%` }} /></span>
                <span className="gpx-fit-ride-score">{isEstimatedSource(e.source) ? "≈ " : ""}{e.score}<small>{effortLevel(e.score)}</small></span>
              </button>
            </li>
          ))}
        </ul>
        {recent.length === 0 && <p className="gpx-empty-note">Aucune sortie récente avec assez de données.</p>}
      </div>
    </>
  );
}
