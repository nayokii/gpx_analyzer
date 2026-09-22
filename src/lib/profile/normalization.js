/**
 * Normalisation des signaux du profil cycliste sur une échelle interne 0-100.
 *
 * RÈGLE (voir README.md du module) : ce 0-100 n'est JAMAIS une mesure absolue
 * de performance humaine ni un pourcentage de niveau professionnel. C'est un
 * indice interne, dont le sens dépend de la méthode utilisée pour le produire :
 *
 * - `percentileRank` : position de la valeur DANS LA PROPRE distribution
 *   historique de l'utilisateur (ce que la consigne appelle "normalisation
 *   relative au propre historique"). Fiable seulement si la distribution
 *   contient assez de points — avec 1 ou 2 valeurs, un percentile est trivial
 *   (toujours ~100 ou ~50) et donc trompeur seul.
 * - `startupScale` : place une valeur brute sur une courbe bornée et
 *   saturante, calibrée sur une PLAGE DE PRATIQUE PLAUSIBLE large et générique
 *   (documentée par dimension), PAS un référentiel de performance humaine ou
 *   professionnelle. Utilisée uniquement pour donner un point de départ
 *   interprétable quand l'historique est trop court pour un percentile
 *   significatif ("cold start" — voir consigne §7).
 * - `blendedScale` : combine les deux, avec un poids qui glisse de
 *   `startupScale` vers `percentileRank` à mesure que l'historique grandit.
 *   C'est LA fonction que les dimensions de performance (endurance, grimpe,
 *   punch, sprint, contre-la-montre) utilisent pour produire leur `value`.
 *   Le seuil de bascule (`fullTrustCount`) est un choix de calibration
 *   documenté ("à partir de combien de sorties fait-on confiance à la
 *   distribution propre de l'utilisateur ?"), pas un coefficient de score —
 *   il ne pondère aucune métrique, il ne fait que doser DEUX méthodes de
 *   lecture d'une même valeur déjà calculée.
 *
 * La régularité (consistency) n'utilise PAS ce module : ses signaux sont déjà
 * des ratios 0-1 (semaines actives / semaines couvertes...), naturellement
 * bornés sans normalisation inventée.
 */

/**
 * Rang percentile de `value` au sein de `historicalValues` (value incluse si
 * déjà présente). 0 = plus petite valeur observée, 100 = plus grande.
 * Avec un seul point égal à `value`, retourne 50 (rang "moyen" d'un ex-aequo
 * avec soi-même, voir plus bas) : ce résultat n'est significatif que combiné
 * à une confiance faible en amont — `blendedScale` ne lui fait d'ailleurs
 * jamais confiance seul avec un historique aussi court (voir
 * `percentileTrustWeight`).
 *
 * @param {number} value
 * @param {number[]} historicalValues - valeurs non nulles
 * @returns {number|null} 0-100, ou null si aucune valeur historique
 */
export function percentileRank(value, historicalValues) {
  const clean = (historicalValues || []).filter((v) => v != null && !isNaN(v));
  if (clean.length === 0 || value == null || isNaN(value)) return null;

  const countBelow = clean.filter((v) => v < value).length;
  const countEqual = clean.filter((v) => v === value).length;
  // Rang percentile "moyen" (milieu des ex-aequo) — évite qu'une valeur
  // exactement égale à toutes les autres tombe à 0 ou 100 arbitrairement.
  const rank = (countBelow + countEqual / 2) / clean.length;
  return rank * 100;
}

/**
 * Place `value` sur une échelle 0-100 bornée et saturante (racine carrée),
 * calibrée par une plage de référence `{ min, max }` documentée par
 * l'appelant. `min` correspond à 0, `max` correspond à 100 ; au-delà de
 * `max`, la courbe continue de croître mais de plus en plus lentement
 * (rendements décroissants — une valeur "extrême" ne doit pas exploser le
 * score) au lieu d'être plafonnée brutalement.
 *
 * @param {number} value
 * @param {{min: number, max: number}} range - plage de référence (voir doc de chaque dimension)
 * @returns {number|null} 0-100 (peut légèrement dépasser 100 pour des valeurs très supérieures à `max`), ou null si `value` est absente
 */
export function startupScale(value, range) {
  if (value == null || isNaN(value)) return null;
  const { min, max } = range;
  if (max <= min) throw new Error("startupScale: range.max doit être > range.min");

  const span = max - min;
  const normalized = (value - min) / span;
  if (normalized <= 0) return 0;
  // Racine carrée : rendements décroissants au-delà de 1 (= max), jamais de plafond dur.
  return Math.min(150, Math.sqrt(normalized) * 100);
}

const DEFAULT_FULL_TRUST_COUNT = 15;

/**
 * Poids de confiance accordé au percentile propre à l'utilisateur (vs
 * l'échelle de démarrage générique), selon le nombre de valeurs historiques
 * disponibles. 0 avec 1 valeur (percentile trivial, on ne s'y fie pas du
 * tout) → 1 à partir de `fullTrustCount` valeurs.
 *
 * @param {number} historyCount
 * @param {number} [fullTrustCount=15]
 * @returns {number} 0-1
 */
export function percentileTrustWeight(historyCount, fullTrustCount = DEFAULT_FULL_TRUST_COUNT) {
  if (historyCount <= 1) return 0;
  return Math.max(0, Math.min(1, (historyCount - 1) / (fullTrustCount - 1)));
}

/**
 * Combine `startupScale` et `percentileRank` pour une valeur donnée, avec un
 * mélange qui glisse progressivement vers le percentile propre à mesure que
 * l'historique grandit (voir `percentileTrustWeight`).
 *
 * @param {number} value - valeur brute de l'activité/agrégat en cours
 * @param {number[]} historicalValues - valeurs brutes comparables de tout l'historique (value incluse)
 * @param {{min: number, max: number}} startupRange - voir `startupScale`
 * @param {Object} [options]
 * @param {number} [options.fullTrustCount=15]
 * @returns {{value: number|null, method: "startup"|"percentile"|"blended", percentileWeight: number}}
 */
export function blendedScale(value, historicalValues, startupRange, options = {}) {
  if (value == null || isNaN(value)) return { value: null, method: "startup", percentileWeight: 0 };

  const fullTrustCount = options.fullTrustCount ?? DEFAULT_FULL_TRUST_COUNT;
  const clean = (historicalValues || []).filter((v) => v != null && !isNaN(v));
  const startup = startupScale(value, startupRange);
  const weight = percentileTrustWeight(clean.length, fullTrustCount);

  if (weight <= 0) {
    return { value: startup, method: "startup", percentileWeight: 0 };
  }

  const pct = percentileRank(value, clean);
  if (pct == null) return { value: startup, method: "startup", percentileWeight: 0 };

  const blended = startup * (1 - weight) + pct * weight;
  return { value: blended, method: weight >= 1 ? "percentile" : "blended", percentileWeight: weight };
}

/**
 * Valeur au p-ième percentile de `values` (interpolation linéaire entre les
 * deux points encadrants), PAS un rang — utilisé par les dimensions qui ont
 * besoin d'un "représentant" robuste de leur propre historique avant de
 * l'envoyer dans `blendedScale` (ex. "80e percentile des sorties longues" =
 * une sortie longue seule ne compte pas comme la référence, mais une
 * répétition si). Avec un seul point, retourne ce point (aucune interpolation
 * possible), ce qui est le comportement voulu du cold start.
 *
 * @param {number[]} values
 * @param {number} p - 0-100
 * @returns {number|null}
 */
export function percentileValue(values, p) {
  const clean = (values || []).filter((v) => v != null && !isNaN(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];

  const idx = (p / 100) * (clean.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return clean[lo];
  const frac = idx - lo;
  return clean[lo] + (clean[hi] - clean[lo]) * frac;
}

/**
 * Convertit un ratio déjà borné [0,1] en indice 0-100 — utilisé par les
 * dimensions dont les signaux sont nativement des ratios (ex. régularité :
 * semaines actives / semaines couvertes) et n'ont donc pas besoin du pipeline
 * startup/percentile.
 * @param {number|null} ratio
 * @returns {number|null}
 */
export function ratioToScale(ratio) {
  if (ratio == null || isNaN(ratio)) return null;
  return Math.max(0, Math.min(100, ratio * 100));
}
