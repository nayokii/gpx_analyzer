/**
 * Grimpe — distingue explicitement "a fait beaucoup de D+" (exposition) de
 * "grimpe bien" (performance), conformément à la consigne.
 *
 * Signal de PERFORMANCE (alimente `value`) : le VAM (Vitesse Ascensionnelle
 * Moyenne, gain d'altitude en mètres / durée × 3600 — une métrique cycliste
 * standard, indépendante de la distance parcourue), calculé par montée
 * détectée (voir ../activitySignals.js qui réutilise `detectClimbs` de
 * analysis.js). On prend la MÉDIANE des VAM plutôt que le maximum : un pic
 * unique (souvent un artefact GPS/altitude sur une portion courte) ne doit
 * pas dominer le score — la médiane reflète le rythme de montée "typique".
 *
 * Signaux d'EXPOSITION (n'alimentent que `signals`/la confiance, jamais
 * `value` directement) : D+ total, D+ relatif à la distance, nombre de
 * montées détectées, nombre d'activités avec montée. Beaucoup de D+ sans
 * bon VAM ne produit donc PAS un score de grimpe élevé.
 *
 * Plage de démarrage (cold start) : VAM 200-1000 m/h. Documentée comme une
 * plage de pratique amateur plausible (une côte à 6-8 % roulée à 12-18 km/h
 * produit un VAM de cet ordre), PAS un référentiel professionnel.
 */

import { blendedScale, percentileValue } from "../normalization.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { buildEvidenceEntry } from "../evidence.js";

const STARTUP_RANGE_VAM = { min: 200, max: 1000 };

function vamOf(climb) {
  if (climb.gainM == null || climb.durationSec == null || climb.durationSec <= 0 || climb.gainM <= 0) return null;
  return (climb.gainM / climb.durationSec) * 3600;
}

export function computeClimbing(activitySignals) {
  const climbsWithVam = [];
  let activitiesWithClimb = 0;
  let totalElevationGainM = 0;
  let totalDistanceKm = 0;
  let activitiesWithElevation = 0;

  for (const s of activitySignals || []) {
    if (s.elevationGainM != null) {
      totalElevationGainM += s.elevationGainM;
      activitiesWithElevation++;
    }
    if (s.distanceKm != null) totalDistanceKm += s.distanceKm;

    if (!s.climbs || s.climbs.length === 0) continue;
    let hasVam = false;
    for (const c of s.climbs) {
      const vam = vamOf(c);
      if (vam == null) continue;
      hasVam = true;
      climbsWithVam.push({ activityId: s.activityId, vam, gainM: c.gainM, avgGrade: c.avgGrade, durationSec: c.durationSec });
    }
    if (hasVam) activitiesWithClimb++;
  }

  if (climbsWithVam.length === 0) return insufficientData();

  const vamList = climbsWithVam.map((c) => c.vam);
  const medianVam = percentileValue(vamList, 50);
  const scale = blendedScale(medianVam, vamList, STARTUP_RANGE_VAM);

  const evidence = climbsWithVam
    .slice()
    .sort((a, b) => b.vam - a.vam)
    .slice(0, 10)
    .map((c) =>
      buildEvidenceEntry({
        activityId: c.activityId,
        metric: "climbVam",
        value: Math.round(c.vam),
        dataQuality: "measured",
        reason: `Montée de ${Math.round(c.gainM)} m (pente moy. ${c.avgGrade.toFixed(1)} %) en ${Math.round(c.durationSec / 60)} min — VAM ${Math.round(c.vam)} m/h.`,
      })
    );

  const confidence = computeConfidence({
    contributingActivities: activitiesWithClimb,
    dataQuality: "measured",
  });

  const relativeGainMPerKm = totalDistanceKm > 0 ? totalElevationGainM / totalDistanceKm : null;

  return {
    value: scale.value != null ? Math.round(scale.value) : null,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: climbsWithVam.length,
    contributingActivities: activitiesWithClimb,
    dataQuality: "measured",
    signals: {
      medianVam: medianVam != null ? Math.round(medianVam) : null,
      climbCount: climbsWithVam.length,
      normalizationMethod: scale.method,
      exposure: {
        totalElevationGainM: activitiesWithElevation > 0 ? Math.round(totalElevationGainM) : null,
        relativeGainMPerKm: relativeGainMPerKm != null ? Math.round(relativeGainMPerKm * 10) / 10 : null,
        note: "Signaux d'exposition (volume de D+) — n'influencent pas directement value, seulement la confiance/le contexte.",
      },
    },
    evidence,
  };
}
