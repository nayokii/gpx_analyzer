/**
 * Détection générique de segments d'effort significatifs.
 *
 * Objectif limité et explicable (pas de coaching, pas d'IA) : repérer les
 * portions où le cycliste a soutenu un rythme nettement supérieur à son
 * propre rythme médian de la sortie, assez longtemps pour être significatif.
 *
 * Règles simples, déterministes :
 * 1. Signal : puissance (mesurée ou estimée, peu importe — déjà unifiées en
 *    amont par analysis.js) si disponible, sinon vitesse calculée. Sans l'un
 *    des deux et sans horodatage, aucun effort n'est détecté (pas de
 *    fabrication).
 * 2. Référence : médiane du signal sur les portions "en mouvement" (évite de
 *    tirer la médiane vers le bas à cause des arrêts).
 * 3. Seuil : référence × facteur (1.3 pour la puissance, plus variable donc
 *    facteur plus élevé ; 1.15 pour la vitesse).
 * 4. Un effort = portion continue au-dessus du seuil, les brefs passages
 *    en-dessous (< MERGE_GAP_SEC) sont fusionnés pour ne pas fragmenter un
 *    seul effort en plusieurs.
 * 5. Durée minimale MIN_EFFORT_SEC pour retenir un segment (évite les pics
 *    ponctuels/sprints isolés d'une poignée de secondes).
 *
 * Modèle repris de detectClimbs (analysis.js) : candidats puis fusion, même
 * philosophie, signal différent.
 */

import { avg, median } from "../utils.js";

const MIN_EFFORT_SEC = 60;
const MERGE_GAP_SEC = 15;
const POWER_FACTOR = 1.3;
const SPEED_FACTOR = 1.15;
const MOVING_SPEED_KMH = 2; // seuil "en mouvement" pour ne pas biaiser la médiane avec les arrêts

/**
 * @param {Object} analysis - Résultat de computeAnalysis()
 * @param {Object} [options] - Réservé pour de futurs réglages (facteurs, durée minimale) ; non utilisé pour l'instant.
 * @returns {Array<{
 *   startTime: Date|null,
 *   endTime: Date|null,
 *   durationSec: number,
 *   distanceM: number,
 *   avgSpeedKmh: number|null,
 *   maxSpeedKmh: number|null,
 *   avgPowerW: number|null,
 *   maxPowerW: number|null,
 *   avgHeartRateBpm: number|null,
 * }>}
 */
export function detectEfforts(analysis) {
  const { series, hasTime, hasPower, hasHR } = analysis;
  if (!hasTime) return [];

  const usePower = hasPower;
  const signalOf = usePower ? (p) => p.power : (p) => p.speed;
  const isMoving = usePower ? (p) => p.power != null && p.power > 0 : (p) => p.speed != null && p.speed > MOVING_SPEED_KMH;
  const factor = usePower ? POWER_FACTOR : SPEED_FACTOR;

  const baseline = median(series.filter(isMoving).map(signalOf));
  if (baseline == null || baseline <= 0) return [];
  const threshold = baseline * factor;

  // ---- 1. segments bruts au-dessus du seuil ----
  const raw = [];
  let curStart = null;
  for (let i = 0; i < series.length; i++) {
    const v = signalOf(series[i]);
    const above = v != null && v >= threshold;
    if (above) {
      if (curStart == null) curStart = i;
    } else if (curStart != null) {
      raw.push({ startIdx: curStart, endIdx: i - 1 });
      curStart = null;
    }
  }
  if (curStart != null) raw.push({ startIdx: curStart, endIdx: series.length - 1 });

  // ---- 2. fusion des segments séparés par un court passage sous le seuil ----
  const merged = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gapSec = series[seg.startIdx].elapsed - series[prev.endIdx].elapsed;
      if (gapSec < MERGE_GAP_SEC) {
        prev.endIdx = seg.endIdx;
        continue;
      }
    }
    merged.push({ ...seg });
  }

  // ---- 3. filtrage par durée minimale + calcul des statistiques ----
  const efforts = [];
  for (const seg of merged) {
    const s = series[seg.startIdx];
    const e = series[seg.endIdx];
    const durationSec = e.elapsed - s.elapsed;
    if (durationSec < MIN_EFFORT_SEC) continue;

    const slice = series.slice(seg.startIdx, seg.endIdx + 1);
    const speeds = slice.map((p) => p.speed).filter((v) => v != null);
    const powers = hasPower ? slice.map((p) => p.power).filter((v) => v != null) : [];
    const hrs = hasHR ? slice.map((p) => p.hr).filter((v) => v != null) : [];

    efforts.push({
      startTime: s.time || null,
      endTime: e.time || null,
      durationSec,
      distanceM: (e.distance - s.distance) * 1000,
      avgSpeedKmh: speeds.length ? avg(speeds) : null,
      maxSpeedKmh: speeds.length ? Math.max(...speeds) : null,
      avgPowerW: powers.length ? avg(powers) : null,
      maxPowerW: powers.length ? Math.max(...powers) : null,
      avgHeartRateBpm: hrs.length ? avg(hrs) : null,
    });
  }

  return efforts;
}
