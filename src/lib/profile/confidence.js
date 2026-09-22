/**
 * Logique de confiance partagée par toutes les dimensions du profil.
 *
 * La confiance répond à "à quel point peut-on se fier à `value` ?", jamais à
 * "est-ce que `value` est élevée ?" — les deux sont indépendantes (voir
 * consigne §8 : confidence 0.34 avec peu de données est normal, confidence
 * 0.95 avec deux sorties serait suspect).
 *
 * Deux composantes, multipliées :
 * 1. `sampleWeight` — combien de preuves indépendantes soutiennent `value`
 *    (nombre d'activités contributrices), sur une courbe saturante : chaque
 *    preuve supplémentaire compte de moins en moins (la différence entre 1 et
 *    2 activités est plus significative qu'entre 20 et 21).
 * 2. `dataQualityWeight` — à quel point les preuves elles-mêmes sont fiables
 *    (mesuré > estimé > absent). Un score construit sur 10 sorties à
 *    puissance ESTIMÉE ne mérite pas la même confiance que 10 sorties à
 *    puissance mesurée, même à nombre de preuves égal.
 */

const DEFAULT_SATURATION_COUNT = 6; // nombre d'activités contributrices auquel sampleWeight atteint ~0.5

/** Qualité de donnée → poids. "none" ne devrait jamais atteindre ce module (voir insufficientData ci-dessous). */
export const DATA_QUALITY_WEIGHTS = {
  measured: 1,
  estimated: 0.6,
  speed: 0.45, // signal dérivé de la seule vitesse, sans aucun capteur dédié (ex. punch sans puissance)
  mixed: 0.75, // mélange mesuré/estimé au sein des preuves contributrices
};

/**
 * @param {number} contributingCount - nombre d'activités (ou preuves) ayant contribué au signal
 * @param {number} [saturationCount=6]
 * @returns {number} 0-1, courbe saturante (1 - 1/(1 + n/k))
 */
export function sampleWeight(contributingCount, saturationCount = DEFAULT_SATURATION_COUNT) {
  const n = Math.max(0, contributingCount || 0);
  if (n === 0) return 0;
  return 1 - 1 / (1 + n / saturationCount);
}

/**
 * @param {"measured"|"estimated"|"speed"|"mixed"} dataQuality
 * @returns {number} 0-1
 */
export function dataQualityWeight(dataQuality) {
  return DATA_QUALITY_WEIGHTS[dataQuality] ?? 0.5;
}

/**
 * @param {Object} params
 * @param {number} params.contributingActivities - nombre d'activités distinctes ayant fourni au moins un signal exploitable
 * @param {number} [params.evidenceCount] - nombre total de preuves individuelles (peut dépasser contributingActivities si plusieurs preuves par activité, ex. plusieurs montées)
 * @param {"measured"|"estimated"|"speed"|"mixed"} params.dataQuality
 * @param {number} [params.saturationCount=6]
 * @returns {number} confiance 0-1
 */
export function computeConfidence({ contributingActivities, dataQuality, saturationCount }) {
  const sw = sampleWeight(contributingActivities, saturationCount);
  const dq = dataQualityWeight(dataQuality);
  return Math.max(0, Math.min(1, sw * dq));
}

const LABEL_THRESHOLDS = [
  { max: 0.35, label: "low" },
  { max: 0.7, label: "medium" },
];

/**
 * @param {number|null} confidence - 0-1, ou null si insufficient_data
 * @returns {"insufficient_data"|"low"|"medium"|"high"}
 */
export function confidenceLabel(confidence) {
  if (confidence == null) return "insufficient_data";
  for (const { max, label } of LABEL_THRESHOLDS) {
    if (confidence < max) return label;
  }
  return "high";
}

/**
 * Structure standard renvoyée par une dimension quand aucun signal
 * exploitable n'a été trouvé (0 preuve). Ne JAMAIS renvoyer une `value`
 * numérique dans ce cas (voir consigne §7 et §10).
 * @param {Object} [extra] - champs additionnels à fusionner (ex. `signals` vide documenté)
 */
export function insufficientData(extra = {}) {
  return {
    value: null,
    confidence: null,
    confidenceLabel: "insufficient_data",
    evidenceCount: 0,
    contributingActivities: 0,
    dataQuality: "none",
    signals: {},
    evidence: [],
    ...extra,
  };
}
