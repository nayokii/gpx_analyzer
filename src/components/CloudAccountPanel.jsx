/**
 * COMPTE CLOUD — panneau additif dans DataSourcesView.jsx (Phase 11A, étendu
 * Phase 11B, synchronisation automatique et conflits Phase 11C — voir
 * src/lib/cloud/README.md et docs/CLOUD_ARCHITECTURE.md).
 *
 * Ce composant ne recalcule rien : il pilote l'authentification (API
 * publique de src/lib/cloud/, voir son index.js) et la réconciliation
 * local/cloud via le repository unifié (voir
 * ../lib/storage/activityRepository.js et ./useActivityRepository.js) —
 * jamais un deuxième mécanisme de synchronisation. La synchronisation
 * automatique elle-même (login, retour en ligne) est déjà déclenchée par
 * `useActivityRepository()` — ce panneau se contente d'en REFLÉTER l'état
 * honnêtement (voir consigne 11C §7/§8), jamais de la dupliquer.
 *
 * État affiché — 7 valeurs, pas plus (voir consigne §7) :
 * `idle` (pas encore vérifié) / `offline` / `syncing` / `conflict` /
 * `error` / `pending` (upload/download ou file d'attente en attente) /
 * `synced` (tout est réconcilié). Dérivé par `deriveSyncStatus()`, jamais
 * stocké séparément — évite deux sources de vérité qui pourraient diverger.
 *
 * Conflits (voir consigne §13-16) : jamais résolus automatiquement. Le choix
 * de l'utilisateur ("Garder cette version" / "Garder la version cloud" /
 * "Plus tard") est traduit en action par `resolveConflict()` (pure, voir
 * activityRepository.js) puis exécuté par `repository.applyConflictResolution()`.
 *
 * Isolation démo : `isDemo` désactive totalement les actions cloud (aucun
 * appel réseau), même principe que la carte Strava juste au-dessus dans
 * DataSourcesView.jsx.
 */
import { useState, useEffect, useCallback } from "react";
import { Cloud, LogIn, UserPlus, LogOut, UploadCloud, DownloadCloud, RefreshCw, CheckCircle2, AlertCircle, WifiOff, Clock } from "lucide-react";

import { SectionTitle } from "./UIPrimitives.jsx";
import { useActivityRepository } from "./useActivityRepository.js";
import { isCloudConfigured, signUp, signIn, signOut } from "../lib/cloud/index.js";
import { listQueuedOperations } from "../lib/storage/syncQueue.js";

// Purement informatif pour l'UI (voir consigne §8 : "Dernière synchronisation :
// il y a 2 min") — jamais relu comme preuve de synchronisation réelle, qui
// vient toujours de repository.listActivities() (voir refresh()).
const LAST_SYNC_KEY = "gpx-analyzer-last-cloud-sync";

function relativeTime(iso) {
  if (!iso) return null;
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return `il y a ${Math.floor(diffH / 24)} j`;
}

function readLastSyncAt() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

/**
 * État honnête affiché à l'utilisateur (voir consigne 11C §7) — dérivé des
 * signaux disponibles, jamais une donnée stockée séparément. Priorité : une
 * coupure réseau ou une synchro en cours priment sur tout le reste, un
 * conflit non résolu prime sur une simple erreur/attente.
 */
function deriveSyncStatus({ online, syncing, counts, queuedCount, lastSyncHadErrors }) {
  if (!online) return "offline";
  if (syncing) return "syncing";
  if (!counts) return "idle";
  if (counts.conflict > 0) return "conflict";
  if (lastSyncHadErrors) return "error";
  if (queuedCount > 0 || counts.localOnly > 0 || counts.cloudOnly > 0) return "pending";
  return "synced";
}

function countByStatus(items) {
  const counts = { localOnly: 0, cloudOnly: 0, synced: 0, conflict: 0, total: items.length };
  for (const a of items) {
    if (a.syncStatus === "local-only") counts.localOnly += 1;
    else if (a.syncStatus === "cloud-only") counts.cloudOnly += 1;
    else if (a.syncStatus === "conflict") counts.conflict += 1;
    else counts.synced += 1;
  }
  return counts;
}

export function CloudAccountPanel({ storage, isDemo }) {
  const configured = isCloudConfigured();
  const { repository, cloudUser, online } = useActivityRepository(storage);

  const [authMode, setAuthMode] = useState("signIn");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [items, setItems] = useState(null); // résultat brut de listActivities().items — null = chargement
  const [reconcileError, setReconcileError] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(readLastSyncAt);
  const [resolvingId, setResolvingId] = useState(null);

  const refresh = useCallback(async () => {
    if (!cloudUser) return;
    setReconcileError(null);
    setQueuedCount(listQueuedOperations().length);
    try {
      const { items: fresh } = await repository.listActivities();
      setItems(fresh);
    } catch (err) {
      setReconcileError(err.message || "Impossible de vérifier l'état de synchronisation.");
    }
  }, [repository, cloudUser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAuthSubmit({ email, password }) {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (authMode === "signUp") await signUp({ email, password });
      else await signIn({ email, password });
    } catch (err) {
      setAuthError(err.message || "Échec de l'authentification.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOut();
      setItems(null);
      setLastSyncResult(null);
    } catch (err) {
      setAuthError(err.message || "Échec de la déconnexion.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncProgress({ current: 0, total: 0 });
    setLastSyncResult(null);
    try {
      // force: true — un clic explicite ("Synchroniser"/"Réessayer") doit
      // toujours relancer un vrai cycle, jamais renvoyer un résultat mis en
      // cache par le cooldown (voir activityRepository.js §3 : le cooldown
      // ne sert qu'à absorber des déclencheurs automatiques rapprochés).
      const result = await repository.sync({ onProgress: setSyncProgress, force: true });
      setLastSyncResult(result);
      const now = new Date().toISOString();
      setLastSyncAt(now);
      try {
        localStorage.setItem(LAST_SYNC_KEY, now);
      } catch {
        // best-effort : purement informatif, jamais bloquant
      }
      await refresh();
    } catch (err) {
      setLastSyncResult({ uploaded: 0, downloaded: 0, alreadySynced: 0, errors: [{ message: err.message || String(err) }] });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  async function handleResolveConflict(id, choice) {
    setResolvingId(id);
    try {
      await repository.applyConflictResolution(id, choice);
      await refresh();
    } catch (err) {
      setReconcileError(err.message || "Impossible de résoudre ce conflit.");
    } finally {
      setResolvingId(null);
    }
  }

  if (isDemo) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={Cloud}>Cloud</SectionTitle>
        <p className="gpx-empty-note">Indisponible en mode démo — connecte un compte réel pour utiliser le cloud.</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="gpx-panel">
        <SectionTitle icon={Cloud}>Cloud</SectionTitle>
        <div className="gpx-storage-box gpx-storage-warn">
          <AlertCircle size={14} />
          <span>Cloud non configuré (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants). Voir .env.example et docs/CLOUD_ARCHITECTURE.md.</span>
        </div>
      </div>
    );
  }

  const counts = items ? countByStatus(items) : null;
  const status = deriveSyncStatus({
    online,
    syncing,
    counts,
    queuedCount,
    lastSyncHadErrors: !!(lastSyncResult && lastSyncResult.errors && lastSyncResult.errors.length > 0),
  });
  const conflicts = items ? items.filter((a) => a.syncStatus === "conflict") : [];

  return (
    <div className="gpx-panel">
      <SectionTitle icon={Cloud}>Cloud</SectionTitle>

      {cloudUser === null ? (
        <AuthForm mode={authMode} onModeChange={setAuthMode} onSubmit={handleAuthSubmit} busy={authBusy} error={authError} />
      ) : (
        <div>
          <div className="gpx-storage-box gpx-storage-ok">
            <CheckCircle2 size={14} />
            <span>Connecté — {cloudUser.email}.</span>
            <button className="gpx-btn-ghost" onClick={handleSignOut} disabled={authBusy || syncing}>
              <LogOut size={13} /> Déconnexion
            </button>
          </div>

          {reconcileError && <div className="gpx-error-box" style={{ marginTop: 10 }}>{reconcileError}</div>}

          <StatusSection
            status={status}
            counts={counts}
            queuedCount={queuedCount}
            syncProgress={syncProgress}
            lastSyncAt={lastSyncAt}
            lastSyncResult={lastSyncResult}
            onSync={handleSync}
          />

          {conflicts.length > 0 && (
            <ConflictResolver conflicts={conflicts} resolvingId={resolvingId} onResolve={handleResolveConflict} />
          )}

          {authError && <div className="gpx-error-box" style={{ marginTop: 10 }}>{authError}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Un seul bloc d'état honnête (voir consigne §7/§8) : jamais deux messages
 * contradictoires affichés en même temps (ex. jamais "Synchronisé" ET
 * "Hors connexion" à la fois).
 */
function StatusSection({ status, counts, queuedCount, syncProgress, lastSyncAt, lastSyncResult, onSync }) {
  if (status === "idle") {
    return <p className="gpx-empty-note" style={{ marginTop: 10 }}>Vérification…</p>;
  }

  if (status === "offline") {
    return (
      <div className="gpx-storage-box gpx-storage-warn" style={{ marginTop: 10 }}>
        <WifiOff size={14} />
        <span>Hors connexion — les données locales restent disponibles. La synchronisation reprendra automatiquement dès le retour du réseau.</span>
      </div>
    );
  }

  if (status === "syncing") {
    const pct = syncProgress && syncProgress.total > 0 ? Math.round((syncProgress.current / syncProgress.total) * 100) : 0;
    return (
      <div style={{ marginTop: 14 }}>
        <div className="gpx-storage-box">
          <RefreshCw size={14} />
          <span>Synchronisation… {syncProgress && syncProgress.total > 0 ? `${syncProgress.current} / ${syncProgress.total}` : ""}</span>
        </div>
        <div className="gpx-tour-progress-bar" style={{ marginTop: 8 }}>
          <div className="gpx-tour-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (counts == null) return null; // pas encore de premier résultat (juste après idle)

  if (status === "conflict") {
    return (
      <div className="gpx-storage-box gpx-storage-warn" style={{ marginTop: 10 }}>
        <AlertCircle size={14} />
        <span>⚠ {counts.conflict} conflit{counts.conflict > 1 ? "s" : ""} détecté{counts.conflict > 1 ? "s" : ""} — voir le détail ci-dessous.</span>
      </div>
    );
  }

  if (status === "error") {
    const failedCount = lastSyncResult ? lastSyncResult.errors.length : 0;
    return (
      <div className="gpx-storage-box gpx-storage-warn" style={{ marginTop: 10 }}>
        <AlertCircle size={14} />
        <span>
          ⚠ Synchronisation interrompue — {failedCount} opération{failedCount > 1 ? "s n'ont" : " n'a"} pas pu être synchronisée{failedCount > 1 ? "s" : ""}.
        </span>
        <button className="gpx-link-btn" onClick={onSync}>Réessayer</button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div style={{ marginTop: 14 }}>
        <div className="gpx-storage-box">
          <Clock size={14} />
          <span>
            {queuedCount > 0
              ? `◌ ${queuedCount} opération${queuedCount > 1 ? "s" : ""} en attente`
              : `${counts.localOnly + counts.cloudOnly} sortie${counts.localOnly + counts.cloudOnly > 1 ? "s" : ""} pas encore synchronisée${counts.localOnly + counts.cloudOnly > 1 ? "s" : ""}`}
          </span>
        </div>
        <button className="gpx-btn-primary" style={{ marginTop: 10 }} onClick={onSync}>
          {counts.localOnly > 0 && counts.cloudOnly === 0 ? (
            <><UploadCloud size={14} /> Synchroniser mes sorties</>
          ) : counts.cloudOnly > 0 && counts.localOnly === 0 ? (
            <><DownloadCloud size={14} /> Télécharger l'historique</>
          ) : (
            <><RefreshCw size={14} /> Synchroniser</>
          )}
        </button>
      </div>
    );
  }

  // status === "synced"
  return (
    <div style={{ marginTop: 14 }}>
      <div className="gpx-storage-box gpx-storage-ok">
        <CheckCircle2 size={14} />
        <span>☁ Synchronisé — {counts.total} sortie{counts.total > 1 ? "s" : ""}.</span>
      </div>
      {lastSyncAt && <p className="gpx-empty-note" style={{ marginTop: 4 }}>Dernière synchronisation : {relativeTime(lastSyncAt)}</p>}
      <button className="gpx-btn-ghost" style={{ marginTop: 8 }} onClick={onSync}>
        <RefreshCw size={13} /> Synchroniser maintenant
      </button>
    </div>
  );
}

function conflictLabel(entry) {
  return entry.name || "Sortie sans nom";
}

function fmtKm(v) {
  return v == null ? "—" : `${v.toFixed(1)} km`;
}
function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString("fr-FR") : "—";
}
function fmtDurationShort(v) {
  if (v == null) return "—";
  const h = Math.floor(v / 3600);
  const m = Math.round((v % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Résolveur de conflits (voir consigne §13-16) — vue légère, jamais un gros
 * système de gestion de fichiers. N'affiche que les informations réellement
 * disponibles (distance, date, durée, source) ; une donnée absente reste
 * "—", jamais une valeur inventée. Ne résout JAMAIS automatiquement.
 */
function ConflictResolver({ conflicts, resolvingId, onResolve }) {
  return (
    <div style={{ marginTop: 14 }}>
      {conflicts.map((entry) => {
        const cloud = entry.cloudVersion || {};
        const busy = resolvingId === entry.id;
        return (
          <div className="gpx-storage-box gpx-storage-warn" key={entry.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={14} />
              <strong>{conflictLabel(entry)}</strong> — deux versions différentes existent.
            </div>
            <div className="gpx-table-wrap">
              <table className="gpx-table">
                <thead>
                  <tr><th></th><th>Version locale</th><th>Version cloud</th></tr>
                </thead>
                <tbody>
                  <tr><td>Distance</td><td>{fmtKm(entry.distance)}</td><td>{fmtKm(cloud.distance)}</td></tr>
                  <tr><td>Date</td><td>{fmtDate(entry.date)}</td><td>{fmtDate(cloud.date)}</td></tr>
                  <tr><td>Durée</td><td>{fmtDurationShort(entry.duration)}</td><td>{fmtDurationShort(cloud.duration)}</td></tr>
                  <tr><td>Source</td><td>{entry.source?.type || "—"}</td><td>{cloud.source?.type || "—"}</td></tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="gpx-btn-ghost" disabled={busy} onClick={() => onResolve(entry.id, "local")}>
                {busy ? "…" : "Garder cette version"}
              </button>
              <button className="gpx-btn-ghost" disabled={busy} onClick={() => onResolve(entry.id, "cloud")}>
                {busy ? "…" : "Garder la version cloud"}
              </button>
              <button className="gpx-link-btn" disabled={busy} onClick={() => onResolve(entry.id, "cancel")}>
                Plus tard
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AuthForm({ mode, onModeChange, onSubmit, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ email, password });
  }

  return (
    <form className="gpx-cloud-form" onSubmit={handleSubmit}>
      <label className="gpx-cloud-field">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="gpx-cloud-field">
        Mot de passe
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signUp" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="gpx-cloud-form-actions">
        <button className="gpx-btn-primary" type="submit" disabled={busy}>
          {mode === "signUp" ? <UserPlus size={14} /> : <LogIn size={14} />}
          {busy ? "…" : mode === "signUp" ? "Créer un compte" : "Se connecter"}
        </button>
        <button
          type="button"
          className="gpx-link-btn"
          onClick={() => onModeChange(mode === "signUp" ? "signIn" : "signUp")}
        >
          {mode === "signUp" ? "J'ai déjà un compte" : "Créer un compte"}
        </button>
      </div>
      {error && <div className="gpx-error-box">{error}</div>}
    </form>
  );
}
