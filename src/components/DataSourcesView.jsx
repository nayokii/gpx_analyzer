/**
 * SOURCES DE DONNÉES — écran dédié (pas une méga-page Paramètres) réunissant
 * le stockage local et les sources d'import externes (Strava, voir Phase
 * 9C). Accessible depuis Home (petit lien discret, voir HomeView.jsx) et
 * depuis l'onglet Paramètres d'une sortie ouverte — jamais depuis les 5
 * destinations persistantes de AppNav.jsx (voir sa consigne §9 : 5 items
 * fixes, pas un 6e).
 *
 * Cette vue ne connaît QUE l'API publique de src/lib/strava/ (voir son
 * index.js) : elle ne recalcule ni ne réinterprète rien, elle orchestre
 * connect/sync/disconnect et affiche l'état persisté.
 *
 * Isolation démo (voir consigne) : `isDemo` désactive totalement les actions
 * Strava — aucun appel réseau ni fichier n'est jamais déclenché depuis un
 * état démo, quel que soit le rendu.
 */
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, RefreshCw, Unplug, CheckCircle2, AlertCircle, Bike } from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { CloudAccountPanel } from "./CloudAccountPanel.jsx";
import { SectionTitle } from "./UIPrimitives.jsx";
import { listActivities } from "../lib/storage/activityStore.js";
import {
  buildAuthorizeUrl,
  generateOAuthState,
  loadStravaState,
  clearStravaState,
  revokeConnection,
  syncStrava,
  REQUESTED_SCOPE,
} from "../lib/strava/index.js";

const OAUTH_STATE_KEY = "gpx-strava-oauth-state";

export function DataSourcesView({ storage, onConnect, onReconnect, onDisconnectStorage, onBack, isDemo, userSettings, callbackNotice, refreshSignal }) {
  const [stravaState, setStravaState] = useState(null); // null = chargement
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(callbackNotice || null);

  const refresh = useCallback(async () => {
    if (storage.status !== "connected" || !storage.rootHandle) {
      setStravaState(null);
      return;
    }
    const state = await loadStravaState(storage.rootHandle);
    setStravaState(state);
  }, [storage.status, storage.rootHandle]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal]);

  useEffect(() => {
    if (callbackNotice) setActionError(callbackNotice);
  }, [callbackNotice]);

  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID || "";
  const redirectUri = import.meta.env.VITE_STRAVA_REDIRECT_URI || (typeof window !== "undefined" ? window.location.origin + "/" : "");
  const configMissing = !clientId || !redirectUri;

  function handleConnect() {
    setActionError(null);
    try {
      const state = generateOAuthState();
      sessionStorage.setItem(OAUTH_STATE_KEY, state);
      const url = buildAuthorizeUrl({ clientId, redirectUri, scope: REQUESTED_SCOPE, state });
      window.location.href = url;
    } catch (err) {
      setActionError(err.message || "Impossible de démarrer la connexion Strava.");
    }
  }

  async function handleSync() {
    if (isDemo || !storage.rootHandle || !stravaState) return;
    setBusy(true);
    setActionError(null);
    try {
      const existingSummaries = await listActivities(storage.rootHandle);
      const { state: nextState } = await syncStrava({
        rootHandle: storage.rootHandle,
        state: stravaState,
        existingSummaries,
        userSettings,
      });
      setStravaState(nextState);
    } catch (err) {
      setActionError(err.message || "Échec de la synchronisation Strava.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (isDemo || !storage.rootHandle || !stravaState) return;
    setBusy(true);
    setActionError(null);
    try {
      if (stravaState.tokens?.accessToken) {
        await revokeConnection({ accessToken: stravaState.tokens.accessToken }).catch(() => {
          // La révocation côté Strava peut échouer (réseau, jeton déjà expiré) ;
          // on oublie quand même la connexion localement plutôt que de bloquer
          // l'utilisateur sur une déconnexion qu'il a explicitement demandée.
        });
      }
      await clearStravaState(storage.rootHandle);
      await refresh();
    } catch (err) {
      setActionError(err.message || "Échec de la déconnexion Strava.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name">Sources de données</h1>
          <div className="gpx-ride-meta"><span>Stockage local et import automatique des sorties</span></div>
        </div>
        <div className="gpx-header-actions">
          <button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Retour</button>
        </div>
      </div>

      <div className="gpx-panel">
        <SectionTitle>Stockage local</SectionTitle>
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} onDisconnect={onDisconnectStorage} />
      </div>

      <div className="gpx-panel">
        <SectionTitle icon={Bike}>Strava</SectionTitle>

        {isDemo ? (
          <p className="gpx-empty-note">Indisponible en mode démo — connecte un dossier de stockage réel pour utiliser Strava.</p>
        ) : storage.status !== "connected" ? (
          <p className="gpx-empty-note">Connecte d'abord un dossier de stockage local (ci-dessus) : les sorties importées depuis Strava y sont enregistrées comme les autres.</p>
        ) : configMissing ? (
          <div className="gpx-storage-box gpx-storage-warn">
            <AlertCircle size={14} />
            <span>Connexion Strava non configurée (VITE_STRAVA_CLIENT_ID / VITE_STRAVA_REDIRECT_URI manquants). Voir .env.example.</span>
          </div>
        ) : stravaState == null ? (
          <p className="gpx-empty-note">Chargement…</p>
        ) : (
          <StravaConnectionCard
            state={stravaState}
            busy={busy}
            onConnect={handleConnect}
            onSync={handleSync}
            onDisconnect={handleDisconnect}
          />
        )}

        {actionError && <div className="gpx-error-box" style={{ marginTop: 10 }}>{actionError}</div>}
      </div>

      <CloudAccountPanel storage={storage} isDemo={isDemo} />
    </div>
  );
}

function StravaConnectionCard({ state, busy, onConnect, onSync, onDisconnect }) {
  if (!state.connected) {
    return (
      <div className="gpx-storage-box">
        <Bike size={14} />
        <span>Importe automatiquement tes sorties depuis Strava.</span>
        <button className="gpx-btn-ghost" onClick={onConnect}>Connecter Strava</button>
      </div>
    );
  }

  const summary = state.lastSyncSummary;
  const importedCount = state.importedStravaIds.length;

  return (
    <div>
      <div className="gpx-storage-box gpx-storage-ok">
        <CheckCircle2 size={14} />
        <span>
          Connecté{state.athlete?.firstname ? ` — ${state.athlete.firstname}` : ""}. {importedCount} activité{importedCount > 1 ? "s" : ""} synchronisée{importedCount > 1 ? "s" : ""}.
        </span>
      </div>
      <div className="gpx-empty-note" style={{ marginTop: 6 }}>
        Dernière synchro : {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("fr-FR") : "jamais"}
      </div>
      {summary && (summary.errors.length > 0 || summary.skippedDuplicates > 0) && (
        <div className="gpx-empty-note" style={{ marginTop: 4 }}>
          {summary.imported} importée{summary.imported > 1 ? "s" : ""}, {summary.skippedDuplicates} doublon{summary.skippedDuplicates > 1 ? "s" : ""} ignoré{summary.skippedDuplicates > 1 ? "s" : ""}
          {summary.errors.length > 0 && `, ${summary.errors.length} erreur${summary.errors.length > 1 ? "s" : ""}`}.
        </div>
      )}
      {summary && summary.errors.length > 0 && (
        <ul className="gpx-empty-note" style={{ marginTop: 4 }}>
          {summary.errors.slice(0, 5).map((e, i) => (
            <li key={i}>Activité {e.activityId} : {e.message}</li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="gpx-btn-ghost" onClick={onSync} disabled={busy}>
          <RefreshCw size={13} /> {busy ? "Synchronisation…" : "Synchroniser"}
        </button>
        <button className="gpx-btn-ghost" onClick={onDisconnect} disabled={busy}>
          <Unplug size={13} /> Déconnecter
        </button>
      </div>
    </div>
  );
}
