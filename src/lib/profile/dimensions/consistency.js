/**
 * Régularité — fréquence et continuité de la PRATIQUE, jamais de la
 * performance (voir consigne : ne jamais appeler ça "discipline",
 * "motivation" ou "mental" — on ne connaît pas ces choses à partir de GPX/FIT,
 * seulement des dates de sortie).
 *
 * Contrairement aux autres dimensions, celle-ci n'utilise PAS le pipeline
 * startup/percentile de normalization.js : ses deux composantes sont déjà
 * des ratios bornés [0,1], donc nativement interprétables sans plage de
 * démarrage à calibrer :
 *
 * 1. `activeWeeksRatio` = nombre de semaines calendaires avec au moins une
 *    sortie / nombre de semaines couvertes par l'historique (première sortie
 *    → dernière sortie inclus). Réutilise `buildTimeSeries` de
 *    ../../history/trends.js (bucket "week") plutôt que de redupliquer la
 *    logique de regroupement calendaire.
 * 2. `steadiness` = régularité du VOLUME (distance) d'une semaine active à
 *    l'autre, via le coefficient de variation (voir utils.js) transformé en
 *    1 / (1 + CV) — 1 si le volume hebdomadaire est parfaitement stable, tend
 *    vers 0 quand il est très irrégulier. Calculée uniquement sur les
 *    semaines déjà actives (les semaines à zéro sont déjà pénalisées par
 *    `activeWeeksRatio`, pas comptées deux fois ici).
 *
 * `value` = moyenne des deux composantes disponibles (ou `activeWeeksRatio`
 * seul si `steadiness` n'est pas calculable, ex. une seule semaine active).
 * Nécessite au moins 2 sorties datées pour avoir un sens (voir insufficientData
 * plus bas) — une seule sortie ne permet d'évaluer aucune régularité.
 */

import { buildTimeSeries } from "../../history/trends.js";
import { parseActivityDate } from "../../history/dateUtils.js";
import { coefficientOfVariation } from "../../utils.js";
import { computeConfidence, confidenceLabel, insufficientData } from "../confidence.js";
import { ratioToScale } from "../normalization.js";
import { buildEvidenceEntry } from "../evidence.js";

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

export function computeConsistency(activities) {
  // Cette dimension n'a besoin que des dates : contrairement aux autres
  // dimensions, elle prend directement `Activity[]` (ou des résumés
  // d'index — les deux portent `date`), pas `activitySignals` (voir
  // ../activitySignals.js) qui n'apporte rien ici.
  const dated = (activities || [])
    .map((a) => ({ activity: a, date: parseActivityDate(a) }))
    .filter((d) => d.date != null);

  if (dated.length < 2) return insufficientData();

  dated.sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = dated[0].date;
  const last = dated[dated.length - 1].date;
  const totalWeeksSpan = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / MS_PER_WEEK) + 1);

  const weekly = buildTimeSeries(dated.map((d) => d.activity), { bucket: "week" });
  const weeksWithActivity = weekly.length;
  const activeWeeksRatio = Math.min(1, weeksWithActivity / totalWeeksSpan);

  let steadiness = null;
  if (weekly.length >= 2) {
    const cv = coefficientOfVariation(weekly.map((w) => w.distanceKm));
    if (cv != null) steadiness = 1 / (1 + cv);
  }

  const ratio = steadiness != null ? (activeWeeksRatio + steadiness) / 2 : activeWeeksRatio;

  const confidence = computeConfidence({
    contributingActivities: weeksWithActivity,
    dataQuality: "measured", // les dates de sortie sont mesurées (horodatage), jamais estimées
  });

  const evidence = [
    buildEvidenceEntry({
      activityId: dated[dated.length - 1].activity.id,
      metric: "activeWeeksRatio",
      value: Math.round(activeWeeksRatio * 100) / 100,
      dataQuality: "measured",
      reason: `${weeksWithActivity} semaine(s) avec au moins une sortie sur ${totalWeeksSpan} semaine(s) couvertes par l'historique.`,
    }),
  ];
  if (steadiness != null) {
    evidence.push(
      buildEvidenceEntry({
        activityId: dated[dated.length - 1].activity.id,
        metric: "steadiness",
        value: Math.round(steadiness * 100) / 100,
        dataQuality: "measured",
        reason: `Régularité du volume hebdomadaire (distance) sur ${weekly.length} semaine(s) actives.`,
      })
    );
  }

  return {
    value: Math.round(ratioToScale(ratio)),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidenceCount: dated.length,
    contributingActivities: weeksWithActivity,
    dataQuality: "measured",
    signals: {
      totalWeeksSpan,
      weeksWithActivity,
      activeWeeksRatio: Math.round(activeWeeksRatio * 100) / 100,
      steadiness: steadiness != null ? Math.round(steadiness * 100) / 100 : null,
      note: "Mesure la fréquence/continuité de la pratique, pas une performance ni un trait de caractère.",
    },
    evidence,
  };
}
