/**
 * Utilitaires de dates pour le moteur historique.
 *
 * PROBLÈME DE FUSEAU HORAIRE (audité avant d'écrire ce module) :
 * `Activity.date` est stocké en UTC (`normalize.js` fait
 * `analysis.startTime.toISOString()`), et aucun fuseau horaire par activité
 * n'est persisté nulle part (ni dans `Activity`, ni dans le FIT décodé par
 * `fitParser.js` — le champ FIT `activity.local_timestamp`, qui donnerait le
 * fuseau du device au moment de la sortie, existe dans le fichier mais n'est
 * pas extrait aujourd'hui).
 *
 * Conséquence concrète : découper une date UTC par simple `.slice(0, 10)`
 * (ce que fait déjà `activityStore.js`/`HistoryView.jsx` pour le tri/filtre,
 * sans conséquence là car ce sont des comparaisons de plage, pas un
 * regroupement par jour calendaire) peut faire basculer une sortie sur le
 * mauvais jour dès qu'elle a lieu près de minuit UTC. Exemple réel : une
 * sortie commencée à 22h locale en UTC-4 est enregistrée à 2h UTC le
 * lendemain — un regroupement par jour "20 septembre" affiché comme
 * "21 septembre".
 *
 * CHOIX RETENU ICI : regrouper par jour/semaine/mois calendaire dans le
 * fuseau LOCAL de l'environnement d'exécution (celui du navigateur de
 * l'utilisateur), via les accesseurs locaux de `Date` (`getFullYear`,
 * `getMonth`, `getDate`) plutôt qu'un découpage de la chaîne UTC. C'est la
 * meilleure approximation disponible sans fuseau par activité : correct pour
 * l'usage normal (un cycliste qui roule et consulte son historique dans le
 * même fuseau), imparfait pour quelqu'un qui importerait, depuis un autre
 * fuseau, une sortie faite ailleurs (limite documentée, pas corrigée ici —
 * corriger cela pour de vrai nécessiterait d'extraire `local_timestamp` du
 * FIT en Phase 3, hors périmètre de cette phase historique).
 */

/**
 * Convertit `Activity.date` (chaîne ISO 8601, généralement UTC) en objet Date.
 * @param {{date?: string|null}|null} activity
 * @returns {Date|null} `null` si absent/invalide — jamais une date inventée
 */
export function parseActivityDate(activity) {
  if (!activity || !activity.date) return null;
  const d = new Date(activity.date);
  return isNaN(d.getTime()) ? null : d;
}

/** Clé de jour calendaire LOCAL, format "YYYY-MM-DD". */
export function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Numéro de semaine ISO-8601 (lundi première, semaine 1 = celle du premier jeudi de l'année), calculé sur le calendrier LOCAL. */
function isoWeekInfo(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7; // lundi=0 .. dimanche=6
  d.setDate(d.getDate() - dayNum + 3); // jeudi de la semaine courante
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear: d.getFullYear(), isoWeek: week };
}

/** Clé de semaine calendaire LOCALE, format ISO "YYYY-Www". */
export function localWeekKey(date) {
  const { isoYear, isoWeek } = isoWeekInfo(date);
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

/** Clé de mois calendaire LOCAL, format "YYYY-MM". */
export function localMonthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Calcule une plage {from, to} (objets Date, bornes incluses) à partir d'une
 * période nommée ou d'un intervalle personnalisé.
 * @param {"7d"|"30d"|"90d"|"year"|"all"|{from?: string|Date, to?: string|Date}} period
 * @param {Date} [referenceDate] - "Maintenant" par défaut ; paramétrable pour les tests
 * @returns {{from: Date|null, to: Date|null}} `null` de part et d'autre = pas de borne (= "all")
 */
export function periodRange(period, referenceDate = new Date()) {
  if (period && typeof period === "object") {
    return {
      from: period.from ? new Date(period.from) : null,
      to: period.to ? new Date(period.to) : null,
    };
  }
  if (period === "all" || period == null) return { from: null, to: null };

  const to = new Date(referenceDate);
  const from = new Date(referenceDate);
  if (period === "7d") from.setDate(from.getDate() - 7);
  else if (period === "30d") from.setDate(from.getDate() - 30);
  else if (period === "90d") from.setDate(from.getDate() - 90);
  else if (period === "year") from.setFullYear(from.getFullYear() - 1);
  else throw new Error(`Période inconnue : ${period}`);

  return { from, to };
}

/** @returns {boolean} `date` est dans [from, to] (bornes incluses, `null` = pas de borne de ce côté) */
export function isWithinPeriod(date, { from, to }) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
