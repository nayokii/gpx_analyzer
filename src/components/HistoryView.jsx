/**
 * Historique des sorties enregistrées localement.
 *
 * Liste, recherche/filtre par date, ouverture, suppression. La sélection
 * multiple (checkbox par ligne + barre de sélection) alimente la comparaison
 * (Phase 5B, voir HistoryDashboard.jsx) via `onCompare` : ce composant ne
 * calcule ni ne charge rien lui-même pour la comparaison, il se contente de
 * remonter les deux ids sélectionnés.
 *
 * Chargement des activités : par défaut ce composant lit lui-même
 * `listActivities()` (usage autonome). Quand un parent a déjà besoin de la
 * même liste pour ses propres agrégats (HistoryDashboard.jsx), il peut la
 * fournir via les props `activities`/`error`/`onRefresh` : ce composant
 * n'effectue alors plus sa propre lecture, pour éviter un double fetch et un
 * double état de chargement/erreur affiché à l'écran.
 */
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Search, Trash2, ExternalLink, History as HistoryIcon } from "lucide-react";

import { listActivities, deleteActivity } from "../lib/storage/activityStore.js";
import { fmt1, fmtInt, fmtDuration, fmtDateFull } from "../lib/utils.js";
import { StorageSettings } from "./StorageSettings.jsx";

export function HistoryView({
  storage, onConnect, onReconnect, onOpen, onBack, onCompare, children,
  activities: activitiesProp, error: errorProp, onRefresh,
}) {
  const controlled = activitiesProp !== undefined;

  const [activitiesState, setActivitiesState] = useState(null); // null = chargement
  const [errorState, setErrorState] = useState(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const activities = controlled ? activitiesProp : activitiesState;
  const error = controlled ? errorProp : errorState;

  const refresh = useCallback(() => {
    if (controlled) {
      onRefresh && onRefresh();
      return;
    }
    if (storage.status !== "connected" || !storage.rootHandle) return;
    setErrorState(null);
    listActivities(storage.rootHandle)
      .then((list) => setActivitiesState(list))
      .catch((err) => setErrorState(err.message || "Impossible de lire l'historique."));
  }, [controlled, onRefresh, storage.status, storage.rootHandle]);

  useEffect(() => {
    if (!controlled) refresh();
  }, [refresh, controlled]);

  async function handleDelete(id, name) {
    if (!window.confirm(`Supprimer définitivement « ${name || "cette sortie"} » (fichier original inclus) ?`)) return;
    try {
      await deleteActivity(storage.rootHandle, id);
      setSelectedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      refresh();
    } catch (err) {
      if (controlled) onRefresh && onRefresh();
      else setErrorState(err.message || "Impossible de supprimer cette sortie.");
    }
  }

  function toggleSelect(id) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = (activities || []).filter((a) => {
    if (search && !(a.name || "").toLowerCase().includes(search.toLowerCase())) return false;
    const day = a.date ? a.date.slice(0, 10) : null;
    if (dateFrom && (!day || day < dateFrom)) return false;
    if (dateTo && (!day || day > dateTo)) return false;
    return true;
  });

  return (
    <div className="gpx-dashboard">
      <div className="gpx-header">
        <div className="gpx-header-left">
          <h1 className="gpx-ride-name"><HistoryIcon size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Historique</h1>
          <div className="gpx-ride-meta">
            <span>{activities ? `${activities.length} sortie${activities.length > 1 ? "s" : ""} enregistrée${activities.length > 1 ? "s" : ""}` : "Chargement…"}</span>
          </div>
        </div>
        <div className="gpx-header-actions">
          <button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Retour</button>
        </div>
      </div>

      <div className="gpx-panel">
        <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} />
      </div>

      {storage.status === "connected" && children}

      {storage.status === "connected" && (
        <div className="gpx-panel">
          <div className="gpx-history-toolbar">
            <div className="gpx-history-search">
              <Search size={14} />
              <input type="text" placeholder="Rechercher par nom…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="gpx-history-daterange">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span>→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          {error && <div className="gpx-error-box" style={{ marginBottom: 14 }}>{error}</div>}

          {activities == null ? (
            <p className="gpx-empty-note">Chargement de l'historique…</p>
          ) : filtered.length === 0 ? (
            <p className="gpx-empty-note">
              {activities.length === 0 ? "Aucune sortie enregistrée pour le moment — importe un GPX pour commencer ton historique." : "Aucune sortie ne correspond à ce filtre."}
            </p>
          ) : (
            <div className="gpx-table-wrap">
              <table className="gpx-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Nom</th>
                    <th>Distance</th>
                    <th>Durée</th>
                    <th>D+</th>
                    <th>Vitesse</th>
                    <th>Puissance</th>
                    <th>HR</th>
                    <th>Cadence</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="gpx-row-clickable" onClick={() => onOpen(a.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} title="Sélectionner pour comparer (2 sorties max.)" />
                      </td>
                      <td>{a.date ? fmtDateFull(new Date(a.date)) : "Date inconnue"}</td>
                      <td>
                        {a.name || "Sortie vélo"}
                        {a.source && a.source.type === "strava" && (
                          <span className="gpx-source-badge-strava" title="Importée depuis Strava">Strava</span>
                        )}
                      </td>
                      <td>{fmt1(a.distance)} km</td>
                      <td>{fmtDuration(a.duration)}</td>
                      <td>{a.elevationGain != null ? `+${fmtInt(a.elevationGain)} m` : "—"}</td>
                      <td>{a.avgSpeed != null ? `${fmt1(a.avgSpeed)} km/h` : "—"}</td>
                      <td>
                        {a.avgPower != null ? (
                          <>
                            {a.flags && a.flags.powerEstimated ? `≈ ${fmtInt(a.avgPower)} W` : `${fmtInt(a.avgPower)} W`}
                            <span
                              className={a.flags && a.flags.powerEstimated ? "gpx-power-source-estimated" : "gpx-power-source"}
                              style={{ marginLeft: 6 }}
                            >
                              {a.flags && a.flags.powerEstimated ? "estimée" : "mesurée"}
                            </span>
                          </>
                        ) : "—"}
                      </td>
                      <td>{a.avgHeartRate != null ? `${fmtInt(a.avgHeartRate)} bpm` : "—"}</td>
                      <td>{a.avgCadence != null ? `${fmtInt(a.avgCadence)} rpm` : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                        <button className="gpx-icon-btn" title="Ouvrir" onClick={() => onOpen(a.id)}><ExternalLink size={14} /></button>
                        <button className="gpx-icon-btn" title="Supprimer" onClick={() => handleDelete(a.id, a.name)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="gpx-history-selection-bar">
              <span>{selectedIds.size} sortie{selectedIds.size > 1 ? "s" : ""} sélectionnée{selectedIds.size > 1 ? "s" : ""}</span>
              <button
                className="gpx-btn-ghost"
                disabled={selectedIds.size !== 2 || !onCompare}
                title={selectedIds.size !== 2 ? "Sélectionne exactement 2 sorties pour les comparer" : "Comparer ces deux sorties"}
                onClick={() => onCompare && onCompare([...selectedIds])}
              >
                Comparer
              </button>
              <button className="gpx-link-btn" onClick={() => setSelectedIds(new Set())}>Désélectionner</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
