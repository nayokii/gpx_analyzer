/**
 * Territoires où l'IGN publie la BD TOPO (France métropolitaine et DOM).
 *
 * Ce n'est qu'un FILTRE GROSSIER (boîtes englobantes) pour décider si cela vaut la peine d'interroger l'IGN : une boîte
 * déborde sur des pays voisins (Espagne, Italie, Belgique…) et sur la mer. La couverture réelle n'est JAMAIS déduite de
 * cette boîte mais de la réponse : une zone sans aucun tronçon IGN est signalée « sans données IGN » (voir ign.js:
 * `empty`) et jamais présentée comme couverte. Hors de ces boîtes, l'IGN n'est pas interrogé (OpenStreetMap seul).
 *
 * Les boîtes ont été vérifiées par sondes réelles (réponses non vides en Guadeloupe, à la Réunion, en Corse et en
 * métropole ; réponse vide à Barcelone et en mer). Collectivités d'outre-mer hors DOM : non couvertes ici.
 */
import { cellBounds } from "./geo.js";

export const IGN_REGIONS = [
  { id: "metropole", label: "France métropolitaine", south: 41.0, west: -5.6, north: 51.3, east: 9.8 },
  { id: "guadeloupe", label: "Guadeloupe", south: 15.8, west: -61.95, north: 16.6, east: -60.9 },
  { id: "martinique", label: "Martinique", south: 14.3, west: -61.3, north: 14.95, east: -60.7 },
  { id: "guyane", label: "Guyane", south: 2.0, west: -54.7, north: 5.9, east: -51.5 },
  { id: "reunion", label: "La Réunion", south: -21.5, west: 55.1, north: -20.8, east: 55.9 },
  { id: "mayotte", label: "Mayotte", south: -13.1, west: 44.9, north: -12.5, east: 45.4 },
];

/**
 * @param {string} key - clé de zone (geo.js)
 * @returns {{id: string, label: string}|null} territoire IGN dont la boîte contient le centre de la zone, sinon null
 */
export function ignRegionForCell(key) {
  const b = cellBounds(key);
  const lat = (b.south + b.north) / 2;
  const lon = (b.west + b.east) / 2;
  const r = IGN_REGIONS.find((x) => lat >= x.south && lat <= x.north && lon >= x.west && lon <= x.east);
  return r ? { id: r.id, label: r.label } : null;
}

export function isIgnEligible(key) {
  return ignRegionForCell(key) !== null;
}
