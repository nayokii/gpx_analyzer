/**
 * PROFIL CYCLISTE — couche UI en lecture seule au-dessus du moteur de profil
 * (Phase 6A, voir src/lib/profile/). Ne recalcule ni ne réinterprète aucune
 * dimension ici : chaque carte lit directement le résultat de
 * `computeCyclistProfile()`/`buildProfileTimeline()`, y compris les phrases
 * d'explication ("Pourquoi ce score ?"), qui viennent verbatim de
 * `evidence.js` — cette vue ne fabrique jamais son propre texte
 * d'interprétation.
 *
 * Chargement des données (voir audit) :
 * - `listActivities()` (index léger) donne d'abord le nombre de sorties et
 *   permet d'afficher l'état vide/1-sortie sans attendre.
 * - Le profil a besoin des activités COMPLÈTES (samples) pour les dimensions
 *   qui dépendent de montées/efforts détectés (voir activitySignals.js) :
 *   une fois l'index connu, on charge le détail des sorties les plus
 *   récentes via `loadCachedActivityDetails()` (voir
 *   ../lib/storage/activityCache.js — Phase 9E : mémoïse `loadActivityDetail`
 *   par id, partagé avec AlterEgoView.jsx/ArchetypeView.jsx qui chargent le
 *   même historique), plafonné à `MAX_PROFILE_ACTIVITIES` (même principe que
 *   `MAX_ROUTE_ANALYSIS_ACTIVITIES` dans HistoryDashboard.jsx) pour ne
 *   jamais charger silencieusement un historique énorme.
 * - `Promise.allSettled` (pas `Promise.all`) : si une sortie ne peut pas être
 *   chargée, le profil se calcule quand même avec les autres (voir consigne
 *   §16), avec un bandeau explicite plutôt qu'un plantage.
 * - Ni `getCachedProfile` ni `getCachedProfileTimeline` ne sont appelés avant
 *   que `fullActivities` soit stabilisé (`useMemo` sur cette seule
 *   dépendance) : pas de recalcul à chaque render, jamais de reparsing de
 *   fichier source (ces fonctions ne prennent que des `Activity` déjà
 *   normalisées) — et Phase 9E : mémoïsés (voir ../lib/derivedCache.js) pour
 *   que AlterEgoView.jsx/ArchetypeView.jsx, qui recalculent le même profil
 *   sur le même historique, réutilisent ce résultat plutôt que de le refaire.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Info, TrendingUp, Mountain, Zap, Flame, Gauge, Repeat, Bike, Timer, AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

import { StorageSettings } from "./StorageSettings.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities } from "../lib/storage/activityStore.js";
import { loadCachedActivityDetails } from "../lib/storage/activityCache.js";
import { getCachedProfile, getCachedProfileTimeline } from "../lib/derivedCache.js";
import { confidenceLabel } from "../lib/profile/confidence.js";
import { summarizeDimensionTrend } from "../lib/profile/trend.js";
import { COLORS } from "../lib/colors.js";
import { fmtDateFull } from "../lib/utils.js";

// Cap de sécurité avant de charger le détail complet de tout un historique
// pour calculer le profil — voir MAX_ROUTE_ANALYSIS_ACTIVITIES dans
// HistoryDashboard.jsx pour le même principe. Au-delà, on se limite aux
// sorties les plus récentes (l'index est déjà trié ainsi, voir
// activityStore.js) plutôt que de charger silencieusement des centaines de
// fichiers.
const MAX_PROFILE_ACTIVITIES = 200;

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

const CONFIDENCE_LABELS = { low: "faible", medium: "moyenne", high: "élevée" };
// Note affichée sous le score quand la donnée n'est pas mesurée — jamais
// affichée pour dataQuality "measured" (rien à signaler dans ce cas).
const DATA_QUALITY_CARD_NOTES = {
  estimated: "Données principalement estimées",
  speed: "Basé sur la vitesse (pas de capteur de puissance)",
  mixed: "Mélange de données mesurées et estimées",
};
// Label qualitatif utilisé dans le panneau "Pourquoi ?" (voir consigne §8).
const DATA_QUALITY_EXPLAIN_LABELS = {
  measured: "Bonne (mesurée)",
  mixed: "Mixte (mesurée + estimée)",
  estimated: "Estimée",
  speed: "Basée sur la vitesse",
};

// Phase 9F — vocabulaire volontairement neutre (voir trend.js) : jamais
// "progrès"/"amélioration", seulement une direction observée.
const TREND_LABELS = {
  up: "↗ évolution récente",
  down: "↘ évolution récente",
  stable: "→ stable sur la période observée",
  emerging: "Premières observations",
};

// Phrase de repli quand une dimension insuffisante n'a pas de `signals.reason`
// propre (voir dimensions/*.js : seuls sprint.js/technical.js en fournissent
// un aujourd'hui) — jamais une supposition sur CE QUI manque précisément,
// seulement un constat honnête de ce que le moteur n'a pas encore détecté.
const MISSING_DIMENSION_FALLBACK = {
  endurance: "Aucune sortie avec un temps en mouvement exploitable pour l'instant.",
  climbing: "Aucune montée détectée dans les sorties analysées.",
  punch: "Aucun effort court/intense détecté pour l'instant.",
  timeTrial: "Aucun effort soutenu exploitable détecté pour l'instant.",
  consistency: "Au moins deux sorties datées sont nécessaires pour mesurer la régularité.",
};

// Phase 9F — qualificatif affiché dans "Ce que tes sorties documentent"
// quand une dimension disponible repose sur des preuves indirectes/estimées
// plutôt que mesurées (voir dataQuality, déjà calculé par confidence.js).
const DATA_QUALITY_SHORT_NOTE = {
  measured: null,
  mixed: "mélange mesuré/estimé",
  estimated: "données estimées",
  speed: "données indirectes",
};

function formatMonthKey(key) {
  const d = new Date(`${key}-01T00:00:00`);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Carte d'une dimension                                                */
/* ------------------------------------------------------------------ */

function DimensionCard({ dimKey, dim, onOpen, trend }) {
  const meta = DIMENSION_META[dimKey];
  const [expanded, setExpanded] = useState(false);
  const insufficient = dim.value == null;
  // Le score peut légèrement dépasser 100 (rendements décroissants, voir
  // normalization.js) : on affiche la valeur réelle telle que produite par
  // le moteur (jamais tronquée), seule la barre visuelle est plafonnée.
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
          {dim.signals && dim.signals.reason && <div className="gpx-profile-card-hint">{dim.signals.reason}</div>}
        </>
      ) : (
        <>
          <div className="gpx-profile-card-value">
            {dim.value}
            <span className="gpx-profile-card-value-scale">/100</span>
          </div>
          <div className="gpx-profile-card-bar">
            <div className="gpx-profile-card-bar-fill" style={{ width: `${barWidth}%` }} />
          </div>
          <div className="gpx-profile-card-hint">Indice interne — pas un pourcentage de capacité humaine</div>
          <div className="gpx-profile-card-confidence">
            Confiance : <b className={`gpx-confidence-${dim.confidenceLabel}`}>{CONFIDENCE_LABELS[dim.confidenceLabel] || dim.confidenceLabel}</b>
          </div>
          {trend && TREND_LABELS[trend.status] && (
            <div className="gpx-profile-card-trend">{TREND_LABELS[trend.status]}</div>
          )}
          <div className="gpx-profile-card-meta">
            {dim.contributingActivities} sortie{dim.contributingActivities > 1 ? "s" : ""} exploitable{dim.contributingActivities > 1 ? "s" : ""}
          </div>
          {DATA_QUALITY_CARD_NOTES[dim.dataQuality] && <div className="gpx-profile-card-hint">{DATA_QUALITY_CARD_NOTES[dim.dataQuality]}</div>}
        </>
      )}

      {dim.evidence && dim.evidence.length > 0 && (
        <>
          <button className="gpx-link-btn gpx-profile-evidence-toggle" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Masquer le détail" : `Pourquoi ${dim.value} ?`}
          </button>
          {expanded && (
            <>
              <ul className="gpx-profile-evidence-list">
                {dim.evidence.map((e, i) => (
                  <li
                    key={i}
                    className={onOpen ? "gpx-row-clickable" : undefined}
                    onClick={onOpen ? () => onOpen(e.activityId) : undefined}
                    title={onOpen ? "Ouvrir cette sortie" : undefined}
                  >
                    {e.reason}
                  </li>
                ))}
              </ul>
              <div className="gpx-profile-card-meta" style={{ marginTop: 4 }}>
                Qualité des données : {DATA_QUALITY_EXPLAIN_LABELS[dim.dataQuality] || dim.dataQuality}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Qualité des données (vue d'ensemble, agrégée depuis Activity.flags)  */
/* ------------------------------------------------------------------ */

function computeDataQualityRows(activities) {
  const any = (pred) => activities.some(pred);
  const hasGps = any((a) => a.flags && a.flags.hasGps);
  const hasElevation = any((a) => a.flags && a.flags.hasElevation);
  const hasHeartRate = any((a) => a.flags && a.flags.hasHeartRate);
  const hasCadence = any((a) => a.flags && a.flags.hasCadence);
  const hasMeasuredPower = any((a) => a.flags && a.flags.hasPower && !a.flags.powerEstimated);
  const hasEstimatedPower = any((a) => a.flags && a.flags.hasPower && a.flags.powerEstimated);

  let powerDisplay = "—";
  if (hasMeasuredPower && hasEstimatedPower) powerDisplay = "mesurée + estimée";
  else if (hasMeasuredPower) powerDisplay = "mesurée";
  else if (hasEstimatedPower) powerDisplay = "estimée";

  return [
    { label: "GPS", display: hasGps ? "✓" : "—", ok: hasGps },
    { label: "Distance", display: "✓", ok: true },
    { label: "Altitude", display: hasElevation ? "✓" : "—", ok: hasElevation },
    { label: "Puissance", display: powerDisplay, ok: hasMeasuredPower || hasEstimatedPower ? "note" : false },
    { label: "Fréquence cardiaque", display: hasHeartRate ? "✓" : "—", ok: hasHeartRate },
    { label: "Cadence", display: hasCadence ? "✓" : "—", ok: hasCadence },
  ];
}

function DataQualitySection({ activities }) {
  const rows = useMemo(() => computeDataQualityRows(activities), [activities]);
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Info}>Qualité des données</SectionTitle>
      <div className="gpx-profile-dataquality-grid">
        {rows.map((r) => (
          <div className="gpx-profile-dataquality-row" key={r.label}>
            <span>{r.label}</span>
            <span className={r.ok === true ? "gpx-profile-dq-ok" : r.ok === "note" ? "gpx-profile-dq-note" : "gpx-profile-dq-missing"}>
              {r.display}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Évolution dans le temps                                             */
/* ------------------------------------------------------------------ */

function EvolutionSection({ timeline, selectedDimension, setSelectedDimension }) {
  const hasEnoughPoints = timeline.length >= 2;
  const meta = DIMENSION_META[selectedDimension];

  const points = timeline.map((t) => {
    const dim = t.profile.dimensions[selectedDimension];
    return { date: t.date, value: dim.value, confidenceLabel: dim.confidenceLabel };
  });

  return (
    <div className="gpx-panel">
      <SectionTitle
        icon={TrendingUp}
        right={
          <select
            className="gpx-profile-dimension-select"
            value={selectedDimension}
            onChange={(e) => setSelectedDimension(e.target.value)}
            aria-label="Dimension affichée dans l'évolution"
          >
            {DIMENSION_ORDER.map((key) => (
              <option key={key} value={key}>{DIMENSION_META[key].label}</option>
            ))}
          </select>
        }
      >
        Évolution du profil
      </SectionTitle>
      {!hasEnoughPoints ? (
        <p className="gpx-empty-note">Pas encore assez de données pour établir une évolution fiable.</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={COLORS.border} vertical={false} />
            <XAxis dataKey="date" stroke={COLORS.textMuted} fontSize={10} tickFormatter={formatMonthKey} />
            <YAxis stroke={COLORS.textMuted} fontSize={10} width={36} domain={[0, "dataMax + 10"]} />
            <Tooltip
              formatter={(v, _name, ctx) => [v == null ? "Données insuffisantes" : `${v} (confiance ${CONFIDENCE_LABELS[ctx.payload.confidenceLabel] || ctx.payload.confidenceLabel})`, meta.label]}
              labelFormatter={formatMonthKey}
              contentStyle={{ background: "#0e1211", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 10, fontSize: 12 }}
            />
            <Line type="monotone" dataKey="value" stroke={COLORS.speed} dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ce que tes sorties documentent / ce qui manque encore (Phase 9F)    */
/* ------------------------------------------------------------------ */

function WhatsDocumentedSection({ profile }) {
  const dims = DIMENSION_ORDER.filter((k) => profile.dimensions[k].value != null);
  if (dims.length === 0) return null;

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Info}>Ce que tes sorties commencent à documenter</SectionTitle>
      <ul className="gpx-profile-evidence-list">
        {dims.map((k) => {
          const dim = profile.dimensions[k];
          const note = DATA_QUALITY_SHORT_NOTE[dim.dataQuality];
          const count = dim.contributingActivities;
          return (
            <li key={k}>
              <b>{DIMENSION_META[k].label}</b> — {count} observation{count > 1 ? "s" : ""}
              {note ? ` (${note})` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WhatsMissingSection({ profile }) {
  const dims = DIMENSION_ORDER.filter((k) => profile.dimensions[k].value == null);
  if (dims.length === 0) return null;

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Info}>Ce qui manque encore</SectionTitle>
      <ul className="gpx-profile-evidence-list">
        {dims.map((k) => {
          const dim = profile.dimensions[k];
          const reason = (dim.signals && dim.signals.reason) || MISSING_DIMENSION_FALLBACK[k] || "Pas encore assez de données.";
          return (
            <li key={k}>
              <b>{DIMENSION_META[k].label}</b> — {reason}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* À propos                                                             */
/* ------------------------------------------------------------------ */

function AboutSection() {
  return (
    <div className="gpx-panel">
      <SectionTitle icon={Info}>Comment fonctionne ce profil ?</SectionTitle>
      <p className="gpx-profile-about">
        Les indices sont calculés à partir des sorties enregistrées dans l'application.
        <br />
        Ils décrivent ton historique observé dans l'application. Ils ne représentent pas un niveau professionnel ni une mesure physiologique.
        <br />
        La confiance dépend notamment du nombre de sorties, de la qualité des données et des capteurs disponibles.
        <br />
        Le score et la confiance sont deux informations distinctes : le score est ce que le modèle estime avec les preuves disponibles ; la confiance indique à quel point ces preuves sont solides. Un score élevé à confiance faible n'est pas une valeur confirmée.
      </p>
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
 * @param {Function} [props.onOpen] - Ouvre une activité par id depuis une preuve (optionnel)
 * @param {Function} props.onBack
 */
export function ProfileView({ storage, onConnect, onReconnect, onOpen, onBack }) {
  const [summaries, setSummaries] = useState(null); // null = chargement, [] = historique vide
  const [summariesError, setSummariesError] = useState(null);
  const [fullActivities, setFullActivities] = useState(null); // null = détail pas encore chargé
  const [failedCount, setFailedCount] = useState(0);
  const [selectedDimension, setSelectedDimension] = useState("endurance");

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

  // Deuxième étage de chargement : détail complet des sorties (nécessaire
  // pour la plupart des dimensions), uniquement une fois l'index connu et
  // non vide. Ne se redéclenche pas tant que `summaries` (même référence, un
  // seul appel à listActivities par refresh) ne change pas.
  useEffect(() => {
    if (!summaries || summaries.length === 0 || !storage.rootHandle) return;
    let cancelled = false;
    const toLoad = summaries.slice(0, MAX_PROFILE_ACTIVITIES);
    loadCachedActivityDetails(storage.rootHandle, toLoad).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, storage.rootHandle]);

  const profile = useMemo(() => (fullActivities ? getCachedProfile(fullActivities) : null), [fullActivities]);
  const timeline = useMemo(() => (fullActivities ? getCachedProfileTimeline(fullActivities) : []), [fullActivities]);
  const availableDimCount = useMemo(
    () => (profile ? DIMENSION_ORDER.filter((k) => profile.dimensions[k].value != null).length : 0),
    [profile]
  );

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name">Mon profil cycliste</h1>
          <div className="gpx-ride-meta">
            {profile ? (
              <>
                <span>Analyse basée sur {profile.activityCount} sortie{profile.activityCount > 1 ? "s" : ""}</span>
                <span>{availableDimCount} / {DIMENSION_ORDER.length} dimensions exploitables</span>
                <span>
                  Confiance globale :{" "}
                  <b className={`gpx-confidence-${confidenceLabel(profile.overallConfidence)}`}>
                    {CONFIDENCE_LABELS[confidenceLabel(profile.overallConfidence)] || "insuffisante"}
                  </b>
                </span>
                <span>Dernière mise à jour : {fmtDateFull(new Date(profile.generatedAt))}</span>
              </>
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
              <p className="gpx-summary-text">Ton profil cycliste apparaîtra ici après ta première sortie.</p>
              <p className="gpx-empty-note">Importe un GPX ou un FIT pour commencer.</p>
            </div>
          ) : fullActivities == null ? (
            <div className="gpx-panel"><p className="gpx-empty-note">Analyse de ton historique…</p></div>
          ) : (
            <>
              {failedCount > 0 && (
                <div className="gpx-profile-banner">
                  <AlertTriangle size={14} />
                  {failedCount} sortie{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être chargée{failedCount > 1 ? "s" : ""}. Le profil est calculé à partir des sorties disponibles.
                </div>
              )}
              {summaries.length > MAX_PROFILE_ACTIVITIES && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Profil basé sur les {MAX_PROFILE_ACTIVITIES} sorties les plus récentes (sur {summaries.length} au total).
                </div>
              )}
              {profile.activityCount === 1 && (
                <div className="gpx-profile-banner">
                  <Info size={14} />
                  Profil en construction — 1 sortie analysée. Certaines dimensions nécessitent plus de données ou des capteurs spécifiques.
                </div>
              )}

              <DataQualitySection activities={fullActivities} />

              <div className="gpx-panel">
                <SectionTitle icon={Zap}>Dimensions</SectionTitle>
                <div className="gpx-profile-grid">
                  {DIMENSION_ORDER.map((key) => (
                    <DimensionCard
                      key={key}
                      dimKey={key}
                      dim={profile.dimensions[key]}
                      onOpen={onOpen}
                      trend={summarizeDimensionTrend(timeline, key)}
                    />
                  ))}
                </div>
              </div>

              <WhatsDocumentedSection profile={profile} />
              <WhatsMissingSection profile={profile} />

              <EvolutionSection timeline={timeline} selectedDimension={selectedDimension} setSelectedDimension={setSelectedDimension} />
              <AboutSection />
            </>
          )}
        </>
      )}
    </div>
  );
}
