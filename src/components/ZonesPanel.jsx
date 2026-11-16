/**
 * Zones d'intensité agrégées : répartition du temps sur les 12 dernières semaines et diagramme empilé par semaine.
 * Source : fréquence cardiaque mesurée, ou — sans capteur — puissance ESTIMÉE (indiqué). Lit les échantillons des
 * sorties complètes (les plus récentes, plafonnées par l'appelant).
 */
import { useMemo } from "react";
import { Gauge, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

import { SectionTitle } from "./UIPrimitives.jsx";
import { ZONES, zonesForActivities, zoneTotals, zoneSeries, intensityBalance } from "../lib/progress/zones.js";
import { periodStart, shiftPeriod } from "../lib/progress/progress.js";
import { CHART_TOOLTIP_STYLE, CHART_AXIS } from "../lib/colors.js";
import { fmtInt } from "../lib/utils.js";

const WEEKS = 12;
const hm = (sec) => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };

/**
 * @param {Object} props
 * @param {Array|null} props.activities - sorties complètes (samples), null pendant le chargement
 * @param {boolean} props.loading
 * @param {number} props.limit - nombre maximal de sorties chargées (pour l'avertir)
 */
export function ZonesPanel({ activities, loading, limit, userSettings, maxHR = 190 }) {
  const ftp = (userSettings && userSettings.ftp) || 250;
  const entries = useMemo(() => (activities ? zonesForActivities(activities, { maxHR, ftp }) : []), [activities, maxHR, ftp]);
  const start = periodStart("week", new Date());
  const from = shiftPeriod("week", start, -(WEEKS - 1));
  const totals = useMemo(() => zoneTotals(entries, from, null), [entries, from.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => zoneSeries(entries, "week", start, WEEKS), [entries, start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const balance = useMemo(() => intensityBalance(totals), [totals]);

  if (loading) return <div className="gpx-panel"><p className="gpx-empty-note">Analyse de tes sorties…</p></div>;
  if (!totals.count) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={Gauge}>Zones d'intensité</SectionTitle>
        <p className="gpx-summary-text">Aucune sortie exploitable sur les {WEEKS} dernières semaines.</p>
        <p className="gpx-empty-note">Il faut des sorties avec fréquence cardiaque, ou une puissance estimée (altitude et horodatage présents).</p>
      </div>
    );
  }
  const estPct = Math.round(totals.estimatedShare * 100);
  const data = series.map((s) => ({ ...s }));

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Gauge}>Zones d'intensité</SectionTitle>
      <p className="gpx-progress-sub">{WEEKS} dernières semaines · {totals.count} sortie{totals.count > 1 ? "s" : ""} · {hm(totals.total)} analysées</p>

      <div className="gpx-zones-bar" role="img" aria-label="Répartition du temps par zone">
        {ZONES.map((z, i) => totals.percent[i] > 0 && <i key={z.key} style={{ width: `${totals.percent[i]}%`, background: z.color }} title={`${z.name} : ${Math.round(totals.percent[i])} %`} />)}
      </div>
      <ul className="gpx-zones-legend">
        {ZONES.map((z, i) => (
          <li key={z.key}><i style={{ background: z.color }} /><span>{z.name}</span><b>{fmtInt(totals.percent[i])} %</b><small>{hm(totals.seconds[i])}</small></li>
        ))}
      </ul>

      {balance && <p className="gpx-fit-status">{balance.text}</p>}

      <p className="gpx-progress-sub">Heures par zone et par semaine</p>
      <div className="gpx-progress-chart" role="img" aria-label="Temps par zone et par semaine">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--separator)" />
            <XAxis dataKey="shortLabel" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...CHART_AXIS} width={40} tickFormatter={(v) => `${Math.round(v / 60)} h`} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--surface2)" }} formatter={(v, name) => [hm(v * 60), name]} labelFormatter={(_, p) => (p && p[0] ? p[0].payload.label : "")} />
            {ZONES.map((z) => <Bar key={z.key} dataKey={z.key} name={z.name} stackId="z" fill={z.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {estPct > 0 && (
        <p className="gpx-fit-note" role="note">
          <Info size={14} aria-hidden="true" />
          <span>{estPct >= 100 ? "Toutes ces sorties n'ont" : `${estPct} % de ces sorties n'ont`} pas de fréquence cardiaque : leurs zones sont <b>estimées</b> à partir de la puissance calculée par l'app (vitesse, pente, poids) par rapport à un FTP de {ftp} W.</span>
        </p>
      )}
      {limit && <p className="gpx-progress-sub">Analyse limitée aux {limit} sorties les plus récentes.</p>}
    </div>
  );
}
