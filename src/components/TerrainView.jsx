/**
 * ONGLET TECHNIQUE (Analyse d'une sortie) — terrain réellement parcouru, à partir du tracé GPS et des chemins
 * OpenStreetMap (voir src/lib/terrain/). Deux analyses distinctes :
 *   A. Profil du terrain : route / pistes et chemins / sentiers / non classifié, km et %, couverture des données ;
 *   B. Difficulté technique ESTIMÉE : note /100, niveau, confiance, facteurs — ou « données insuffisantes ».
 *
 * Confidentialité : sans autorisation, AUCUNE requête réseau n'est faite (seules les zones déjà en cache local sont
 * utilisées). Avec autorisation, seules des zones rectangulaires (~2 km) sont demandées, jamais le fichier ni le tracé.
 * Le score du profil « Technique » (onglet Profil) est un autre indicateur, inchangé.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Route as RouteIcon, ShieldCheck, Gauge, Info, MapPin, Trash2, RefreshCw, CloudOff } from "lucide-react";

import { SectionTitle } from "./UIPrimitives.jsx";
import {
  runTerrainAnalysis, planTerrainCells, idbStore, TERRAIN_LABELS, TERRAIN_TYPE_LABELS, LEVEL_LABELS, OVERPASS_ENDPOINTS,
} from "../lib/terrain/index.js";
import { hasOsmConsent, setOsmConsent, getTypeOverride, setTypeOverride, OVERRIDABLE_TYPES } from "../lib/terrain/preferences.js";
import { fmt1, fmtInt } from "../lib/utils.js";

/** Délai minimal entre la fin d'une tentative en échec et la relance suivante (le service est sans doute surchargé). */
export const RETRY_DELAY_MS = 15000;
export const UNAVAILABLE_MESSAGE =
  "Service cartographique (OpenStreetMap / Overpass) temporairement indisponible. Aucune nouvelle requête n'est lancée automatiquement. Les portions non chargées restent non classifiées.";

const CONFIDENCE_LABELS = { low: "faible", medium: "moyenne", high: "élevée" };
const CATEGORY_ORDER = ["road", "track", "trail", "unclassified"];

function pctText(v) {
  return (v >= 0.5 || v === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")) + " %";
}

/**
 * @param {Object} props
 * @param {Object} props.analysis - résultat de computeAnalysis() (utilise `series` : lat, lon, pente)
 * @param {string} props.activityKey - clé stable de la sortie (correction manuelle)
 * @param {{get: Function, put: Function, clear: Function}} [props.store] - cache des zones (injectable pour les tests)
 * @param {typeof fetch} [props.fetchImpl] - injectable pour les tests
 * @param {number} [props.minIntervalMs] - espacement des requêtes (défaut du client Overpass ; 0 en test)
 */
export function TerrainView({ analysis, activityKey, store: storeProp, fetchImpl, minIntervalMs }) {
  const store = useMemo(() => storeProp || idbStore(), [storeProp]);
  const points = useMemo(
    () => (analysis.series || []).filter((p) => p.lat != null && p.lon != null).map((p) => ({ lat: p.lat, lon: p.lon, grade: p.grade })),
    [analysis]
  );
  const plan = useMemo(() => planTerrainCells(points), [points]);

  const [consent, setConsent] = useState(() => hasOsmConsent());
  const [askConsent, setAskConsent] = useState(false);
  const [state, setState] = useState({ phase: "loading" }); // loading | done | error
  const [progress, setProgress] = useState(null);
  const [override, setOverride] = useState(() => getTypeOverride(activityKey));
  const abortRef = useRef(null);

  // Relance manuelle après indisponibilité : jamais de requête automatique, au plus une relance en attente.
  const failureAtRef = useRef(0);
  const retryRef = useRef({ timeout: null, interval: null });
  const [retryWait, setRetryWait] = useState(null); // secondes restantes avant la relance, null = aucune relance en attente

  const clearRetry = useCallback(() => {
    clearTimeout(retryRef.current.timeout);
    clearInterval(retryRef.current.interval);
    retryRef.current = { timeout: null, interval: null };
    setRetryWait(null);
  }, []);

  const run = useCallback(
    async (allowNetwork) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      clearRetry();
      setState({ phase: "loading", network: allowNetwork });
      setProgress(null);
      try {
        const out = await runTerrainAnalysis({
          points, store, allowNetwork, fetchImpl, minIntervalMs, signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (!controller.signal.aborted) {
          if (out.load && out.load.unavailable) failureAtRef.current = Date.now();
          setState({ phase: "done", out });
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        setState({ phase: "error", message: err.message || "Analyse impossible." });
      } finally {
        setProgress(null);
      }
    },
    [points, store, fetchImpl, minIntervalMs, clearRetry]
  );

  // À l'ouverture : analyse LOCALE (cache seul, aucun réseau) — les statistiques GPS ne dépendent jamais de la connexion.
  useEffect(() => {
    run(false);
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [run]);

  useEffect(() => { setOverride(getTypeOverride(activityKey)); }, [activityKey]);

  // Démontage : plus aucune relance programmée.
  useEffect(() => () => {
    clearTimeout(retryRef.current.timeout);
    clearInterval(retryRef.current.interval);
  }, []);

  function handleAnalyzeClick() {
    if (consent) run(true);
    else setAskConsent(true);
  }
  function handleAccept() {
    setOsmConsent(true);
    setConsent(true);
    setAskConsent(false);
    run(true);
  }
  function handleRevoke() {
    setOsmConsent(false);
    setConsent(false);
    clearRetry(); // une relance en attente ne doit jamais partir après le retrait de l'autorisation
  }
  /**
   * « Réessayer » : relance MANUELLE, jamais sans consentement. Si la dernière tentative en échec date de moins de
   * RETRY_DELAY_MS, la relance est programmée à l'issue du délai restant (compte à rebours affiché) ; un nouveau clic
   * pendant l'attente est ignoré. Seules les zones en échec ou différées sont redemandées (le reste vient du cache).
   */
  function handleRetry() {
    if (loading || retryWait != null) return;
    if (!hasOsmConsent()) { setConsent(false); setAskConsent(true); return; }
    const remaining = failureAtRef.current + RETRY_DELAY_MS - Date.now();
    if (remaining <= 0) { run(true); return; }
    setRetryWait(Math.ceil(remaining / 1000));
    const until = Date.now() + remaining;
    retryRef.current.interval = setInterval(() => setRetryWait(Math.max(1, Math.ceil((until - Date.now()) / 1000))), 1000);
    retryRef.current.timeout = setTimeout(() => {
      clearRetry();
      if (hasOsmConsent()) run(true); // le consentement est revérifié au moment de partir
    }, remaining);
  }
  async function handleClearCache() {
    await store.clear();
    run(false);
  }
  function handleOverride(value) {
    const next = value === "auto" ? null : value;
    setTypeOverride(activityKey, next);
    setOverride(next);
  }

  const out = state.phase === "done" ? state.out : null;
  const result = out && out.status === "done" ? out.result : null;
  const summary = result ? result.summary : null;
  const hasAnyMapData = !!(out && out.status === "done" && out.cellCounts && out.cellCounts.available > 0);
  const loading = state.phase === "loading";
  const unavailable = !!(out && out.status === "done" && out.load && out.load.unavailable);
  const capped = !!(out && out.status === "done" && out.load && out.load.capped);
  const effectiveType = summary ? override || summary.type : "unknown";

  if (points.length < 2 || plan.count === 0) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={RouteIcon}>Terrain</SectionTitle>
        <p className="gpx-empty-note">Ce fichier ne contient pas de coordonnées GPS exploitables : le terrain ne peut pas être analysé.</p>
      </div>
    );
  }

  return (
    <>
      {/* ---------- A. Profil du terrain ---------- */}
      <div className="gpx-panel">
        <SectionTitle icon={RouteIcon}>Profil du terrain</SectionTitle>

        {loading && (
          <p className="gpx-empty-note" role="status">
            {progress ? `Chargement de la carte… zone ${progress.done} / ${progress.total}` : state.network ? "Chargement de la carte…" : "Analyse des données cartographiques locales…"}
          </p>
        )}
        {state.phase === "error" && <div className="gpx-error-box" role="alert">{state.message}</div>}

        {summary && (
          <>
            <div className="gpx-terrain-head">
              <div>
                <div className="gpx-terrain-type" data-type={effectiveType}>{TERRAIN_TYPE_LABELS[effectiveType]}</div>
                <div className="gpx-terrain-sub">
                  {override ? "Type corrigé manuellement" : effectiveType === "unknown" ? "Données cartographiques insuffisantes" : "Type déduit des chemins traversés"}
                </div>
              </div>
              <div className="gpx-terrain-coverage" title="Part du tracé rattachée à un chemin connu d'OpenStreetMap">
                <span className="gpx-terrain-coverage-value">{pctText(summary.coverage * 100)}</span>
                <span className="gpx-terrain-coverage-label">couverture cartographique</span>
              </div>
            </div>

            <div className="gpx-terrain-bar" role="img" aria-label={CATEGORY_ORDER.map((c) => `${TERRAIN_LABELS[c]} ${pctText(summary.pctOfTotal[c])}`).join(", ")}>
              {CATEGORY_ORDER.map((c) => summary.pctOfTotal[c] > 0 && (
                <span key={c} className={"gpx-terrain-seg is-" + c} style={{ width: `${summary.pctOfTotal[c]}%` }} />
              ))}
            </div>

            <ul className="gpx-terrain-legend">
              {CATEGORY_ORDER.map((c) => (
                <li key={c}>
                  <span className={"gpx-terrain-swatch is-" + c} />
                  <span className="gpx-terrain-legend-label">{TERRAIN_LABELS[c]}</span>
                  <span className="gpx-terrain-legend-km">{fmt1(summary.distancesM[c] / 1000)} km</span>
                  <span className="gpx-terrain-legend-pct">{pctText(summary.pctOfTotal[c])}</span>
                </li>
              ))}
            </ul>

            {result.strip.length > 0 && (
              <div className="gpx-terrain-strip-wrap">
                <div className="gpx-terrain-strip-title">Le long de la sortie</div>
                <div className="gpx-terrain-strip" aria-hidden="true">
                  {result.strip.map((b, i) => <i key={i} className={"is-" + b.category} />)}
                </div>
                <div className="gpx-terrain-strip-axis"><span>0 km</span><span>{fmt1(result.analyzedKm)} km</span></div>
              </div>
            )}

            {out.load && out.load.tooLarge && (
              <p className="gpx-terrain-note">Tracé très étendu ({out.cellCounts.total} zones) : aucune requête lancée. Seules les zones déjà en cache sont utilisées.</p>
            )}
            {unavailable && (
              <div className="gpx-terrain-note is-warn gpx-terrain-unavailable" role="alert">
                <CloudOff size={15} aria-hidden="true" />
                <span>{UNAVAILABLE_MESSAGE}</span>
                <button className="gpx-btn-ghost" onClick={handleRetry} disabled={loading || retryWait != null}>
                  <RefreshCw size={14} /> {retryWait != null ? `Nouvelle tentative dans ${retryWait} s` : "Réessayer"}
                </button>
              </div>
            )}
            {capped && (
              <p className="gpx-terrain-note">
                {out.cellCounts.deferred} zone{out.cellCounts.deferred > 1 ? "s" : ""} restent à charger : le nombre de requêtes par analyse est limité. Relance le chargement pour continuer (les zones déjà chargées ne sont pas redemandées).
              </p>
            )}
            {!unavailable && out.cellCounts.error > 0 && (
              <p className="gpx-terrain-note is-warn" role="alert">
                {out.cellCounts.error} zone{out.cellCounts.error > 1 ? "s" : ""} n'ont pas pu être chargée{out.cellCounts.error > 1 ? "s" : ""} (réseau ou service indisponible) : ces portions restent « non classifiées ».
              </p>
            )}
            {out.cellCounts.missing - out.cellCounts.deferred > 0 && !out.load.tooLarge && (
              <p className="gpx-terrain-note">
                {hasAnyMapData ? `${out.cellCounts.missing} zone${out.cellCounts.missing > 1 ? "s" : ""} sans données cartographiques locales.` : "Aucune donnée cartographique locale pour cette sortie."}
              </p>
            )}
          </>
        )}

        {/* Autorisation et lancement de la requête cartographique */}
        {!loading && summary && !unavailable && out.cellCounts.missing + out.cellCounts.error > 0 && !askConsent && (
          <div className="gpx-terrain-actions">
            <button className="gpx-btn-primary" onClick={handleAnalyzeClick}>
              <MapPin size={15} /> {consent ? "Charger les données cartographiques" : "Analyser le terrain"}
            </button>
            {!consent && <span className="gpx-terrain-hint">Demande une autorisation (une seule fois) avant tout envoi.</span>}
          </div>
        )}

        {askConsent && (
          <div className="gpx-terrain-consent" role="dialog" aria-label="Autorisation des requêtes cartographiques">
            <div className="gpx-terrain-consent-title"><ShieldCheck size={16} /> Autoriser les requêtes cartographiques ?</div>
            <ul>
              <li>
                Pour classer les chemins, l'application demande à <b>{new URL(OVERPASS_ENDPOINTS[0]).hostname}</b> (service public
                OpenStreetMap, sans compte ni clé) les chemins de <b>{plan.count} zone{plan.count > 1 ? "s" : ""} d'environ 2 × 2 km</b> traversée{plan.count > 1 ? "s" : ""} par ce tracé.
              </li>
              <li><b>Jamais envoyés :</b> le fichier GPX/FIT, le tracé exact, les heures, la fréquence cardiaque, la puissance, ton nom.</li>
              <li>
                Les zones révèlent toutefois la région approximative de ta sortie (donc possiblement de ton domicile si tu pars de chez toi),
                et le serveur voit ton adresse IP, comme pour toute requête web.
              </li>
              <li>Les réponses sont conservées dans ce navigateur (30 jours) pour éviter de les redemander. Requêtes espacées d'environ 1 s.</li>
            </ul>
            <div className="gpx-terrain-actions">
              <button className="gpx-btn-primary" onClick={handleAccept}>Autoriser et analyser</button>
              <button className="gpx-btn-ghost" onClick={() => setAskConsent(false)}>Pas maintenant</button>
            </div>
          </div>
        )}

        {summary && (
          <div className="gpx-terrain-override">
            <label>
              Type de terrain
              <select value={override || "auto"} onChange={(e) => handleOverride(e.target.value)} aria-label="Type de terrain">
                <option value="auto">Automatique</option>
                {OVERRIDABLE_TYPES.map((t) => <option key={t} value={t}>{TERRAIN_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
            <span className="gpx-terrain-hint">Correction d'affichage, enregistrée sur cet appareil : le tracé GPS et la difficulté estimée ne changent pas.</span>
          </div>
        )}
      </div>

      {/* ---------- B. Difficulté technique estimée ---------- */}
      <div className="gpx-panel">
        <SectionTitle icon={Gauge}>Difficulté technique estimée</SectionTitle>
        {loading && <p className="gpx-empty-note">Analyse en cours…</p>}
        {!loading && !result && <p className="gpx-empty-note">Pas encore de données cartographiques pour estimer la difficulté.</p>}
        {result && <DifficultyBlock difficulty={result.difficulty} />}

        <p className="gpx-terrain-limits">
          <Info size={14} />
          <span>
            Estimation du <b>terrain</b> d'après la carte, pas une mesure de la difficulté ressentie. Racines, pierres,
            boue, adhérence et état du jour ne peuvent pas être déduits d'une carte : ils ne sont pas détectés ici.
          </span>
        </p>
      </div>

      {/* ---------- Confidentialité et données locales ---------- */}
      <div className="gpx-panel gpx-panel--quiet">
        <SectionTitle icon={ShieldCheck}>Données cartographiques</SectionTitle>
        <p className="gpx-empty-note">
          Source : OpenStreetMap (© contributeurs OpenStreetMap, licence ODbL), via Overpass. Les statistiques GPS de cette sortie ne dépendent
          jamais de cette analyse ni d'Internet.
        </p>
        <div className="gpx-terrain-actions">
          {consent && <button className="gpx-link-btn" onClick={handleRevoke}>Retirer l'autorisation des requêtes</button>}
          <button className="gpx-link-btn" onClick={handleClearCache}><Trash2 size={13} /> Vider le cache cartographique</button>
        </div>
      </div>
    </>
  );
}

function DifficultyBlock({ difficulty }) {
  if (difficulty.status === "insufficient") {
    return (
      <div className="gpx-terrain-state">
        <div className="gpx-terrain-state-title">Données insuffisantes</div>
        <p>{difficulty.reason}</p>
      </div>
    );
  }
  if (difficulty.status === "not_applicable") {
    return (
      <div className="gpx-terrain-state">
        <div className="gpx-terrain-state-title">Non applicable</div>
        <p>{difficulty.reason}</p>
      </div>
    );
  }
  return (
    <>
      <div className="gpx-terrain-score-row">
        <div className="gpx-terrain-score">{fmtInt(difficulty.score)}<small>/100</small></div>
        <div className="gpx-terrain-score-meta">
          <span className={"gpx-terrain-level is-" + difficulty.level}>{LEVEL_LABELS[difficulty.level]}</span>
          <span className={"gpx-terrain-confidence is-" + difficulty.confidence.label}>
            Confiance {CONFIDENCE_LABELS[difficulty.confidence.label]}
          </span>
        </div>
      </div>
      <div className="gpx-terrain-gauge" role="img" aria-label={`Note ${difficulty.score} sur 100`}>
        <span className="gpx-terrain-gauge-zone is-easy" />
        <span className="gpx-terrain-gauge-zone is-moderate" />
        <span className="gpx-terrain-gauge-zone is-hard" />
        <span className="gpx-terrain-gauge-tick" style={{ left: `${difficulty.score}%` }} />
      </div>
      <div className="gpx-terrain-factors-title">Ce qui a pesé dans l'estimation</div>
      <ul className="gpx-terrain-factors">
        {difficulty.factors.map((f) => <li key={f.key}>{f.label}</li>)}
      </ul>
    </>
  );
}
