/**
 * VUE ANALYTIQUE — affiche le résultat de computeActivityAnalytics()
 * (src/lib/analytics/analytics.js). Ce composant ne recalcule jamais aucune
 * métrique : il lit uniquement l'objet `analytics` déjà produit par le
 * moteur, plus `analysis` pour réutiliser le profil existant (ProfileChart)
 * et faire correspondre une carte de montée à son entrée dans
 * `analysis.climbs` (pour la synchronisation carte/profil déjà en place).
 *
 * Règle d'affichage stricte (voir types.js / analytics.js) : une donnée
 * indisponible se traduit par un état vide explicite, jamais par un 0 ou un
 * champ masqué en silence. Une valeur mesurée par le device et une valeur
 * recalculée/estimée par notre moteur ne sont jamais présentées de façon à
 * paraître équivalentes.
 */

import {
  Route, Clock, Timer, Gauge, Zap, TrendingUp, Mountain, Thermometer,
  Heart, RefreshCw, PauseCircle, Flame,
} from "lucide-react";
import { StatCard, SectionTitle } from "./UIPrimitives.jsx";
import { ProfileChart } from "./ProfileChart.jsx";
import { COLORS } from "../lib/colors.js";
import { fmt1, fmtInt, fmtDuration, fmtDurationLong, fmtClock } from "../lib/utils.js";

// Mêmes palettes que les zones déjà affichées ailleurs dans l'app (power.js /
// DEFAULT_HR_ZONES dans GPXAnalyzer.jsx) — dupliquées ici car ce sont des
// tokens de présentation, pas des données : le moteur (zones.js) ne les
// porte volontairement pas.
const POWER_ZONE_COLORS = ["#4dd9c0", "#8fd66a", "#f4b740", "#e8834a", "#e8543a", "#c22b1c", "#8b1a1a"];
const HR_ZONE_COLORS = ["#4dd9c0", "#8fd66a", "#f4b740", "#e8834a", "#e8543a"];

/** Petit badge "Mesuré"/"Estimé" — ne jamais laisser croire que les deux sont équivalents. */
function SourceBadge({ source }) {
  if (source === "measured") return <span className="gpx-power-source">Mesuré</span>;
  if (source === "estimated") return <span className="gpx-power-source-estimated">Estimé</span>;
  return null;
}

function OverviewSection({ analytics }) {
  const { overview, speed, elevation, temperature } = analytics;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Route}>Vue d'ensemble</SectionTitle>
      <div className="gpx-stats-grid">
        <StatCard
          icon={Route} label="Distance" value={fmt1(overview.distance.calculatedKm)} unit="km" accent={COLORS.speed}
          sub={overview.distance.measuredKm != null ? `Mesurée : ${fmt1(overview.distance.measuredKm)} km` : null}
        />
        <StatCard icon={Clock} label="Durée totale" value={fmtDuration(overview.duration.totalSec)} accent={COLORS.info} />
        <StatCard icon={Timer} label="Temps en mouvement" value={fmtDuration(overview.duration.movingSec)} accent={COLORS.info} />
        <StatCard
          icon={Gauge} label="Vitesse moyenne" value={fmt1(speed.avgTotalKmh)} unit="km/h" accent={COLORS.speed}
          sub={speed.avgMeasuredKmh != null ? `Mesurée : ${fmt1(speed.avgMeasuredKmh)} km/h` : null}
        />
        <StatCard icon={Gauge} label="Vit. moy. en mouvement" value={fmt1(speed.avgMovingKmh)} unit="km/h" accent={COLORS.speed} />
        <StatCard
          icon={Zap} label="Vitesse maximale" value={fmt1(speed.maxKmh)} unit="km/h" accent={COLORS.speed}
          sub={speed.maxMeasuredKmh != null ? `Mesurée : ${fmt1(speed.maxMeasuredKmh)} km/h` : null}
        />
        {elevation.available && <StatCard icon={TrendingUp} label="Dénivelé positif" value={"+" + fmtInt(elevation.gainM)} unit="m" accent={COLORS.climb} />}
        {elevation.available && <StatCard icon={TrendingUp} label="Dénivelé négatif" value={"-" + fmtInt(elevation.lossM)} unit="m" accent={COLORS.climb} />}
        {elevation.available && <StatCard icon={Mountain} label="Altitude maximale" value={fmtInt(elevation.maxM)} unit="m" accent={COLORS.climb} />}
        {temperature.available && <StatCard icon={Thermometer} label="Température moyenne" value={fmt1(temperature.avgC)} unit="°C" accent={COLORS.info} />}
      </div>
    </div>
  );
}

function PowerSection({ analytics }) {
  const { power } = analytics;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Zap} right={power.available ? <SourceBadge source={power.source} /> : null}>Puissance</SectionTitle>
      {!power.available ? (
        <p className="gpx-empty-note">Aucune donnée de puissance exploitable sur cette sortie.</p>
      ) : (
        <div className="gpx-chart-card-stats">
          <span>Moyenne <b>{fmtInt(power.avgW)} W</b></span>
          <span>Max <b>{fmtInt(power.maxW)} W</b></span>
          {power.normalizedW != null && <span>Puissance normalisée <b>{fmtInt(power.normalizedW)} W</b></span>}
        </div>
      )}
    </div>
  );
}

function ZonesSection({ analytics }) {
  const p = analytics.zones.power;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Gauge} right={p.available ? <SourceBadge source={p.source} /> : null}>Zones de puissance</SectionTitle>
      {!p.available ? (
        <p className="gpx-empty-note">Zones de puissance indisponibles (FTP non renseignée dans Paramètres, ou aucune puissance sur cette sortie).</p>
      ) : (
        <div className="gpx-zone-bar-wrap">
          {p.zones.map((z, i) => {
            const wMin = z.min === 0 ? 0 : Math.round(z.min * p.ftp);
            const wMax = z.max >= 999 ? "∞" : Math.round(z.max * p.ftp);
            return (
              <div className="gpx-power-zone-row" key={z.name}>
                <div className="gpx-power-zone-name">{z.name}</div>
                <div className="gpx-power-zone-watts">{wMin === wMax ? `${wMin} W` : `${wMin}–${wMax} W`}</div>
                <div className="gpx-zone-track"><div className="gpx-zone-fill" style={{ width: `${z.percentage || 0}%`, background: POWER_ZONE_COLORS[i] }} /></div>
                <div className="gpx-power-zone-time">{fmtDuration(z.seconds)}</div>
                <div className="gpx-power-zone-pct">{z.percentage != null ? z.percentage.toFixed(1) : "0.0"} %</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeartRateSection({ analytics }) {
  const { heartRate } = analytics;
  const z = analytics.zones.heartRate;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Heart}>Fréquence cardiaque</SectionTitle>
      {!heartRate.available ? (
        <p className="gpx-empty-note">Pas de données cardiaques sur cette sortie.</p>
      ) : (
        <>
          <div className="gpx-chart-card-stats">
            <span>Moyenne <b>{fmtInt(heartRate.avgBpm)} bpm</b></span>
            <span>Max <b>{fmtInt(heartRate.maxBpm)} bpm</b></span>
            {heartRate.minBpm != null && <span>Min <b>{fmtInt(heartRate.minBpm)} bpm</b></span>}
          </div>
          {z.available ? (
            <div className="gpx-zone-bar-wrap" style={{ marginTop: 16 }}>
              {z.zones.map((zn, i) => (
                <div className="gpx-zone-row" key={zn.name}>
                  <div className="gpx-zone-name">{zn.name}</div>
                  <div className="gpx-zone-track"><div className="gpx-zone-fill" style={{ width: `${zn.percentage || 0}%`, background: HR_ZONE_COLORS[i] }} /></div>
                  <div className="gpx-zone-time">{fmtDuration(zn.seconds)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="gpx-empty-note" style={{ marginTop: 10 }}>Zones FC indisponibles (FC max non renseignée dans Paramètres).</p>
          )}
        </>
      )}
    </div>
  );
}

function CadenceSection({ analytics }) {
  const { cadence } = analytics;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={RefreshCw}>Cadence</SectionTitle>
      {!cadence.available ? (
        <p className="gpx-empty-note">Aucune donnée de cadence sur cette sortie.</p>
      ) : (
        <div className="gpx-chart-card-stats">
          <span>Moyenne <b>{fmtInt(cadence.avgRpm)} rpm</b></span>
          <span>Max <b>{fmtInt(cadence.maxRpm)} rpm</b></span>
        </div>
      )}
    </div>
  );
}

function PausesSection({ analytics }) {
  const { pauses } = analytics;
  if (!pauses.available) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={PauseCircle}>Pauses</SectionTitle>
        <p className="gpx-empty-note">Pas d'horodatage exploitable pour détecter des pauses.</p>
      </div>
    );
  }
  const longest = [...pauses.list].sort((a, b) => b.durationSec - a.durationSec).slice(0, 5);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={PauseCircle}>Pauses</SectionTitle>
      <div className="gpx-stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard icon={PauseCircle} label="Nombre de pauses" value={fmtInt(pauses.count)} accent={COLORS.alert} />
        <StatCard icon={Clock} label="Temps total arrêté" value={fmtDurationLong(pauses.totalSec)} accent={COLORS.alert} />
        {pauses.avgSec != null && <StatCard icon={Timer} label="Pause moyenne" value={fmtDurationLong(pauses.avgSec)} accent={COLORS.alert} />}
        {pauses.longestSec != null && <StatCard icon={Timer} label="Pause la plus longue" value={fmtDurationLong(pauses.longestSec)} accent={COLORS.alert} />}
      </div>
      {longest.length > 0 ? (
        <div className="gpx-stop-list" style={{ marginTop: 12 }}>
          {longest.map((p, i) => (
            <div className="gpx-stop-item" key={i}>
              <span>Pause {i + 1}{p.startTime ? ` · ${fmtClock(p.startTime)}` : ""}</span>
              <b>{fmtDurationLong(p.durationSec)}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="gpx-empty-note" style={{ marginTop: 10 }}>Aucune pause significative détectée.</p>
      )}
    </div>
  );
}

function EffortsSection({ analytics }) {
  const { efforts } = analytics;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Flame}>Efforts détectés</SectionTitle>
      {efforts.length === 0 ? (
        <p className="gpx-empty-note">Aucun effort particulièrement soutenu détecté sur cette sortie.</p>
      ) : (
        <div className="gpx-climb-cards">
          {[...efforts].sort((a, b) => b.durationSec - a.durationSec).slice(0, 8).map((e, i) => (
            <div className="gpx-climb-card" key={i}>
              <div className="gpx-climb-card-head">
                <span className="gpx-climb-card-name">Effort détecté {i + 1}</span>
                <span className="gpx-climb-card-grade">{fmtDuration(e.durationSec)}</span>
              </div>
              <div className="gpx-climb-card-meta">
                <span>{fmt1(e.distanceM / 1000)} km</span>
                {e.avgSpeedKmh != null && <span>{fmt1(e.avgSpeedKmh)} km/h moy.</span>}
                {e.avgPowerW != null && <span>{fmtInt(e.avgPowerW)} W moy.</span>}
                {e.avgHeartRateBpm != null && <span>{fmtInt(e.avgHeartRateBpm)} bpm moy.</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClimbsSection({ analytics, onSelectClimbId, selectedClimbId }) {
  const { climbs } = analytics;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Mountain}>Montées détectées</SectionTitle>
      {climbs.length === 0 ? (
        <p className="gpx-empty-note">Aucune montée significative détectée (nécessite des données d'altitude).</p>
      ) : (
        <div className="gpx-climb-cards">
          {[...climbs].sort((a, b) => b.gainM - a.gainM).slice(0, 10).map((c) => (
            <div
              key={c.id}
              className={"gpx-climb-card" + (selectedClimbId === c.id ? " selected" : "")}
              onClick={() => onSelectClimbId && onSelectClimbId(c.id)}
            >
              <div className="gpx-climb-card-head">
                <span className="gpx-climb-card-name">{c.name}</span>
                <span className="gpx-climb-card-grade">{fmt1(c.avgGrade)}%</span>
              </div>
              <div className="gpx-climb-card-meta">
                <span>{fmt1(c.distanceM / 1000)} km</span>
                <span>+{fmtInt(c.gainM)} m</span>
                {c.durationSec != null && <span>{fmtDuration(c.durationSec)}</span>}
                <span>max {fmt1(c.maxGrade)}%</span>
                {c.avgSpeedKmh != null && <span>{fmt1(c.avgSpeedKmh)} km/h</span>}
                {c.avgPowerW != null && <span>{fmtInt(c.avgPowerW)} W</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.analytics - Résultat de computeActivityAnalytics() (jamais recalculé ici)
 * @param {Object} props.analysis - Résultat de computeAnalysis(), réutilisé tel quel pour ProfileChart
 *   et pour retrouver l'entrée `analysis.climbs` correspondant à une carte de montée cliquée
 * @param {Array} props.chartData - Série décimée déjà calculée dans GPXAnalyzer.jsx (voir `decimate`)
 * @param {number|null} props.hoverIdx
 * @param {Function} props.setHoverIdx
 * @param {string} props.profileMetric
 * @param {Function} props.setProfileMetric
 * @param {Object|null} props.selectedClimb - Climb sélectionné (forme analysis.climbs), pour la synchro carte/profil
 * @param {Function} props.setSelectedClimb
 */
export function AnalyticsView({
  analytics,
  analysis,
  chartData,
  hoverIdx,
  setHoverIdx,
  profileMetric,
  setProfileMetric,
  selectedClimb,
  setSelectedClimb,
}) {
  if (!analytics || !analysis) return null;

  function handleSelectClimbId(id) {
    const match = analysis.climbs.find((c) => c.id === id);
    if (!match) return;
    setSelectedClimb(selectedClimb && selectedClimb.id === id ? null : match);
  }

  return (
    <>
      <OverviewSection analytics={analytics} />

      <div className="gpx-panel">
        <SectionTitle icon={TrendingUp}>Profil</SectionTitle>
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

      <PowerSection analytics={analytics} />
      <ZonesSection analytics={analytics} />
      <HeartRateSection analytics={analytics} />
      <CadenceSection analytics={analytics} />
      <PausesSection analytics={analytics} />
      <EffortsSection analytics={analytics} />
      <ClimbsSection analytics={analytics} onSelectClimbId={handleSelectClimbId} selectedClimbId={selectedClimb ? selectedClimb.id : null} />
    </>
  );
}
