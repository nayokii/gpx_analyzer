/**
 * Endurance — capacité à maintenir une activité relativement longue.
 *
 * Ce que ça mesure : la position du "temps en mouvement long typique" de
 * l'utilisateur (80e percentile de ses propres sorties) sur une échelle
 * interne, éventuellement affinée par un percentile dans son propre
 * historique une fois qu'il est assez fourni.
 *
 * Ce que ça NE mesure PAS : la VO2max, le seuil physiologique, ou une
 * quelconque "endurance" au sens sportif absolu — uniquement un patron
 * observé dans les sorties enregistrées.
 *
 * Signal principal : temps en mouvement (préféré) ou durée totale, par
 * activité — les deux seuls signaux disponibles à ce jour pour toutes les
 * sources (GPX et FIT, voir types.js). On utilise le 80e percentile plutôt
 * que le maximum pour qu'une seule sortie exceptionnelle ne fasse pas, à
 * elle seule, un score élevé (voir consigne : "une longue sortie seule ne
 * doit pas produire automatiquement un score élevé") — un score élevé exige
 * une RÉPÉTITION de sorties longues, pas un pic isolé. Avec une seule
 * activité, le 80e percentile dégénère en la valeur elle-même (comportement
 * de cold start voulu, mais alors la confiance reste basse).
 *
 * Plage de démarrage (cold start) : 0-5h de temps en mouvement. Documentée
 * comme une plage de pratique plausible pour un cycliste amateur assidu, PAS
 * un référentiel de performance (voir normalization.js).
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry } from "../evidence.js";

const STARTUP_RANGE_HOURS = { min: 0, max: 5 };
const BENCHMARK_PERCENTILE = 80;

export function computeEndurance(activitySignals) {
  const eligible = (activitySignals || [])
    .map((s) => {
      const sec = s.movingTimeSec ?? s.durationSec;
      return sec != null && sec > 0 ? { ...s, hours: sec / 3600 } : null;
    })
    .filter(Boolean);

  if (eligible.length === 0) return insufficientData();

  const hoursList = eligible.map((e) => e.hours);
  const benchmarkHours = percentileValue(hoursList, BENCHMARK_PERCENTILE);

  const scale = blendedScale(benchmarkHours, hoursList, STARTUP_RANGE_HOURS);

  // Nombre de sorties "longues" (au-dessus de la médiane propre) — alimente
  // uniquement la confiance : la RÉPÉTITION de sorties longues, pas leur
  // seule existence, renforce la fiabilité du score (voir doc ci-dessus).
  const median = percentileValue(hoursList, 50);
  const longRideCount = median != null ? hoursList.filter((h) => h >= median).length : eligible.length;

  const evidence = eligible
    .slice()
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)
    .map((e) =>
      buildEvidenceEntry({
        activityId: e.activityId,
        metric: "movingTimeHours",
        value: Math.round(e.hours * 100) / 100,
        dataQuality: "measured", // durée/temps en mouvement sont mesurés (horodatage), jamais estimés
        reason: `Sortie de ${e.hours.toFixed(1)} h en mouvement.`,
      })
    );

  const confidence = computeConfidence({
    contributingActivities: longRideCount,
    dataQuality: "measured",
  });

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: eligible.length,
    contributingActivities: eligible.length,
    dataQuality: "measured",
    signals: {
      benchmarkHours: benchmarkHours != null ? Math.round(benchmarkHours * 100) / 100 : null,
      benchmarkPercentile: BENCHMARK_PERCENTILE,
      medianHours: median != null ? Math.round(median * 100) / 100 : null,
      longRideCount,
      normalizationMethod: scale.method,
    },
    evidence,
  };
}
