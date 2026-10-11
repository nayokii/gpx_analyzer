/**
 * ACTIVITÉS — fil de publications visuelles des sorties (inspiré des posts
 * d'activité), sans aucun mécanisme social (ni likes, commentaires, abonnés).
 *
 * Source de données : EXACTEMENT celle de l'Historique —
 * `repository.listActivities()` (voir ../lib/storage/activityRepository.js),
 * rafraîchie par `onSyncCompleted`. Aucun second stockage de sorties : seuls
 * les noms personnalisés sont conservés à part (voir ../lib/feed/nameOverrides.js).
 * Lecture seule : cette vue n'appelle jamais saveActivity/deleteActivity/sync.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Newspaper } from "lucide-react";

import { StorageSettings } from "./StorageSettings.jsx";
import { PageHead } from "./UIPrimitives.jsx";
import { ActivityPost } from "./ActivityPost.jsx";
import { ActivityShareDialog } from "./ActivityShareDialog.jsx";
import { useActivityRepository } from "./useActivityRepository.js";
import { onSyncCompleted } from "../lib/storage/activityRepository.js";
import { filterAndSortActivities, availableTypes, activityTypeLabel, displayName, SORT_OPTIONS } from "../lib/feed/feedModel.js";
import { loadNameOverrides, saveNameOverride } from "../lib/feed/nameOverrides.js";

const PAGE_SIZE = 10;

export function ActivityFeedView({ storage, onConnect, onReconnect, onOpen, onBack, userSettings }) {
  const { repository } = useActivityRepository(storage, userSettings);
  const ready = storage.status === "connected" || repository.hasCloud;

  const [items, setItems] = useState(null); // null = chargement
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("date");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [overrides, setOverrides] = useState(() => loadNameOverrides());
  const [sharing, setSharing] = useState(null); // { name, activity }

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setError(null);
    repository
      .listActivities()
      .then(({ items: list }) => { if (!cancelled) setItems(list); })
      .catch((err) => { if (!cancelled) setError(err.message || "Impossible de lire les sorties."); });
    return () => { cancelled = true; };
  }, [ready, repository, reloadKey]);

  useEffect(() => onSyncCompleted(() => setReloadKey((k) => k + 1)), []);

  const retry = useCallback(() => { setItems(null); setReloadKey((k) => k + 1); }, []);

  const types = useMemo(() => availableTypes(items), [items]);
  const results = useMemo(
    () => filterAndSortActivities(items || [], { query, type, sort, overrides }),
    [items, query, type, sort, overrides]
  );
  const shown = results.slice(0, visible);

  // Toute modification des critères repart de la première page.
  useEffect(() => { setVisible(PAGE_SIZE); }, [query, type, sort]);

  const rename = useCallback((id, name) => setOverrides((o) => saveNameOverride(o, id, name)), []);
  const openShare = useCallback((summary, full) => setSharing({ name: displayName(summary, overrides), activity: full }), [overrides]);

  const meta = items
    ? `${items.length} sortie${items.length > 1 ? "s" : ""}`
    : error ? "Erreur de chargement" : "Chargement…";

  return (
    <div className="gpx-dashboard gpx-feed gpx-ds">
      <PageHead
        title="Activités"
        meta={ready ? meta : undefined}
        actions={<button className="gpx-btn-ghost" onClick={onBack}><ArrowLeft size={15} /> <span>Retour</span></button>}
      />
      {storage.status !== "connected" && (
        <div className="gpx-statusline">
          <StorageSettings storage={storage} onConnect={onConnect} onReconnect={onReconnect} compact />
        </div>
      )}

      {ready && (
        <>
          <div className="gpx-feed-toolbar" role="search">
            <label className="gpx-feed-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" placeholder="Rechercher une sortie…" aria-label="Rechercher par nom de sortie" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="gpx-feed-sort">
              <span>Trier par</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier les sorties">
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          </div>
          {types.length > 1 && (
            <div className="gpx-feed-types" role="group" aria-label="Filtrer par type d'activité">
              {["all", ...types].map((t) => (
                <button key={t} className={"gpx-chip" + (type === t ? " gpx-chip-active" : "")} aria-pressed={type === t} onClick={() => setType(t)}>
                  {t === "all" ? "Toutes" : activityTypeLabel(t)}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="gpx-error-box" role="alert">
              {error} <button className="gpx-link-btn" onClick={retry}>Réessayer</button>
            </div>
          )}

          {items == null && !error ? (
            <div className="gpx-feed-list" aria-busy="true" aria-label="Chargement des sorties">
              {[0, 1].map((i) => <div key={i} className="gpx-post gpx-post--skeleton" />)}
            </div>
          ) : items && items.length === 0 ? (
            <div className="gpx-feed-empty">
              <Newspaper size={28} />
              <p>Aucune sortie enregistrée pour le moment — importe un fichier GPX ou FIT pour alimenter ton fil.</p>
            </div>
          ) : items && results.length === 0 ? (
            <div className="gpx-feed-empty"><p>Aucune sortie ne correspond à ces critères.</p></div>
          ) : (
            <>
              <div className="gpx-feed-list">
                {shown.map((s) => (
                  <ActivityPost key={s.id} summary={s} overrides={overrides} repository={repository} onRename={rename} onOpen={onOpen} onShare={openShare} />
                ))}
              </div>
              {results.length > shown.length && (
                <div className="gpx-feed-more">
                  <button className="gpx-btn-ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                    Afficher plus ({results.length - shown.length} restante{results.length - shown.length > 1 ? "s" : ""})
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {sharing && <ActivityShareDialog activity={sharing.activity} name={sharing.name} onClose={() => setSharing(null)} />}
    </div>
  );
}
