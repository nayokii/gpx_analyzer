/**
 * TOUR SIMULATOR — couche UI (Phase 10B) au-dessus du moteur pur
 * src/lib/simulator/ (Phase 10A, voir README.md). Ne recalcule jamais le
 * profil ni n'invente de scoring parallèle : consomme `CyclistProfile`
 * (déjà calculé, voir derivedCache.js — jamais recalculé ici) et
 * `simulateTour()` tels quels, affiche uniquement leurs résultats.
 *
 * Chargement des données : IDENTIQUE au pattern de ProfileView.jsx/
 * ArchetypeView.jsx/AlterEgoView.jsx (index léger via listActivities, puis
 * détail complet via loadCachedActivityDetails, Promise.allSettled,
 * plafonné à MAX_TOUR_ACTIVITIES) — un seul système de chargement dans toute
 * l'app, jamais un deuxième mécanisme.
 *
 * Flux (voir consigne §17/§25) :
 *   activities → profile (getCachedProfile, réutilisé) → simulateTour()
 *   (Phase 10A, pur) → affichage.
 * Le résultat d'une simulation n'est JAMAIS réinjecté dans le profil ou la
 * progression : "simulation → profile" est interdit. `simulateTour()` n'est
 * appelé qu'à la demande (bouton "Commencer"/"Rejouer") et son résultat vit
 * uniquement dans l'état local de ce composant — jamais persisté, jamais lu
 * par un autre écran.
 *
 * Seed & rejeu (voir consigne §15/§16) : "Commencer" et "Rejouer" génèrent
 * chacun un nouveau seed (horodatage + aléa, non cryptographique — un simple
 * numéro de partie, jamais une donnée de profil) conservé dans l'état de
 * session (`tourState.seed`) pour permettre de reproduire exactement le même
 * résultat si besoin ; le moteur lui-même reste pur (aucun seed n'est
 * généré à l'intérieur de simulateTour(), voir simulation.js). Un seul
 * bouton "Rejouer" a été choisi plutôt que deux boutons distincts
 * "Rejouer"/"Rejouer le même Tour" : le Tour générique actuel est unique
 * (pas encore de choix de parcours, voir Phase 10A §13), donc "rejouer le
 * même Tour avec un nouveau seed" et "rejouer" désignent la même action tant
 * qu'un second parcours n'existe pas — les deux options du choix demandé
 * convergent ici.
 *
 * Étape par étape (voir consigne §8) : le moteur ne simule PAS de façon
 * incrémentale — `simulateTour()` calcule tout le Tour en une seule passe
 * (coût O(étapes × dimensions), voir README.md § Performance). Ce composant
 * se contente de DÉVOILER progressivement un résultat déjà calculé,
 * étape après étape (`tourState.currentIndex`/`revealed`) — jamais de
 * relancer une simulation partielle ni un second calcul.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Flag, Mountain, Zap, Flame, Gauge, Bike, Timer, UserRound,
  AlertTriangle, Info, Play, RotateCcw, ChevronRight,
} from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities } from "../lib/storage/activityStore.js";
import { loadCachedActivityDetails } from "../lib/storage/activityCache.js";
import { getCachedProfile } from "../lib/derivedCache.js";
import { ARCHETYPE_DIMENSIONS } from "../lib/archetypes/archetypes.js";
import { simulateTour, createGenericTour, getStageTypeProfile, categorizeAffinity } from "../lib/simulator/index.js";

// Même principe que MAX_PROFILE_ACTIVITIES (ProfileView.jsx).
const MAX_TOUR_ACTIVITIES = 200;
// Même seuil que FocusSection: coldStart dans HomeView.jsx — réutilisé ici
// pour la même raison (moins de 2 sorties = pas encore assez de matière pour
// une expérience utile), pas un nouveau seuil inventé pour cette vue.
const COLD_START_ACTIVITY_THRESHOLD = 2;
const DIFFICULTY_DOTS = 5;

const DIMENSION_META = {
  endurance: { label: "Endurance", icon: Timer },
  climbing: { label: "Climbing", icon: Mountain },
  punch: { label: "Punch", icon: Zap },
  sprint: { label: "Sprint", icon: Flame },
  timeTrial: { label: "Time Trial", icon: Gauge },
  technical: { label: "Technical", icon: Bike },
};

const CONFIDENCE_LABELS = { low: "faible", medium: "moyenne", high: "élevée" };

// Traduction d'affichage des catégories DÉJÀ produites par results.js
// (categorizePerformanceBand) — jamais un nouveau classement, une simple
// table de libellés comme CONFIDENCE_LABELS ci-dessus.
const PERFORMANCE_BAND_LABELS = {
  very_strong: "Très solide",
  strong: "Solide",
  neutral: "Neutre",
  below_average: "En dessous",
  struggling: "Difficile",
  insufficient_data: "Données insuffisantes",
};

// Champs déjà produits par buildOverallResult() (results.js) — jamais un
// nouvel agrégat recalculé ici. Pas d'entrée "sprint" : ce n'est pas un type
// d'étape (voir stageTypes.js), seulement une dimension de profil.
const TERRAIN_AFFINITY_FIELDS = [
  { key: "mountainAffinity", label: "Montagne" },
  { key: "hillyAffinity", label: "Vallonné" },
  { key: "timeTrialAffinity", label: "Contre-la-montre" },
  { key: "flatAffinity", label: "Plaine" },
];

/**
 * Bucket UNIQUEMENT présentationnel (jamais réutilisé comme donnée) pour
 * nommer la fatigue simulée brute (0-1, voir fatigue.js) — le moteur
 * n'expose que le nombre, cette fonction se contente de le nommer pour
 * l'affichage, jamais de le recalculer.
 * @param {number|null} value
 * @returns {string}
 */
function fatigueLabel(value) {
  if (value == null) return "—";
  if (value < 0.34) return "Faible";
  if (value < 0.67) return "Modérée";
  return "Élevée";
}

function pct(v) {
  return v == null ? null : Math.round(v * 100);
}

/** Numéro de partie non cryptographique — jamais une donnée de profil, voir docstring du module. */
function nextSeed() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Phrase générée à partir du résultat du moteur pour CETTE étape — jamais un
 * texte spécifique au profil hardcodé (voir consigne §9). Vocabulaire
 * volontairement descriptif ("documente"), jamais une affirmation
 * physiologique ("tu es fort en montagne").
 */
function stageExplanation(result) {
  if (result.affinity == null) {
    return "Ton profil ne documente pas encore suffisamment de dimensions pour expliquer cette étape.";
  }
  const level = result.affinity >= 60 ? "une bonne affinité" : result.affinity >= 40 ? "une affinité neutre" : "une affinité plus limitée";
  return `Ton profil documente actuellement ${level} avec les caractéristiques de cette étape.`;
}

/** Phrase de synthèse finale — dérivée des affinités de terrain déjà calculées (results.js), jamais un texte par profil. */
function overallSummarySentence(overall) {
  const scored = TERRAIN_AFFINITY_FIELDS.map((f) => ({ ...f, score: overall[f.key] })).filter((f) => f.score != null);
  if (scored.length === 0) {
    return "Ton profil ne documente pas encore assez de dimensions pour dégager une tendance sur ce parcours.";
  }
  const best = scored.slice().sort((a, b) => b.score - a.score)[0];
  return `Ton profil actuel semble davantage documenter les caractéristiques de terrain ${best.label.toLowerCase()}.`;
}

/* ------------------------------------------------------------------ */
/* Petits primitifs visuels                                             */
/* ------------------------------------------------------------------ */

function DifficultyDots({ value }) {
  const filled = Math.max(0, Math.min(DIFFICULTY_DOTS, Math.round((value || 0) * DIFFICULTY_DOTS)));
  return (
    <span className="gpx-tour-dots" role="img" aria-label={`Difficulté ${filled} sur ${DIFFICULTY_DOTS}`}>
      {Array.from({ length: DIFFICULTY_DOTS }, (_, i) => (
        <span key={i} className={i < filled ? "gpx-tour-dot gpx-tour-dot-filled" : "gpx-tour-dot"} />
      ))}
    </span>
  );
}

function TourProgressBar({ current, total }) {
  const donePct = Math.round((current / total) * 100);
  return (
    <div className="gpx-tour-progress" role="progressbar" aria-valuenow={donePct} aria-valuemin={0} aria-valuemax={100} aria-label="Progression du Tour">
      <div className="gpx-profile-card-meta">Étape {Math.min(current + 1, total)} / {total}</div>
      <div className="gpx-tour-progress-bar"><div className="gpx-tour-progress-bar-fill" style={{ width: `${donePct}%` }} /></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* État initial — profil pas encore assez construit (voir consigne §4) */
/* ------------------------------------------------------------------ */

function ColdStartSection({ activityCount, profile, onViewProfile }) {
  const documented = ARCHETYPE_DIMENSIONS.filter((d) => profile.dimensions[d].value != null);
  const undocumented = ARCHETYPE_DIMENSIONS.filter((d) => profile.dimensions[d].value == null);

  return (
    <div className="gpx-panel gpx-tour-hero">
      <SectionTitle icon={Flag}>Tour Simulator</SectionTitle>
      <div className="gpx-focus-headline">Construis ton profil de coureur à travers tes sorties.</div>
      <p className="gpx-profile-card-meta" style={{ marginTop: 10 }}>
        {activityCount} sortie{activityCount > 1 ? "s" : ""} analysée{activityCount > 1 ? "s" : ""}
      </p>
      {documented.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="gpx-profile-card-meta">Ton profil commence déjà à documenter :</div>
          <ul className="gpx-profile-evidence-list">
            {documented.map((d) => <li key={d}>{DIMENSION_META[d].label}</li>)}
          </ul>
        </div>
      )}
      {undocumented.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="gpx-profile-card-meta">Encore peu documenté :</div>
          <ul className="gpx-profile-evidence-list">
            {undocumented.map((d) => <li key={d}>{DIMENSION_META[d].label}</li>)}
          </ul>
        </div>
      )}
      <button className="gpx-btn-ghost" style={{ marginTop: 16 }} onClick={onViewProfile}>Voir mon profil</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Écran d'accueil du simulateur (profil disponible)                    */
/* ------------------------------------------------------------------ */

function RouteOverviewSection({ stages, onStart }) {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Flag}>Parcours</SectionTitle>
      <div className="gpx-tour-route-head">
        <span className="gpx-home-card-headline">Tour découverte</span>
        <span className="gpx-profile-card-meta">{stages.length} étapes</span>
      </div>
      <ol className="gpx-tour-stage-list">
        {stages.map((stage, i) => {
          const type = getStageTypeProfile(stage.type);
          return (
            <li className="gpx-tour-stage-row" key={stage.id}>
              <span className="gpx-tour-stage-number">{String(i + 1).padStart(2, "0")}</span>
              <span className="gpx-tour-stage-info">
                <span className="gpx-tour-stage-type">{(type ? type.label : stage.type).toUpperCase()}</span>
                <span className="gpx-profile-card-meta">{Math.round(stage.distanceKm)} km</span>
              </span>
              <DifficultyDots value={stage.difficulty} />
            </li>
          );
        })}
      </ol>
      <button className="gpx-btn-primary" style={{ marginTop: 16 }} onClick={onStart}>
        <Play size={15} /> Commencer
      </button>
    </div>
  );
}

function TourDimensionCard({ dimKey, dim }) {
  const meta = DIMENSION_META[dimKey];
  const insufficient = dim.value == null;
  const barWidth = insufficient ? 0 : Math.max(0, Math.min(100, dim.value));
  return (
    <div className="gpx-profile-card">
      <div className="gpx-profile-card-head">
        <meta.icon size={14} />
        <span>{meta.label}</span>
      </div>
      {insufficient ? (
        <>
          <div className="gpx-profile-card-value gpx-profile-card-value-empty">—</div>
          <div className="gpx-profile-card-status">Données insuffisantes</div>
        </>
      ) : (
        <>
          <div className="gpx-profile-card-value">
            {dim.value}
            <span className="gpx-profile-card-value-scale">/100</span>
          </div>
          <div className="gpx-profile-card-bar"><div className="gpx-profile-card-bar-fill" style={{ width: `${barWidth}%` }} /></div>
          <div className="gpx-profile-card-confidence">
            Confiance : <b className={`gpx-confidence-${dim.confidenceLabel}`}>{CONFIDENCE_LABELS[dim.confidenceLabel] || dim.confidenceLabel}</b>
          </div>
        </>
      )}
    </div>
  );
}

function TourProfileSummary({ profile, onViewProfile }) {
  const anyMissing = ARCHETYPE_DIMENSIONS.some((d) => profile.dimensions[d].value == null);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={UserRound} right={<button className="gpx-link-btn" onClick={onViewProfile}>Voir les détails</button>}>
        Ton profil
      </SectionTitle>
      <div className="gpx-profile-grid">
        {ARCHETYPE_DIMENSIONS.map((key) => (
          <TourDimensionCard key={key} dimKey={key} dim={profile.dimensions[key]} />
        ))}
      </div>
      {anyMissing && <p className="gpx-empty-note" style={{ marginTop: 10 }}>Profil encore en construction.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Étape active / résultat d'étape                                      */
/* ------------------------------------------------------------------ */

function StageScreen({ stage, result, nextFatigueBefore, stageIndex, totalStages, revealed, isLast, onSimulate, onNext }) {
  const type = getStageTypeProfile(stage.type);
  const fatigueDelta =
    revealed && result.fatigueBefore != null && result.fatigueAfter != null ? pct(result.fatigueAfter) - pct(result.fatigueBefore) : null;
  const recoveryDelta =
    revealed && result.fatigueAfter != null && nextFatigueBefore != null ? pct(nextFatigueBefore) - pct(result.fatigueAfter) : null;

  return (
    <div className="gpx-panel" aria-label={`Étape ${stageIndex + 1} sur ${totalStages}`}>
      <div className="gpx-archetype-headline" style={{ fontSize: 22 }}>{(type ? type.label : stage.type).toUpperCase()}</div>
      <div className="gpx-ride-meta" style={{ marginTop: 6 }}>
        <span>{Math.round(stage.distanceKm)} km</span>
        <span className="gpx-tour-difficulty-label">Difficulté <DifficultyDots value={stage.difficulty} /></span>
      </div>

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Info}>Affinité avec ton profil</SectionTitle>
      {result.affinity == null ? (
        <>
          <div className="gpx-profile-card-value gpx-profile-card-value-empty">—</div>
          <div className="gpx-profile-card-status">Données insuffisantes</div>
        </>
      ) : (
        <>
          <div className="gpx-profile-card-value">
            {result.affinity}
            <span className="gpx-profile-card-value-scale">/100</span>
          </div>
          <div className="gpx-profile-card-status">{result.category}</div>
        </>
      )}

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Zap}>Ce qui compte</SectionTitle>
      {result.keyFactors.length === 0 ? (
        <p className="gpx-empty-note">Pas encore assez de dimensions documentées pour cette étape.</p>
      ) : (
        <ul className="gpx-profile-evidence-list">
          {result.keyFactors.map((d, i) => (
            <li key={d}>{DIMENSION_META[d].label} <span className="gpx-tour-weight">{"+".repeat(3 - i)}</span></li>
          ))}
        </ul>
      )}
      <p className="gpx-empty-note" style={{ fontStyle: "normal", marginTop: 8 }}>{stageExplanation(result)}</p>

      {result.missingDimensions.length > 0 && (
        <>
          <div className="gpx-alterego-subheading">Ce qui reste à documenter</div>
          <ul className="gpx-profile-evidence-list">
            {result.missingDimensions.map((d) => <li key={d}>{DIMENSION_META[d].label}</li>)}
          </ul>
        </>
      )}

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Flame}>{revealed ? "Fatigue" : "Fatigue simulée"}</SectionTitle>
      <div className="gpx-profile-card-status">{fatigueLabel(result.fatigueBefore)}</div>
      <div className="gpx-profile-card-bar">
        <div className="gpx-profile-card-bar-fill gpx-tour-fatigue-fill" style={{ width: `${pct(result.fatigueBefore) ?? 0}%` }} />
      </div>

      {!revealed ? (
        <button className="gpx-btn-primary" style={{ marginTop: 18 }} onClick={onSimulate}>
          <Play size={15} /> Simuler l'étape
        </button>
      ) : (
        <>
          <hr className="gpx-tour-divider" />
          <div className="gpx-archetype-headline" style={{ fontSize: 18 }}>Étape terminée</div>
          <div className="gpx-alterego-profile-row">
            <span className="gpx-alterego-profile-row-label">Performance simulée</span>
            <span>{PERFORMANCE_BAND_LABELS[result.performanceBand] || result.performanceBand}</span>
          </div>
          {fatigueDelta != null && (
            <div className="gpx-alterego-profile-row">
              <span className="gpx-alterego-profile-row-label">Fatigue</span>
              <span>{fatigueDelta >= 0 ? "+" : ""}{fatigueDelta}</span>
            </div>
          )}
          {recoveryDelta != null && (
            <div className="gpx-alterego-profile-row">
              <span className="gpx-alterego-profile-row-label">Récupération avant la prochaine étape</span>
              <span>{recoveryDelta}</span>
            </div>
          )}
          <button className="gpx-btn-primary" style={{ marginTop: 14 }} onClick={onNext}>
            {isLast ? "Voir le résumé du Tour" : "Étape suivante"} <ChevronRight size={15} />
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fin du Tour                                                          */
/* ------------------------------------------------------------------ */

function TourFinishedSection({ stageCount, overall, onReplay, onViewProfile }) {
  const avgFatigueFromManagement = overall.fatigueManagement != null ? 1 - overall.fatigueManagement / 100 : null;

  return (
    <div className="gpx-panel gpx-tour-hero">
      <SectionTitle icon={Flag}>Tour terminé</SectionTitle>
      <div className="gpx-focus-headline">{stageCount} étapes simulées</div>

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Mountain}>Ton profil sur ce parcours</SectionTitle>
      <div className="gpx-alterego-profile-list">
        {TERRAIN_AFFINITY_FIELDS.map(({ key, label }) => {
          const score = overall[key];
          return (
            <div className="gpx-alterego-profile-row" key={key}>
              <span className="gpx-alterego-profile-row-label">{label}</span>
              <span className={score == null ? "gpx-profile-card-value-empty" : ""}>
                {score == null ? "Données insuffisantes" : categorizeAffinity(score)}
              </span>
            </div>
          );
        })}
      </div>

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Info}>Ce que la simulation montre</SectionTitle>
      <p className="gpx-empty-note" style={{ fontStyle: "normal" }}>{overallSummarySentence(overall)}</p>

      {overall.documentationGaps.length > 0 && (
        <>
          <hr className="gpx-tour-divider" />
          <div className="gpx-alterego-subheading">Ce qui reste à documenter</div>
          <ul className="gpx-profile-evidence-list">
            {overall.documentationGaps.map((g) => (
              <li key={g.dimension}>{DIMENSION_META[g.dimension] ? DIMENSION_META[g.dimension].label : g.dimension}</li>
            ))}
          </ul>
        </>
      )}

      <hr className="gpx-tour-divider" />
      <SectionTitle icon={Flame}>Fatigue finale</SectionTitle>
      <div className="gpx-profile-card-status">{fatigueLabel(avgFatigueFromManagement)}</div>

      <div className="gpx-tour-finish-actions">
        <button className="gpx-btn-primary" onClick={onReplay}><RotateCcw size={15} /> Rejouer</button>
        <button className="gpx-btn-ghost" onClick={onViewProfile}>Voir mon profil</button>
      </div>
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
 * @param {Function} props.onViewProfile - navigue vers la vue Profil
 */
export function TourView({ storage, onConnect, onReconnect, onBack, onViewProfile }) {
  const [summaries, setSummaries] = useState(null);
  const [summariesError, setSummariesError] = useState(null);
  const [fullActivities, setFullActivities] = useState(null);
  const [failedCount, setFailedCount] = useState(0);
  const [tourState, setTourState] = useState(null); // null = simulation pas encore commencée

  const refresh = useCallback(() => {
    if (storage.status !== "connected" || !storage.rootHandle) return;
    setSummariesError(null);
    setSummaries(null);
    setFullActivities(null);
    setFailedCount(0);
    setTourState(null);
    listActivities(storage.rootHandle)
      .then(setSummaries)
      .catch((err) => setSummariesError(err.message || "Impossible de lire l'historique."));
  }, [storage.status, storage.rootHandle]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!summaries || summaries.length === 0 || !storage.rootHandle) return;
    let cancelled = false;
    const toLoad = summaries.slice(0, MAX_TOUR_ACTIVITIES);
    loadCachedActivityDetails(storage.rootHandle, toLoad).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  // Profil réutilisé tel quel (voir derivedCache.js) — jamais recalculé à
  // partir des samples ici (voir consigne §3/§18).
  const profile = useMemo(() => (fullActivities ? getCachedProfile(fullActivities) : null), [fullActivities]);
  // Tour générique — données pures, indépendantes des activités (voir stages.js).
  const stages = useMemo(() => createGenericTour(), []);

  const startTour = useCallback(() => {
    const seed = nextSeed();
    const { stageResults, overall } = simulateTour({ profile, stages, seed });
    setTourState({ seed, stageResults, overall, currentIndex: 0, revealed: false });
  }, [profile, stages]);

  const simulateCurrentStage = useCallback(() => {
    setTourState((s) => (s ? { ...s, revealed: true } : s));
  }, []);

  const advance = useCallback(() => {
    setTourState((s) => (s ? { ...s, currentIndex: s.currentIndex + 1, revealed: false } : s));
  }, []);

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name">Tour Simulator</h1>
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
              <p className="gpx-summary-text">Le Tour Simulator sera disponible après ta première sortie.</p>
              <p className="gpx-empty-note">Importe un GPX ou un FIT pour commencer.</p>
            </div>
          ) : fullActivities == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className="gpx-profile-banner">
                  <AlertTriangle size={14} />
                  {failedCount} sortie{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être chargée{failedCount > 1 ? "s" : ""}. La simulation est basée sur les sorties disponibles.
                </div>
              )}
              {summaries.length > MAX_TOUR_ACTIVITIES && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Profil basé sur les {MAX_TOUR_ACTIVITIES} sorties les plus récentes (sur {summaries.length} au total).
                </div>
              )}

              {profile.activityCount < COLD_START_ACTIVITY_THRESHOLD ? (
                <ColdStartSection activityCount={profile.activityCount} profile={profile} onViewProfile={onViewProfile} />
              ) : !tourState ? (
                <>
                  <div className="gpx-panel gpx-tour-hero">
                    <SectionTitle icon={Flag}>Tour Simulator</SectionTitle>
                    <div className="gpx-focus-headline">Ton profil. Un parcours. Une simulation.</div>
                  </div>
                  <RouteOverviewSection stages={stages} onStart={startTour} />
                  <TourProfileSummary profile={profile} onViewProfile={onViewProfile} />
                </>
              ) : tourState.currentIndex >= stages.length ? (
                <TourFinishedSection stageCount={stages.length} overall={tourState.overall} onReplay={startTour} onViewProfile={onViewProfile} />
              ) : (
                <>
                  <TourProgressBar current={tourState.currentIndex} total={stages.length} />
                  <StageScreen
                    stage={stages[tourState.currentIndex]}
                    result={tourState.stageResults[tourState.currentIndex]}
                    nextFatigueBefore={tourState.stageResults[tourState.currentIndex + 1] ? tourState.stageResults[tourState.currentIndex + 1].fatigueBefore : null}
                    stageIndex={tourState.currentIndex}
                    totalStages={stages.length}
                    revealed={tourState.revealed}
                    isLast={tourState.currentIndex === stages.length - 1}
                    onSimulate={simulateCurrentStage}
                    onNext={advance}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
