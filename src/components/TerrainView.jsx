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
  IGN_WFS_URL, IGN_ATTRIBUTION,
} from "../lib/terrain/index.js";
import {
  hasMapConsent, setMapConsent, getOsmEnrichment, setOsmEnrichment, getTypeOverride, setTypeOverride, OVERRIDABLE_TYPES,
  getCooldownUntil, setCooldownUntil,
} from "../lib/terrain/preferences.js";
import { fmt1, fmtInt } from "../lib/utils.js";

/** Délai minimal entre la fin d'une tentative en échec (réseau, 5xx, délai dépassé) et la requête suivante. */
export const RETRY_DELAY_MS = 15000;
/** Délai minimal après un HTTP 429 (limite de débit du service) : jamais de nouvelle requête avant. */
export const RATE_LIMIT_DELAY_MS = 30000;
/** Plafond du délai quand le service annonce lui-même un Retry-After très long. */
export const MAX_COOLDOWN_MS = 5 * 60000;
export const RATE_LIMIT_NOTE = "Le service limite le nombre de requêtes (HTTP 429) : une nouvelle tentative n'est possible qu'après au moins 30 secondes.";
export const UNAVAILABLE_MESSAGE =
  "Service cartographique (OpenStreetMap / Overpass) temporairement indisponible. Aucune nouvelle requête n'est lancée automatiquement. Les portions non chargées restent non classifiées.";
/** Même message, avec le NOM du ou des services réellement indisponibles (IGN, OpenStreetMap). */
export function unavailableMessage(out) {
  const s = out && out.sources;
  const names = [];
  if (s && s.ign && s.ign.unavailable) names.push("IGN Géoplateforme");
  if (s && s.osm && s.osm.primaryUnavailable) names.push("OpenStreetMap / Overpass");
  if (names.length === 0) names.push("OpenStreetMap / Overpass");
  return UNAVAILABLE_MESSAGE.replace("OpenStreetMap / Overpass", names.join(" et "));
}
export const ENRICHMENT_UNAVAILABLE_NOTE =
  "Compléments OpenStreetMap (surface, technicité) indisponibles pour le moment : les chemins IGN sont analysés sans ces tags. Réessaie plus tard.";
export const NO_IGN_COVERAGE_NOTE = "Hors des territoires où l'IGN publie la BD TOPO (France métropolitaine et DOM) : données OpenStreetMap uniquement.";

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
 * @param {number} [props.cellsPerRequest] - zones regroupées par requête OpenStreetMap (défaut du client Overpass ; 1 = une par zone, tests)
 * @param {{ign?: boolean, osm?: boolean}} [props.sources] - désactive une source (tests) ; défaut : IGN + OpenStreetMap
 */
export function TerrainView({ analysis, activityKey, store: storeProp, fetchImpl, minIntervalMs, cellsPerRequest, sources }) {
  const store = useMemo(() => storeProp || idbStore(), [storeProp]);
  const points = useMemo(
    () => (analysis.series || []).filter((p) => p.lat != null && p.lon != null).map((p) => ({ lat: p.lat, lon: p.lon, grade: p.grade })),
    [analysis]
  );
  const plan = useMemo(() => planTerrainCells(points), [points]);

  const [consent, setConsent] = useState(() => hasMapConsent());
  const [enrichment, setEnrichment] = useState(() => getOsmEnrichment()); // complément OpenStreetMap : "on" | "off"
  const [askConsent, setAskConsent] = useState(false);
  const [consentWithOsm, setConsentWithOsm] = useState(true);
  const [state, setState] = useState({ phase: "loading" }); // loading | done | error
  const [progress, setProgress] = useState(null);
  const [override, setOverride] = useState(() => getTypeOverride(activityKey));
  const abortRef = useRef(null);

  // Attente avant toute requête réseau : jamais de requête automatique, au plus une relance en attente. L'échéance est
  // conservée dans le navigateur (preferences.js) : changer d'onglet ou recharger la page ne la contourne pas.
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
        // Complément OpenStreetMap : désactivé par l'utilisateur ("off"), ou limité au cache pendant une attente après échec.
        const enrichmentMode = getOsmEnrichment() === "off" ? "off" : getCooldownUntil("enrichment") > Date.now() ? "cache" : "on";
        const out = await runTerrainAnalysis({
          points, store, allowNetwork, fetchImpl, minIntervalMs, cellsPerRequest, sources: { ...sources, osmEnrichment: enrichmentMode }, signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (!controller.signal.aborted) {
          if (allowNetwork && out.status === "done") {
            const { load, cellCounts } = out;
            if (load.rateLimited) setCooldownUntil(Date.now() + Math.min(MAX_COOLDOWN_MS, Math.max(RATE_LIMIT_DELAY_MS, load.retryAfterMs || 0)));
            else if (load.unavailable || cellCounts.error > 0) setCooldownUntil(Date.now() + RETRY_DELAY_MS);
            else setCooldownUntil(0); // chargement sans incident : plus d'attente
            // L'échec du seul complément OpenStreetMap n'arrête jamais l'analyse IGN : il met ce complément en pause.
            if (out.sources.enrichment.failed) setCooldownUntil(Date.now() + (out.sources.enrichment.rateLimited ? Math.min(MAX_COOLDOWN_MS, Math.max(RATE_LIMIT_DELAY_MS, out.sources.enrichment.retryAfterMs || 0)) : RETRY_DELAY_MS), "enrichment");
            else if (out.sources.enrichment.mode === "on" && out.sources.enrichment.cells > 0) setCooldownUntil(0, "enrichment");
          }
          setState({ phase: "done", out });
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        setState({ phase: "error", message: err.message || "Analyse impossible." });
      } finally {
        setProgress(null);
      }
    },
    [points, store, fetchImpl, minIntervalMs, cellsPerRequest, sources, clearRetry]
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

  /**
   * UNIQUE point d'entrée des requêtes réseau (analyse, autorisation, « Charger… », « Réessayer ») : jamais sans
   * consentement, jamais avant l'échéance d'attente (15 s après une panne, ≥ 30 s après un 429). Si l'échéance n'est pas
   * atteinte, la requête est programmée à son terme (compte à rebours affiché) ; un nouveau clic pendant l'attente est
   * ignoré. Seules les zones en échec ou différées sont redemandées (le reste vient du cache).
   */
  function requestNetworkRun() {
    if (loading || retryWait != null) return;
    if (!hasMapConsent()) { setConsent(false); setAskConsent(true); return; }
    const remaining = getCooldownUntil() - Date.now();
    if (remaining <= 0) { run(true); return; }
    setRetryWait(Math.ceil(remaining / 1000));
    const until = Date.now() + remaining;
    retryRef.current.interval = setInterval(() => setRetryWait(Math.max(1, Math.ceil((until - Date.now()) / 1000))), 1000);
    retryRef.current.timeout = setTimeout(() => {
      clearRetry();
      if (hasMapConsent()) run(true); // le consentement est revérifié au moment de partir
    }, remaining);
  }
  function handleAnalyzeClick() {
    if (consent) requestNetworkRun();
    else setAskConsent(true);
  }
  function handleAccept(withOsm) {
    setMapConsent(true);
    setOsmEnrichment(withOsm ? "on" : "off");
    setEnrichment(withOsm ? "on" : "off");
    setConsent(true);
    setAskConsent(false);
    requestNetworkRun();
  }
  function handleRevoke() {
    setMapConsent(false);
    setConsent(false);
    clearRetry(); // une relance en attente ne doit jamais partir après le retrait de l'autorisation
  }
  const handleRetry = requestNetworkRun;
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
                <span>
                  {unavailableMessage(out)}
                  {out.load.rateLimited && <small className="gpx-terrain-unavailable-sub">{RATE_LIMIT_NOTE}</small>}
                </span>
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
            {out.sources && out.sources.enrichment.failed && <p className="gpx-terrain-note is-warn" role="status">{ENRICHMENT_UNAVAILABLE_NOTE}</p>}
            {plan.count > 0 && plan.ignCount === 0 && <p className="gpx-terrain-note">{NO_IGN_COVERAGE_NOTE}</p>}
            {plan.ignCount > 0 && plan.osmOnlyCount > 0 && <p className="gpx-terrain-note">{plan.osmOnlyCount} zone{plan.osmOnlyCount > 1 ? "s" : ""} hors territoire IGN : données OpenStreetMap uniquement pour ces portions.</p>}
            {out.cellCounts.noIgnData > 0 && (
              <p className="gpx-terrain-note">
                {out.cellCounts.noIgnData} zone{out.cellCounts.noIgnData > 1 ? "s" : ""} sans aucun tronçon IGN (mer, hors territoire couvert ou zone vide) : elle{out.cellCounts.noIgnData > 1 ? "s ne comptent" : " ne compte"} pas comme couverte{out.cellCounts.noIgnData > 1 ? "s" : ""}.
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
            <button className="gpx-btn-primary" onClick={handleAnalyzeClick} disabled={retryWait != null}>
              <MapPin size={15} /> {retryWait != null ? `Nouvelle tentative dans ${retryWait} s` : consent ? "Charger les données cartographiques" : "Analyser le terrain"}
            </button>
            {!consent && <span className="gpx-terrain-hint">Demande une autorisation (une seule fois) avant tout envoi.</span>}
          </div>
        )}

        {askConsent && (
          <div className="gpx-terrain-consent" role="dialog" aria-label="Autorisation des requêtes cartographiques">
            <div className="gpx-terrain-consent-title"><ShieldCheck size={16} /> Autoriser les requêtes cartographiques ?</div>
            <ul>
              <li>
                Pour classer les chemins, l'application demande les voies de <b>{plan.count} zone{plan.count > 1 ? "s" : ""} d'environ 2 × 2 km</b> traversée{plan.count > 1 ? "s" : ""} par ce tracé, à :
              </li>
              {plan.ignCount > 0 && (
                <li>
                  <b>{new URL(IGN_WFS_URL).hostname}</b> — Géoplateforme de l'IGN (service public, BD TOPO®, sans compte ni clé) pour {plan.ignCount} zone{plan.ignCount > 1 ? "s" : ""} en France métropolitaine ou dans les DOM ;
                </li>
              )}
              {(plan.osmOnlyCount > 0 || plan.ignCount > 0) && (
                <li>
                  <b>{new URL(OVERPASS_ENDPOINTS[0]).hostname}</b> — OpenStreetMap (service public, sans compte ni clé)
                  {plan.osmOnlyCount > 0 ? ` pour ${plan.osmOnlyCount} zone${plan.osmOnlyCount > 1 ? "s" : ""} hors territoire IGN` : ""}
                  {plan.ignCount > 0 ? `${plan.osmOnlyCount > 0 ? ", et" : ""} en complément facultatif (surface, technicité) des zones IGN.` : "."}
                </li>
              )}
              <li><b>Jamais envoyés :</b> le fichier GPX/FIT, le tracé exact, les heures, la fréquence cardiaque, la puissance, ton nom.</li>
              <li>
                Les zones révèlent toutefois la région approximative de ta sortie (donc possiblement de ton domicile si tu pars de chez toi),
                et chaque serveur voit ton adresse IP, comme pour toute requête web.
              </li>
              <li>Les réponses sont conservées dans ce navigateur (IGN 90 jours, OpenStreetMap 30 jours) pour éviter de les redemander.</li>
            </ul>
            {plan.ignCount > 0 && (
              <label className="gpx-terrain-check">
                <input type="checkbox" checked={consentWithOsm} onChange={(e) => setConsentWithOsm(e.target.checked)} />
                Compléter avec OpenStreetMap (surface, technicité) sur les zones couvertes par l'IGN
              </label>
            )}
            <div className="gpx-terrain-actions">
              <button className="gpx-btn-primary" onClick={() => handleAccept(plan.ignCount === 0 || consentWithOsm)}>Autoriser et analyser</button>
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

      {/* ---------- Données de la carte : OBSERVÉ (provenance, couverture, types, tags techniques) ---------- */}
      {summary && result && result.provenance && out.cellCounts.available > 0 && (
        <MapDataPanel summary={summary} result={result} out={out} />
      )}

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
          Sources : IGN — BD TOPO® (Licence Ouverte Etalab 2.0) via la Géoplateforme, et OpenStreetMap (© contributeurs OpenStreetMap, licence ODbL) via Overpass.
          Les statistiques GPS de cette sortie ne dépendent jamais de cette analyse ni d'Internet.
        </p>
        <div className="gpx-terrain-actions">
          {consent && <button className="gpx-link-btn" onClick={handleRevoke}>Retirer l'autorisation des requêtes</button>}
          <button className="gpx-link-btn" onClick={handleClearCache}><Trash2 size={13} /> Vider le cache cartographique</button>
        </div>
      </div>
    </>
  );
}

/**
 * Ce que la CARTE dit réellement (observé), séparé de la difficulté ESTIMÉE : sources, couverture, types de voies, tags
 * techniques, puis seulement la confiance de l'estimation. Aucune valeur n'est calculée ici : tout vient de provenance.js,
 * du profil et de la difficulté.
 */
function MapDataPanel({ summary, result, out }) {
  const prov = result.provenance;
  const km = (m) => fmt1(m / 1000);
  const total = summary.totalM || 1;
  const pct = (m) => pctText((m / total) * 100);
  const diff = result.difficulty;
  const usedIgn = prov.matchedM.ign > 0 || (out.sources.ign && out.sources.ign.loaded > 0);
  return (
    <div className="gpx-panel gpx-panel--quiet gpx-terrain-mapdata">
      <SectionTitle icon={Info}>Données de la carte</SectionTitle>
      <dl className="gpx-terrain-facts">
        <div>
          <dt>Sources des chemins</dt>
          <dd>
            {prov.matchedM.ign > 0 && <span>IGN {pct(prov.matchedM.ign)} du tracé</span>}
            {prov.matchedM.osm > 0 && <span>OpenStreetMap {pct(prov.matchedM.osm)} du tracé</span>}
            {prov.matchedM.ign === 0 && prov.matchedM.osm === 0 && <span>Aucun chemin rattaché</span>}
          </dd>
        </div>
        <div>
          <dt>Couverture</dt>
          <dd>{pctText(summary.coverage * 100)} du tracé rattaché à un chemin connu ({out.cellCounts.available} zone{out.cellCounts.available > 1 ? "s" : ""} sur {out.cellCounts.total} avec données)</dd>
        </div>
        <div>
          <dt>Types de voies</dt>
          <dd>
            {["road", "track", "trail"].map((c) => <span key={c}>{TERRAIN_LABELS[c]} {km(summary.distancesM[c])} km</span>)}
            {prov.ignEmpierreeM > 0 && (
              <small>
                dont {km(prov.ignEmpierreeM)} km de pistes classées d'après la nature IGN « Route empierrée » (revêtement non précisé ; cette nature peut être inexacte)
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Tags techniques</dt>
          <dd>
            {prov.offroadM === 0 && <span>Pas de hors-route sur cette sortie</span>}
            {prov.offroadM > 0 && prov.technicalM > 0 && <span>{pctText(prov.technicalShare * 100)} du hors-route ({km(prov.technicalM)} km) porte des tags techniques OpenStreetMap</span>}
            {prov.offroadM > 0 && prov.technicalM === 0 && (
              <span>Aucun : {usedIgn ? "la BD TOPO IGN ne décrit ni le revêtement détaillé ni la technicité" : "aucun tag de technicité renseigné sur ces chemins"}</span>
            )}
            {prov.enrichedM > 0 && <small>{km(prov.enrichedM)} km complétés par OpenStreetMap sur des tronçons IGN</small>}
          </dd>
        </div>
        <div>
          <dt>Confiance de l'estimation</dt>
          <dd>
            {diff.status === "ok" ? `${CONFIDENCE_LABELS[diff.confidence.label]} (la difficulté est une estimation, pas une mesure)` : "Difficulté non estimée (voir ci-dessous)"}
          </dd>
        </div>
      </dl>
      {usedIgn && (
        <p className="gpx-terrain-attribution">
          {IGN_ATTRIBUTION}
          {out.sources.ign && out.sources.ign.dataDate ? ` — tronçons modifiés pour la dernière fois le ${new Date(out.sources.ign.dataDate).toLocaleDateString("fr-FR")}` : ""}
        </p>
      )}
    </div>
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
