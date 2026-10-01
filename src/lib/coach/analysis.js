/**
 * Coach V2.5 — moteur d'analyse PUR (lecture seule, aucun appel réseau,
 * aucun appel LLM/API). Prend un `CoachContext` déjà produit par
 * `buildCoachContext()` (context.js) et le transforme en une structure
 * d'analyse stable, directement exploitable par une future UI ou transmise
 * à un LLM — sans jamais recalculer une métrique, sans jamais fabriquer de
 * donnée, sans jamais transformer un score en vérité physiologique.
 *
 *   CoachContext (déjà calculé — context.js)
 *         ↓ règles déterministes, aucun calcul de métrique
 *   { summary, positives, attentionPoints, evolution, recommendations, dataLimits }
 *
 * Règles strictes (voir consigne Phase Coach V2.5) :
 * - Fonction pure : `analyzeCoachContext(context)` ne lit et n'écrit rien
 *   d'autre que l'objet `context` reçu en paramètre.
 * - Ne modifie AUCUNE formule existante : consomme uniquement des champs déjà
 *   présents dans `context` (profil, progression, comparaison, records,
 *   détail de la dernière sortie) — jamais un second calcul parallèle.
 * - Respecte strictement la confiance : un score/tendance à confiance
 *   "low"/"insufficient_data" n'est JAMAIS présenté comme une preuve, même
 *   si sa valeur brute est élevée (ex. "punch 93 confiance faible" reste une
 *   donnée fragile, jamais une qualité physique avérée — voir
 *   `describeDimension()`).
 * - Une seule sortie atypique (voir `context.comparison`, basé sur UNE seule
 *   sortie face à une moyenne récente) n'est JAMAIS présentée comme une
 *   progression ou une régression physique confirmée — seules les tendances
 *   `profile/trend.js` (calculées sur plusieurs points datés) portent ce
 *   vocabulaire ; les entrées issues de `comparison` sont explicitement
 *   annotées comme une comparaison ponctuelle.
 * - Ne diagnostique jamais forme, fatigue ou récupération : ces notions
 *   nécessitent au minimum une FC (idéalement une puissance mesurée) sur la
 *   durée, que ce module ne calcule de toute façon jamais lui-même.
 * - 1 à 3 recommandations maximum, toujours reliées à un champ précis du
 *   contexte (jamais générique), jamais un conseil médical ou excessif.
 */

import { confidenceLabel } from "../profile/confidence.js";

/** Seuils documentés ici (pas de calcul, de simples constantes de lecture des données déjà présentes). */
const CHALLENGE_NEAR_RATIO = 0.8; // "presque atteint" : au moins 80% du palier
const VOLUME_DELTA_PCT_HIGH = 40; // sortie nettement plus longue/plus haute que la moyenne récente
const VOLUME_DELTA_PCT_LOW = -35; // sortie nettement plus courte que la moyenne récente
const MANY_STOPS_COUNT = 6;
const MANY_STOPS_RATIO = 0.15; // temps arrêté / durée totale
const LOW_HISTORY_ACTIVITY_COUNT = 5;
const LOW_OVERALL_CONFIDENCE = 0.35; // aligné sur le seuil "low" de confidenceLabel()

function fmtKm(v) {
  return v == null ? "n/d" : `${Math.round(v * 10) / 10} km`;
}
function fmtM(v) {
  return v == null ? "n/d" : `${Math.round(v)} m`;
}
function fmtKmh(v) {
  return v == null ? "n/d" : `${Math.round(v * 10) / 10} km/h`;
}
function fmtDurationShort(sec) {
  if (sec == null) return "n/d";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}
function pct(v) {
  if (v == null) return "n/d";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${Math.round(v)} %`;
}

const DIMENSION_LABELS = {
  endurance: "Endurance",
  climbing: "Grimpe",
  punch: "Punch",
  sprint: "Sprint",
  timeTrial: "Contre-la-montre",
  technical: "Technique",
  consistency: "Régularité",
};

/* ------------------------------- 1. Résumé ------------------------------- */

function buildSummary(context) {
  const ride = context.lastRide;
  if (!ride) return "Aucune sortie enregistrée pour l'instant.";

  const parts = [];
  parts.push(
    `Dernière sortie${ride.name ? ` (${ride.name})` : ""} : ${fmtKm(ride.distanceKm)} en ${fmtDurationShort(ride.durationSec)}` +
      `, D+ ${fmtM(ride.elevationGainM)}, vitesse moyenne ${fmtKmh(ride.avgSpeedKmh)}.`
  );

  const pauses = context.lastRideDetail && context.lastRideDetail.available ? context.lastRideDetail.pauses : null;
  if (pauses && pauses.available) {
    parts.push(pauses.count > 0 ? `${pauses.count} arrêt(s) détecté(s) (${fmtDurationShort(pauses.totalSec)} au total).` : "Aucun arrêt significatif détecté.");
  } else if (ride.stoppedTimeSec != null) {
    parts.push(`Temps arrêté total : ${fmtDurationShort(ride.stoppedTimeSec)}.`);
  }

  const availability = [];
  availability.push(ride.avgHeartRateBpm != null ? "FC disponible" : "FC non disponible");
  availability.push(ride.avgCadenceRpm != null ? "cadence disponible" : "cadence non disponible");
  availability.push(
    ride.power.available ? `puissance disponible (${ride.power.source === "estimated" ? "estimée" : "mesurée"})` : "puissance non disponible"
  );
  parts.push(`Données : ${availability.join(", ")}.`);

  if (context.comparison && context.comparison.available) {
    const c = context.comparison;
    const bits = [];
    if (c.distance && c.distance.deltaPct != null) bits.push(`distance ${pct(c.distance.deltaPct)}`);
    if (c.avgSpeed && c.avgSpeed.deltaPct != null) bits.push(`vitesse ${pct(c.avgSpeed.deltaPct)}`);
    if (c.elevationGain && c.elevationGain.deltaPct != null) bits.push(`D+ ${pct(c.elevationGain.deltaPct)}`);
    if (bits.length > 0) parts.push(`Comparée aux ${c.sampleSize} sortie(s) récente(s) : ${bits.join(", ")}.`);
  }

  return parts.join(" ");
}

/* --------------------------- Aides communes profil --------------------------- */

function isDocumentedConfidence(label) {
  return label === "medium" || label === "high";
}

/* ------------------------------ 2. Positifs ------------------------------ */

function buildPositives(context) {
  const positives = [];
  const dims = context.profile.dimensions;

  for (const [key, dim] of Object.entries(dims)) {
    if (!dim || dim.value == null) continue;
    if (dim.trend === "up" && isDocumentedConfidence(dim.confidenceLabel)) {
      positives.push({
        type: "profile_dimension_up",
        message: `${DIMENSION_LABELS[key] || key} en progression documentée (${Math.round(dim.value)}/100, confiance ${dim.confidenceLabel}).`,
      });
    }
  }

  // Régularité : signal documenté (valeur + confiance suffisante), indépendamment
  // de sa tendance du moment — une régularité déjà bien établie reste un fait
  // même si elle est en train de légèrement fléchir (voir attentionPoints).
  const consistency = dims.consistency;
  if (consistency && consistency.value != null && isDocumentedConfidence(consistency.confidenceLabel) && consistency.trend !== "up") {
    positives.push({
      type: "consistency_documented",
      message: `Régularité de pratique bien documentée (${Math.round(consistency.value)}/100, confiance ${consistency.confidenceLabel}).`,
    });
  }

  if (context.lastRide) {
    for (const r of context.records || []) {
      if (r.activityId === context.lastRide.id) {
        positives.push({ type: "record", message: `Cette sortie détient un record : ${r.type} (${Math.round(r.value * 10) / 10}).` });
      }
    }
  }

  if (context.comparison && context.comparison.available) {
    const d = context.comparison.distance;
    if (d && d.deltaPct != null && d.deltaPct >= VOLUME_DELTA_PCT_HIGH) {
      positives.push({
        type: "volume_high",
        message: `Sortie nettement plus longue que la moyenne récente (${pct(d.deltaPct)}) — belle sortie de volume, à ne pas généraliser sur une seule occurrence.`,
      });
    }
  }

  if (context.lastRideDetail && context.lastRideDetail.available) {
    const climbs = context.lastRideDetail.climbs;
    if (climbs && climbs.count > 0) {
      const biggest = climbs.list.reduce((a, b) => (b.gainM > (a?.gainM ?? -Infinity) ? b : a), null);
      positives.push({
        type: "climb_notable",
        message: `${climbs.count} montée(s) détectée(s) sur cette sortie, dont une de ${fmtM(biggest.gainM)} (pente moy. ${Math.round(biggest.avgGradePct * 10) / 10} %).`,
      });
    }
    const efforts = context.lastRideDetail.efforts;
    if (efforts && efforts.count > 0) {
      positives.push({ type: "effort_notable", message: `${efforts.count} effort(s) soutenu(s) détecté(s) sur cette sortie.` });
    }
  }

  for (const c of context.progression.challenges || []) {
    if (c.target > 0 && c.current / c.target >= CHALLENGE_NEAR_RATIO) {
      positives.push({
        type: "challenge_near",
        message: `Challenge presque atteint : "${c.label}" (${c.current}/${c.target} ${c.unit}).`,
      });
    }
  }

  return positives;
}

/* ---------------------------- 3. Points d'attention ---------------------------- */

function buildAttentionPoints(context) {
  const attention = [];
  const dims = context.profile.dimensions;

  for (const [key, dim] of Object.entries(dims)) {
    if (!dim || dim.value == null) continue;
    if (dim.trend === "down" && isDocumentedConfidence(dim.confidenceLabel)) {
      attention.push({
        type: "profile_dimension_down",
        message:
          `${DIMENSION_LABELS[key] || key} en baisse dans le profil calculé (${Math.round(dim.value)}/100, confiance ${dim.confidenceLabel})` +
          ` — une tendance à surveiller, pas une régression physique confirmée.`,
      });
    }
    if (dim.confidenceLabel === "low") {
      attention.push({
        type: "dimension_low_confidence",
        message: `${DIMENSION_LABELS[key] || key} affiche un score de ${Math.round(dim.value)}/100 mais avec une confiance FAIBLE — à ne pas lire comme une qualité physique avérée.`,
      });
    }
  }
  for (const [key, dim] of Object.entries(dims)) {
    if (!dim || dim.confidenceLabel === "insufficient_data") {
      attention.push({ type: "dimension_insufficient", message: `${DIMENSION_LABELS[key] || key} : données insuffisantes pour évaluer cette dimension.` });
    }
  }

  const ride = context.lastRide;
  if (ride && ride.power.available && ride.power.source === "estimated") {
    attention.push({
      type: "power_estimated_only",
      message: "Puissance disponible uniquement ESTIMÉE sur cette sortie (aucun capteur) — les valeurs, notamment les pics, sont à interpréter avec prudence.",
    });
  }

  const pauses = context.lastRideDetail && context.lastRideDetail.available ? context.lastRideDetail.pauses : null;
  if (pauses && pauses.available && pauses.count > 0) {
    const ratio = ride && ride.durationSec ? pauses.totalSec / ride.durationSec : null;
    if (pauses.count >= MANY_STOPS_COUNT || (ratio != null && ratio >= MANY_STOPS_RATIO)) {
      attention.push({
        type: "many_stops",
        message: `Nombre d'arrêts inhabituellement élevé (${pauses.count}, ${fmtDurationShort(pauses.totalSec)} au total) — à vérifier si volontaire (circulation, pauses) ou lié au parcours.`,
      });
    }
  }

  if (context.comparison && context.comparison.available) {
    const d = context.comparison.distance;
    if (d && d.deltaPct != null && d.deltaPct <= VOLUME_DELTA_PCT_LOW) {
      attention.push({
        type: "volume_low",
        message: `Sortie nettement plus courte que la moyenne récente (${pct(d.deltaPct)}) — observation sur une seule sortie, jamais une régression à elle seule.`,
      });
    }
  }

  return attention;
}

/* ------------------------------- 4. Évolution ------------------------------- */

const TREND_STATUS = { up: "improving", down: "declining", stable: "stable", emerging: "insufficient", insufficient: "insufficient" };

function describeDimensionEvolution(key, dim) {
  const status = TREND_STATUS[dim.trend] || "insufficient";
  if (status === "insufficient" || dim.value == null) {
    return { type: "profile_dimension", key, status: "insufficient", confidenceLabel: dim.confidenceLabel, message: `${DIMENSION_LABELS[key] || key} : données insuffisantes pour dégager une évolution.` };
  }
  const confident = isDocumentedConfidence(dim.confidenceLabel);
  let message;
  if (status === "improving") {
    message = confident
      ? `${DIMENSION_LABELS[key] || key} : amélioration documentée (${Math.round(dim.value)}/100, confiance ${dim.confidenceLabel}).`
      : `${DIMENSION_LABELS[key] || key} : tendance à la hausse mais confiance ${dim.confidenceLabel} — à confirmer, pas une preuve (${Math.round(dim.value)}/100).`;
  } else if (status === "declining") {
    message = `${DIMENSION_LABELS[key] || key} : baisse à surveiller (${Math.round(dim.value)}/100, confiance ${dim.confidenceLabel}) — pas une régression confirmée.`;
  } else {
    message = `${DIMENSION_LABELS[key] || key} : stable (${Math.round(dim.value)}/100, confiance ${dim.confidenceLabel}).`;
  }
  return { type: "profile_dimension", key, status, confidenceLabel: dim.confidenceLabel, message };
}

function describeComparisonEvolution(key, label, unit, m) {
  if (!m || m.lastValue == null || m.avgOfOthers == null || m.deltaPct == null) {
    return { type: "comparison", key, status: "insufficient", message: `${label} : pas assez d'historique récent comparable.` };
  }
  const status = m.deltaPct > 5 ? "improving" : m.deltaPct < -5 ? "declining" : "stable";
  const verb = status === "improving" ? "au-dessus" : status === "declining" ? "en dessous" : "proche";
  return {
    type: "comparison",
    key,
    status,
    message: `${label} de cette sortie ${verb} de la moyenne récente (${pct(m.deltaPct)}) — comparaison ponctuelle sur une seule sortie, pas une tendance.`,
  };
}

function buildEvolution(context) {
  const evolution = [];
  for (const [key, dim] of Object.entries(context.profile.dimensions)) {
    if (dim) evolution.push(describeDimensionEvolution(key, dim));
  }
  if (context.comparison && context.comparison.available) {
    evolution.push(describeComparisonEvolution("distance", "Distance", "km", context.comparison.distance));
    evolution.push(describeComparisonEvolution("avgSpeed", "Vitesse moyenne", "km/h", context.comparison.avgSpeed));
    evolution.push(describeComparisonEvolution("elevationGain", "D+", "m", context.comparison.elevationGain));
  }
  return evolution;
}

/* ---------------------------- 5. Recommandations ---------------------------- */

function buildRecommendations(context) {
  const recommendations = [];

  const nearChallenge = (context.progression.challenges || [])
    .filter((c) => c.target > 0 && c.current / c.target >= CHALLENGE_NEAR_RATIO)
    .sort((a, b) => b.current / b.target - a.current / a.target)[0];
  if (nearChallenge) {
    const remaining = Math.max(0, nearChallenge.target - nearChallenge.current);
    recommendations.push({
      type: "complete_challenge",
      message: `Le challenge "${nearChallenge.label}" est proche (${nearChallenge.current}/${nearChallenge.target} ${nearChallenge.unit}) : une sortie visant environ ${Math.round(remaining * 10) / 10} ${nearChallenge.unit} de plus le compléterait.`,
    });
  }

  const ride = context.lastRide;
  const noHrAtAll = context.profile.dataAvailability && context.profile.dataAvailability.withHeartRate === 0;
  if ((ride && ride.avgHeartRateBpm == null) || noHrAtAll) {
    recommendations.push({
      type: "add_heart_rate",
      message: "Aucune donnée de fréquence cardiaque disponible : l'ajouter sur les prochaines sorties permettrait de mieux distinguer intensité réelle et récupération, ce que la vitesse ou la puissance estimée seules ne peuvent pas faire.",
    });
  }

  const pauses = context.lastRideDetail && context.lastRideDetail.available ? context.lastRideDetail.pauses : null;
  if (pauses && pauses.available && pauses.count >= MANY_STOPS_COUNT) {
    recommendations.push({
      type: "review_stops",
      message: `Cette sortie compte ${pauses.count} arrêts (${fmtDurationShort(pauses.totalSec)} au total) : si ce n'est pas voulu, regarder à quels moments ils surviennent peut aider à mieux planifier le parcours.`,
    });
  }

  return recommendations.slice(0, 3);
}

/* ------------------------------ 6. Limites ------------------------------ */

function buildDataLimits(context) {
  const limits = [];
  const avail = context.profile.dataAvailability;

  if (avail) {
    if (avail.withMeasuredPower === 0 && avail.withEstimatedPower > 0) {
      limits.push({ type: "power_estimated_only", message: "Toute la puissance de l'historique est ESTIMÉE, jamais mesurée par un capteur réel — les niveaux absolus (surtout les pics) ne sont pas fiables." });
    } else if (avail.withMeasuredPower > 0 && avail.withEstimatedPower > 0) {
      limits.push({ type: "power_mixed", message: "L'historique mélange puissance mesurée et estimée selon les sorties — toujours vérifier la source avant de comparer deux sorties entre elles." });
    }
    if (avail.withHeartRate === 0) {
      limits.push({ type: "no_heart_rate", message: "Aucune fréquence cardiaque disponible sur l'historique : impossible d'évaluer l'intensité réelle d'une sortie ou la récupération entre deux sorties." });
    }
    if (avail.withCadence === 0) {
      limits.push({ type: "no_cadence", message: "Aucune donnée de cadence disponible sur l'historique." });
    }
  }

  const overallConf = context.profile.overallConfidence;
  const overallLabel = confidenceLabel(overallConf);
  if (overallConf == null || overallLabel === "low" || overallConf < LOW_OVERALL_CONFIDENCE) {
    limits.push({ type: "low_overall_confidence", message: `Confiance globale du profil ${overallConf != null ? "faible" : "indéterminée"} (${overallConf != null ? Math.round(overallConf * 100) + " %" : "n/d"}) : le profil reste à confirmer avec plus de données.` });
  }

  if (context.activityCount < LOW_HISTORY_ACTIVITY_COUNT) {
    limits.push({ type: "low_history", message: `Historique encore limité (${context.activityCount} sortie(s)) : les tendances affichées doivent être confirmées avec davantage de sorties.` });
  }

  for (const key of ["sprint", "technical"]) {
    const dim = context.profile.dimensions[key];
    if (dim && dim.confidenceLabel === "insufficient_data") {
      limits.push({ type: `insufficient_${key}`, message: `${DIMENSION_LABELS[key]} : pas assez de signal dans l'historique pour produire un score.` });
    }
  }

  limits.push({
    type: "no_physiological_diagnosis",
    message:
      "Ces données ne permettent pas de conclure sur la récupération, la fatigue physiologique ou la forme réelle du moment : cela nécessiterait au minimum une fréquence cardiaque suivie dans la durée, idéalement une puissance mesurée.",
  });

  return limits;
}

/* -------------------------------- Entrée -------------------------------- */

/**
 * @param {Object} context - résultat de `buildCoachContext()` (voir context.js)
 * @returns {{
 *   summary: string,
 *   positives: Array<{type: string, message: string}>,
 *   attentionPoints: Array<{type: string, message: string}>,
 *   evolution: Array<{type: string, key: string, status: "improving"|"declining"|"stable"|"insufficient", message: string}>,
 *   recommendations: Array<{type: string, message: string}>,
 *   dataLimits: Array<{type: string, message: string}>
 * }}
 */
export function analyzeCoachContext(context) {
  return {
    summary: buildSummary(context),
    positives: buildPositives(context),
    attentionPoints: buildAttentionPoints(context),
    evolution: buildEvolution(context),
    recommendations: buildRecommendations(context),
    dataLimits: buildDataLimits(context),
  };
}
