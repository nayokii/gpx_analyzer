/**
 * Cockpit de performance : orchestre les panneaux autour de LA sortie sélectionnée.
 *
 * Source de vérité : les `Activity` complètes déjà chargées par HomeView (jamais de rechargement ici, jamais de
 * fichier reparsé). Le modèle de la sortie (analyse, série décimée, D+ cumulé) est recalculé uniquement quand la
 * sélection ou les paramètres de puissance changent (useMemo), pas à chaque survol du curseur.
 *
 * État partagé entre carte et graphiques : `hoverIdx` (indice dans `model.chartData`, que MapView et ProfileChart
 * lisent tous deux) et `selectedClimb` — c'est ce qui synchronise le repère du profil avec la position sur la carte.
 */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Layers } from "lucide-react";

import { computeHRZones } from "../../lib/analysis.js";
import { computeRecords } from "../../lib/history/records.js";
import { findSimilarActivities } from "../../lib/history/similarity.js";
import { compareActivities } from "../../lib/history/comparisons.js";
import {
  buildRideModel, buildSummaryRows, buildTelemetryCells, missingSignals, zoneShares,
} from "../../lib/cockpit/rideModel.js";
import { loadRideInputs } from "../../lib/cockpit/rideSource.js";
import { fmt1, fmtInt, fmtDuration } from "../../lib/utils.js";
import {
  CockpitPanel, MapPanel, TelemetryPanel, SeriesPanel, ElevationPanel, SummaryPanel, RoutePanel,
  PartialDataBanner, ProvenanceBadge, StateNote, rideOptionLabel,
} from "./CockpitPanels.jsx";

/* ------------------------------------------------------------------ */
/* Analyse de la sortie (panneau compact à onglets)                     */
/* ------------------------------------------------------------------ */

const ANALYSIS_TABS = [
  { key: "zones", label: "Zones FC" },
  { key: "efforts", label: "Meilleurs efforts" },
  { key: "records", label: "Records" },
  { key: "compare", label: "Comparaison" },
];

const RECORD_LABELS = {
  longest_distance: { label: "Plus longue distance", unit: "km", format: fmt1 },
  biggest_elevation_gain: { label: "Plus gros dénivelé +", unit: "m", format: fmtInt },
  longest_duration: { label: "Plus longue durée", unit: "", format: fmtDuration },
  highest_avg_power_measured: { label: "Puissance moy. mesurée max", unit: "W", format: fmtInt },
};

const EFFORT_KEYS = [["k1", "1 km"], ["k5", "5 km"], ["k10", "10 km"], ["k20", "20 km"]];

function ZonesTab({ model, maxHR, hrZones }) {
  const shares = useMemo(() => {
    if (model.status !== "ready" || !maxHR || !hrZones) return null;
    return zoneShares(computeHRZones(model.analysis, maxHR, hrZones));
  }, [model, maxHR, hrZones]);

  if (model.status === "loading") return <StateNote title="Chargement de la sortie…" />;
  if (model.status !== "ready") return <StateNote title="Zones indisponibles">Aucune série point par point pour cette sortie.</StateNote>;
  if (!model.analysis.hasHR) return <StateNote title="Fréquence cardiaque non enregistrée">Sans capteur de FC, aucune zone n'est calculée.</StateNote>;
  if (!model.analysis.hasTime) return <StateNote title="Horodatage absent">Le temps passé par zone ne peut pas être calculé sans horodatage.</StateNote>;
  if (!maxHR || !hrZones) return <StateNote title="FC max non configurée">Renseigne ta FC max pour calculer les zones.</StateNote>;
  if (!shares) return <StateNote title="Temps par zone indisponible">Aucun échantillon de FC exploitable.</StateNote>;

  return (
    <>
      <ul className="ck-zones">
        {shares.map((z) => (
          <li key={z.name}>
            <span className="ck-zone-name">{z.name}</span>
            <span className="ck-zone-range">{z.min}–{z.max >= 999 ? "max" : z.max} %</span>
            <span className="ck-zone-bar" role="img" aria-label={`${z.name} : ${Math.round(z.share * 100)} % du temps`}>
              <span style={{ width: `${Math.max(0, Math.min(100, z.share * 100))}%` }} />
            </span>
            <span className="ck-zone-time">{fmtDuration(z.time)}</span>
            <span className="ck-zone-pct">{Math.round(z.share * 100)} %</span>
          </li>
        ))}
      </ul>
      <p className="ck-hint">FC max de référence : {maxHR} bpm — valeur par défaut de l'application tant qu'elle n'est pas ajustée dans l'analyse détaillée d'une sortie.</p>
    </>
  );
}

function EffortsTab({ model }) {
  if (model.status === "loading") return <StateNote title="Chargement de la sortie…" />;
  if (model.status !== "ready") return <StateNote title="Efforts indisponibles">Aucune série point par point pour cette sortie.</StateNote>;
  const efforts = model.analysis.bestEfforts;
  if (!efforts) return <StateNote title="Horodatage absent">Les meilleurs efforts nécessitent des horodatages.</StateNote>;
  const rows = EFFORT_KEYS.filter(([k]) => efforts[k]);
  if (rows.length === 0) return <StateNote title="Sortie trop courte">Aucune distance de référence (1 km et plus) n'est couverte par cette sortie.</StateNote>;
  return (
    <>
      <table className="ck-table">
        <caption className="ck-sr">Meilleurs efforts sur distance glissante</caption>
        <thead><tr><th scope="col">Distance</th><th scope="col">Temps</th><th scope="col">Vitesse moy.</th><th scope="col">Départ au km</th></tr></thead>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}>
              <th scope="row">{label}</th>
              <td>{fmtDuration(efforts[k].duration)}</td>
              <td>{fmt1(efforts[k].avgSpeed)} km/h</td>
              <td>{fmt1(efforts[k].startDistance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ck-hint">Meilleurs passages sur cette sortie uniquement, <ProvenanceBadge provenance="calculated" /> à partir des positions et horodatages.</p>
    </>
  );
}

function RecordsTab({ activities, activity }) {
  const records = useMemo(() => computeRecords(activities), [activities]);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  if (records.length === 0) return <StateNote title="Aucun record">L'historique ne contient pas encore de quoi établir des records.</StateNote>;
  return (
    <>
      <ul className="ck-records">
        {records.map((r) => {
          const meta = RECORD_LABELS[r.type];
          if (!meta) return null;
          const holder = byId.get(r.activityId);
          return (
            <li key={r.type}>
              <span className="ck-record-label">{meta.label}</span>
              <span className="ck-record-value">{meta.format(r.value)}{meta.unit && <small>{meta.unit}</small>}</span>
              <span className="ck-record-holder">
                {r.activityId === activity.id ? <b className="ck-here">Cette sortie</b> : holder && holder.date ? new Date(holder.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ck-hint">Calculés sur {activities.length} sortie{activities.length > 1 ? "s" : ""} chargée{activities.length > 1 ? "s" : ""}. La puissance n'entre dans les records que si elle est mesurée.</p>
    </>
  );
}

function deltaText(delta, digits, unit) {
  if (delta == null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  return `${sign}${digits === 0 ? fmtInt(abs) : fmt1(abs)} ${unit}`.trim();
}

function CompareTab({ activities, activity }) {
  const rows = useMemo(
    () => findSimilarActivities(activity, activities, { limit: 3 }).map(({ activity: other }) => ({
      other, cmp: compareActivities(activity, other),
    })),
    [activities, activity]
  );
  if (rows.length === 0) {
    return <StateNote title="Aucune sortie comparable">Aucune autre sortie de distance, dénivelé et allure proches dans l'historique.</StateNote>;
  }
  return (
    <>
      <table className="ck-table">
        <caption className="ck-sr">Sorties similaires comparées à la sortie sélectionnée</caption>
        <thead><tr><th scope="col">Sortie similaire</th><th scope="col">Distance</th><th scope="col">Vitesse moy.</th><th scope="col">Durée</th></tr></thead>
        <tbody>
          {rows.map(({ other, cmp }) => (
            <tr key={other.id}>
              <th scope="row">{rideOptionLabel(other)}</th>
              <td>{fmt1(other.distance)} km <small>({deltaText(cmp.general.distanceKm.available ? -cmp.general.distanceKm.deltaAbs : null, 1, "km")})</small></td>
              <td>{other.avgSpeed != null ? `${fmt1(other.avgSpeed)} km/h` : "—"} <small>({deltaText(cmp.performance.avgSpeedKmh.available ? -cmp.performance.avgSpeedKmh.deltaAbs : null, 1, "km/h")})</small></td>
              <td>{fmtDuration(other.movingTime ?? other.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ck-hint">Écarts exprimés de la sortie sélectionnée par rapport à la sortie similaire (+ = plus élevé aujourd'hui). La similarité est un critère de tri interne, pas un score de performance.</p>
    </>
  );
}

function AnalysisPanel({ model, activity, activities, maxHR, hrZones }) {
  const [tab, setTab] = useState("zones");
  return (
    <CockpitPanel id="ck-analysis" title="Analyse de la sortie" icon={BarChart3} className="ck-analysis">
      <div className="ck-tabs" role="tablist" aria-label="Analyses de la sortie">
        {ANALYSIS_TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" id={"ck-tab-" + t.key}
            aria-selected={tab === t.key} aria-controls={"ck-tabpanel-" + t.key} tabIndex={tab === t.key ? 0 : -1}
            className={"ck-tab" + (tab === t.key ? " is-active" : "")}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const i = ANALYSIS_TABS.findIndex((x) => x.key === tab);
              if (e.key === "ArrowRight") { e.preventDefault(); setTab(ANALYSIS_TABS[(i + 1) % ANALYSIS_TABS.length].key); }
              if (e.key === "ArrowLeft") { e.preventDefault(); setTab(ANALYSIS_TABS[(i + ANALYSIS_TABS.length - 1) % ANALYSIS_TABS.length].key); }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={"ck-tabpanel-" + tab} aria-labelledby={"ck-tab-" + tab} className="ck-tabpanel">
        {tab === "zones" && <ZonesTab model={model} maxHR={maxHR} hrZones={hrZones} />}
        {tab === "efforts" && <EffortsTab model={model} />}
        {tab === "records" && <RecordsTab activities={activities} activity={activity} />}
        {tab === "compare" && <CompareTab activities={activities} activity={activity} />}
      </div>
    </CockpitPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} props
 * @param {Array} props.activities - Activity complètes (avec `samples`), la plus récente en premier
 * @param {Object|null} props.userSettings - paramètres de puissance (voir computeAnalysis)
 * @param {number} [props.maxHR] - FC max de référence de l'app (zones)
 * @param {Array} [props.hrZones] - bornes de zones de FC de l'app
 * @param {Function} [props.onOpenActivity] - (id) => void : détail existant de la sortie
 * @param {Object|null} [props.rootHandle] - dossier de stockage local : la sortie sélectionnée est alors reparsée depuis son
 *   fichier source (même analyse que l'écran détaillé) ; sans lui, repli sur les `samples` enregistrés
 */
export function CockpitDashboard({ activities, userSettings, maxHR, hrZones, onOpenActivity, rootHandle = null }) {
  const [selectedId, setSelectedId] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [selectedClimb, setSelectedClimb] = useState(null);
  const [mapColorMode, setMapColorMode] = useState("track");
  const [seriesMetric, setSeriesMetric] = useState("vitesse");

  const activity = activities.find((a) => a.id === selectedId) || activities[0];
  // Entrées d'analyse de la sortie affichée (lecture du fichier source). `inputs.id` évite tout mélange : tant que la sortie
  // sélectionnée n'est pas celle qui a été chargée, on affiche « chargement », jamais les données de la précédente.
  const [inputs, setInputs] = useState(null);
  useEffect(() => {
    if (!rootHandle) return undefined;
    let cancelled = false;
    // Une lecture qui échoue ne doit jamais laisser « chargement » indéfiniment : repli sur les `samples` enregistrés.
    loadRideInputs(rootHandle, activity)
      .catch(() => loadRideInputs(null, activity))
      .then((loaded) => { if (!cancelled) setInputs({ id: activity.id, ...loaded }); });
    return () => { cancelled = true; };
  }, [rootHandle, activity]);
  const loading = !!rootHandle && !(inputs && inputs.id === activity.id);
  const model = useMemo(
    () => (loading ? { status: "loading" } : buildRideModel(activity, userSettings, rootHandle ? inputs : null)),
    [loading, activity, userSettings, rootHandle, inputs]
  );
  const point = model.status === "ready" && hoverIdx != null ? model.chartData[hoverIdx] || null : null;
  const cells = useMemo(() => buildTelemetryCells(activity, model.status === "ready" ? model : null, point), [activity, model, point]);
  const summaryRows = useMemo(() => buildSummaryRows(activity), [activity]);
  const missing = useMemo(() => missingSignals(activity), [activity]);

  function selectRide(id) {
    // Les indices de survol et la montée choisie n'ont de sens que pour la sortie affichée.
    setSelectedId(id);
    setHoverIdx(null);
    setSelectedClimb(null);
    setMapColorMode("track");
  }

  const scope = point ? `Au km ${fmt1(point.distance)} · valeurs instantanées` : "Moyennes de la sortie · survole le tracé ou le profil";

  return (
    <div className="ck-ride">
      <div className="ck-ride-bar">
        {activities.length > 1 ? (
          <label className="ck-select">
            <span><Layers size={13} aria-hidden="true" /> Sortie affichée</span>
            <select value={activity.id} onChange={(e) => selectRide(e.target.value)} aria-label="Sortie affichée dans le cockpit">
              {activities.map((a) => <option key={a.id} value={a.id}>{rideOptionLabel(a)}</option>)}
            </select>
          </label>
        ) : <span className="ck-scope">Sortie affichée : la seule enregistrée</span>}
      </div>

      <PartialDataBanner missing={missing} />

      <div className="ck-grid">
        <MapPanel
          activity={activity} model={model} mapColorMode={mapColorMode} setMapColorMode={setMapColorMode}
          selectedClimb={selectedClimb} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx}
        />
        <TelemetryPanel cells={cells} scope={scope} hasModel={model.status === "ready" || loading} />
        <ElevationPanel model={model} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} selectedClimb={selectedClimb} onSelectClimb={setSelectedClimb} />
        <SummaryPanel rows={summaryRows} />
        <SeriesPanel
          model={model} metric={seriesMetric} setMetric={setSeriesMetric}
          hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} selectedClimb={selectedClimb} onSelectClimb={setSelectedClimb}
        />
        <RoutePanel activity={activity} model={model} onOpen={onOpenActivity ? () => onOpenActivity(activity.id) : undefined} />
        <AnalysisPanel model={model} activity={activity} activities={activities} maxHR={maxHR} hrZones={hrZones} />
      </div>
    </div>
  );
}
