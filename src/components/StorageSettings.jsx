/**
 * Petit bandeau d'état + actions pour le stockage local durable des sorties
 * (File System Access API). Utilisé à la fois sur la page d'accueil (rappel
 * discret) et dans l'onglet Paramètres (contrôle complet).
 */
import { Info, FileWarning, RefreshCw, FolderOpen } from "lucide-react";

export function StorageSettings({ storage, onConnect, onReconnect, onDisconnect, compact = false }) {
  if (storage.status === "checking") return null;

  if (storage.status === "unsupported") {
    return (
      <div className="gpx-storage-box gpx-storage-warn">
        <FileWarning size={14} />
        <span>Sauvegarde automatique non disponible : nécessite Chrome ou Edge (File System Access API).</span>
      </div>
    );
  }

  if (storage.status === "connected") {
    return (
      <div className="gpx-storage-box gpx-storage-ok">
        <Info size={14} />
        <span>Sorties sauvegardées automatiquement dans « {storage.dirName} ».</span>
        {!compact && (
          <button className="gpx-link-btn" onClick={onDisconnect}>
            Déconnecter
          </button>
        )}
      </div>
    );
  }

  if (storage.status === "needs-permission") {
    return (
      <div className="gpx-storage-box gpx-storage-warn">
        <FileWarning size={14} />
        <span>Accès au dossier « {storage.dirName} » à reconfirmer.</span>
        <button className="gpx-btn-ghost" onClick={onReconnect}>
          <RefreshCw size={13} /> Reconnecter
        </button>
      </div>
    );
  }

  return (
    <div className="gpx-storage-box">
      <FolderOpen size={14} />
      <span>Connecte un dossier local pour conserver automatiquement tes sorties et retrouver ton historique.</span>
      <button className="gpx-btn-ghost" onClick={onConnect}>
        <FolderOpen size={13} /> Connecter un dossier
      </button>
    </div>
  );
}
