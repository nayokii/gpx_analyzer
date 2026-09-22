/**
 * Sprint — puissance de pointe sur très courte durée (~5 s).
 *
 * RÈGLE STRICTE (consigne §10 et §"Sprint") : cette dimension n'utilise QUE
 * de la puissance MESURÉE (`activitySignals[].powerSource === "measured"`,
 * lui-même dérivé de `Activity.flags.powerEstimated === false`). Sans
 * capteur de puissance réel, il n'existe AUCUN signal fiable pour estimer un
 * pic de 5 secondes à partir de la seule vitesse GPS (trop bruitée, trop
 * lissée) — on retourne `insufficient_data` plutôt qu'un chiffre inventé.
 *
 * Signal : meilleur effort de puissance sur 5 s par activité (repli sur 30 s
 * si la sortie est trop courte/pas assez dense pour isoler 5 s — voir
 * ../activitySignals.js: computeBestPowerEfforts). Benchmark = 90e percentile
 * de ces pics dans l'historique propre (proche du maximum, car le sprint est
 * PAR NATURE une question de pic, contrairement à l'endurance/au punch qui
 * valorisent la répétition) tout en amortissant un unique pic aberrant.
 *
 * Plage de démarrage (cold start) : 200-1000 W en pic 5 s. Plage de pratique
 * amateur-à-bon-amateur documentée, PAS un référentiel professionnel (un
 * sprinteur pro dépasse 1500-1800 W — volontairement hors de cette plage
 * pour ne jamais laisser croire à une comparaison professionnelle).
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry } from "../evidence.js";

const STARTUP_RANGE_WATTS = { min: 200, max: 1000 };

export function computeSprint(activitySignals) {
  const peaks = [];

  for (const s of activitySignals || []) {
    if (s.powerSource !== "measured" || !s.bestPowerEfforts) continue;
    const best = s.bestPowerEfforts.s5 || s.bestPowerEfforts.s30;
    if (!best || !(best.power > 0)) continue;
    peaks.push({ activityId: s.activityId, watts: best.power, duration: best.duration });
  }

  if (peaks.length === 0) {
    return insufficientData({
      signals: { reason: "Aucune sortie à puissance mesurée avec un pic de puissance court-terme exploitable." },
    });
  }

  const wattsList = peaks.map((p) => p.watts);
  const benchmark = percentileValue(wattsList, 90);
  const scale = blendedScale(benchmark, wattsList, STARTUP_RANGE_WATTS);

  const contributingActivities = new Set(peaks.map((p) => p.activityId)).size;

  const evidence = peaks
    .slice()
    .sort((a, b) => b.watts - a.watts)
    .slice(0, 10)
    .map((p) =>
      buildEvidenceEntry({
        activityId: p.activityId,
        metric: `bestPower${p.duration}s`,
        value: Math.round(p.watts),
        dataQuality: "measured",
        reason: `Pic de puissance mesurée : ${Math.round(p.watts)} W sur ${p.duration} s.`,
      })
    );

  const confidence = computeConfidence({ contributingActivities, dataQuality: "measured" });

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: peaks.length,
    contributingActivities,
    dataQuality: "measured",
    signals: {
      benchmarkWatts: benchmark != null ? Math.round(benchmark) : null,
      normalizationMethod: scale.method,
    },
    evidence,
  };
}
