/**
 * jsdom (environnement de test) n'implémente pas le contexte 2D du canvas
 * (`getContext("2d")` retourne `null`). ProfileChart.jsx dessine son profil
 * sur un <canvas> — préexistant, jamais couvert par un test avant l'ajout de
 * ces tests de composants. Ce stub fournit un faux contexte qui accepte tout
 * appel de méthode et toute affectation de propriété sans effet, uniquement
 * pour permettre le rendu en test ; il ne vérifie jamais ce qui est dessiné
 * (aucun test ne doit s'appuyer sur son comportement graphique).
 */
import { vi } from "vitest";

export function stubCanvasContext() {
  const stub = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stub);
}
