/**
 * Panneaux du cockpit : affichage pur. Aucun calcul métier ici — les valeurs viennent de lib/cockpit/rideModel.js
 * (agrégats de l'Activity + série d'analyse) et des moteurs existants (progression, historique).
 *
 * Convention d'affichage commune :
 *  - une valeur absente s'écrit « — » avec la pastille N/D, jamais 0 ;
 *  - chaque valeur porte sa provenance en TEXTE (MES. / CALC. / EST. / N/D), pas seulement en couleur ;
 *  - l'Alter Ego (gamification) est étiqueté à part des mesures sportives.
 */
import { AlertTriangle, ArrowRight, Gauge, MapPin, Mountain, Route as RouteIcon, ScrollText, Sparkles, TrendingUp } from "lucide-react";

import { MapView } from "../MapView.jsx";
import { ProfileChart } from "../ProfileChart.jsx";
import { PROVENANCE_LABELS, PROVENANCE_SHORT } from "../../lib/cockpit/rideModel.js";
import { fmt1, fmtInt, fmtDuration, fmtDateFull } from "../../lib/utils.js";

/* ------------------------------------------------------------------ */
/* Briques communes                                                    */
/* ------------------------------------------------------------------ */

/** Cadre d'un panneau : titre (h2), méta et actions à droite. */
export function CockpitPanel({ id, title, icon: Icon, meta, className = "", children }) {
  return (
    <section className={"ck-panel " + className} aria-labelledby={id + "-title"}>
      <header className="ck-panel-head">
        <h2 className="ck-panel-title" id={id + "-title"}>
          {Icon && <Icon size={14} aria-hidden="true" />}
          <span>{title}</span>
        </h2>
        {meta && <div className="ck-panel-meta">{meta}</div>}
      </header>
      <div className="ck-panel-body">{children}</div>
    </section>
  );
}

/** Pastille de provenance : texte court visible + libellé complet pour les lecteurs d'écran. */
export function ProvenanceBadge({ provenance }) {
  return (
    <span className={"ck-prov ck-prov--" + provenance} title={PROVENANCE_LABELS[provenance]}>
      <span aria-hidden="true">{PROVENANCE_SHORT[provenance]}</span>
      <span className="ck-sr">{PROVENANCE_LABELS[provenance]}</span>
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <ul className="ck-legend" aria-label="Légende des provenances">
      {["measured", "calculated", "estimated", "unavailable"].map((p) => (
        <li key={p}><ProvenanceBadge provenance={p} /><span aria-hidden="true">{PROVENANCE_LABELS[p]}</span></li>
      ))}
    </ul>
  );
}

/** Message d'état (vide, indisponible, erreur) intégré au panneau. */
export function StateNote({ icon: Icon = AlertTriangle, tone = "neutral", title, children }) {
  return (
    <div className={"ck-state ck-state--" + tone} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        {title && <p className="ck-state-title">{title}</p>}
        {children && <p className="ck-state-text">{children}</p>}
      </div>
    </div>
  );
}

const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "date inconnue");

/** Date courte d'une sortie (« 20 sept. 2026 »), sans son nom : le nom n'apparaît qu'une fois, dans le panneau Parcours. */
export const rideDateLabel = (activity) => dateShort(activity.date);

export function rideOptionLabel(activity) {
  return `${dateShort(activity.date)} · ${activity.name || "Sortie vélo"}`;
}

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */

export function MapPanel({ activity, model, mapColorMode, setMapColorMode, selectedClimb, hoverIdx, setHoverIdx }) {
  let body;
  if (model.status === "ready") {
    body = (
      <MapView
        key={activity.id}
        analysis={model.analysis}
        colorMode={mapColorMode}
        setColorMode={setMapColorMode}
        selectedClimb={selectedClimb}
        height="clamp(280px, 46vh, 500px)"
        decimated={model.chartData}
        hoverIdx={hoverIdx}
        onHoverIndex={setHoverIdx}
        scrollWheelZoom={false}
        lockTouchPan
      />
    );
  } else if (model.status === "loading") {
    body = <StateNote icon={MapPin} title="Chargement du tracé…" />;
  } else if (model.status === "error") {
    body = <StateNote tone="error" title="Carte indisponible">Impossible d'analyser le tracé de cette sortie ({model.message}).</StateNote>;
  } else {
    body = <StateNote icon={MapPin} title="Aucune trace GPS exploitable">Cette sortie ne contient pas assez de points de position pour dessiner un parcours.</StateNote>;
  }
  return (
    <CockpitPanel id="ck-map" title="Carte du parcours" icon={MapPin} className="ck-map">
      {body}
    </CockpitPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Télémétrie : valeurs + graphique                                    */
/* ------------------------------------------------------------------ */

export function TelemetryPanel({ cells, scope, hasModel }) {
  return (
    <CockpitPanel
      id="ck-telemetry" title="Télémétrie" icon={Gauge} className="ck-telemetry"
      meta={<span className="ck-scope">{scope}</span>}
    >
      <dl className="ck-cells">
        {cells.map((c) => (
          <div className={"ck-cell" + (c.provenance === "unavailable" ? " is-unavailable" : "")} key={c.key}>
            <dt>{c.label}{c.qualifier && <small> {c.qualifier}</small>}</dt>
            <dd>
              <span className="ck-cell-value">{c.text}</span>
              {c.unit && c.value != null && <span className="ck-cell-unit">{c.unit}</span>}
              <ProvenanceBadge provenance={c.provenance} />
            </dd>
          </div>
        ))}
      </dl>
      {!hasModel && <p className="ck-hint">Pas de série point par point : seules les valeurs globales de la sortie sont affichées.</p>}
    </CockpitPanel>
  );
}

const SERIES_TABS = ["vitesse", "fc", "cadence", "puissance"];
const SERIES_CAPTIONS = {
  vitesse: "Vitesse instantanée (km/h), calculée à partir des positions et des horodatages",
  fc: "Fréquence cardiaque (bpm), mesurée par le capteur",
  cadence: "Cadence (rpm), mesurée par le capteur",
  puissance: "Puissance (W)",
};

/** Clés de métriques du graphique de séries réellement proposées pour cette analyse. */
export function availableSeriesMetrics(analysis) {
  const keys = [];
  if (analysis.hasTime) keys.push("vitesse");
  if (analysis.hasHR) keys.push("fc");
  if (analysis.hasCad) keys.push("cadence");
  if (analysis.hasPower) keys.push("puissance");
  return keys;
}

export function SeriesPanel({ model, metric, setMetric, hoverIdx, setHoverIdx, selectedClimb, onSelectClimb }) {
  const keys = model.status === "ready" ? availableSeriesMetrics(model.analysis) : [];
  let body;
  if (model.status === "loading") {
    body = <StateNote icon={TrendingUp} title="Chargement de la sortie…" />;
  } else if (model.status !== "ready") {
    body = <StateNote icon={TrendingUp} title="Graphiques indisponibles">Aucune série point par point exploitable pour cette sortie.</StateNote>;
  } else if (keys.length === 0) {
    body = <StateNote icon={TrendingUp} title="Aucune série à tracer">Ni horodatage, ni capteur de fréquence cardiaque, de cadence ou de puissance dans cette sortie.</StateNote>;
  } else {
    const active = keys.includes(metric) ? metric : keys[0];
    const estimatedPower = active === "puissance" && model.analysis.isEstimatedPower;
    body = (
      <>
        <ProfileChart
          analysis={model.analysis}
          decimated={model.chartData}
          metric={active}
          setMetric={setMetric}
          hoverIdx={hoverIdx}
          setHoverIdx={setHoverIdx}
          selectedClimb={selectedClimb}
          onSelectClimb={onSelectClimb}
          height={220}
          allowedMetrics={SERIES_TABS}
          axes="full"
          powerLabel={model.analysis.isEstimatedPower ? "Puissance (estimée)" : "Puissance"}
        />
        <p className="ck-axis-caption">
          Axe horizontal : distance (km) · {SERIES_CAPTIONS[active]}{estimatedPower ? " — estimée par le modèle physique, pas mesurée" : active === "puissance" ? " — mesurée" : ""}
        </p>
      </>
    );
  }
  return <CockpitPanel id="ck-series" title="Séries de la sortie" icon={TrendingUp} className="ck-series">{body}</CockpitPanel>;
}

/* ------------------------------------------------------------------ */
/* Profil d'altitude                                                   */
/* ------------------------------------------------------------------ */

export function ElevationPanel({ model, hoverIdx, setHoverIdx, selectedClimb, onSelectClimb }) {
  let body;
  if (model.status === "loading") {
    body = <StateNote icon={Mountain} title="Chargement de la sortie…" />;
  } else if (model.status !== "ready") {
    body = <StateNote icon={Mountain} title="Profil indisponible">Aucune trace exploitable pour tracer un profil.</StateNote>;
  } else if (!model.elevation.usable) {
    body = model.elevation.reason === "flat" ? (
      <StateNote icon={Mountain} title="Altitude quasi constante">L'amplitude d'altitude est trop faible pour tracer un profil exploitable.</StateNote>
    ) : (
      <StateNote icon={Mountain} title="Altitude absente">Ce fichier ne contient pas de données d'altitude : aucun profil n'est affiché.</StateNote>
    );
  } else {
    const { climbs } = model.analysis;
    body = (
      <>
        <ProfileChart
          analysis={model.analysis}
          decimated={model.chartData}
          metric="altitude"
          setMetric={() => {}}
          hoverIdx={hoverIdx}
          setHoverIdx={setHoverIdx}
          selectedClimb={selectedClimb}
          onSelectClimb={onSelectClimb}
          height={210}
          showMetricTabs={false}
          allowedMetrics={["altitude"]}
          axes="full"
          powerLabel={model.analysis.isEstimatedPower ? "Puissance (estimée)" : "Puissance"}
          label="Profil d'altitude en fonction de la distance. Flèches gauche et droite pour déplacer le repère sur la carte."
        />
        <p className="ck-axis-caption">
          Axe horizontal : distance (km) · axe vertical : altitude (m), mesurée et lissée · zones rosées : montées détectées
          {model.source === "samples" && " · altitude relissée depuis les échantillons enregistrés : les montées peuvent différer légèrement de l'analyse détaillée"}
        </p>
        {climbs.length > 0 && (
          <ul className="ck-climbs" aria-label="Montées détectées">
            {climbs.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={"ck-climb" + (selectedClimb && selectedClimb.id === c.id ? " is-selected" : "")}
                  aria-pressed={!!(selectedClimb && selectedClimb.id === c.id)}
                  onClick={() => onSelectClimb(selectedClimb && selectedClimb.id === c.id ? null : c)}
                >
                  <b>{c.name}</b>
                  <span>km {fmt1(c.startDistance)}</span>
                  <span>{fmt1(c.lengthKm)} km</span>
                  <span>+{fmtInt(c.gain)} m</span>
                  <span>{fmt1(c.avgGrade)} % moy. · {fmt1(c.maxGrade)} % max</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  return <CockpitPanel id="ck-elevation" title="Profil d'altitude" icon={Mountain} className="ck-elevation">{body}</CockpitPanel>;
}

/* ------------------------------------------------------------------ */
/* Résumé de la sortie                                                 */
/* ------------------------------------------------------------------ */

export function SummaryPanel({ rows }) {
  return (
    <CockpitPanel id="ck-summary" title="Résumé de la sortie" icon={ScrollText} className="ck-summary">
      <dl className="ck-rows">
        {rows.map((r) => (
          <div className={"ck-row" + (r.provenance === "unavailable" ? " is-unavailable" : "")} key={r.key}>
            <dt>{r.label}{r.note && <small> ({r.note})</small>}</dt>
            <dd>
              <span className="ck-row-value">{r.text}</span>
              {r.unit && r.value != null && <span className="ck-cell-unit">{r.unit}</span>}
              <ProvenanceBadge provenance={r.provenance} />
            </dd>
          </div>
        ))}
      </dl>
    </CockpitPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Parcours                                                            */
/* ------------------------------------------------------------------ */

export function RoutePanel({ activity, model, onOpen }) {
  const climbs = model.status === "ready" ? model.analysis.climbs : [];
  // Jamais « Durée » ambiguë : le temps en mouvement et le temps écoulé sont deux métriques distinctes.
  const hasMoving = activity.movingTime != null;
  const duration = hasMoving ? activity.movingTime : activity.duration;
  return (
    <CockpitPanel id="ck-route" title="Parcours" icon={RouteIcon} className="ck-route">
      <div className="ck-route-name">{activity.name || "Sortie vélo"}</div>
      <div className="ck-route-date">{activity.date ? fmtDateFull(new Date(activity.date)) : "Date inconnue"}</div>
      <dl className="ck-route-stats">
        <div><dt>Distance</dt><dd>{fmt1(activity.distance)}<small>km</small></dd></div>
        {activity.elevationGain != null && <div><dt>Dénivelé +</dt><dd>+{fmtInt(activity.elevationGain)}<small>m</small></dd></div>}
        {duration != null && <div><dt>{hasMoving ? "En mouvement" : "Durée écoulée"}</dt><dd>{fmtDuration(duration)}</dd></div>}
      </dl>
      {model.status !== "ready" ? null : !model.elevation.usable ? (
        <p className="ck-hint">Montées non détectables : l'altitude de cette sortie est absente ou inexploitable.</p>
      ) : climbs.length > 0 ? (
        <p className="ck-hint">{climbs.length} montée{climbs.length > 1 ? "s" : ""} détectée{climbs.length > 1 ? "s" : ""} sur ce tracé — voir le profil d'altitude.</p>
      ) : (
        <p className="ck-hint">Aucune montée significative détectée sur ce tracé.</p>
      )}
      {onOpen && (
        <button type="button" className="gpx-btn-primary ck-route-cta" onClick={onOpen}>
          Voir l'analyse <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </CockpitPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Alter Ego : historique de progression (gamification)                 */
/* ------------------------------------------------------------------ */

const XP_TYPE_LABELS = {
  activity_completed: "Sortie enregistrée",
  distance_milestone: "Palier de distance",
  elevation_milestone: "Palier de dénivelé",
  duration_milestone: "Palier de durée",
  new_best: "Nouveau record",
  capability_first: "Première fois",
  weekly_streak_milestone: "Régularité",
  challenge_completed: "Challenge réussi",
};

export function ProgressionHistoryPanel({ progression }) {
  const events = progression.recentEvents || [];
  const unlocked = (progression.achievements || []).filter((a) => a.unlocked);
  return (
    <CockpitPanel
      id="ck-xp" title="Progression Alter Ego" icon={Sparkles} className="ck-xp"
      meta={<span className="ck-scope ck-scope--game">Gamification · hors mesures</span>}
    >
      <div className="ck-xp-grid">
        <div>
          <h3 className="ck-subtitle">Derniers gains d'XP</h3>
          {events.length === 0 ? (
            <p className="ck-hint">Aucun gain d'XP enregistré pour l'instant.</p>
          ) : (
            <ul className="ck-xp-list">
              {events.map((e, i) => (
                <li key={i}>
                  <span className="ck-xp-gain">+{e.xp} XP</span>
                  <span className="ck-xp-reason">{XP_TYPE_LABELS[e.type] || e.type}{e.reason ? ` — ${e.reason}` : ""}</span>
                  <span className="ck-xp-date">{e.date ? dateShort(e.date) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="ck-subtitle">Succès débloqués ({unlocked.length} / {(progression.achievements || []).length})</h3>
          {unlocked.length === 0 ? (
            <p className="ck-hint">Aucun succès débloqué pour l'instant.</p>
          ) : (
            <ul className="ck-badges">
              {unlocked.map((a) => <li key={a.id} title={a.description}>{a.label}</li>)}
            </ul>
          )}
        </div>
      </div>
    </CockpitPanel>
  );
}

/** Bandeau « données partielles » : signaux absents de la sortie sélectionnée. */
export function PartialDataBanner({ missing }) {
  if (!missing || missing.length === 0) return null;
  return (
    <div className="ck-banner" role="status">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>Données partielles : {missing.join(", ")} non enregistrée{missing.length > 1 ? "s" : ""} dans cette sortie — les valeurs correspondantes sont marquées indisponibles, jamais remplacées par 0.</span>
    </div>
  );
}
