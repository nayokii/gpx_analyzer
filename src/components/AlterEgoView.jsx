/**
 * ALTER EGO — couche de progression en lecture/écriture légère au-dessus du
 * moteur de progression (Phase 7, voir src/lib/progression/) et du profil
 * (Phase 6A). Ne recalcule ni le profil ni la progression différemment de ce
 * que produisent `computeCyclistProfile()`/`computeProgression()` — cette vue
 * assemble et affiche, elle ne réinterprète rien.
 *
 * Chargement des données : IDENTIQUE au pattern de ProfileView.jsx (index
 * léger via listActivities, puis détail complet via loadActivityDetail,
 * Promise.allSettled, plafonné) — un seul système de chargement, pas de
 * deuxième mécanisme. Voir MAX_PROGRESSION_ACTIVITIES.
 *
 * Persistence : une fois la progression fraîchement recalculée depuis
 * l'historique complet, un instantané est sauvegardé dans athlete.json
 * (voir lib/progression/persistence.js) — en tâche de fond, jamais bloquant
 * pour l'affichage (qui utilise toujours le résultat frais recalculé, pas
 * une relecture du cache). Le mode démo (activité en mémoire, jamais
 * enregistrée par GPXAnalyzer.jsx: loadDemo()) ne peut structurellement pas
 * polluer cette progression : cette vue ne lit JAMAIS l'activité "ouverte"
 * dans le dashboard, seulement l'historique persisté du dossier connecté —
 * exactement comme ProfileView.jsx.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Info, Trophy, Target, Zap, Mountain, Flame, Gauge, Repeat, Bike, Timer, AlertTriangle, Lock, Fingerprint,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities, loadActivityDetail } from "../lib/storage/activityStore.js";
import { computeCyclistProfile } from "../lib/profile/profile.js";
import { computeProgression } from "../lib/progression/progression.js";
import { loadProgressionState, saveProgressionState } from "../lib/progression/persistence.js";
import { progressionToState } from "../lib/progression/state.js";
import { matchArchetypes, matchReferenceRiders } from "../lib/archetypes/matching.js";

// Même principe que MAX_PROFILE_ACTIVITIES (ProfileView.jsx) / MAX_ROUTE_ANALYSIS_ACTIVITIES (HistoryDashboard.jsx).
const MAX_PROGRESSION_ACTIVITIES = 200;

const DIMENSION_META = {
  endurance: { label: "Endurance", icon: Timer },
  climbing: { label: "Grimpe", icon: Mountain },
  punch: { label: "Punch", icon: Zap },
  sprint: { label: "Sprint", icon: Flame },
  timeTrial: { label: "CLM", icon: Gauge },
  technical: { label: "Technique", icon: Bike },
  consistency: { label: "Régularité", icon: Repeat },
};
const DIMENSION_ORDER = ["endurance", "climbing", "punch", "sprint", "timeTrial", "technical", "consistency"];

function pluralize(n, word, pluralWord = `${word}s`) {
  return n > 1 ? pluralWord : word;
}

/* ------------------------------------------------------------------ */
/* Niveau / XP                                                          */
/* ------------------------------------------------------------------ */

function LevelHeader({ progression }) {
  const { level, title, levelProgress } = progression;
  const pct = Math.round(levelProgress.progress * 100);
  return (
    <div className="gpx-panel gpx-alterego-level">
      <div className="gpx-alterego-level-head">
        <div>
          <div className="gpx-alterego-level-title">Niveau {level} — {title}</div>
          <div className="gpx-alterego-level-xp">
            {levelProgress.currentXp} / {levelProgress.levelXp} XP
          </div>
        </div>
        <Trophy size={28} className="gpx-alterego-trophy" />
      </div>
      <div className="gpx-alterego-level-bar">
        <div className="gpx-alterego-level-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="gpx-profile-card-hint">
        {levelProgress.remaining > 0 ? `${levelProgress.remaining} XP avant le niveau ${level + 1}` : "Niveau maximal atteint pour cette échelle"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profil (réutilisé tel quel, jamais recalculé)                       */
/* ------------------------------------------------------------------ */

function ProfileSummarySection({ profile }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Target}>Profil actuel</SectionTitle>
      <div className="gpx-alterego-profile-list">
        {DIMENSION_ORDER.map((key) => {
          const dim = profile.dimensions[key];
          const meta = DIMENSION_META[key];
          return (
            <div className="gpx-alterego-profile-row" key={key}>
              <span className="gpx-alterego-profile-row-label"><meta.icon size={13} /> {meta.label}</span>
              <span className={dim.value == null ? "gpx-profile-card-value-empty" : ""}>{dim.value ?? "—"}</span>
            </div>
          );
        })}
      </div>
      <p className="gpx-empty-note" style={{ marginTop: 10 }}>Indices internes (voir l'onglet Profil) — pas un pourcentage de capacité humaine.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Résumé archétype (Phase 8) — consomme archetypes.js, ne recalcule rien */
/* ------------------------------------------------------------------ */

function ArchetypeSummarySection({ profile, onViewArchetype }) {
  const match = useMemo(() => matchArchetypes(profile), [profile]);
  const topRider = useMemo(() => matchReferenceRiders(profile, { limit: 1 })[0] || null, [profile]);

  return (
    <div className="gpx-panel">
      <SectionTitle
        icon={Fingerprint}
        right={onViewArchetype ? <button className="gpx-link-btn" onClick={onViewArchetype}>Voir le détail</button> : null}
      >
        Archétype actuel
      </SectionTitle>
      <div className="gpx-archetype-headline" style={{ fontSize: 20 }}>{match.combinedLabel}</div>
      {topRider && (
        <p className="gpx-profile-card-meta" style={{ marginTop: 6 }}>Profil similaire : {topRider.rider.name}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Challenges                                                          */
/* ------------------------------------------------------------------ */

function ChallengeRow({ challenge }) {
  const pct = challenge.target > 0 ? Math.max(0, Math.min(100, (challenge.current / challenge.target) * 100)) : 0;
  return (
    <div className="gpx-alterego-challenge">
      <div className="gpx-alterego-challenge-head">
        <span>○ {challenge.label}</span>
        <span className="gpx-alterego-xp-badge">+{challenge.xpReward} XP</span>
      </div>
      <div className="gpx-profile-card-bar"><div className="gpx-profile-card-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="gpx-profile-card-meta">{challenge.current} / {challenge.target} {challenge.unit}</div>
      {challenge.reason && <div className="gpx-profile-card-hint">{challenge.reason}</div>}
    </div>
  );
}

function CompletedMilestoneRow({ milestone }) {
  return (
    <div className="gpx-alterego-challenge gpx-alterego-challenge-done">
      <div className="gpx-alterego-challenge-head">
        <span>✓ {milestone.reason}</span>
        <span className="gpx-alterego-xp-badge">+{milestone.xp} XP</span>
      </div>
    </div>
  );
}

function ChallengesSection({ challenges, completedMilestones }) {
  const recentCompleted = completedMilestones.slice(0, 5);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Target}>Challenges</SectionTitle>
      {challenges.length === 0 && recentCompleted.length === 0 ? (
        <p className="gpx-empty-note">Pas encore assez de sorties pour proposer un challenge.</p>
      ) : (
        <>
          {challenges.map((c) => <ChallengeRow key={c.id} challenge={c} />)}
          {recentCompleted.length > 0 && (
            <>
              <div className="gpx-alterego-subheading">Récemment complétés</div>
              {recentCompleted.map((m, i) => <CompletedMilestoneRow key={i} milestone={m} />)}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

function AchievementBadge({ achievement }) {
  return (
    <div className={"gpx-alterego-achievement" + (achievement.unlocked ? " gpx-alterego-achievement-unlocked" : "")}>
      {achievement.unlocked ? <span className="gpx-alterego-achievement-check">✓</span> : <Lock size={12} />}
      <span>{achievement.label}</span>
    </div>
  );
}

function AchievementsSection({ achievements }) {
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Trophy} right={<span className="gpx-profile-card-meta">{unlockedCount} / {achievements.length}</span>}>
        Achievements
      </SectionTitle>
      <div className="gpx-alterego-achievement-grid">
        {achievements.map((a) => <AchievementBadge key={a.id} achievement={a} />)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Historique XP récent                                                */
/* ------------------------------------------------------------------ */

function RecentXpSection({ events, onOpen }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Zap}>Activité récente</SectionTitle>
      {events.length === 0 ? (
        <p className="gpx-empty-note">Aucun événement XP pour l'instant.</p>
      ) : (
        <ul className="gpx-profile-evidence-list">
          {events.map((e, i) => (
            <li
              key={i}
              className={onOpen ? "gpx-row-clickable" : undefined}
              onClick={onOpen ? () => onOpen(e.activityId) : undefined}
              title={onOpen ? "Ouvrir cette sortie" : undefined}
            >
              +{e.xp} XP — {e.reason}
            </li>
          ))}
        </ul>
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
 * @param {Function} [props.onOpen] - Ouvre une activité par id (optionnel)
 * @param {Function} [props.onViewArchetype] - Navigue vers la vue Archétype (optionnel)
 * @param {Function} props.onBack
 */
export function AlterEgoView({ storage, onConnect, onReconnect, onOpen, onViewArchetype, onBack }) {
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
    const toLoad = summaries.slice(0, MAX_PROGRESSION_ACTIVITIES);
    Promise.allSettled(toLoad.map((a) => loadActivityDetail(storage.rootHandle, a.id))).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? computeCyclistProfile(fullActivities) : null), [fullActivities]);
  const progression = useMemo(() => (fullActivities ? computeProgression(fullActivities, profile) : null), [fullActivities, profile]);

  // Cache best-effort dans athlete.json — jamais bloquant, jamais relu pour
  // l'affichage (qui utilise toujours `progression` fraîchement recalculé
  // ci-dessus). Voir lib/progression/state.js pour pourquoi ce n'est qu'un cache.
  useEffect(() => {
    if (!progression || storage.status !== "connected" || !storage.rootHandle) return;
    let cancelled = false;
    loadProgressionState(storage.rootHandle).then((previous) => {
      if (cancelled) return;
      const state = progressionToState(progression, previous);
      saveProgressionState(storage.rootHandle, state).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [progression, storage.status, storage.rootHandle]);

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name">Alter Ego</h1>
          <div className="gpx-ride-meta">
            {progression ? (
              <span>Basé sur {progression.activityCount} {pluralize(progression.activityCount, "sortie")}</span>
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
              <p className="gpx-summary-text">Ton Alter Ego apparaîtra ici après ta première sortie.</p>
              <p className="gpx-empty-note">Importe un GPX ou un FIT pour commencer.</p>
            </div>
          ) : fullActivities == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className="gpx-profile-banner">
                  <AlertTriangle size={14} />
                  {failedCount} {pluralize(failedCount, "sortie n'a", "sorties n'ont")} pas pu être {pluralize(failedCount, "chargée")}. La progression est calculée à partir des sorties disponibles.
                </div>
              )}
              {summaries.length > MAX_PROGRESSION_ACTIVITIES && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Progression basée sur les {MAX_PROGRESSION_ACTIVITIES} sorties les plus récentes (sur {summaries.length} au total).
                </div>
              )}
              {progression.activityCount === 1 && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Alter Ego en construction — 1 sortie analysée. Plus de sorties débloqueront davantage de challenges et d'achievements.
                </div>
              )}

              <LevelHeader progression={progression} />
              <ProfileSummarySection profile={progression.profileSnapshot} />
              <ArchetypeSummarySection profile={progression.profileSnapshot} onViewArchetype={onViewArchetype} />
              <ChallengesSection challenges={progression.challenges} completedMilestones={progression.completedMilestones} />
              <AchievementsSection achievements={progression.achievements} />
              <RecentXpSection events={progression.recentEvents} onOpen={onOpen} />
            </>
          )}
        </>
      )}
    </div>
  );
}
