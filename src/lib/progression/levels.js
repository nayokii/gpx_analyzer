/**
 * Système de niveaux — courbe à paliers croissants, centralisée ici.
 *
 * Chaque montée de niveau coûte `BASE_STEP` XP de plus que la précédente de
 * `STEP_INCREMENT` (pas un simple `Math.floor(xp / 100)`, qui donnerait une
 * progression plate) :
 *
 *   niveau 1 →2 : 100 XP
 *   niveau 2 →3 : 150 XP
 *   niveau 3 →4 : 200 XP
 *   ...
 *
 * Seuils cumulés résultants (voir `xpThresholdForLevel`) : 0, 100, 250, 450,
 * 700, ... — une suite arithmétique de deltas, donc un seuil quadratique en
 * niveau, fermé sous forme close (pas de table écrite à la main, pas de
 * boucle de génération à maintenir).
 */

const BASE_STEP = 100;
const STEP_INCREMENT = 50;
const MAX_LEVEL_SEARCH = 1000; // garde-fou, jamais atteint en pratique

/**
 * XP cumulée nécessaire pour ATTEINDRE `level` (0 pour le niveau 1).
 * @param {number} level
 * @returns {number}
 */
export function xpThresholdForLevel(level) {
  const n = Math.max(1, Math.floor(level));
  const m = n - 1; // nombre de montées de niveau déjà franchies
  return m * BASE_STEP + (STEP_INCREMENT * m * (m - 1)) / 2;
}

/**
 * @param {number} totalXp
 * @returns {number} niveau atteint (le plus grand `n` tel que xpThresholdForLevel(n) <= totalXp)
 */
export function getLevelFromXp(totalXp) {
  const xp = Math.max(0, totalXp || 0);
  let level = 1;
  while (level < MAX_LEVEL_SEARCH && xpThresholdForLevel(level + 1) <= xp) level++;
  return level;
}

/**
 * @param {number} totalXp
 * @returns {{level: number, currentXp: number, levelFloorXp: number, levelXp: number, progress: number, remaining: number}}
 *   `levelXp` = XP requise pour le PROCHAIN niveau (celui vers lequel on progresse) ;
 *   `progress` = position (0-1) entre le seuil du niveau actuel et celui du suivant ;
 *   `remaining` = XP restante avant le prochain niveau.
 */
export function getXpProgress(totalXp) {
  const xp = Math.max(0, totalXp || 0);
  const level = getLevelFromXp(xp);
  const levelFloorXp = xpThresholdForLevel(level);
  const levelCeilXp = xpThresholdForLevel(level + 1);
  const span = levelCeilXp - levelFloorXp;
  const progress = span > 0 ? (xp - levelFloorXp) / span : 1;
  return {
    level,
    currentXp: xp,
    levelFloorXp,
    levelXp: levelCeilXp,
    progress: Math.max(0, Math.min(1, progress)),
    remaining: Math.max(0, levelCeilXp - xp),
  };
}

/** @returns {number} XP restante avant le prochain niveau (raccourci sur getXpProgress). */
export function getXpToNextLevel(totalXp) {
  return getXpProgress(totalXp).remaining;
}

/**
 * Titres d'Alter Ego par palier de niveau — sobres, ancrés cyclisme/analytique
 * (pas de vocabulaire "gaming mobile"). Le titre affiché est celui du plus
 * haut palier atteint.
 */
const TITLE_TIERS = [
  { level: 1, title: "Rookie" },
  { level: 5, title: "Rider" },
  { level: 10, title: "Explorer" },
  { level: 15, title: "Rouleur" },
  { level: 20, title: "Specialist" },
  { level: 25, title: "Expert" },
  { level: 30, title: "Veteran" },
];

/**
 * @param {number} level
 * @returns {string}
 */
export function getTitleForLevel(level) {
  let current = TITLE_TIERS[0].title;
  for (const tier of TITLE_TIERS) {
    if (level >= tier.level) current = tier.title;
    else break;
  }
  return current;
}
