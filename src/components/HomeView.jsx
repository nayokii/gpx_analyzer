/**
 * ACCUEIL — vue de synthèse, pas un fourre-tout. Donne un aperçu de chaque
 * grand espace (Alter Ego, Profil, Archétype, dernière sortie) et donne
 * envie d'y aller — chaque carte ouvre la page correspondante, mais CHAQUE
 * page reste par ailleurs directement accessible depuis la navigation
 * principale (voir AppNav.jsx) : l'accueil n'est plus le seul chemin vers
 * ces sections.
 *
 * Ne recalcule rien de neuf : réutilise exactement les mêmes moteurs que
 * ProfileView.jsx/AlterEgoView.jsx/ArchetypeView.jsx
 * (computeCyclistProfile/computeProgression/matchArchetypes), avec le même
 * pattern de chargement (listActivities → loadActivityDetail, plafonné).
 *
 * État vide (pas de dossier connecté OU aucune sortie) : reprend l'écran
 * d'import existant tel quel (mêmes classes `.gpx-upload-zone`/
 * `.gpx-landing-*`, déjà éprouvées) — ne réinvente pas cette expérience,
 * l'accueil l'englobe simplement.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Mountain, Upload, FileWarning, Sparkles, ArrowRight, Timer, Zap, Flame, Gauge, Bike, Trophy, UserRound, Fingerprint,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities, loadActivityDetail } from "../lib/storage/activityStore.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { computeProgression } from "../lib/progression/progression.js";
import { getXpProgress } from "../lib/progression/levels.js";
import { matchArchetypes } from "../lib/archetypes/matching.js";
import { fmt1, fmtDuration, fmtDateFull } from "../lib/utils.js";

const MAX_HOME_ACTIVITIES = 200; // même principe que MAX_PROFILE_ACTIVITIES (ProfileView.jsx)
const XP_RECENT_WINDOW_DAYS = 7;

const DIMENSION_META = {
  endurance: { label: "Endurance", icon: Timer },
  climbing: { label: "Grimpe", icon: Mountain },
  punch: { label: "Punch", icon: Zap },
  sprint: { label: "Sprint", icon: Flame },
  timeTrial: { label: "CLM", icon: Gauge },
  technical: { label: "Technique", icon: Bike },
};
const HOME_DIMENSION_ORDER = ["endurance", "climbing", "punch", "sprint"];

function xpInLastDays(events, days, now) {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return events.filter((e) => e.date && new Date(e.date) >= cutoff).reduce((sum, e) => sum + e.xp, 0);
}

/* ------------------------------------------------------------------ */
/* Carte de synthèse générique                                         */
/* ------------------------------------------------------------------ */

function HomeCard({ icon: Icon, title, onOpen, children }) {
  return (
    <button className="gpx-home-card" onClick={onOpen}>
      <div className="gpx-home-card-head">
        <span className="gpx-home-card-title"><Icon size={15} /> {title}</span>
        <ArrowRight size={14} className="gpx-home-card-arrow" />
      </div>
      <div className="gpx-home-card-body">{children}</div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* État vide / import (repris de l'écran d'import existant)            */
/* ------------------------------------------------------------------ */

function EmptyStateImport({ storage, onConnect, onReconnect, upload, onLoadDemo }) {
  return (
    <div className="gpx-landing-inner" style={{ margin: "0 auto" }}>
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
      <div className="gpx-panel" style={{ marginTop: 24, textAlign: "left" }}>
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} compact />
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
export function HomeView({ storage, onConnect, onReconnect, onNavigate, onOpenActivity, onLoadDemo, upload }) {
  const [summaries, setSummaries] = useState(null);
  const [fullActivities, setFullActivities] = useState(null);

  const refresh = useCallback(() => {
    if (storage.status !== "connected" || !storage.rootHandle) return;
    setSummaries(null);
    setFullActivities(null);
    listActivities(storage.rootHandle).then(setSummaries).catch(() => setSummaries([]));
  }, [storage.status, storage.rootHandle]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!summaries || summaries.length === 0 || !storage.rootHandle) return;
    let cancelled = false;
    const toLoad = summaries.slice(0, MAX_HOME_ACTIVITIES);
    Promise.allSettled(toLoad.map((a) => loadActivityDetail(storage.rootHandle, a.id))).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? computeCyclistProfile(fullActivities) : null), [fullActivities]);
  const progression = useMemo(() => (fullActivities ? computeProgression(fullActivities, profile) : null), [fullActivities, profile]);
  const archetypeMatch = useMemo(() => (profile ? matchArchetypes(profile) : null), [profile]);
  const lastActivity = fullActivities && fullActivities.length > 0 ? fullActivities[0] : null;
  const xpThisWeek = useMemo(
    () => (progression ? xpInLastDays(progression.recentEvents, XP_RECENT_WINDOW_DAYS, new Date()) : 0),
    [progression]
  );

  const hasData = storage.status === "connected" && summaries != null && summaries.length > 0 && fullActivities != null;

  return (
    <div className="gpx-dashboard">
      {!hasData ? (
        <div className="gpx-landing" style={{ minHeight: "auto", padding: "40px 20px" }}>
          <EmptyStateImport storage={storage} onConnect={onConnect} onReconnect={onReconnect} upload={upload} onLoadDemo={onLoadDemo} />
        </div>
      ) : (
        <>
          <div className="gpx-header">
            <div className="gpx-header-left">
              <h1 className="gpx-ride-name">Bonjour.</h1>
              <div className="gpx-ride-meta"><span>Ton identité cycliste, en un coup d'œil.</span></div>
            </div>
          </div>

          <div className="gpx-home-grid">
            <HomeCard icon={Trophy} title="Alter Ego" onOpen={() => onNavigate("alterego")}>
              <div className="gpx-home-card-headline">Niveau {progression.level} — {progression.title}</div>
              <div className="gpx-profile-card-bar" style={{ margin: "8px 0" }}>
                <div className="gpx-profile-card-bar-fill" style={{ width: `${Math.round(getXpProgress(progression.xp).progress * 100)}%` }} />
              </div>
              <div className="gpx-profile-card-meta">{xpThisWeek > 0 ? `+${xpThisWeek} XP cette semaine` : "Pas d'XP cette semaine"}</div>
            </HomeCard>

            <HomeCard icon={UserRound} title="Profil" onOpen={() => onNavigate("profil")}>
              <div className="gpx-alterego-profile-list">
                {HOME_DIMENSION_ORDER.map((key) => {
                  const dim = profile.dimensions[key];
                  const meta = DIMENSION_META[key];
                  return (
                    <div className="gpx-alterego-profile-row" key={key}>
                      <span className="gpx-alterego-profile-row-label"><meta.icon size={12} /> {meta.label}</span>
                      <span className={dim.value == null ? "gpx-profile-card-value-empty" : ""}>{dim.value ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            </HomeCard>

            <HomeCard icon={Fingerprint} title="Archétype" onOpen={() => onNavigate("archetype")}>
              <div className="gpx-home-card-headline">{archetypeMatch.combinedLabel}</div>
              {archetypeMatch.explanation[0] && <p className="gpx-empty-note" style={{ fontStyle: "normal", marginTop: 6 }}>{archetypeMatch.explanation[0]}</p>}
            </HomeCard>

            <HomeCard
              icon={Sparkles}
              title="Dernière sortie"
              onOpen={lastActivity ? () => onOpenActivity(lastActivity.id) : () => onNavigate("rides")}
            >
              {lastActivity ? (
                <>
                  <div className="gpx-home-card-headline">{lastActivity.name || "Sortie vélo"}</div>
                  <div className="gpx-profile-card-meta">
                    {lastActivity.date ? fmtDateFull(new Date(lastActivity.date)) : "Date inconnue"}
                  </div>
                  <div className="gpx-profile-card-meta" style={{ marginTop: 4 }}>
                    {fmt1(lastActivity.distance)} km · {fmtDuration(lastActivity.movingTime ?? lastActivity.duration)}
                    {lastActivity.avgSpeed != null ? ` · ${fmt1(lastActivity.avgSpeed)} km/h` : ""}
                  </div>
                </>
              ) : (
                <p className="gpx-empty-note">Aucune sortie récente.</p>
              )}
            </HomeCard>
          </div>

          <div className="gpx-panel" style={{ marginTop: 4 }}>
            <SectionTitle icon={Upload}>Importer une nouvelle sortie</SectionTitle>
            <div
              className={"gpx-upload-zone" + (upload.dragOver ? " drag" : "")}
              onDragOver={upload.onDragOver}
              onDragLeave={upload.onDragLeave}
              onDrop={upload.onDrop}
              onClick={upload.onBrowseClick}
              style={{ padding: "24px 20px" }}
            >
              <div className="gpx-upload-title">Glissez-déposez un fichier .gpx ou .fit ici</div>
              <div className="gpx-upload-sub">ou cliquez pour parcourir vos fichiers</div>
            </div>
            {upload.error && <div className="gpx-error-box" style={{ marginTop: 10 }}><FileWarning size={15} /> {upload.error}</div>}
          </div>
        </>
      )}
    </div>
  );
}
