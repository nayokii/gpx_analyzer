/**
 * Export « journal de stats » pour se faire coacher par Claude.
 *
 * L'application ne contacte AUCUNE IA (pas de clé dans le navigateur) : elle
 * produit un fichier Markdown autonome — consigne de coaching + stats — que
 * l'utilisateur colle ou joint dans une conversation Claude. Lecture seule,
 * aucun nouveau calcul métier : on met en forme `buildCoachContext()` (via
 * `formatCoachContextCompact`), `analyzeCoachContext()` et `summarizeRide()`.
 * Aucune trace GPS ni coordonnée n'est exportée (uniquement des agrégats).
 */

import { summarizeRide, formatCoachContextCompact } from "./context.js";
import { fmt1, fmtInt, fmtDuration } from "../utils.js";

const COACH_PROMPT = `Tu es mon coach cycliste. Ci-dessous : mon journal de stats exporté depuis Cycling OS.

Ce que j'attends de toi :
1. Un bilan honnête de ma forme et de mes dernières sorties (points forts, points faibles).
2. 3 pistes d'amélioration PRIORISÉES, chacune avec : pourquoi (en citant mes chiffres), comment (séance type concrète) et comment mesurer le progrès.
3. Un plan pour les 7 prochains jours (sorties, durée, intensité, repos).
4. Les questions dont tu as besoin pour affiner (objectifs, disponibilité, matériel, blessures).

Règles : appuie-toi uniquement sur les données ci-dessous ; si une donnée manque (« n/d », « — »), dis-le au lieu de l'inventer. Distingue puissance mesurée et estimée. Ne pose pas de diagnostic médical ; en cas de douleur ou de fatigue anormale, conseille d'en parler à un professionnel de santé.`;

function line(label, items) {
  if (!items || items.length === 0) return [`### ${label}`, "- (aucun)", ""];
  return [`### ${label}`, ...items.map((i) => `- ${i.message}`), ""];
}

function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : "n/d";
}

function rideRow(r) {
  const power = r.power && r.power.available ? `${fmtInt(r.power.avgW)} W (${r.power.source === "measured" ? "mesurée" : "estimée"})` : "n/d";
  const hr = r.avgHeartRateBpm != null ? `${fmtInt(r.avgHeartRateBpm)}` : "n/d";
  const cad = r.avgCadenceRpm != null ? `${fmtInt(r.avgCadenceRpm)}` : "n/d";
  const name = (r.name || "Sortie").replace(/\|/g, "/");
  return `| ${dateOnly(r.date)} | ${name} | ${fmt1(r.distanceKm)} | ${fmtDuration(r.movingTimeSec)} | ${fmtInt(r.elevationGainM)} | ${fmt1(r.avgSpeedKmh)} | ${power} | ${hr} | ${cad} |`;
}

/**
 * @param {Object} params
 * @param {Object} params.context - résultat de `buildCoachContext()`
 * @param {Object} params.analysis - résultat de `analyzeCoachContext()`
 * @param {Array} params.activities - Activity[] chargées (pour le tableau de toutes les sorties)
 * @param {Date} [params.now]
 * @returns {{filename: string, text: string, rideCount: number}}
 */
export function buildCoachExport({ context, analysis, activities, now = new Date() }) {
  const rides = (activities || [])
    .map(summarizeRide)
    .filter(Boolean)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const out = [];
  out.push("# Journal de stats Cycling OS — demande de coaching", "");
  out.push(COACH_PROMPT, "", "---", "");
  out.push(`Export du ${now.toISOString().slice(0, 10)} — ${rides.length} sortie(s).`, "");

  out.push("## Toutes mes sorties (récentes d'abord)", "");
  out.push("| Date | Nom | Distance (km) | Temps en mouvement | D+ (m) | Vitesse moy. (km/h) | Puissance moy. | FC moy. | Cadence moy. |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  out.push(...rides.map(rideRow), "");

  out.push("## Contexte détaillé (dernière sortie, comparaison, profil, progression, records)", "");
  out.push("```", formatCoachContextCompact(context), "```", "");

  if (analysis) {
    out.push("## Analyse automatique de l'application (à challenger)", "");
    out.push(analysis.summary || "", "");
    out.push(...line("Recommandations de l'app", analysis.recommendations));
    out.push(...line("Points positifs", analysis.positives));
    out.push(...line("À surveiller", analysis.attentionPoints));
    out.push(...line("Évolution", analysis.evolution));
    out.push(...line("Limites des données", analysis.dataLimits));
  }

  return {
    filename: `cycling-os-coaching-${now.toISOString().slice(0, 10)}.md`,
    text: out.join("\n"),
    rideCount: rides.length,
  };
}
