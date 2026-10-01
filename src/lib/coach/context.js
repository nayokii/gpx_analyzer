/**
 * Coach V1/V2 — Data Access (lecture seule).
 *
 * Construit un CONTEXTE compact, sérialisable, destiné à être transmis à un
 * LLM (aucun appel IA n'est fait ici — voir consignes Phase Coach V1/V2) à
 * partir des données déjà calculées ailleurs dans l'app :
 *
 *   Activity[] (déjà chargées, jamais reparsées)
 *         ↓ résumé par sortie (champs déjà présents sur Activity — voir types.js)
 *         ↓ détail de la dernière sortie (montées/efforts/arrêts — rideDetail.js, V2)
 *         ↓ comparaison dernière sortie ↔ récentes (comparison.js, V2)
 *         ↓ profil cycliste (profile/profile.js, via le cache derivedCache.js)
 *         ↓ progression/challenges (progression/progression.js, idem)
 *         ↓ records (history/records.js)
 *   CoachContext structuré
 *
 * Règles strictes (respectées ici, pas de dérogation) :
 * - Ne recalcule JAMAIS une métrique déjà portée par `Activity` (distance,
 *   durée, vitesses, D+, FC, cadence, puissance) : ces champs sont recopiés
 *   tels quels — voir `summarizeRide()`.
 * - Ne repart PAS des points GPS bruts pour une métrique déjà disponible.
 *   Exception V2, assumée et documentée dans rideDetail.js : montées, efforts
 *   détectés et détail des arrêts n'existent NULLE PART comme champ résumé de
 *   `Activity` — ils ne sont accessibles qu'en rejouant `computeAnalysis()` +
 *   `computeActivityAnalytics()` sur les points, mais à partir des `samples`
 *   déjà PARSÉS et déjà stockés (jamais une relecture de fichier), et en
 *   réutilisant TEL QUEL le pipeline existant (climbs.js/efforts.js/
 *   pauses.js), jamais une réimplémentation. Limité à la dernière sortie
 *   (voir `lastRideDetail`) pour ne jamais payer ce coût sur tout
 *   l'historique.
 * - Seule exception mineure V1 : la température moyenne, qui n'est pas un
 *   champ résumé de `Activity`, est une simple moyenne (voir `utils.js:
 *   avg()`) des valeurs déjà PARSÉES et déjà stockées dans
 *   `activity.samples[].temperature` — aucun recalcul d'algorithme.
 * - Ne fabrique jamais de valeur : un champ absent de la source reste `null`,
 *   jamais 0 ni une valeur interpolée (voir types.js).
 * - Puissance mesurée et estimée ne sont jamais présentées comme équivalentes
 *   (`power.source` distingue toujours les deux, comme dans analytics.js).
 * - Lecture seule stricte : aucune fonction de ce module n'écrit, ne modifie
 *   ni ne supprime d'activité.
 * - Réutilise le cache existant (derivedCache.js) pour profil/progression :
 *   n'introduit aucun second calcul parallèle de ces moteurs.
 * - V2 reste rétrocompatible avec V1 : aucun champ existant renommé ni
 *   supprimé, uniquement des ajouts (`lastRideDetail`, `comparison`).
 */

import { parseActivityDate } from "../history/dateUtils.js";
import { buildRideDetail } from "./rideDetail.js";
import { compareLastRideToRecent } from "./comparison.js";
import { computeRecords } from "../history/records.js";
import { summarizeDimensionTrend } from "../profile/trend.js";
import { getCachedProfile, getCachedProgression, getCachedProfileTimeline } from "../derivedCache.js";
import { avg, fmt1, fmtInt, fmtDuration, fmtDurationLong } from "../utils.js";

export const COACH_CONTEXT_VERSION = 2;

/** Les 7 dimensions du profil cycliste (voir profile/profile.js). */
export const PROFILE_DIMENSION_KEYS = [
  "endurance",
  "climbing",
  "punch",
  "sprint",
  "timeTrial",
  "technical",
  "consistency",
];

const DEFAULT_RECENT_COUNT = 5;

/**
 * @param {import('../types.js').Activity} activity
 * @returns {{available: boolean, source: "measured"|"estimated"|null, avgW: number|null, maxW: number|null, normalizedW: number|null}}
 */
function summarizePower(activity) {
  const flags = activity.flags || {};
  if (!flags.hasPower || activity.avgPower == null) {
    return { available: false, source: null, avgW: null, maxW: null, normalizedW: null };
  }
  return {
    available: true,
    source: flags.powerEstimated ? "estimated" : "measured",
    avgW: activity.avgPower,
    maxW: activity.maxPower ?? null,
    normalizedW: activity.normalizedPower ?? null,
  };
}

/**
 * Seule moyenne calculée par ce module (voir docstring de fichier) : une
 * simple moyenne arithmétique de valeurs déjà parsées et déjà stockées par
 * activité, jamais une nouvelle lecture de fichier ni un nouvel algorithme.
 * @param {import('../types.js').Activity} activity
 * @returns {{available: boolean, avgC: number|null}}
 */
function summarizeTemperature(activity) {
  const flags = activity.flags || {};
  if (!flags.hasTemperature) return { available: false, avgC: null };
  const samples = Array.isArray(activity.samples) ? activity.samples : [];
  const values = samples.map((s) => s.temperature).filter((v) => v != null);
  if (values.length === 0) return { available: false, avgC: null };
  return { available: true, avgC: avg(values) };
}

/**
 * Résumé compact d'une sortie, construit UNIQUEMENT à partir des champs déjà
 * calculés et stockés sur `Activity` (voir types.js) — aucun recalcul.
 * @param {import('../types.js').Activity} activity
 * @returns {Object|null}
 */
export function summarizeRide(activity) {
  if (!activity) return null;
  const stoppedTimeSec =
    activity.duration != null && activity.movingTime != null
      ? Math.max(0, activity.duration - activity.movingTime)
      : null;

  return {
    id: activity.id,
    name: activity.name ?? null,
    date: activity.date ?? null,
    sportType: activity.sportType ?? null,
    sourceType: activity.source?.type ?? null,

    distanceKm: activity.distance ?? null,
    distanceMeasuredKm: activity.distanceMeasured ?? null,
    durationSec: activity.duration ?? null,
    movingTimeSec: activity.movingTime ?? null,
    stoppedTimeSec,
    elevationGainM: activity.elevationGain ?? null,
    elevationLossM: activity.elevationLoss ?? null,
    avgSpeedKmh: activity.avgSpeed ?? null,
    maxSpeedKmh: activity.maxSpeed ?? null,
    avgHeartRateBpm: activity.avgHeartRate ?? null,
    maxHeartRateBpm: activity.maxHeartRate ?? null,
    avgCadenceRpm: activity.avgCadence ?? null,
    maxCadenceRpm: activity.maxCadence ?? null,
    power: summarizePower(activity),
    temperature: summarizeTemperature(activity),
  };
}

/**
 * Trie les activités les plus récentes en premier, en respectant `null`
 * (une activité sans date connue est reléguée en fin de liste, jamais
 * traitée comme "la plus ancienne" par une valeur inventée).
 * @param {import('../types.js').Activity[]} activities
 * @returns {import('../types.js').Activity[]}
 */
function sortByDateDesc(activities) {
  return activities
    .map((activity) => ({ activity, date: parseActivityDate(activity) }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    })
    .map((entry) => entry.activity);
}

/**
 * @param {Object|null} dimensionResult - une entrée de profile.dimensions (voir profile/dimensions/*)
 * @param {Array} timeline - voir derivedCache.js: getCachedProfileTimeline()
 * @param {string} dimKey
 * @returns {Object|null}
 */
function summarizeDimension(dimensionResult, timeline, dimKey) {
  if (!dimensionResult) return null;
  const trend = summarizeDimensionTrend(timeline, dimKey);
  return {
    value: dimensionResult.value,
    confidence: dimensionResult.confidence,
    confidenceLabel: dimensionResult.confidenceLabel,
    contributingActivities: dimensionResult.contributingActivities ?? null,
    trend: trend.status,
  };
}

/**
 * Construit le contexte coach à partir d'activités DÉJÀ CHARGÉES (voir
 * `fromRepository.js` pour la version qui s'occupe elle-même du chargement
 * via un repository existant). Fonction pure, synchrone, jamais d'I/O.
 *
 * Pour un profil/progression non dégradés, `activities` devrait contenir le
 * détail complet (avec `samples`) de l'historique, exactement comme
 * ProfileView.jsx/AlterEgoView.jsx le font déjà — ce module ne fait
 * qu'appeler les mêmes moteurs mémoïsés (derivedCache.js), jamais une
 * variante parallèle.
 *
 * @param {import('../types.js').Activity[]} activities
 * @param {Object} [options]
 * @param {number} [options.recentCount=5] - nombre de sorties récentes à inclure
 * @param {Date} [options.now] - horodatage de génération (tests)
 * @returns {Object} CoachContext
 */
export function buildCoachContext(activities, options = {}) {
  const list = Array.isArray(activities) ? activities : [];
  const now = options.now || new Date();
  const recentCount = options.recentCount ?? DEFAULT_RECENT_COUNT;

  const sorted = sortByDateDesc(list);
  const lastRide = sorted.length ? summarizeRide(sorted[0]) : null;
  const recentRides = sorted.slice(0, recentCount).map(summarizeRide);
  const lastRideDetail = sorted.length ? buildRideDetail(sorted[0]) : { available: false, reason: "no_activity" };
  const comparison = compareLastRideToRecent(recentRides);

  const profile = getCachedProfile(list, { now });
  const progression = getCachedProgression(list, profile, { now });
  const timeline = getCachedProfileTimeline(list, { now });

  const dimensions = {};
  for (const key of PROFILE_DIMENSION_KEYS) {
    dimensions[key] = summarizeDimension(profile.dimensions[key], timeline, key);
  }

  const records = computeRecords(list);

  return {
    version: COACH_CONTEXT_VERSION,
    generatedAt: now.toISOString(),
    activityCount: list.length,

    lastRide,
    lastRideDetail,
    recentRides,
    comparison,

    profile: {
      activityCount: profile.activityCount,
      overallConfidence: profile.overallConfidence,
      dataAvailability: profile.dataAvailability,
      dimensions,
    },

    progression: {
      level: progression.level,
      title: progression.title,
      xp: progression.xp,
      levelProgress: progression.levelProgress,
      challenges: progression.challenges.map((c) => ({
        id: c.id,
        category: c.category,
        label: c.label,
        unit: c.unit,
        current: c.current,
        target: c.target,
        completed: c.completed,
      })),
    },

    records,
  };
}

function fmtRideLine(ride, index) {
  const label = ride.name || "(sans nom)";
  const date = ride.date ? ride.date.slice(0, 10) : "date inconnue";
  const dist = ride.distanceKm != null ? `${fmt1(ride.distanceKm)} km` : "distance n/d";
  const dur = ride.durationSec != null ? fmtDuration(ride.durationSec) : "durée n/d";
  return `  ${index}. ${label} — ${date} — ${dist} — ${dur}`;
}

function fmtRideDetail(ride) {
  if (!ride) return "  (aucune sortie)";
  const lines = [];
  lines.push(`  ${ride.name || "(sans nom)"} (${ride.date ? ride.date.slice(0, 10) : "date inconnue"})`);
  lines.push(
    `    Distance ${ride.distanceKm != null ? fmt1(ride.distanceKm) + " km" : "n/d"}` +
      ` · Durée ${ride.durationSec != null ? fmtDurationLong(ride.durationSec) : "n/d"}` +
      (ride.stoppedTimeSec != null ? ` (dont arrêt ${fmtDurationLong(ride.stoppedTimeSec)})` : "") +
      ` · D+ ${ride.elevationGainM != null ? fmtInt(ride.elevationGainM) + " m" : "n/d"}`
  );
  lines.push(
    `    Vitesse moy ${ride.avgSpeedKmh != null ? fmt1(ride.avgSpeedKmh) + " km/h" : "n/d"}` +
      ` (max ${ride.maxSpeedKmh != null ? fmt1(ride.maxSpeedKmh) + " km/h" : "n/d"})` +
      ` · FC ${ride.avgHeartRateBpm != null ? fmtInt(ride.avgHeartRateBpm) + " bpm" : "n/d"}` +
      ` · Cadence ${ride.avgCadenceRpm != null ? fmtInt(ride.avgCadenceRpm) + " rpm" : "n/d"}`
  );
  if (ride.power.available) {
    lines.push(
      `    Puissance (${ride.power.source === "estimated" ? "estimée" : "mesurée"}) : moy ${fmtInt(ride.power.avgW)} W` +
        (ride.power.maxW != null ? `, max ${fmtInt(ride.power.maxW)} W` : "") +
        (ride.power.normalizedW != null ? `, normalisée ${fmtInt(ride.power.normalizedW)} W` : "")
    );
  } else {
    lines.push("    Puissance : n/d");
  }
  lines.push(`    Température : ${ride.temperature.available ? fmt1(ride.temperature.avgC) + " °C (moy.)" : "n/d"}`);
  return lines.join("\n");
}

function fmtRideDetailExtra(detail) {
  if (!detail || !detail.available) {
    const reasons = { insufficient_samples: "pas assez de points enregistrés", no_activity: "aucune sortie" };
    return `  Montées / efforts / arrêts détaillés : indisponibles (${reasons[detail?.reason] || detail?.reason || "n/d"})`;
  }
  const lines = [];

  if (detail.climbs.count > 0) {
    lines.push(`  Montées détectées : ${detail.climbs.count}`);
    for (const c of detail.climbs.list) {
      lines.push(
        `    - ${c.name || "Montée"} : ${fmt1(c.distanceKm)} km, +${fmtInt(c.gainM)} m` +
          ` (moy. ${fmt1(c.avgGradePct)} %, max ${fmt1(c.maxGradePct)} %)` +
          `, ${fmtDuration(c.durationSec)}` +
          (c.vamMh != null ? `, VAM ${fmtInt(c.vamMh)} m/h` : "") +
          (c.power ? `, puissance ${fmtInt(c.power.avgW)} W` : "")
      );
    }
  } else {
    lines.push("  Montées détectées : aucune");
  }

  if (detail.efforts.count > 0) {
    lines.push(`  Efforts détectés : ${detail.efforts.count}`);
    for (const e of detail.efforts.list) {
      lines.push(
        `    - ${fmtDuration(e.durationSec)}, ${fmt1(e.distanceKm)} km, ${fmt1(e.avgSpeedKmh)} km/h moy.` +
          (e.power ? `, ${fmtInt(e.power.avgW)} W moy.` : "")
      );
    }
  } else {
    lines.push("  Efforts détectés : aucun");
  }

  if (detail.pauses.available) {
    lines.push(
      `  Arrêts : ${detail.pauses.count}` +
        (detail.pauses.count > 0
          ? ` (total ${fmtDurationLong(detail.pauses.totalSec)}, le plus long ${fmtDurationLong(detail.pauses.longestSec)})`
          : "")
    );
  } else {
    lines.push("  Arrêts : n/d (pas d'horodatage exploitable)");
  }

  return lines.join("\n");
}

function fmtComparisonMetric(label, unit, m) {
  if (!m || m.lastValue == null || m.avgOfOthers == null) return `  - ${label} : n/d`;
  const sign = m.deltaPct != null && m.deltaPct >= 0 ? "+" : "";
  return (
    `  - ${label} : ${fmt1(m.lastValue)} ${unit} vs moyenne récente ${fmt1(m.avgOfOthers)} ${unit}` +
    (m.deltaPct != null ? ` (${sign}${fmt1(m.deltaPct)} %)` : "")
  );
}

function fmtComparison(comparison) {
  if (!comparison.available) {
    const reasons = { no_last_ride: "aucune sortie", insufficient_history: "pas assez d'historique récent pour comparer" };
    return `  Indisponible (${reasons[comparison.reason] || comparison.reason})`;
  }
  const lines = [`  Comparé à ${comparison.sampleSize} sortie(s) récente(s) :`];
  lines.push(fmtComparisonMetric("Distance", "km", comparison.distance));
  lines.push(fmtComparisonMetric("Durée", "s", comparison.duration));
  lines.push(fmtComparisonMetric("Vitesse moy.", "km/h", comparison.avgSpeed));
  lines.push(fmtComparisonMetric("D+", "m", comparison.elevationGain));
  return lines.join("\n");
}

const TREND_LABELS = {
  up: "en hausse",
  down: "en baisse",
  stable: "stable",
  emerging: "émergent (peu de points)",
  insufficient: "données insuffisantes",
};

function fmtDimensionLine(key, dim) {
  if (!dim || dim.value == null) return `  - ${key} : données insuffisantes`;
  return `  - ${key} : ${fmt1(dim.value)}/100 (confiance ${dim.confidenceLabel}, tendance ${TREND_LABELS[dim.trend] || dim.trend})`;
}

/**
 * Représentation texte compacte d'un CoachContext (voir `buildCoachContext`),
 * pensée pour être transmise telle quelle à un LLM. Ne fait AUCUN nouvel
 * calcul : ne fait que mettre en forme les valeurs déjà présentes dans
 * `context`, en respectant leurs `null`/indisponibilités (jamais de "0" ou de
 * texte inventé à la place d'une donnée absente).
 * @param {Object} context - résultat de `buildCoachContext()`
 * @returns {string}
 */
export function formatCoachContextCompact(context) {
  const lines = [];
  lines.push(`=== Contexte coach (V${context.version}, lecture seule) — ${context.activityCount} sortie(s) au total ===`);
  lines.push(`Généré le ${context.generatedAt}`);
  lines.push("");

  lines.push("Dernière sortie :");
  lines.push(fmtRideDetail(context.lastRide));
  lines.push(fmtRideDetailExtra(context.lastRideDetail));
  lines.push("");

  if (context.recentRides.length > 1) {
    lines.push(`${context.recentRides.length} sorties récentes :`);
    context.recentRides.forEach((ride, i) => lines.push(fmtRideLine(ride, i + 1)));
    lines.push("");

    lines.push("Comparaison dernière sortie / récentes :");
    lines.push(fmtComparison(context.comparison));
    lines.push("");
  }

  const overallConf = context.profile.overallConfidence;
  lines.push(
    `Profil cycliste (confiance globale : ${overallConf != null ? fmt1(overallConf * 100) + "%" : "n/d"}, ` +
      `${context.profile.activityCount} sortie(s) prises en compte) :`
  );
  for (const key of PROFILE_DIMENSION_KEYS) {
    lines.push(fmtDimensionLine(key, context.profile.dimensions[key]));
  }
  lines.push("");

  lines.push(
    `Progression : niveau ${context.progression.level} "${context.progression.title}" — ${fmtInt(context.progression.xp)} XP`
  );
  if (context.progression.challenges.length > 0) {
    lines.push("Challenges actifs :");
    for (const c of context.progression.challenges) {
      lines.push(`  - ${c.label} (${fmt1(c.current)}/${fmt1(c.target)} ${c.unit})`);
    }
  } else {
    lines.push("Challenges actifs : aucun");
  }
  lines.push("");

  if (context.records.length > 0) {
    lines.push("Records :");
    for (const r of context.records) {
      lines.push(`  - ${r.type} : ${fmt1(r.value)}${r.context ? ` (${r.context})` : ""}`);
    }
  } else {
    lines.push("Records : aucun");
  }

  return lines.join("\n");
}
