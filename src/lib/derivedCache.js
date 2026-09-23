/**
 * Cache mémoïsé pour les calculs dérivés lourds (profil, timeline, progression,
 * matching d'archétype) — Phase 9E.
 *
 * Pourquoi ce module existe : ProfileView.jsx, AlterEgoView.jsx et
 * ArchetypeView.jsx chargent chacune INDÉPENDAMMENT le même historique
 * complet (mêmes activités) et en dérivent chacune leur propre profil/
 * progression/matching. Ce sont trois composants React DIFFÉRENTS, montés/
 * démontés à chaque changement d'onglet (voir GPXAnalyzer.jsx :
 * `{mode === "profil" && <ProfileView/>}`) : `useMemo` ne peut PAS partager
 * un résultat entre eux (chaque instance de composant a son propre cache de
 * memo), et un remount perd de toute façon tout memo précédent. Sans ce
 * module, naviguer Profil → Alter Ego → Archétype recalculait tout depuis
 * zéro à chaque étape (mesuré : ~2,5 s cumulés sur 6 activités réelles après
 * la correction de `computeBestPowerEfforts`, voir docs/PERFORMANCE.md) —
 * ce cache ramène cette navigation à quasiment 0 ms une fois le premier
 * calcul fait.
 *
 * Principes (voir consigne) :
 * - Les fonctions enveloppées restent 100% pures et INCHANGÉES : ce module
 *   ne recalcule jamais rien lui-même, il retient juste un résultat déjà
 *   produit par l'appel réel pour un jeu d'entrées identique.
 * - Jamais de donnée périmée : la clé de cache pour un tableau d'activités
 *   est dérivée de `id:analysisVersion` de CHAQUE activité (voir
 *   `activitiesSignature`) — si une activité est ajoutée, supprimée, ou
 *   recalculée avec une version d'analyse différente, la signature change et
 *   le cache est naturellement invalidé (jamais besoin d'un appel explicite
 *   "invalidate"). Les fichiers `activities/*.json` restent la seule source
 *   de vérité ; ce cache ne fait que réutiliser un résultat déjà calculé À
 *   PARTIR d'eux, jamais une donnée indépendante.
 * - Cache borné (`MAX_ENTRIES_PER_FN`) : pas de fuite mémoire même si
 *   l'utilisateur change souvent de dossier de stockage pendant une session.
 * - `matchArchetypes`/`matchReferenceRiders` prennent un `profile` (pas des
 *   activités) : mémoïsés par RÉFÉRENCE d'objet via `WeakMap` — cette
 *   référence n'est stable que si `profile` vient lui-même du cache
 *   `getCachedProfile()` ci-dessous (sinon, deux profils au contenu
 *   identique mais recalculés séparément resteraient deux objets distincts,
 *   et c'est très bien ainsi : un WeakMap ne peut jamais servir un résultat
 *   pour un objet qu'il n'a pas vu).
 */

import { computeCyclistProfile, buildProfileTimeline } from "./profile/profile.js";
import { computeProgression } from "./progression/progression.js";
import { matchArchetypes, matchReferenceRiders } from "./archetypes/matching.js";

const MAX_ENTRIES_PER_FN = 12;

function activitiesSignature(activities) {
  return (activities || []).map((a) => `${a.id}:${a.analysisVersion ?? 1}`).join(",");
}

/** Petit cache LRU (ordre d'insertion) générique, un par fonction enveloppée. */
function createBoundedCache(maxEntries) {
  let map = new Map(); // Map préserve l'ordre d'insertion en JS -> sert de file LRU simple
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (map.has(key)) map.delete(key); // ré-insère en fin (le plus récent)
      map.set(key, value);
      if (map.size > maxEntries) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
      }
    },
    clear() {
      map = new Map();
    },
  };
}

const boundedCaches = {
  profile: createBoundedCache(MAX_ENTRIES_PER_FN),
  timeline: createBoundedCache(MAX_ENTRIES_PER_FN),
  progression: createBoundedCache(MAX_ENTRIES_PER_FN),
  archetypeTimeline: createBoundedCache(MAX_ENTRIES_PER_FN),
};
const profileCache = boundedCaches.profile;
const timelineCache = boundedCaches.timeline;
const progressionCache = boundedCaches.progression;
const archetypeTimelineCache = boundedCaches.archetypeTimeline;

let matchArchetypesCache = new WeakMap(); // clé = référence `profile`
let matchRidersCache = new WeakMap(); // clé = référence `profile` -> Map(optionsKey -> résultat)

/**
 * Équivalent mémoïsé de `computeCyclistProfile()` (voir profile/profile.js) —
 * même signature, même résultat, jamais recalculé pour le même jeu
 * d'activités.
 * @param {import('./types.js').Activity[]} activities
 * @param {Object} [options]
 * @returns {Object}
 */
export function getCachedProfile(activities, options = {}) {
  const key = activitiesSignature(activities) + (options.now ? `@${options.now.getTime()}` : "");
  const hit = profileCache.get(key);
  if (hit) return hit;
  const result = computeCyclistProfile(activities, options);
  profileCache.set(key, result);
  return result;
}

/**
 * Équivalent mémoïsé de `buildProfileTimeline()`.
 * @param {import('./types.js').Activity[]} activities
 * @param {Object} [options]
 * @returns {Array}
 */
export function getCachedProfileTimeline(activities, options = {}) {
  const key =
    activitiesSignature(activities) +
    `|${options.bucket || "month"}|${options.cumulative !== false}` +
    (options.now ? `@${options.now.getTime()}` : "");
  const hit = timelineCache.get(key);
  if (hit) return hit;
  const result = buildProfileTimeline(activities, options);
  timelineCache.set(key, result);
  return result;
}

/**
 * Équivalent mémoïsé de `computeProgression()`. `profile`, s'il vient déjà de
 * `getCachedProfile()`, est inclus dans la clé par référence implicite via
 * son contenu (on réutilise la signature des activités : `profile` en est
 * une fonction déterministe, donc la même signature d'activités implique le
 * même `profile`).
 * @param {import('./types.js').Activity[]} activities
 * @param {Object|null} profile
 * @param {Object} [options]
 * @returns {Object}
 */
export function getCachedProgression(activities, profile, options = {}) {
  const key = activitiesSignature(activities) + `|prog` + (options.now ? `@${options.now.getTime()}` : "");
  const hit = progressionCache.get(key);
  if (hit) return hit;
  const result = computeProgression(activities, profile, options);
  progressionCache.set(key, result);
  return result;
}

/**
 * Équivalent mémoïsé de `matchArchetypes()` — mémoïsé par RÉFÉRENCE de
 * `profile` (voir docstring du module).
 * @param {Object|null} profile
 * @returns {Object}
 */
export function getCachedArchetypeMatch(profile) {
  if (!profile) return matchArchetypes(profile);
  const hit = matchArchetypesCache.get(profile);
  if (hit) return hit;
  const result = matchArchetypes(profile);
  matchArchetypesCache.set(profile, result);
  return result;
}

/**
 * Équivalent mémoïsé de `matchReferenceRiders()` — mémoïsé par RÉFÉRENCE de
 * `profile`, sous-clé par les options (limit/minMatchedDimensions).
 * @param {Object|null} profile
 * @param {Object} [options]
 * @returns {Array}
 */
export function getCachedReferenceRiders(profile, options = {}) {
  if (!profile) return matchReferenceRiders(profile, options);
  const optionsKey = JSON.stringify(options);
  let perProfile = matchRidersCache.get(profile);
  if (!perProfile) {
    perProfile = new Map();
    matchRidersCache.set(profile, perProfile);
  }
  if (perProfile.has(optionsKey)) return perProfile.get(optionsKey);
  const result = matchReferenceRiders(profile, options);
  perProfile.set(optionsKey, result);
  return result;
}

/**
 * Équivalent mémoïsé de `buildArchetypeTimeline()` (voir archetypes/matching.js)
 * — recalcule sa propre timeline de profil via `getCachedProfileTimeline()`
 * (au lieu d'appeler `buildProfileTimeline` indépendamment, comme le fait la
 * version non mémoïsée) pour ne jamais dupliquer ce travail avec
 * `getCachedProfileTimeline()` déjà appelée ailleurs (ex. ProfileView.jsx)
 * sur le même historique.
 * @param {import('./types.js').Activity[]} activities
 * @param {Object} [options]
 * @returns {Array}
 */
export function getCachedArchetypeTimeline(activities, options = {}) {
  const key =
    activitiesSignature(activities) +
    `|archTl|${options.bucket || "month"}|${options.cumulative !== false}` +
    (options.now ? `@${options.now.getTime()}` : "");
  const hit = archetypeTimelineCache.get(key);
  if (hit) return hit;
  const timeline = getCachedProfileTimeline(activities, options);
  const result = timeline.map((point) => ({
    date: point.date,
    activityCountAtPoint: point.activityCountAtPoint,
    match: getCachedArchetypeMatch(point.profile),
  }));
  archetypeTimelineCache.set(key, result);
  return result;
}

/** Réservé aux tests : vide tous les caches pour repartir d'un état propre entre deux cas de test. */
export function __clearDerivedCachesForTests() {
  for (const c of Object.values(boundedCaches)) c.clear();
  matchArchetypesCache = new WeakMap();
  matchRidersCache = new WeakMap();
}
