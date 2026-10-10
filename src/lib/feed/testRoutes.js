/** Boucle d'environ 3 km de rayon autour de (45.12, 5.43), `n` points — données de test uniquement. */
export function loopRoute(n = 200, lat0 = 45.1234, lon0 = 5.4321) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * Math.PI * 2;
    return { lat: lat0 + 0.03 * Math.sin(a), lon: lon0 + 0.04 * (Math.cos(a) - 1) };
  });
}
