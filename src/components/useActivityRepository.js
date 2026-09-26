/**
 * Hooks React partagés par HistoryView/HistoryDashboard/ProfileView/
 * AlterEgoView/ArchetypeView/TourView/GPXAnalyzer.jsx (Phase 11B) pour
 * consommer le repository unifié (voir ../lib/storage/activityRepository.js)
 * sans dupliquer la même mécanique de chargement dans chaque vue.
 *
 * `useActivityRepository(storage, userSettings)` : construit le repository
 * pour la vue courante, en s'abonnant à l'état d'authentification cloud (voir
 * ../lib/cloud/index.js). Si le cloud n'est pas configuré (VITE_SUPABASE_*
 * absentes) ou si `getCurrentUser()` échoue pour toute autre raison,
 * `cloudUser` reste `null` — comportement STRICTEMENT identique à avant cette
 * phase (voir ../lib/storage/activityRepository.js : sans `cloudUser`, le
 * repository n'est qu'un passe-plat vers le stockage local).
 *
 * Synchronisation automatique (Phase 11C, voir consigne §1) : ce hook
 * déclenche `repository.sync()` (jamais un second mécanisme, voir sa
 * déduplication/son cooldown MODULE-LEVEL dans activityRepository.js) à
 * trois moments — login (et ouverture de l'app si déjà connecté, même
 * chemin : voir plus bas), et retour en ligne (`window` "online"). Chaque
 * vue qui appelle ce hook obtient donc l'auto-sync "gratuitement", sans
 * qu'aucune vue n'ait à s'en soucier explicitement (voir consigne §9 :
 * "ne jamais bloquer l'application").
 *
 * `useUnifiedActivities(repository, options)` : reproduit exactement le
 * chargement en deux étages déjà utilisé par ProfileView.jsx/AlterEgoView.jsx/
 * ArchetypeView.jsx/TourView.jsx (index léger, puis détail complet plafonné,
 * `Promise.allSettled`). Depuis la Phase 11C, se réabonne aussi à
 * `onSyncCompleted()` (voir activityRepository.js) pour se rafraîchir
 * automatiquement quand une synchronisation déclenchée AILLEURS (un autre
 * composant monté, ou le déclencheur "online" ci-dessus) a changé quelque
 * chose — sans quoi une vue déjà ouverte resterait figée sur des données
 * périmées après une synchro en arrière-plan (voir consigne §11/§12).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createActivityRepository, onSyncCompleted } from "../lib/storage/activityRepository.js";
import { getCurrentUser, onAuthStateChange } from "../lib/cloud/index.js";

function subscribeAuthSafely(callback) {
  try {
    return onAuthStateChange(callback);
  } catch {
    // Cloud non configuré (voir ../lib/cloud/client.js: CloudNotConfiguredError) :
    // aucun abonnement possible, mais ce n'est jamais une erreur pour cette
    // vue — équivaut simplement à "jamais connecté".
    return () => {};
  }
}

/** @returns {boolean} état de connectivité réseau du navigateur, tenu à jour via les évènements "online"/"offline". */
function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

/**
 * @param {{status: string, rootHandle: FileSystemDirectoryHandle|null}} storage
 * @param {Object|null} [userSettings] - {weight, bikeWeight, ftp}, transmis tel quel au repository (voir activityRepository.js: matérialisation depuis le cloud)
 * @returns {{repository: Object, cloudUser: Object|null, online: boolean}}
 */
export function useActivityRepository(storage, userSettings = null) {
  const [cloudUser, setCloudUser] = useState(null);
  const online = useOnlineStatus();

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => { if (!cancelled) setCloudUser(u); })
      .catch(() => { if (!cancelled) setCloudUser(null); });
    const unsubscribe = subscribeAuthSafely((u) => { if (!cancelled) setCloudUser(u); });
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  const repository = useMemo(
    () => createActivityRepository({ rootHandle: storage.rootHandle || null, cloudUser, userSettings }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- userSettings est un objet recréé à chaque render côté GPXAnalyzer.jsx ; comparer ses champs primitifs évite de reconstruire le repository (et donc de relancer tous les chargements) à chaque frappe dans les réglages.
    [storage.rootHandle, cloudUser, userSettings?.weight, userSettings?.bikeWeight, userSettings?.ftp]
  );

  // Le repository est recréé à chaque changement de réglages utilisateur
  // (voir useMemo ci-dessus) : cette ref permet aux effets de déclenchement
  // automatique ci-dessous de toujours appeler la version la PLUS RÉCENTE du
  // repository, sans pour autant les re-déclencher à chaque frappe dans les
  // réglages (voir consigne §23 : ne jamais resynchroniser pour rien).
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  // Déclencheur "login" (et "ouverture de l'app si déjà connecté" — le même
  // évènement : `cloudUser` passe de `null` à un utilisateur réel dès que
  // `getCurrentUser()` résout une session déjà persistée, voir consigne §1).
  // Dépend de `cloudUser?.id`, pas de l'objet entier : un rafraîchissement de
  // jeton (même session, nouvel objet) ne doit pas redéclencher une synchro.
  useEffect(() => {
    if (!cloudUser) return;
    repositoryRef.current.sync().catch(() => {
      // Erreur déjà exposée à l'utilisateur ailleurs (CloudAccountPanel) —
      // un échec de synchro automatique ne doit jamais remonter comme une
      // exception non gérée ni bloquer la vue courante (consigne §9).
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser?.id]);

  // Déclencheur "retour en ligne" (voir consigne §1 : `window.addEventListener("online", ...)`).
  useEffect(() => {
    function handleOnline() {
      if (repositoryRef.current.hasCloud) {
        repositoryRef.current.sync().catch(() => {});
      }
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return { repository, cloudUser, online };
}

/**
 * @param {Object} repository - voir ../lib/storage/activityRepository.js
 * @param {{max?: number}} [options]
 * @returns {{
 *   summaries: Array|null, summariesError: string|null,
 *   fullActivities: Array|null, failedCount: number,
 *   source: 'local'|'cloud'|'offline'|'error'|null, refresh: Function,
 * }}
 */
export function useUnifiedActivities(repository, { max = 200 } = {}) {
  const [summaries, setSummaries] = useState(null); // null = chargement, [] = historique vide
  const [summariesError, setSummariesError] = useState(null);
  const [fullActivities, setFullActivities] = useState(null);
  const [failedCount, setFailedCount] = useState(0);
  const [source, setSource] = useState(null);

  const refresh = useCallback(() => {
    setSummariesError(null);
    setSummaries(null);
    setFullActivities(null);
    setFailedCount(0);
    setSource(null);
    repository
      .listActivities()
      .then(({ items, source: src }) => {
        setSummaries(items);
        setSource(src);
      })
      .catch((err) => setSummariesError(err.message || "Impossible de lire l'historique."));
  }, [repository]);

  useEffect(() => { refresh(); }, [refresh]);

  // Phase 11C : une synchronisation déclenchée ailleurs (autre composant
  // monté, ou le déclencheur "online" de useActivityRepository ci-dessus) qui
  // a réellement changé quelque chose doit rafraîchir cette vue — sans quoi
  // Historique/Profil/Alter Ego/Archétype/Tour resteraient figés sur des
  // données périmées après une synchro en arrière-plan (voir consigne §11/§12).
  // `onSyncCompleted` ne notifie déjà que les synchros avec un changement réel
  // (voir activityRepository.js) : ne recalcule jamais pour rien.
  useEffect(() => onSyncCompleted(() => refresh()), [refresh]);

  useEffect(() => {
    if (!summaries || summaries.length === 0) return;
    let cancelled = false;
    const toLoad = summaries.slice(0, max);
    repository.loadActivityDetails(toLoad).then((results) => {
      if (cancelled) return;
      setFullActivities(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setFailedCount(results.filter((r) => r.status === "rejected").length);
    });
    return () => { cancelled = true; };
  }, [summaries, repository, max]);

  return { summaries, summariesError, fullActivities, failedCount, source, refresh };
}
