/**
 * Punch — efforts courts/intenses et changements de rythme (1 à 5 minutes).
 *
 * Signal : les efforts détectés par `detectEfforts` (../../analytics/efforts.js
 * — segments significativement au-dessus du rythme médian de la sortie, sur
 * puissance si disponible sinon vitesse, voir ../activitySignals.js) dont la
 * durée est comprise entre 1 et 5 minutes ("punchy" : plus long qu'un sprint
 * pur, plus court qu'un effort soutenu de rouleur — voir timeTrial.js pour
 * les efforts plus longs).
 *
 * Contrairement au sprint, le punch peut se dégrader sur la seule vitesse
 * quand aucun capteur de puissance n'est disponible (des changements de
 * rythme restent détectables sans watts) — mais `dataQuality` l'indique
 * toujours explicitement, et la confiance est pondérée en conséquence
 * (voir confidence.js : "speed" < "estimated" < "measured").
 *
 * Composite : nombre d'efforts "punchy" PAR HEURE de temps en mouvement
 * (normalise la longueur de sortie — une sortie de 5 h a mécaniquement plus
 * de chances de contenir un effort qu'un aller-retour de 20 min). Les
 * sorties analysées sans aucun effort punchy comptent pour un taux de 0 (pas
 * ignorées) : l'absence répétée d'efforts fait légitimement baisser le
 * benchmark.
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry, aggregateDataQuality } from "../evidence.js";

const PUNCH_MIN_SEC = 60;
const PUNCH_MAX_SEC = 300;
const STARTUP_RANGE_RATE = { min: 0, max: 6 }; // efforts punchy par heure

function evidenceQuality(powerSource) {
  if (powerSource === "measured") return "measured";
  if (powerSource === "estimated") return "estimated";
  return "speed";
}

export function computePunch(activitySignals) {
  const analyzed = (activitySignals || []).filter((s) => s.effortsAnalyzed);
  if (analyzed.length === 0) return insufficientData();

  const rates = [];
  const allPunchyEfforts = [];

  for (const s of analyzed) {
    const hours = (s.movingTimeSec ?? s.durationSec ?? 0) / 3600;
    if (!(hours > 0)) continue;
    const punchy = (s.efforts || []).filter((e) => e.durationSec >= PUNCH_MIN_SEC && e.durationSec <= PUNCH_MAX_SEC);
    rates.push(punchy.length / hours);
    for (const e of punchy) allPunchyEfforts.push({ ...e, activityId: s.activityId });
  }

  if (allPunchyEfforts.length === 0) return insufficientData();

  const contributingActivities = new Set(allPunchyEfforts.map((e) => e.activityId)).size;
  const benchmarkRate = percentileValue(rates, 80);
  const scale = blendedScale(benchmarkRate, rates, STARTUP_RANGE_RATE);

  const dataQuality = aggregateDataQuality(allPunchyEfforts.map((e) => ({ dataQuality: evidenceQuality(e.powerSource) })));

  const evidence = allPunchyEfforts
    .slice()
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, 10)
    .map((e) =>
      buildEvidenceEntry({
        activityId: e.activityId,
        metric: "punchyEffort",
        value: Math.round(e.durationSec),
        dataQuality: evidenceQuality(e.powerSource),
        reason:
          e.avgPowerW != null
            ? `Effort de ${Math.round(e.durationSec)} s à ${Math.round(e.avgPowerW)} W (${e.powerSource}).`
            : `Effort de ${Math.round(e.durationSec)} s à ${e.avgSpeedKmh != null ? e.avgSpeedKmh.toFixed(1) : "?"} km/h (pas de puissance disponible).`,
      })
    );

  const confidence = computeConfidence({ contributingActivities, dataQuality });

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: allPunchyEfforts.length,
    contributingActivities,
    dataQuality,
    signals: {
      benchmarkEffortsPerHour: benchmarkRate != null ? Math.round(benchmarkRate * 100) / 100 : null,
      analyzedActivities: analyzed.length,
      normalizationMethod: scale.method,
    },
    evidence,
  };
}
