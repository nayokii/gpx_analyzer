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
import { listActivities } from "../lib/storage/activityStore.js";
import { loadCachedActivityDetails } from "../lib/storage/activityCache.js";
import { getCachedProfile, getCachedArchetypeMatch, getCachedReferenceRiders, getCachedArchetypeTimeline } from "../lib/derivedCache.js";
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

/**
 * @param {string[]} dims
 * @param {Object} vectorValues - `{[dim]: value}`
 * @param {Object} [influence] - `{[dim]: string}` libellé d'influence dans le
 *   matching (voir archetypes/archetypeProfile.js: matchingInfluenceLabel) —
 *   optionnel : `RiderCard` n'en a pas besoin, seule la section "Ton profil
 *   cycliste" l'affiche (voir consigne §12).
 */
function DimensionBars({ dims, vectorValues, influence }) {
  const sorted = dims.slice().sort((a, b) => vectorValues[b] - vectorValues[a]);
  return (
    <div className="gpx-archetype-bars">
      {sorted.map((d) => (
        <div className="gpx-archetype-bar-row" key={d}>
          <span className="gpx-archetype-bar-label">{DIMENSION_LABELS[d]}</span>
          <div className="gpx-profile-card-bar"><div className="gpx-profile-card-bar-fill" style={{ width: `${Math.max(0, Math.min(100, vectorValues[d]))}%` }} /></div>
          <span className="gpx-archetype-bar-value">{vectorValues[d]}</span>
          {influence && influence[d] && <span className="gpx-archetype-bar-influence">{influence[d]}</span>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ton profil cycliste (archétype dominant)                            */
/* ------------------------------------------------------------------ */

/**
 * État "pas assez de preuves pour affirmer un archétype" (voir consigne
 * Phase 9E, problème 1) — distinct du cas "no_match" (données solides, mais
 * la forme du profil ne ressemble à aucun style connu, voir matching.js).
 * N'affiche QUE des nombres réellement calculés par le moteur (nombre de
 * sorties, dimensions disponibles/manquantes, semaines couvertes si connu) —
 * jamais un nombre de sorties "nécessaires" ni un pourcentage de progression
 * inventés.
 */
function ProfileUnderConstructionNote({ match, profile }) {
  const availableDims = ARCHETYPE_DIMENSIONS.filter((d) => match.vector && match.vector[d] && match.vector[d].value != null);
  const missingDims = match.insufficientDimensions;
  const activityCount = profile ? profile.activityCount : 0;
  const consistency = profile && profile.dimensions.consistency;
  const weeksSpan = consistency && consistency.signals ? consistency.signals.totalWeeksSpan : null;

  const bodyText =
    match.reason === "no_data"
      ? "Aucune dimension n'est encore exploitable : importe au moins une sortie pour voir apparaître les premières tendances."
      : "Ton profil commence à prendre forme, mais les données disponibles ne permettent pas encore de déterminer un archétype fiable.";

  return (
    <>
      <p className="gpx-profile-card-meta">
        {activityCount} sortie{activityCount > 1 ? "s" : ""} analysée{activityCount > 1 ? "s" : ""}
        {weeksSpan != null ? ` · ${weeksSpan} semaine${weeksSpan > 1 ? "s" : ""} couverte${weeksSpan > 1 ? "s" : ""}` : ""}
      </p>
      <p className="gpx-empty-note" style={{ fontStyle: "normal", marginTop: 6 }}>{bodyText}</p>

      {availableDims.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="gpx-profile-card-meta">Ce qui influence déjà ton profil :</div>
          <ul className="gpx-profile-evidence-list">
            {availableDims.map((d) => <li key={d}>{DIMENSION_LABELS[d]}</li>)}
          </ul>
        </div>
      )}
      {missingDims.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="gpx-profile-card-meta">Ce qui reste à documenter :</div>
          <ul className="gpx-profile-evidence-list">
            {missingDims.map((d) => <li key={d}>{DIMENSION_LABELS[d]}</li>)}
          </ul>
        </div>
      )}

      <p className="gpx-empty-note" style={{ fontStyle: "normal", marginTop: 10 }}>
        L'archétype se précisera naturellement avec davantage de données.
      </p>
    </>
  );
}

function DominantArchetypeSection({ match, userValues, profile }) {
  const hasResult = !!match.primary;
  const usedDimCount = ARCHETYPE_DIMENSIONS.length - match.insufficientDimensions.length;
  const isUnderConstruction = !hasResult && match.reason !== "no_match";
  const influence = useMemo(() => {
    if (!match.vector) return {};
    const map = {};
    for (const d of ARCHETYPE_DIMENSIONS) if (match.vector[d]) map[d] = match.vector[d].matchingInfluence;
    return map;
  }, [match.vector]);

  const headline = isUnderConstruction ? "Profil en construction" : match.combinedLabel;

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Fingerprint}>Ton profil cycliste</SectionTitle>
      <div className="gpx-archetype-headline">{headline}</div>
      {!hasResult ? (
        isUnderConstruction ? (
          <ProfileUnderConstructionNote match={match} profile={profile} />
        ) : (
          <>
            <p className="gpx-empty-note">
              Les dimensions disponibles ne se rapprochent pas assez nettement d'un style particulier pour l'instant.
            </p>
            {match.explanation.map((s, i) => (
              <p className="gpx-empty-note" key={i} style={{ fontStyle: "normal", marginTop: 4 }}>{s}</p>
            ))}
          </>
        )
      ) : (
        <>
          <div className="gpx-archetype-roles">
            <span>Dominant : <b>{match.primary.name}</b></span>
            <span>{match.secondary ? <>Secondaire : <b>{match.secondary.name}</b></> : "Pas de second archétype suffisamment proche pour l'instant"}</span>
          </div>
          <div className="gpx-profile-card-confidence" style={{ marginTop: 6 }}>
            Confiance : <b className={`gpx-confidence-${match.confidence.label}`}>{CONFIDENCE_LABELS[match.confidence.label] || match.confidence.label}</b>
          </div>
          <div className="gpx-alterego-subheading">Pourquoi ?</div>
          <DimensionBars dims={ARCHETYPE_DIMENSIONS.filter((d) => userValues[d] != null)} vectorValues={userValues} influence={influence} />
          {match.explanation.map((s, i) => (
            <p className="gpx-empty-note" key={i} style={{ fontStyle: "normal", marginTop: i === 0 ? 10 : 4 }}>{s}</p>
          ))}
          <p className="gpx-profile-card-meta" style={{ marginTop: 8 }}>
            Limites : ce rapprochement ne compare que {usedDimCount} / {ARCHETYPE_DIMENSIONS.length} dimensions de style,
            uniquement celles disponibles dans ton profil actuel — jamais un niveau de performance.
          </p>
        </>
      )}
      {!isUnderConstruction && match.insufficientDimensions.length > 0 && (
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
    loadCachedActivityDetails(storage.rootHandle, toLoad).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? getCachedProfile(fullActivities) : null), [fullActivities]);
  const match = useMemo(() => (profile ? getCachedArchetypeMatch(profile) : null), [profile]);
  const riderResults = useMemo(() => (profile ? getCachedReferenceRiders(profile) : []), [profile]);
  const timeline = useMemo(() => (fullActivities ? getCachedArchetypeTimeline(fullActivities) : []), [fullActivities]);

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

              <DominantArchetypeSection match={match} userValues={userValues} profile={profile} />
              <SimilarRidersSection results={riderResults} />
              <EvolutionSection timeline={timeline} />
            </>
          )}
        </>
      )}
    </div>
  );
}
