/**
 * COACH — destination principale de l'app qui transforme l'historique déjà
 * stocké en une analyse de sortie lisible ("journal d'analyse personnelle"),
 * sans chatbot et sans appel LLM/API (voir consigne Phase Coach V3A).
 *
 * Ne recrée AUCUNE logique analytique ici : ce composant ne fait que
 *  1) charger l'historique via les mêmes hooks que ProfileView.jsx/
 *     AlterEgoView.jsx/ArchetypeView.jsx (`useActivityRepository` +
 *     `useUnifiedActivities`, voir useActivityRepository.js) — même
 *     chargement en deux étages, mêmes caches, mêmes états ;
 *  2) appeler `buildCoachContext()` (src/lib/coach/context.js) puis
 *     `analyzeCoachContext()` (src/lib/coach/analysis.js), toutes deux des
 *     fonctions PURES déjà testées (949 tests) qui ne recalculent jamais une
 *     métrique déjà connue de l'app ;
 *  3) afficher tel quel le texte déjà produit par ces fonctions (aucun
 *     recalcul de seuil, de confiance ou de tendance dans le JSX).
 *
 * Comme Profil/Alter Ego/Archétype, cette vue ne voit jamais la sortie de
 * démonstration (jamais sauvegardée dans le repository — voir GPXAnalyzer.jsx:
 * loadDemo()) : rien à filtrer explicitement ici, l'isolation vient de
 * l'architecture existante, pas d'un cas particulier ajouté dans ce fichier.
 * Lecture seule stricte : ce composant n'appelle jamais saveActivity/
 * deleteActivity/sync.
 */
import { useMemo, useState } from "react";
import {
  ArrowLeft, Route, Clock, TrendingUp, PauseCircle, Heart, RefreshCw, Gauge,
  ThumbsUp, Eye, Lightbulb, ShieldAlert, Info, AlertTriangle, Download, Copy,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle, StatCard, PageHead } from "./UIPrimitives.jsx";
import { useActivityRepository, useUnifiedActivities } from "./useActivityRepository.js";
import { buildCoachContext } from "../lib/coach/context.js";
import { analyzeCoachContext } from "../lib/coach/analysis.js";
import { buildCoachExport } from "../lib/coach/exportLog.js";
import { confidenceLabel } from "../lib/profile/confidence.js";
import { COLORS } from "../lib/colors.js";
import { fmt1, fmtInt, fmtDuration, fmtDateFull } from "../lib/utils.js";

// Même principe/valeur que MAX_PROFILE_ACTIVITIES (ProfileView.jsx) : ne
// charge jamais silencieusement un historique entier illimité.
const MAX_COACH_ACTIVITIES = 200;

const CONFIDENCE_LABELS_FR = { low: "faible", medium: "moyenne", high: "élevée", insufficient_data: "insuffisante" };

const EVOLUTION_BADGE = { improving: "gpx-badge-best", declining: "gpx-badge-worst" };
const EVOLUTION_SYMBOL = { improving: "↗", declining: "↘", stable: "→", insufficient: "·" };

function PowerBadge({ source }) {
  if (source === "measured") return <span className="gpx-power-source">Mesurée</span>;
  if (source === "estimated") return <span className="gpx-power-source-estimated">Estimée</span>;
  return null;
}

function LastRideSection({ ride, onOpen }) {
  if (!ride) return null;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Route}>Ta dernière sortie</SectionTitle>
      <p className="gpx-coach-ride">
        <span className="gpx-coach-ride-name">{ride.name || "(sans nom)"} — {ride.date ? fmtDateFull(new Date(ride.date)) : "date inconnue"}</span>
        {onOpen && (
          <button className="gpx-link-btn" onClick={() => onOpen(ride.id)}>
            Ouvrir cette sortie
          </button>
        )}
      </p>
      <div className="gpx-stats-grid">
        <StatCard icon={Route} label="Distance" value={ride.distanceKm != null ? fmt1(ride.distanceKm) : null} unit="km" accent={COLORS.speed} />
        <StatCard icon={Clock} label="Durée" value={ride.durationSec != null ? fmtDuration(ride.durationSec) : null} accent={COLORS.info} />
        <StatCard icon={TrendingUp} label="D+" value={ride.elevationGainM != null ? fmtInt(ride.elevationGainM) : null} unit="m" accent={COLORS.climb} />
        <StatCard icon={Gauge} label="Vitesse moyenne" value={ride.avgSpeedKmh != null ? fmt1(ride.avgSpeedKmh) : null} unit="km/h" accent={COLORS.speed} />
        <StatCard icon={PauseCircle} label="Temps arrêté" value={ride.stoppedTimeSec != null ? fmtDuration(ride.stoppedTimeSec) : null} accent={COLORS.alert} />
        <StatCard icon={Heart} label="FC moyenne" value={ride.avgHeartRateBpm != null ? fmtInt(ride.avgHeartRateBpm) : null} unit="bpm" accent={COLORS.effort} />
        <StatCard icon={RefreshCw} label="Cadence moyenne" value={ride.avgCadenceRpm != null ? fmtInt(ride.avgCadenceRpm) : null} unit="rpm" accent={COLORS.info} />
      </div>
      <div className="gpx-chart-card-stats gpx-coach-power">
        {ride.power.available ? (
          <span>
            Puissance <PowerBadge source={ride.power.source} /> : moy <b>{fmtInt(ride.power.avgW)} W</b>
            {ride.power.maxW != null && <> · max <b>{fmtInt(ride.power.maxW)} W</b></>}
            {ride.power.normalizedW != null && <> · normalisée <b>{fmtInt(ride.power.normalizedW)} W</b></>}
          </span>
        ) : (
          <span>Puissance : non disponible</span>
        )}
      </div>
    </div>
  );
}

function ListSection({ icon: Icon, title, items, emptyText, renderItem, variant }) {
  return (
    <div className={"gpx-panel gpx-coach-section" + (variant ? ` gpx-coach-section--${variant}` : "")}>
      <SectionTitle icon={Icon}>{title}</SectionTitle>
      {items.length === 0 ? (
        <p className="gpx-empty-note">{emptyText}</p>
      ) : (
        <ul className="gpx-highlight-list gpx-coach-list">
          {items.map((item, i) => (
            <li key={i}>{renderItem ? renderItem(item) : item.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvolutionItem({ item }) {
  const badgeClass = EVOLUTION_BADGE[item.status];
  return (
    <>
      {badgeClass ? (
        <span className={badgeClass + " gpx-coach-trend"}>{EVOLUTION_SYMBOL[item.status]}</span>
      ) : (
        <span className="gpx-coach-trend gpx-coach-trend--flat">{EVOLUTION_SYMBOL[item.status] || "·"}</span>
      )}
      {item.message}
    </>
  );
}

/**
 * @param {Object} props
 * @param {Object} props.storage - voir GPXAnalyzer.jsx (status/rootHandle)
 * @param {Function} props.onConnect
 * @param {Function} props.onReconnect
 * @param {Function} [props.onOpen] - ouvre une sortie depuis son id (voir openActivityFromHistory)
 * @param {Function} props.onBack
 * @param {Object|null} [props.userSettings]
 */
export function CoachView({ storage, onConnect, onReconnect, onOpen, onBack, userSettings }) {
  const { repository } = useActivityRepository(storage, userSettings);
  const { summaries, summariesError, fullActivities, failedCount, source } = useUnifiedActivities(repository, { max: MAX_COACH_ACTIVITIES });

  // Même critère que ProfileView.jsx : prêt dès qu'une source d'activités
  // existe (dossier local OU compte cloud), jamais bloqué sur "local
  // uniquement" (voir consigne 11B §2).
  const ready = storage.status === "connected" || repository.hasCloud;

  const context = useMemo(() => (fullActivities ? buildCoachContext(fullActivities, { recentCount: 5 }) : null), [fullActivities]);
  const analysis = useMemo(() => (context ? analyzeCoachContext(context) : null), [context]);

  const [exportMsg, setExportMsg] = useState(null);

  // Journal Markdown (consigne de coaching + stats) à donner à Claude : aucun appel IA ici.
  function buildExport() {
    return buildCoachExport({ context, analysis, activities: fullActivities });
  }
  async function copyExport() {
    try {
      await navigator.clipboard.writeText(buildExport().text);
      setExportMsg("Journal copié : colle-le dans une conversation Claude.");
    } catch {
      setExportMsg("Copie impossible sur ce navigateur : utilise « Télécharger le journal ».");
    }
  }
  function downloadExport() {
    const { filename, text } = buildExport();
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMsg(`Journal téléchargé (${filename}) : joins-le à une conversation Claude.`);
  }

  const overallLabel = context ? confidenceLabel(context.profile.overallConfidence) : null;

  return (
    <div className="gpx-dashboard gpx-ds">
      <PageHead
        title="Coach"
        meta={context ? (
          <>
            <span>
              Dernière sortie : {context.lastRide && context.lastRide.date ? fmtDateFull(new Date(context.lastRide.date)) : "aucune"}
            </span>
            <span>
              {context.activityCount} sortie{context.activityCount > 1 ? "s" : ""} analysée{context.activityCount > 1 ? "s" : ""}
            </span>
            {overallLabel && (
              <span>
                Qualité globale des données : <b className={`gpx-confidence-${overallLabel}`}>{CONFIDENCE_LABELS_FR[overallLabel] || overallLabel}</b>
              </span>
            )}
          </>
        ) : ready ? (
          <span>{summaries ? "Analyse de tes sorties…" : "Chargement…"}</span>
        ) : null}
        actions={<button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={15} /> <span>Retour</span></button>}
      />

      <div className="gpx-statusline">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} />
      </div>

      {ready && (
        <>
          {summariesError && <div className="gpx-error-box" style={{ marginBottom: 14 }}>{summariesError}</div>}
          {(source === "offline" || source === "error") && (
            <div className="gpx-profile-banner">
              <Info size={14} />
              {source === "offline"
                ? "Cloud injoignable pour l'instant — analyse basée sur les données locales disponibles."
                : "Erreur de synchronisation cloud — analyse basée sur les données locales disponibles."}
            </div>
          )}

          {summaries == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de tes sorties…</p></div>
          ) : summaries.length === 0 ? (
            <div className="gpx-panel">
              <p className="gpx-summary-text">Ton coach apparaîtra ici après ta première sortie.</p>
              <p className="gpx-empty-note">Importe un GPX ou un FIT pour commencer.</p>
            </div>
          ) : fullActivities == null || !context || !analysis ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de tes sorties…</p></div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className="gpx-profile-banner">
                  <AlertTriangle size={14} />
                  {failedCount} sortie{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être chargée{failedCount > 1 ? "s" : ""}. L'analyse est faite à partir des sorties disponibles.
                </div>
              )}
              {summaries.length > MAX_COACH_ACTIVITIES && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Analyse basée sur les {MAX_COACH_ACTIVITIES} sorties les plus récentes (sur {summaries.length} au total).
                </div>
              )}
              {context.activityCount === 1 && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Analyse en construction — 1 seule sortie disponible. Les tendances et comparaisons nécessitent davantage d'historique.
                </div>
              )}

              <p className="gpx-summary-text gpx-coach-lede">{analysis.summary}</p>

              <div className="gpx-panel">
                <SectionTitle icon={Download}>Me faire coacher par Claude</SectionTitle>
                <p className="gpx-empty-note">
                  Exporte un journal de tes stats (toutes tes sorties, profil, progression, records — sans trace GPS) avec une consigne de coaching prête à l'emploi, puis donne-le à Claude pour un bilan, des pistes d'amélioration et un plan de la semaine.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  <button className="gpx-btn-primary" onClick={copyExport}><Copy size={14} /> Copier le journal</button>
                  <button className="gpx-btn-ghost" onClick={downloadExport}><Download size={14} /> Télécharger (.md)</button>
                </div>
                {exportMsg && <p className="gpx-empty-note" style={{ marginTop: 8 }} role="status">{exportMsg}</p>}
              </div>

              <ListSection
                icon={Lightbulb}
                variant="reco"
                title="Mes recommandations"
                items={analysis.recommendations}
                emptyText="Pas de recommandation particulière pour l'instant."
              />

              <div className="gpx-two-up">
                <ListSection
                  icon={ThumbsUp}
                  variant="positive"
                  title="Ce qui va dans le bon sens"
                  items={analysis.positives}
                  emptyText="Rien de particulier à souligner pour l'instant."
                />

                <ListSection
                  icon={Eye}
                  variant="attention"
                  title="À surveiller"
                  items={analysis.attentionPoints}
                  emptyText="Aucun point de vigilance identifié pour l'instant."
                />
              </div>

              <LastRideSection ride={context.lastRide} onOpen={onOpen} />

              <ListSection
                icon={TrendingUp}
                variant="evolution"
                title="Ton évolution"
                items={analysis.evolution}
                emptyText="Pas encore assez de données pour dégager une évolution."
                renderItem={(item) => <EvolutionItem item={item} />}
              />

              <ListSection
                icon={ShieldAlert}
                variant="limits"
                title="Limites des données"
                items={analysis.dataLimits}
                emptyText=""
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
