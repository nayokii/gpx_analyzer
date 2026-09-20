/**
 * Générateur de données de démonstration
 *
 * Produit un parcours fictif (style relief guadeloupéen) permettant de découvrir
 * l'application sans avoir à importer un vrai fichier GPX.
 */

/**
 * Génère un parcours fictif complet avec points GPS, altitude, FC, cadence...
 *
 * @returns {{name: string, points: Array}}
 */
export function generateDemoPoints() {
  const n = 520;
  const pts = [];
  const centerLat = 16.05,
    centerLon = -61.75; // zone fictive, style Guadeloupe
  const start = new Date();
  start.setHours(start.getHours() - 3);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const angle = p * 2.05 * Math.PI;
    const radius = 0.028 + 0.006 * Math.sin(p * 9);
    const lat = centerLat + radius * Math.sin(angle) * 0.7 + 0.004 * Math.sin(p * 30);
    const lon = centerLon + radius * Math.cos(angle) + 0.003 * Math.cos(p * 22);
    const baseEle =
      60 +
      140 * Math.max(0, Math.sin(p * Math.PI * 1.4)) +
      70 * Math.max(0, Math.sin((p - 0.15) * Math.PI * 3.1)) +
      25 * Math.sin(p * 40);
    const noise = (Math.sin(i * 12.9) * 0.5 + 0.5) * 2;
    const ele = Math.max(2, baseEle + noise);
    const speed = 14 + 12 * (1 - Math.min(1, Math.max(0, (ele - 40) / 200))) + Math.sin(i * 3) * 2;
    const dtSec = 8 + Math.sin(i * 5) * 1.5;
    t += Math.max(3, dtSec);
    const time = new Date(start.getTime() + t * 1000);
    const hr = 118 + 40 * Math.min(1, Math.max(0, (ele - 20) / 220)) + Math.sin(i * 2) * 6;
    const cad = 68 + 18 * Math.sin(i * 0.7) + (speed < 10 ? -15 : 0);
    pts.push({
      lat,
      lon,
      ele,
      time,
      hr: Math.round(hr),
      cad: Math.max(0, Math.round(cad)),
      power: null,
      temp: 27 + Math.sin(p * 6) * 2,
    });
  }
  // pause fictive au 2/3 du parcours
  const pauseIdx = Math.floor(n * 0.63);
  for (let k = 0; k < 6; k++) {
    const base = pts[pauseIdx];
    pts.splice(pauseIdx + k, 0, {
      ...base,
      time: new Date(base.time.getTime() + k * 30000),
    });
  }
  return { name: "Sortie de démonstration", points: pts };
}
