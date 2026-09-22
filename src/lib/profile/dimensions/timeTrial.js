/**
 * Contre-la-montre / Rouleur — capacité à maintenir une vitesse élevée sur un
 * effort relativement long et soutenu.
 *
 * Signal : le meilleur effort par DISTANCE déjà calculé par
 * `computeAnalysis()` (analysis.js: k1/k5/k10/k20, voir
 * ../activitySignals.js: `bestEfforts`) — on privilégie la plus longue
 * distance disponible (20 km > 10 km > 5 km > 1 km) car un contre-la-montre
 * se définit par la durée de l'effort soutenu, pas par un pic ponctuel. La
 * vitesse est délibérément préférée à la puissance comme signal PRINCIPAL
 * car elle est disponible sur toute source (GPX ou FIT, avec ou sans
 * capteur) — voir consigne : "ne pas présenter une vitesse brute comme une
 * mesure directe de capacité physiologique" : c'est pourquoi cette vitesse
 * n'est jamais comparée à un référentiel externe, seulement à la propre
 * distribution/plage de démarrage de l'utilisateur (voir normalization.js).
 *
 * Quand une puissance MESURÉE existe sur une fenêtre comparable (~20 min,
 * voir bestPowerEfforts.s1200), elle est ajoutée en preuve additionnelle
 * (contexte pour une future UI) mais n'altère pas la formule de `value` —
 * évite d'introduire un coefficient de mélange vitesse/puissance non justifié.
 *
 * Plage de démarrage (cold start) : 15-38 km/h de vitesse soutenue. Plage de
 * pratique route amateur plausible (terrain mixte), PAS un référentiel de
 * performance professionnelle.
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry } from "../evidence.js";

const STARTUP_RANGE_KMH = { min: 15, max: 38 };
const DISTANCE_PREFERENCE = ["k20", "k10", "k5", "k1"];

function bestSustainedEffort(bestEfforts) {
  if (!bestEfforts) return null;
  for (const key of DISTANCE_PREFERENCE) {
    const effort = bestEfforts[key];
    if (effort && effort.avgSpeed > 0) return { key, ...effort };
  }
  return null;
}

export function computeTimeTrial(activitySignals) {
  const efforts = [];

  for (const s of activitySignals || []) {
    const best = bestSustainedEffort(s.bestEfforts);
    if (!best) continue;
    efforts.push({
      activityId: s.activityId,
      distanceKey: best.key,
      avgSpeedKmh: best.avgSpeed,
      durationSec: best.duration,
      measuredPowerW: s.bestPowerEfforts && s.bestPowerEfforts.s1200 ? s.bestPowerEfforts.s1200.power : null,
    });
  }

  if (efforts.length === 0) return insufficientData();

  const speeds = efforts.map((e) => e.avgSpeedKmh);
  const benchmark = percentileValue(speeds, 80);
  const scale = blendedScale(benchmark, speeds, STARTUP_RANGE_KMH);

  const contributingActivities = new Set(efforts.map((e) => e.activityId)).size;

  const evidence = efforts
    .slice()
    .sort((a, b) => b.avgSpeedKmh - a.avgSpeedKmh)
    .slice(0, 10)
    .map((e) =>
      buildEvidenceEntry({
        activityId: e.activityId,
        metric: `bestEffortSpeed_${e.distanceKey}`,
        value: Math.round(e.avgSpeedKmh * 10) / 10,
        dataQuality: "measured",
        reason:
          e.measuredPowerW != null
            ? `Meilleur ${e.distanceKey.slice(1)} km à ${e.avgSpeedKmh.toFixed(1)} km/h (≈${Math.round(e.measuredPowerW)} W mesurés sur une fenêtre comparable).`
            : `Meilleur ${e.distanceKey.slice(1)} km à ${e.avgSpeedKmh.toFixed(1)} km/h.`,
      })
    );

  const confidence = computeConfidence({ contributingActivities, dataQuality: "measured" });

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: efforts.length,
    contributingActivities,
    dataQuality: "measured",
    signals: {
      benchmarkSpeedKmh: benchmark != null ? Math.round(benchmark * 10) / 10 : null,
      normalizationMethod: scale.method,
    },
    evidence,
  };
}
