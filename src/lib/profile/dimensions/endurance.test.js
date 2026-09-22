import { describe, it, expect } from "vitest";
import { computeEndurance } from "./endurance.js";

function signal(id, { movingTimeSec, durationSec } = {}) {
  return { activityId: id, movingTimeSec: movingTimeSec ?? null, durationSec: durationSec ?? null };
}

describe("computeEndurance", () => {
  it("données absentes : insufficient_data, jamais de value", () => {
    const result = computeEndurance([]);
    expect(result.value).toBeNull();
    expect(result.confidenceLabel).toBe("insufficient_data");
  });

  it("aucune activité datée/temporisée exploitable : insufficient_data", () => {
    const result = computeEndurance([signal("a"), signal("b")]);
    expect(result.value).toBeNull();
  });

  it("une seule sortie (cold start) : produit une value avec confiance faible", () => {
    const result = computeEndurance([signal("a", { movingTimeSec: 90 * 60 })]); // 1h30
    expect(result.value).not.toBeNull();
    expect(result.value).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.35);
    expect(result.confidenceLabel).not.toBe("high");
    expect(result.contributingActivities).toBe(1);
  });

  it("une sortie longue isolée : value suit une courbe à rendements décroissants (pas de croissance linéaire), et sa fiabilité reste explicitement faible", () => {
    // La protection contre "une longue sortie seule = score élevé" est la
    // CONFIANCE (vérifiée dans le test précédent), pas un plafonnement
    // artificiel de value : une sortie de 6h place légitimement value au-delà
    // de la plage de démarrage, mais moins que si la courbe était linéaire.
    const result = computeEndurance([signal("a", { movingTimeSec: 6 * 3600 })]); // 6h, seule
    const linearEquivalent = (6 / 5) * 100; // 120, si la courbe était linéaire au lieu de sqrt
    expect(result.value).toBeLessThan(linearEquivalent);
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("plusieurs sorties longues répétées augmentent la confiance par rapport à une seule", () => {
    const one = computeEndurance([signal("a", { movingTimeSec: 3 * 3600 })]);
    const many = computeEndurance(
      Array.from({ length: 10 }, (_, i) => signal(`a${i}`, { movingTimeSec: 3 * 3600 }))
    );
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });

  it("se rabat sur duration quand movingTime est absent", () => {
    const result = computeEndurance([signal("a", { durationSec: 3600 })]);
    expect(result.value).not.toBeNull();
  });

  it("ignore les activités sans durée/temps en mouvement", () => {
    const result = computeEndurance([
      signal("a", { movingTimeSec: 3600 }),
      signal("b"), // ni movingTime ni duration
    ]);
    expect(result.evidenceCount).toBe(1);
  });

  it("gère une valeur extrême sans planter (rendements décroissants, pas d'explosion)", () => {
    const result = computeEndurance([signal("a", { movingTimeSec: 30 * 3600 })]); // 30h
    expect(Number.isFinite(result.value)).toBe(true);
  });

  it("les preuves ne dépassent jamais 10 entrées et sont triées par durée décroissante", () => {
    const signals = Array.from({ length: 15 }, (_, i) => signal(`a${i}`, { movingTimeSec: (i + 1) * 600 }));
    const result = computeEndurance(signals);
    expect(result.evidence.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < result.evidence.length; i++) {
      expect(result.evidence[i - 1].value).toBeGreaterThanOrEqual(result.evidence[i].value);
    }
  });
});
