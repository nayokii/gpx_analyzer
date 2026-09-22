/**
 * Technique (VTT/terrain technique) — dimension volontairement restreinte.
 *
 * GARDE-FOU (consigne : "si les données ne permettent pas de mesurer
 * correctement cette dimension, ne pas inventer") : cette dimension ne
 * produit une valeur QUE s'il existe au moins une activité explicitement
 * identifiée `sportType: "mtb"` ou `"gravel"` (voir types.js) avec des
 * échantillons complets. La seule variabilité de vitesse d'une sortie
 * "cycling" ne suffit PAS à conclure à du terrain technique — elle est tout
 * autant expliquée par des arrêts en ville, du trafic ou de la fatigue, ce
 * qui rendrait le signal trompeur sans confirmation du type de pratique.
 *
 * Signal principal : écart-type de la pente locale le long du parcours
 * (`gradeVariability`, voir ../activitySignals.js) — un terrain technique
 * alterne montées/descentes/replats de façon irrégulière, contrairement à un
 * profil routier progressif. Repli sur le coefficient de variation de la
 * vitesse (`speedVariability`) si l'altitude est indisponible — signal
 * strictement moins direct, confiance réduite en conséquence
 * (`dataQuality: "speed"`).
 *
 * Ce que ça ne mesure PAS : la maîtrise technique, le pilotage, la prise de
 * risque — uniquement l'irrégularité mesurable du terrain parcouru.
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry } from "../evidence.js";

const STARTUP_RANGE_GRADE = { min: 1, max: 12 }; // écart-type de pente (%), plage de terrain "vallonné à technique" plausible
const STARTUP_RANGE_SPEED_CV = { min: 0.15, max: 0.8 }; // coefficient de variation de vitesse

export function computeTechnical(activitySignals) {
  const eligible = (activitySignals || []).filter(
    (s) => (s.sportType === "mtb" || s.sportType === "gravel") && s.hasSamples
  );

  if (eligible.length === 0) {
    return insufficientData({
      signals: { reason: "Aucune sortie identifiée comme VTT/gravel (sportType) avec échantillons complets." },
    });
  }

  const gradeEntries = eligible.filter((s) => s.gradeVariability != null);
  const speedEntries = eligible.filter((s) => s.speedVariability != null);
  const usingGrade = gradeEntries.length > 0;
  const entries = usingGrade ? gradeEntries : speedEntries;

  if (entries.length === 0) {
    return insufficientData({
      signals: { reason: "Sorties VTT/gravel identifiées mais sans altitude ni vitesse exploitables pour estimer l'irrégularité du terrain." },
    });
  }

  const values = entries.map((s) => (usingGrade ? s.gradeVariability : s.speedVariability));
  const range = usingGrade ? STARTUP_RANGE_GRADE : STARTUP_RANGE_SPEED_CV;
  const benchmark = percentileValue(values, 80);
  const scale = blendedScale(benchmark, values, range);
  const dataQuality = usingGrade ? "measured" : "speed";

  const evidence = entries
    .slice()
    .sort((a, b) => (usingGrade ? b.gradeVariability - a.gradeVariability : b.speedVariability - a.speedVariability))
    .slice(0, 10)
    .map((s) =>
      buildEvidenceEntry({
        activityId: s.activityId,
        metric: usingGrade ? "gradeVariability" : "speedVariabilityCV",
        value: Math.round((usingGrade ? s.gradeVariability : s.speedVariability) * 100) / 100,
        dataQuality,
        reason: usingGrade
          ? `Sortie ${s.sportType} : écart-type de pente ${s.gradeVariability.toFixed(1)} % (terrain irrégulier).`
          : `Sortie ${s.sportType} : coefficient de variation de vitesse ${s.speedVariability.toFixed(2)} (altitude indisponible).`,
      })
    );

  const confidence = computeConfidence({ contributingActivities: entries.length, dataQuality });

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: entries.length,
    contributingActivities: entries.length,
    dataQuality,
    signals: {
      signalUsed: usingGrade ? "gradeVariability" : "speedVariability",
      benchmark: benchmark != null ? Math.round(benchmark * 100) / 100 : null,
      normalizationMethod: scale.method,
      eligibleActivities: eligible.length,
    },
    evidence,
  };
}
