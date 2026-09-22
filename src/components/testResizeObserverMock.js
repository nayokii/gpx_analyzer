/**
 * jsdom (environnement de test) n'implémente pas `ResizeObserver`, utilisé
 * par recharts (`ResponsiveContainer`, déjà utilisé ailleurs dans l'app,
 * jamais couvert par un test avant l'ajout de HistoryDashboard). Stub minimal
 * sans effet : ne vérifie jamais de dimensions réelles, sert uniquement à
 * permettre le rendu en test.
 */
export function stubResizeObserver() {
  if (typeof global.ResizeObserver !== "undefined") return;
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
