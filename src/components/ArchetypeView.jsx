/**
 * ARCHÉTYPE — vue en lecture seule au-dessus du moteur d'archétypes
 * (Phase 8, voir src/lib/archetypes/) et du profil (Phase 6A). N'invente
 * aucune explication : chaque phrase affichée vient de
 * `explainArchetypeMatch()`/`explainRiderMatch()`, jamais reformulée en React.
 *
 * Chargement des données : IDENTIQUE au pattern de ProfileView.jsx/
 * AlterEgoView.jsx (index léger via listActivities, puis détail complet via
 * loadActivityDetail, Promise.allSettled, plafonné) — un seul système de
 * chargement dans toute l'app. Le mode démo ne peut structurellement pas
 * l'atteindre : cette vue ne lit jamais l'activité "ouverte" dans le
 * dashboard, seulement l'historique persisté du dossier connecté.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Info, Fingerprint, Users, TrendingUp, AlertTriangle, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities, loadActivityDetail } from "../lib/storage/activityStore.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { matchArchetypes, matchReferenceRiders, buildArchetypeTimeline } from "../lib/archetypes/matching.js";
import { ARCHETYPE_DIMENSIONS } from "../lib/archetypes/archetypes.js";

const MAX_ARCHETYPE_ACTIVITIES = 200; // même principe que MAX_PROFILE_ACTIVITIES (ProfileView.jsx)
const VISIBLE_RIDERS_DEFAULT = 3;

const DIMENSION_LABELS = {
  endurance: "Endurance",
  climbing: "Grimpe",
  punch: "Punch",
  sprint: "Sprint",
  timeTrial: "CLM",
  technical: "Technique",
};

const SPECIALTY_LABELS = {
  climbing: "grimpe",
  stage_racing: "courses par étapes",
  classics: "classiques",
  time_trial: "contre-la-montre",
  punch: "punch",
  sprint: "sprint",
  cyclocross: "cyclocross",
  mtb: "VTT",
  technical: "terrain technique",
  track: "piste",
  endurance: "endurance",
};

const CONFIDENCE_LABELS = { low: "faible", medium: "moyenne", high: "élevée" };

function formatSpecialties(specialties) {
  return specialties.map((s) => SPECIALTY_LABELS[s] || s).join(" · ");
}

function formatMonthKey(key) {
  const d = new Date(`${key}-01T00:00:00`);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Bloc "Pourquoi ?" — barres de dimensions                            */
/* ------------------------------------------------------------------ */

function DimensionBars({ dims, vectorValues }) {
  const sorted = dims.slice().sort((a, b) => vectorValues[b] - vectorValues[a]);
  return (
    <div className="gpx-archetype-bars">
      {sorted.map((d) => (
        <div className="gpx-archetype-bar-row" key={d}>
          <span className="gpx-archetype-bar-label">{DIMENSION_LABELS[d]}</span>
          <div className="gpx-profile-card-bar"><div className="gpx-profile-card-bar-fill" style={{ width: `${Math.max(0, Math.min(100, vectorValues[d]))}%` }} /></div>
          <span className="gpx-archetype-bar-value">{vectorValues[d]}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ton profil cycliste (archétype dominant)                            */
/* ------------------------------------------------------------------ */

function DominantArchetypeSection({ match, userValues }) {
  const hasResult = !!match.primary;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Fingerprint}>Ton profil cycliste</SectionTitle>
      <div className="gpx-archetype-headline">{match.combinedLabel}</div>
      {!hasResult ? (
        <p className="gpx-empty-note">
          {match.insufficientDimensions.length === ARCHETYPE_DIMENSIONS.length
            ? "Pas encore assez de dimensions exploitables pour proposer un archétype."
            : "Les dimensions disponibles ne se rapprochent pas assez nettement d'un style particulier pour l'instant."}
        </p>
      ) : (
        <>
          <div className="gpx-profile-card-confidence" style={{ marginTop: 6 }}>
            Confiance : <b className={`gpx-confidence-${match.confidence.label}`}>{CONFIDENCE_LABELS[match.confidence.label] || match.confidence.label}</b>
          </div>
          <div className="gpx-alterego-subheading">Pourquoi ?</div>
          <DimensionBars dims={ARCHETYPE_DIMENSIONS.filter((d) => userValues[d] != null)} vectorValues={userValues} />
          {match.explanation.map((s, i) => (
            <p className="gpx-empty-note" key={i} style={{ fontStyle: "normal", marginTop: i === 0 ? 10 : 4 }}>{s}</p>
          ))}
        </>
      )}
      {match.insufficientDimensions.length > 0 && (
        <p className="gpx-profile-card-meta" style={{ marginTop: 8 }}>
          Dimensions manquantes : {match.insufficientDimensions.map((d) => DIMENSION_LABELS[d]).join(", ")}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Coureurs de référence                                                */
/* ------------------------------------------------------------------ */

function RiderCard({ result }) {
  const [expanded, setExpanded] = useState(false);
  const { rider, similarityLabel, matchedDimensions, missingDimensions } = result;

  return (
    <div className="gpx-archetype-rider-card">
      <div className="gpx-archetype-rider-head">
        <span className="gpx-archetype-rider-name">{rider.name}</span>
        <span className="gpx-profile-card-meta">{formatSpecialties(rider.specialties)}</span>
      </div>
      <div className="gpx-archetype-rider-similarity">{similarityLabel}</div>
      <DimensionBars dims={matchedDimensions} vectorValues={Object.fromEntries(matchedDimensions.map((d) => [d, rider.profile[d]]))} />
      <button className="gpx-link-btn gpx-profile-evidence-toggle" onClick={() => setExpanded((e) => !e)}>
        {expanded ? <>Masquer <ChevronUp size={12} /></> : <>Pourquoi → <ChevronDown size={12} /></>}
      </button>
      {expanded && (
        <div className="gpx-archetype-rider-detail">
          <p className="gpx-empty-note" style={{ fontStyle: "normal" }}>{rider.description}</p>
          {result.explanation.map((s, i) => (
            <p className="gpx-empty-note" key={i} style={{ fontStyle: "normal" }}>{s}</p>
          ))}
          {missingDimensions.length > 0 && (
            <p className="gpx-profile-card-meta">Dimensions manquantes pour affiner : {missingDimensions.map((d) => DIMENSION_LABELS[d]).join(", ")}.</p>
          )}
          <div className="gpx-archetype-rider-sources">
            {rider.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="gpx-link-btn">
                {s.label} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SimilarRidersSection({ results }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? results : results.slice(0, VISIBLE_RIDERS_DEFAULT);

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Users}>Profils de coureurs similaires</SectionTitle>
      {results.length === 0 ? (
        <p className="gpx-empty-note">Pas encore assez de dimensions exploitables pour proposer un rapprochement fiable.</p>
      ) : (
        <>
          <p className="gpx-empty-note" style={{ fontStyle: "normal", marginBottom: 10 }}>
            Comparaison de la structure du profil (quelles dimensions dominent), jamais du niveau de performance.
          </p>
          <div className="gpx-archetype-rider-grid">
            {visible.map((r) => <RiderCard key={r.rider.id} result={r} />)}
          </div>
          {results.length > VISIBLE_RIDERS_DEFAULT && (
            <button className="gpx-btn-ghost" style={{ marginTop: 12 }} onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Réduire" : `Voir les autres profils (${results.length - VISIBLE_RIDERS_DEFAULT})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Évolution dans le temps                                             */
/* ------------------------------------------------------------------ */

function EvolutionSection({ timeline }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={TrendingUp}>Ton profil évolue</SectionTitle>
      {timeline.length < 2 ? (
        <p className="gpx-empty-note">Pas encore assez de données pour montrer une évolution fiable.</p>
      ) : (
        <div className="gpx-archetype-timeline">
          {timeline.map((point, i) => (
            <div className="gpx-archetype-timeline-row" key={i}>
              <span className="gpx-profile-card-meta">{formatMonthKey(point.date)}</span>
              <span>{point.match.combinedLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
 * @param {Function} props.onBack
 */
export function ArchetypeView({ storage, onConnect, onReconnect, onBack }) {
  const [summaries, setSummaries] = useState(null);
  const [summariesError, setSummariesError] = useState(null);
  const [fullActivities, setFullActivities] = useState(null);
  const [failedCount, setFailedCount] = useState(0);

  const refresh = useCallback(() => {
    if (storage.status !== "connected" || !storage.rootHandle) return;
    setSummariesError(null);
    setSummaries(null);
    setFullActivities(null);
    setFailedCount(0);
    listActivities(storage.rootHandle)
      .then(setSummaries)
      .catch((err) => setSummariesError(err.message || "Impossible de lire l'historique."));
  }, [storage.status, storage.rootHandle]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!summaries || summaries.length === 0 || !storage.rootHandle) return;
    let cancelled = false;
    const toLoad = summaries.slice(0, MAX_ARCHETYPE_ACTIVITIES);
    Promise.allSettled(toLoad.map((a) => loadActivityDetail(storage.rootHandle, a.id))).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? computeCyclistProfile(fullActivities) : null), [fullActivities]);
  const match = useMemo(() => (profile ? matchArchetypes(profile) : null), [profile]);
  const riderResults = useMemo(() => (profile ? matchReferenceRiders(profile) : []), [profile]);
  const timeline = useMemo(() => (fullActivities ? buildArchetypeTimeline(fullActivities) : []), [fullActivities]);

  const userValues = useMemo(() => {
    if (!profile) return {};
    const values = {};
    for (const d of ARCHETYPE_DIMENSIONS) values[d] = profile.dimensions[d].value;
    return values;
  }, [profile]);

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name">Archétype</h1>
          <div className="gpx-ride-meta">
            {profile ? (
              <span>Basé sur {profile.activityCount} sortie{profile.activityCount > 1 ? "s" : ""}</span>
            ) : storage.status === "connected" ? (
              <span>{summaries ? "Analyse de ton historique…" : "Chargement…"}</span>
            ) : null}
          </div>
        </div>
        <div className="gpx-header-actions">
          <button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Retour</button>
        </div>
      </div>

      <div className="gpx-panel">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} />
      </div>

      {storage.status === "connected" && (
        <>
          {summariesError && <div className="gpx-error-box" style={{ marginBottom: 14 }}>{summariesError}</div>}

          {summaries == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : summaries.length === 0 ? (
            <div className="gpx-panel">
              <p className="gpx-summary-text">Ton archétype apparaîtra ici après ta première sortie.</p>
              <p className="gpx-empty-note">Importe un GPX ou un FIT pour commencer.</p>
            </div>
          ) : fullActivities == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className="gpx-profile-banner">
                  <AlertTriangle size={14} />
                  {failedCount} sortie{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être chargée{failedCount > 1 ? "s" : ""}. L'archétype est calculé à partir des sorties disponibles.
                </div>
              )}
              {summaries.length > MAX_ARCHETYPE_ACTIVITIES && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Archétype basé sur les {MAX_ARCHETYPE_ACTIVITIES} sorties les plus récentes (sur {summaries.length} au total).
                </div>
              )}
              {profile.activityCount === 1 && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Archétype en construction — 1 sortie analysée. Plus de sorties et de types de capteurs affineront la comparaison.
                </div>
              )}

              <DominantArchetypeSection match={match} userValues={userValues} />
              <SimilarRidersSection results={riderResults} />
              <EvolutionSection timeline={timeline} />
            </>
          )}
        </>
      )}
    </div>
  );
}
