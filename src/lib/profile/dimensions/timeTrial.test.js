import { describe, it, expect } from "vitest";
import { computeTimeTrial } from "./timeTrial.js";

function signal(id, { bestEfforts = null, measuredPowerW = null } = {}) {
  return {
    activityId: id,
    bestEfforts,
    bestPowerEfforts: measuredPowerW != null ? { s1200: { power: measuredPowerW, duration: 1200 } } : null,
  };
}

function efforts({ k1 = null, k5 = null, k10 = null, k20 = null } = {}) {
  return { k1, k5, k10, k20 };
}

describe("computeTimeTrial", () => {
  it("liste vide : insufficient_data", () => {
    expect(computeTimeTrial([]).value).toBeNull();
  });

  it("aucun meilleur effort exploitable (sorties trop courtes) : insufficient_data", () => {
    const result = computeTimeTrial([signal("a", { bestEfforts: efforts() })]);
    expect(result.value).toBeNull();
  });

  it("une seule sortie (cold start) : value définie, confiance faible", () => {
    const result = computeTimeTrial([signal("a", { bestEfforts: efforts({ k10: { avgSpeed: 32, duration: 1125 } }) })]);
    expect(result.value).not.toBeNull();
    expect(result.confidence).toBeLessThan(0.35);
  });

  it("préfère la plus longue distance disponible (k20 > k10 > k5 > k1)", () => {
    const result = computeTimeTrial([
      signal("a", {
        bestEfforts: efforts({
          k1: { avgSpeed: 45, duration: 80 },
          k5: { avgSpeed: 38, duration: 470 },
          k10: { avgSpeed: 34, duration: 1059 },
          k20: { avgSpeed: 30, duration: 2400 },
        }),
      }),
    ]);
    expect(result.evidence[0].metric).toBe("bestEffortSpeed_k20");
  });

  it("ajoute la puissance mesurée en preuve contextuelle sans changer la formule de value", () => {
    const withoutPower = computeTimeTrial([signal("a", { bestEfforts: efforts({ k20: { avgSpeed: 30, duration: 2400 } }) })]);
    const withPower = computeTimeTrial([
      signal("a", { bestEfforts: efforts({ k20: { avgSpeed: 30, duration: 2400 } }), measuredPowerW: 220 }),
    ]);
    expect(withPower.value).toBe(withoutPower.value);
    expect(withPower.evidence[0].reason).toContain("W mesurés");
  });

  it("la confiance augmente avec le nombre de sorties contributrices", () => {
    const one = computeTimeTrial([signal("a", { bestEfforts: efforts({ k10: { avgSpeed: 30, duration: 1200 } }) })]);
    const many = computeTimeTrial(
      Array.from({ length: 8 }, (_, i) => signal(`a${i}`, { bestEfforts: efforts({ k10: { avgSpeed: 30, duration: 1200 } }) }))
    );
    expect(many.confidence).toBeGreaterThan(one.confidence);
  });
});
