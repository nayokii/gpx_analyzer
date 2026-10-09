/**
 * ACCUEIL — Focus Dashboard : le centre de gravité de l'application, pas une
 * galerie de copies miniatures des autres pages. Répond à quatre questions
 * en quelques secondes : où j'en suis (Alter Ego), sur quoi je progresse
 * (Focus), qu'est-ce qui compte maintenant (Focus), quelle est ma dernière
 * activité. Chaque aperçu est cliquable (voir consigne §11) mais reste un
 * RACCOURCI — la navigation principale (AppNav.jsx) reste l'unique manière
 * canonique d'atteindre chaque section.
 *
 * AUCUN nouveau calcul métier ici (voir consigne §1/§4) : "Ton focus" ne
 * fait QUE sélectionner et reformuler un objet déjà produit par
 * `computeProgression()` (un `challenge` de `progression.challenges`, déjà
 * calculé par src/lib/progression/challenges.js) — jamais un nouveau score
 * de motivation/discipline/potentiel. La sélection ("le challenge le plus
 * proche d'être atteint") est un simple tri sur des champs déjà réels
 * (`current`/`target`), pas une métrique inventée. Voir `pickFocusChallenge`.
 *
 * Chargement : même pattern que ProfileView.jsx/AlterEgoView.jsx/
 * ArchetypeView.jsx (listActivities → loadActivityDetail, plafonné,
 * Promise.allSettled). Volontairement PAS mutualisé avec GPXAnalyzer.jsx :
 * un seul de ces panneaux est monté à la fois (changement de `mode`, pas de
 * rendu simultané), donc il n'y a pas de double-fetch concurrent à éviter —
 * lifter cet état demanderait de faire transiter `activities` en props à
 * travers 4 composants pour un gain nul à ce volume de données (voir
 * consigne §15 : "ne fais pas de refactor massif si ce n'est pas
 * nécessaire").
 *
 * État vide (pas de dossier connecté OU aucune sortie) : reprend l'écran
 * d'import existant tel quel (mêmes classes `.gpx-upload-zone`/
 * `.gpx-landing-*`, déjà éprouvées) — ne réinvente pas cette expérience,
 * l'accueil l'englobe simplement.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Mountain, Upload, FileWarning, Sparkles, ArrowRight, Timer, Zap, Flame, Trophy, UserRound, Fingerprint, Target, AlertTriangle,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { Reveal } from "./Reveal.jsx";
import { SectionTitle, ProgressRing } from "./UIPrimitives.jsx";
import { COLORS } from "../lib/colors.js";
import { listActivities } from "../lib/storage/activityStore.js";
import { loadCachedActivityDetails } from "../lib/storage/activityCache.js";
import { confidenceLabel } from "../lib/profile/confidence.js";
import { getXpProgress } from "../lib/progression/levels.js";
import { getCachedProfile, getCachedProgression, getCachedArchetypeMatch } from "../lib/derivedCache.js";
import { fmt1, fmtInt, fmtDuration, fmtDateFull } from "../lib/utils.js";

/** "vendredi 9 octobre" → "Vendredi 9 octobre" (la casse du mois reste française). */
function formatToday() {
  const text = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MAX_HOME_ACTIVITIES = 200; // même principe que MAX_PROFILE_ACTIVITIES (ProfileView.jsx)

const CONFIDENCE_LABELS = { low: "faible", medium: "moyenne", high: "élevée" };

// Couleurs métier : endurance = vitesse/temps, grimpe = dénivelé, punch = effort, sprint = puissance.
const DIMENSION_META = {
  endurance: { label: "Endurance", icon: Timer, accent: COLORS.speed },
  climbing: { label: "Grimpe", icon: Mountain, accent: COLORS.climb },
  punch: { label: "Punch", icon: Zap, accent: COLORS.effort },
  sprint: { label: "Sprint", icon: Flame, accent: COLORS.info },
};
const HOME_DIMENSION_ORDER = ["endurance", "climbing", "punch", "sprint"];

// Reformulation générique par catégorie de challenge (voir progression/challenges.js
// pour la liste des catégories réelles) — jamais un texte par utilisateur, un simple
// gabarit tenu par catégorie, comme explanations.js le fait déjà pour les archétypes.
const FOCUS_TITLES = {
  distance: "Allonger tes sorties",
  elevation: "Grimper plus haut",
  endurance: "Construire ton endurance",
  consistency: "Ancrer ta régularité",
  climbing: "Développer ta grimpe",
  punch: "Entretenir ton punch",
};
const FOCUS_DESCRIPTIONS = {
  distance: "Continue à augmenter la distance de tes sorties pour repousser ce palier.",
  elevation: "Continue à accumuler du dénivelé sur une sortie pour repousser ce palier.",
  endurance: "Continue à accumuler du temps de selle pour développer cette dimension.",
  climbing: "Continue à accumuler du dénivelé sur cette période pour développer ta grimpe.",
  punch: "Continue à enchaîner des efforts courts et intenses pour entretenir ton punch.",
};

/**
 * Sélectionne le challenge actif le plus proche d'être atteint — PAS une
 * nouvelle métrique de performance, juste un tri sur `current`/`target`,
 * deux champs déjà produits par challenges.js. Déterministe, pur.
 * @param {Array} challenges - progression.challenges
 * @returns {Object|null}
 */
export function pickFocusChallenge(challenges) {
  if (!challenges || challenges.length === 0) return null;
  return challenges.slice().sort((a, b) => b.current / b.target - a.current / a.target)[0];
}

function xpInLastDays(events, days, now) {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return events.filter((e) => e.date && new Date(e.date) >= cutoff).reduce((sum, e) => sum + e.xp, 0);
}

/* ------------------------------------------------------------------ */
/* Ton focus — bloc dominant                                           */
/* ------------------------------------------------------------------ */

function FocusSection({ profile, progression, onViewChallenges }) {
  const coldStart = profile.activityCount < 2;
  const confLabel = confidenceLabel(profile.overallConfidence);
  const focus = coldStart ? null : pickFocusChallenge(progression.challenges);
  const pct = focus ? Math.max(0, Math.min(100, (focus.current / focus.target) * 100)) : 0;

  return (
    <div className={"gpx-panel gpx-focus-panel" + (focus ? "" : " gpx-focus-panel--solo")}>
      <div className="gpx-focus-main">
        <SectionTitle icon={Target}>Ton focus</SectionTitle>
        {coldStart ? (
          <>
            <div className="gpx-focus-headline">Profil en construction</div>
            <p className="gpx-focus-desc">Continue à enregistrer des sorties pour obtenir suffisamment de données.</p>
          </>
        ) : !focus ? (
          <>
            <div className="gpx-focus-headline">Tous tes objectifs actuels sont atteints</div>
            <p className="gpx-focus-desc">De nouveaux challenges apparaîtront à mesure que ton historique grandit.</p>
          </>
        ) : (
          <>
            <div className="gpx-focus-headline">{FOCUS_TITLES[focus.category] || focus.label}</div>
            <p className="gpx-focus-desc">{focus.category === "consistency" ? focus.reason : FOCUS_DESCRIPTIONS[focus.category]}</p>
            <div className="gpx-focus-meta">
              <span>{focus.current} / {focus.target} {focus.unit}</span>
              <span className="gpx-alterego-xp-badge">+{focus.xpReward} XP</span>
            </div>
          </>
        )}
      </div>
      {focus && (
        <ProgressRing className="gpx-focus-ring" value={pct} label={`Progression de l'objectif : ${Math.round(pct)} %`}>
          <span className="gpx-ring-value">{Math.round(pct)}<small>%</small></span>
          <span className="gpx-ring-caption">de l'objectif</span>
        </ProgressRing>
      )}
      <div className="gpx-focus-footer">
        <span className="gpx-profile-card-meta">
          Confiance du profil : <b className={`gpx-confidence-${confLabel}`}>{CONFIDENCE_LABELS[confLabel] || "insuffisante"}</b>
        </span>
        {!coldStart && <button className="gpx-link-btn" onClick={onViewChallenges}>Voir tous mes challenges</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carte de synthèse générique (Alter Ego / Archétype)                  */
/* ------------------------------------------------------------------ */

function HomeCard({ icon: Icon, title, onOpen, children }) {
  return (
    <button className="gpx-home-card" onClick={onOpen}>
      <div className="gpx-home-card-head">
        <span className="gpx-home-card-title"><span className="gpx-section-icon" aria-hidden="true"><Icon size={15} /></span> {title}</span>
        <ArrowRight size={18} className="gpx-home-card-arrow" />
      </div>
      <div className="gpx-home-card-body">{children}</div>
    </button>
  );
}

function AlterEgoPreview({ progression, onOpen }) {
  const xp = getXpProgress(progression.xp);
  const pct = Math.round(xp.progress * 100);
  return (
    <HomeCard icon={Trophy} title="Alter Ego" onOpen={onOpen}>
      <div className="gpx-home-card-headline">Niveau {progression.level}</div>
      <div className="gpx-home-card-sub">{progression.title} · {progression.xp} XP</div>
      <div className="gpx-xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Progression vers le niveau ${progression.level + 1}`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="gpx-profile-card-meta">{pct}% vers le niveau {progression.level + 1}</div>
      <span className="gpx-home-card-link">Voir Alter Ego</span>
    </HomeCard>
  );
}

function ArchetypePreview({ archetypeMatch, onOpen }) {
  return (
    <HomeCard icon={Fingerprint} title="Ton archétype" onOpen={onOpen}>
      <div className="gpx-home-card-headline">{archetypeMatch.combinedLabel}</div>
      {archetypeMatch.primary?.description && <p className="gpx-archetype-desc">{archetypeMatch.primary.description}</p>}
      <span className="gpx-home-card-link">Voir mon archétype</span>
    </HomeCard>
  );
}

/* ------------------------------------------------------------------ */
/* Ton profil (aperçu)                                                  */
/* ------------------------------------------------------------------ */

function ProfilePreviewSection({ profile, onOpen }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={UserRound} right={<button className="gpx-link-btn" onClick={onOpen}>Voir le profil complet</button>}>
        Ton profil
      </SectionTitle>
      <p className="gpx-profile-card-meta gpx-home-count">
        {profile.activityCount} sortie{profile.activityCount > 1 ? "s" : ""} analysée{profile.activityCount > 1 ? "s" : ""}
      </p>
      <div className="gpx-dims">
        {HOME_DIMENSION_ORDER.map((key) => {
          const dim = profile.dimensions[key];
          const meta = DIMENSION_META[key];
          return (
            <div className="gpx-dim" key={key} style={{ "--dim-accent": meta.accent }}>
              <div className="gpx-dim-head"><span><meta.icon size={15} />{meta.label}</span></div>
              {dim.value == null ? (
                <>
                  <div className="gpx-dim-missing">Données insuffisantes</div>
                  <div className="gpx-dim-bar" />
                </>
              ) : (
                <>
                  <div className="gpx-dim-value">{dim.value}<small>/100</small></div>
                  <div className="gpx-dim-bar"><div style={{ width: `${Math.max(0, Math.min(100, dim.value))}%` }} /></div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dernière sortie                                                      */
/* ------------------------------------------------------------------ */

function LastRideSection({ lastActivity, onOpen }) {
  const speed = lastActivity ? lastActivity.avgSpeed : null;
  const power = lastActivity ? lastActivity.avgPower : null;
  const estimated = !!(lastActivity && lastActivity.flags && lastActivity.flags.powerEstimated);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Sparkles}>Dernière sortie</SectionTitle>
      {!lastActivity ? (
        <>
          <p className="gpx-summary-text">Aucune sortie enregistrée.</p>
          <p className="gpx-empty-note">Importe ta première activité pour commencer à construire ton profil.</p>
        </>
      ) : (
        <div className="gpx-lastride">
          <div>
            <div className="gpx-lastride-name">{lastActivity.name || "Sortie vélo"}</div>
            <div className="gpx-lastride-date">
              {lastActivity.date ? fmtDateFull(new Date(lastActivity.date)) : "Date inconnue"}
            </div>
            <div className="gpx-lastride-stats">
              <div className="gpx-lastride-stat">
                <span className="gpx-lastride-stat-label">Distance</span>
                <span className="gpx-lastride-stat-value">{fmt1(lastActivity.distance)}<small>km</small></span>
              </div>
              <div className="gpx-lastride-stat">
                <span className="gpx-lastride-stat-label">Durée</span>
                <span className="gpx-lastride-stat-value">{fmtDuration(lastActivity.movingTime ?? lastActivity.duration)}</span>
              </div>
              {speed != null && (
                <div className="gpx-lastride-stat">
                  <span className="gpx-lastride-stat-label">Vitesse moyenne</span>
                  <span className="gpx-lastride-stat-value">{fmt1(speed)}<small>km/h</small></span>
                </div>
              )}
              {lastActivity.elevationGain != null && (
                <div className="gpx-lastride-stat">
                  <span className="gpx-lastride-stat-label">Dénivelé</span>
                  <span className="gpx-lastride-stat-value">+{fmtInt(lastActivity.elevationGain)}<small>m</small></span>
                </div>
              )}
              {power != null && (
                <div className="gpx-lastride-stat">
                  <span className="gpx-lastride-stat-label">Puissance moyenne</span>
                  <span className="gpx-lastride-stat-value">{fmtInt(power)}<small>W</small></span>
                  <span className={estimated ? "gpx-power-source-estimated" : "gpx-power-source"}>{estimated ? "estimée" : "mesurée"}</span>
                </div>
              )}
            </div>
          </div>
          <button className="gpx-btn-primary gpx-lastride-cta" onClick={onOpen}>Voir l'analyse <ArrowRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* État vide / import (repris de l'écran d'import existant)            */
/* ------------------------------------------------------------------ */

function EmptyStateImport({ storage, onConnect, onReconnect, upload, onLoadDemo, onOpenSources }) {
  return (
    <div className="gpx-landing-inner">
      <div className="gpx-landing-eyebrow"><Mountain size={13} /> Analyse de sortie vélo</div>
      <h1 className="gpx-landing-title">Importez votre sortie<br /><span>GPX ou FIT</span></h1>
      <p className="gpx-landing-sub">
        Glissez un fichier GPX ou FIT pour obtenir un tableau de bord complet — carte, montées, splits, effort —
        calculé entièrement dans votre navigateur, sans compte ni serveur.
      </p>
      <div
        className={"gpx-upload-zone" + (upload.dragOver ? " drag" : "")}
        onDragOver={upload.onDragOver}
        onDragLeave={upload.onDragLeave}
        onDrop={upload.onDrop}
        onClick={upload.onBrowseClick}
      >
        <div className="gpx-upload-icon"><Upload size={24} /></div>
        <div className="gpx-upload-title">Glissez-déposez votre fichier .gpx ou .fit ici</div>
        <div className="gpx-upload-sub">ou cliquez pour parcourir vos fichiers</div>
        <button className="gpx-btn-primary" onClick={(e) => { e.stopPropagation(); upload.onBrowseClick(); }}>
          <Upload size={15} /> Importer une sortie
        </button>
      </div>
      {upload.error && <div className="gpx-error-box"><FileWarning size={15} /> {upload.error}</div>}
      <div className="gpx-landing-demo">
        <button className="gpx-link-btn" onClick={onLoadDemo}>Voir un exemple avec des données de démonstration (fictives)</button>
      </div>
      <div className="gpx-landing-storage">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} compact />
        {onOpenSources && (
          <button className="gpx-link-btn" onClick={onOpenSources}>
            Sources de données (Strava…)
          </button>
        )}
      </div>
      <div className="gpx-landing-features">
        <div className="gpx-landing-feature"><b>100% local</b>Aucune donnée n'est envoyée à un serveur.</div>
        <div className="gpx-landing-feature"><b>Détection auto</b>Montées, arrêts et meilleurs efforts calculés automatiquement.</div>
        <div className="gpx-landing-feature"><b>Adapté aux données dispo</b>FC, cadence, puissance affichées seulement si présentes.</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} props
 * @param {Object} props.storage
 * @param {Function} props.onConnect
 * @param {Function} props.onReconnect
 * @param {Function} props.onNavigate - (section: "rides"|"profil"|"alterego"|"archetype") => void
 * @param {Function} props.onOpenActivity - (id) => void, ouvre une sortie dans l'analyse
 * @param {Function} props.onLoadDemo
 * @param {Object} props.upload - { dragOver, onDragOver, onDragLeave, onDrop, onBrowseClick, error } — le
 *   `<input type="file">` réel est unique dans toute l'app, monté une fois par GPXAnalyzer.jsx ; `onBrowseClick`
 *   se contente de déclencher son clic, cette vue n'en rend jamais un second (voir GPXAnalyzer.jsx: fileInputRef).
 */
export function HomeView({ storage, onConnect, onReconnect, onNavigate, onOpenActivity, onLoadDemo, upload, onOpenSources }) {
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
    const toLoad = summaries.slice(0, MAX_HOME_ACTIVITIES);
    loadCachedActivityDetails(storage.rootHandle, toLoad).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? getCachedProfile(fullActivities) : null), [fullActivities]);
  const progression = useMemo(() => (fullActivities ? getCachedProgression(fullActivities, profile) : null), [fullActivities, profile]);
  const archetypeMatch = useMemo(() => (profile ? getCachedArchetypeMatch(profile) : null), [profile]);
  const lastActivity = fullActivities && fullActivities.length > 0 ? fullActivities[0] : null;

  const isLoading = storage.status === "connected" && (summaries === null || (summaries.length > 0 && fullActivities === null));
  const isEmpty = storage.status !== "connected" || (summaries != null && summaries.length === 0);
  const hasData = storage.status === "connected" && !isLoading && !isEmpty && profile != null;

  return (
    <div className="gpx-dashboard">
      {summariesError ? (
        <div className="gpx-panel">
          <div className="gpx-error-box">{summariesError}</div>
        </div>
      ) : isLoading ? (
        <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
      ) : isEmpty ? (
        <div className="gpx-landing gpx-landing--embedded">
          <EmptyStateImport storage={storage} onConnect={onConnect} onReconnect={onReconnect} upload={upload} onLoadDemo={onLoadDemo} onOpenSources={onOpenSources} />
        </div>
      ) : hasData ? (
        <>
          <header className="gpx-home-head">
            <p className="gpx-home-date">{formatToday()}</p>
            <h1 className="gpx-home-title">Bonjour.</h1>
            <p className="gpx-home-lede">Ton identité cycliste, en un coup d'œil.</p>
          </header>

          {failedCount > 0 && (
            <div className="gpx-profile-banner">
              <AlertTriangle size={14} />
              {failedCount} sortie{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être chargée{failedCount > 1 ? "s" : ""}. Cet aperçu est calculé à partir des sorties disponibles.
            </div>
          )}

          <div className="gpx-home-grid">
            <Reveal className="gpx-span-8"><FocusSection profile={profile} progression={progression} onViewChallenges={() => onNavigate("alterego")} /></Reveal>
            <Reveal className="gpx-span-4 gpx-home-ae" delay={40}><AlterEgoPreview progression={progression} onOpen={() => onNavigate("alterego")} /></Reveal>
            <Reveal className="gpx-span-12 gpx-home-last" delay={80}><LastRideSection lastActivity={lastActivity} onOpen={lastActivity ? () => onOpenActivity(lastActivity.id) : undefined} /></Reveal>
            <Reveal className="gpx-span-7 gpx-home-profile" delay={120}><ProfilePreviewSection profile={profile} onOpen={() => onNavigate("profil")} /></Reveal>
            <Reveal className="gpx-span-5 gpx-home-ar" delay={160}><ArchetypePreview archetypeMatch={archetypeMatch} onOpen={() => onNavigate("archetype")} /></Reveal>
          </div>

          <div className="gpx-panel gpx-home-import-compact">
            <SectionTitle icon={Upload}>Importer une nouvelle sortie</SectionTitle>
            <div
              className={"gpx-upload-zone" + (upload.dragOver ? " drag" : "")}
              onDragOver={upload.onDragOver}
              onDragLeave={upload.onDragLeave}
              onDrop={upload.onDrop}
              onClick={upload.onBrowseClick}
              style={{ padding: "18px 20px" }}
            >
              <div className="gpx-upload-title">Glissez-déposez un fichier .gpx ou .fit ici</div>
              <div className="gpx-upload-sub">ou cliquez pour parcourir vos fichiers</div>
            </div>
            {upload.error && <div className="gpx-error-box" style={{ marginTop: 10 }}><FileWarning size={15} /> {upload.error}</div>}
            {onOpenSources && (
              <button className="gpx-link-btn" style={{ marginTop: 10 }} onClick={onOpenSources}>
                Sources de données (Strava…)
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
